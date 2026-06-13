from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Sato, Log_Transaccional
from app.schemas import MermaRequest, MermaResponse

router = APIRouter(
    prefix="/merma",
    tags=["Merma"]
)

@router.post("/declarar", response_model=MermaResponse, status_code=status.HTTP_201_CREATED)
def declarar_merma(request: MermaRequest, db: Session = Depends(get_db)):
    try:
        # 1. Buscar SATO con bloqueo de fila para evitar condiciones de carrera (ACID)
        sato = db.query(Sato).filter(Sato.sato_id == request.sato_id).with_for_update().first()
        
        if not sato:
            raise HTTPException(status_code=404, detail="SATO no encontrado")
        
        if sato.cantidad is None:
            raise HTTPException(status_code=400, detail="Este SATO es un contenedor (LPN). No tiene cantidad para declarar merma.")
            
        # 2. Validar que la cantidad de merma no supere el stock actual
        if request.cantidad > sato.cantidad:
            raise HTTPException(
                status_code=400, 
                detail=f"La cantidad a dar de baja ({request.cantidad}) supera el stock actual del SATO ({sato.cantidad})."
            )
            
        # 3. Restar la cantidad del stock
        sato.cantidad -= request.cantidad
        
        # Si la cantidad llega a 0, cambiar el estado a 'Agotado'
        if sato.cantidad == 0:
            sato.estado = "Agotado"
            
        # 4. Auditoría de Pérdidas
        comentario_str = request.comentarios if request.comentarios else "Sin comentarios"
        detalles_log = f"Baja de {request.cantidad} unidades. Motivo: {request.motivo}. Comentario: {comentario_str}."
        
        log = Log_Transaccional(
            sato_id=sato.sato_id,
            accion="DECLARACION_MERMA",
            detalles=detalles_log
        )
        
        db.add(log)
        db.commit()
        
        return MermaResponse(
            mensaje="Merma registrada exitosamente",
            sato_id=sato.sato_id,
            cantidad_registrada=request.cantidad
        )
        
    except HTTPException:
        # Re-lanzar las excepciones HTTP esperadas
        db.rollback()
        raise
    except Exception as e:
        # Atrapa cualquier otro error (DB error, etc.)
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
