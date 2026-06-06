import uuid
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Sato, Log_Transaccional
from app.schemas import SatoFraccionarRequest, SatoFraccionarResponse

router = APIRouter(prefix="/vitrina", tags=["Vitrina"])

@router.post("/fraccionar", response_model=SatoFraccionarResponse)
def fraccionar_sato(request: SatoFraccionarRequest, db: Session = Depends(get_db)):
    if request.cantidad_a_mover <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="La cantidad a mover debe ser mayor a 0")

    try:
        sato_padre = db.query(Sato).filter(Sato.sato_id == request.sato_padre_id).with_for_update().first()
        
        if not sato_padre:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="SATO Padre no encontrado")
            
        if sato_padre.estado != "Bodega":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="El SATO Padre debe estar en estado 'Bodega'")
            
        if request.cantidad_a_mover > sato_padre.cantidad:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="La cantidad a mover supera el stock actual del SATO Padre")

        # Restar cantidad al Padre
        sato_padre.cantidad -= request.cantidad_a_mover
        if sato_padre.cantidad == 0:
            sato_padre.estado = "Agotado"

        # Crear SATO Hijo
        sato_hijo = Sato(
            padre_id=sato_padre.sato_id,
            sku=sato_padre.sku,
            ubicacion_id=request.planograma_destino_id,
            lote=sato_padre.lote,
            fecha_vencimiento=sato_padre.fecha_vencimiento,
            cantidad=request.cantidad_a_mover,
            estado="Vitrina"
        )
        
        db.add(sato_hijo)
        db.flush() # Obtener sato_id del hijo antes de hacer commit
        
        # Auditoría - Log Transaccional
        log_padre = Log_Transaccional(
            sato_id=sato_padre.sato_id,
            accion="DESCUENTO_FRACCIONAMIENTO",
            detalles=f"Se descontaron {request.cantidad_a_mover} unidades para fraccionamiento"
        )
        log_hijo = Log_Transaccional(
            sato_id=sato_hijo.sato_id,
            accion="CREACION_HIJO_VITRINA",
            detalles=f"SATO Hijo creado en vitrina a partir del padre {sato_padre.sato_id}"
        )
        
        db.add(log_padre)
        db.add(log_hijo)
        
        db.commit()
        
        return SatoFraccionarResponse(
            mensaje="SATO fraccionado exitosamente",
            sato_hijo_id=sato_hijo.sato_id
        )

    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Error interno: {str(e)}")
