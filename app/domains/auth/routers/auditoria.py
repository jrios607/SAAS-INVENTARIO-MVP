from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from datetime import datetime, timezone
from typing import List

from app.database import get_db
from app.models import Sato, Log_Transaccional
from app.schemas import SatoModel
from app.core.security import get_current_user, require_role

router = APIRouter(
    prefix="/auditoria",
    tags=["Auditoría de Cíclicos"]
)

@router.get("/vencimientos", response_model=List[SatoModel])
def route_get_vencimientos(dias_alerta: int = 7, db: Session = Depends(get_db), user = Depends(get_current_user)):
    """
    Obtiene los SATOs que están por vencer o ya vencidos.
    """
    try:
        from datetime import timedelta
        fecha_limite = datetime.now(timezone.utc).date() + timedelta(days=dias_alerta)
        
        satos = db.query(Sato).filter(
            Sato.fecha_vencimiento <= fecha_limite,
            Sato.cantidad > 0,
            Sato.estado != "Vendido"
        ).order_by(Sato.fecha_vencimiento.asc()).all()
        
        return satos
    except Exception as e:
        import logging
        logging.exception("Error inesperado en get_vencimientos")
        raise HTTPException(status_code=500, detail="Error interno del servidor.")
