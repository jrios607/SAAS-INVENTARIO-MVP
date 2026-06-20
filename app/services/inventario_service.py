import uuid
from sqlalchemy.orm import Session
from sqlalchemy import or_
from datetime import date, timedelta
from app.models import Sato, Log_Transaccional, Patente, Catalogo_Producto

class InventarioError(ValueError):
    pass

class QuiebreStockError(ValueError):
    pass

def ajustar_inventario_sato(db: Session, sato_id: str, cantidad_a_restar: int, motivo: str, url_foto: str | None = None, user_id: int | None = None) -> dict:
    if motivo.lower() in ["daño", "merma"] and not url_foto:
        raise InventarioError(f"Se requiere adjuntar una URL de foto obligatoria cuando el motivo de ajuste es '{motivo}'.")

    try:
        sato_uuid = uuid.UUID(sato_id)
    except ValueError:
        raise InventarioError("El ID del SATO no es válido.")

    sato = db.query(Sato).filter(Sato.sato_id == sato_uuid).with_for_update().first()
    if not sato:
        raise InventarioError("SATO no encontrado.")

    if sato.cantidad < cantidad_a_restar:
        raise InventarioError(f"No se puede restar {cantidad_a_restar}. El SATO solo tiene {sato.cantidad}.")

    sato.cantidad -= cantidad_a_restar

    log = Log_Transaccional(
        sato_id=sato.sato_id,
        usuario_id=user_id,
        accion="AJUSTE_INVENTARIO",
        detalles=f"Ajuste por: {motivo}. Cantidad restada: {cantidad_a_restar}"
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

def fraccionar_sato(db: Session, sato_padre_id: uuid.UUID, cantidad_a_mover: int, planograma_destino_id: str | None, user_id: int | None = None) -> dict:
    if cantidad_a_mover <= 0:
        raise InventarioError("La cantidad a mover debe ser mayor a 0")

    sato_padre = db.query(Sato).filter(Sato.sato_id == sato_padre_id).with_for_update().first()
    
    if not sato_padre:
        raise InventarioError("SATO Padre no encontrado")
    
    if sato_padre.tipo_sato == "CONTENEDOR" or sato_padre.cantidad is None:
        raise InventarioError("Este SATO es un contenedor (LPN). No tiene cantidad asignada para fraccionar.")
        
    if sato_padre.estado != "Bodega":
        raise InventarioError("El SATO Padre debe estar en estado 'Bodega'")
        
    if cantidad_a_mover > sato_padre.cantidad:
        raise InventarioError("La cantidad a mover supera el stock actual del SATO Padre")

    sato_padre.cantidad -= cantidad_a_mover
    if sato_padre.cantidad == 0:
        sato_padre.estado = "Agotado"

    sato_hijo = Sato(
        padre_id=sato_padre.sato_id,
        sku=sato_padre.sku,
        ubicacion_id=planograma_destino_id,
        lote=sato_padre.lote,
        fecha_vencimiento=sato_padre.fecha_vencimiento,
        cantidad=cantidad_a_mover,
        estado="Vitrina"
    )
    
    db.add(sato_hijo)
    db.flush() 
    
    log_padre = Log_Transaccional(
        sato_id=sato_padre.sato_id,
        usuario_id=user_id,
        accion="DESCUENTO_FRACCIONAMIENTO",
        detalles=f"Se descontaron {cantidad_a_mover} unidades para fraccionamiento"
    )
    log_hijo = Log_Transaccional(
        sato_id=sato_hijo.sato_id,
        usuario_id=user_id,
        accion="CREACION_HIJO_VITRINA",
        detalles=f"SATO Hijo creado en vitrina a partir del padre {sato_padre.sato_id}"
    )
    
    db.add(log_padre)
    db.add(log_hijo)
    
    db.commit()
    
    return {
        "mensaje": "SATO fraccionado exitosamente",
        "sato_hijo_id": sato_hijo.sato_id
    }

def mover_a_vitrina(db: Session, sato_id: uuid.UUID, id_patente: str, nivel_estante: int, frente_posicion: int, user_id: int | None = None) -> dict:
    # OPPORTUNIDAD-03 Aplicada: with_for_update
    sato = db.query(Sato).filter(Sato.sato_id == sato_id).with_for_update().first()
    
    if not sato:
        raise InventarioError("SATO no encontrado")
        
    if sato.estado not in ["Bodega", "Bodega Recepcion"]:
        raise InventarioError(f"El SATO debe estar en Bodega. Estado actual: {sato.estado}")
        
    if sato.cantidad <= 0:
        raise InventarioError("El SATO no tiene stock disponible para mover")

    patente = db.query(Patente).filter(Patente.id_patente == id_patente).first()
    if not patente:
        raise InventarioError("La patente de destino no existe")
        
    productos_permitidos = patente.productos_asignados or []
    if sato.sku not in productos_permitidos:
        raise InventarioError(
            f"El producto ({sato.sku}) no está asignado al planograma de esta góndola. No puedes ubicarlo aquí."
        )

    sato.estado = "Vitrina"
    sato.ubicacion_id = id_patente
    sato.nivel_estante = nivel_estante
    sato.frente_posicion = frente_posicion
    
    log = Log_Transaccional(
        sato_id=sato.sato_id,
        usuario_id=user_id,
        accion="MOVIMIENTO_A_VITRINA",
        detalles=f"SATO movido a vitrina (Patente: {id_patente}, Nivel: {nivel_estante}, Frente: {frente_posicion})"
    )
    db.add(log)
    
    db.commit()
    db.refresh(sato)
    
    return {
        "mensaje": "SATO movido a vitrina exitosamente",
        "sato_id": sato.sato_id,
        "nueva_ubicacion": id_patente
    }


def declarar_merma(db: Session, sato_id: uuid.UUID, cantidad: int, motivo: str, comentarios: str | None, user_id: int | None = None) -> dict:
    sato = db.query(Sato).filter(Sato.sato_id == sato_id).with_for_update().first()
    
    if not sato:
        raise InventarioError("SATO no encontrado")
    
    if sato.cantidad is None:
        raise InventarioError("Este SATO es un contenedor (LPN). No tiene cantidad para declarar merma.")
        
    if cantidad > sato.cantidad:
        raise InventarioError(f"La cantidad a dar de baja ({cantidad}) supera el stock actual del SATO ({sato.cantidad}).")
        
    sato.cantidad -= cantidad
    
    if sato.cantidad == 0:
        sato.estado = "Agotado"
        
    comentario_str = comentarios if comentarios else "Sin comentarios"
    detalles_log = f"Baja de {cantidad} unidades. Motivo: {motivo}. Comentario: {comentario_str}."
    
    log = Log_Transaccional(
        sato_id=sato.sato_id,
        usuario_id=user_id,
        accion="DECLARACION_MERMA",
        detalles=detalles_log
    )
    
    db.add(log)
    db.commit()
    
    return {
        "mensaje": "Merma registrada exitosamente",
        "sato_id": sato.sato_id,
        "cantidad_registrada": cantidad
    }

def get_alertas_vencimiento(db: Session, dias_alerta: int = 7) -> dict:
    """Obtiene los SATOs que están por vencer o ya vencidos en Vitrina o Bodega."""
    fecha_limite = date.today() + timedelta(days=dias_alerta)
    
    satos_por_vencer = db.query(Sato, Catalogo_Producto).join(
        Catalogo_Producto, Sato.sku == Catalogo_Producto.sku
    ).filter(
        Sato.tipo_sato == "PRODUCTO",
        Sato.estado.in_(["Vitrina", "Bodega", "Bodega Recepcion"]),
        Sato.cantidad > 0,
        Sato.fecha_vencimiento != None,
        Sato.fecha_vencimiento <= fecha_limite
    ).all()
    
    alertas = []
    for sato, producto in satos_por_vencer:
        dias_restantes = (sato.fecha_vencimiento - date.today()).days
        alertas.append({
            "sato_id": sato.sato_id,
            "sku": sato.sku,
            "nombre_producto": producto.nombre,
            "lote": sato.lote,
            "fecha_vencimiento": sato.fecha_vencimiento,
            "dias_restantes": dias_restantes,
            "estado": sato.estado,
            "ubicacion_id": sato.ubicacion_id,
            "cantidad": sato.cantidad
        })
        
    return {"alertas": alertas}
