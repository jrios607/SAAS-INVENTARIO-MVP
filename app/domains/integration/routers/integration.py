"""
app/domains/integration/routers/integration.py
─────────────────────────────────────────────────────────────────────────────
Integration API Router — M2M endpoints para ERP → WMS
─────────────────────────────────────────────────────────────────────────────
Endpoints:
  POST /api/v1/integration/asn          → Inbound ASN desde ERP (M2M)
  POST /api/v1/integration/event/test   → Dispara un evento de prueba manual
  GET  /api/v1/integration/logs         → Consulta el Integration_Log
  POST /api/v1/integration/reconcile    → Re-encola eventos PENDING viejos
"""

import logging
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from typing import List, Optional

from app.database import get_db, get_db_read
from app.core.security import verify_api_key, require_role
from app.models import Integration_Log
from app.services.integration_service import (
    procesar_asn_inbound,
    emit_event,
    reconcile_pending_events,
)

logger = logging.getLogger("sg-wms.integration")

router = APIRouter()


# ── POST /api/v1/integration/asn ─────────────────────────────────────────

from fastapi import APIRouter, Depends, HTTPException, Query, status, Header
from app.core.cache import cache_get, cache_set
import json

@router.post("/asn", summary="[M2M] Recibir ASN desde ERP")
def recibir_asn_erp(
    payload: dict,
    db: Session = Depends(get_db),
    api_key: str = Depends(verify_api_key),
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key")
):
    """
    Endpoint M2M: el ERP envía un ASN (Advance Shipment Notice) al WMS.
    Requiere header: X-API-Key: <INTEGRATION_API_KEY>
    Soporta Idempotency-Key para evitar procesar el mismo webhook dos veces.
    """
    if idempotency_key:
        cache_key = f"sg:idempotency:asn:{idempotency_key}"
        cached_response = cache_get(cache_key)
        if cached_response:
            logger.info(f"Idempotency hit for key {idempotency_key}. Returning cached response.")
            return cached_response

    try:
        resultado = procesar_asn_inbound(db, payload)
        
        if idempotency_key:
            # Guardamos el resultado en caché por 24 horas (86400 segundos)
            cache_set(cache_key, resultado, ttl=86400)
            
        return resultado
    except Exception as e:
        logger.exception("[integration] Error procesando ASN inbound")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Error procesando ASN: {str(e)}"
        )


# ── POST /api/v1/integration/event/test ──────────────────────────────────

@router.post("/event/test", summary="[Admin] Disparar evento de prueba")
def test_event(
    event_type: str = Query(default="TEST_EVENT", description="Tipo de evento a emitir"),
    db: Session = Depends(get_db),
    user=Depends(require_role("Admin", "Supervisor")),
):
    """
    Endpoint de prueba para verificar que el pipeline Celery → ERP funciona.
    Dispara un evento dummy y retorna el log_id creado.
    """
    try:
        log_id = emit_event(
            db=db,
            event_type=event_type,
            payload={
                "test": True,
                "message": "Evento de prueba del pipeline EDA SG-BVC",
            },
        )
        db.commit()
        return {
            "mensaje":  "Evento de prueba encolado en Celery.",
            "log_id":   log_id,
            "event":    event_type,
            "pipeline": "FastAPI → Redis → Celery Worker → ERP",
        }
    except Exception:
        db.rollback()
        logger.exception("[integration] Error en test_event")
        raise HTTPException(status_code=500, detail="Error disparando evento de prueba.")


# ── GET /api/v1/integration/logs ─────────────────────────────────────────

@router.get("/logs", summary="Consultar Integration_Log")
def get_integration_logs(
    status_filter: Optional[str] = Query(None, alias="status", description="Filtrar por status: PENDING, SUCCESS, RETRYING, DEAD_LETTER, FAILED"),
    limit: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db_read),    # Solo lectura → Read Replica
    user=Depends(require_role("Admin", "Supervisor")),
):
    """
    Retorna los últimos registros del Integration_Log.
    Útil para monitorear el estado del pipeline de webhooks.

    Filtros:
      ?status=DEAD_LETTER  → Ver eventos que requieren intervención manual
      ?status=RETRYING     → Ver eventos en proceso de reintento
      ?status=PENDING      → Ver eventos esperando ser encolados
    """
    query = db.query(Integration_Log).order_by(Integration_Log.id.desc())

    if status_filter:
        query = query.filter(Integration_Log.status == status_filter.upper())

    logs = query.limit(limit).all()

    return [
        {
            "id":            log.id,
            "event_type":    log.event_type,
            "status":        log.status,
            "error_message": log.error_message,
            "created_at":    log.created_at.isoformat() if log.created_at else None,
        }
        for log in logs
    ]


# ── POST /api/v1/integration/reconcile ───────────────────────────────────

@router.post("/reconcile", summary="[Admin] Re-encolar eventos PENDING/RETRYING")
def reconcile_events(
    max_age_minutes: int = Query(15, ge=1, le=1440, description="Re-encolar eventos mas viejos que N minutos"),
    db: Session = Depends(get_db),
    user=Depends(require_role("Admin")),
):
    """
    Reconciliador manual: busca eventos PENDING o RETRYING más viejos
    que `max_age_minutes` y los re-encola en Celery.

    Útil para recuperarse de un outage de Redis/Celery donde los eventos
    quedaron en PENDING sin ser procesados.

    En producción, este endpoint también puede llamarse desde un Celery Beat
    schedule cada 15 minutos como job de reconciliación automática.
    """
    try:
        count = reconcile_pending_events(db, max_age_minutes=max_age_minutes)
        return {
            "mensaje":          f"{count} eventos re-encolados exitosamente.",
            "re_enqueued":      count,
            "max_age_minutes":  max_age_minutes,
        }
    except Exception:
        logger.exception("[integration] Error en reconcile_events")
        raise HTTPException(status_code=500, detail="Error durante la reconciliación.")
