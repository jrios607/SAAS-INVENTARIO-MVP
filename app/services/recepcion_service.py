from sqlalchemy.orm import Session
from fastapi import BackgroundTasks
from app.models import Sato, Catalogo_Producto, Log_Transaccional, ASN_Padre, ASN_Detalle
from app.core.utils import parse_gs1_128
from sqlalchemy.exc import IntegrityError
from datetime import date
class DuplicateLPNError(ValueError):
    pass


def recepcionar_pallet(db: Session, barcode_text: str, ubicacion_id: str | None = None, user_id: int | None = None) -> dict:
    """Recepciona un pallet de producto individual."""
    datos_extraidos = parse_gs1_128(barcode_text)

    producto = db.query(Catalogo_Producto).filter(Catalogo_Producto.ean == datos_extraidos['ean']).first()
    if not producto:
        raise ValueError(f"El EAN {datos_extraidos['ean']} no existe en el Catálogo.")

    if producto.controla_vencimiento:
        if 'vencimiento' not in datos_extraidos or 'lote' not in datos_extraidos:
            raise ValueError(f"El producto {producto.sku} controla vencimiento. El código GS1-128 debe incluir Lote y Fecha de Vencimiento.")
        
        dias_restantes = (datos_extraidos['vencimiento'] - date.today()).days
        if dias_restantes < producto.tolerancia_vencimiento_dias:
            raise ValueError(f"Rechazo FEFO: El producto {producto.sku} vence en {dias_restantes} días, menor a la tolerancia de recepción ({producto.tolerancia_vencimiento_dias} días).")

    nuevo_sato = Sato(
        tipo_sato="PRODUCTO",
        sku=producto.sku,
        lote=datos_extraidos.get('lote'),
        fecha_vencimiento=datos_extraidos.get('vencimiento'),
        cantidad=datos_extraidos.get('cantidad', 1),
        estado="Bodega",
        ubicacion_id=ubicacion_id
    )
    db.add(nuevo_sato)
    db.flush()

    nuevo_log = Log_Transaccional(
        sato_id=nuevo_sato.sato_id,
        usuario_id=user_id,
        accion='CREACION_INGRESO_BODEGA',
        detalles=f"Ingreso {datos_extraidos['cantidad']} unidades. Lote: {datos_extraidos['lote']}"
    )
    db.add(nuevo_log)
    db.commit()
    db.refresh(nuevo_sato)

    return {
        "mensaje": "Recepción exitosa.",
        "sato_id": nuevo_sato.sato_id,
        "ean_leido": datos_extraidos['ean']
    }


def recepcionar_lpn(db: Session, request_data: dict, background_tasks: BackgroundTasks, user_id: int | None = None) -> dict:
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
        ubicacion_id=request_data.get("ubicacion_id")
    )

    db.add(nuevo_sato_contenedor)
    db.flush()

    nuevo_log = Log_Transaccional(
        sato_id=nuevo_sato_contenedor.sato_id,
        usuario_id=user_id,
        accion='CREACION_INGRESO_LPN',
        detalles=f"Ingreso pallet consolidado {request_data['tipo_carga']} destino {request_data['destino']} LPN: {request_data['lpn']}"
    )
    db.add(nuevo_log)

    bultos_creados = 0

    asn_padre = db.query(ASN_Padre).filter(ASN_Padre.lpn == request_data["lpn"]).first()
    if asn_padre and asn_padre.estado == "EN_TRANSITO":
        asn_padre.estado = "RECEPCIONADO"
        detalles = db.query(ASN_Detalle).filter(ASN_Detalle.lpn_padre == request_data["lpn"]).all()

        for detalle in detalles:
            producto = db.query(Catalogo_Producto).filter(Catalogo_Producto.sku == detalle.sku).first()
            if producto and producto.controla_vencimiento:
                if not detalle.fecha_vencimiento or not detalle.lote:
                    raise ValueError(f"El SKU {detalle.sku} controla vencimiento pero falta Lote o Fecha en el ASN.")
                dias_restantes = (detalle.fecha_vencimiento - date.today()).days
                if dias_restantes < producto.tolerancia_vencimiento_dias:
                    raise ValueError(f"Rechazo FEFO: El SKU {detalle.sku} en ASN vence en {dias_restantes} días, menor a la tolerancia permitida ({producto.tolerancia_vencimiento_dias} días).")

            nuevo_sato_hijo = Sato(
                tipo_sato="PRODUCTO",
                padre_id=nuevo_sato_contenedor.sato_id,
                sku=detalle.sku,
                cantidad=detalle.cantidad,
                lote=detalle.lote,
                fecha_vencimiento=detalle.fecha_vencimiento,
                estado="Bodega",
                ubicacion_id=request_data.get("ubicacion_id")
            )
            db.add(nuevo_sato_hijo)
            bultos_creados += 1

    try:
        db.commit()
        db.refresh(nuevo_sato_contenedor)
        
        if asn_padre and asn_padre.estado == "RECEPCIONADO":
            # ── Emitir Webhook al ERP ──
            from app.services.integration_service import emitir_webhook
            payload = {
                "lpn": asn_padre.lpn,
                "proveedor": asn_padre.proveedor,
                "bultos_recibidos": bultos_creados,
                "asn_id": asn_padre.id
            }
            background_tasks.add_task(emitir_webhook, db, "wms.inbound.received", payload)
            
    except Exception as e:
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
        "bultos_creados": bultos_creados
    }


def get_satos_en_recepcion(db: Session) -> list:
    """Obtiene los SATOs en estado 'Bodega Recepcion' con información extendida."""
    from sqlalchemy.orm import aliased
    SatoPadre = aliased(Sato)

    resultados = db.query(
        Sato.sato_id,
        Sato.sku,
        Catalogo_Producto.nombre.label("nombre_producto"),
        SatoPadre.lpn.label("lpn_padre"),
        Sato.cantidad.label("cantidad_actual"),
        Sato.estado
    ).join(
        Catalogo_Producto, Sato.sku == Catalogo_Producto.sku
    ).outerjoin(
        SatoPadre, Sato.padre_id == SatoPadre.sato_id
    ).filter(
        Sato.estado == "Bodega Recepcion",
        Sato.tipo_sato == "PRODUCTO",
        Sato.cantidad > 0
    ).all()

    return resultados
