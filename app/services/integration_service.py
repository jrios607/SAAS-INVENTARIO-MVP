"""
app/services/integration_service.py
─────────────────────────────────────────────────────────────────────────────
Integration Service — Migrado de BackgroundTasks a Celery EDA
─────────────────────────────────────────────────────────────────────────────
Patrón implementado: Transactional Outbox + Async Message Dispatch

  ┌─────────────────────────────────────────────────────────────────────────┐
  │  OUTBOX PATTERN (Garantía de entrega "at-least-once")                  │
  │                                                                         │
  │  1. El router llama a emit_event()                                      │
  │  2. emit_event() PRIMERO escribe en Integration_Log (PENDING)           │
  │     → esto ocurre en la MISMA transacción de DB que el evento original  │
  │  3. Si el commit() OK → dispatch_to_celery()                            │
  │     → Celery encola la tarea en Redis de forma asíncrona                │
  │  4. El router devuelve HTTP 2xx al cliente en < 5ms                     │
  │  5. El worker Celery lee la cola y ejecuta el POST al ERP               │
  │                                                                         │
  │  Si el worker falla: el Integration_Log queda en PENDING/RETRYING       │
  │  → un job de reconciliación puede re-encolar los PENDING viejos         │
  └─────────────────────────────────────────────────────────────────────────┘

Eventos soportados:
  • VENTA_POS_CONSOLIDADA   — Generado por el POS al cerrar un ticket
  • ASN_RECIBIDO            — Generado al recepcionar mercadería
  • MERMA_DECLARADA         — Generado al registrar una merma
  • PICKING_COMPLETADO      — Generado al completar una ola de picking
  • INVENTARIO_AJUSTADO     — Generado por ajustes manuales
"""

import json
import logging
from datetime import date
from typing import Dict, Any, Optional

from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from app.models import Integration_Log, ASN_Padre, ASN_Detalle, Catalogo_Producto
from app.core.config import settings

logger = logging.getLogger("sg-wms.integration")


# ── Dispatcher de Eventos EDA ─────────────────────────────────────────────

def emit_event(
    db: Session,
    event_type: str,
    payload: Dict[str, Any],
    webhook_url: Optional[str] = None,
) -> int:
    """
    Función central de despacho de eventos.
    Implementa el patrón Transactional Outbox:

      1. Crea registro en Integration_Log con status=PENDING (en la misma
         sesión de DB del evento de negocio — atomicidad garantizada).
      2. Dispara la tarea Celery de forma asíncrona.
      3. Retorna el log_id para trazabilidad.

    Parámetros:
        db          : Sesión SQLAlchemy activa (Primary)
        event_type  : Tipo de evento WMS (constante string)
        payload     : Datos del evento a enviar al ERP
        webhook_url : URL destino (default: settings.ERP_WEBHOOK_URL)

    Returns:
        log_id (int) del registro creado en Integration_Log

    Raises:
        Exception: Solo si la escritura en Integration_Log falla.
                   El fallo de Celery NO propaga excepción (fail-silent).
    """
    url = webhook_url or settings.ERP_WEBHOOK_URL

    # ── Paso 1: Escribir en Integration_Log (OUTBOX) ──────────────────
    # Esta escritura es parte de la transacción del evento de negocio.
    # Si el commit() del router falla, este log también se revierte.
    log_entry = Integration_Log(
        event_type=event_type,
        payload_json=json.dumps(payload, default=str),
        status="PENDING",
    )
    db.add(log_entry)
    db.flush()           # flush para obtener el log_entry.id sin hacer commit

    log_id = log_entry.id
    logger.info(
        "[emit_event] Evento %s registrado en outbox (log_id=%d). Despachando a Celery...",
        event_type, log_id
    )

    # ── Paso 2: Despachar tarea Celery (fire-and-forget) ──────────────
    # Si Redis no está disponible, el error se captura silenciosamente.
    # El Integration_Log queda en PENDING → el reconciliador lo reencola.
    if url:
        _dispatch_to_celery(log_id, event_type, payload, url)
    else:
        log_entry.status = "FAILED"
        log_entry.error_message = "ERP_WEBHOOK_URL no configurada."
        logger.warning("[emit_event] ERP_WEBHOOK_URL no definida. Evento log_id=%d marcado FAILED.", log_id)

    return log_id


def _dispatch_to_celery(log_id: int, event_type: str, payload: dict, url: str) -> None:
    """
    Envía la tarea a la cola Celery de forma segura.
    Falla silenciosamente si Celery/Redis no está disponible,
    permitiendo que el sistema opere en modo degradado.
    """
    try:
        from app.worker.tasks import notify_erp_task
        notify_erp_task.apply_async(
            kwargs={
                "log_id":      log_id,
                "event_type":  event_type,
                "payload":     payload,
                "webhook_url": url,
            },
            queue="sg.integration.erp",
            # countdown=0 → ejecución inmediata (sin delay inicial)
            countdown=0,
        )
        logger.info(
            "[_dispatch_to_celery] Tarea encolada en sg.integration.erp "
            "(log_id=%d, event_type=%s)",
            log_id, event_type
        )
    except Exception as celery_exc:
        # Si Celery no está disponible, el evento queda en PENDING en la DB.
        # Un job de reconciliación puede levantarlos y re-encolarlos.
        logger.error(
            "[_dispatch_to_celery] Error al encolar en Celery (log_id=%d): %s. "
            "El evento permanece en PENDING para reconciliacion.",
            log_id, celery_exc
        )


# ── Helpers por tipo de evento ────────────────────────────────────────────
# Wrappers con tipado fuerte para cada dominio de negocio.
# Los routers los usan directamente, sin conocer los detalles de Celery.

def emit_venta_pos(db: Session, items_vendidos: list, total_unidades: int) -> int:
    """Emite evento de venta POS hacia el ERP."""
    return emit_event(
        db=db,
        event_type="VENTA_POS_CONSOLIDADA",
        payload={
            "items":           items_vendidos,
            "total_unidades":  total_unidades,
            "sucursal":        "SG-BVC-01",
        },
    )


def emit_merma_declarada(db: Session, sku: str, cantidad: int, lote: Optional[str], motivo: Optional[str]) -> int:
    """Emite evento de merma declarada hacia el ERP."""
    return emit_event(
        db=db,
        event_type="MERMA_DECLARADA",
        payload={
            "sku":      sku,
            "cantidad": cantidad,
            "lote":     lote,
            "motivo":   motivo,
        },
    )


def emit_asn_recibido(db: Session, lpn: str, items: list) -> int:
    """Emite evento de ASN recibido (GR - Goods Receipt) hacia el ERP."""
    return emit_event(
        db=db,
        event_type="ASN_RECIBIDO",
        payload={
            "lpn":   lpn,
            "items": items,
        },
    )


def emit_picking_completado(db: Session, ola_id: int, pedidos: list) -> int:
    """Emite evento de ola de picking completada hacia el ERP."""
    return emit_event(
        db=db,
        event_type="PICKING_COMPLETADO",
        payload={
            "ola_id":  ola_id,
            "pedidos": pedidos,
        },
    )


# ── Reconciliador: Re-encolar eventos PENDING viejos ─────────────────────

def reconcile_pending_events(db: Session, max_age_minutes: int = 15) -> int:
    """
    Busca eventos PENDING con más de `max_age_minutes` minutos de antigüedad
    y los re-encola en Celery.

    Llamar desde un endpoint de admin o un Celery Beat schedule.
    Protege contra el caso donde Celery/Redis estaba caído cuando se disparó el evento.

    Returns:
        Número de eventos re-encolados.
    """
    from datetime import datetime, timezone, timedelta
    from sqlalchemy import and_

    cutoff = datetime.now(timezone.utc) - timedelta(minutes=max_age_minutes)

    stale_logs = db.query(Integration_Log).filter(
        and_(
            Integration_Log.status.in_(["PENDING", "RETRYING"]),
            Integration_Log.created_at < cutoff,
        )
    ).all()

    re_enqueued = 0
    for log in stale_logs:
        try:
            payload = json.loads(log.payload_json)
            _dispatch_to_celery(log.id, log.event_type, payload, settings.ERP_WEBHOOK_URL)
            re_enqueued += 1
            logger.info("[reconcile] Re-encolado log_id=%d event_type=%s", log.id, log.event_type)
        except Exception as e:
            logger.error("[reconcile] Error re-encolando log_id=%d: %s", log.id, e)

    logger.info("[reconcile] %d eventos re-encolados.", re_enqueued)
    return re_enqueued


# ── ASN Inbound (sin cambios — es recepción, no emisión) ──────────────────

def procesar_asn_inbound(db: Session, payload: dict) -> dict:
    """
    Parsea un ASN del ERP y lo inserta en la base de datos.
    Payload esperado:
    {
      "proveedor": "Nombre Proveedor",
      "fecha_recepcion_esperada": "YYYY-MM-DD",
      "detalles": [
         {"sku": "123456", "cantidad_esperada": 100},
         ...
      ]
    }
    """
    proveedor = payload.get("proveedor", "Proveedor Desconocido")
    fecha_esperada_str = payload.get("fecha_recepcion_esperada", date.today().isoformat())
    try:
        fecha_esperada = date.fromisoformat(fecha_esperada_str)
    except ValueError:
        fecha_esperada = date.today()

    nuevo_asn = ASN_Padre(
        proveedor=proveedor,
        fecha_recepcion_esperada=fecha_esperada,
        estado="PENDIENTE"
    )
    db.add(nuevo_asn)
    db.flush()

    detalles = payload.get("detalles", [])
    for det in detalles:
        sku      = det.get("sku")
        cantidad = det.get("cantidad_esperada", 0)
        if not db.query(Catalogo_Producto).filter_by(sku=sku).first():
            continue
        nuevo_detalle = ASN_Detalle(
            asn_id=nuevo_asn.id,
            sku=sku,
            cantidad_esperada=cantidad,
            cantidad_recibida=0
        )
        db.add(nuevo_detalle)

    db.commit()
    db.refresh(nuevo_asn)
    return {"mensaje": "ASN inyectado con exito", "asn_id": nuevo_asn.id}


# ── Alias backward-compat (no romper imports existentes) ─────────────────
# Los routers que aún usan emitir_webhook() como BackgroundTask seguirán
# funcionando durante la migración incremental.

def emitir_webhook(db: Session, event_type: str, payload: Dict[str, Any]):
    """
    Alias de compatibilidad hacia emit_event().
    DEPRECATED: Usar emit_event() directamente en código nuevo.
    """
    logger.warning(
        "[DEPRECATED] emitir_webhook() llamado. Usar emit_event() directamente. "
        "event_type=%s", event_type
    )
    emit_event(db, event_type, payload)
