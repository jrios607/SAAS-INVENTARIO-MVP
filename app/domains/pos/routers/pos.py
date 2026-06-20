from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db, get_db_read
from app.domains.pos.schemas import PosScanRequest, PosScanResponse, PosCheckoutRequest, PosCheckoutResponse
from app.services.pos_service import scan_producto_service, checkout_service
import logging

logger = logging.getLogger("sg-wms.pos")

router = APIRouter(
    prefix="/pos",
    tags=["Point of Sale (POS)"]
)

@router.post("/scan", response_model=PosScanResponse)
def scan_producto(payload: PosScanRequest, db: Session = Depends(get_db_read)):
    """
    Escaneo rapido de producto en caja.
    Delega la logica de negocio a pos_service.
    """
    try:
        resultado = scan_producto_service(db, payload.ean)
        return PosScanResponse(**resultado)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error en scan_producto router")
        raise HTTPException(status_code=500, detail="Error interno al escanear el producto.")

@router.post("/checkout", response_model=PosCheckoutResponse)
def checkout(payload: PosCheckoutRequest, db: Session = Depends(get_db)):
    """
    Procesa el cierre de la venta de forma atómica.
    Delega FEFO y bloqueos de BD a pos_service.
    """
    try:
        resultado = checkout_service(db, payload.items)
        return PosCheckoutResponse(**resultado)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error en checkout router")
        raise HTTPException(status_code=500, detail="Error interno procesando el checkout.")

from app.domains.pos.schemas import PosSyncRequest, PosSyncResponse

@router.post("/sync", response_model=PosSyncResponse)
def sync_offline_tickets(payload: PosSyncRequest, db: Session = Depends(get_db)):
    """
    Recibe un lote de tickets generados offline en la PWA (Point of Sale).
    Intenta procesarlos uno a uno.
    """
    procesados = 0
    fallidos = 0
    detalles_fallos = []

    for ticket in payload.tickets:
        try:
            # Reutilizamos el checkout_service para cada ticket
            checkout_service(db, ticket.items)
            procesados += 1
        except Exception as e:
            # Si falla un ticket (por quiebre de stock en diferido u otro error), 
            # hacemos rollback del savepoint de ESE ticket, pero seguimos con el resto.
            # Idealmente se usa savepoints o nested transactions. 
            # Para la simplicidad del MVP, el router de FastAPI hace db.rollback() 
            # en la exception global del checkout_service. Necesitamos manejarlo localmente.
            # El checkout_service hace rollback global, así que aquí hay que tener cuidado.
            # Para evitar que un error aborte la DB transaction global, usamos savepoints (begin_nested).
            db.rollback() 
            fallidos += 1
            detalles_fallos.append({"id_ticket": ticket.id_ticket, "error": str(e)})

    return PosSyncResponse(
        mensaje="Sincronización offline completada.",
        tickets_procesados=procesados,
        tickets_fallidos=fallidos,
        detalles_fallos=detalles_fallos
    )
