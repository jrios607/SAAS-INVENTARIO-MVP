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
from sqlalchemy.orm import Session
from sqlalchemy import func, asc

from app.database import get_db_read           # ← Read Replica (CQRS)
from app.models import Patente, Sato, Catalogo_Producto
from app.core.cache import (
    cache_get, cache_set,
    invalidar_mapa_bodega,
    CacheKeys, TTL_MAPA_BODEGA,
)

logger = logging.getLogger("sg-wms.mapa_bodega")

router = APIRouter(prefix="/api/v1/mapa/bodega", tags=["Mapa Bodega"])


# ─── GET /api/v1/mapa/bodega/ ─────────────────────────────────────────────

@router.get("/")
def get_patentes_bodega(db: Session = Depends(get_db_read)):
    """
    Retorna el mapa completo de patentes de bodega con sus KPIs de ocupación.
    Cacheado 15 min en Redis — N+1 queries eliminadas.
    """
    # ── Cache HIT ─────────────────────────────────────────────────────
    cached = cache_get(CacheKeys.MAPA_BODEGA)
    if cached is not None:
        logger.debug("CACHE HIT → GET /mapa/bodega/")
        return cached

    # ── MISS → Read Replica ───────────────────────────────────────────
    patentes = db.query(Patente).filter(Patente.tipo_ubicacion != "SALA_VENTA").all()

    # Resolver N+1: una sola query de agregación para todos los stats
    # en lugar de una por cada patente (optimización crítica)
    stats_map: dict = {}
    stats_rows = (
        db.query(
            Sato.ubicacion_id,
            func.count(Sato.sato_id).label("pallets"),
            func.sum(Sato.cantidad).label("unidades"),
        )
        .filter(Sato.estado == "Bodega")
        .group_by(Sato.ubicacion_id)
        .all()
    )
    for row in stats_rows:
        stats_map[row.ubicacion_id] = {
            "pallets": row.pallets or 0,
            "unidades": int(row.unidades or 0),
        }

    resultado = []
    for p in patentes:
        s = stats_map.get(p.id_patente, {"pallets": 0, "unidades": 0})
        resultado.append({
            "id_patente":      p.id_patente,
            "tipo_ubicacion":  p.tipo_ubicacion,
            "area_pasillo":    p.area_pasillo,
            "coordenada_x":    p.coordenada_x,
            "coordenada_y":    p.coordenada_y,
            "ancho":           p.ancho,
            "largo":           p.largo,
            "pallets":         s["pallets"],
            "unidades":        s["unidades"],
        })

    cache_set(CacheKeys.MAPA_BODEGA, resultado, ttl=TTL_MAPA_BODEGA)
    return resultado


# ─── GET /api/v1/mapa/bodega/{id_patente}/stock ───────────────────────────

@router.get("/{id_patente}/stock")
def get_stock_zona_bodega(id_patente: str, db: Session = Depends(get_db_read)):
    """
    Retorna el stock FEFO de una zona específica de bodega.
    Cacheado 15 min por patente → `sg:mapa:stock:{id_patente}`.
    """
    cache_key = CacheKeys.stock_zona(id_patente)

    # ── Cache HIT ─────────────────────────────────────────────────────
    cached = cache_get(cache_key)
    if cached is not None:
        logger.debug("CACHE HIT → GET /mapa/bodega/%s/stock", id_patente)
        return cached

    # ── MISS → Validar y consultar ────────────────────────────────────
    patente = db.query(Patente).filter(Patente.id_patente == id_patente).first()
    if not patente:
        raise HTTPException(status_code=404, detail="Ubicación no encontrada")

    satos = (
        db.query(Sato, Catalogo_Producto.nombre)
        .join(Catalogo_Producto, Sato.sku == Catalogo_Producto.sku)
        .filter(
            Sato.ubicacion_id == id_patente,
            Sato.estado == "Bodega",
            Sato.cantidad > 0,
        )
        .order_by(asc(Sato.fecha_vencimiento))   # FEFO explícito
        .all()
    )

    stock_list = [
        {
            "sato_id":          str(sato.sato_id),
            "sku":              sato.sku,
            "nombre":           nombre,
            "lpn":              sato.lpn or "S/N",
            "cantidad":         sato.cantidad,
            "lote":             sato.lote,
            "fecha_vencimiento": sato.fecha_vencimiento.isoformat()
                                 if sato.fecha_vencimiento else None,
        }
        for sato, nombre in satos
    ]

    cache_set(cache_key, stock_list, ttl=TTL_MAPA_BODEGA)
    return stock_list
