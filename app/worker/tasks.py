"""
app/worker/tasks.py
─────────────────────────────────────────────────────────────────────────────
Celery Task Definitions — SG-BVC EDA Integration Tasks
─────────────────────────────────────────────────────────────────────────────

ARQUITECTURA DE REINTENTOS (Exponential Backoff):

  Intento 1: inmediato
  Intento 2: 60s    (countdown = 60 * 2^0)
  Intento 3: 120s   (countdown = 60 * 2^1)
  Intento 4: 240s   (countdown = 60 * 2^2)
  Intento 5: 480s   (countdown = 60 * 2^3)
  Intento 6: FALLA DEFINITIVA → dead_letter_task()

  Total de ventana de reintento: ~15 minutos
  Suficiente para absorber mantenimientos breves del ERP / SAP.

FLUJO DE ESTADO EN Integration_Log:

  PENDING → SUCCESS          (entrega exitosa en primer intento)
  PENDING → RETRYING → ...  (reintentos en curso)
  PENDING → RETRYING → DEAD_LETTER  (todos los reintentos agotados)

SEGURIDAD:
  • Firma HMAC-SHA256 en el header X-SG-Signature.
  • El ERP receptor puede validar la autenticidad del evento.
  • Misma clave que INTEGRATION_API_KEY del settings.
"""

import json
import hmac
import hashlib
import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict

import httpx
from celery import Task
from celery.utils.log import get_task_logger

from app.worker.celery_app import celery_app

logger = get_task_logger(__name__)

# ── Configuración de reintentos ───────────────────────────────────────────
MAX_RETRIES    = 5
BASE_BACKOFF_S = 60   # segundos base para el backoff exponencial


# ── Helper: sesión de DB síncrona para tareas Celery ─────────────────────

def _get_sync_db_session():
    """
    Crea una sesión SQLAlchemy síncrona para usar dentro de workers Celery.
    Los workers son procesos separados de Uvicorn, sin el ciclo de vida
    de FastAPI, por lo que necesitan crear su propia sesión.
    Siempre usa el PRIMARY engine (escrituras de auditoría).
    """
    from app.database import SessionLocal
    return SessionLocal()


def _get_primary_session():
    """Sesión directa al Primary (para Integration_Log, que es escritura)."""
    from sqlalchemy.orm import sessionmaker
    from app.database import engine
    Session = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    return Session()


# ── Helper: firma HMAC del payload ────────────────────────────────────────

def _sign_payload(payload_json: str) -> str:
    """
    Genera firma HMAC-SHA256 del payload para que el ERP pueda validar
    la autenticidad del webhook (previene spoofing).

    Header enviado: X-SG-Signature: sha256=<hex_digest>
    """
    secret = os.environ.get("INTEGRATION_API_KEY", "SG_SECRET_KEY_123")
    signature = hmac.new(
        secret.encode("utf-8"),
        payload_json.encode("utf-8"),
        hashlib.sha256
    ).hexdigest()
    return f"sha256={signature}"


# ── Tarea Principal: Webhook al ERP ──────────────────────────────────────

@celery_app.task(
    name="app.worker.tasks.notify_erp_task",
    bind=True,                    # self = referencia a la instancia de la tarea
    max_retries=MAX_RETRIES,
    queue="sg.integration.erp",
    acks_late=True,               # confirmar DESPUÉS de ejecutar (safety)
    reject_on_worker_lost=True,
    time_limit=30,                # Hard limit: matar la tarea después de 30s
    soft_time_limit=20,           # Soft: lanzar SoftTimeLimitExceeded a los 20s
)
def notify_erp_task(
    self: Task,
    log_id: int,
    event_type: str,
    payload: Dict[str, Any],
    webhook_url: str,
) -> Dict[str, Any]:
    """
    Tarea Celery para enviar webhooks al ERP de forma asíncrona.

    Parámetros:
        log_id      : ID del registro en Integration_Log (ya creado en estado PENDING)
        event_type  : Tipo de evento WMS (ej: "VENTA_POS", "MERMA_DECLARADA", "ASN_RECIBIDO")
        payload     : Diccionario con los datos del evento
        webhook_url : URL destino del ERP

    Flujo:
        1. Abre sesión de BD → busca el Integration_Log por ID
        2. Serializa el payload y genera firma HMAC
        3. Realiza POST HTTP con httpx (con timeout)
        4. En éxito → actualiza log a SUCCESS
        5. En error HTTP / timeout → actualiza log a RETRYING y reintenta
        6. Si se agotan los reintentos → actualiza log a DEAD_LETTER
           y dispara dead_letter_task para procesamiento manual

    Returns:
        dict con status final y detalles de la entrega
    """
    db = _get_primary_session()

    try:
        from app.models import Integration_Log
        log_entry = db.query(Integration_Log).filter(Integration_Log.id == log_id).first()

        if not log_entry:
            logger.error("[notify_erp_task] Log ID=%d no encontrado en BD. Abortando.", log_id)
            return {"status": "ABORTED", "reason": "log_not_found"}

        # ── Construir payload completo con metadatos ──────────────────
        full_payload = {
            "event_type": event_type,
            "event_id": log_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "source": "SG-BVC-WMS",
            "retry_count": self.request.retries,
            "data": payload,
        }
        payload_json = json.dumps(full_payload, default=str)
        signature    = _sign_payload(payload_json)

        headers = {
            "Content-Type":   "application/json",
            "X-SG-Signature": signature,
            "X-Event-Type":   event_type,
            "X-Event-ID":     str(log_id),
            "User-Agent":     "SG-BVC-WMS/2.0",
        }

        logger.info(
            "[notify_erp_task] Enviando evento %s (log_id=%d, intento=%d/%d) → %s",
            event_type, log_id, self.request.retries + 1, MAX_RETRIES + 1, webhook_url
        )

        # ── Envío HTTP con httpx (síncrono dentro del worker) ─────────
        with httpx.Client(timeout=httpx.Timeout(connect=5.0, read=15.0, write=10.0, pool=5.0)) as client:
            response = client.post(webhook_url, content=payload_json, headers=headers)

        # ── Evaluar respuesta ─────────────────────────────────────────
        if response.is_success:
            log_entry.status = "SUCCESS"
            log_entry.error_message = None
            db.commit()
            logger.info(
                "[notify_erp_task] OK — event_type=%s log_id=%d HTTP=%d",
                event_type, log_id, response.status_code
            )
            return {
                "status": "SUCCESS",
                "log_id": log_id,
                "http_status": response.status_code,
                "retries": self.request.retries,
            }
        else:
            # Error HTTP (4xx/5xx del ERP) → reintentar
            error_msg = f"HTTP {response.status_code}: {response.text[:500]}"
            raise ValueError(error_msg)

    except (httpx.TimeoutException, httpx.ConnectError, httpx.RequestError) as exc:
        # ── Error de red / timeout → Exponential Backoff ──────────────
        retry_number = self.request.retries
        countdown    = BASE_BACKOFF_S * (2 ** retry_number)

        logger.warning(
            "[notify_erp_task] Error de red en intento %d/%d (log_id=%d): %s. "
            "Reintentando en %ds...",
            retry_number + 1, MAX_RETRIES + 1, log_id, str(exc), countdown
        )

        # Actualizar log a RETRYING con detalle del error
        try:
            from app.models import Integration_Log
            log_entry = db.query(Integration_Log).filter(Integration_Log.id == log_id).first()
            if log_entry:
                log_entry.status = "RETRYING"
                log_entry.error_message = (
                    f"[Intento {retry_number + 1}/{MAX_RETRIES + 1}] {str(exc)[:300]}"
                )
                db.commit()
        except Exception as db_exc:
            logger.error("[notify_erp_task] Error al actualizar log a RETRYING: %s", db_exc)

        # Disparar reintento con backoff exponencial
        raise self.retry(exc=exc, countdown=countdown)

    except ValueError as exc:
        # ── Error HTTP no-exitoso → también reintentamos ──────────────
        retry_number = self.request.retries
        countdown    = BASE_BACKOFF_S * (2 ** retry_number)

        logger.warning(
            "[notify_erp_task] Error HTTP en intento %d/%d (log_id=%d): %s. "
            "Reintentando en %ds...",
            retry_number + 1, MAX_RETRIES + 1, log_id, str(exc), countdown
        )

        try:
            from app.models import Integration_Log
            log_entry = db.query(Integration_Log).filter(Integration_Log.id == log_id).first()
            if log_entry:
                log_entry.status = "RETRYING"
                log_entry.error_message = (
                    f"[Intento {retry_number + 1}/{MAX_RETRIES + 1}] {str(exc)[:300]}"
                )
                db.commit()
        except Exception as db_exc:
            logger.error("[notify_erp_task] Error al actualizar log: %s", db_exc)

        raise self.retry(exc=exc, countdown=countdown)

    except self.MaxRetriesExceededError:
        # ── DEAD LETTER: todos los reintentos agotados ─────────────────
        logger.error(
            "[notify_erp_task] DEAD LETTER — log_id=%d event_type=%s. "
            "Todos los reintentos agotados. Derivando a DLQ.",
            log_id, event_type
        )
        _handle_dead_letter(db, log_id, event_type, payload, webhook_url)
        return {"status": "DEAD_LETTER", "log_id": log_id}

    finally:
        db.close()


def _handle_dead_letter(db, log_id: int, event_type: str, payload: dict, webhook_url: str):
    """
    Maneja el estado final de Dead Letter:
    1. Marca el Integration_Log como DEAD_LETTER
    2. Dispara dead_letter_task para procesamiento manual / alerta
    """
    try:
        from app.models import Integration_Log
        log_entry = db.query(Integration_Log).filter(Integration_Log.id == log_id).first()
        if log_entry:
            log_entry.status = "DEAD_LETTER"
            log_entry.error_message = (
                f"DEAD LETTER — {MAX_RETRIES} reintentos agotados. "
                f"Requiere intervención manual. Webhook URL: {webhook_url}"
            )
            db.commit()
    except Exception as e:
        logger.error("[_handle_dead_letter] Error actualizando log: %s", e)

    # Disparar tarea de notificación/alerta en la DLQ
    dead_letter_task.apply_async(
        kwargs={
            "log_id":      log_id,
            "event_type":  event_type,
            "payload":     payload,
            "webhook_url": webhook_url,
        },
        queue="sg.integration.dlq",
    )


# ── Tarea Dead Letter: Alerta + Acción de recuperación ───────────────────

@celery_app.task(
    name="app.worker.tasks.dead_letter_task",
    queue="sg.integration.dlq",
    max_retries=0,               # DLQ NO reintenta — requiere acción manual
    acks_late=True,
)
def dead_letter_task(
    log_id: int,
    event_type: str,
    payload: Dict[str, Any],
    webhook_url: str,
) -> Dict[str, Any]:
    """
    Tarea de Dead Letter Queue.

    Se ejecuta cuando notify_erp_task ha agotado todos sus reintentos.
    Acciones posibles (configurables según el entorno):
      1. Escribir en la tabla Integration_Log con status DEAD_LETTER (ya hecho)
      2. Enviar alerta a un canal de Slack / PagerDuty
      3. Guardar payload en un bucket S3/GCS para replay manual

    En esta implementación: registra el evento para procesamiento manual.
    En producción: integrar con el servicio de alertas del equipo de Ops.
    """
    logger.critical(
        "[DEAD_LETTER] Evento %s (log_id=%d) sin entregar al ERP. "
        "Intervención manual requerida. Payload guardado en Integration_Log.",
        event_type, log_id
    )

    # EXTENSIÓN FUTURA: Enviar alerta a Slack / PagerDuty
    # slack_webhook = os.environ.get("SLACK_OPS_WEBHOOK")
    # if slack_webhook:
    #     httpx.post(slack_webhook, json={
    #         "text": f":red_circle: *DEAD LETTER* WMS Event `{event_type}` "
    #                 f"(log_id={log_id}) sin entregar. Revisar Integration_Log."
    #     })

    return {
        "status":     "DEAD_LETTER_PROCESSED",
        "log_id":     log_id,
        "event_type": event_type,
        "action":     "manual_review_required",
    }


# ── Tarea: Cálculo Asíncrono de Compliance ───────────────────────────────────

@celery_app.task(
    name="app.worker.tasks.calculate_compliance_batch_task",
    queue="sg.integration.default",
    acks_late=True,
)
def calculate_compliance_batch_task() -> Dict[str, Any]:
    """
    Tarea programable (por ejemplo, con celery beat cada 5 mins) que 
    pre-calcula el compliance de todas las patentes y lo guarda en Redis
    para que la carga del mapa 2D sea instantánea.
    """
    db = _get_sync_db_session()
    try:
        from app.services.slotting_service import get_compliance_batch
        from app.core.cache import cache_set
        
        logger.info("[calculate_compliance_batch_task] Iniciando cálculo de compliance batch...")
        resultado = get_compliance_batch(db)
        
        # Guardar en Redis por 10 minutos (600 segundos)
        cache_set("sg:compliance:batch", resultado, ttl=600)
        logger.info("[calculate_compliance_batch_task] Cálculo completado exitosamente y guardado en caché.")
        
        return {"status": "SUCCESS", "patentes_calculadas": len(resultado)}
    except Exception as e:
        logger.exception("[calculate_compliance_batch_task] Error calculando compliance batch")
        return {"status": "ERROR", "detail": str(e)}
    finally:
        db.close()
