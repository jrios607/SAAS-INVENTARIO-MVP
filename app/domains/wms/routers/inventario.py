from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.database import get_db
from app.schemas import AlertaVencimientoResponse
from app.services.inventario_service import get_alertas_vencimiento
from app.core.security import require_role

router = APIRouter(
    prefix="/inventario",
    tags=["Inventario - Alertas FEFO"]
)

@router.get("/alertas-vencimiento", response_model=AlertaVencimientoResponse)
def route_get_alertas_vencimiento(dias_alerta: int = 7, db: Session = Depends(get_db), user = Depends(require_role("Operario", "Admin", "Supervisor"))):
    """
    Escanea todos los SATOs en estado 'Vitrina' o 'Bodega' y retorna aquellos
    que estén a 'dias_alerta' de vencer.
    """
    resultado = get_alertas_vencimiento(db, dias_alerta)
    return AlertaVencimientoResponse(**resultado)
