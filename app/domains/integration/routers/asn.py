import logging
from fastapi import APIRouter, HTTPException, Depends

from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas import AsnInyeccionRequest
from app.core.security import require_role
from app.services.integration_service import procesar_asn_inbound

logger = logging.getLogger("sg-wms.asn")

router = APIRouter(
    prefix="/asn",
    tags=["Integración ASN"]
)


@router.post("/inyeccion", status_code=201)
def inyectar_asn(
    payload: AsnInyeccionRequest,
    db: Session = Depends(get_db),
    user=Depends(require_role("Admin", "Supervisor", "Operario")),
):
    """
    Inyecta un ASN en la base de datos de forma atómica delegando en `procesar_asn_inbound`.
    Implementa el patrón de 'Ghost SKUs' para evitar fallos de llaves foráneas
    si el producto no existe en el catálogo maestro.
    """
    try:
        return procesar_asn_inbound(db, payload.model_dump())
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        db.rollback()
        logger.exception("Error inesperado al inyectar ASN")
        raise HTTPException(status_code=500, detail="Error interno al inyectar el ASN.")
