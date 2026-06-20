"""
app/domains/wms/routers/catalogo.py
─────────────────────────────────────────────────────────────────────────────
Catálogo de Productos — Router con Caché Distribuido Redis (Layer 2)
─────────────────────────────────────────────────────────────────────────────
Estrategia de Caché aplicada:
  GET /catalogo/productos        → Cache-Aside con TTL=3600s
  GET /catalogo/stock-agrupado   → Cache-Aside con TTL=3600s
  POST /catalogo/producto        → Write-Through + Invalidación de namespaces

Patrón Cache-Aside:
  1. READ → buscar en Redis.
  2. MISS → ir a PostgreSQL, popular Redis, devolver respuesta.
  3. HIT  → devolver desde Redis (0 queries a BD).

Invalidación proactiva (Write-Around Invalidation):
  Al crear un producto: se purga todo el namespace sg:catalogo:*
  garantizando que la siguiente lectura reconstruya el caché desde la BD.
"""

import logging
from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from typing import List

from app.database import get_db, get_db_read
from app.schemas import ProductoCreate, ProductoResponse, ProductoModel, StockAgrupadoFamilia
from app.core.security import get_current_user, require_role
from app.services.catalogo_service import crear_producto, listar_productos, get_stock_agrupado
from app.core.cache import (
    cache_get, cache_set,
    invalidar_catalogo_completo,
    CacheKeys, TTL_CATALOGO,
)

logger = logging.getLogger("sg-wms.catalogo")

router = APIRouter(
    prefix="/catalogo",
    tags=["Catálogo de Productos"]
)


# ─── POST /catalogo/producto ──────────────────────────────────────────────
# Escritura → Primary DB + Invalidación de caché

@router.post("/producto", response_model=ProductoResponse, status_code=201)
def route_crear_producto(
    payload: ProductoCreate,
    db: Session = Depends(get_db),                          # PRIMARY (escritura)
    user=Depends(require_role("Admin", "Supervisor"))
):
    """
    Crea un nuevo producto en el catálogo.
    Invalida el namespace completo de caché sg:catalogo:* al finalizar.
    """
    try:
        resultado = crear_producto(db, payload.model_dump())
        # ── Invalidación proactiva ──────────────────────────────────────
        invalidar_catalogo_completo()
        logger.info("Producto SKU=%s creado. Cache sg:catalogo:* purgado.", resultado.get("sku"))
        return ProductoResponse(**resultado)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        logger.exception("Error inesperado en route_crear_producto")
        raise HTTPException(status_code=500, detail="Error interno del servidor.")


# ─── GET /catalogo/productos ──────────────────────────────────────────────
# Lectura caliente → Read Replica + Cache-Aside Redis

@router.get("/productos", response_model=List[ProductoModel])
def route_listar_productos(
    db: Session = Depends(get_db_read),                     # READ REPLICA (CQRS)
    user=Depends(get_current_user)
):
    """
    Lista el catálogo completo. Servida desde Redis si hay HIT.
    En MISS: consulta la Read Replica de PostgreSQL y popula el caché.

    Hit Rate objetivo: >95% (el catálogo muta <10 veces/día en producción).
    """
    # ── Intento de Cache HIT ──────────────────────────────────────────
    cached = cache_get(CacheKeys.CATALOGO_ALL)
    if cached is not None:
        logger.debug("CACHE HIT → GET /catalogo/productos")
        return cached

    # ── MISS → Ir a Read Replica ──────────────────────────────────────
    try:
        productos = listar_productos(db)
        # Serializar a lista de dicts para poder guardar en Redis
        productos_json = [
            ProductoModel.model_validate(p).model_dump()
            for p in productos
        ]
        cache_set(CacheKeys.CATALOGO_ALL, productos_json, ttl=TTL_CATALOGO)
        return productos
    except Exception:
        logger.exception("Error inesperado en route_listar_productos")
        raise HTTPException(status_code=500, detail="Error interno del servidor.")


# ─── GET /catalogo/stock-agrupado ────────────────────────────────────────
# Vista analítica pesada → Read Replica + Cache-Aside Redis

@router.get("/stock-agrupado", response_model=List[StockAgrupadoFamilia])
def route_get_stock_agrupado(
    db: Session = Depends(get_db_read),                     # READ REPLICA (CQRS)
    user=Depends(get_current_user)
):
    """
    Vista de stock agrupado por Familia → SubFamilia → Producto.
    Es una query JOIN costosa → candidata ideal a cacheo con TTL largo.

    En MISS: ejecuta la agregación en Read Replica y cachea por 1 hora.
    """
    # ── Cache HIT ─────────────────────────────────────────────────────
    cached = cache_get(CacheKeys.CATALOGO_STOCK_AGR)
    if cached is not None:
        logger.debug("CACHE HIT → GET /catalogo/stock-agrupado")
        return cached

    # ── MISS → Read Replica ───────────────────────────────────────────
    try:
        resultado = get_stock_agrupado(db)
        cache_set(CacheKeys.CATALOGO_STOCK_AGR, resultado, ttl=TTL_CATALOGO)
        return resultado
    except Exception:
        logger.exception("Error inesperado en route_get_stock_agrupado")
        raise HTTPException(status_code=500, detail="Error interno del servidor.")