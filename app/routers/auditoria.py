from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Catalogo_Producto, Sato, Log_Transaccional
from app.schemas import AuditoriaConteoRequest, AuditoriaConteoResponse

router = APIRouter(
    prefix="/auditoria",
    tags=["Auditoría"]
)

@router.post("/conteo", response_model=AuditoriaConteoResponse)
def conteo_ciego(request: AuditoriaConteoRequest, db: Session = Depends(get_db)):
    try:
        # 1. Buscar producto en el catálogo por EAN
        producto = db.query(Catalogo_Producto).filter(Catalogo_Producto.ean == request.ean_producto).first()
        if not producto:
            raise HTTPException(status_code=404, detail="Producto con ese EAN no encontrado en el catálogo")

        # 2. Buscar el SATO específico y aplicar bloqueo de fila
        sato = db.query(Sato).filter(
            Sato.sku == producto.sku,
            Sato.ubicacion_id == request.id_patente,
            Sato.lote == request.lote_impreso,
            Sato.estado.in_(["Vitrina", "Agotado"])
        ).with_for_update().first()

        if not sato:
            raise HTTPException(
                status_code=404, 
                detail="No se encontró un SATO en esa patente con el lote especificado que esté en Vitrina o Agotado"
            )

        # 3. Calcular diferencia
        cantidad_anterior = sato.cantidad
        diferencia = request.cantidad_fisica_real - cantidad_anterior

        # 4. Verificar si hubo diferencias
        if diferencia == 0:
            return AuditoriaConteoResponse(
                mensaje="Stock cuadrado. Sin variaciones",
                sato_id=sato.sato_id,
                cantidad_anterior=cantidad_anterior,
                cantidad_nueva=sato.cantidad,
                diferencia=0
            )

        # 5. Aplicar ajuste
        sato.cantidad = request.cantidad_fisica_real

        # Actualizar el estado si es necesario
        if request.cantidad_fisica_real == 0:
            sato.estado = "Agotado"
        elif cantidad_anterior == 0 and request.cantidad_fisica_real > 0:
            sato.estado = "Vitrina"

        # 6. Auditoría
        detalles_log = f"Ajuste físico en patente {request.id_patente}. Lote: {request.lote_impreso}. Diferencia: {diferencia} unidades."
        log = Log_Transaccional(
            sato_id=sato.sato_id,
            accion="AJUSTE_AUDITORIA",
            detalles=detalles_log
        )
        db.add(log)
        
        db.commit()

        return AuditoriaConteoResponse(
            mensaje="Ajuste de inventario realizado con éxito",
            sato_id=sato.sato_id,
            cantidad_anterior=cantidad_anterior,
            cantidad_nueva=request.cantidad_fisica_real,
            diferencia=diferencia
        )

    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
