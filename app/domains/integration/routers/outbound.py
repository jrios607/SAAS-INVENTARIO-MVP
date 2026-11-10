import logging
from typing import Any
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy.orm import Session
from app.database import get_db, get_db_read
from app.schemas import GenerarOlaRequest, OlaPickingResponse, CompletarTareaRequest
from app.services.outbound_service import (
    generar_ola_picking, obtener_tareas_ola, completar_tarea_picking, registrar_faltante_tarea, obtener_olas_activas, OutboundError
)
from app.core.security import get_current_user, require_role
from app.core.cache import invalidar_stock_y_kpis

logger = logging.getLogger("sg-wms.outbound")

router = APIRouter(prefix="/outbound", tags=["Outbound & Picking"])

@router.get("/waves")
def listar_olas(
    db: Session = Depends(get_db_read),
    current_user: Any = Depends(get_current_user),
):
    """Lista todas las olas de picking."""
    return obtener_olas_activas(db)

@router.post("/waves/generar")
def generar_ola(
    request: GenerarOlaRequest,
    db: Session = Depends(get_db),
    current_user: Any = Depends(require_role("Admin", "Supervisor")),
):
    """Genera una Ola de Picking reservando SATOs con lógica FEFO."""
    try:
        user_id = getattr(current_user, "id", None) if current_user else None
        res = generar_ola_picking(db, request.pedido_ids, user_id=user_id)
        invalidar_stock_y_kpis()
        return res
    except OutboundError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        logger.exception("Error inesperado en generar_ola")
        raise HTTPException(status_code=500, detail="Error interno al generar la ola de picking.")

@router.get("/waves/{ola_id}/tareas", response_model=OlaPickingResponse)
def listar_tareas_ola(
    ola_id: int,
    db: Session = Depends(get_db_read),
    current_user: Any = Depends(get_current_user),
):
    """Obtiene las tareas de la Ola, ordenadas usando Path Optimization."""
    try:
        return obtener_tareas_ola(db, ola_id)
    except OutboundError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        logger.exception("Error inesperado en listar_tareas_ola")
        raise HTTPException(status_code=500, detail="Error interno al consultar tareas de la ola.")

@router.post("/tareas/{tarea_id}/completar")
def completar_tarea(
    tarea_id: int,
    request: CompletarTareaRequest,
    db: Session = Depends(get_db),
    current_user: Any = Depends(require_role("Admin", "Supervisor", "Operario")),
):
    """Completa una tarea escaneando el producto físico (EAN)."""
    try:
        user_id = getattr(current_user, "id", None) if current_user else None
        res = completar_tarea_picking(db, tarea_id, request.ean_escaneado, user_id=user_id)
        invalidar_stock_y_kpis()
        return res
    except OutboundError as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/tareas/{tarea_id}/faltante")
def reportar_faltante(
    tarea_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Any = Depends(require_role("Admin", "Supervisor", "Operario")),
):
    """Registra una merma operativa (Short-Pick) cuando no se encuentra el producto en la góndola."""
    try:
        user_id = getattr(current_user, "id", None) if current_user else None
        res = registrar_faltante_tarea(db, tarea_id, background_tasks, user_id=user_id)
        invalidar_stock_y_kpis()
        return res
    except OutboundError as e:
        raise HTTPException(status_code=400, detail=str(e))
