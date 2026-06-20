from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas import MermaRequest, MermaResponse
from app.core.security import get_current_user, require_role
from app.services.inventario_service import declarar_merma, InventarioError

router = APIRouter(
    prefix="/merma",
    tags=["Merma"]
)

@router.post("/declarar", response_model=MermaResponse, status_code=status.HTTP_201_CREATED)
def route_declarar_merma(request: MermaRequest, db: Session = Depends(get_db), user = Depends(require_role("Admin", "Supervisor"))):
    user_id = getattr(user, "id", None)
    try:
        resultado = declarar_merma(db, request.sato_id, request.cantidad, request.motivo, request.comentarios, user_id=user_id)
        return MermaResponse(**resultado)
    except InventarioError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        import logging
        logging.exception("Error inesperado en declarar_merma")
        raise HTTPException(status_code=500, detail="Error interno del servidor.")
