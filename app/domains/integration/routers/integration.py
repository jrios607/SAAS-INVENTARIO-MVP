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

Conector Universal de Ventas Externas (Omni-POS):
  POST /api/v1/integration/sales/webhook       → POS con API Key (tiempo real, M2M)
  POST /api/v1/integration/sales/import-batch  → POS sin API: lote JSON (Admin/Supervisor)
  POST /api/v1/integration/sales/import-file   → POS sin API: archivo CSV/TXT/JSON/XLSX (Admin/Supervisor)
  GET  /api/v1/integration/sales/history       → Historial de ventas externas sincronizadas
"""

import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Query, UploadFile, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.cache import (
    CacheKeys,
    cache_get,
    cache_set,
    invalidar_catalogo_completo,
    invalidar_stock_y_kpis,
)
from app.core.security import get_current_user, require_role, verify_api_key
from app.database import get_db, get_db_read
from app.domains.integration.schemas import (
    ExternalSaleBatchRequest,
    ExternalSaleBatchResponse,
    ExternalSaleDryRunResponse,
    ExternalSaleHistoryItem,
    ExternalSaleResponse,
    ExternalSaleTicketDetailResponse,
    ExternalSaleWebhookRequest,
    OrphanCodeGroupItem,
    ResolveOrphanRequest,
    ResolveOrphanResponse,
    RevertirVentaRequest,
    RevertirVentaResponse,
)
from app.models import Integration_Log, Venta_Externa
from app.services.abc_service import recalcular_clasificacion_abc
from app.services.catalogo_service import invalidar_cache_catalogo
from app.services.external_sales_service import (
    ProductoNoEncontradoError,
    QuiebreStockError,
    VentaExternaError,
    listar_huerfanos_pendientes,
    obtener_detalle_venta_externa,
    parsear_archivo_ventas_legacy,
    previsualizar_archivo_ventas_dry_run,
    procesar_lote_ventas_externas,
    procesar_venta_externa,
    resolver_huerfano_retroactivo,
    revertir_venta_externa,
)
from app.services.integration_service import (
    emit_event,
    procesar_asn_inbound,
    reconcile_pending_events,
)

logger = logging.getLogger("sg-wms.integration")

router = APIRouter()


# ── POST /api/v1/integration/asn ─────────────────────────────────────────

@router.post("/asn", summary="[M2M] Recibir ASN desde ERP")
def recibir_asn_erp(
    payload: dict,
    db: Session = Depends(get_db),
    api_key: str = Depends(verify_api_key),
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
):
    """
    Endpoint M2M: el ERP envía un ASN (Advance Shipment Notice) al WMS.
    Requiere header: X-API-Key: <INTEGRATION_API_KEY>
    Soporta Idempotency-Key para evitar procesar el mismo webhook dos veces.
    """
    if idempotency_key:
        cache_key = CacheKeys.idempotency("asn", idempotency_key)
        cached_response = cache_get(cache_key)
        if cached_response:
            logger.info(f"Idempotency hit for key {idempotency_key}. Returning cached response.")
            return cached_response

    try:
        resultado = procesar_asn_inbound(db, payload)

        if idempotency_key:
            cache_set(cache_key, resultado, ttl=86400)

        return resultado
    except ValueError as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )
    except Exception:
        db.rollback()
        logger.exception("[integration] Error procesando ASN inbound")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error interno al procesar el ASN.",
        )


# ── POST /api/v1/integration/event/test ──────────────────────────────────

@router.post("/event/test", summary="[Admin] Disparar evento de prueba")
def test_event(
    event_type: str = Query(default="TEST_EVENT", description="Tipo de evento a emitir"),
    db: Session = Depends(get_db),
    user=Depends(require_role("Admin", "Supervisor")),
):
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
    db: Session = Depends(get_db_read),
    user=Depends(require_role("Admin", "Supervisor")),
):
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


# ══════════════════════════════════════════════════════════════════════════
#  CONECTOR UNIVERSAL DE VENTAS EXTERNAS (Omni-POS Ingestion)
#  SG-BVC no tiene caja propia: las ventas llegan desde los POS del comercio.
# ══════════════════════════════════════════════════════════════════════════

MAX_SALES_FILE_BYTES = 5 * 1024 * 1024  # 5 MB por archivo de cierre


def _user_id(user) -> Optional[int]:
    return getattr(user, "id", None) if user is not None else None


def _recalcular_abc_y_purgar_caches(db: Session) -> None:
    """Recalcula clasificación ABC tras ingesta de ventas y purga cachés del tenant."""
    try:
        recalcular_clasificacion_abc(db)
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("[integration/sales] Error recalculando ABC post-venta")
    invalidar_stock_y_kpis()
    invalidar_catalogo_completo()
    invalidar_cache_catalogo()


# ── Canal A: POS con API Key (webhook M2M en tiempo real) ────────────────

@router.post(
    "/sales/webhook",
    response_model=ExternalSaleResponse,
    summary="[M2M] Recibir venta desde un POS externo con API Key",
)
def recibir_venta_pos_webhook(
    payload: ExternalSaleWebhookRequest,
    db: Session = Depends(get_db),
    api_key: str = Depends(verify_api_key),
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key", max_length=128),
):
    """
    Para POS modernos que pueden enviar webhooks (Bsale, Loyverse, Shopify POS,
    ERPs, agentes locales, Zapier/Make, etc.).

    Headers: `X-API-Key`, `X-Tenant-ID` y opcionalmente `Idempotency-Key`.
    """
    cache_key = CacheKeys.idempotency("sales", idempotency_key) if idempotency_key else None
    if cache_key:
        cached = cache_get(cache_key)
        if cached:
            logger.info("[sales/webhook] Idempotency hit (%s).", idempotency_key)
            return cached

    try:
        resultado = procesar_venta_externa(db, payload, canal="WEBHOOK_API")
        db.commit()
    except ProductoNoEncontradoError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except QuiebreStockError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    except IntegrityError:
        db.rollback()
        resultado = {
            "estado": "DUPLICADO",
            "estado_procesamiento": "COMPLETO",
            "mensaje": "El ticket ya había sido procesado. No se descontó stock nuevamente.",
            "external_ticket_id": payload.external_ticket_id.strip(),
            "pos_source": payload.pos_source.strip(),
            "total_descontado": 0,
            "unidades_deficit": 0,
            "total_valorizado": 0,
            "es_carga_historica": bool(payload.modo_historico_abc),
            "items_huerfanos_count": 0,
            "items_huerfanos": [],
            "satos_afectados": [],
        }
    except Exception:
        db.rollback()
        logger.exception("[sales/webhook] Error inesperado procesando venta externa")
        raise HTTPException(status_code=500, detail="Error interno procesando la venta externa.")

    if resultado["estado"] in ("PROCESADO", "PARCIAL"):
        _recalcular_abc_y_purgar_caches(db)
    if cache_key:
        cache_set(cache_key, resultado, ttl=86400)
    return resultado


# ── Canal B1: POS sin API — lote JSON ────────────────────────────────────

@router.post(
    "/sales/import-batch",
    response_model=ExternalSaleBatchResponse,
    summary="[Admin] Importar lote de ventas (POS sin API)",
)
def importar_lote_ventas(
    payload: ExternalSaleBatchRequest,
    db: Session = Depends(get_db),
    user=Depends(require_role("Admin", "Supervisor")),
):
    """
    Importa un cierre de caja o lote de tickets en JSON. Cada ticket se procesa
    en su propio SAVEPOINT: los errores se reportan por ticket sin abortar el lote.
    """
    tickets = [
        t.model_copy(
            update={
                "pos_source": payload.pos_source,
                "allow_bodega_fallback": (
                    payload.allow_bodega_fallback
                    if payload.allow_bodega_fallback is not None
                    else t.allow_bodega_fallback
                ),
                "modo_historico_abc": payload.modo_historico_abc or t.modo_historico_abc,
            }
        )
        for t in payload.tickets
    ]
    try:
        resultado = procesar_lote_ventas_externas(
            db, tickets, pos_source=payload.pos_source, canal="BATCH_JSON", user_id=_user_id(user)
        )
    except Exception:
        logger.exception("[sales/import-batch] Error inesperado")
        raise HTTPException(status_code=500, detail="Error interno importando el lote de ventas.")

    if resultado["tickets_procesados"] > 0:
        _recalcular_abc_y_purgar_caches(db)
    return resultado


# ── Canal B2: POS sin API — archivo CSV / TXT / JSON / XLSX ──────────────

@router.post(
    "/sales/import-file/dry-run",
    response_model=ExternalSaleDryRunResponse,
    summary="[Admin] Pre-visualización segura (Dry-Run) de archivo de ventas antes de descontar stock",
)
async def dry_run_archivo_ventas(
    file: UploadFile = File(..., description="Exportación/cierre del POS: .csv, .txt, .json o .xlsx"),
    pos_source: str = Form("ARCHIVO_POS", min_length=1, max_length=64),
    allow_bodega_fallback: Optional[bool] = Form(None),
    modo_historico_abc: bool = Form(False),
    db: Session = Depends(get_db),
    user=Depends(require_role("Admin", "Supervisor")),
):
    """
    Analiza el archivo en modo solo lectura sobre Primary sin tocar SATOs ni registrar boletas.
    Devuelve cuántas boletas son nuevas, cuántas son duplicadas, cuántas unidades se descontarán
    y qué códigos EAN/SKU no existen aún en el catálogo.
    """
    content = await file.read(MAX_SALES_FILE_BYTES + 1)
    if len(content) > MAX_SALES_FILE_BYTES:
        raise HTTPException(status_code=413, detail="El archivo supera el máximo de 5 MB.")

    try:
        return previsualizar_archivo_ventas_dry_run(
            db=db,
            content=content,
            filename=file.filename or "",
            pos_source=pos_source.strip(),
            allow_bodega_fallback=allow_bodega_fallback,
            modo_historico_abc=modo_historico_abc,
            content_type=file.content_type,
        )
    except VentaExternaError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
    except Exception:
        logger.exception("[sales/import-file/dry-run] Error inesperado")
        raise HTTPException(status_code=500, detail="Error interno al analizar el archivo de ventas.")


@router.post(
    "/sales/import-file",
    response_model=ExternalSaleBatchResponse,
    summary="[Admin] Importar archivo de ventas CSV/TXT/JSON/XLSX (POS sin API)",
)
async def importar_archivo_ventas(
    file: UploadFile = File(..., description="Exportación/cierre del POS: .csv, .txt, .json o .xlsx"),
    pos_source: str = Form("ARCHIVO_POS", min_length=1, max_length=64),
    allow_bodega_fallback: Optional[bool] = Form(None),
    modo_historico_abc: bool = Form(False),
    db: Session = Depends(get_db),
    user=Depends(require_role("Admin", "Supervisor")),
):
    """
    Para cajas registradoras tradicionales o sistemas locales sin API.
    Soporta Excel (.xlsx), .csv, .txt y .json, incluyendo modo de carga histórica 90d
    (`modo_historico_abc=True`) para clasificación ABC Día 1 sin descontar SATOs.
    Si `allow_bodega_fallback` no se envía, aplica la política global del local (`Tenant.settings`).
    """
    content = await file.read(MAX_SALES_FILE_BYTES + 1)
    if len(content) > MAX_SALES_FILE_BYTES:
        raise HTTPException(status_code=413, detail="El archivo supera el máximo de 5 MB.")

    try:
        tickets, errores_parseo = parsear_archivo_ventas_legacy(
            content,
            file.filename or "",
            pos_source=pos_source.strip(),
            allow_bodega_fallback=allow_bodega_fallback,
            modo_historico_abc=modo_historico_abc,
            content_type=file.content_type,
        )
    except VentaExternaError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))

    if not tickets:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"mensaje": "El archivo no contiene ventas válidas.", "errores_parseo": errores_parseo[:50]},
        )

    try:
        resultado = procesar_lote_ventas_externas(
            db,
            tickets,
            pos_source=pos_source.strip(),
            canal="ARCHIVO",
            user_id=_user_id(user),
            errores_parseo=errores_parseo,
        )
    except Exception:
        logger.exception("[sales/import-file] Error inesperado")
        raise HTTPException(status_code=500, detail="Error interno importando el archivo de ventas.")

    if resultado["tickets_procesados"] > 0:
        _recalcular_abc_y_purgar_caches(db)
    return resultado


# ── Bandeja de Cuarentena de SKUs Huérfanos ──────────────────────────────

@router.get(
    "/sales/orphans",
    response_model=List[OrphanCodeGroupItem],
    summary="Listar códigos EAN/SKU en cuarentena pendientes de vincular",
)
def get_orphan_sales_codes(
    db: Session = Depends(get_db_read),
    user=Depends(get_current_user),
):
    return listar_huerfanos_pendientes(db)


@router.post(
    "/sales/orphans/resolve",
    response_model=ResolveOrphanResponse,
    summary="[Admin] Vincular o crear producto para un código en cuarentena y aplicar descuento retroactivo",
)
def post_resolve_orphan_sales_code(
    payload: ResolveOrphanRequest,
    db: Session = Depends(get_db),
    user=Depends(require_role("Admin", "Supervisor")),
):
    try:
        resultado = resolver_huerfano_retroactivo(db, payload, user_id=_user_id(user))
        db.commit()
    except ProductoNoEncontradoError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except VentaExternaError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except Exception:
        db.rollback()
        logger.exception("[sales/orphans/resolve] Error inesperado")
        raise HTTPException(status_code=500, detail="Error interno resolviendo código en cuarentena.")

    _recalcular_abc_y_purgar_caches(db)
    return resultado


# ── Inspector de Boleta (Drill-Down) y Reversión Total ───────────────────

@router.get(
    "/sales/{venta_id}/detalle",
    response_model=ExternalSaleTicketDetailResponse,
    summary="Obtener desglose completo de productos, lotes FEFO y cuarentena de una boleta",
)
def get_detalle_boleta_externa(
    venta_id: int,
    db: Session = Depends(get_db_read),
    user=Depends(get_current_user),
):
    try:
        return obtener_detalle_venta_externa(db, venta_id)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))


@router.post(
    "/sales/{venta_id}/revertir",
    response_model=RevertirVentaResponse,
    summary="[Admin] Anular / Revertir boleta externa y restituir stock a los lotes SATO originales",
)
def post_revertir_boleta_externa(
    venta_id: int,
    payload: RevertirVentaRequest,
    db: Session = Depends(get_db),
    user=Depends(require_role("Admin", "Supervisor")),
):
    try:
        resultado = revertir_venta_externa(
            db=db,
            venta_id=venta_id,
            motivo=payload.motivo,
            user_id=_user_id(user),
            user_nombre=getattr(user, "nombre", None),
        )
        db.commit()
    except LookupError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except VentaExternaError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    except Exception:
        db.rollback()
        logger.exception("[sales/revertir] Error inesperado revirtiendo boleta %s", venta_id)
        raise HTTPException(status_code=500, detail="Error interno revirtiendo la boleta.")

    _recalcular_abc_y_purgar_caches(db)
    return resultado


# ── Historial de Ventas Externas Sincronizadas (CQRS Read Replica) ───────

@router.get(
    "/sales/history",
    response_model=List[ExternalSaleHistoryItem],
    summary="Consultar historial de ventas externas recibidas (Omni-POS)",
)
def listar_historial_ventas_externas(
    canal: Optional[str] = Query(None, description="Filtrar por canal: WEBHOOK_API, ARCHIVO, BATCH_JSON"),
    limit: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db_read),
    user=Depends(get_current_user),
):
    """
    Retorna los últimos tickets de venta recibidos desde puntos de venta externos
    para el tenant activo (enrutado a Read Replica).
    """
    query = db.query(Venta_Externa).order_by(Venta_Externa.id.desc())
    if canal:
        query = query.filter(Venta_Externa.canal == canal.upper())

    ventas = query.limit(limit).all()
    return [
        ExternalSaleHistoryItem(
            id=v.id,
            pos_source=v.pos_source,
            external_ticket_id=v.external_ticket_id,
            canal=v.canal,
            estado_procesamiento=v.estado_procesamiento or "COMPLETO",
            items_huerfanos_count=int(v.items_huerfanos_count or 0),
            total_unidades=v.total_unidades,
            unidades_deficit=v.unidades_deficit or 0,
            total_valorizado=v.total_valorizado or 0,
            es_carga_historica=bool(v.es_carga_historica),
            fecha_venta_origen=v.fecha_venta_origen,
            fecha_recepcion=v.fecha_recepcion.isoformat() if v.fecha_recepcion else None,
            revertido_por=v.revertido_por,
            revertido_at=v.revertido_at.isoformat() if v.revertido_at else None,
            motivo_reversion=v.motivo_reversion,
        )
        for v in ventas
    ]
