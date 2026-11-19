import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.cache import (
    invalidar_catalogo_completo,
    invalidar_planograma_patente,
    invalidar_stock_y_kpis,
)
from app.core.security import get_current_user, require_role
from app.database import get_db, get_db_read
from app.schemas import (
    AlertaVencimientoResponse,
    LiquidacionSatoRequest,
    LiquidacionSatoResponse,
)
from app.services.catalogo_service import invalidar_cache_catalogo
from app.services.inventario_service import (
    InventarioError,
    configurar_liquidacion_sato,
    get_alertas_vencimiento,
)

logger = logging.getLogger("sg-wms.inventario")

router = APIRouter(
    prefix="/inventario",
    tags=["Inventario - Alertas FEFO"]
)

@router.get("/alertas-vencimiento", response_model=AlertaVencimientoResponse)
def route_get_alertas_vencimiento(dias_alerta: int = 7, db: Session = Depends(get_db_read), user = Depends(get_current_user)):
    """
    Escanea todos los SATOs en estado 'Vitrina' o 'Bodega' y retorna aquellos
    que estén a 'dias_alerta' de vencer.
    """
    resultado = get_alertas_vencimiento(db, dias_alerta)
    return AlertaVencimientoResponse(**resultado)


@router.post("/satos/{sato_id}/liquidacion", response_model=LiquidacionSatoResponse)
def route_configurar_liquidacion_sato(
    sato_id: uuid.UUID,
    payload: LiquidacionSatoRequest,
    db: Session = Depends(get_db),
    user=Depends(require_role("Admin", "Supervisor", "Operario")),
):
    """
    Marca o retira un lote (Sato) en estado de liquidación/remate sin alterar su
    `Sato.estado` (`Vitrina`/`Bodega`), permitiendo venderlo antes de declararlo merma.
    """
    user_id = getattr(user, "id", None) if user is not None else None
    try:
        resultado = configurar_liquidacion_sato(
            db=db,
            sato_id=sato_id,
            en_liquidacion=payload.en_liquidacion,
            precio_liquidacion=payload.precio_liquidacion,
            descuento_pct=payload.descuento_pct,
            motivo=payload.motivo,
            user_id=user_id,
        )
        ubicacion_id = resultado.pop("ubicacion_id", None)
        db.commit()
        invalidar_stock_y_kpis()
        invalidar_catalogo_completo()
        invalidar_cache_catalogo()
        if ubicacion_id:
            invalidar_planograma_patente(ubicacion_id)
        return LiquidacionSatoResponse(**resultado)
    except LookupError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except (InventarioError, ValueError) as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except Exception:
        db.rollback()
        logger.exception("Error inesperado en route_configurar_liquidacion_sato")
        raise HTTPException(status_code=500, detail="Error interno al configurar liquidación del lote.")
