from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.database import get_db
from app.schemas import TrazabilidadLoteResponse
from app.services.trazabilidad_service import buscar_por_lote
from app.core.security import require_role

router = APIRouter(
    prefix="/trazabilidad",
    tags=["Trazabilidad - Lotes"]
)

@router.get("/lote/{numero_lote}", response_model=TrazabilidadLoteResponse)
def route_buscar_por_lote(numero_lote: str, db: Session = Depends(get_db), user = Depends(require_role("Admin", "Supervisor"))):
    """
    Busca en qué SATOs (y en qué góndolas/bodegas actuales) se encuentra 
    físicamente distribuido un lote específico.
    """
    resultado = buscar_por_lote(db, numero_lote)
    return TrazabilidadLoteResponse(**resultado)
