import logging
from threading import Lock
from cachetools import TTLCache
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from sqlalchemy import func

from app.models import Catalogo_Producto, Categoria, Sato

logger = logging.getLogger("sg-wms.catalogo")

# ── Caché en memoria para el catálogo (MEDIO-08) ─────────────
_catalogo_cache = TTLCache(maxsize=1, ttl=300)  # 5 minutos
_cache_lock = Lock()
_CACHE_KEY = "all_products"


def invalidar_cache_catalogo():
    """Invalida la caché del catálogo. Llamar tras crear/editar productos."""
    with _cache_lock:
        _catalogo_cache.clear()


def listar_productos(db: Session):
    """Retorna todos los productos del catálogo, con caché TTL."""
    with _cache_lock:
        if _CACHE_KEY in _catalogo_cache:
            return _catalogo_cache[_CACHE_KEY]

    productos = db.query(Catalogo_Producto).all()

    with _cache_lock:
        _catalogo_cache[_CACHE_KEY] = productos

    return productos


def crear_producto(db: Session, data: dict) -> dict:
    """
    Crea un producto en el catálogo.
    Maneja auto-creación de categoría y Ghost SKU collisions.
    Retorna dict con mensaje y sku.
    """
    nombre_cat = data.pop("categoria", None)

    if nombre_cat:
        cat_db = db.query(Categoria).filter(Categoria.nombre == nombre_cat).first()
        if not cat_db:
            cat_db = Categoria(nombre=nombre_cat, color_hex="#94a3b8")
            db.add(cat_db)
            db.commit()
            db.refresh(cat_db)
        data["categoria_id"] = cat_db.id

    try:
        nuevo_producto = Catalogo_Producto(**data)
        db.add(nuevo_producto)
        db.commit()
        invalidar_cache_catalogo()
        return {"mensaje": "Producto creado exitosamente", "sku": nuevo_producto.sku}
    except IntegrityError as e:
        db.rollback()
        error_str = str(e.orig).lower()
        if "ean" in error_str:
            mensaje = "Ya existe un producto registrado con ese mismo código EAN / GS1."
        elif "sku" in error_str:
            mensaje = "Ya existe un producto registrado con ese mismo SKU."
        else:
            mensaje = "Error de integridad de datos (posible registro duplicado)."
        raise ValueError(mensaje)


def get_stock_agrupado(db: Session):
    """Retorna stock agrupado por familia → sub_familia → producto."""
    stock_por_producto = (
        db.query(
            Catalogo_Producto.sku,
            Catalogo_Producto.nombre,
            Catalogo_Producto.ean,
            Catalogo_Producto.familia,
            Catalogo_Producto.sub_familia,
            Catalogo_Producto.proveedor_marca,
            func.sum(Sato.cantidad).label("total_stock")
        )
        .outerjoin(Sato, Sato.sku == Catalogo_Producto.sku)
        .group_by(
            Catalogo_Producto.sku,
            Catalogo_Producto.nombre,
            Catalogo_Producto.ean,
            Catalogo_Producto.familia,
            Catalogo_Producto.sub_familia,
            Catalogo_Producto.proveedor_marca
        )
        .all()
    )

    agrupado = {}
    for p in stock_por_producto:
        fam = p.familia or "Sin Familia"
        sub = p.sub_familia or "General"
        stock_ind = p.total_stock or 0

        if fam not in agrupado:
            agrupado[fam] = {
                "familia": fam,
                "stock_global_familia": 0,
                "sub_familias_dict": {}
            }

        agrupado[fam]["stock_global_familia"] += stock_ind

        if sub not in agrupado[fam]["sub_familias_dict"]:
            agrupado[fam]["sub_familias_dict"][sub] = {
                "nombre_sub_familia": sub,
                "stock_sub_familia": 0,
                "productos": []
            }

        agrupado[fam]["sub_familias_dict"][sub]["stock_sub_familia"] += stock_ind

        agrupado[fam]["sub_familias_dict"][sub]["productos"].append({
            "sku": p.sku,
            "nombre": p.nombre,
            "ean": p.ean,
            "proveedor_marca": p.proveedor_marca,
            "stock_individual": stock_ind
        })

    resultado = []
    for fam_val in agrupado.values():
        sub_list = list(fam_val["sub_familias_dict"].values())
        resultado.append({
            "familia": fam_val["familia"],
            "stock_global_familia": fam_val["stock_global_familia"],
            "sub_familias": sub_list
        })

    return resultado
