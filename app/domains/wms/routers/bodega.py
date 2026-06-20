import uuid
from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Sato
from app.schemas import PalletReceptionRequest, PalletReceptionResponse, LpnReceptionRequest, LpnReceptionResponse, AjusteInventarioRequest, SatoRecepcionDetalle
from app.core.security import get_current_user, require_role
from app.services.recepcion_service import recepcionar_pallet, recepcionar_lpn, get_satos_en_recepcion, DuplicateLPNError
from app.services.inventario_service import ajustar_inventario_sato, InventarioError

router = APIRouter(
    prefix="/bodega",
    tags=["Bodega - Recepción"]
)

@router.post("/recepcion/pallet", response_model=PalletReceptionResponse, status_code=201)
def route_recepcionar_pallet(payload: PalletReceptionRequest, db: Session = Depends(get_db), user = Depends(require_role("Operario", "Admin", "Supervisor"))):
    user_id = getattr(user, "id", None)
    try:
        resultado = recepcionar_pallet(db, payload.barcode_text, ubicacion_id=payload.ubicacion_id, user_id=user_id)
        return PalletReceptionResponse(**resultado)
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        import logging
        logging.exception("Error inesperado en recepcionar_pallet")
        raise HTTPException(status_code=500, detail="Error interno del servidor.")

@router.get("/recepcion/satos", response_model=list[SatoRecepcionDetalle])
def route_get_satos_en_recepcion(db: Session = Depends(get_db)):
    return get_satos_en_recepcion(db)

@router.post("/satos/{sato_id}/ajuste")
def route_ajustar_inventario(sato_id: str, payload: AjusteInventarioRequest, db: Session = Depends(get_db), user = Depends(require_role("Admin", "Supervisor"))):
    user_id = getattr(user, "id", None)
    try:
        return ajustar_inventario_sato(
            db=db,
            sato_id=sato_id,
            cantidad_a_restar=payload.cantidad_a_restar,
            motivo=payload.motivo,
            url_foto=payload.url_foto,
            user_id=user_id
        )
    except InventarioError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        import logging
        logging.exception("Error inesperado en ajustar_inventario_sato")
        raise HTTPException(status_code=500, detail="Error interno del servidor.")

@router.post("/recepcion/lpn", response_model=LpnReceptionResponse, status_code=201)
def route_recepcionar_lpn(request: LpnReceptionRequest, background_tasks: BackgroundTasks, db: Session = Depends(get_db), user = Depends(require_role("Operario", "Admin", "Supervisor"))):
    user_id = getattr(user, "id", None)
    try:
        resultado = recepcionar_lpn(db, request.model_dump(), background_tasks, user_id=user_id)
        return LpnReceptionResponse(**resultado)
    except DuplicateLPNError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        import logging
        logging.exception("Error inesperado en recepcionar_lpn")
        raise HTTPException(status_code=500, detail="Error interno del servidor al recepcionar LPN.")

@router.get("/satos/disponibles")
def route_get_satos_disponibles(db: Session = Depends(get_db)):
    try:
        satos = db.query(Sato).filter(
            Sato.tipo_sato == "PRODUCTO",
            Sato.estado.in_(["Bodega", "Bodega Recepcion"]),
            Sato.cantidad > 0
        ).all()
        return satos
    except Exception as e:
        import logging
        logging.exception("Error inesperado en get_satos_disponibles")
        raise HTTPException(status_code=500, detail="Error interno del servidor.")