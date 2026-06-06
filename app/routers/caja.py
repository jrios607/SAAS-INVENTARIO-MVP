from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List

from app.database import get_db
from app.models import Catalogo_Producto, Sato, Log_Transaccional
from app.schemas import VentaCajaRequest, VentaCajaResponse

router = APIRouter(
    prefix="/caja",
    tags=["Caja"]
)

@router.post("/vender", response_model=VentaCajaResponse)
def venta_caja(request: VentaCajaRequest, db: Session = Depends(get_db)):
    try:
        # 1. Buscar producto por EAN
        producto = db.query(Catalogo_Producto).filter(Catalogo_Producto.ean == request.ean_producto).first()
        if not producto:
            raise HTTPException(status_code=404, detail="Producto con ese EAN no encontrado")

        # 2. Buscar SATOS en Vitrina con stock, usando FOR UPDATE para evitar condiciones de carrera
        satos = db.query(Sato).filter(
            Sato.sku == producto.sku,
            Sato.estado == "Vitrina",
            Sato.cantidad > 0
        ).order_by(Sato.fecha_vencimiento.asc()).with_for_update().all()

        cantidad_restante = request.cantidad_vendida
        satos_afectados = []

        # 3. Lógica FEFO
        for sato in satos:
            if cantidad_restante <= 0:
                break
            
            cantidad_a_restar = min(sato.cantidad, cantidad_restante)
            sato.cantidad -= cantidad_a_restar
            cantidad_restante -= cantidad_a_restar

            if sato.cantidad == 0:
                sato.estado = "Vendido"
            
            satos_afectados.append({
                "sato_id": str(sato.sato_id),
                "cantidad_descontada": cantidad_a_restar
            })

            # Auditoría
            log = Log_Transaccional(
                sato_id=sato.sato_id,
                accion="VENTA_CAJA",
                detalles=f"Descontadas {cantidad_a_restar} unidades. Venta en caja FEFO."
            )
            db.add(log)

        # 4. Validar si alcanzó el stock en vitrina
        if cantidad_restante > 0:
            db.rollback()
            raise HTTPException(
                status_code=400, 
                detail=f"Quiebre de stock en vitrina. Faltan {cantidad_restante} unidades para completar la venta."
            )

        db.commit()

        return VentaCajaResponse(
            mensaje="Venta registrada exitosamente",
            cantidad_total_vendida=request.cantidad_vendida,
            satos_afectados=satos_afectados
        )

    except HTTPException:
        # Volver a lanzar la excepción HTTP de manera limpia, el rollback ya se hizo si correspondía,
        # pero por seguridad lo hacemos si hubo algún otro error HTTP
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
