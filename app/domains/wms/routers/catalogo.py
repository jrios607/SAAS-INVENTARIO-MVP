"""
app/domains/wms/routers/catalogo.py
─────────────────────────────────────────────────────────────────────────────
Catálogo de Productos — Router con Caché Distribuido Redis (Layer 2)
─────────────────────────────────────────────────────────────────────────────
Endpoints:
  GET    /catalogo/productos         → Cache-Aside con TTL=3600s
  GET    /catalogo/stock-agrupado    → Cache-Aside con TTL=3600s (incluye Lotes FEFO reales)
  POST   /catalogo/producto          → Crear producto / hidratar Ghost SKU + Invalidación
  PUT    /catalogo/producto/{sku}    → Actualizar producto + Invalidación
  PATCH  /catalogo/producto/{sku}    → Actualización parcial + Invalidación
  DELETE /catalogo/producto/{sku}    → Baja física/lógica segura + Invalidación
  POST   /catalogo/import-file       → Importación masiva segura (.csv, .txt, .json)
"""

import logging
from typing import List
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Query
from sqlalchemy.orm import Session

from app.database import get_db, get_db_read
from app.schemas import (
    ProductoCreate,
    ProductoUpdate,
    ProductoResponse,
    ProductoModel,
    StockAgrupadoFamilia,
    CatalogoImportSummaryResponse,
    CatalogoIngresoStockRequest,
    CatalogoAjusteLoteRequest,
    CatalogoStockMutationResponse,
    CodigoInternoResponse,
)
from app.core.security import get_current_user, require_role
from app.services.catalogo_service import (
    crear_producto,
    actualizar_producto,
    eliminar_producto,
    listar_productos,
    get_stock_agrupado,
    importar_catalogo_archivo,
    ingresar_stock_catalogo,
    ajustar_cantidad_lote_catalogo,
    generar_codigo_interno_plu,
)
from app.core.cache import (
    cache_get,
    cache_set,
    invalidar_catalogo_completo,
    invalidar_stock_y_kpis,
    invalidar_mapa_bodega,
    CacheKeys,
    TTL_CATALOGO,
)

logger = logging.getLogger("sg-wms.catalogo")

router = APIRouter(
    prefix="/catalogo",
    tags=["Catálogo de Productos"],
)

MAX_CATALOG_FILE_BYTES = 5 * 1024 * 1024  # 5 MB


def _invalidar_todo_catalogo():
    invalidar_catalogo_completo()
    invalidar_stock_y_kpis()
    invalidar_mapa_bodega()


@router.post("/producto", response_model=ProductoResponse, status_code=201)
def route_crear_producto(
    payload: ProductoCreate,
    db: Session = Depends(get_db),
    user=Depends(require_role("Admin", "Supervisor")),
):
    """Crea un nuevo producto en el catálogo (o hidrata un Ghost SKU preexistente)."""
    try:
        resultado = crear_producto(db, payload.model_dump())
        _invalidar_todo_catalogo()
        logger.info("Producto SKU=%s creado/actualizado. Cache invalidado.", resultado.get("sku"))
        return ProductoResponse(**resultado)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        logger.exception("Error inesperado en route_crear_producto")
        raise HTTPException(status_code=500, detail="Error interno del servidor.")


@router.put("/producto/{sku}", response_model=ProductoResponse)
@router.patch("/producto/{sku}", response_model=ProductoResponse)
def route_actualizar_producto(
    sku: str,
    payload: ProductoUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_role("Admin", "Supervisor")),
):
    """Actualiza los datos maestros, empaque DUN-14 o parámetros FEFO de un SKU."""
    try:
        resultado = actualizar_producto(db, sku, payload.model_dump(exclude_unset=True))
        _invalidar_todo_catalogo()
        return ProductoResponse(**resultado)
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        logger.exception("Error inesperado en route_actualizar_producto")
        raise HTTPException(status_code=500, detail="Error interno del servidor.")


@router.delete("/producto/{sku}", response_model=ProductoResponse)
def route_eliminar_producto(
    sku: str,
    db: Session = Depends(get_db),
    user=Depends(require_role("Admin", "Supervisor")),
):
    """Elimina o desactiva de forma segura un producto si no posee stock activo."""
    try:
        resultado = eliminar_producto(db, sku)
        _invalidar_todo_catalogo()
        return ProductoResponse(**resultado)
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        logger.exception("Error inesperado en route_eliminar_producto")
        raise HTTPException(status_code=500, detail="Error interno del servidor.")


@router.post("/import-file", response_model=CatalogoImportSummaryResponse)
async def route_importar_catalogo_archivo(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user=Depends(require_role("Admin", "Supervisor")),
):
    """
    Importación masiva segura del catálogo maestro desde archivo .csv, .txt o .json.
    Bloquea ejecutables (.exe), documentos (.pdf, .html), scripts y payloads con bytes NUL.
    """
    try:
        raw_bytes = await file.read(MAX_CATALOG_FILE_BYTES + 1)
        if len(raw_bytes) > MAX_CATALOG_FILE_BYTES:
            raise HTTPException(status_code=413, detail="El archivo supera el límite permitido de 5 MB.")
        resumen = importar_catalogo_archivo(
            db=db,
            filename=file.filename,
            content_type=file.content_type,
            raw_bytes=raw_bytes,
        )
        _invalidar_todo_catalogo()
        return CatalogoImportSummaryResponse(**resumen)
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception:
        logger.exception("Error inesperado en route_importar_catalogo_archivo")
        raise HTTPException(status_code=500, detail="Error interno al importar archivo de catálogo.")


@router.get("/productos", response_model=List[ProductoModel])
def route_listar_productos(
    db: Session = Depends(get_db_read),
    user=Depends(get_current_user),
):
    """Lista el catálogo completo del tenant activo."""
    cached = cache_get(CacheKeys.CATALOGO_ALL)
    if cached is not None:
        return cached

    try:
        productos = listar_productos(db)
        productos_json = [p.model_dump() for p in productos]
        cache_set(CacheKeys.CATALOGO_ALL, productos_json, ttl=TTL_CATALOGO)
        return productos_json
    except Exception:
        logger.exception("Error inesperado en route_listar_productos")
        raise HTTPException(status_code=500, detail="Error interno del servidor.")


@router.get("/stock-agrupado", response_model=List[StockAgrupadoFamilia])
def route_get_stock_agrupado(
    db: Session = Depends(get_db_read),
    user=Depends(get_current_user),
):
    """Vista de stock agrupado por Familia → SubFamilia → Producto con Lotes FEFO reales."""
    cached = cache_get(CacheKeys.CATALOGO_STOCK_AGR)
    if cached is not None:
        return cached

    try:
        resultado = get_stock_agrupado(db)
        cache_set(CacheKeys.CATALOGO_STOCK_AGR, resultado, ttl=TTL_CATALOGO)
        return resultado
    except Exception:
        logger.exception("Error inesperado en route_get_stock_agrupado")
        raise HTTPException(status_code=500, detail="Error interno del servidor.")


@router.post("/producto/{sku}/stock", response_model=CatalogoStockMutationResponse, status_code=201)
def route_ingresar_stock_catalogo(
    sku: str,
    payload: CatalogoIngresoStockRequest,
    db: Session = Depends(get_db),
    user=Depends(require_role("Admin", "Supervisor", "Operario")),
):
    """Agrega un nuevo lote de stock directamente a un producto del catálogo (en unidades o cajas)."""
    try:
        resultado = ingresar_stock_catalogo(db, sku, payload.model_dump())
        _invalidar_todo_catalogo()
        return CatalogoStockMutationResponse(**resultado)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        logger.exception("Error inesperado en route_ingresar_stock_catalogo")
        raise HTTPException(status_code=500, detail="Error interno del servidor.")


@router.patch("/lote/{sato_id}/cantidad", response_model=CatalogoStockMutationResponse)
@router.put("/lote/{sato_id}/cantidad", response_model=CatalogoStockMutationResponse)
def route_ajustar_cantidad_lote(
    sato_id: str,
    payload: CatalogoAjusteLoteRequest,
    db: Session = Depends(get_db),
    user=Depends(require_role("Admin", "Supervisor", "Operario")),
):
    """Edita directamente la cantidad física de un lote Sato desde el Catálogo (con SELECT FOR UPDATE y Log_Transaccional)."""
    try:
        resultado = ajustar_cantidad_lote_catalogo(db, sato_id, payload.model_dump())
        _invalidar_todo_catalogo()
        return CatalogoStockMutationResponse(**resultado)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        logger.exception("Error inesperado en route_ajustar_cantidad_lote")
        raise HTTPException(status_code=500, detail="Error interno del servidor.")


@router.get("/generar-codigo-interno", response_model=CodigoInternoResponse)
def route_generar_codigo_interno(
    prefijo: str = Query("PLU", min_length=2, max_length=10),
    db: Session = Depends(get_db_read),
    user=Depends(get_current_user),
):
    """Genera un código SKU interno sugerido (ej. PLU-0001) y un EAN-13 interno GS1 (prefijo 200) sin colisiones."""
    try:
        return generar_codigo_interno_plu(db, prefijo=prefijo)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        logger.exception("Error inesperado en route_generar_codigo_interno")
        raise HTTPException(status_code=500, detail="Error interno del servidor.")

