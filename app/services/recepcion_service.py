from datetime import date, timedelta
from typing import Optional, Tuple
from fastapi import BackgroundTasks
from sqlalchemy.orm import Session
from sqlalchemy import or_

from app.models import Sato, Catalogo_Producto, Log_Transaccional, ASN_Padre, ASN_Detalle, Patente
from app.core.utils import parse_gs1_128


class DuplicateLPNError(ValueError):
    pass


def _resolver_producto_recepcion(db: Session, codigo_leido: str) -> Tuple[Optional[Catalogo_Producto], bool]:
    """
    Resuelve un código leído por pistola láser GS1-128 o cámara contra el Catálogo:
      1. Si coincide con `dun14`, retorna `(producto, True)` indicando que se escaneó una CAJA mayorista.
      2. Si coincide con `ean` (exacto, sin '0' inicial de GTIN-14 o sin ceros a la izquierda) o `sku`,
         retorna `(producto, False)`.
    """
    code = (codigo_leido or "").strip()
    if not code:
        return None, False

    variantes = {code}
    if len(code) == 14 and code.startswith("0"):
        variantes.add(code[1:])
    sin_ceros = code.lstrip("0")
    if sin_ceros:
        variantes.add(sin_ceros)

    # 1. Priorizar match por DUN-14 (Caja mayorista)
    prod_dun = (
        db.query(Catalogo_Producto)
        .filter(Catalogo_Producto.dun14.in_(list(variantes)))
        .first()
    )
    if prod_dun:
        return prod_dun, True

    # 2. Match por EAN-13 / GTIN-14 o SKU
    prod_ean = (
        db.query(Catalogo_Producto)
        .filter(
            or_(
                Catalogo_Producto.ean.in_(list(variantes)),
                Catalogo_Producto.sku == code,
            )
        )
        .first()
    )
    if prod_ean:
        return prod_ean, False

    return None, False


def _validar_cadena_frio(db: Session, producto: Catalogo_Producto, ubicacion_id: Optional[str]):
    """Verifica que un producto REFRIGERADO o CONGELADO no sea ubicado en una bodega SECA."""
    if not ubicacion_id:
        return
    patente = db.query(Patente).filter(Patente.id_patente == ubicacion_id).first()
    if not patente:
        return

    temp_prod = (producto.temperatura_requerida or "SECO").upper()
    tipo_ubic = (patente.tipo_ubicacion or "").upper()

    if temp_prod == "CONGELADO" and tipo_ubic in ("BODEGA_SECOS", "CAMARA_FRIO"):
        raise ValueError(
            f"Alerta Cadena de Frío: El producto {producto.sku} ({producto.nombre}) requiere "
            f"almacenamiento CONGELADO y no puede ingresarse en '{patente.area_pasillo}' ({tipo_ubic})."
        )
    if temp_prod == "REFRIGERADO" and tipo_ubic == "BODEGA_SECOS":
        raise ValueError(
            f"Alerta Cadena de Frío: El producto {producto.sku} ({producto.nombre}) requiere "
            f"almacenamiento REFRIGERADO y no puede ingresarse en '{patente.area_pasillo}' (BODEGA_SECOS)."
        )


def recepcionar_pallet(
    db: Session,
    barcode_text: str,
    ubicacion_id: str | None = None,
    user_id: int | None = None,
    modo_ingreso: str | None = "AUTO",
    cantidad_recibida: int | None = None,
) -> dict:
    """
    Recepciona un pallet o caja de producto individual (GS1-128 / EAN / DUN-14).
    Convierte automáticamente cajas DUN-14 a unidades vendibles según `unidades_por_caja`.
    """
    datos_extraidos = parse_gs1_128(barcode_text)
    codigo_leido = datos_extraidos.get("ean", "")

    producto, match_por_dun14 = _resolver_producto_recepcion(db, codigo_leido)
    if not producto:
        raise ValueError(
            f"El código EAN/DUN-14 '{codigo_leido}' no existe en el Catálogo. "
            f"Regístrelo primero en el Catálogo de Productos."
        )

    _validar_cadena_frio(db, producto, ubicacion_id)

    # Si no trae fecha de vencimiento pero el producto tiene dias_vida_util configurados, calcularla
    vencimiento = datos_extraidos.get("vencimiento")
    if not vencimiento and producto.dias_vida_util and producto.dias_vida_util > 0:
        vencimiento = date.today() + timedelta(days=producto.dias_vida_util)
        datos_extraidos["vencimiento"] = vencimiento

    exige_fefo = bool(producto.controla_vencimiento) or (producto.tolerancia_vencimiento_dias or 0) > 0
    if exige_fefo:
        if not datos_extraidos.get("vencimiento") or not datos_extraidos.get("lote"):
            raise ValueError(
                f"El producto {producto.sku} ({producto.nombre}) controla vencimiento FEFO. "
                f"Debe indicar Lote y Fecha de Vencimiento."
            )

        dias_restantes = (datos_extraidos["vencimiento"] - date.today()).days
        if dias_restantes < (producto.tolerancia_vencimiento_dias or 0):
            raise ValueError(
                f"Rechazo FEFO en Puerta: El producto {producto.sku} vence en {dias_restantes} días, "
                f"menor a la tolerancia mínima de recepción ({producto.tolerancia_vencimiento_dias} días)."
            )

    factor_caja = max(1, producto.unidades_por_caja or 1)
    modo = (modo_ingreso or "AUTO").upper()
    es_caja = (modo == "CAJAS") or (modo == "AUTO" and match_por_dun14)

    cantidad_base = (
        cantidad_recibida
        if (cantidad_recibida is not None and cantidad_recibida > 0)
        else max(1, int(datos_extraidos.get("cantidad", 1) or 1))
    )
    unidades_totales = cantidad_base * factor_caja if es_caja else cantidad_base

    nuevo_sato = Sato(
        tipo_sato="PRODUCTO",
        sku=producto.sku,
        lote=datos_extraidos.get("lote"),
        fecha_vencimiento=datos_extraidos.get("vencimiento"),
        cantidad=unidades_totales,
        estado="Bodega",
        ubicacion_id=ubicacion_id,
    )
    db.add(nuevo_sato)
    db.flush()

    detalle_empaque = (
        f"{cantidad_base} caja(s) x {factor_caja} un/caja = {unidades_totales} un"
        if es_caja and factor_caja > 1
        else f"{unidades_totales} {producto.unidad_medida or 'UN'}"
    )
    nuevo_log = Log_Transaccional(
        sato_id=nuevo_sato.sato_id,
        usuario_id=user_id,
        accion="CREACION_INGRESO_BODEGA",
        detalles=f"Ingreso {detalle_empaque} ({producto.sku}). Lote: {datos_extraidos.get('lote')}",
    )
    db.add(nuevo_log)
    db.commit()
    db.refresh(nuevo_sato)

    return {
        "mensaje": f"Recepción exitosa: +{unidades_totales} {producto.unidad_medida or 'UN'} de {producto.nombre} ({detalle_empaque}).",
        "sato_id": nuevo_sato.sato_id,
        "ean_leido": datos_extraidos["ean"],
        "sku": producto.sku,
        "nombre_producto": producto.nombre,
        "unidades_ingresadas": unidades_totales,
        "unidades_por_caja": factor_caja,
        "es_caja_dun14": es_caja,
    }


def recepcionar_lpn(
    db: Session,
    request_data: dict,
    background_tasks: BackgroundTasks,
    user_id: int | None = None,
) -> dict:
    """Recepciona un LPN (Contenedor) consolidado e inyecta hijos si existe ASN."""
    sato_existente = db.query(Sato).filter(Sato.lpn == request_data["lpn"]).first()
    if sato_existente:
        raise DuplicateLPNError("El pallet ya fue recepcionado")

    nuevo_sato_contenedor = Sato(
        tipo_sato="CONTENEDOR",
        lpn=request_data["lpn"],
        destino=request_data["destino"],
        tipo_carga=request_data["tipo_carga"],
        barcode_original=request_data["original_barcode"],
        estado="Bodega",
        ubicacion_id=request_data.get("ubicacion_id"),
    )

    db.add(nuevo_sato_contenedor)
    db.flush()

    nuevo_log = Log_Transaccional(
        sato_id=nuevo_sato_contenedor.sato_id,
        usuario_id=user_id,
        accion="CREACION_INGRESO_LPN",
        detalles=f"Ingreso pallet consolidado {request_data['tipo_carga']} destino {request_data['destino']} LPN: {request_data['lpn']}",
    )
    db.add(nuevo_log)

    bultos_creados = 0

    asn_padre = db.query(ASN_Padre).filter(ASN_Padre.lpn == request_data["lpn"]).first()
    if asn_padre and asn_padre.estado == "EN_TRANSITO":
        asn_padre.estado = "RECEPCIONADO"
        detalles = db.query(ASN_Detalle).filter(ASN_Detalle.lpn_padre == request_data["lpn"]).all()

        # Precargar todos los productos del ASN en 1 sola query (elimina N+1)
        skus_asn = list({d.sku for d in detalles if d.sku})
        productos_map = {}
        if skus_asn:
            productos_rows = (
                db.query(Catalogo_Producto)
                .filter(Catalogo_Producto.sku.in_(skus_asn))
                .all()
            )
            productos_map = {p.sku: p for p in productos_rows}

        for detalle in detalles:
            producto = productos_map.get(detalle.sku)
            exige_fefo = bool(producto and (producto.controla_vencimiento or (producto.tolerancia_vencimiento_dias or 0) > 0))
            if exige_fefo and producto:
                if not detalle.fecha_vencimiento or not detalle.lote:
                    raise ValueError(f"El SKU {detalle.sku} controla vencimiento pero falta Lote o Fecha en el ASN.")
                dias_restantes = (detalle.fecha_vencimiento - date.today()).days
                if dias_restantes < (producto.tolerancia_vencimiento_dias or 0):
                    raise ValueError(
                        f"Rechazo FEFO: El SKU {detalle.sku} en ASN vence en {dias_restantes} días, "
                        f"menor a la tolerancia permitida ({producto.tolerancia_vencimiento_dias} días)."
                    )

            nuevo_sato_hijo = Sato(
                tipo_sato="PRODUCTO",
                padre_id=nuevo_sato_contenedor.sato_id,
                sku=detalle.sku,
                cantidad=detalle.cantidad,
                lote=detalle.lote,
                fecha_vencimiento=detalle.fecha_vencimiento,
                estado="Bodega",
                ubicacion_id=request_data.get("ubicacion_id"),
            )
            db.add(nuevo_sato_hijo)
            bultos_creados += 1

    try:
        if asn_padre and asn_padre.estado == "RECEPCIONADO":
            from app.services.integration_service import emit_event
            payload = {
                "lpn": asn_padre.lpn,
                "origen": getattr(asn_padre, "origen", "Desconocido"),
                "bultos_recibidos": bultos_creados,
            }
            emit_event(db, "wms.inbound.received", payload)

        db.commit()
        db.refresh(nuevo_sato_contenedor)

    except Exception:
        db.rollback()
        raise DuplicateLPNError("El pallet ya fue recepcionado previamente o hay un conflicto de integridad.")

    db.refresh(nuevo_sato_contenedor)

    mensaje = f"Pallet Consolidado {request_data['tipo_carga']} registrado con éxito"
    if bultos_creados > 0:
        mensaje += f". Se generaron {bultos_creados} SATOs hijos desde el ASN."

    return {
        "mensaje": mensaje,
        "sato_padre_id": nuevo_sato_contenedor.sato_id,
        "lpn_registrado": nuevo_sato_contenedor.lpn,
        "bultos_creados": bultos_creados,
    }


def get_satos_en_recepcion(db: Session) -> list:
    """Obtiene los SATOs en estado 'Bodega Recepcion' con información extendida."""
    from sqlalchemy.orm import aliased
    SatoPadre = aliased(Sato)

    resultados = (
        db.query(
            Sato.sato_id,
            Sato.sku,
            Catalogo_Producto.nombre.label("nombre_producto"),
            SatoPadre.lpn.label("lpn_padre"),
            Sato.cantidad.label("cantidad_actual"),
            Sato.estado,
        )
        .join(
            Catalogo_Producto,
            (Sato.sku == Catalogo_Producto.sku) & (Sato.tenant_id == Catalogo_Producto.tenant_id),
        )
        .outerjoin(
            SatoPadre,
            (Sato.padre_id == SatoPadre.sato_id) & (Sato.tenant_id == SatoPadre.tenant_id),
        )
        .filter(
            Sato.estado == "Bodega Recepcion",
            Sato.tipo_sato == "PRODUCTO",
            Sato.cantidad > 0,
        )
        .all()
    )

    return resultados
