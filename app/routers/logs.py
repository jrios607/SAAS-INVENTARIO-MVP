from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import desc, or_
from typing import List, Optional
from datetime import date, datetime

from app.database import get_db
from app.models import Log_Transaccional, Sato, Usuario
from app.schemas import LogTransaccionalResponse
import uuid

router = APIRouter(prefix="/trazabilidad", tags=["Trazabilidad"])

@router.get("/logs", response_model=LogTransaccionalResponse)
def get_logs(
    q: Optional[str] = None,
    accion: Optional[str] = None,
    fecha_inicio: Optional[date] = None,
    fecha_fin: Optional[date] = None,
    limit: int = Query(50, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db)
):
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
        # Assuming fecha_hora is UTC timezone aware or naive.
        # Simple date comparison works if handled correctly by SQLAlchemy, 
        # but to be safe we can use date() function or construct a datetime.
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

@router.get("/arbol/{sato_id}")
def get_arbol_sato(sato_id: uuid.UUID, db: Session = Depends(get_db)):
    # 1. Obtener el SATO actual
    sato_actual = db.query(Sato).filter(Sato.sato_id == sato_id).first()
    if not sato_actual:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="SATO no encontrado")
        
    # 2. Encontrar el SATO "Raíz" (Contenedor superior) si es que tiene padre
    sato_raiz = sato_actual
    while sato_raiz.padre_id:
        padre = db.query(Sato).filter(Sato.sato_id == sato_raiz.padre_id).first()
        if not padre: break
        sato_raiz = padre
        
    # 3. Función recursiva para serializar el árbol
    def build_tree(sato):
        hijos = db.query(Sato).filter(Sato.padre_id == sato.sato_id).all()
        return {
            "sato_id": str(sato.sato_id),
            "tipo_sato": sato.tipo_sato,
            "lpn": sato.lpn,
            "sku": sato.sku,
            "cantidad": sato.cantidad,
            "estado": sato.estado,
            "hijos": [build_tree(h) for h in hijos]
        }
        
    return build_tree(sato_raiz)
