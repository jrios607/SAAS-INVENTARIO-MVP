from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Sato, Catalogo_Producto, Log_Transaccional
from app.schemas import PalletReceptionRequest, PalletReceptionResponse
from app.core.utils import parse_gs1_128

router = APIRouter(
    prefix="/bodega",
    tags=["Bodega - Recepción"]
)

@router.post("/recepcion/pallet", response_model=PalletReceptionResponse, status_code=201)
def recepcionar_pallet(payload: PalletReceptionRequest, db: Session = Depends(get_db)):
    try:
        datos_extraidos = parse_gs1_128(payload.barcode_text)
        
        producto = db.query(Catalogo_Producto).filter(Catalogo_Producto.ean == datos_extraidos['ean']).first()
        if not producto:
             raise ValueError(f"El EAN {datos_extraidos['ean']} no existe en el Catálogo.")

        nuevo_sato = Sato(
            sku=producto.sku, 
            lote=datos_extraidos['lote'],
            fecha_vencimiento=datos_extraidos['vencimiento'],
            cantidad=datos_extraidos['cantidad'],
            estado="Bodega",
            ubicacion_id=None 
        )
        db.add(nuevo_sato)
        db.flush() 

        nuevo_log = Log_Transaccional(
            sato_id=nuevo_sato.sato_id,
            accion='CREACION_INGRESO_BODEGA',
            detalles=f"Ingreso {datos_extraidos['cantidad']} unidades. Lote: {datos_extraidos['lote']}"
        )
        db.add(nuevo_log)

        db.commit()
        db.refresh(nuevo_sato)
        
        return PalletReceptionResponse(
            mensaje="Recepción exitosa.",
            sato_id=nuevo_sato.sato_id,
            ean_leido=datos_extraidos['ean']
        )
        
    except ValueError as ve:
        db.rollback() 
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as db_error:
        db.rollback()
        raise HTTPException(status_code=500, detail="Error interno del servidor.")