import uuid
from typing import List, Dict, Any
from sqlalchemy.orm import Session
from fastapi import HTTPException, status, BackgroundTasks
from app.models import (
    Pedido_Outbound, Detalle_Pedido, Ola_Picking, Tarea_Picking, 
    Sato, Patente, Catalogo_Producto, Log_Transaccional
)

class OutboundError(ValueError):
    pass

def generar_ola_picking(db: Session, pedido_ids: list[int], user_id: int | None = None) -> dict:
    # 1. Crear Ola
    nueva_ola = Ola_Picking(estado="PENDIENTE")
    db.add(nueva_ola)
    db.flush()

    tareas_generadas = []

    for pedido_id in pedido_ids:
        pedido = db.query(Pedido_Outbound).filter(Pedido_Outbound.id == pedido_id).with_for_update().first()
        if not pedido or pedido.estado != "PENDIENTE":
            continue
        
        pedido.estado = "EN_OLA"
        pedido.ola_id = nueva_ola.id

        detalles = db.query(Detalle_Pedido).filter(Detalle_Pedido.pedido_id == pedido_id).all()
        for detalle in detalles:
            cantidad_requerida = detalle.cantidad
            
            # 2. Lógica FEFO: Buscar SATOs en Vitrina, ordenados por vencimiento ASC
            satos_disponibles = db.query(Sato).filter(
                Sato.sku == detalle.sku,
                Sato.estado == "Vitrina",
                Sato.cantidad > 0
            ).order_by(
                Sato.fecha_vencimiento.asc().nulls_last(),
                Sato.cantidad.desc()
            ).with_for_update(skip_locked=True).all()

            for sato in satos_disponibles:
                if cantidad_requerida <= 0:
                    break
                
                cantidad_a_extraer = min(sato.cantidad, cantidad_requerida)
                
                sato.cantidad -= cantidad_a_extraer
                if sato.cantidad == 0:
                    sato.estado = "Agotado (Reserva Ola)"
                
                cantidad_requerida -= cantidad_a_extraer

                nueva_tarea = Tarea_Picking(
                    ola_id=nueva_ola.id,
                    pedido_id=pedido.id,
                    sku=detalle.sku,
                    sato_id=sato.sato_id,
                    cantidad_a_extraer=cantidad_a_extraer,
                    estado="PENDIENTE"
                )
                db.add(nueva_tarea)
                tareas_generadas.append(nueva_tarea)

    db.commit()
    return {"ola_id": nueva_ola.id, "total_tareas": len(tareas_generadas), "estado": nueva_ola.estado}


def obtener_tareas_ola(db: Session, ola_id: int) -> dict:
    """Aplica el Path Optimization ordenando espacialmente por Patente."""
    tareas = db.query(
        Tarea_Picking, Sato, Patente, Catalogo_Producto
    ).join(
        Sato, Tarea_Picking.sato_id == Sato.sato_id
    ).outerjoin(
        Patente, Sato.ubicacion_id == Patente.id_patente
    ).join(
        Catalogo_Producto, Tarea_Picking.sku == Catalogo_Producto.sku
    ).filter(
        Tarea_Picking.ola_id == ola_id,
        Tarea_Picking.estado == "PENDIENTE"
    ).order_by(
        Patente.area_pasillo.asc().nulls_last(),
        Patente.id_patente.asc().nulls_last(),
        Sato.nivel_estante.desc().nulls_last() # De arriba hacia abajo
    ).all()

    tareas_response = []
    for tarea, sato, patente, producto in tareas:
        tareas_response.append({
            "tarea_id": tarea.id,
            "pedido_id": tarea.pedido_id,
            "sku": tarea.sku,
            "nombre_producto": producto.nombre,
            "sato_id": sato.sato_id,
            "cantidad_a_extraer": tarea.cantidad_a_extraer,
            "estado": tarea.estado,
            "id_patente": patente.id_patente if patente else "Sin Ubicacion",
            "area_pasillo": patente.area_pasillo if patente else "Bodega",
            "nivel_estante": sato.nivel_estante,
            "frente_posicion": sato.frente_posicion
        })

    ola = db.query(Ola_Picking).filter(Ola_Picking.id == ola_id).first()
    return {
        "ola_id": ola_id,
        "estado": ola.estado if ola else "DESCONOCIDO",
        "total_tareas": len(tareas_response),
        "tareas": tareas_response
    }


def completar_tarea_picking(db: Session, tarea_id: int, ean_escaneado: str, user_id: int | None = None) -> dict:
    tarea = db.query(Tarea_Picking).filter(Tarea_Picking.id == tarea_id).with_for_update().first()
    if not tarea or tarea.estado != "PENDIENTE":
        raise OutboundError("Tarea no encontrada o ya completada.")

    producto = db.query(Catalogo_Producto).filter(Catalogo_Producto.ean == ean_escaneado).first()
    if not producto or producto.sku != tarea.sku:
        raise OutboundError("EAN incorrecto. No coincide con el SKU de la tarea.")

    tarea.estado = "COMPLETADA"
    
    log = Log_Transaccional(
        sato_id=tarea.sato_id,
        usuario_id=user_id,
        accion="PICKING_OUTBOUND",
        detalles=f"Extraídas {tarea.cantidad_a_extraer} unidades para Pedido {tarea.pedido_id}"
    )
    db.add(log)
    db.flush()  # IMPORTANTE: Asegurar que el estado COMPLETADA se refleje antes de contar
    
    tareas_pendientes = db.query(Tarea_Picking).filter(
        Tarea_Picking.ola_id == tarea.ola_id, 
        Tarea_Picking.estado == "PENDIENTE"
    ).count()

    if tareas_pendientes == 0:
        ola = db.query(Ola_Picking).filter(Ola_Picking.id == tarea.ola_id).first()
        if ola:
            ola.estado = "COMPLETADA"

    db.commit()
    return {"mensaje": "Tarea completada correctamente", "tarea_id": tarea_id, "ola_completada": tareas_pendientes == 0}


def registrar_faltante_tarea(db: Session, tarea_id: int, background_tasks: BackgroundTasks, user_id: int | None = None) -> dict:
    """Manejo de Short-Picks (Faltante en Sala)."""
    tarea = db.query(Tarea_Picking).filter(Tarea_Picking.id == tarea_id).with_for_update().first()
    if not tarea or tarea.estado != "PENDIENTE":
        raise OutboundError("Tarea no encontrada o ya procesada.")
        
    sato = db.query(Sato).filter(Sato.sato_id == tarea.sato_id).with_for_update().first()
    
    if sato:
        sato.estado = "Agotado (Quiebre Vitrina)"
        
        log = Log_Transaccional(
            sato_id=sato.sato_id,
            usuario_id=user_id,
            accion="DECLARACION_FALTANTE_PICKING",
            detalles=f"Short-Pick reportado por el picker en tarea {tarea_id}."
        )
        db.add(log)

    tarea.estado = "FALTANTE"
    db.flush()
    
    tareas_pendientes = db.query(Tarea_Picking).filter(
        Tarea_Picking.ola_id == tarea.ola_id, 
        Tarea_Picking.estado == "PENDIENTE"
    ).count()

    if tareas_pendientes == 0:
        ola = db.query(Ola_Picking).filter(Ola_Picking.id == tarea.ola_id).first()
        if ola:
            ola.estado = "COMPLETADA"
            
    db.commit()
    
    # ── Emitir Webhook al ERP ──
    try:
        from app.services.integration_service import emitir_webhook
        import datetime
        payload = {
            "sato_id": str(sato.sato_id) if sato else None,
            "sku": tarea.sku,
            "cantidad_faltante": tarea.cantidad_a_extraer,
            "pedido_id": tarea.pedido_id,
            "ola_id": tarea.ola_id,
            "timestamp": datetime.datetime.now().isoformat()
        }
        
        background_tasks.add_task(emitir_webhook, db, "wms.inventory.adjusted", payload)
    except Exception as e:
        print(f"Error scheduling webhook: {e}")

    return {"mensaje": "Faltante registrado y SATO marcado como quebrado."}

def obtener_olas_activas(db: Session) -> list[dict]:
    olas = db.query(Ola_Picking).order_by(Ola_Picking.id.desc()).all()
    return [{"id": ola.id, "estado": ola.estado} for ola in olas]
