import uuid
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from datetime import date
from typing import Optional

from app.database import get_db
from app.core.security import get_current_user, require_role
from app.services.trazabilidad_service import get_logs_service, get_arbol_sato_service

router = APIRouter(
    prefix="/logs",
    tags=["Trazabilidad y Logs"]
)

@router.get("/")
def get_logs(
    q: Optional[str] = Query(None, description="Búsqueda por LPN o SKU", max_length=100), # MEDIO-07
    accion: Optional[str] = None,
    fecha_inicio: Optional[date] = None,
    fecha_fin: Optional[date] = None,
    limit: int = 50,
    offset: int = 0,
    db: Session = Depends(get_db),
    user = Depends(get_current_user)
):
    """
    Obtiene el historial transaccional con filtros opcionales.
    """
    try:
        return get_logs_service(db, q, accion, fecha_inicio, fecha_fin, limit, offset)
    except Exception as e:
        import logging
        logging.exception("Error inesperado en get_logs")
        raise HTTPException(status_code=500, detail="Error interno del servidor.")

@router.get("/sato/{sato_id}/arbol")
def get_arbol_sato(sato_id: uuid.UUID, db: Session = Depends(get_db), user = Depends(get_current_user)):
    """
    Obtiene el árbol genealógico completo de un SATO.
    """
    try:
        return get_arbol_sato_service(db, sato_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        import logging
        logging.exception("Error inesperado en get_arbol_sato")
        raise HTTPException(status_code=500, detail="Error interno del servidor.")
