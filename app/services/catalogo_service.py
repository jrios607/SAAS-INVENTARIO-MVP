import csv
import io
import json
import logging
import os
import re
import uuid
from datetime import date, timedelta
from threading import Lock
from typing import Optional, List, Dict, Any
from cachetools import TTLCache
from sqlalchemy.orm import Session, joinedload
from sqlalchemy.exc import IntegrityError
from sqlalchemy import func, and_

from app.models import (
    Catalogo_Producto,
    Categoria,
    Sato,
    ASN_Detalle,
    Detalle_Pedido,
    Tarea_Picking,
    Log_Transaccional,
    Venta_Externa_Item,
)
from app.schemas import (
    ProductoCreate,
    ProductoModel,
    CatalogoIngresoStockRequest,
    CatalogoAjusteLoteRequest,
    CodigoInternoResponse,
)
from app.core.tenant import current_tenant_id
from app.core.config import settings

logger = logging.getLogger("sg-wms.catalogo")

# ── Colores sugeridos por Familia Supermercadista para el Mapa 2D ─────────────
FAMILIA_DEFAULT_COLORS: Dict[str, str] = {
    "Lácteos y Huevos": "#0ea5e9",
    "Fiambrería y Lácteos": "#14b8a6",
    "Fiambrería y Cecinas": "#14b8a6",
    "Carnicería": "#ef4444",
    "Carnicería y Pescadería": "#ef4444",
    "Frutas y Verduras": "#22c55e",
    "Panadería y Pastelería": "#f59e0b",
    "Congelados": "#3b82f6",
    "Bebidas y Líquidos": "#6366f1",
    "Abarrotes": "#10b981",
    "Limpieza y Hogar": "#8b5cf6",
    "Cuidado Personal y Mascotas": "#ec4899",
    "Frescos": "#06b6d4",
}

ALLOWED_IMPORT_EXTENSIONS = {".csv", ".txt", ".json"}
BLOCKED_MIME_PREFIXES = (
    "application/x-msdownload",
    "application/x-executable",
    "application/x-dosexec",
    "application/x-msdos-program",
    "application/pdf",
    "text/html",
    "application/xhtml+xml",
    "application/javascript",
    "text/javascript",
    "image/",
    "audio/",
    "video/",
    "application/zip",
    "application/x-rar",
    "application/x-sh",
)

# ── Caché en memoria para el catálogo (MEDIO-08) ─────────────
# Particionada por tenant: almacena diccionarios serializados (nunca instancias ORM detached).
_catalogo_cache = TTLCache(maxsize=128, ttl=300)  # 5 minutos
_cache_lock = Lock()


def _catalogo_cache_key() -> str:
    """Clave de caché en memoria aislada por tenant."""
    tenant_id = current_tenant_id.get() or settings.DEFAULT_TENANT_ID
    return f"all_products:{tenant_id}"


def invalidar_cache_catalogo():
    """Invalida la caché del catálogo del tenant actual. Llamar tras crear/editar/eliminar productos."""
    with _cache_lock:
        _catalogo_cache.pop(_catalogo_cache_key(), None)


def validar_archivo_texto_seguro(
    filename: Optional[str],
    content_type: Optional[str],
    raw_bytes: bytes,
    max_bytes: int = 5 * 1024 * 1024,
) -> str:
    """
    Valida que un archivo subido sea estrictamente texto plano estructurado (.csv, .txt, .json)
    y bloquea ejecutables (.exe), documentos (.pdf, .html), scripts o binarios con bytes NUL.
    Retorna el contenido decodificado como string limpio.
    """
    if not raw_bytes or len(raw_bytes) == 0:
        raise ValueError("El archivo subido está vacío.")

    if len(raw_bytes) > max_bytes:
        raise ValueError(f"El archivo supera el tamaño máximo permitido ({max_bytes // (1024 * 1024)} MB).")

    # 1. Validación estricta de extensión de archivo
    clean_name = (filename or "").strip().lower()
    if clean_name:
        _, ext = os.path.splitext(clean_name)
        if ext not in ALLOWED_IMPORT_EXTENSIONS:
            raise ValueError(
                f"Formato de archivo no permitido ('{ext or clean_name}'). "
                f"Solo se aceptan archivos .csv, .txt o .json."
            )
        # Bloquear doble extensión maliciosa (ej: virus.exe.csv)
        base_without_ext = clean_name[: -len(ext)]
        for bad_ext in (".exe", ".bat", ".cmd", ".ps1", ".sh", ".php", ".js", ".html", ".pdf", ".dll"):
            if base_without_ext.endswith(bad_ext):
                raise ValueError(f"Nombre de archivo rechazado por seguridad ('{filename}').")

    # 2. Validación de MIME Content-Type
    mime = (content_type or "").strip().lower()
    if mime and any(mime.startswith(prefix) for prefix in BLOCKED_MIME_PREFIXES):
        raise ValueError(
            f"Tipo de contenido MIME no permitido ('{content_type}'). "
            f"Solo se permiten archivos de datos (.csv, .txt, .json)."
        )

    # 3. Inspección de Magic Bytes y firmas binarias / HTML
    head = raw_bytes[:512]
    if head.startswith(b"MZ"):
        raise ValueError("Archivo rechazado: se detectó firma binaria de ejecutable (PE/EXE).")
    if head.startswith(b"\x7fELF"):
        raise ValueError("Archivo rechazado: se detectó firma binaria ELF.")
    if head.startswith(b"%PDF-"):
        raise ValueError("Archivo rechazado: no se permiten documentos PDF.")
    if head.startswith(b"PK\x03\x04"):
        raise ValueError("Archivo rechazado: archivo comprimido/binario ZIP/XLSX no permitido en este lector.")
    if b"\x00" in raw_bytes:
        raise ValueError("Archivo rechazado: contiene bytes binarios NUL (\\x00) no válidos en texto plano.")

    head_lower = head.lstrip().lower()
    for bad_tag in (b"<!doctype html", b"<html", b"<script", b"<svg", b"<?php", b"<iframe"):
        if head_lower.startswith(bad_tag) or bad_tag in head_lower:
            raise ValueError("Archivo rechazado: se detectó contenido HTML/Script ejecutable.")

    # 4. Decodificación segura
    texto: Optional[str] = None
    for encoding in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            texto = raw_bytes.decode(encoding)
            break
        except UnicodeDecodeError:
            continue

    if not texto or not texto.strip():
        raise ValueError("No fue posible decodificar texto válido desde el archivo.")

    return texto


def _resolver_o_crear_categoria(db: Session, nombre_cat: Optional[str], familia: Optional[str]) -> Optional[int]:
    """Vincula o crea una Categoria dentro de la misma transacción (usando flush, sin commit prematuro)."""
    cat_efectiva = (nombre_cat or familia or "").strip()
    if not cat_efectiva or cat_efectiva == "Sin Familia":
        return None

    cat_db = db.query(Categoria).filter(Categoria.nombre == cat_efectiva).first()
    if not cat_db:
        color = FAMILIA_DEFAULT_COLORS.get(cat_efectiva, "#6366f1")
        cat_db = Categoria(nombre=cat_efectiva, color_hex=color)
        db.add(cat_db)
        db.flush()
    return cat_db.id


def listar_productos(db: Session, incluir_inactivos: bool = False) -> List[ProductoModel]:
    """Retorna todos los productos del catálogo del tenant actual como ProductoModel, con caché TTL."""
    cache_key = _catalogo_cache_key() if not incluir_inactivos else f"{_catalogo_cache_key()}:all"
    with _cache_lock:
        if cache_key in _catalogo_cache:
            return _catalogo_cache[cache_key]

    query = db.query(Catalogo_Producto).options(joinedload(Catalogo_Producto.categoria_rel))
    if not incluir_inactivos:
        query = query.filter(Catalogo_Producto.activo.is_(True))

    productos = query.order_by(Catalogo_Producto.nombre.asc()).all()
    modelos = [ProductoModel.model_validate(p) for p in productos]

    with _cache_lock:
        _catalogo_cache[cache_key] = modelos

    return modelos


def _crear_lote_sato_interno(
    db: Session,
    tenant_id: str,
    sku: str,
    unidades_por_caja: int,
    controla_vencimiento: bool,
    dias_vida_util: Optional[int],
    cantidad_raw: int,
    modo_ingreso: str = "UNIDADES",
    estado_destino: str = "Vitrina",
    ubicacion_id: Optional[str] = None,
    fecha_vencimiento: Optional[date] = None,
    lote: Optional[str] = None,
    accion_log: str = "CARGA_INICIAL_CATALOGO",
    motivo: str = "Carga Inicial desde Catálogo",
) -> Sato:
    modo = (modo_ingreso or "UNIDADES").upper()
    factor = max(1, int(unidades_por_caja or 1)) if modo == "CAJAS" else 1
    unidades_reales = int(cantidad_raw) * factor
    estado_norm = "Bodega" if (estado_destino or "").lower() == "bodega" else "Vitrina"
    vence = fecha_vencimiento
    if vence is None and controla_vencimiento:
        vence = date.today() + timedelta(days=int(dias_vida_util or 30))
    lote_final = (lote or "").strip() or f"L-CAT-{date.today().strftime('%y%m%d')}"

    nuevo_sato = Sato(
        tenant_id=tenant_id,
        tipo_sato="PRODUCTO",
        sku=sku,
        ubicacion_id=(ubicacion_id or "").strip() or None,
        lote=lote_final,
        fecha_elaboracion=date.today(),
        fecha_vencimiento=vence,
        cantidad=unidades_reales,
        estado=estado_norm,
    )
    db.add(nuevo_sato)
    db.flush()

    db.add(
        Log_Transaccional(
            tenant_id=tenant_id,
            sato_id=nuevo_sato.sato_id,
            accion=accion_log,
            detalles=f"{motivo}: +{unidades_reales} UN ({cantidad_raw} {'caja(s)' if modo == 'CAJAS' else 'unid'}) en {estado_norm}. Lote: {lote_final}",
        )
    )
    return nuevo_sato


def crear_producto(db: Session, data: dict) -> dict:
    """
    Crea un producto en el catálogo o hidrata un Ghost SKU preexistente en el mismo tenant.
    Usa db.flush() para mantener atomicidad transaccional con Categoria y lote inicial opcional.
    """
    payload_validado = ProductoCreate(**data).model_dump()
    nombre_cat = payload_validado.pop("categoria", None)
    stock_inicial = int(payload_validado.pop("stock_inicial", 0) or 0)
    modo_stock_inicial = payload_validado.pop("modo_stock_inicial", "UNIDADES")
    estado_stock_inicial = payload_validado.pop("estado_stock_inicial", "Vitrina")
    ubicacion_stock_inicial = payload_validado.pop("ubicacion_stock_inicial", None)
    fecha_vencimiento_inicial = payload_validado.pop("fecha_vencimiento_inicial", None)
    lote_inicial = payload_validado.pop("lote_inicial", None)

    sku = payload_validado["sku"]
    ean = payload_validado["ean"]
    dun14 = payload_validado.get("dun14")

    tenant_id = current_tenant_id.get() or settings.DEFAULT_TENANT_ID

    # Si el usuario configuró tolerancia_vencimiento_dias > 0 o dias_vida_util > 0,
    # activar automáticamente controla_vencimiento para que Recepción valide FEFO.
    if (
        payload_validado.get("tolerancia_vencimiento_dias", 0) > 0
        or (payload_validado.get("dias_vida_util") or 0) > 0
    ):
        payload_validado["controla_vencimiento"] = True

    try:
        # 1. Verificar si el SKU ya existe en ESTE tenant
        existente_sku = (
            db.query(Catalogo_Producto)
            .filter(Catalogo_Producto.sku == sku)
            .first()
        )
        if existente_sku:
            es_ghost = (existente_sku.ean or "").startswith("GHOST-") or "PRODUCTO DESCONOCIDO" in (existente_sku.nombre or "")
            if not es_ghost:
                raise ValueError("Ya existe un producto registrado con ese mismo SKU.")

            # Validar que el nuevo EAN no esté ocupado por otro SKU del tenant
            colision_ean = (
                db.query(Catalogo_Producto)
                .filter(Catalogo_Producto.ean == ean, Catalogo_Producto.sku != sku)
                .first()
            )
            if colision_ean:
                raise ValueError("Ya existe un producto registrado con ese mismo código EAN / GS1.")

            if dun14:
                colision_dun = (
                    db.query(Catalogo_Producto)
                    .filter(Catalogo_Producto.dun14 == dun14, Catalogo_Producto.sku != sku)
                    .first()
                )
                if colision_dun:
                    raise ValueError("Ya existe un producto registrado con ese mismo código DUN-14.")

            categoria_id = _resolver_o_crear_categoria(db, nombre_cat, payload_validado.get("familia"))
            for k, v in payload_validado.items():
                setattr(existente_sku, k, v)
            existente_sku.categoria_id = categoria_id
            existente_sku.activo = True
            db.flush()
            if stock_inicial > 0:
                _crear_lote_sato_interno(
                    db=db,
                    tenant_id=tenant_id,
                    sku=sku,
                    unidades_por_caja=existente_sku.unidades_por_caja or 1,
                    controla_vencimiento=bool(existente_sku.controla_vencimiento),
                    dias_vida_util=existente_sku.dias_vida_util,
                    cantidad_raw=stock_inicial,
                    modo_ingreso=modo_stock_inicial,
                    estado_destino=estado_stock_inicial,
                    ubicacion_id=ubicacion_stock_inicial,
                    fecha_vencimiento=fecha_vencimiento_inicial,
                    lote=lote_inicial,
                )
            db.commit()
            invalidar_cache_catalogo()
            return {"mensaje": "Ghost SKU actualizado y activado exitosamente en el catálogo.", "sku": sku}

        # 2. Verificar duplicidad de EAN y DUN-14 dentro del tenant antes de insertar
        if db.query(Catalogo_Producto).filter(Catalogo_Producto.ean == ean).first():
            raise ValueError("Ya existe un producto registrado con ese mismo código EAN / GS1.")

        if dun14 and db.query(Catalogo_Producto).filter(Catalogo_Producto.dun14 == dun14).first():
            raise ValueError("Ya existe un producto registrado con ese mismo código DUN-14.")

        categoria_id = _resolver_o_crear_categoria(db, nombre_cat, payload_validado.get("familia"))
        payload_validado["categoria_id"] = categoria_id
        payload_validado["tenant_id"] = tenant_id

        nuevo_producto = Catalogo_Producto(**payload_validado)
        db.add(nuevo_producto)
        db.flush()
        if stock_inicial > 0:
            _crear_lote_sato_interno(
                db=db,
                tenant_id=tenant_id,
                sku=sku,
                unidades_por_caja=nuevo_producto.unidades_por_caja or 1,
                controla_vencimiento=bool(nuevo_producto.controla_vencimiento),
                dias_vida_util=nuevo_producto.dias_vida_util,
                cantidad_raw=stock_inicial,
                modo_ingreso=modo_stock_inicial,
                estado_destino=estado_stock_inicial,
                ubicacion_id=ubicacion_stock_inicial,
                fecha_vencimiento=fecha_vencimiento_inicial,
                lote=lote_inicial,
            )
        db.commit()
        invalidar_cache_catalogo()
        return {"mensaje": "Producto creado exitosamente", "sku": nuevo_producto.sku}
    except ValueError:
        db.rollback()
        raise
    except IntegrityError as e:
        db.rollback()
        error_str = str(e.orig).lower() if getattr(e, "orig", None) else str(e).lower()
        if "dun14" in error_str:
            mensaje = "Ya existe un producto registrado con ese mismo código DUN-14."
        elif "ean" in error_str:
            mensaje = "Ya existe un producto registrado con ese mismo código EAN / GS1."
        elif "sku" in error_str or "pkey" in error_str:
            mensaje = "Ya existe un producto registrado con ese mismo SKU."
        else:
            mensaje = "Error de integridad de datos (posible registro duplicado)."
        raise ValueError(mensaje)


def actualizar_producto(db: Session, sku: str, data: dict) -> dict:
    """Actualiza un producto existente del catálogo en el tenant actual."""
    producto = db.query(Catalogo_Producto).filter(Catalogo_Producto.sku == sku).first()
    if not producto:
        raise LookupError(f"No se encontró el producto con SKU '{sku}'.")

    campos_limpios = {k: v for k, v in data.items() if v is not None}
    nombre_cat = campos_limpios.pop("categoria", None)

    nuevo_ean = campos_limpios.get("ean")
    if nuevo_ean and nuevo_ean != producto.ean:
        if db.query(Catalogo_Producto).filter(Catalogo_Producto.ean == nuevo_ean, Catalogo_Producto.sku != sku).first():
            raise ValueError("Ya existe otro producto registrado con ese mismo código EAN / GS1.")

    nuevo_dun14 = campos_limpios.get("dun14")
    if nuevo_dun14 and nuevo_dun14 != producto.dun14:
        if db.query(Catalogo_Producto).filter(Catalogo_Producto.dun14 == nuevo_dun14, Catalogo_Producto.sku != sku).first():
            raise ValueError("Ya existe otro producto registrado con ese mismo código DUN-14.")

    for campo, valor in campos_limpios.items():
        if hasattr(producto, campo):
            setattr(producto, campo, valor)

    if (
        (producto.tolerancia_vencimiento_dias or 0) > 0
        or (producto.dias_vida_util or 0) > 0
    ) and "controla_vencimiento" not in campos_limpios:
        producto.controla_vencimiento = True

    if nombre_cat or "familia" in campos_limpios:
        producto.categoria_id = _resolver_o_crear_categoria(db, nombre_cat, producto.familia)

    try:
        db.commit()
        invalidar_cache_catalogo()
        return {"mensaje": f"Producto {sku} actualizado exitosamente.", "sku": producto.sku}
    except IntegrityError:
        db.rollback()
        raise ValueError("Conflicto de integridad al actualizar el producto (EAN o DUN-14 duplicado).")


def eliminar_producto(db: Session, sku: str) -> dict:
    """
    Elimina físicamente un producto si no tiene historial, o realiza baja lógica (activo=False)
    si tiene trazabilidad histórica pero 0 stock activo. Prohibe eliminar si tiene stock físico > 0.
    """
    producto = db.query(Catalogo_Producto).filter(Catalogo_Producto.sku == sku).first()
    if not producto:
        raise LookupError(f"No se encontró el producto con SKU '{sku}'.")

    stock_activo = (
        db.query(func.coalesce(func.sum(Sato.cantidad), 0))
        .filter(
            Sato.sku == sku,
            Sato.tipo_sato == "PRODUCTO",
            Sato.estado.in_(["Vitrina", "Bodega", "Bodega Recepcion"]),
            Sato.cantidad > 0,
        )
        .scalar()
        or 0
    )
    if stock_activo > 0:
        raise ValueError(
            f"No se puede eliminar el SKU '{sku}' porque aún tiene {stock_activo} unidades activas en inventario. "
            f"Ajuste o declare merma de sus lotes antes de darlo de baja."
        )

    tiene_satos = db.query(Sato.sato_id).filter(Sato.sku == sku).first() is not None
    tiene_asn = db.query(ASN_Detalle.id).filter(ASN_Detalle.sku == sku).first() is not None
    tiene_pedido = db.query(Detalle_Pedido.id).filter(Detalle_Pedido.sku == sku).first() is not None
    tiene_picking = db.query(Tarea_Picking.id).filter(Tarea_Picking.sku == sku).first() is not None
    tiene_ventas = db.query(Venta_Externa_Item.id).filter(Venta_Externa_Item.sku == sku).first() is not None

    if tiene_satos or tiene_asn or tiene_pedido or tiene_picking or tiene_ventas:
        producto.activo = False
        db.commit()
        invalidar_cache_catalogo()
        return {
            "mensaje": f"Producto {sku} desactivado del catálogo activo (se conserva historial de trazabilidad).",
            "sku": sku,
        }

    db.delete(producto)
    db.commit()
    invalidar_cache_catalogo()
    return {"mensaje": f"Producto {sku} eliminado permanentemente del catálogo.", "sku": sku}


def get_stock_agrupado(db: Session, incluir_inactivos: bool = False):
    """
    Retorna stock agrupado por familia → sub_familia → producto,
    incluyendo los lotes reales FEFO ordenados por (fecha_vencimiento ASC NULLS LAST, sato_id ASC),
    desglose Vitrina vs Bodega y estado de alerta de vencimiento.
    """
    estados_disponibles = ["Vitrina", "Bodega", "Bodega Recepcion"]

    # 1. Consultar todos los productos activos del tenant
    query_prod = db.query(Catalogo_Producto)
    if not incluir_inactivos:
        query_prod = query_prod.filter(Catalogo_Producto.activo.is_(True))
    productos = query_prod.order_by(Catalogo_Producto.familia.asc(), Catalogo_Producto.nombre.asc()).all()

    # 2. Consultar todos los lotes Sato activos del tenant ordenados por FEFO estricto (1 sola query O(1))
    satos_activos = (
        db.query(Sato)
        .filter(
            Sato.tipo_sato == "PRODUCTO",
            Sato.estado.in_(estados_disponibles),
            Sato.cantidad > 0,
            Sato.sku.isnot(None),
        )
        .order_by(Sato.fecha_vencimiento.asc().nulls_last(), Sato.sato_id.asc())
        .all()
    )

    hoy = date.today()
    lotes_por_sku: Dict[str, List[Sato]] = {}
    for s in satos_activos:
        lotes_por_sku.setdefault(s.sku, []).append(s)

    agrupado: Dict[str, Dict[str, Any]] = {}
    for p in productos:
        fam = p.familia or "Sin Familia"
        sub = p.sub_familia or "General"
        satos_prod = lotes_por_sku.get(p.sku, [])

        stock_vitrina = sum((s.cantidad or 0) for s in satos_prod if s.estado == "Vitrina")
        stock_bodega = sum((s.cantidad or 0) for s in satos_prod if s.estado in ("Bodega", "Bodega Recepcion"))
        stock_ind = stock_vitrina + stock_bodega

        dias_alerta_prod = p.dias_alerta_vencimiento if p.dias_alerta_vencimiento is not None else 7
        tolerancia_prod = p.tolerancia_vencimiento_dias or 0

        lotes_detalle = []
        proxima_fecha_str: Optional[str] = None
        peor_alerta = "OK"
        prioridad_alerta = {"OK": 0, "SIN_VENCIMIENTO": 0, "PROXIMO": 1, "CRITICO": 2, "VENCIDO": 3}

        for idx, s in enumerate(satos_prod):
            dias_rest: Optional[int] = None
            estado_venc = "SIN_VENCIMIENTO"
            fecha_str: Optional[str] = None

            if s.fecha_vencimiento:
                fecha_str = s.fecha_vencimiento.isoformat()
                if proxima_fecha_str is None:
                    proxima_fecha_str = fecha_str
                dias_rest = (s.fecha_vencimiento - hoy).days
                if dias_rest < 0:
                    estado_venc = "VENCIDO"
                elif dias_rest <= max(tolerancia_prod, 3):
                    estado_venc = "CRITICO"
                elif dias_rest <= max(dias_alerta_prod, 7):
                    estado_venc = "PROXIMO"
                else:
                    estado_venc = "OK"

                if prioridad_alerta.get(estado_venc, 0) > prioridad_alerta.get(peor_alerta, 0):
                    peor_alerta = estado_venc

            ubicacion_label = s.ubicacion_id if s.ubicacion_id else s.estado
            if s.ubicacion_id and s.estado:
                ubicacion_label = f"{s.estado} ({s.ubicacion_id})"

            lotes_detalle.append({
                "sato_id": str(s.sato_id),
                "id_lote": s.lote or s.lpn or f"SATO-{str(s.sato_id)[:8].upper()}",
                "proveedor": p.proveedor_marca or "Proveedor Directo",
                "fecha_vencimiento": fecha_str or "Sin vencimiento",
                "dias_restantes": dias_rest,
                "estado_vencimiento": estado_venc,
                "ubicacion": ubicacion_label,
                "estado_sato": s.estado,
                "stock": s.cantidad or 0,
            })

        es_ghost = (p.ean or "").startswith("GHOST-") or "PRODUCTO DESCONOCIDO" in (p.nombre or "")

        if fam not in agrupado:
            agrupado[fam] = {
                "familia": fam,
                "stock_global_familia": 0,
                "sub_familias_dict": {},
            }

        agrupado[fam]["stock_global_familia"] += stock_ind

        if sub not in agrupado[fam]["sub_familias_dict"]:
            agrupado[fam]["sub_familias_dict"][sub] = {
                "nombre_sub_familia": sub,
                "stock_sub_familia": 0,
                "productos": [],
            }

        agrupado[fam]["sub_familias_dict"][sub]["stock_sub_familia"] += stock_ind

        agrupado[fam]["sub_familias_dict"][sub]["productos"].append({
            "sku": p.sku,
            "nombre": p.nombre,
            "ean": p.ean,
            "dun14": p.dun14,
            "unidades_por_caja": p.unidades_por_caja or 1,
            "unidad_medida": p.unidad_medida or "UN",
            "temperatura_requerida": p.temperatura_requerida or "SECO",
            "stock_minimo": p.stock_minimo if p.stock_minimo is not None else 5,
            "dias_alerta_vencimiento": dias_alerta_prod,
            "tolerancia_vencimiento_dias": tolerancia_prod,
            "controla_vencimiento": bool(p.controla_vencimiento),
            "dias_vida_util": p.dias_vida_util,
            "costo_unitario": p.costo_unitario or 0,
            "activo": bool(p.activo),
            "clase_abc": p.clase_abc or "B",
            "es_perecible_corto": bool(p.es_perecible_corto),
            "venta_valorizada_ventana": p.venta_valorizada_ventana or 0,
            "unidades_vendidas_ventana": p.unidades_vendidas_ventana or 0,
            "participacion_ventas": float(p.participacion_ventas or 0.0),
            "es_ghost_sku": es_ghost,
            "proveedor_marca": p.proveedor_marca,
            "stock_individual": stock_ind,
            "stock_vitrina": stock_vitrina,
            "stock_bodega": stock_bodega,
            "proxima_fecha_vencimiento": proxima_fecha_str,
            "alerta_vencimiento": peor_alerta,
            "lotes": lotes_detalle,
        })

    resultado = []
    for fam_val in agrupado.values():
        sub_list = list(fam_val["sub_familias_dict"].values())
        resultado.append({
            "familia": fam_val["familia"],
            "stock_global_familia": fam_val["stock_global_familia"],
            "sub_familias": sub_list,
        })

    return resultado


def importar_catalogo_archivo(
    db: Session,
    filename: Optional[str],
    content_type: Optional[str],
    raw_bytes: bytes,
) -> dict:
    """
    Importador masivo seguro de Catálogo (.csv, .txt, .json) para onboarding de supermercados/minimarkets
    e hidratación masiva de Ghost SKUs. Usa SAVEPOINT por fila para aislar errores.
    """
    texto = validar_archivo_texto_seguro(filename, content_type, raw_bytes)
    stripped = texto.lstrip()

    filas_crudas: List[Dict[str, Any]] = []
    if (filename and filename.lower().endswith(".json")) or stripped.startswith("[") or stripped.startswith("{"):
        try:
            parsed = json.loads(stripped)
            if isinstance(parsed, dict):
                filas_crudas = parsed.get("productos") or parsed.get("items") or [parsed]
            elif isinstance(parsed, list):
                filas_crudas = parsed
            else:
                raise ValueError("El archivo JSON debe contener una lista de productos.")
        except json.JSONDecodeError as e:
            raise ValueError(f"JSON malformado en archivo de catálogo: {str(e)}")
    else:
        lineas = [ln for ln in stripped.splitlines() if ln.strip()]
        if not lineas:
            raise ValueError("El archivo CSV/TXT no contiene filas.")
        primera = lineas[0]
        delimitador = ";" if primera.count(";") >= primera.count(",") else ","
        if "\t" in primera and primera.count("\t") > primera.count(delimitador):
            delimitador = "\t"
        reader = csv.DictReader(io.StringIO("\n".join(lineas)), delimiter=delimitador)
        for row in reader:
            if any((v or "").strip() for v in row.values() if v is not None):
                filas_crudas.append(row)

    if not filas_crudas:
        raise ValueError("No se encontraron registros de productos en el archivo.")

    if len(filas_crudas) > 5000:
        raise ValueError("El archivo supera el máximo de 5.000 productos por lote de importación.")

    creados = 0
    actualizados = 0
    fallidos = 0
    errores: List[str] = []

    def _pick(d: Dict[str, Any], aliases: tuple, default=None):
        norm = {str(k).strip().lower().replace(" ", "_").replace("-", "_"): v for k, v in d.items() if k is not None}
        for a in aliases:
            if a in norm and norm[a] is not None and str(norm[a]).strip() != "":
                return str(norm[a]).strip()
        return default

    for idx, raw in enumerate(filas_crudas, start=1):
        try:
            sku_val = _pick(raw, ("sku", "codigo", "codigo_interno", "id_producto", "item_code"))
            nombre_val = _pick(raw, ("nombre", "descripcion", "producto", "name", "title"))
            ean_val = _pick(raw, ("ean", "ean13", "gtin", "codigo_barra", "barcode", "upc"))
            dun14_val = _pick(raw, ("dun14", "gtin14", "codigo_caja", "dun"))
            unid_caja_str = _pick(raw, ("unidades_por_caja", "factor_empaque", "pack", "unidades_caja"), "1")
            um_val = (_pick(raw, ("unidad_medida", "um", "unidad", "unit"), "UN") or "UN").upper()
            temp_val = (_pick(raw, ("temperatura_requerida", "temperatura", "cadena_frio", "almacenamiento"), "SECO") or "SECO").upper()
            familia_val = _pick(raw, ("familia", "categoria", "departamento", "rubro"), "Abarrotes")
            subfamilia_val = _pick(raw, ("sub_familia", "subfamilia", "seccion", "grupo"), "General")
            marca_val = _pick(raw, ("proveedor_marca", "marca", "proveedor", "brand", "vendor"), "General")
            tol_str = _pick(raw, ("tolerancia_vencimiento_dias", "tolerancia_dias", "tolerancia"), "0")
            alerta_str = _pick(raw, ("dias_alerta_vencimiento", "alerta_vencimiento", "dias_alerta"), "7")
            min_str = _pick(raw, ("stock_minimo", "minimo", "reorden"), "5")
            costo_str = _pick(raw, ("costo_unitario", "costo", "precio_costo"), "0")
            ctrl_str = _pick(raw, ("controla_vencimiento", "perecible", "control_fefo"), "false")
            stock_ini_str = _pick(raw, ("stock_inicial", "stock", "cantidad_inicial", "cantidad", "existencia"), "0")
            modo_ini_str = (_pick(raw, ("modo_stock_inicial", "modo_stock"), "UNIDADES") or "UNIDADES").upper()

            if not sku_val or not nombre_val or not ean_val:
                raise ValueError("Faltan columnas obligatorias (sku, nombre, ean).")

            ctrl_bool = str(ctrl_str).lower() in ("true", "1", "si", "sí", "yes", "y", "s") or int(tol_str) > 0

            payload = ProductoCreate(
                sku=sku_val,
                nombre=nombre_val,
                ean=ean_val,
                dun14=dun14_val,
                unidades_por_caja=int(float(unid_caja_str)),
                unidad_medida=um_val if um_val in ("UN", "KG", "GR", "LT", "PACK") else "UN",
                temperatura_requerida=temp_val if temp_val in ("SECO", "REFRIGERADO", "CONGELADO", "AMBIENTE", "REFRIGERADO_0_5", "CONGELADO_18") else "SECO",
                stock_minimo=int(float(min_str)),
                dias_alerta_vencimiento=int(float(alerta_str)),
                familia=familia_val,
                sub_familia=subfamilia_val,
                proveedor_marca=marca_val,
                tolerancia_vencimiento_dias=int(float(tol_str)),
                controla_vencimiento=ctrl_bool,
                costo_unitario=int(float(costo_str)),
                stock_inicial=max(0, int(float(stock_ini_str or "0"))),
                modo_stock_inicial="CAJAS" if modo_ini_str == "CAJAS" else "UNIDADES",
            ).model_dump()
            payload.pop("categoria", None)
            stock_ini_val = int(payload.pop("stock_inicial", 0) or 0)
            modo_ini_val = payload.pop("modo_stock_inicial", "UNIDADES")
            estado_ini_val = payload.pop("estado_stock_inicial", "Vitrina")
            ubic_ini_val = payload.pop("ubicacion_stock_inicial", None)
            vence_ini_val = payload.pop("fecha_vencimiento_inicial", None)
            lote_ini_val = payload.pop("lote_inicial", None)

            tenant_id_row = current_tenant_id.get() or settings.DEFAULT_TENANT_ID
            with db.begin_nested():
                existente = db.query(Catalogo_Producto).filter(Catalogo_Producto.sku == payload["sku"]).first()
                cat_id = _resolver_o_crear_categoria(db, familia_val, familia_val)
                if existente:
                    for k, v in payload.items():
                        setattr(existente, k, v)
                    existente.categoria_id = cat_id
                    existente.activo = True
                    db.flush()
                    if stock_ini_val > 0:
                        _crear_lote_sato_interno(
                            db=db,
                            tenant_id=tenant_id_row,
                            sku=existente.sku,
                            unidades_por_caja=existente.unidades_por_caja or 1,
                            controla_vencimiento=bool(existente.controla_vencimiento),
                            dias_vida_util=existente.dias_vida_util,
                            cantidad_raw=stock_ini_val,
                            modo_ingreso=modo_ini_val,
                            estado_destino=estado_ini_val,
                            ubicacion_id=ubic_ini_val,
                            fecha_vencimiento=vence_ini_val,
                            lote=lote_ini_val,
                            motivo="Carga Inicial en Importación Masiva CSV/JSON",
                        )
                    actualizados += 1
                else:
                    payload["categoria_id"] = cat_id
                    payload["tenant_id"] = tenant_id_row
                    nuevo_p = Catalogo_Producto(**payload)
                    db.add(nuevo_p)
                    db.flush()
                    if stock_ini_val > 0:
                        _crear_lote_sato_interno(
                            db=db,
                            tenant_id=tenant_id_row,
                            sku=nuevo_p.sku,
                            unidades_por_caja=nuevo_p.unidades_por_caja or 1,
                            controla_vencimiento=bool(nuevo_p.controla_vencimiento),
                            dias_vida_util=nuevo_p.dias_vida_util,
                            cantidad_raw=stock_ini_val,
                            modo_ingreso=modo_ini_val,
                            estado_destino=estado_ini_val,
                            ubicacion_id=ubic_ini_val,
                            fecha_vencimiento=vence_ini_val,
                            lote=lote_ini_val,
                            motivo="Carga Inicial en Importación Masiva CSV/JSON",
                        )
                    creados += 1
        except Exception as exc:
            fallidos += 1
            errores.append(f"Fila {idx}: {str(exc)}")

    db.commit()
    invalidar_cache_catalogo()

    return {
        "mensaje": "Importación de catálogo finalizada.",
        "filas_recibidas": len(filas_crudas),
        "productos_creados": creados,
        "productos_actualizados": actualizados,
        "filas_fallidas": fallidos,
        "errores": errores[:30],
    }


def ingresar_stock_catalogo(db: Session, sku: str, data: dict) -> dict:
    """
    Crea un nuevo lote Sato directamente desde el módulo Catálogo (en unidades o cajas)
    y registra la trazabilidad en Log_Transaccional.
    """
    req = CatalogoIngresoStockRequest(**data)
    tenant_id = current_tenant_id.get() or settings.DEFAULT_TENANT_ID

    prod = db.query(Catalogo_Producto).filter(Catalogo_Producto.sku == sku).first()
    if not prod:
        raise KeyError(f"No se encontró el producto con SKU '{sku}'.")

    try:
        nuevo_sato = _crear_lote_sato_interno(
            db=db,
            tenant_id=tenant_id,
            sku=prod.sku,
            unidades_por_caja=prod.unidades_por_caja or 1,
            controla_vencimiento=bool(prod.controla_vencimiento),
            dias_vida_util=prod.dias_vida_util,
            cantidad_raw=req.cantidad,
            modo_ingreso=req.modo_ingreso,
            estado_destino=req.estado_destino,
            ubicacion_id=req.ubicacion_id,
            fecha_vencimiento=req.fecha_vencimiento,
            lote=req.lote,
            accion_log="INGRESO_STOCK_CATALOGO",
            motivo=req.motivo or "Ingreso Rápido desde Catálogo",
        )
        db.commit()
        invalidar_cache_catalogo()
        return {
            "mensaje": f"Se agregaron {nuevo_sato.cantidad} {prod.unidad_medida or 'UN'} al stock de '{prod.nombre}' ({nuevo_sato.estado}).",
            "sato_id": str(nuevo_sato.sato_id),
            "sku": prod.sku,
            "cantidad_anterior": 0,
            "cantidad_nueva": int(nuevo_sato.cantidad or 0),
            "diferencia": int(nuevo_sato.cantidad or 0),
            "estado": nuevo_sato.estado,
        }
    except Exception:
        db.rollback()
        raise


def ajustar_cantidad_lote_catalogo(db: Session, sato_id: str, data: dict) -> dict:
    """
    Edita directamente la cantidad (y opcionalmente ubicación, vencimiento y lote)
    de un registro Sato existente desde el Catálogo, usando bloqueo pesimista
    SELECT FOR UPDATE y dejando rastro en Log_Transaccional.
    """
    req = CatalogoAjusteLoteRequest(**data)
    tenant_id = current_tenant_id.get() or settings.DEFAULT_TENANT_ID

    try:
        sato_uuid = uuid.UUID(str(sato_id))
    except ValueError:
        raise ValueError("El identificador de lote SATO no es un UUID válido.")

    try:
        sato = (
            db.query(Sato)
            .filter(Sato.sato_id == sato_uuid)
            .with_for_update()
            .first()
        )
        if not sato:
            raise KeyError(f"No se encontró el lote SATO '{sato_id}'.")

        prod = db.query(Catalogo_Producto).filter(Catalogo_Producto.sku == sato.sku).first()
        factor_caja = max(1, int((prod.unidades_por_caja if prod else 1) or 1))
        modo = (req.modo_cantidad or "UNIDADES").upper()
        nueva_cantidad_real = int(req.nueva_cantidad) * (factor_caja if modo == "CAJAS" else 1)

        cantidad_anterior = int(sato.cantidad or 0)
        diferencia = nueva_cantidad_real - cantidad_anterior
        sato.cantidad = nueva_cantidad_real

        if nueva_cantidad_real == 0:
            sato.estado = "Agotado"
        else:
            if req.estado_destino in ("Vitrina", "Bodega"):
                sato.estado = req.estado_destino
            elif sato.estado not in ("Vitrina", "Bodega"):
                sato.estado = "Vitrina"

        if req.ubicacion_id is not None:
            sato.ubicacion_id = req.ubicacion_id.strip() or None
        if req.fecha_vencimiento is not None:
            sato.fecha_vencimiento = req.fecha_vencimiento
        if req.lote is not None and req.lote.strip():
            sato.lote = req.lote.strip()

        db.add(
            Log_Transaccional(
                tenant_id=tenant_id,
                sato_id=sato.sato_id,
                accion="AJUSTE_CANTIDAD_CATALOGO",
                detalles=(
                    f"Ajuste directo desde Catálogo ({req.motivo}): "
                    f"{cantidad_anterior} -> {nueva_cantidad_real} UN (Dif: {diferencia:+d}). "
                    f"Estado: {sato.estado}."
                ),
            )
        )
        db.commit()
        invalidar_cache_catalogo()
        return {
            "mensaje": f"Cantidad del lote '{sato.lote or str(sato.sato_id)[:8]}' actualizada de {cantidad_anterior} a {nueva_cantidad_real} UN.",
            "sato_id": str(sato.sato_id),
            "sku": sato.sku or "",
            "cantidad_anterior": cantidad_anterior,
            "cantidad_nueva": nueva_cantidad_real,
            "diferencia": diferencia,
            "estado": sato.estado,
        }
    except (KeyError, ValueError):
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise


_PREFIJO_PLU_RE = re.compile(r"^[A-Z0-9]{2,10}$")


def calcular_ean13_interno(correlativo: int) -> str:
    """
    Construye un código EAN-13 interno GS1 válido con prefijo '200' (uso interno en tienda)
    y dígito verificador módulo-10 estándar.
    """
    if correlativo < 1 or correlativo > 999_999_999:
        raise ValueError("El correlativo para EAN-13 interno debe estar entre 1 y 999999999.")
    base12 = f"200{int(correlativo):09d}"
    suma = sum(int(d) * (1 if i % 2 == 0 else 3) for i, d in enumerate(base12))
    check = (10 - (suma % 10)) % 10
    return f"{base12}{check}"


def generar_codigo_interno_plu(db: Session, prefijo: str = "PLU") -> CodigoInternoResponse:
    """
    Genera el siguiente código SKU interno (ej. PLU-0001) y su EAN-13 interno GS1 (200...)
    verificando que no colisione con ningún SKU ni EAN existente en el catálogo del tenant activo.
    """
    prefijo_clean = (prefijo or "PLU").strip().upper()
    if not _PREFIJO_PLU_RE.match(prefijo_clean):
        raise ValueError("El prefijo SKU debe contener entre 2 y 10 caracteres alfanuméricos (A-Z, 0-9).")

    tenant_id = current_tenant_id.get() or settings.DEFAULT_TENANT_ID
    filas = (
        db.query(Catalogo_Producto.sku, Catalogo_Producto.ean)
        .filter(Catalogo_Producto.tenant_id == tenant_id)
        .all()
    )
    skus_existentes = {(r[0] or "").strip().upper() for r in filas if r[0]}
    eans_existentes = {(r[1] or "").strip() for r in filas if r[1]}

    n = 1
    while True:
        sku_cand = f"{prefijo_clean}-{n:04d}"
        ean_cand = calcular_ean13_interno(n)
        if sku_cand.upper() not in skus_existentes and ean_cand not in eans_existentes:
            return CodigoInternoResponse(
                sku_sugerido=sku_cand,
                ean_interno=ean_cand,
                correlativo=n,
                prefijo_sku=prefijo_clean,
            )
        n += 1

