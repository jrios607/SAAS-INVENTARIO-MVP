import re
import uuid
from typing import List
from sqlalchemy.orm import Session
from sqlalchemy import or_
from datetime import date, datetime, timedelta, timezone
from app.models import Sato, Log_Transaccional, Patente, Catalogo_Producto
from app.schemas import (
    MermaRapidaRequest,
    MermaRapidaResponse,
    MermaRapidaSatoAfectado,
    MermaHistorialItem,
)

class InventarioError(ValueError):
    pass

class QuiebreStockError(ValueError):
    pass

def ajustar_inventario_sato(db: Session, sato_id: str, cantidad_a_restar: int, motivo: str, url_foto: str | None = None, user_id: int | None = None) -> dict:
    if cantidad_a_restar <= 0:
        raise InventarioError("La cantidad a restar debe ser mayor a 0.")
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

def fraccionar_sato(
    db: Session,
    sato_padre_id: uuid.UUID,
    cantidad_a_mover: int,
    planograma_destino_id: str | None,
    nivel_estante: int = 1,
    frente_posicion: int = 1,
    user_id: int | None = None
) -> dict:
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
        raise InventarioError(f"La cantidad a mover ({cantidad_a_mover}) supera el stock actual del SATO Padre ({sato_padre.cantidad})")

    # Validar fecha de vencimiento
    if sato_padre.fecha_vencimiento and sato_padre.fecha_vencimiento < date.today():
        raise InventarioError(f"No se puede fraccionar ni mover a vitrina el lote '{sato_padre.lote}' porque está vencido ({sato_padre.fecha_vencimiento}). Debe declararse merma.")

    # Validar patente si se especificó
    if planograma_destino_id:
        patente = db.query(Patente).filter(Patente.id_patente == planograma_destino_id).first()
        if not patente:
            raise InventarioError(f"La patente de destino '{planograma_destino_id}' no existe.")
        productos_permitidos = set(patente.productos_asignados or [])
        if patente.submapeo_grid and isinstance(patente.submapeo_grid, dict):
            for c in patente.submapeo_grid.get("celdas", []):
                if isinstance(c, dict) and c.get("sku_asignado"):
                    productos_permitidos.add(c["sku_asignado"])
        if productos_permitidos and sato_padre.sku not in productos_permitidos:
            raise InventarioError(
                f"El producto ({sato_padre.sku}) no está asignado a esta góndola ({planograma_destino_id}). No puedes ubicarlo aquí."
            )

    sato_padre.cantidad -= cantidad_a_mover
    if sato_padre.cantidad == 0:
        sato_padre.estado = "Agotado"

    sato_hijo = Sato(
        tenant_id=sato_padre.tenant_id,
        padre_id=sato_padre.sato_id,
        tipo_sato="PRODUCTO",
        sku=sato_padre.sku,
        ubicacion_id=planograma_destino_id,
        lote=sato_padre.lote,
        fecha_elaboracion=sato_padre.fecha_elaboracion,
        fecha_vencimiento=sato_padre.fecha_vencimiento,
        cantidad=cantidad_a_mover,
        estado="Vitrina",
        nivel_estante=nivel_estante or 1,
        frente_posicion=frente_posicion or 1
    )
    
    db.add(sato_hijo)
    db.flush() 
    
    log_padre = Log_Transaccional(
        tenant_id=sato_padre.tenant_id,
        sato_id=sato_padre.sato_id,
        usuario_id=user_id,
        accion="DESCUENTO_FRACCIONAMIENTO",
        detalles=f"Se descontaron {cantidad_a_mover} unidades para vitrina ({planograma_destino_id})"
    )
    log_hijo = Log_Transaccional(
        tenant_id=sato_padre.tenant_id,
        sato_id=sato_hijo.sato_id,
        usuario_id=user_id,
        accion="CREACION_HIJO_VITRINA",
        detalles=f"SATO Hijo creado en vitrina ({planograma_destino_id}, Niv {nivel_estante}, Fte {frente_posicion}) a partir de {sato_padre.sato_id}"
    )
    
    db.add(log_padre)
    db.add(log_hijo)
    db.commit()
    
    return {
        "mensaje": "SATO fraccionado exitosamente",
        "sato_hijo_id": sato_hijo.sato_id
    }

def mover_a_vitrina(
    db: Session,
    sato_id: uuid.UUID,
    id_patente: str,
    nivel_estante: int = 1,
    frente_posicion: int = 1,
    cantidad_a_mover: int | None = None,
    user_id: int | None = None
) -> dict:
    sato = db.query(Sato).filter(Sato.sato_id == sato_id).with_for_update().first()
    
    if not sato:
        raise InventarioError("SATO no encontrado")
        
    if sato.estado not in ["Bodega", "Bodega Recepcion"]:
        raise InventarioError(f"El SATO debe estar en Bodega. Estado actual: {sato.estado}")
        
    if sato.cantidad is None or sato.cantidad <= 0:
        raise InventarioError("El SATO no tiene stock disponible para mover")

    # Validar fecha de vencimiento
    if sato.fecha_vencimiento and sato.fecha_vencimiento < date.today():
        raise InventarioError(f"No se puede mover a vitrina el lote '{sato.lote}' porque está vencido ({sato.fecha_vencimiento}). Debe declararse como merma.")

    patente = db.query(Patente).filter(Patente.id_patente == id_patente).first()
    if not patente:
        raise InventarioError("La patente de destino no existe")
        
    # Verificar si el SKU pertenece al surtido asignado o al submapeo
    productos_permitidos = set(patente.productos_asignados or [])
    if patente.submapeo_grid and isinstance(patente.submapeo_grid, dict):
        for c in patente.submapeo_grid.get("celdas", []):
            if isinstance(c, dict) and c.get("sku_asignado"):
                productos_permitidos.add(c["sku_asignado"])

    if productos_permitidos and sato.sku not in productos_permitidos:
        raise InventarioError(
            f"El producto ({sato.sku}) no está asignado a esta góndola ({id_patente}). No puedes ubicarlo aquí."
        )

    # ── Abastecimiento parcial en 1 paso ──
    if cantidad_a_mover is not None and 0 < cantidad_a_mover < sato.cantidad:
        sato.cantidad -= cantidad_a_mover
        sato_vitrina = Sato(
            tenant_id=sato.tenant_id,
            padre_id=sato.sato_id,
            tipo_sato="PRODUCTO",
            sku=sato.sku,
            ubicacion_id=id_patente,
            lote=sato.lote,
            fecha_elaboracion=sato.fecha_elaboracion,
            fecha_vencimiento=sato.fecha_vencimiento,
            cantidad=cantidad_a_mover,
            estado="Vitrina",
            nivel_estante=nivel_estante or 1,
            frente_posicion=frente_posicion or 1
        )
        db.add(sato_vitrina)
        db.flush()

        log_padre = Log_Transaccional(
            tenant_id=sato.tenant_id,
            sato_id=sato.sato_id,
            usuario_id=user_id,
            accion="DESCUENTO_FRACCIONAMIENTO",
            detalles=f"Se descontaron {cantidad_a_mover} unidades para vitrina ({id_patente})"
        )
        log_hijo = Log_Transaccional(
            tenant_id=sato.tenant_id,
            sato_id=sato_vitrina.sato_id,
            usuario_id=user_id,
            accion="MOVIMIENTO_A_VITRINA",
            detalles=f"SATO Parcial abastecido en vitrina (Patente: {id_patente}, Niv: {nivel_estante or 1}, Fte: {frente_posicion or 1}, Cant: {cantidad_a_mover})"
        )
        db.add(log_padre)
        db.add(log_hijo)
        db.commit()

        return {
            "mensaje": f"Se abastecieron {cantidad_a_mover} unidades en vitrina exitosamente",
            "sato_id": sato_vitrina.sato_id,
            "nueva_ubicacion": id_patente,
            "success": True,
            "sato_vitrina": {
                "sato_id": str(sato_vitrina.sato_id),
                "sku": sato_vitrina.sku,
                "cantidad": sato_vitrina.cantidad,
                "ubicacion_id": sato_vitrina.ubicacion_id,
                "nivel_estante": sato_vitrina.nivel_estante,
                "frente_posicion": sato_vitrina.frente_posicion
            },
            "sato_bodega_restante": {
                "sato_id": str(sato.sato_id),
                "sku": sato.sku,
                "cantidad": sato.cantidad,
                "ubicacion_id": sato.ubicacion_id
            }
        }

    if cantidad_a_mover is not None and cantidad_a_mover > sato.cantidad:
        raise InventarioError(f"La cantidad a mover ({cantidad_a_mover}) supera el stock actual del SATO ({sato.cantidad})")

    # Movimiento total
    sato.estado = "Vitrina"
    sato.ubicacion_id = id_patente
    sato.nivel_estante = nivel_estante or 1
    sato.frente_posicion = frente_posicion or 1
    
    log = Log_Transaccional(
        tenant_id=sato.tenant_id,
        sato_id=sato.sato_id,
        usuario_id=user_id,
        accion="MOVIMIENTO_A_VITRINA",
        detalles=f"SATO movido a vitrina (Patente: {id_patente}, Nivel: {nivel_estante or 1}, Frente: {frente_posicion or 1})"
    )
    db.add(log)
    
    db.commit()
    db.refresh(sato)
    
    return {
        "mensaje": "SATO movido a vitrina exitosamente",
        "sato_id": sato.sato_id,
        "nueva_ubicacion": id_patente,
        "success": True,
        "sato_vitrina": {
            "sato_id": str(sato.sato_id),
            "sku": sato.sku,
            "cantidad": sato.cantidad,
            "ubicacion_id": sato.ubicacion_id,
            "nivel_estante": sato.nivel_estante,
            "frente_posicion": sato.frente_posicion
        },
        "sato_bodega_restante": None
    }

def declarar_merma(db: Session, sato_id: uuid.UUID, cantidad: int, motivo: str, comentarios: str | None, user_id: int | None = None) -> dict:
    if cantidad <= 0:
        raise InventarioError("La cantidad a dar de baja debe ser mayor a 0.")
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
        tenant_id=sato.tenant_id,
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
        Catalogo_Producto, (Sato.sku == Catalogo_Producto.sku) & (Sato.tenant_id == Catalogo_Producto.tenant_id)
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
        
    alertas.sort(key=lambda a: (a["dias_restantes"], str(a["sato_id"])))
    return {"alertas": alertas}


_MERMA_CANT_MOTIVO_RE = re.compile(
    r"Baja de\s+(\d+)\s+unidades\.\s*Motivo:\s*([^.]+)\.", re.IGNORECASE
)
_MERMA_VALOR_RE = re.compile(r"Valor:\s*\$(\d+)\s*CLP", re.IGNORECASE)
_MERMA_COMENTARIO_RE = re.compile(r"Comentario:\s*(.+?)\.?\s*$", re.IGNORECASE)


def declarar_merma_rapida(
    db: Session,
    payload: MermaRapidaRequest,
    user_id: int | None = None,
) -> MermaRapidaResponse:
    """
    Declara una merma rápida en 3 toques por SKU, EAN o sato_id específico,
    aplicando bloqueo pesimista SELECT FOR UPDATE y orden FEFO determinista
    (fecha_vencimiento ASC NULLS LAST, sato_id ASC) para prevenir deadlocks.
    """
    prev_force = getattr(db, "_force_primary", False)
    setattr(db, "_force_primary", True)
    try:
        if payload.sato_id is not None:
            sato = (
                db.query(Sato)
                .filter(Sato.sato_id == payload.sato_id)
                .with_for_update()
                .first()
            )
            if not sato:
                raise LookupError("El lote SATO indicado no existe.")
            if sato.tipo_sato != "PRODUCTO" or sato.cantidad is None:
                raise InventarioError(
                    "Este SATO es un contenedor (LPN) y no tiene cantidad unitaria para declarar merma."
                )
            producto = (
                db.query(Catalogo_Producto)
                .filter(Catalogo_Producto.sku == sato.sku)
                .first()
            )
            if not producto:
                raise LookupError("Producto asociado al lote SATO no encontrado en el catálogo del local.")
            if sato.cantidad <= 0:
                raise InventarioError(
                    f"Stock insuficiente para declarar merma de {payload.cantidad} UN de '{producto.nombre}' (disponible: 0 UN)."
                )
            candidatos = [sato]
        else:
            producto = None
            if payload.sku:
                sku_clean = payload.sku.strip()
                producto = (
                    db.query(Catalogo_Producto)
                    .filter(Catalogo_Producto.sku == sku_clean)
                    .first()
                )
                if not producto:
                    producto = (
                        db.query(Catalogo_Producto)
                        .filter(Catalogo_Producto.ean == sku_clean)
                        .first()
                    )
            if not producto and payload.ean:
                ean_clean = payload.ean.strip()
                producto = (
                    db.query(Catalogo_Producto)
                    .filter(Catalogo_Producto.ean == ean_clean)
                    .first()
                )
            if not producto:
                raise LookupError("Producto no encontrado en el catálogo del local.")

            satos_activos = (
                db.query(Sato)
                .filter(
                    Sato.sku == producto.sku,
                    Sato.tipo_sato == "PRODUCTO",
                    Sato.estado.in_(["Vitrina", "Bodega", "Bodega Recepcion"]),
                    Sato.cantidad > 0,
                )
                .order_by(
                    Sato.fecha_vencimiento.asc().nulls_last(),
                    Sato.sato_id.asc(),
                )
                .with_for_update()
                .all()
            )

            origen_req = (payload.origen or "AUTO").upper()
            ubic_pref = payload.ubicacion_id.strip() if payload.ubicacion_id else None

            if origen_req == "VITRINA":
                vitrina_all = [s for s in satos_activos if s.estado == "Vitrina"]
                if ubic_pref:
                    candidatos = (
                        [s for s in vitrina_all if s.ubicacion_id == ubic_pref]
                        + [s for s in vitrina_all if s.ubicacion_id != ubic_pref]
                    )
                else:
                    candidatos = vitrina_all
            elif origen_req == "BODEGA":
                bodega_all = [s for s in satos_activos if s.estado in ("Bodega", "Bodega Recepcion")]
                if ubic_pref:
                    candidatos = (
                        [s for s in bodega_all if s.ubicacion_id == ubic_pref]
                        + [s for s in bodega_all if s.ubicacion_id != ubic_pref]
                    )
                else:
                    candidatos = bodega_all
            else:  # AUTO
                vitrina_all = [s for s in satos_activos if s.estado == "Vitrina"]
                bodega_all = [s for s in satos_activos if s.estado in ("Bodega", "Bodega Recepcion")]
                if ubic_pref:
                    vitrina_priorizada = (
                        [s for s in vitrina_all if s.ubicacion_id == ubic_pref]
                        + [s for s in vitrina_all if s.ubicacion_id != ubic_pref]
                    )
                    bodega_priorizada = (
                        [s for s in bodega_all if s.ubicacion_id == ubic_pref]
                        + [s for s in bodega_all if s.ubicacion_id != ubic_pref]
                    )
                    candidatos = vitrina_priorizada + bodega_priorizada
                else:
                    candidatos = vitrina_all + bodega_all

        disponible = sum(int(s.cantidad or 0) for s in candidatos)
        if disponible < payload.cantidad:
            raise InventarioError(
                f"Stock insuficiente para declarar merma de {payload.cantidad} UN de '{producto.nombre}' (disponible: {disponible} UN)."
            )

        restante = int(payload.cantidad)
        costo_unit = int(producto.costo_unitario or producto.precio or 0)
        motivo_clean = payload.motivo.strip()
        comentario_clean = (payload.comentarios or "Merma rápida 3 toques").strip()
        satos_afectados: List[MermaRapidaSatoAfectado] = []
        origenes_usados: List[str] = []

        for s in candidatos:
            if restante <= 0:
                break
            cant_actual = int(s.cantidad or 0)
            if cant_actual <= 0:
                continue
            tomar = min(restante, cant_actual)
            estado_origen = s.estado
            s.cantidad = cant_actual - tomar
            if s.cantidad == 0:
                s.estado = "Agotado"

            valor_sato = tomar * costo_unit
            ubic_suffix = f" ({s.ubicacion_id})" if s.ubicacion_id else ""
            detalles_log = (
                f"Baja de {tomar} unidades. "
                f"Motivo: {motivo_clean}. "
                f"Origen: {estado_origen}{ubic_suffix}. "
                f"Valor: ${valor_sato} CLP. "
                f"Comentario: {comentario_clean}."
            )
            db.add(
                Log_Transaccional(
                    tenant_id=s.tenant_id,
                    sato_id=s.sato_id,
                    usuario_id=user_id,
                    accion="DECLARACION_MERMA",
                    detalles=detalles_log,
                )
            )
            restante -= tomar
            if estado_origen not in origenes_usados:
                origenes_usados.append(estado_origen)
            satos_afectados.append(
                MermaRapidaSatoAfectado(
                    sato_id=str(s.sato_id),
                    lote=s.lote,
                    estado_origen=estado_origen,
                    ubicacion_id=s.ubicacion_id,
                    unidades_descontadas=tomar,
                    cantidad_restante=int(s.cantidad),
                    nuevo_estado=s.estado,
                )
            )

        db.commit()

        if len(origenes_usados) == 1:
            origen_aplicado = origenes_usados[0]
        elif len(origenes_usados) > 1:
            origen_aplicado = "+".join(origenes_usados)
        else:
            origen_aplicado = payload.origen

        ubicacion_principal = payload.ubicacion_id or (
            satos_afectados[0].ubicacion_id if satos_afectados else None
        )
        valor_total = int(payload.cantidad) * costo_unit

        return MermaRapidaResponse(
            mensaje=f"Merma registrada exitosamente: -{payload.cantidad} UN de '{producto.nombre}'.",
            sku=producto.sku,
            nombre_producto=producto.nombre,
            cantidad_registrada=int(payload.cantidad),
            motivo=motivo_clean,
            origen_aplicado=origen_aplicado,
            ubicacion_id=ubicacion_principal,
            costo_unitario_clp=costo_unit,
            valor_merma_clp=valor_total,
            satos_afectados=satos_afectados,
        )
    finally:
        setattr(db, "_force_primary", prev_force)


def listar_historial_mermas(db: Session, limit: int = 50) -> List[MermaHistorialItem]:
    """
    Lista el historial de mermas declaradas del tenant activo a partir de Log_Transaccional.
    """
    filas = (
        db.query(Log_Transaccional, Sato, Catalogo_Producto)
        .outerjoin(
            Sato,
            (Log_Transaccional.sato_id == Sato.sato_id)
            & (Log_Transaccional.tenant_id == Sato.tenant_id),
        )
        .outerjoin(
            Catalogo_Producto,
            (Sato.sku == Catalogo_Producto.sku)
            & (Sato.tenant_id == Catalogo_Producto.tenant_id),
        )
        .filter(Log_Transaccional.accion == "DECLARACION_MERMA")
        .order_by(Log_Transaccional.fecha_hora.desc(), Log_Transaccional.id.desc())
        .limit(limit)
        .all()
    )

    items: List[MermaHistorialItem] = []
    for log, sato, prod in filas:
        detalles = log.detalles or ""
        cantidad = 0
        motivo = "OTRO"
        m_cm = _MERMA_CANT_MOTIVO_RE.search(detalles)
        if m_cm:
            cantidad = int(m_cm.group(1))
            motivo = m_cm.group(2).strip()

        m_com = _MERMA_COMENTARIO_RE.search(detalles)
        comentarios = m_com.group(1).strip() if m_com else (detalles or None)

        costo_unit = int((prod.costo_unitario or prod.precio or 0) if prod else 0)
        m_val = _MERMA_VALOR_RE.search(detalles)
        valor_merma = int(m_val.group(1)) if m_val else (cantidad * costo_unit)

        sku_val = (sato.sku if sato and sato.sku else (prod.sku if prod else "N/A"))
        nombre_val = (
            prod.nombre
            if prod and prod.nombre
            else (sato.sku if sato and sato.sku else "Producto Desconocido")
        )

        items.append(
            MermaHistorialItem(
                log_id=int(log.id),
                sato_id=str(log.sato_id) if log.sato_id else None,
                sku=sku_val,
                nombre_producto=nombre_val,
                lote=sato.lote if sato else None,
                ubicacion_id=sato.ubicacion_id if sato else None,
                cantidad=cantidad,
                motivo=motivo,
                comentarios=comentarios,
                costo_unitario_clp=costo_unit,
                valor_merma_clp=valor_merma,
                usuario_id=log.usuario_id,
                fecha=log.fecha_hora or datetime.now(timezone.utc),
            )
        )

    return items
