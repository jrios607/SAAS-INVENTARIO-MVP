from sqlalchemy.orm import Session
from sqlalchemy import func
import json
from fastapi import HTTPException
import logging

from app.models import Sato, Catalogo_Producto, Log_Transaccional, Patente
from app.core.cache import cache_get, cache_set, TTL_CATALOGO

logger = logging.getLogger("sg-wms.pos_service")

def scan_producto_service(db: Session, ean: str):
    """
    Escaneo rápido de producto en caja.
    Lee del catalogo usando Redis. Verifica stock en estado 'Vitrina' (SALA_VENTA).
    """
    cache_key = f"sg:catalogo:producto:ean:{ean}"
    producto_data = cache_get(cache_key)

    if producto_data:
        logger.info("CACHE HIT: Producto EAN=%s encontrado en Redis.", ean)
    else:
        logger.info("CACHE MISS: Consultando producto EAN=%s en Base de Datos.", ean)
        producto = db.query(Catalogo_Producto).filter(Catalogo_Producto.ean == ean).first()
        if not producto:
            raise HTTPException(status_code=404, detail=f"EAN {ean} no encontrado en el catálogo.")
        
        producto_data = {
            "sku":    producto.sku,
            "nombre": producto.nombre,
            "precio": producto.precio if producto.precio > 0 else 1990
        }
        cache_set(cache_key, producto_data, ttl=TTL_CATALOGO)

    # Verificar stock en sala de venta
    stock_disponible = db.query(func.sum(Sato.cantidad)).join(
        Patente, Sato.ubicacion_id == Patente.id_patente
    ).filter(
        Sato.sku == producto_data["sku"],
        Sato.estado == "Vitrina",
        Patente.tipo_ubicacion == "SALA_VENTA",
        Sato.cantidad > 0
    ).scalar()

    if not stock_disponible or stock_disponible <= 0:
        raise HTTPException(
            status_code=409,
            detail=f"Sin stock disponible en Sala de Ventas para {producto_data['nombre']}."
        )

    return {
        "sku": producto_data["sku"],
        "nombre": producto_data["nombre"],
        "precio": producto_data["precio"],
        "cantidad_disponible": int(stock_disponible)
    }

def checkout_service(db: Session, items: list):
    """
    Procesa el cierre de la venta de forma atómica.
    Aplica FEFO estricto y usa SELECT FOR UPDATE para evitar bloqueos mutuos.
    """
    total_descontado = 0
    satos_afectados = []

    try:
        # Agrupamos los items del ticket por EAN para consolidar cantidades
        ticket_items = {}
        for item in items:
            ticket_items[item.ean] = ticket_items.get(item.ean, 0) + item.cantidad

        for ean, cant_requerida in ticket_items.items():
            producto = db.query(Catalogo_Producto).filter(Catalogo_Producto.ean == ean).first()
            if not producto:
                raise HTTPException(status_code=404, detail=f"EAN {ean} no existe.")

            restante_por_descontar = cant_requerida

            # Buscar Satos en SALA_VENTA ordenados por FEFO
            # skip_locked=True permite a la base de datos saltarse filas que otro cajero esté leyendo
            satos_fefo = db.query(Sato).join(Patente, Sato.ubicacion_id == Patente.id_patente).filter(
                Sato.sku == producto.sku,
                Sato.estado == "Vitrina",
                Patente.tipo_ubicacion == "SALA_VENTA",
                Sato.cantidad > 0
            ).order_by(
                Sato.fecha_vencimiento.asc()
            ).with_for_update(skip_locked=True).all()

            for sato in satos_fefo:
                if restante_por_descontar <= 0:
                    break

                descuento_actual = min(sato.cantidad, restante_por_descontar)
                sato.cantidad -= descuento_actual
                restante_por_descontar -= descuento_actual
                total_descontado += descuento_actual

                satos_afectados.append({
                    "sato_id": str(sato.sato_id),
                    "descontado": descuento_actual,
                    "sku": producto.sku
                })

            if restante_por_descontar > 0:
                raise HTTPException(status_code=400, detail=f"Quiebre de stock al procesar checkout. Faltaron {restante_por_descontar} unds del producto {producto.nombre}.")

        # Registrar el log transaccional
        for afectado in satos_afectados:
            log = Log_Transaccional(
                sato_id=afectado["sato_id"],
                accion="VENTA_POS_CONSOLIDADA",
                detalles=f"Descuento de {afectado['descontado']} unidades vía Caja POS. SKU: {afectado['sku']}"
            )
            db.add(log)

        db.commit()

        return {
            "mensaje": "Transacción aprobada y finalizada con éxito.",
            "total_descontado": total_descontado
        }

    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        logger.exception("Error interno en checkout_service POS")
        raise HTTPException(status_code=500, detail="Error interno procesando el checkout.")
