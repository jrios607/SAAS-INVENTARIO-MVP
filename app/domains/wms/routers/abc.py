"""
app/domains/wms/routers/abc.py
─────────────────────────────────────────────────────────────────────────────
Router Thin — Motor ABC Dinámico, Zonas Calientes 2D y Anomalías de Stock
─────────────────────────────────────────────────────────────────────────────
Endpoints (expuestos en `/abc/*` y `/api/v1/abc/*`):
  GET  /abc/config                → Configuración ABC del tenant (Read Replica, sin INSERT)
  PUT  /abc/config                → Actualizar parámetros ABC + Recalcular + Invalidar caché
  POST /abc/recalcular            → Forzar recálculo ABC sobre ventana W días
  GET  /abc/zonas-patentes        → Zonas Térmicas ABC por Patente (Cache-Aside Redis)
  POST /abc/discrepancia-vitrina  → Reportar góndola vacía / discrepancia física en sala
  GET  /abc/anomalias             → Listar anomalías de stock (VENTA_SIN_STOCK / DISCREPANCIA_VITRINA)
"""

import logging
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.cache import (
    CacheKeys,
    TTL_ABC_ZONAS,
    cache_get,
    cache_set,
    invalidar_abc,
    invalidar_catalogo_completo,
    invalidar_stock_y_kpis,
)
from app.core.security import get_current_user, require_role
from app.database import get_db, get_db_read
from app.schemas import (
    AbcPlanoResumenResponse,
    AbcRecalculoResponse,
    AnomaliaStockResponse,
    ConfigConteoResponse,
    ConfigConteoUpdate,
    DiscrepanciaVitrinaRequest,
)
from app.services.abc_service import (
    actualizar_config_conteo,
    calcular_zonas_calientes_patentes,
    listar_anomalias_stock,
    obtener_config_conteo_lectura,
    recalcular_clasificacion_abc,
    registrar_discrepancia_vitrina,
)
from app.services.catalogo_service import invalidar_cache_catalogo

logger = logging.getLogger("sg-wms.abc.router")

router = APIRouter(
    prefix="/abc",
    tags=["Motor ABC y Zonas Calientes"],
)


def _invalidar_ecosistema_abc() -> None:
    invalidar_abc()
    invalidar_stock_y_kpis()
    invalidar_catalogo_completo()
    invalidar_cache_catalogo()


@router.get("/config", response_model=ConfigConteoResponse)
def get_abc_config(
    db: Session = Depends(get_db_read),
    user=Depends(get_current_user),
):
    """
    Obtiene los parámetros de ventana W y umbrales ABC del tenant activo.
    Enrutado a Read Replica: no realiza INSERT si el tenant usa valores por defecto.
    """
    try:
        return obtener_config_conteo_lectura(db)
    except Exception:
        logger.exception("Error inesperado en get_abc_config")
        raise HTTPException(status_code=500, detail="Error interno al consultar configuración ABC.")


@router.put("/config", response_model=ConfigConteoResponse)
def put_abc_config(
    payload: ConfigConteoUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_role("Admin", "Supervisor")),
):
    """
    Actualiza la configuración ABC/Conteo del tenant, recalcula inmediatamente
    la clasificación ABC del catálogo e invalida la caché del tenant.
    """
    try:
        cfg_resp = actualizar_config_conteo(db, payload)
        recalcular_clasificacion_abc(db)
        db.commit()
        _invalidar_ecosistema_abc()
        return cfg_resp
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except Exception:
        db.rollback()
        logger.exception("Error inesperado en put_abc_config")
        raise HTTPException(status_code=500, detail="Error interno al actualizar configuración ABC.")


@router.post("/recalcular", response_model=AbcRecalculoResponse)
def post_recalcular_abc(
    db: Session = Depends(get_db),
    user=Depends(require_role("Admin", "Supervisor")),
):
    """
    Ejecuta el recálculo Pareto ABC completo sobre la ventana móvil W días
    del tenant activo e invalida todas las vistas cacheadas dependientes.
    """
    try:
        resultado = recalcular_clasificacion_abc(db)
        db.commit()
        _invalidar_ecosistema_abc()
        return resultado
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except Exception:
        db.rollback()
        logger.exception("Error inesperado en post_recalcular_abc")
        raise HTTPException(status_code=500, detail="Error interno al recalcular clasificación ABC.")


@router.get("/zonas-patentes", response_model=AbcPlanoResumenResponse)
def get_zonas_calientes_patentes(
    db: Session = Depends(get_db_read),
    user=Depends(get_current_user),
):
    """
    Retorna el mapa térmico ABC por Patente para el Gemelo Digital 2D de Sala de Ventas.
    Cacheado en Redis por tenant (`CacheKeys.ABC_ZONAS_PATENTES`, TTL=300s).
    """
    cached = cache_get(CacheKeys.ABC_ZONAS_PATENTES)
    if cached is not None:
        return cached

    try:
        resumen = calcular_zonas_calientes_patentes(db)
        cache_set(
            CacheKeys.ABC_ZONAS_PATENTES,
            resumen.model_dump(mode="json"),
            ttl=TTL_ABC_ZONAS,
        )
        return resumen
    except Exception:
        logger.exception("Error inesperado en get_zonas_calientes_patentes")
        raise HTTPException(status_code=500, detail="Error interno al calcular zonas térmicas ABC.")


@router.post(
    "/discrepancia-vitrina",
    response_model=AnomaliaStockResponse,
    status_code=status.HTTP_201_CREATED,
)
def post_discrepancia_vitrina(
    payload: DiscrepanciaVitrinaRequest,
    db: Session = Depends(get_db),
    user=Depends(require_role("Admin", "Supervisor", "Operario")),
):
    """
    Registra un reporte operativo de discrepancia física en sala de ventas
    (ej. góndola vacía con stock teórico > 0) e invalida la caché ABC.
    """
    user_id = getattr(user, "id", None) if user is not None else None
    try:
        anomalia = registrar_discrepancia_vitrina(
            db=db,
            sku=payload.sku,
            ubicacion_id=payload.ubicacion_id,
            detalles=payload.detalles,
            user_id=user_id,
        )
        db.commit()
        invalidar_abc()
        return anomalia
    except LookupError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except Exception:
        db.rollback()
        logger.exception("Error inesperado en post_discrepancia_vitrina")
        raise HTTPException(status_code=500, detail="Error interno al registrar discrepancia en vitrina.")


@router.get("/anomalias", response_model=List[AnomaliaStockResponse])
def get_anomalias_stock(
    solo_abiertas: bool = Query(True, description="Si es True, filtra solo anomalías en estado ABIERTA"),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db_read),
    user=Depends(get_current_user),
):
    """
    Lista las anomalías de stock (`VENTA_SIN_STOCK` y `DISCREPANCIA_VITRINA`)
    del tenant activo (enrutado a Read Replica).
    """
    try:
        return listar_anomalias_stock(db, solo_abiertas=solo_abiertas, limit=limit)
    except Exception:
        logger.exception("Error inesperado en get_anomalias_stock")
        raise HTTPException(status_code=500, detail="Error interno al listar anomalías de stock.")
