"""
app/services/external_sales_service.py
─────────────────────────────────────────────────────────────────────────────
Conector Universal de Ventas Externas (Omni-POS Ingestion — Etapa 1 ABC)
─────────────────────────────────────────────────────────────────────────────
SG-BVC NO tiene caja propia. Las ventas ocurren en los puntos de venta que el
comercio ya usa, y llegan aquí por dos canales:

  A) POS con API Key / Webhooks (tiempo real)
       POST /api/v1/integration/sales/webhook   (X-API-Key + Idempotency-Key)

  B) POS sin API (cajas legacy, cierres Z, exportaciones de planilla)
       POST /api/v1/integration/sales/import-batch   (JSON por lotes)
       POST /api/v1/integration/sales/import-file    (CSV / TXT / JSON / XLSX)

Ambos canales convergen en `procesar_venta_externa()`, que:
  1. Resuelve cada ítem por SKU o EAN dentro del tenant activo.
  2. Valoriza la venta (precio reportado por POS -> producto.precio -> costo_unitario).
  3. En modo normal (`modo_historico_abc=False`):
       • Descuenta stock en SATOs con FEFO determinista
         (fecha_vencimiento ASC NULLS LAST, sato_id ASC) + SELECT ... FOR UPDATE.
       • Jamás permite stock negativo (`Sato.cantidad >= 0`); si el stock físico
         no alcanza, descuenta hasta 0 (`Agotado`) y registra el déficit en
         `Anomalia_Stock(tipo="VENTA_SIN_STOCK")` sin abortar el ticket.
       • Registra VENTA_EXTERNA_POS en `Log_Transaccional` (trazabilidad).
  4. En modo histórico (`modo_historico_abc=True`):
       • Ingresa la historia de ventas (ej. últimos 90 días) en `Venta_Externa` y
         `Venta_Externa_Item` para alimentar el Motor ABC Dinámico desde el Día 1,
         sin alterar `Sato`, `Log_Transaccional` ni generar `Anomalia_Stock`.

Las invalidaciones de caché y el recálculo ABC los coordina el router tras commit.
"""

import csv
import hashlib
import io
import json
import logging
import unicodedata
import zipfile
from collections import OrderedDict
from datetime import date, datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple

from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, noload

from app.domains.integration.schemas import (
    DryRunUnknownCodeItem,
    ExternalSaleDryRunResponse,
    ExternalSaleItem,
    ExternalSaleTicketDetailResponse,
    ExternalSaleTicketFefoLotDetail,
    ExternalSaleTicketItemDetail,
    ExternalSaleTicketOrphanDetail,
    ExternalSaleWebhookRequest,
    OrphanCodeGroupItem,
    ResolveOrphanRequest,
    ResolveOrphanResponse,
    RevertirVentaResponse,
)
from app.models import (
    Anomalia_Stock,
    Catalogo_Producto,
    Log_Transaccional,
    Patente,
    Sato,
    Venta_Externa,
    Venta_Externa_Descuento,
    Venta_Externa_Huerfano,
    Venta_Externa_Item,
)
from app.services.catalogo_service import validar_archivo_texto_seguro
from app.services.tenant_settings_service import obtener_fallback_bodega_tenant

logger = logging.getLogger("sg-wms.external_sales")

ACCION_LOG_VENTA_EXTERNA = "VENTA_EXTERNA_POS"
ACCION_LOG_REVERSION_VENTA = "REVERSION_VENTA_EXTERNA"

ESTADOS_VITRINA = ("Vitrina",)
ESTADOS_BODEGA = ("Bodega", "Bodega Recepcion")

_BAD_DOUBLE_EXTENSIONS = (
    ".exe",
    ".bat",
    ".cmd",
    ".ps1",
    ".sh",
    ".php",
    ".js",
    ".html",
    ".pdf",
    ".dll",
)


# ── Errores de dominio ────────────────────────────────────────────────────

class VentaExternaError(ValueError):
    """Error de negocio al procesar una venta externa (no es un 500)."""


class ProductoNoEncontradoError(VentaExternaError):
    pass


class QuiebreStockError(VentaExternaError):
    pass


# ── Utilidades de fecha y precio ──────────────────────────────────────────

def _parsear_fecha_venta_dt(timestamp_raw: Optional[str]) -> datetime:
    """
    Convierte el timestamp libre reportado por el POS a datetime UTC.
    Si no viene o no es reconocible, retorna `datetime.now(timezone.utc)`.
    """
    ahora = datetime.now(timezone.utc)
    if not timestamp_raw or not str(timestamp_raw).strip():
        return ahora

    texto = str(timestamp_raw).strip()
    iso_candidate = texto[:-1] + "+00:00" if texto.endswith(("Z", "z")) else texto
    try:
        dt = datetime.fromisoformat(iso_candidate)
        if dt.tzinfo is None:
            return dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except ValueError:
        pass

    formatos = (
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%Y-%m-%d",
        "%d/%m/%Y %H:%M:%S",
        "%d/%m/%Y %H:%M",
        "%d/%m/%Y",
        "%d-%m-%Y %H:%M:%S",
        "%d-%m-%Y %H:%M",
        "%d-%m-%Y",
    )
    for fmt in formatos:
        try:
            dt = datetime.strptime(texto, fmt)
            return dt.replace(tzinfo=timezone.utc)
        except ValueError:
            continue

    return ahora


def _calcular_precio_efectivo(item: ExternalSaleItem, producto: Catalogo_Producto) -> int:
    if item.precio_unitario is not None:
        return max(0, int(item.precio_unitario))
    if producto.precio and producto.precio > 0:
        return int(producto.precio)
    return max(0, int(producto.costo_unitario or 0))


# ── Resolución de producto (SKU o EAN) ────────────────────────────────────

def _resolver_producto(db: Session, item: ExternalSaleItem) -> Catalogo_Producto:
    """
    Busca el producto en el catálogo del tenant activo.
    Muchos POS ponen el código de barras en la columna "código" y viceversa,
    así que cada identificador se prueba también en el campo contrario.
    """
    sku = (item.sku or "").strip() or None
    ean = (item.ean or "").strip() or None

    candidatos: List[Tuple[Any, str]] = []
    if sku:
        candidatos += [
            (Catalogo_Producto.sku, sku),
            (Catalogo_Producto.ean, sku),
            (Catalogo_Producto.dun14, sku),
        ]
    if ean:
        candidatos += [
            (Catalogo_Producto.ean, ean),
            (Catalogo_Producto.sku, ean),
            (Catalogo_Producto.dun14, ean),
        ]
        if len(ean) == 14 and ean.startswith("0"):
            candidatos.append((Catalogo_Producto.ean, ean[1:]))

    for columna, valor in candidatos:
        producto = db.query(Catalogo_Producto).filter(columna == valor).first()
        if producto:
            return producto

    raise ProductoNoEncontradoError(
        f"Producto no encontrado en el catálogo (sku={sku!r}, ean={ean!r})."
    )


# ── Descuento FEFO con bloqueo pesimista (Sin Stock Negativo) ────────────

def _satos_fefo(db: Session, sku: str, estados: Iterable[str]) -> List[Sato]:
    return (
        db.query(Sato)
        .filter(
            Sato.sku == sku,
            Sato.tipo_sato == "PRODUCTO",
            Sato.estado.in_(list(estados)),
            Sato.cantidad > 0,
        )
        .order_by(
            Sato.fecha_vencimiento.asc().nulls_last(),  # FEFO: lo que vence antes sale primero
            Sato.sato_id.asc(),                         # Orden determinista → evita deadlocks
        )
        .with_for_update()
        .all()
    )


def _descontar_fefo(
    db: Session,
    producto: Catalogo_Producto,
    cantidad: int,
    allow_bodega_fallback: bool,
) -> Tuple[List[Dict[str, Any]], int]:
    """
    Descuenta hasta `cantidad` unidades del producto respetando FEFO y
    garantizando `Sato.cantidad >= 0`.
    Si el stock físico disponible es insuficiente, NO lanza `QuiebreStockError`:
    descuenta lo disponible hasta 0 (`Agotado`) y retorna `(afectados, restante)`.
    """
    restante = cantidad
    afectados: List[Dict[str, Any]] = []

    grupos = [ESTADOS_VITRINA]
    if allow_bodega_fallback:
        grupos.append(ESTADOS_BODEGA)

    for estados in grupos:
        if restante <= 0:
            break
        for sato in _satos_fefo(db, producto.sku, estados):
            if restante <= 0:
                break
            disponible_sato = max(0, int(sato.cantidad or 0))
            if disponible_sato <= 0:
                continue
            descuento = min(disponible_sato, restante)
            sato.cantidad = disponible_sato - descuento
            restante -= descuento
            estado_origen = sato.estado
            if sato.cantidad == 0:
                sato.estado = "Agotado"
            afectados.append({
                "_sato_uuid": sato.sato_id,   # uso interno (FK del log y descuento); se retira antes de responder
                "_fecha_vencimiento_date": sato.fecha_vencimiento,
                "sato_id": str(sato.sato_id),
                "sku": producto.sku,
                "lote": sato.lote,
                "ubicacion_id": sato.ubicacion_id,
                "estado_origen": estado_origen,
                "fecha_vencimiento": sato.fecha_vencimiento.isoformat() if sato.fecha_vencimiento else None,
                "descontado": descuento,
            })

    return afectados, restante


# ── Caso de uso principal ─────────────────────────────────────────────────

def _ya_procesado(db: Session, pos_source: str, external_ticket_id: str) -> bool:
    return (
        db.query(Venta_Externa.id)
        .filter(
            Venta_Externa.pos_source == pos_source,
            Venta_Externa.external_ticket_id == external_ticket_id,
        )
        .first()
        is not None
    )


def _resolver_fallback_bodega_efectivo(db: Session, allow_bodega_fallback: Optional[bool]) -> bool:
    if allow_bodega_fallback is not None:
        return bool(allow_bodega_fallback)
    return obtener_fallback_bodega_tenant(db)


def procesar_venta_externa(
    db: Session,
    ticket: ExternalSaleWebhookRequest,
    canal: str,
    user_id: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Aplica un ticket de venta externo al inventario (o lo registra en modo histórico ABC).
    NO hace commit: el llamador controla la transacción (commit único o SAVEPOINT por ticket).

    Comportamiento ante códigos desconocidos (Cuarentena de SKUs Huérfanos):
      • Si el ticket tiene >= 1 ítem conocido y >= 1 ítem desconocido:
          descuenta inmediatamente los ítems conocidos con FEFO, registra los
          desconocidos en `Venta_Externa_Huerfano` y marca la boleta como `PARCIAL`.
      • Si el ticket tiene 0 ítems conocidos (100% desconocidos):
          lanza `ProductoNoEncontradoError` para rechazar la boleta vacía.
    """
    pos_source = ticket.pos_source.strip()
    ticket_id = ticket.external_ticket_id.strip()
    es_historico = bool(ticket.modo_historico_abc)
    effective_fallback = _resolver_fallback_bodega_efectivo(db, ticket.allow_bodega_fallback)

    if _ya_procesado(db, pos_source, ticket_id):
        logger.info("[external_sales] Ticket duplicado ignorado: %s/%s", pos_source, ticket_id)
        return {
            "estado": "DUPLICADO",
            "estado_procesamiento": "COMPLETO",
            "mensaje": "El ticket ya había sido procesado. No se descontó stock nuevamente.",
            "external_ticket_id": ticket_id,
            "pos_source": pos_source,
            "total_descontado": 0,
            "unidades_deficit": 0,
            "total_valorizado": 0,
            "es_carga_historica": es_historico,
            "items_huerfanos_count": 0,
            "items_huerfanos": [],
            "satos_afectados": [],
        }

    # Consolidar ítems conocidos y separar ítems desconocidos (huérfanos)
    consolidado: "OrderedDict[str, Tuple[Catalogo_Producto, int, int]]" = OrderedDict()
    huerfanos_map: "OrderedDict[Tuple[str, str], Tuple[int, int]]" = OrderedDict()
    primer_error_no_encontrado: Optional[ProductoNoEncontradoError] = None

    for item in ticket.items:
        try:
            producto = _resolver_producto(db, item)
            precio_efectivo = _calcular_precio_efectivo(item, producto)
            subtotal_item = int(item.cantidad) * int(precio_efectivo)
            previo = consolidado.get(producto.sku)
            if previo:
                consolidado[producto.sku] = (
                    producto,
                    previo[1] + int(item.cantidad),
                    previo[2] + subtotal_item,
                )
            else:
                consolidado[producto.sku] = (producto, int(item.cantidad), subtotal_item)
        except ProductoNoEncontradoError as exc:
            if primer_error_no_encontrado is None:
                primer_error_no_encontrado = exc
            cod_ean = (item.ean or "").strip()
            cod_sku = (item.sku or "").strip()
            codigo_orig = cod_ean or cod_sku
            tipo_cod = "EAN" if cod_ean else "SKU"
            p_unit_huerfano = max(0, int(item.precio_unitario or 0))
            clave_h = (codigo_orig, tipo_cod)
            prev_h = huerfanos_map.get(clave_h)
            if prev_h:
                huerfanos_map[clave_h] = (
                    prev_h[0] + int(item.cantidad),
                    p_unit_huerfano if p_unit_huerfano > 0 else prev_h[1],
                )
            else:
                huerfanos_map[clave_h] = (int(item.cantidad), p_unit_huerfano)

    # Si 100% de los ítems de la boleta son desconocidos (0 conocidos), rechazar como antes
    if len(consolidado) == 0 and primer_error_no_encontrado is not None:
        raise primer_error_no_encontrado

    fecha_dt = _parsear_fecha_venta_dt(ticket.timestamp)
    total_unidades_vendidas = sum(cant for _, cant, _ in consolidado.values())
    total_valorizado = sum(sub for _, _, sub in consolidado.values())
    huerfanos_count = len(huerfanos_map)
    estado_proc = "PARCIAL" if huerfanos_count > 0 else "COMPLETO"
    items_huerfanos_out = [
        {
            "codigo_original": cod,
            "tipo_codigo": t_cod,
            "cantidad": cant_h,
            "precio_unitario": p_h,
        }
        for (cod, t_cod), (cant_h, p_h) in huerfanos_map.items()
    ]

    # ── Modo Carga Histórica 90d (Sin tocar SATOs, Logs ni Anomalías) ─────
    if es_historico:
        venta_hist = Venta_Externa(
            pos_source=pos_source,
            external_ticket_id=ticket_id,
            canal=canal,
            estado_procesamiento=estado_proc,
            items_huerfanos_count=huerfanos_count,
            total_unidades=total_unidades_vendidas,
            total_valorizado=total_valorizado,
            unidades_deficit=0,
            es_carga_historica=True,
            fecha_venta_origen=ticket.timestamp,
            fecha_venta_dt=fecha_dt,
        )
        db.add(venta_hist)
        db.flush()

        for producto, cant, sub in consolidado.values():
            p_unit = int(round(sub / cant)) if cant > 0 else 0
            db.add(
                Venta_Externa_Item(
                    venta_id=venta_hist.id,
                    sku=producto.sku,
                    cantidad=cant,
                    precio_unitario=p_unit,
                    subtotal=sub,
                    unidades_descontadas=0,
                    unidades_deficit=0,
                    es_carga_historica=True,
                    fecha_venta=fecha_dt,
                )
            )
        for (cod, t_cod), (cant_h, p_h) in huerfanos_map.items():
            db.add(
                Venta_Externa_Huerfano(
                    venta_id=venta_hist.id,
                    external_ticket_id=ticket_id,
                    pos_source=pos_source,
                    codigo_original=cod,
                    tipo_codigo=t_cod,
                    cantidad=cant_h,
                    precio_unitario=p_h,
                    estado="PENDIENTE",
                )
            )
        db.flush()

        return {
            "estado": "PARCIAL" if huerfanos_count > 0 else "PROCESADO",
            "estado_procesamiento": estado_proc,
            "mensaje": "Venta histórica registrada para clasificación ABC (sin descuento de stock físico).",
            "external_ticket_id": ticket_id,
            "pos_source": pos_source,
            "total_descontado": 0,
            "unidades_deficit": 0,
            "total_valorizado": total_valorizado,
            "es_carga_historica": True,
            "items_huerfanos_count": huerfanos_count,
            "items_huerfanos": items_huerfanos_out,
            "satos_afectados": [],
        }

    # ── Modo Operacional Normal (Descuento FEFO + Anomalía por Déficit) ───
    satos_afectados: List[Dict[str, Any]] = []
    resumen_items: List[Tuple[Catalogo_Producto, int, int, int, int]] = []
    total_deficit = 0

    for producto, cantidad, subtotal in consolidado.values():
        afectados_sku, deficit_sku = _descontar_fefo(
            db, producto, cantidad, effective_fallback
        )
        descontado_sku = cantidad - deficit_sku
        satos_afectados.extend(afectados_sku)
        total_deficit += deficit_sku
        resumen_items.append((producto, cantidad, subtotal, descontado_sku, deficit_sku))

        if deficit_sku > 0:
            donde = "Vitrina/Bodega" if effective_fallback else "Vitrina"
            db.add(
                Anomalia_Stock(
                    sku=producto.sku,
                    ubicacion_id=None,
                    tipo="VENTA_SIN_STOCK",
                    estado="ABIERTA",
                    unidades_deficit=deficit_sku,
                    referencia_ticket=f"{pos_source}:{ticket_id}",
                    detalles=(
                        f"Déficit de {deficit_sku} UN en venta externa POS={pos_source} "
                        f"ticket={ticket_id} (vendidas={cantidad}, descontadas en {donde}={descontado_sku})."
                    ),
                    reportado_por_id=user_id,
                    created_at=datetime.now(timezone.utc),
                )
            )

    total_descontado = sum(a["descontado"] for a in satos_afectados)

    venta = Venta_Externa(
        pos_source=pos_source,
        external_ticket_id=ticket_id,
        canal=canal,
        estado_procesamiento=estado_proc,
        items_huerfanos_count=huerfanos_count,
        total_unidades=total_unidades_vendidas,
        total_valorizado=total_valorizado,
        unidades_deficit=total_deficit,
        es_carga_historica=False,
        fecha_venta_origen=ticket.timestamp,
        fecha_venta_dt=fecha_dt,
    )
    db.add(venta)
    db.flush()  # Dispara el UNIQUE constraint y asigna venta.id dentro de la transacción/savepoint

    for afectado in satos_afectados:
        sato_uuid = afectado.pop("_sato_uuid")
        venc_date = afectado.pop("_fecha_vencimiento_date", None)
        db.add(
            Venta_Externa_Descuento(
                venta_id=venta.id,
                sku=afectado["sku"],
                sato_id=sato_uuid,
                lote=afectado.get("lote"),
                ubicacion_id=afectado.get("ubicacion_id"),
                estado_origen=afectado["estado_origen"],
                fecha_vencimiento=venc_date,
                unidades_descontadas=afectado["descontado"],
            )
        )
        db.add(
            Log_Transaccional(
                sato_id=sato_uuid,
                usuario_id=user_id,
                accion=ACCION_LOG_VENTA_EXTERNA,
                detalles=(
                    f"Venta externa POS={pos_source} ticket={ticket_id} canal={canal}. "
                    f"Descuento de {afectado['descontado']} uds SKU {afectado['sku']} "
                    f"desde {afectado['estado_origen']}."
                ),
            )
        )

    for producto, cant, sub, desc_sku, def_sku in resumen_items:
        p_unit = int(round(sub / cant)) if cant > 0 else 0
        db.add(
            Venta_Externa_Item(
                venta_id=venta.id,
                sku=producto.sku,
                cantidad=cant,
                precio_unitario=p_unit,
                subtotal=sub,
                unidades_descontadas=desc_sku,
                unidades_deficit=def_sku,
                es_carga_historica=False,
                fecha_venta=fecha_dt,
            )
        )

    for (cod, t_cod), (cant_h, p_h) in huerfanos_map.items():
        db.add(
            Venta_Externa_Huerfano(
                venta_id=venta.id,
                external_ticket_id=ticket_id,
                pos_source=pos_source,
                codigo_original=cod,
                tipo_codigo=t_cod,
                cantidad=cant_h,
                precio_unitario=p_h,
                estado="PENDIENTE",
            )
        )
    db.flush()

    if huerfanos_count > 0:
        mensaje = (
            f"Boleta procesada en estado PARCIAL: se descontaron los productos conocidos y "
            f"{huerfanos_count} código(s) nuevo(s) quedaron en cuarentena para vincular."
        )
    elif total_deficit > 0:
        mensaje = f"Venta externa aplicada con déficit de {total_deficit} unidad(es) registrada(s) en anomalías."
    else:
        mensaje = "Venta externa aplicada al inventario."

    return {
        "estado": "PARCIAL" if huerfanos_count > 0 else "PROCESADO",
        "estado_procesamiento": estado_proc,
        "mensaje": mensaje,
        "external_ticket_id": ticket_id,
        "pos_source": pos_source,
        "total_descontado": total_descontado,
        "unidades_deficit": total_deficit,
        "total_valorizado": total_valorizado,
        "es_carga_historica": False,
        "items_huerfanos_count": huerfanos_count,
        "items_huerfanos": items_huerfanos_out,
        "satos_afectados": satos_afectados,
    }


def procesar_lote_ventas_externas(
    db: Session,
    tickets: List[ExternalSaleWebhookRequest],
    pos_source: str,
    canal: str,
    user_id: Optional[int] = None,
    errores_parseo: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """
    Procesa un lote de tickets. Cada ticket corre en su propio SAVEPOINT:
    un SKU inexistente en un ticket 100% desconocido NO revierte los demás.
    Hace commit al final.
    """
    procesados = parciales = duplicados = fallidos = unidades = deficit_total = valorizado_total = huerfanos_total = 0
    es_carga_historica = any(bool(t.modo_historico_abc) for t in tickets)
    detalles_errores: List[Dict[str, Any]] = []

    try:
        for ticket in tickets:
            savepoint = db.begin_nested()
            try:
                resultado = procesar_venta_externa(db, ticket, canal=canal, user_id=user_id)
                savepoint.commit()
            except VentaExternaError as exc:
                savepoint.rollback()
                fallidos += 1
                detalles_errores.append({"external_ticket_id": ticket.external_ticket_id, "error": str(exc)})
                continue
            except IntegrityError:
                savepoint.rollback()
                duplicados += 1
                continue

            if resultado["estado"] == "DUPLICADO":
                duplicados += 1
            else:
                procesados += 1
                if resultado.get("estado_procesamiento") == "PARCIAL":
                    parciales += 1
                huerfanos_total += int(resultado.get("items_huerfanos_count", 0))
                unidades += int(resultado["total_descontado"])
                deficit_total += int(resultado.get("unidades_deficit", 0))
                valorizado_total += int(resultado.get("total_valorizado", 0))

        db.commit()
    except Exception:
        db.rollback()
        raise

    return {
        "mensaje": "Importación de ventas externas finalizada.",
        "pos_source": pos_source,
        "tickets_recibidos": len(tickets),
        "tickets_procesados": procesados,
        "tickets_parciales": parciales,
        "tickets_duplicados": duplicados,
        "tickets_fallidos": fallidos,
        "unidades_descontadas": unidades,
        "unidades_deficit": deficit_total,
        "total_valorizado": valorizado_total,
        "items_huerfanos_count": huerfanos_total,
        "es_carga_historica": es_carga_historica,
        "detalles_errores": detalles_errores,
        "errores_parseo": errores_parseo or [],
    }


# ── Parser flexible para POS sin API (CSV / TXT / JSON / XLSX) ───────────

_ALIAS_EAN = {"ean", "ean13", "ean_13", "codigo_barras", "cod_barras", "codigobarras", "barcode", "upc", "gtin"}
_ALIAS_SKU = {"sku", "codigo", "cod", "codigo_producto", "cod_producto", "item", "item_code", "producto_id",
              "id_producto", "articulo", "cod_articulo", "codigo_articulo", "plu"}
_ALIAS_CANT = {"cantidad", "cant", "qty", "quantity", "unidades", "units", "cantidad_vendida", "uds"}
_ALIAS_TICKET = {"ticket_id", "ticket", "boleta", "folio", "nro_boleta", "numero_boleta", "n_boleta", "documento",
                 "nro_documento", "num_documento", "transaccion", "transaction_id", "id_venta", "venta_id",
                 "order_id", "external_ticket_id"}
_ALIAS_FECHA = {"fecha", "fecha_hora", "timestamp", "datetime", "date", "fecha_venta"}
_ALIAS_PRECIO = {"precio", "precio_unitario", "unit_price", "price", "p_unitario", "valor_unitario",
                 "precio_venta", "pvp", "precio_neto", "precio_bruto"}
_ALIAS_SUBTOTAL = {"subtotal", "sub_total", "total", "total_linea", "monto", "monto_total",
                   "importe", "venta_total", "valor_total", "line_total"}

_DELIMITADORES = [",", ";", "\t", "|"]


def _normalizar_cabecera(nombre: str) -> str:
    nombre = unicodedata.normalize("NFKD", (nombre or "").strip().lower())
    nombre = "".join(c for c in nombre if not unicodedata.combining(c))
    for ch in (" ", "-", ".", "/", "°", "º", "#"):
        nombre = nombre.replace(ch, "_")
    while "__" in nombre:
        nombre = nombre.replace("__", "_")
    return nombre.strip("_")


def _buscar_columna(cabeceras: Dict[str, str], alias: set) -> Optional[str]:
    for normal, original in cabeceras.items():
        if normal in alias:
            return original
    return None


def _celda_texto(valor: Any) -> str:
    """Formatea valores de celdas (incluyendo int/float/datetime de Excel) sin sufijo '.0'."""
    if valor is None or isinstance(valor, bool):
        return ""
    if isinstance(valor, datetime):
        return valor.isoformat()
    if isinstance(valor, date):
        return valor.isoformat()
    if isinstance(valor, int):
        return str(valor)
    if isinstance(valor, float):
        return str(int(valor)) if valor.is_integer() else str(valor).strip()
    return str(valor).strip()


def _parsear_cantidad(valor: Any) -> int:
    if isinstance(valor, (int, float)) and not isinstance(valor, bool):
        if float(valor) != int(float(valor)):
            raise ValueError(f"cantidad no entera: {valor!r}")
        numero = int(float(valor))
        if numero <= 0:
            raise ValueError(f"cantidad debe ser > 0 (devoluciones/anulaciones no se procesan aquí): {valor!r}")
        return numero

    texto = str(valor if valor is not None else "").strip().replace(" ", "")
    if not texto:
        raise ValueError("cantidad vacía")
    if "," in texto and "." in texto:
        texto = texto.replace(".", "").replace(",", ".") if texto.rfind(",") > texto.rfind(".") else texto.replace(",", "")
    elif "," in texto:
        texto = texto.replace(",", ".")
    numero_f = float(texto)
    if numero_f != int(numero_f):
        raise ValueError(f"cantidad no entera: {valor!r}")
    numero = int(numero_f)
    if numero <= 0:
        raise ValueError(f"cantidad debe ser > 0 (devoluciones/anulaciones no se procesan aquí): {valor!r}")
    return numero


MAX_PARSE_ROWS = 50_000
MAX_PARSE_TICKETS = 5_000
MAX_XLSX_ZIP_ENTRIES = 200
MAX_XLSX_UNCOMPRESSED_BYTES = 25 * 1024 * 1024
MAX_XLSX_SINGLE_ENTRY_BYTES = 20 * 1024 * 1024
MAX_XLSX_COMPRESSION_RATIO = 50
MAX_XLSX_PHYSICAL_ROW_SCAN = 100_000
MAX_XLSX_COLUMNS = 100
MAX_PRECIO_UNITARIO_CLP = 100_000_000

_BLOCKED_XLSX_MIME_PREFIXES = (
    "text/html",
    "application/javascript",
    "text/javascript",
    "application/x-msdownload",
    "application/x-executable",
    "application/pdf",
    "image/",
    "video/",
    "audio/",
)


def _parsear_monto_opcional(valor: Any) -> Optional[int]:
    """Parsea un precio unitario o subtotal opcional en CLP (entero 0 <= monto <= 100.000.000)."""
    if valor is None or isinstance(valor, bool):
        return None
    if isinstance(valor, (int, float)):
        monto = int(round(float(valor)))
        if monto < 0 or monto > MAX_PRECIO_UNITARIO_CLP:
            raise ValueError(f"precio/monto fuera de rango permitido [0..{MAX_PRECIO_UNITARIO_CLP}]: {valor!r}")
        return monto

    texto = str(valor).strip()
    if not texto:
        return None
    for token in ("$", "CLP", "clp", " "):
        texto = texto.replace(token, "")
    if not texto:
        return None

    if "," in texto and "." in texto:
        texto = texto.replace(".", "").replace(",", ".") if texto.rfind(",") > texto.rfind(".") else texto.replace(",", "")
    elif "," in texto:
        partes = texto.split(",")
        if len(partes) == 2 and len(partes[1]) == 3 and partes[0].lstrip("-").isdigit():
            texto = texto.replace(",", "")
        else:
            texto = texto.replace(",", ".")
    elif "." in texto:
        partes = texto.split(".")
        if len(partes) > 2 or (len(partes) == 2 and len(partes[1]) == 3 and partes[0].lstrip("-").isdigit()):
            texto = texto.replace(".", "")

    monto = int(round(float(texto)))
    if monto < 0 or monto > MAX_PRECIO_UNITARIO_CLP:
        raise ValueError(f"precio/monto fuera de rango permitido [0..{MAX_PRECIO_UNITARIO_CLP}]: {valor!r}")
    return monto


def _detectar_delimitador(texto: str) -> str:
    muestra = "\n".join(texto.splitlines()[:10])
    try:
        return csv.Sniffer().sniff(muestra, delimiters="".join(_DELIMITADORES)).delimiter
    except csv.Error:
        cabecera = texto.splitlines()[0] if texto.splitlines() else ""
        return max(_DELIMITADORES, key=cabecera.count)


def _filas_desde_json(data: Any) -> Tuple[List[Dict[str, Any]], Optional[List[Dict[str, Any]]]]:
    if isinstance(data, dict):
        data = data.get("tickets", data.get("ventas", data.get("items", [data])))
    if not isinstance(data, list):
        raise VentaExternaError("JSON inválido: se esperaba una lista de tickets o de filas.")
    if len(data) > MAX_PARSE_ROWS:
        raise VentaExternaError(f"El archivo JSON supera el máximo de {MAX_PARSE_ROWS:,} elementos permitidos.")
    if data and all(isinstance(t, dict) and isinstance(t.get("items"), list) for t in data):
        if len(data) > MAX_PARSE_TICKETS:
            raise VentaExternaError(f"El archivo JSON supera el máximo de {MAX_PARSE_TICKETS:,} tickets permitidos.")
        return [], data
    return [r for r in data if isinstance(r, dict)], None


def _inspeccionar_contenedor_ooxml_seguro(content: bytes) -> None:
    """
    Inspecciona el directorio central ZIP de un `.xlsx` ANTES de invocar `openpyxl`:
      • Bloquea Zip Bombs (máx 200 entradas, 25 MB descomprimidos totales, 20 MB por entrada, ratio <= 50:1).
      • Bloquea Path Traversal (`..`, rutas absolutas).
      • Bloquea declaraciones XML `<!DOCTYPE` / `<!ENTITY` (XXE / Billion Laughs).
    """
    try:
        with zipfile.ZipFile(io.BytesIO(content), "r") as zf:
            infos = zf.infolist()
            if not infos:
                raise VentaExternaError("Archivo .xlsx vacío o corrupto.")
            if len(infos) > MAX_XLSX_ZIP_ENTRIES:
                raise VentaExternaError(
                    f"Archivo .xlsx rechazado por seguridad: excede {MAX_XLSX_ZIP_ENTRIES} entradas internas."
                )

            total_uncompressed = 0
            has_workbook_xml = False
            for zinfo in infos:
                zname = zinfo.filename or ""
                if ".." in zname or zname.startswith(("/", "\\")):
                    raise VentaExternaError("Archivo .xlsx rechazado por ruta interna insegura.")
                if zname.lower() == "xl/workbook.xml":
                    has_workbook_xml = True

                uncompressed = max(0, int(zinfo.file_size or 0))
                compressed = max(1, int(zinfo.compress_size or 1))
                total_uncompressed += uncompressed

                if uncompressed > MAX_XLSX_SINGLE_ENTRY_BYTES:
                    raise VentaExternaError(
                        "Archivo .xlsx rechazado por seguridad: entrada interna supera el tamaño máximo descomprimido (20 MB)."
                    )
                if total_uncompressed > MAX_XLSX_UNCOMPRESSED_BYTES:
                    raise VentaExternaError(
                        "Archivo .xlsx rechazado por seguridad: tamaño descomprimido total supera 25 MB (posible Zip Bomb)."
                    )
                if uncompressed > 65_536 and (uncompressed / compressed) > MAX_XLSX_COMPRESSION_RATIO:
                    raise VentaExternaError(
                        "Archivo .xlsx rechazado por seguridad: ratio de compresión anómalo (posible Zip Bomb)."
                    )

                if zname.lower().endswith((".xml", ".rels")):
                    with zf.open(zinfo, "r") as xml_fp:
                        head_chunk = xml_fp.read(4096).lower()
                        if b"<!doctype" in head_chunk or b"<!entity" in head_chunk:
                            raise VentaExternaError(
                                "Archivo .xlsx rechazado por seguridad: contiene entidades/DOCTYPE XML no permitidas."
                            )

            if not has_workbook_xml:
                raise VentaExternaError(
                    "Archivo .xlsx rechazado: no corresponde a un libro Excel OOXML válido (falta xl/workbook.xml)."
                )
    except VentaExternaError:
        raise
    except zipfile.BadZipFile as exc:
        raise VentaExternaError("Archivo .xlsx rechazado: contenedor ZIP/OOXML corrupto o inválido.") from exc


def _extraer_filas_xlsx_seguro(
    content: bytes,
    filename: str,
    content_type: Optional[str] = None,
) -> Tuple[List[Dict[str, Any]], int]:
    """
    Valida y lee un libro Excel `.xlsx` sin tocar `validar_archivo_texto_seguro`.
    Exige:
      1. Ausencia de doble extensión peligrosa y MIME peligroso.
      2. Firma ZIP/OOXML estricta `PK\\x03\\x04` e inspección anti-ZipBomb/XXE.
      3. Apertura válida mediante `openpyxl` en modo `read_only=True, data_only=True`
         con límites estrictos de columnas (`max_col=100`) y filas físicas (`100.000`).
    Retorna `(filas_dict, n_fila_primera_data)`.
    """
    clean_name = (filename or "").strip().lower()
    base_without_ext = clean_name[: -len(".xlsx")]
    for bad_ext in _BAD_DOUBLE_EXTENSIONS:
        if base_without_ext.endswith(bad_ext):
            raise VentaExternaError(f"Nombre de archivo rechazado por seguridad ('{filename}').")

    if content_type:
        ct_lower = content_type.strip().lower()
        if any(ct_lower.startswith(pref) for pref in _BLOCKED_XLSX_MIME_PREFIXES):
            raise VentaExternaError(f"Content-Type rechazado por seguridad para archivo Excel ('{content_type}').")

    if len(content) > 5 * 1024 * 1024:
        raise VentaExternaError("El archivo supera el tamaño máximo permitido (5 MB).")

    if len(content) < 4 or content[:4] != b"PK\x03\x04":
        raise VentaExternaError(
            "Archivo .xlsx rechazado: no contiene una firma binaria ZIP/OOXML válida (PK\\x03\\x04)."
        )

    _inspeccionar_contenedor_ooxml_seguro(content)

    try:
        import openpyxl
        wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    except Exception as exc:
        logger.warning("Fallo al abrir libro .xlsx '%s': %s", filename, exc)
        raise VentaExternaError("Archivo Excel (.xlsx) inválido, protegido o corrupto.") from exc

    try:
        ws = wb.active or (wb.worksheets[0] if wb.worksheets else None)
        if ws is None:
            raise VentaExternaError("El libro Excel (.xlsx) no contiene hojas de cálculo.")

        raw_rows: List[Tuple[int, Tuple[Any, ...]]] = []
        for row_idx, row_vals in enumerate(ws.iter_rows(max_col=MAX_XLSX_COLUMNS, values_only=True), start=1):
            if row_idx > MAX_XLSX_PHYSICAL_ROW_SCAN:
                raise VentaExternaError(
                    f"El archivo Excel supera el límite físico de {MAX_XLSX_PHYSICAL_ROW_SCAN:,} filas escaneables."
                )
            if row_vals and any(cell is not None and str(cell).strip() != "" for cell in row_vals):
                raw_rows.append((row_idx, row_vals))
                if len(raw_rows) > MAX_PARSE_ROWS + 5:
                    raise VentaExternaError("El archivo Excel supera el máximo de 50.000 filas permitidas.")

        if not raw_rows:
            raise VentaExternaError("El archivo Excel (.xlsx) no contiene filas de venta.")

        # Detectar fila de cabecera (por defecto la primera no vacía, o entre las primeras 10 si hay título)
        header_pos = 0
        for candidate_pos, (_, row_vals) in enumerate(raw_rows[:10]):
            norm_cols = {_normalizar_cabecera(_celda_texto(c)) for c in row_vals if c is not None}
            if (norm_cols & (_ALIAS_EAN | _ALIAS_SKU)) and (norm_cols & _ALIAS_CANT):
                header_pos = candidate_pos
                break

        header_row_num, header_tuple = raw_rows[header_pos]
        headers = [
            _celda_texto(col) if (_celda_texto(col) != "") else f"col_{i}"
            for i, col in enumerate(header_tuple)
        ]

        filas: List[Dict[str, Any]] = []
        for _, data_tuple in raw_rows[header_pos + 1 :]:
            fila_dict: Dict[str, Any] = {}
            for idx_col, col_name in enumerate(headers):
                val = data_tuple[idx_col] if idx_col < len(data_tuple) else None
                fila_dict[col_name] = val
            filas.append(fila_dict)

        return filas, header_row_num + 1
    finally:
        wb.close()


def parsear_archivo_ventas_legacy(
    content: bytes,
    filename: str,
    pos_source: str,
    allow_bodega_fallback: Optional[bool] = None,
    modo_historico_abc: bool = False,
    content_type: Optional[str] = None,
) -> Tuple[List[ExternalSaleWebhookRequest], List[Dict[str, Any]]]:
    """
    Convierte un archivo de cierre/exportación de un POS sin API en tickets.

    Formatos soportados:
      • .xlsx (Excel OOXML validado con firma PK\\x03\\x04, anti-ZipBomb/XXE y openpyxl)
      • .csv / .txt (delimitador autodetectado: , ; TAB |)
      • .json

    Si el archivo no trae columna de ticket/boleta, todo el archivo se trata
    como UN ticket cuyo ID es el hash SHA-256 del contenido → re-subir el mismo
    archivo es idempotente y no descuenta stock dos veces.
    """
    nombre = (filename or "").strip().lower()
    es_xlsx = nombre.endswith(".xlsx")

    if not content or (not es_xlsx and not content.strip()):
        raise VentaExternaError("El archivo está vacío.")

    huella = hashlib.sha256(content).hexdigest()[:16]
    ticket_por_defecto = f"ARCHIVO-{huella}"
    errores: List[Dict[str, Any]] = []

    filas: List[Dict[str, Any]]
    fila_inicio_num = 2
    es_json = False

    if es_xlsx:
        filas, fila_inicio_num = _extraer_filas_xlsx_seguro(content, filename, content_type=content_type)
    else:
        try:
            texto = validar_archivo_texto_seguro(filename=filename, content_type=content_type, raw_bytes=content)
        except ValueError as exc:
            raise VentaExternaError(str(exc)) from exc

        es_json = nombre.endswith(".json") or texto.lstrip().startswith(("[", "{"))
        if es_json:
            try:
                data = json.loads(texto)
            except json.JSONDecodeError as exc:
                raise VentaExternaError(f"JSON inválido: {exc}") from exc
            filas, estructurados = _filas_desde_json(data)
            if estructurados is not None:
                tickets_json: List[ExternalSaleWebhookRequest] = []
                for idx, t in enumerate(estructurados, start=1):
                    try:
                        tickets_json.append(
                            ExternalSaleWebhookRequest(
                                external_ticket_id=str(
                                    t.get("external_ticket_id") or t.get("ticket_id") or f"{ticket_por_defecto}-{idx}"
                                ),
                                pos_source=pos_source,
                                timestamp=t.get("timestamp"),
                                allow_bodega_fallback=allow_bodega_fallback,
                                modo_historico_abc=bool(t.get("modo_historico_abc", False) or modo_historico_abc),
                                items=t.get("items", []),
                            )
                        )
                    except ValidationError as exc:
                        errores.append({"ticket": idx, "error": exc.errors()[0].get("msg", str(exc))})
                return tickets_json, errores
            fila_inicio_num = 1
        else:
            delimitador = _detectar_delimitador(texto)
            reader = csv.DictReader(io.StringIO(texto), delimiter=delimitador)
            filas = []
            for row_csv in reader:
                filas.append(row_csv)
                if len(filas) > MAX_PARSE_ROWS:
                    raise VentaExternaError(
                        f"El archivo CSV/TXT supera el máximo de {MAX_PARSE_ROWS:,} filas permitidas."
                    )
            fila_inicio_num = 2

    if not filas:
        raise VentaExternaError("El archivo no contiene filas de venta.")
    if len(filas) > MAX_PARSE_ROWS:
        raise VentaExternaError(f"El archivo supera el máximo de {MAX_PARSE_ROWS:,} filas permitidas.")

    cabeceras = {_normalizar_cabecera(str(k)): str(k) for k in filas[0].keys() if k is not None}
    col_ean = _buscar_columna(cabeceras, _ALIAS_EAN)
    col_sku = _buscar_columna(cabeceras, _ALIAS_SKU)
    col_cant = _buscar_columna(cabeceras, _ALIAS_CANT)
    col_ticket = _buscar_columna(cabeceras, _ALIAS_TICKET)
    col_fecha = _buscar_columna(cabeceras, _ALIAS_FECHA)
    col_precio = _buscar_columna(cabeceras, _ALIAS_PRECIO)
    col_subtotal = _buscar_columna(cabeceras, _ALIAS_SUBTOTAL)

    if not (col_ean or col_sku):
        raise VentaExternaError(
            "No se encontró columna de producto. Use una cabecera como: ean, codigo_barras, barcode, sku o codigo."
        )
    if not col_cant:
        raise VentaExternaError("No se encontró columna de cantidad. Use: cantidad, qty o unidades.")

    agrupado: "OrderedDict[str, Dict[str, Any]]" = OrderedDict()
    for n_fila, fila in enumerate(filas, start=fila_inicio_num):
        try:
            ean = _celda_texto(fila.get(col_ean)) if col_ean else ""
            sku = _celda_texto(fila.get(col_sku)) if col_sku else ""
            if not ean and not sku:
                if not any(_celda_texto(v) for v in fila.values()):
                    continue  # fila en blanco
                raise ValueError("fila sin EAN ni SKU")

            cantidad = _parsear_cantidad(fila.get(col_cant))

            precio_unitario: Optional[int] = None
            if col_precio and fila.get(col_precio) is not None and _celda_texto(fila.get(col_precio)) != "":
                precio_unitario = _parsear_monto_opcional(fila.get(col_precio))
            elif col_subtotal and fila.get(col_subtotal) is not None and _celda_texto(fila.get(col_subtotal)) != "":
                subtotal_fila = _parsear_monto_opcional(fila.get(col_subtotal))
                if subtotal_fila is not None and cantidad > 0:
                    precio_unitario = int(round(subtotal_fila / cantidad))

            ticket_id = (_celda_texto(fila.get(col_ticket)) if col_ticket else "") or ticket_por_defecto
            fecha_str = (_celda_texto(fila.get(col_fecha)) or None) if col_fecha else None

            grupo = agrupado.setdefault(
                ticket_id,
                {
                    "timestamp": fecha_str,
                    "items": [],
                },
            )
            if grupo["timestamp"] is None and fecha_str is not None:
                grupo["timestamp"] = fecha_str

            grupo["items"].append(
                ExternalSaleItem(
                    ean=ean or None,
                    sku=sku or None,
                    cantidad=cantidad,
                    precio_unitario=precio_unitario,
                )
            )
        except (ValueError, ValidationError) as exc:
            mensaje = exc.errors()[0].get("msg") if isinstance(exc, ValidationError) else str(exc)
            errores.append({"fila": n_fila, "error": mensaje})

    tickets = [
        ExternalSaleWebhookRequest(
            external_ticket_id=ticket_id,
            pos_source=pos_source,
            timestamp=datos["timestamp"],
            allow_bodega_fallback=allow_bodega_fallback,
            modo_historico_abc=modo_historico_abc,
            items=datos["items"],
        )
        for ticket_id, datos in agrupado.items()
        if datos["items"]
    ]
    if len(tickets) > MAX_PARSE_TICKETS:
        raise VentaExternaError(
            f"El archivo supera el máximo de {MAX_PARSE_TICKETS:,} tickets por lote permitidos."
        )
    return tickets, errores


# ── Pre-visualización Segura (Dry-Run) ───────────────────────────────────

def previsualizar_archivo_ventas_dry_run(
    db: Session,
    content: bytes,
    filename: str,
    pos_source: str,
    allow_bodega_fallback: Optional[bool] = None,
    modo_historico_abc: bool = False,
    content_type: Optional[str] = None,
) -> ExternalSaleDryRunResponse:
    """
    Analiza un archivo .xlsx, .csv, .txt o .json en modo SOLO LECTURA sobre el
    nodo Primary, sin modificar `Sato` ni insertar registros en `Venta_Externa`.
    """
    prev_force = getattr(db, "_force_primary", False)
    setattr(db, "_force_primary", True)
    try:
        effective_fallback = _resolver_fallback_bodega_efectivo(db, allow_bodega_fallback)
        tickets, errores_parseo = parsear_archivo_ventas_legacy(
            content=content,
            filename=filename,
            pos_source=pos_source,
            allow_bodega_fallback=effective_fallback,
            modo_historico_abc=modo_historico_abc,
            content_type=content_type,
        )

        boletas_nuevas = 0
        boletas_duplicadas = 0
        boletas_parciales = 0
        boletas_sin_catalogo_100 = 0
        unidades_a_descontar = 0
        valorizado_estimado = 0
        codigos_desc_map: "OrderedDict[str, Dict[str, Any]]" = OrderedDict()

        for ticket in tickets:
            t_id = ticket.external_ticket_id.strip()
            p_src = ticket.pos_source.strip()
            if _ya_procesado(db, p_src, t_id):
                boletas_duplicadas += 1
                continue

            conocidos_en_ticket = 0
            desconocidos_en_ticket = 0
            unidades_ticket_conocidas = 0
            valor_ticket_conocido = 0

            for item in ticket.items:
                try:
                    prod = _resolver_producto(db, item)
                    conocidos_en_ticket += 1
                    p_ef = _calcular_precio_efectivo(item, prod)
                    unidades_ticket_conocidas += int(item.cantidad)
                    valor_ticket_conocido += int(item.cantidad) * int(p_ef)
                except ProductoNoEncontradoError:
                    desconocidos_en_ticket += 1
                    cod_ean = (item.ean or "").strip()
                    cod_sku = (item.sku or "").strip()
                    codigo_orig = cod_ean or cod_sku
                    tipo_cod = "EAN" if cod_ean else "SKU"
                    entry = codigos_desc_map.setdefault(
                        codigo_orig,
                        {
                            "codigo_original": codigo_orig,
                            "tipo_codigo": tipo_cod,
                            "unidades_totales": 0,
                            "tickets_set": set(),
                        },
                    )
                    entry["unidades_totales"] += int(item.cantidad)
                    entry["tickets_set"].add(t_id)

            if conocidos_en_ticket == 0 and desconocidos_en_ticket > 0:
                boletas_sin_catalogo_100 += 1
            else:
                boletas_nuevas += 1
                if desconocidos_en_ticket > 0:
                    boletas_parciales += 1
                if not modo_historico_abc:
                    unidades_a_descontar += unidades_ticket_conocidas
                valorizado_estimado += valor_ticket_conocido

        codigos_desconocidos_list = [
            DryRunUnknownCodeItem(
                codigo_original=v["codigo_original"],
                tipo_codigo=v["tipo_codigo"],
                unidades_totales=v["unidades_totales"],
                boletas_afectadas=len(v["tickets_set"]),
            )
            for v in codigos_desc_map.values()
        ]

        return ExternalSaleDryRunResponse(
            archivo_nombre=filename or "archivo_cierre",
            pos_source=pos_source,
            modo_historico_abc=modo_historico_abc,
            fallback_bodega_activo=effective_fallback,
            tickets_totales_leidos=len(tickets),
            boletas_nuevas_a_procesar=boletas_nuevas,
            boletas_duplicadas_omitidas=boletas_duplicadas,
            boletas_parciales_con_huerfanos=boletas_parciales,
            boletas_sin_catalogo_100=boletas_sin_catalogo_100,
            unidades_a_descontar=unidades_a_descontar,
            valorizado_estimado_clp=valorizado_estimado,
            codigos_desconocidos=codigos_desconocidos_list,
            errores_parseo=errores_parseo[:50],
        )
    finally:
        setattr(db, "_force_primary", prev_force)


# ── Bandeja de Cuarentena para SKUs Huérfanos ────────────────────────────

def listar_huerfanos_pendientes(db: Session) -> List[OrphanCodeGroupItem]:
    """
    Agrupa los códigos en cuarentena (`Venta_Externa_Huerfano` con `estado == 'PENDIENTE'`)
    por `codigo_original` para que el administrador pueda vincular un código una sola vez
    y resolver retroactivamente todas las boletas afectadas.
    """
    filas = (
        db.query(Venta_Externa_Huerfano)
        .filter(Venta_Externa_Huerfano.estado == "PENDIENTE")
        .order_by(Venta_Externa_Huerfano.created_at.desc(), Venta_Externa_Huerfano.id.desc())
        .all()
    )
    grupos: "OrderedDict[str, Dict[str, Any]]" = OrderedDict()
    for row in filas:
        g = grupos.setdefault(
            row.codigo_original,
            {
                "codigo_original": row.codigo_original,
                "tipo_codigo": row.tipo_codigo or "EAN",
                "unidades_pendientes": 0,
                "tickets_set": OrderedDict(),
                "precio_unitario_sugerido": 0,
                "primera_deteccion": row.created_at.isoformat() if row.created_at else None,
            },
        )
        g["unidades_pendientes"] += int(row.cantidad or 0)
        g["tickets_set"][row.external_ticket_id] = True
        if int(row.precio_unitario or 0) > 0 and g["precio_unitario_sugerido"] == 0:
            g["precio_unitario_sugerido"] = int(row.precio_unitario)
        if row.created_at:
            iso_dt = row.created_at.isoformat()
            if g["primera_deteccion"] is None or iso_dt < g["primera_deteccion"]:
                g["primera_deteccion"] = iso_dt

    return [
        OrphanCodeGroupItem(
            codigo_original=g["codigo_original"],
            tipo_codigo=g["tipo_codigo"],
            unidades_pendientes=g["unidades_pendientes"],
            boletas_afectadas=len(g["tickets_set"]),
            precio_unitario_sugerido=g["precio_unitario_sugerido"],
            primera_deteccion=g["primera_deteccion"],
            tickets_muestra=list(g["tickets_set"].keys())[:5],
        )
        for g in grupos.values()
    ]


def resolver_huerfano_retroactivo(
    db: Session,
    payload: ResolveOrphanRequest,
    user_id: Optional[int] = None,
) -> ResolveOrphanResponse:
    """
    Resuelve todos los registros pendientes de `codigo_original` en `Venta_Externa_Huerfano`:
      1. Vincula el código a un SKU existente o crea el producto al vuelo.
      2. Aplica el descuento FEFO retroactivo en las boletas operativas afectadas.
      3. Registra `Venta_Externa_Item` y `Venta_Externa_Descuento`.
      4. Promueve las boletas sin más huérfanos pendientes de `PARCIAL` a `COMPLETO`.
    NO hace commit: el router coordina `db.commit()`, recálculo ABC e invalidación de caché.
    """
    prev_force = getattr(db, "_force_primary", False)
    setattr(db, "_force_primary", True)
    try:
        codigo_orig = payload.codigo_original.strip()
        pendientes = (
            db.query(Venta_Externa_Huerfano)
            .filter(
                Venta_Externa_Huerfano.codigo_original == codigo_orig,
                Venta_Externa_Huerfano.estado == "PENDIENTE",
            )
            .order_by(Venta_Externa_Huerfano.id.asc())
            .with_for_update()
            .all()
        )
        if not pendientes:
            raise VentaExternaError(
                f"No existen registros en cuarentena pendientes para el código '{codigo_orig}'."
            )

        if payload.accion == "VINCULAR_EXISTENTE":
            sku_target = (payload.sku_existente or "").strip()
            producto = (
                db.query(Catalogo_Producto)
                .options(noload("*"))
                .filter(Catalogo_Producto.sku == sku_target)
                .with_for_update()
                .first()
            )
            if not producto:
                raise ProductoNoEncontradoError(
                    f"No se encontró el producto con SKU '{sku_target}' en el catálogo."
                )
            if payload.actualizar_ean_producto and codigo_orig != producto.sku:
                conflicto_ean = (
                    db.query(Catalogo_Producto.sku)
                    .filter(Catalogo_Producto.ean == codigo_orig, Catalogo_Producto.sku != producto.sku)
                    .first()
                )
                if not conflicto_ean:
                    producto.ean = codigo_orig
                    db.flush()
        else:
            np = payload.nuevo_producto
            assert np is not None
            sku_nuevo = np.sku.strip().upper()
            ean_nuevo = (np.ean or "").strip() or codigo_orig
            existente_sku = db.query(Catalogo_Producto).filter(Catalogo_Producto.sku == sku_nuevo).first()
            if existente_sku:
                raise VentaExternaError(f"Ya existe un producto con el SKU '{sku_nuevo}'.")
            existente_ean = db.query(Catalogo_Producto).filter(Catalogo_Producto.ean == ean_nuevo).first()
            if existente_ean:
                raise VentaExternaError(f"Ya existe un producto con el EAN '{ean_nuevo}' (SKU: {existente_ean.sku}).")

            producto = Catalogo_Producto(
                sku=sku_nuevo,
                nombre=np.nombre.strip(),
                ean=ean_nuevo,
                precio=max(0, int(np.precio or 0)),
                costo_unitario=max(0, int(np.costo_unitario or 0)),
                temperatura_requerida=(np.temperatura_requerida or "SECO").strip().upper(),
                unidades_por_caja=1,
                unidad_medida="UN",
                stock_minimo=5,
                dias_alerta_vencimiento=7,
                activo=True,
                created_at=datetime.now(timezone.utc),
            )
            db.add(producto)
            db.flush()

        effective_fallback = obtener_fallback_bodega_tenant(db)
        ahora = datetime.now(timezone.utc)
        unidades_descontadas_total = 0
        unidades_deficit_total = 0
        boletas_promovidas = 0
        ventas_tocadas: Dict[int, Venta_Externa] = {}

        for h in pendientes:
            venta = ventas_tocadas.get(h.venta_id)
            if venta is None:
                venta = (
                    db.query(Venta_Externa)
                    .filter(Venta_Externa.id == h.venta_id)
                    .with_for_update()
                    .first()
                )
                if venta is not None:
                    ventas_tocadas[h.venta_id] = venta

            if venta is None or venta.estado_procesamiento == "REVERTIDO":
                h.estado = "CANCELADO"
                h.resolved_at = ahora
                continue

            cant = max(1, int(h.cantidad or 1))
            p_unit = (
                int(h.precio_unitario)
                if int(h.precio_unitario or 0) > 0
                else (int(producto.precio) if (producto.precio and producto.precio > 0) else int(producto.costo_unitario or 0))
            )
            subtotal = cant * p_unit

            if venta.es_carga_historica:
                desc_sku = 0
                def_sku = 0
            else:
                afectados_sku, def_sku = _descontar_fefo(db, producto, cant, effective_fallback)
                desc_sku = cant - def_sku
                unidades_descontadas_total += desc_sku
                unidades_deficit_total += def_sku

                for af in afectados_sku:
                    sato_uuid = af.pop("_sato_uuid")
                    venc_date = af.pop("_fecha_vencimiento_date", None)
                    db.add(
                        Venta_Externa_Descuento(
                            venta_id=venta.id,
                            sku=producto.sku,
                            sato_id=sato_uuid,
                            lote=af.get("lote"),
                            ubicacion_id=af.get("ubicacion_id"),
                            estado_origen=af["estado_origen"],
                            fecha_vencimiento=venc_date,
                            unidades_descontadas=af["descontado"],
                        )
                    )
                    db.add(
                        Log_Transaccional(
                            sato_id=sato_uuid,
                            usuario_id=user_id,
                            accion=ACCION_LOG_VENTA_EXTERNA,
                            detalles=(
                                f"Descuento retroactivo de SKU huérfano ({codigo_orig} -> {producto.sku}) "
                                f"en ticket {venta.pos_source}:{venta.external_ticket_id}: "
                                f"{af['descontado']} uds desde {af['estado_origen']}."
                            ),
                        )
                    )

                if def_sku > 0:
                    db.add(
                        Anomalia_Stock(
                            sku=producto.sku,
                            ubicacion_id=None,
                            tipo="VENTA_SIN_STOCK",
                            estado="ABIERTA",
                            unidades_deficit=def_sku,
                            referencia_ticket=f"{venta.pos_source}:{venta.external_ticket_id}",
                            detalles=(
                                f"Déficit retroactivo de {def_sku} UN al vincular código huérfano {codigo_orig} "
                                f"en ticket {venta.pos_source}:{venta.external_ticket_id}."
                            ),
                            reportado_por_id=user_id,
                            created_at=ahora,
                        )
                    )

            db.add(
                Venta_Externa_Item(
                    venta_id=venta.id,
                    sku=producto.sku,
                    cantidad=cant,
                    precio_unitario=p_unit,
                    subtotal=subtotal,
                    unidades_descontadas=desc_sku,
                    unidades_deficit=def_sku,
                    es_carga_historica=bool(venta.es_carga_historica),
                    fecha_venta=venta.fecha_venta_dt or ahora,
                )
            )

            venta.total_unidades = int(venta.total_unidades or 0) + cant
            venta.total_valorizado = int(venta.total_valorizado or 0) + subtotal
            venta.unidades_deficit = int(venta.unidades_deficit or 0) + def_sku

            h.estado = "RESUELTO"
            h.sku_vinculado = producto.sku
            h.resolved_at = ahora

        db.flush()

        for venta in ventas_tocadas.values():
            restantes = (
                db.query(Venta_Externa_Huerfano.id)
                .filter(
                    Venta_Externa_Huerfano.venta_id == venta.id,
                    Venta_Externa_Huerfano.estado == "PENDIENTE",
                )
                .count()
            )
            venta.items_huerfanos_count = restantes
            if restantes == 0 and venta.estado_procesamiento == "PARCIAL":
                venta.estado_procesamiento = "COMPLETO"
                boletas_promovidas += 1

        db.flush()

        return ResolveOrphanResponse(
            mensaje=(
                f"Código '{codigo_orig}' vinculado a {producto.sku} ({producto.nombre}). "
                f"Se actualizaron {len(pendientes)} registro(s) y se descontaron {unidades_descontadas_total} unidad(es) FEFO."
            ),
            codigo_original=codigo_orig,
            sku_vinculado=producto.sku,
            nombre_producto=producto.nombre,
            registros_resueltos=len(pendientes),
            boletas_actualizadas_a_completo=boletas_promovidas,
            unidades_descontadas_retroactivas=unidades_descontadas_total,
            unidades_deficit=unidades_deficit_total,
        )
    finally:
        setattr(db, "_force_primary", prev_force)


# ── Inspector de Boleta (Drill-Down) y Reversión Total ───────────────────

def obtener_detalle_venta_externa(
    db: Session,
    venta_id: int,
) -> ExternalSaleTicketDetailResponse:
    """
    Devuelve la radiografía completa de una boleta sincronizada:
      • Productos vendidos y valorización (`Venta_Externa_Item`)
      • Lotes, fechas de vencimiento y ubicaciones físicas exactas (`Venta_Externa_Descuento`)
      • Códigos en cuarentena (`Venta_Externa_Huerfano`)
    """
    venta = db.query(Venta_Externa).filter(Venta_Externa.id == venta_id).first()
    if not venta:
        raise LookupError(f"No se encontró la boleta con ID {venta_id}.")

    items_rows = (
        db.query(Venta_Externa_Item, Catalogo_Producto.nombre, Catalogo_Producto.ean)
        .outerjoin(
            Catalogo_Producto,
            (Venta_Externa_Item.tenant_id == Catalogo_Producto.tenant_id)
            & (Venta_Externa_Item.sku == Catalogo_Producto.sku),
        )
        .filter(Venta_Externa_Item.venta_id == venta.id)
        .order_by(Venta_Externa_Item.id.asc())
        .all()
    )

    descuentos_rows = (
        db.query(Venta_Externa_Descuento, Catalogo_Producto.nombre, Patente.area_pasillo)
        .outerjoin(
            Catalogo_Producto,
            (Venta_Externa_Descuento.tenant_id == Catalogo_Producto.tenant_id)
            & (Venta_Externa_Descuento.sku == Catalogo_Producto.sku),
        )
        .outerjoin(
            Patente,
            (Venta_Externa_Descuento.tenant_id == Patente.tenant_id)
            & (Venta_Externa_Descuento.ubicacion_id == Patente.id_patente),
        )
        .filter(Venta_Externa_Descuento.venta_id == venta.id)
        .order_by(Venta_Externa_Descuento.id.asc())
        .all()
    )

    huerfanos_rows = (
        db.query(Venta_Externa_Huerfano)
        .filter(Venta_Externa_Huerfano.venta_id == venta.id)
        .order_by(Venta_Externa_Huerfano.id.asc())
        .all()
    )

    estado_proc = venta.estado_procesamiento or "COMPLETO"
    unidades_efectivas = max(0, int(venta.total_unidades or 0) - int(venta.unidades_deficit or 0))
    puede_revertirse = True
    motivo_bloqueo: Optional[str] = None

    if estado_proc == "REVERTIDO":
        puede_revertirse = False
        motivo_bloqueo = "Esta boleta ya fue anulada/revertida."
    elif not venta.es_carga_historica and unidades_efectivas > 0 and len(descuentos_rows) == 0:
        puede_revertirse = False
        motivo_bloqueo = (
            "Boleta anterior a la trazabilidad estructurada por lote: "
            "no posee desglose automático de SATO para restitución."
        )

    return ExternalSaleTicketDetailResponse(
        id=venta.id,
        pos_source=venta.pos_source,
        external_ticket_id=venta.external_ticket_id,
        canal=venta.canal,
        estado_procesamiento=estado_proc,
        total_unidades=int(venta.total_unidades or 0),
        unidades_deficit=int(venta.unidades_deficit or 0),
        total_valorizado=int(venta.total_valorizado or 0),
        es_carga_historica=bool(venta.es_carga_historica),
        items_huerfanos_count=int(venta.items_huerfanos_count or 0),
        fecha_venta_origen=venta.fecha_venta_origen,
        fecha_recepcion=venta.fecha_recepcion.isoformat() if venta.fecha_recepcion else None,
        revertido_por=venta.revertido_por,
        revertido_at=venta.revertido_at.isoformat() if venta.revertido_at else None,
        motivo_reversion=venta.motivo_reversion,
        puede_revertirse=puede_revertirse,
        motivo_bloqueo_reversion=motivo_bloqueo,
        items=[
            ExternalSaleTicketItemDetail(
                sku=it.sku,
                nombre_producto=nom or it.sku,
                ean=ean,
                cantidad=int(it.cantidad or 0),
                precio_unitario=int(it.precio_unitario or 0),
                subtotal=int(it.subtotal or 0),
                unidades_descontadas=int(it.unidades_descontadas or 0),
                unidades_deficit=int(it.unidades_deficit or 0),
            )
            for it, nom, ean in items_rows
        ],
        descuentos_fefo=[
            ExternalSaleTicketFefoLotDetail(
                id=d.id,
                sku=d.sku,
                nombre_producto=nom or d.sku,
                sato_id=str(d.sato_id) if d.sato_id else None,
                lote=d.lote,
                ubicacion_id=d.ubicacion_id,
                nombre_ubicacion=area_pasillo or d.ubicacion_id or d.estado_origen,
                estado_origen=d.estado_origen,
                fecha_vencimiento=d.fecha_vencimiento.isoformat() if d.fecha_vencimiento else None,
                unidades_descontadas=int(d.unidades_descontadas or 0),
            )
            for d, nom, area_pasillo in descuentos_rows
        ],
        huerfanos=[
            ExternalSaleTicketOrphanDetail(
                id=h.id,
                codigo_original=h.codigo_original,
                tipo_codigo=h.tipo_codigo,
                cantidad=int(h.cantidad or 0),
                precio_unitario=int(h.precio_unitario or 0),
                estado=h.estado,
                sku_vinculado=h.sku_vinculado,
            )
            for h in huerfanos_rows
        ],
    )


def revertir_venta_externa(
    db: Session,
    venta_id: int,
    motivo: str,
    user_id: Optional[int] = None,
    user_nombre: Optional[str] = None,
) -> RevertirVentaResponse:
    """
    Anula / revierte una boleta externa de forma total y atómica:
      1. Bloquea la fila `Venta_Externa` con `SELECT ... FOR UPDATE`.
      2. Verifica que no esté revertida y que posea desglose en `Venta_Externa_Descuento`
         (si descontó unidades físicas).
      3. Bloquea los `Sato` afectados en orden determinista (`sato_id ASC`) y restituye
         sus unidades y su estado original (`Vitrina` o `Bodega`).
      4. Cierra cualquier `Anomalia_Stock` abierta asociada al ticket.
      5. Cancela huérfanos pendientes, anula el peso en `Venta_Externa_Item` para no
         contaminar el cálculo ABC, y registra `REVERSION_VENTA_EXTERNA` en `Log_Transaccional`.
    NO hace commit: el router coordina `db.commit()`, recálculo ABC e invalidación de caché.
    """
    prev_force = getattr(db, "_force_primary", False)
    setattr(db, "_force_primary", True)
    try:
        venta = (
            db.query(Venta_Externa)
            .filter(Venta_Externa.id == venta_id)
            .with_for_update()
            .first()
        )
        if not venta:
            raise LookupError(f"No se encontró la boleta con ID {venta_id}.")

        if (venta.estado_procesamiento or "COMPLETO") == "REVERTIDO":
            raise VentaExternaError(
                f"La boleta '{venta.external_ticket_id}' ya fue revertida anteriormente."
            )

        descuentos = (
            db.query(Venta_Externa_Descuento)
            .filter(Venta_Externa_Descuento.venta_id == venta.id)
            .order_by(Venta_Externa_Descuento.sato_id.asc(), Venta_Externa_Descuento.id.asc())
            .all()
        )

        unidades_efectivas = max(0, int(venta.total_unidades or 0) - int(venta.unidades_deficit or 0))
        if not venta.es_carga_historica and unidades_efectivas > 0 and len(descuentos) == 0:
            raise VentaExternaError(
                "No es posible revertir esta boleta porque fue registrada antes de activar "
                "el desglose estructurado por lote (Venta_Externa_Descuento)."
            )

        ahora = datetime.now(timezone.utc)
        autor = (user_nombre or "").strip() or (f"Usuario #{user_id}" if user_id else "Admin")
        unidades_restituidas = 0
        satos_restituidos_ids = set()

        # Bloquear SATOs en orden determinista por sato_id ASC para evitar deadlocks
        sato_uuids = sorted({d.sato_id for d in descuentos if d.sato_id is not None}, key=lambda u: str(u))
        satos_map: Dict[Any, Sato] = {}
        if sato_uuids:
            satos_locked = (
                db.query(Sato)
                .filter(Sato.sato_id.in_(sato_uuids))
                .order_by(Sato.sato_id.asc())
                .with_for_update()
                .all()
            )
            satos_map = {s.sato_id: s for s in satos_locked}

        for d in descuentos:
            cant_dev = max(0, int(d.unidades_descontadas or 0))
            if cant_dev <= 0 or d.sato_id is None:
                continue
            sato = satos_map.get(d.sato_id)
            if sato is None:
                continue
            sato.cantidad = max(0, int(sato.cantidad or 0)) + cant_dev
            if sato.estado == "Agotado" or sato.estado not in ("Vitrina", "Bodega", "Bodega Recepcion"):
                sato.estado = d.estado_origen if d.estado_origen in ("Vitrina", "Bodega", "Bodega Recepcion") else "Vitrina"
            unidades_restituidas += cant_dev
            satos_restituidos_ids.add(str(sato.sato_id))

            db.add(
                Log_Transaccional(
                    sato_id=sato.sato_id,
                    usuario_id=user_id,
                    accion=ACCION_LOG_REVERSION_VENTA,
                    detalles=(
                        f"Reversión de boleta externa POS={venta.pos_source} ticket={venta.external_ticket_id}. "
                        f"Restituidas +{cant_dev} uds SKU {d.sku} al SATO (estado={sato.estado}). "
                        f"Motivo: {motivo}"
                    ),
                )
            )

        # Cerrar anomalías abiertas originadas por este ticket
        ref_ticket = f"{venta.pos_source}:{venta.external_ticket_id}"
        anomalias_ticket = (
            db.query(Anomalia_Stock)
            .filter(
                Anomalia_Stock.referencia_ticket == ref_ticket,
                Anomalia_Stock.estado == "ABIERTA",
            )
            .with_for_update()
            .all()
        )
        for anom in anomalias_ticket:
            anom.estado = "RESUELTA"
            anom.resolved_at = ahora
            anom.detalles = f"{anom.detalles or ''} [Cerrada por reversión de boleta: {motivo}]".strip()

        # Cancelar huérfanos pendientes de la boleta
        huerfanos_pend = (
            db.query(Venta_Externa_Huerfano)
            .filter(
                Venta_Externa_Huerfano.venta_id == venta.id,
                Venta_Externa_Huerfano.estado == "PENDIENTE",
            )
            .with_for_update()
            .all()
        )
        for h in huerfanos_pend:
            h.estado = "CANCELADO"
            h.resolved_at = ahora

        # Anular el peso de los ítems en el cálculo ABC sin borrar el historial del ticket
        items_venta = (
            db.query(Venta_Externa_Item)
            .filter(Venta_Externa_Item.venta_id == venta.id)
            .with_for_update()
            .all()
        )
        for it in items_venta:
            it.cantidad = 0
            it.subtotal = 0
            it.unidades_descontadas = 0
            it.unidades_deficit = 0

        venta.estado_procesamiento = "REVERTIDO"
        venta.items_huerfanos_count = 0
        venta.revertido_por = autor
        venta.revertido_at = ahora
        venta.motivo_reversion = motivo
        db.flush()

        return RevertirVentaResponse(
            mensaje=(
                f"Boleta '{venta.external_ticket_id}' revertida exitosamente. "
                f"Se restituyeron {unidades_restituidas} unidad(es) en {len(satos_restituidos_ids)} lote(s) SATO."
            ),
            venta_id=venta.id,
            external_ticket_id=venta.external_ticket_id,
            estado_procesamiento="REVERTIDO",
            unidades_restituidas=unidades_restituidas,
            satos_restituidos_count=len(satos_restituidos_ids),
            anomalias_cerradas_count=len(anomalias_ticket),
            revertido_por=autor,
            revertido_at=ahora.isoformat(),
        )
    finally:
        setattr(db, "_force_primary", prev_force)

