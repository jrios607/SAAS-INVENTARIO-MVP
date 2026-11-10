import uuid
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.schemas import SatoFraccionarRequest, SatoFraccionarResponse, SatoMoverVitrinaRequest, SatoMoverVitrinaResponse
from app.core.security import get_current_user, require_role
from app.services.inventario_service import fraccionar_sato, mover_a_vitrina, InventarioError
from app.core.cache import invalidar_stock_y_kpis, invalidar_planograma_patente

router = APIRouter(prefix="/vitrina", tags=["Vitrina"])

@router.post("/fraccionar", response_model=SatoFraccionarResponse)
def route_fraccionar_sato(request: SatoFraccionarRequest, db: Session = Depends(get_db), user = Depends(require_role("Operario", "Admin", "Supervisor"))):
    user_id = getattr(user, "id", None)
    try:
        resultado = fraccionar_sato(
            db,
            request.sato_padre_id,
            request.cantidad_a_mover,
            request.planograma_destino_id,
            nivel_estante=request.nivel_estante or 1,
            frente_posicion=request.frente_posicion or 1,
            user_id=user_id
        )
        invalidar_stock_y_kpis()
        if request.planograma_destino_id:
            invalidar_planograma_patente(request.planograma_destino_id)
        return SatoFraccionarResponse(**resultado)
    except InventarioError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        import logging
        logging.exception("Error inesperado en fraccionar_sato")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Error interno del servidor.")

@router.put("/{sato_id}/mover_a_vitrina", response_model=SatoMoverVitrinaResponse)
def route_mover_a_vitrina(sato_id: uuid.UUID, request: SatoMoverVitrinaRequest, db: Session = Depends(get_db), user = Depends(require_role("Operario", "Admin", "Supervisor"))):
    user_id = getattr(user, "id", None)
    cant = request.cantidad_a_mover if request.cantidad_a_mover is not None else request.cantidad
    try:
        resultado = mover_a_vitrina(
            db,
            sato_id,
            request.id_patente,
            request.nivel_estante or 1,
            request.frente_posicion or 1,
            cantidad_a_mover=cant,
            user_id=user_id
        )
        invalidar_stock_y_kpis()
        invalidar_planograma_patente(request.id_patente)
        return SatoMoverVitrinaResponse(**resultado)
    except InventarioError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        import logging
        logging.exception("Error inesperado en mover_a_vitrina")
        raise HTTPException(status_code=500, detail="Error interno del servidor.")

@router.post("/mover-sato", response_model=SatoMoverVitrinaResponse)
def route_mover_sato_post(request: SatoMoverVitrinaRequest, db: Session = Depends(get_db), user = Depends(require_role("Operario", "Admin", "Supervisor"))):
    if not request.sato_id:
        raise HTTPException(status_code=400, detail="sato_id es requerido en el cuerpo de la petición")
    user_id = getattr(user, "id", None)
    cant = request.cantidad_a_mover if request.cantidad_a_mover is not None else request.cantidad
    try:
        resultado = mover_a_vitrina(
            db,
            request.sato_id,
            request.id_patente,
            request.nivel_estante or 1,
            request.frente_posicion or 1,
            cantidad_a_mover=cant,
            user_id=user_id
        )
        invalidar_stock_y_kpis()
        invalidar_planograma_patente(request.id_patente)
        return SatoMoverVitrinaResponse(**resultado)
    except InventarioError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        import logging
        logging.exception("Error inesperado en mover_sato_post")
        raise HTTPException(status_code=500, detail="Error interno del servidor.")
