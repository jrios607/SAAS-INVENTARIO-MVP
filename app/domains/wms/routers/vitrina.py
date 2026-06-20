import uuid
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.schemas import SatoFraccionarRequest, SatoFraccionarResponse, SatoMoverVitrinaRequest, SatoMoverVitrinaResponse
from app.core.security import get_current_user, require_role
from app.services.inventario_service import fraccionar_sato, mover_a_vitrina, InventarioError

router = APIRouter(prefix="/vitrina", tags=["Vitrina"])

@router.post("/fraccionar", response_model=SatoFraccionarResponse)
def route_fraccionar_sato(request: SatoFraccionarRequest, db: Session = Depends(get_db), user = Depends(require_role("Operario", "Admin", "Supervisor"))):
    user_id = getattr(user, "id", None)
    try:
        resultado = fraccionar_sato(db, request.sato_padre_id, request.cantidad_a_mover, request.planograma_destino_id, user_id=user_id)
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
    try:
        resultado = mover_a_vitrina(db, sato_id, request.id_patente, request.nivel_estante, request.frente_posicion, user_id=user_id)
        return SatoMoverVitrinaResponse(**resultado)
    except InventarioError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        import logging
        logging.exception("Error inesperado en mover_a_vitrina")
        raise HTTPException(status_code=500, detail="Error interno del servidor.")
