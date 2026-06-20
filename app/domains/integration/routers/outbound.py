from typing import Any
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy.orm import Session
from app.database import get_db
from app.schemas import GenerarOlaRequest, OlaPickingResponse, CompletarTareaRequest
from app.services.outbound_service import (
    generar_ola_picking, obtener_tareas_ola, completar_tarea_picking, registrar_faltante_tarea, obtener_olas_activas, OutboundError
)
from app.core.security import get_current_user

router = APIRouter(prefix="/outbound", tags=["Outbound & Picking"])

@router.get("/waves")
def listar_olas(db: Session = Depends(get_db)):
    """Lista todas las olas de picking."""
    return obtener_olas_activas(db)

@router.post("/waves/generar")
def generar_ola(request: GenerarOlaRequest, db: Session = Depends(get_db), current_user: Any = Depends(get_current_user)):
    """Genera una Ola de Picking reservando SATOs con lógica FEFO."""
    try:
        user_id = getattr(current_user, "id", None) if current_user else None
        return generar_ola_picking(db, request.pedido_ids, user_id=user_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/waves/{ola_id}/tareas", response_model=OlaPickingResponse)
def listar_tareas_ola(ola_id: int, db: Session = Depends(get_db)):
    """Obtiene las tareas de la Ola, ordenadas usando Path Optimization."""
    try:
        return obtener_tareas_ola(db, ola_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/tareas/{tarea_id}/completar")
def completar_tarea(tarea_id: int, request: CompletarTareaRequest, db: Session = Depends(get_db), current_user: Any = Depends(get_current_user)):
    """Completa una tarea escaneando el producto físico (EAN)."""
    try:
        user_id = getattr(current_user, "id", None) if current_user else None
        return completar_tarea_picking(db, tarea_id, request.ean_escaneado, user_id=user_id)
    except OutboundError as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/tareas/{tarea_id}/faltante")
def reportar_faltante(tarea_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db), current_user: Any = Depends(get_current_user)):
    """Registra una merma operativa (Short-Pick) cuando no se encuentra el producto en la góndola."""
    try:
        user_id = getattr(current_user, "id", None) if current_user else None
        return registrar_faltante_tarea(db, tarea_id, background_tasks, user_id=user_id)
    except OutboundError as e:
        raise HTTPException(status_code=400, detail=str(e))
