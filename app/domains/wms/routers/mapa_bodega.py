"""
app/domains/wms/routers/mapa_bodega.py
─────────────────────────────────────────────────────────────────────────────
Mapa de Bodega — Router con Caché Distribuido Redis (Planogramas/Micro-Slotting)
─────────────────────────────────────────────────────────────────────────────
Estrategia de Caché:
  GET /api/v1/mapa/bodega/          → Mapa completo de zonas  (TTL=900s)
  GET /api/v1/mapa/bodega/{id}/stock → Stock de zona FEFO     (TTL=900s)

  Invalidación: Se purga cuando el Admin mueve/fracciona SATOs o
  edita la patente desde el planograma (señal enviada desde patente.py).
"""

import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.core.cache import (
    CacheKeys,
    TTL_MAPA_BODEGA,
    cache_get,
    cache_set,
)
from app.core.security import get_current_user
from app.database import get_db_read  # ← Read Replica (CQRS)
from app.models import Catalogo_Producto, Patente, Sato
from app.services.recepcion_service import resolver_id_zona_recepcion_default

logger = logging.getLogger("sg-wms.mapa_bodega")

router = APIRouter(prefix="/api/v1/mapa/bodega", tags=["Mapa Bodega"])

_ESTADOS_BODEGA = ("Bodega", "Bodega Recepcion")
_ID_ZONA_SIN_UBICACION = "SIN-UBICACION"


# ─── GET /api/v1/mapa/bodega/ ─────────────────────────────────────────────


@router.get("/")
def get_patentes_bodega(db: Session = Depends(get_db_read), user=Depends(get_current_user)):
    """
    Retorna el mapa completo de patentes de bodega con sus KPIs de ocupación.
    Incluye SATOs en estado Bodega / Bodega Recepcion sin ubicación asignada
    agrupándolos en la zona de recepción por defecto (o una zona sintética).
    """
    cached = cache_get(CacheKeys.MAPA_BODEGA)
    if cached is not None:
        logger.debug("CACHE HIT → GET /mapa/bodega/")
        return cached

    patentes = db.query(Patente).filter(Patente.tipo_ubicacion != "SALA_VENTA").all()
    patentes_ids = {p.id_patente for p in patentes}
    default_recep_id = resolver_id_zona_recepcion_default(patentes)

    stats_map: dict[str, dict[str, int]] = {}
    stats_rows = (
        db.query(
            Sato.ubicacion_id,
            func.count(Sato.sato_id).label("pallets"),
            func.coalesce(func.sum(Sato.cantidad), 0).label("unidades"),
        )
        .filter(
            Sato.tipo_sato == "PRODUCTO",
            Sato.estado.in_(_ESTADOS_BODEGA),
            Sato.cantidad > 0,
        )
        .group_by(Sato.ubicacion_id)
        .all()
    )

    for row in stats_rows:
        ubic = row.ubicacion_id
        destino = ubic if (ubic and ubic in patentes_ids) else (default_recep_id or _ID_ZONA_SIN_UBICACION)
        bucket = stats_map.setdefault(destino, {"pallets": 0, "unidades": 0})
        bucket["pallets"] += int(row.pallets or 0)
        bucket["unidades"] += int(row.unidades or 0)

    resultado = []
    max_y = 0
    for p in patentes:
        s = stats_map.get(p.id_patente, {"pallets": 0, "unidades": 0})
        max_y = max(max_y, int(p.coordenada_y or 1) + int(p.largo or 1) - 1)
        resultado.append({
            "id_patente": p.id_patente,
            "tipo_ubicacion": p.tipo_ubicacion,
            "area_pasillo": p.area_pasillo,
            "coordenada_x": p.coordenada_x,
            "coordenada_y": p.coordenada_y,
            "ancho": p.ancho,
            "largo": p.largo,
            "pallets": s["pallets"],
            "unidades": s["unidades"],
        })

    if default_recep_id is None and stats_map.get(_ID_ZONA_SIN_UBICACION, {}).get("unidades", 0) > 0:
        sin_ubic = stats_map[_ID_ZONA_SIN_UBICACION]
        resultado.append({
            "id_patente": _ID_ZONA_SIN_UBICACION,
            "tipo_ubicacion": "BODEGA_SECOS",
            "area_pasillo": "Bodega General (Sin zona asignada)",
            "coordenada_x": 1,
            "coordenada_y": max_y + 1,
            "ancho": 2,
            "largo": 1,
            "pallets": sin_ubic["pallets"],
            "unidades": sin_ubic["unidades"],
        })

    cache_set(CacheKeys.MAPA_BODEGA, resultado, ttl=TTL_MAPA_BODEGA)
    return resultado


# ─── GET /api/v1/mapa/bodega/{id_patente}/stock ───────────────────────────


@router.get("/{id_patente}/stock")
def get_stock_zona_bodega(id_patente: str, db: Session = Depends(get_db_read), user=Depends(get_current_user)):
    """
    Retorna el stock FEFO de una zona específica de bodega.
    Cacheado 15 min por patente → `sg:mapa:stock:{id_patente}`.
    """
    cache_key = CacheKeys.stock_zona(id_patente)

    cached = cache_get(cache_key)
    if cached is not None:
        logger.debug("CACHE HIT → GET /mapa/bodega/%s/stock", id_patente)
        return cached

    patentes_bodega = db.query(Patente).filter(Patente.tipo_ubicacion != "SALA_VENTA").all()
    patentes_ids = {p.id_patente for p in patentes_bodega}
    default_recep_id = resolver_id_zona_recepcion_default(patentes_bodega)

    if id_patente != _ID_ZONA_SIN_UBICACION and id_patente not in patentes_ids:
        patente = db.query(Patente).filter(Patente.id_patente == id_patente).first()
        if not patente:
            raise HTTPException(status_code=404, detail="Ubicación no encontrada")

    if patentes_ids:
        unmapped_expr = or_(Sato.ubicacion_id.is_(None), ~Sato.ubicacion_id.in_(patentes_ids))
    else:
        unmapped_expr = Sato.ubicacion_id.is_(None)

    if id_patente == _ID_ZONA_SIN_UBICACION:
        ubic_filter = unmapped_expr
    elif default_recep_id and id_patente == default_recep_id:
        ubic_filter = or_(Sato.ubicacion_id == id_patente, unmapped_expr)
    else:
        ubic_filter = Sato.ubicacion_id == id_patente

    satos = (
        db.query(Sato, Catalogo_Producto.nombre)
        .outerjoin(
            Catalogo_Producto,
            (Sato.sku == Catalogo_Producto.sku) & (Sato.tenant_id == Catalogo_Producto.tenant_id),
        )
        .filter(
            ubic_filter,
            Sato.tipo_sato == "PRODUCTO",
            Sato.estado.in_(_ESTADOS_BODEGA),
            Sato.cantidad > 0,
        )
        .order_by(Sato.fecha_vencimiento.asc().nulls_last(), Sato.sato_id.asc())
        .all()
    )

    stock_list = [
        {
            "sato_id": str(sato.sato_id),
            "sku": sato.sku,
            "nombre": nombre or sato.sku or "Producto",
            "lpn": sato.lpn or "S/N",
            "cantidad": sato.cantidad,
            "lote": sato.lote,
            "fecha_vencimiento": sato.fecha_vencimiento.isoformat()
            if sato.fecha_vencimiento
            else None,
        }
        for sato, nombre in satos
    ]

    cache_set(cache_key, stock_list, ttl=TTL_MAPA_BODEGA)
    return stock_list
