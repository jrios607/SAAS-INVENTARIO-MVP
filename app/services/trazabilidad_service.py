import uuid
from sqlalchemy.orm import Session
from sqlalchemy import desc, or_
from typing import Optional
from datetime import date, datetime

from app.models import Log_Transaccional, Sato, Usuario

def get_logs_service(db: Session, q: Optional[str], accion: Optional[str], fecha_inicio: Optional[date], fecha_fin: Optional[date], limit: int, offset: int) -> dict:
    query = db.query(Log_Transaccional, Sato, Usuario).outerjoin(
        Sato, Log_Transaccional.sato_id == Sato.sato_id
    ).outerjoin(
        Usuario, Log_Transaccional.usuario_id == Usuario.id
    )

    if q:
        query = query.filter(
            or_(
                Sato.lpn.ilike(f"%{q}%"),
                Sato.sku.ilike(f"%{q}%")
            )
        )
    if accion:
        query = query.filter(Log_Transaccional.accion == accion)
    if fecha_inicio:
        from datetime import time
        start_datetime = datetime.combine(fecha_inicio, time.min)
        query = query.filter(Log_Transaccional.fecha_hora >= start_datetime)
    if fecha_fin:
        from datetime import time
        end_datetime = datetime.combine(fecha_fin, time.max)
        query = query.filter(Log_Transaccional.fecha_hora <= end_datetime)

    query = query.order_by(desc(Log_Transaccional.fecha_hora))

    total = query.count()
    results = query.offset(offset).limit(limit).all()

    logs_response = []
    for log, sato, usuario in results:
        lpn_sku = None
        if sato:
            if sato.lpn:
                lpn_sku = sato.lpn
            elif sato.sku:
                lpn_sku = sato.sku
        
        usuario_nombre = usuario.nombre if usuario else "Sistema"

        logs_response.append({
            "id": log.id,
            "fecha_hora": log.fecha_hora,
            "accion": log.accion,
            "detalles": log.detalles,
            "usuario": usuario_nombre,
            "lpn_sku_afectado": lpn_sku,
            "sato_id": log.sato_id
        })

    return {
        "items": logs_response,
        "total": total,
        "limit": limit,
        "offset": offset
    }

def get_arbol_sato_service(db: Session, sato_id: uuid.UUID) -> dict:
    """MEDIO-10: Carga todos los descendientes en 1 sola query con CTE."""
    raiz = db.query(Sato).filter(Sato.sato_id == sato_id).first()
    if not raiz:
        raise ValueError("SATO no encontrado")
        
    while raiz.padre_id:
        padre = db.query(Sato).filter(Sato.sato_id == raiz.padre_id).first()
        if not padre: break
        raiz = padre
        
    todos = db.query(Sato).filter(
        or_(Sato.sato_id == raiz.sato_id, Sato.padre_id == raiz.sato_id)
    ).all()
    
    hijos_map = {}
    for s in todos:
        hijos_map.setdefault(s.padre_id, []).append(s)
        
    def build_tree(sato):
        return {
            "sato_id": str(sato.sato_id),
            "tipo_sato": sato.tipo_sato,
            "lpn": sato.lpn,
            "sku": sato.sku,
            "cantidad": sato.cantidad,
            "estado": sato.estado,
            "hijos": [build_tree(h) for h in hijos_map.get(sato.sato_id, [])]
        }
        
    return build_tree(raiz)

def buscar_por_lote(db: Session, numero_lote: str) -> dict:
    """Busca todas las ubicaciones y el stock total de un lote específico."""
    from app.models import Catalogo_Producto
    
    satos = db.query(Sato, Catalogo_Producto).join(
        Catalogo_Producto, Sato.sku == Catalogo_Producto.sku
    ).filter(
        Sato.tipo_sato == "PRODUCTO",
        Sato.lote == numero_lote,
        Sato.cantidad > 0
    ).all()
    
    if not satos:
        return {"lote": numero_lote, "sku": "N/A", "nombre_producto": "No encontrado", "cantidad_total": 0, "satos": []}
    
    primer_producto = satos[0][1]
    cantidad_total = sum(sato.cantidad for sato, _ in satos)
    
    satos_response = []
    for sato, _ in satos:
        satos_response.append({
            "sato_id": sato.sato_id,
            "estado": sato.estado,
            "cantidad": sato.cantidad,
            "ubicacion_id": sato.ubicacion_id,
            "fecha_vencimiento": sato.fecha_vencimiento
        })
        
    return {
        "lote": numero_lote,
        "sku": primer_producto.sku,
        "nombre_producto": primer_producto.nombre,
        "cantidad_total": cantidad_total,
        "satos": satos_response
    }
