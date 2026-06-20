from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from typing import List

from app.database import get_db
from app.models import Catalogo_Producto, ASN_Padre, ASN_Detalle
from app.schemas import AsnInyeccionRequest

router = APIRouter(
    prefix="/asn",
    tags=["Integración ASN"]
)

@router.post("/inyeccion", status_code=201)
def inyectar_asn(payload: AsnInyeccionRequest, db: Session = Depends(get_db)):
    """
    Inyecta un ASN en la base de datos.
    Implementa el patrón de 'Ghost SKUs' para evitar fallos de llaves foráneas 
    si el producto no existe en el catálogo maestro.
    """
    # 1. Verificar si el ASN ya existe
    asn_existente = db.query(ASN_Padre).filter(ASN_Padre.lpn == payload.lpn).first()
    if asn_existente:
        raise HTTPException(status_code=400, detail=f"El ASN {payload.lpn} ya existe.")

    # 2. Obtener SKUs únicos del payload
    skus_entrantes = list(set(detalle.sku for detalle in payload.detalles))

    # 3. Buscar cuáles de estos SKUs ya existen en el catálogo
    productos_existentes = db.query(Catalogo_Producto.sku).filter(
        Catalogo_Producto.sku.in_(skus_entrantes)
    ).all()
    skus_existentes = set(prod[0] for prod in productos_existentes)

    # 4. Determinar los SKUs faltantes (Ghost SKUs)
    skus_faltantes = set(skus_entrantes) - skus_existentes

    # 5. Crear los Ghost SKUs en la base de datos
    if skus_faltantes:
        nuevos_productos = []
        for sku_fantasma in skus_faltantes:
            # Creamos un producto genérico con una advertencia
            nuevo_prod = Catalogo_Producto(
                sku=sku_fantasma,
                nombre="⚠️ PRODUCTO DESCONOCIDO - PENDIENTE DE REVISIÓN",
                ean=f"GHOST-{sku_fantasma}", # EAN autogenerado para evitar UNIQUE errors
                familia="Sin Familia",
                sub_familia="Sin Sub-familia",
                proveedor_marca="Desconocido",
                tolerancia_vencimiento_dias=0
            )
            nuevos_productos.append(nuevo_prod)
        
        try:
            db.bulk_save_objects(nuevos_productos)
            db.commit() # Commitear los Ghost SKUs antes de insertar los detalles del ASN
        except IntegrityError as e:
            db.rollback()
            raise HTTPException(status_code=500, detail=f"Error al crear Ghost SKUs: {str(e)}")

    # 6. Insertar el ASN Padre
    nuevo_asn = ASN_Padre(
        lpn=payload.lpn,
        origen=payload.origen,
        estado="EN_TRANSITO"
    )
    db.add(nuevo_asn)

    # 7. Insertar los Detalles del ASN
    for detalle in payload.detalles:
        nuevo_detalle = ASN_Detalle(
            lpn_padre=payload.lpn,
            sku=detalle.sku,
            cantidad=detalle.cantidad,
            lote=detalle.lote,
            fecha_vencimiento=detalle.fecha_vencimiento
        )
        db.add(nuevo_detalle)

    # 8. Confirmar la transacción
    try:
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Error al inyectar el ASN: {str(e)}")

    return {
        "mensaje": "ASN inyectado con éxito",
        "lpn": payload.lpn,
        "skus_fantasmas_creados": list(skus_faltantes)
    }
