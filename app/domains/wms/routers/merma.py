import logging
from typing import List
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database import get_db, get_db_read
from app.schemas import (
    MermaRequest,
    MermaResponse,
    MermaRapidaRequest,
    MermaRapidaResponse,
    MermaHistorialItem,
)
from app.core.security import get_current_user, require_role
from app.services.inventario_service import (
    declarar_merma,
    declarar_merma_rapida,
    listar_historial_mermas,
    InventarioError,
)
from app.services.catalogo_service import invalidar_cache_catalogo
from app.core.cache import (
    invalidar_stock_y_kpis,
    invalidar_catalogo_completo,
    invalidar_abc,
    invalidar_planograma_patente,
)

logger = logging.getLogger("sg-wms.merma")

router = APIRouter(
    prefix="/merma",
    tags=["Merma"],
)


@router.post("/declarar", response_model=MermaResponse, status_code=status.HTTP_201_CREATED)
def route_declarar_merma(
    request: MermaRequest,
    db: Session = Depends(get_db),
    user=Depends(require_role("Admin", "Supervisor")),
):
    user_id = getattr(user, "id", None)
    try:
        resultado = declarar_merma(
            db,
            request.sato_id,
            request.cantidad,
            request.motivo,
            request.comentarios,
            user_id=user_id,
        )
        invalidar_stock_y_kpis()
        return MermaResponse(**resultado)
    except InventarioError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        db.rollback()
        logger.exception("Error inesperado en declarar_merma")
        raise HTTPException(status_code=500, detail="Error interno del servidor.")


@router.post("/rapida", response_model=MermaRapidaResponse, status_code=status.HTTP_201_CREATED)
def route_declarar_merma_rapida(
    payload: MermaRapidaRequest,
    db: Session = Depends(get_db),
    user=Depends(require_role("Admin", "Supervisor", "Operario")),
):
    """
    Declara merma rápida en 3 toques por SKU, EAN o lote SATO específico,
    descontando stock automáticamente con orden FEFO determinista y bloqueo pesimista.
    """
    user_id = getattr(user, "id", None)
    try:
        resultado = declarar_merma_rapida(db, payload, user_id=user_id)
        invalidar_stock_y_kpis()
        invalidar_catalogo_completo()
        invalidar_cache_catalogo()
        invalidar_abc()

        ubicaciones_afectadas = {
            s.ubicacion_id for s in resultado.satos_afectados if s.ubicacion_id
        }
        if payload.ubicacion_id:
            ubicaciones_afectadas.add(payload.ubicacion_id)
        if resultado.ubicacion_id:
            ubicaciones_afectadas.add(resultado.ubicacion_id)
        for ubic in ubicaciones_afectadas:
            invalidar_planograma_patente(ubic)

        return resultado
    except LookupError as e:
        db.rollback()
        raise HTTPException(status_code=404, detail=str(e))
    except (InventarioError, ValueError) as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        db.rollback()
        logger.exception("Error inesperado en route_declarar_merma_rapida")
        raise HTTPException(status_code=500, detail="Error interno del servidor.")


@router.get("/historial", response_model=List[MermaHistorialItem])
def route_listar_historial_mermas(
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db_read),
    user=Depends(get_current_user),
):
    """Lista las últimas mermas declaradas en el local."""
    try:
        return listar_historial_mermas(db, limit=limit)
    except Exception:
        logger.exception("Error inesperado en route_listar_historial_mermas")
        raise HTTPException(status_code=500, detail="Error interno del servidor.")
