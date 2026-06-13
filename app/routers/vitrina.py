import uuid
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Sato, Log_Transaccional, Patente
from app.schemas import SatoFraccionarRequest, SatoFraccionarResponse, SatoMoverVitrinaRequest, SatoMoverVitrinaResponse

router = APIRouter(prefix="/vitrina", tags=["Vitrina"])

@router.post("/fraccionar", response_model=SatoFraccionarResponse)
def fraccionar_sato(request: SatoFraccionarRequest, db: Session = Depends(get_db)):
    if request.cantidad_a_mover <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="La cantidad a mover debe ser mayor a 0")

    try:
        sato_padre = db.query(Sato).filter(Sato.sato_id == request.sato_padre_id).with_for_update().first()
        
        if not sato_padre:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="SATO Padre no encontrado")
        
        if sato_padre.tipo_sato == "CONTENEDOR" or sato_padre.cantidad is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Este SATO es un contenedor (LPN). No tiene cantidad asignada para fraccionar.")
            
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

@router.put("/{sato_id}/mover_a_vitrina", response_model=SatoMoverVitrinaResponse)
def mover_a_vitrina(sato_id: uuid.UUID, request: SatoMoverVitrinaRequest, db: Session = Depends(get_db)):
    """Mueve un SATO desde Bodega hacia una Patente (Vitrina)."""
    try:
        sato = db.query(Sato).filter(Sato.sato_id == sato_id).first()
        
        if not sato:
            raise HTTPException(status_code=404, detail="SATO no encontrado")
            
        if sato.estado not in ["Bodega", "Bodega Recepcion"]:
            raise HTTPException(status_code=400, detail=f"El SATO debe estar en Bodega. Estado actual: {sato.estado}")
            
        if sato.cantidad <= 0:
            raise HTTPException(status_code=400, detail="El SATO no tiene stock disponible para mover")

        # Verificar si la patente existe y si el producto pertenece a la patente
        patente = db.query(Patente).filter(Patente.id_patente == request.id_patente).first()
        if not patente:
            raise HTTPException(status_code=404, detail="La patente de destino no existe")
            
        productos_permitidos = patente.productos_asignados or []
        if sato.sku not in productos_permitidos:
            raise HTTPException(
                status_code=400, 
                detail=f"El producto ({sato.sku}) no está asignado al planograma de esta góndola. No puedes ubicarlo aquí."
            )

        # Actualizar SATO
        sato.estado = "Vitrina"
        sato.ubicacion_id = request.id_patente
        sato.nivel_estante = request.nivel_estante
        sato.frente_posicion = request.frente_posicion
        
        # Registrar en Auditoría
        log = Log_Transaccional(
            sato_id=sato.sato_id,
            accion="MOVIMIENTO_A_VITRINA",
            detalles=f"SATO movido a vitrina (Patente: {request.id_patente}, Nivel: {request.nivel_estante}, Frente: {request.frente_posicion})"
        )
        db.add(log)
        
        db.commit()
        db.refresh(sato)
        
        return SatoMoverVitrinaResponse(
            mensaje="SATO movido a vitrina exitosamente",
            sato_id=sato.sato_id,
            nueva_ubicacion=request.id_patente
        )

    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
