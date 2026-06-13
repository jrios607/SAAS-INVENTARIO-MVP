from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from app.database import get_db
from app.models import Sato, Catalogo_Producto, Log_Transaccional, ASN_Padre, ASN_Detalle
from app.schemas import PalletReceptionRequest, PalletReceptionResponse, LpnReceptionRequest, LpnReceptionResponse, AjusteInventarioRequest, SatoRecepcionDetalle
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
            tipo_sato="PRODUCTO",
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

@router.get("/recepcion/satos", response_model=list[SatoRecepcionDetalle])
def get_satos_en_recepcion(db: Session = Depends(get_db)):
    """Obtiene los SATOs en estado 'Bodega Recepcion' con información extendida."""
    from sqlalchemy.orm import aliased
    SatoPadre = aliased(Sato)
    
    resultados = db.query(
        Sato.sato_id,
        Sato.sku,
        Catalogo_Producto.nombre.label("nombre_producto"),
        SatoPadre.lpn.label("lpn_padre"),
        Sato.cantidad.label("cantidad_actual"),
        Sato.estado
    ).join(
        Catalogo_Producto, Sato.sku == Catalogo_Producto.sku
    ).outerjoin(
        SatoPadre, Sato.padre_id == SatoPadre.sato_id
    ).filter(
        Sato.estado == "Bodega Recepcion",
        Sato.tipo_sato == "PRODUCTO",
        Sato.cantidad > 0
    ).all()
    
    return resultados

@router.post("/satos/{sato_id}/ajuste")
def ajustar_inventario_sato(sato_id: str, payload: AjusteInventarioRequest, db: Session = Depends(get_db)):
    """Resta cantidad a un SATO por motivos de Merma/Faltante."""
    import uuid
    try:
        sato_uuid = uuid.UUID(sato_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="El ID del SATO no es válido.")

    sato = db.query(Sato).filter(Sato.sato_id == sato_uuid).first()
    if not sato:
        raise HTTPException(status_code=404, detail="SATO no encontrado.")
    
    if sato.cantidad < payload.cantidad_a_restar:
        raise HTTPException(status_code=400, detail=f"No se puede restar {payload.cantidad_a_restar}. El SATO solo tiene {sato.cantidad}.")

    sato.cantidad -= payload.cantidad_a_restar
    
    # Registrar en el log
    log = Log_Transaccional(
        sato_id=sato.sato_id,
        accion="AJUSTE_INVENTARIO",
        detalles=f"Ajuste por: {payload.motivo}. Cantidad restada: {payload.cantidad_a_restar}"
    )
    db.add(log)

    if sato.cantidad == 0:
        sato.estado = "Agotado"

    db.commit()
    db.refresh(sato)
    
    return {
        "mensaje": "Ajuste realizado con éxito.",
        "sato_id": sato.sato_id,
        "cantidad_restante": sato.cantidad,
        "nuevo_estado": sato.estado
    }

@router.post("/recepcion/lpn", response_model=LpnReceptionResponse, status_code=201)
def recepcionar_lpn(request: LpnReceptionRequest, db: Session = Depends(get_db)):
    try:
        # 1. Validación Explícita para evitar 500 y devolver 409 limpio
        sato_existente = db.query(Sato).filter(Sato.lpn == request.lpn).first()
        if sato_existente:
            raise HTTPException(
                status_code=409, 
                detail="El pallet ya fue recepcionado"
            )

        # Creamos un SATO Contenedor (Padre) con todos los campos persistidos.
        nuevo_sato_contenedor = Sato(
            tipo_sato="CONTENEDOR",
            lpn=request.lpn,
            destino=request.destino,
            tipo_carga=request.tipo_carga,
            barcode_original=request.original_barcode,
            estado="Bodega Recepcion"
        )
        
        db.add(nuevo_sato_contenedor)
        db.flush() 

        nuevo_log = Log_Transaccional(
            sato_id=nuevo_sato_contenedor.sato_id,
            accion='CREACION_INGRESO_LPN',
            detalles=f"Ingreso pallet consolidado {request.tipo_carga} destino {request.destino} LPN: {request.lpn}"
        )
        db.add(nuevo_log)

        bultos_creados = 0
        
        # 2. Buscamos el ASN Padre
        asn_padre = db.query(ASN_Padre).filter(ASN_Padre.lpn == request.lpn).first()
        if asn_padre and asn_padre.estado == "EN_TRANSITO":
            asn_padre.estado = "RECEPCIONADO"
            detalles = db.query(ASN_Detalle).filter(ASN_Detalle.lpn_padre == request.lpn).all()
            
            for detalle in detalles:
                nuevo_sato_hijo = Sato(
                    tipo_sato="PRODUCTO",
                    padre_id=nuevo_sato_contenedor.sato_id,
                    sku=detalle.sku,
                    cantidad=detalle.cantidad,
                    lote=detalle.lote,
                    fecha_vencimiento=detalle.fecha_vencimiento,
                    estado="Bodega Recepcion"
                )
                db.add(nuevo_sato_hijo)
                bultos_creados += 1

        db.commit()
        db.refresh(nuevo_sato_contenedor)
        
        mensaje = f"Pallet Consolidado {request.tipo_carga} registrado con éxito"
        if bultos_creados > 0:
            mensaje += f". Se generaron {bultos_creados} SATOs hijos desde el ASN."
        
        return LpnReceptionResponse(
            mensaje=mensaje,
            sato_padre_id=nuevo_sato_contenedor.sato_id,
            lpn_registrado=nuevo_sato_contenedor.lpn,
            bultos_creados=bultos_creados
        )
    except HTTPException:
        # Re-raise explicit HTTP exceptions without catching them as generic db errors
        raise
    except IntegrityError as e:
        db.rollback()
        print(f"IntegrityError en recepcionar_lpn: {e}")
        raise HTTPException(status_code=409, detail="El pallet ya fue recepcionado previamente o hay un conflicto de integridad.")
    except Exception as db_error:
        db.rollback()
        print(f"Exception en recepcionar_lpn: {db_error}")
        raise HTTPException(status_code=500, detail="Error interno del servidor al recepcionar LPN.")

@router.get("/satos/disponibles")
def get_satos_disponibles(db: Session = Depends(get_db)):
    """Obtiene los SATOs de tipo PRODUCTO que están en bodega y disponibles para mover a vitrina."""
    try:
        satos = db.query(Sato).filter(
            Sato.tipo_sato == "PRODUCTO",
            Sato.estado.in_(["Bodega", "Bodega Recepcion"]),
            Sato.cantidad > 0
        ).all()
        return satos
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))