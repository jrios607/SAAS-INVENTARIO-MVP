"""
app/services/abc_service.py
─────────────────────────────────────────────────────────────────────────────
Motor ABC Dinámico, Zonas Calientes por Patente y Gestión de Anomalías (Etapa 1)
─────────────────────────────────────────────────────────────────────────────
Implementa:
  1. Configuración por Tenant (lectura pura en Read Replica vs escritura en Primary).
  2. Recálculo Pareto ABC sobre ventana móvil W días (Venta_Externa_Item),
     con desempate determinista (-v_i, -q_i, sku), garantía Top-1 Clase "A" si V > 0,
     y piso mínimo Clase "B" para productos nuevos y perecibles de vida corta.
  3. Proyección espacial de Zonas Térmicas ABC sobre las Patentes del Gemelo 2D.
  4. Registro y consulta de Anomalías de Stock (VENTA_SIN_STOCK / DISCREPANCIA_VITRINA).
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Set

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.tenant import current_tenant_id
from app.models import (
    Anomalia_Stock,
    Catalogo_Producto,
    Configuracion_Conteo_Tenant,
    Patente,
    Sato,
    Venta_Externa_Item,
)
from app.schemas import (
    AbcPlanoResumenResponse,
    AbcRecalculoResponse,
    AnomaliaStockResponse,
    ConfigConteoResponse,
    ConfigConteoUpdate,
    ZonaAbcPatenteItem,
)

logger = logging.getLogger("sg-wms.abc")


def _ensure_utc(dt: Optional[datetime]) -> Optional[datetime]:
    """Normaliza datetimes naive (p. ej. leídos desde SQLite) o aware a UTC."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


# ── 1. Configuración de Conteo / ABC por Tenant ───────────────────────────

def obtener_config_conteo_lectura(db: Session) -> ConfigConteoResponse:
    """
    Lee la configuración ABC del tenant activo SIN mutar la base de datos.
    Seguro para endpoints `GET` que usan `Depends(get_db_read)` (Read Replica).
    Si el tenant aún no tiene fila persistida, retorna los valores por defecto.
    """
    cfg = db.query(Configuracion_Conteo_Tenant).first()
    if cfg is None:
        return ConfigConteoResponse()
    return ConfigConteoResponse.model_validate(cfg)


def obtener_o_crear_config_conteo(db: Session, for_update: bool = False) -> Configuracion_Conteo_Tenant:
    """
    Obtiene o inicializa la configuración ABC del tenant activo en el nodo Primary.
    Usar únicamente en transacciones de escritura (`get_db`).
    Si `for_update=True`, adquiere bloqueo de fila (`SELECT ... FOR UPDATE`) para
    serializar recálculos ABC concurrentes del mismo tenant y forzar Primary.
    """
    tenant_id = current_tenant_id.get() or settings.DEFAULT_TENANT_ID
    prev_force = getattr(db, "_force_primary", False)
    setattr(db, "_force_primary", True)
    try:
        query = db.query(Configuracion_Conteo_Tenant).filter(
            Configuracion_Conteo_Tenant.tenant_id == tenant_id
        )
        if for_update:
            query = query.with_for_update()
        cfg = query.first()
        if cfg is None:
            try:
                with db.begin_nested():
                    cfg = Configuracion_Conteo_Tenant(
                        tenant_id=tenant_id,
                        ventana_w_dias=90,
                        umbral_a=0.80,
                        umbral_b=0.95,
                        dias_producto_nuevo=30,
                        frecuencia_a_dias=14,
                        frecuencia_b_dias=30,
                        frecuencia_c_dias=90,
                        capacidad_diaria_skus=20,
                        updated_at=datetime.now(timezone.utc),
                    )
                    db.add(cfg)
                    db.flush()
            except IntegrityError:
                retry_q = db.query(Configuracion_Conteo_Tenant).filter(
                    Configuracion_Conteo_Tenant.tenant_id == tenant_id
                )
                if for_update:
                    retry_q = retry_q.with_for_update()
                cfg = retry_q.one()
        return cfg
    finally:
        setattr(db, "_force_primary", prev_force)


def actualizar_config_conteo(db: Session, payload: ConfigConteoUpdate) -> ConfigConteoResponse:
    """
    Actualiza los parámetros de ventana y umbrales ABC del tenant activo.
    NO hace commit: el router coordina `recalcular_clasificacion_abc(db)` + `db.commit()`.
    """
    cfg = obtener_o_crear_config_conteo(db, for_update=True)
    cambios = payload.model_dump(exclude_unset=True)
    for campo, valor in cambios.items():
        if valor is not None and hasattr(cfg, campo):
            setattr(cfg, campo, valor)

    if float(cfg.umbral_a) >= float(cfg.umbral_b):
        raise ValueError("El parámetro 'umbral_a' debe ser estrictamente menor que 'umbral_b'.")

    cfg.updated_at = datetime.now(timezone.utc)
    db.flush()
    return ConfigConteoResponse.model_validate(cfg)


# ── 2. Algoritmo de Clasificación ABC Dinámica ────────────────────────────

def recalcular_clasificacion_abc(db: Session) -> AbcRecalculoResponse:
    """
    Recalcula la clasificación ABC de todos los productos activos del tenant
    sobre la ventana móvil `W` días de `Venta_Externa_Item`.

    Reglas matemáticas:
      • v_i = sum(subtotal), q_i = sum(cantidad), V = sum(v_i).
      • Orden determinista descendente: (-v_i, -q_i, sku).
      • Si V > 0: al menos el Top 1 con v_1 > 0 se clasifica como "A".
        Acumulado <= umbral_a -> "A"; <= umbral_b -> "B"; resto (o v_i == 0) -> "C".
      • Piso mínimo Clase "B" (nunca "C") para:
          a) Productos nuevos: `created_at` dentro de `dias_producto_nuevo` días.
          b) Perecibles de vida corta: `es_perecible_corto == True` o `dias_vida_util <= 15`.

    Garantiza CQRS Read-Your-Writes forzando lecturas sobre Primary (`_force_primary=True`)
    y serializa ejecuciones concurrentes por tenant con `for_update=True`.
    NO hace commit para permitir composición transaccional en el llamador.
    """
    tenant_id = current_tenant_id.get()
    if not tenant_id:
        raise RuntimeError(
            "Contexto Multi-Tenant ausente en recalcular_clasificacion_abc: "
            "llame a current_tenant_id.set(tenant_id) antes de ejecutar."
        )

    prev_force = getattr(db, "_force_primary", False)
    setattr(db, "_force_primary", True)
    try:
        ahora = datetime.now(timezone.utc)
        cfg = obtener_o_crear_config_conteo(db, for_update=True)

        ventana_dias = int(cfg.ventana_w_dias or 90)
        umbral_a = float(cfg.umbral_a or 0.80)
        umbral_b = float(cfg.umbral_b or 0.95)
        dias_nuevo = int(cfg.dias_producto_nuevo if cfg.dias_producto_nuevo is not None else 30)

        cutoff = ahora - timedelta(days=ventana_dias)
        cutoff_nuevo = ahora - timedelta(days=dias_nuevo)

        productos = (
            db.query(Catalogo_Producto)
            .filter(
                Catalogo_Producto.tenant_id == tenant_id,
                Catalogo_Producto.activo.is_(True),
            )
            .all()
        )

        filas_ventas = (
            db.query(
                Venta_Externa_Item.sku,
                func.coalesce(func.sum(Venta_Externa_Item.subtotal), 0),
                func.coalesce(func.sum(Venta_Externa_Item.cantidad), 0),
                func.max(Venta_Externa_Item.fecha_venta),
                func.count(Venta_Externa_Item.id),
            )
            .filter(
                Venta_Externa_Item.tenant_id == tenant_id,
                Venta_Externa_Item.fecha_venta >= cutoff,
            )
            .group_by(Venta_Externa_Item.sku)
            .all()
        )

        ventas_map: Dict[str, tuple] = {}
        for sku_row, sum_sub, sum_cant, max_fecha, n_eventos in filas_ventas:
            ventas_map[sku_row] = (
                int(sum_sub or 0),
                int(sum_cant or 0),
                max_fecha,
                int(n_eventos or 0),
            )

        enriquecidos = []
        venta_total_v = 0
        unidades_totales_q = 0
        for prod in productos:
            v_i, q_i, max_fecha, n_eventos = ventas_map.get(prod.sku, (0, 0, None, 0))
            v_i = max(0, v_i)
            q_i = max(0, q_i)
            venta_total_v += v_i
            unidades_totales_q += q_i
            enriquecidos.append((prod, v_i, q_i, max_fecha, n_eventos))

        # Ranking descendente determinista: (-v_i, -q_i, sku)
        enriquecidos.sort(key=lambda item: (-item[1], -item[2], item[0].sku))

        acumulado = 0.0
        conteo_clases = {"A": 0, "B": 0, "C": 0}
        protegidos_piso_b = 0

        for idx, (prod, v_i, q_i, max_fecha, n_eventos) in enumerate(enriquecidos):
            if venta_total_v > 0 and v_i > 0:
                share = float(v_i) / float(venta_total_v)
                acumulado += share
                if idx == 0 or acumulado <= umbral_a + 1e-9:
                    clase_base = "A"
                elif acumulado <= umbral_b + 1e-9:
                    clase_base = "B"
                else:
                    clase_base = "C"
            else:
                share = 0.0
                clase_base = "C"

            created_utc = _ensure_utc(prod.created_at)
            es_nuevo = (created_utc is not None) and (dias_nuevo > 0) and (created_utc >= cutoff_nuevo)
            es_perecible = bool(prod.es_perecible_corto) or (
                prod.dias_vida_util is not None and int(prod.dias_vida_util) <= 15
            )

            if clase_base == "C" and (es_nuevo or es_perecible):
                clase_final = "B"
                protegidos_piso_b += 1
            else:
                clase_final = clase_base

            conteo_clases[clase_final] = conteo_clases.get(clase_final, 0) + 1

            prod.clase_abc = clase_final
            prod.venta_valorizada_ventana = v_i
            prod.unidades_vendidas_ventana = q_i
            prod.participacion_ventas = round(share, 6)
            prod.intervalo_medio_venta_dias = (
                round(float(ventana_dias) / float(n_eventos), 2) if n_eventos > 0 else None
            )
            if max_fecha is not None:
                prod.ultima_venta_at = max_fecha
            prod.abc_calculado_at = ahora

        db.flush()

        return AbcRecalculoResponse(
            mensaje="Clasificación ABC recalculada exitosamente.",
            ventana_w_dias=ventana_dias,
            total_productos_evaluados=len(productos),
            venta_total_ventana_clp=venta_total_v,
            unidades_totales_ventana=unidades_totales_q,
            conteo_clases=conteo_clases,
            clase_a_count=conteo_clases["A"],
            clase_b_count=conteo_clases["B"],
            clase_c_count=conteo_clases["C"],
            protegidos_piso_b_count=protegidos_piso_b,
            calculado_at=ahora,
        )
    finally:
        setattr(db, "_force_primary", prev_force)


# ── 3. Zonas Calientes ABC por Patente (Gemelo Digital 2D) ────────────────

def _es_patente_cajas(patente: Patente) -> bool:
    tipo_m = (patente.tipo_mueble or "").strip().lower()
    area_p = (patente.area_pasillo or "").strip().lower()
    return ("caja" in tipo_m) or (area_p in ("caja", "cajas"))


def _recolectar_skus_patente(patente: Patente, skus_vitrina: Set[str]) -> Set[str]:
    skus: Set[str] = set()

    for sku_asig in (patente.productos_asignados or []):
        if sku_asig and str(sku_asig).strip():
            skus.add(str(sku_asig).strip())

    submapeo = patente.submapeo_grid
    if isinstance(submapeo, dict) and isinstance(submapeo.get("celdas"), list):
        for celda in submapeo["celdas"]:
            if isinstance(celda, dict):
                sku_celda = celda.get("sku_asignado")
                if sku_celda and str(sku_celda).strip():
                    skus.add(str(sku_celda).strip())

    for sku_vit in skus_vitrina:
        if sku_vit and str(sku_vit).strip():
            skus.add(str(sku_vit).strip())

    return skus


def calcular_zonas_calientes_patentes(db: Session) -> AbcPlanoResumenResponse:
    """
    Proyecta la clasificación ABC de los SKUs sobre cada `Patente` de `SALA_VENTA`.
    Compatible con `Depends(get_db_read)` (no muta la BD).
    """
    cfg = obtener_config_conteo_lectura(db)
    patentes = db.query(Patente).filter(Patente.tipo_ubicacion == "SALA_VENTA").all()
    productos = db.query(Catalogo_Producto).all()
    prod_by_sku: Dict[str, Catalogo_Producto] = {p.sku: p for p in productos}

    venta_total_tienda = sum(
        int(p.venta_valorizada_ventana or 0) for p in productos if p.activo
    )

    satos_vitrina = (
        db.query(Sato.ubicacion_id, Sato.sku)
        .filter(
            Sato.estado == "Vitrina",
            Sato.tipo_sato == "PRODUCTO",
            Sato.cantidad > 0,
            Sato.ubicacion_id.isnot(None),
            Sato.sku.isnot(None),
        )
        .all()
    )
    skus_vitrina_por_patente: Dict[str, Set[str]] = {}
    for ubic_id, sku_val in satos_vitrina:
        if ubic_id and sku_val:
            skus_vitrina_por_patente.setdefault(ubic_id, set()).add(sku_val)

    anomalias_abiertas = (
        db.query(Anomalia_Stock)
        .filter(Anomalia_Stock.estado == "ABIERTA")
        .all()
    )

    ultimo_calculo: Optional[datetime] = None
    for p in productos:
        dt_calc = _ensure_utc(p.abc_calculado_at)
        if dt_calc is not None and (ultimo_calculo is None or dt_calc > ultimo_calculo):
            ultimo_calculo = dt_calc

    patentes_map: Dict[str, ZonaAbcPatenteItem] = {}
    calientes_a = medias_b = frias_c = sin_datos = 0

    prioridad_clase = {"A": 3, "B": 2, "C": 1}
    mapa_zona = {"A": "CALIENTE_A", "B": "MEDIA_B", "C": "FRIA_C"}

    for pat in patentes:
        skus_raw = _recolectar_skus_patente(
            pat, skus_vitrina_por_patente.get(pat.id_patente, set())
        )
        prods_pat = [prod_by_sku[s] for s in skus_raw if s in prod_by_sku]
        skus_validos_set = {p.sku for p in prods_pat}

        anom_pat_count = sum(
            1
            for a in anomalias_abiertas
            if a.ubicacion_id == pat.id_patente
            or (a.ubicacion_id is None and a.sku in skus_validos_set)
        )

        if _es_patente_cajas(pat) or not prods_pat:
            sin_datos += 1
            patentes_map[pat.id_patente] = ZonaAbcPatenteItem(
                id_patente=pat.id_patente,
                zona_termica="SIN_DATOS",
                clase_dominante=None,
                skus_total_count=0,
                skus_a_count=0,
                skus_b_count=0,
                skus_c_count=0,
                venta_valorizada_patente_clp=0,
                unidades_vendidas_patente=0,
                participacion_patente=0.0,
                anomalias_abiertas_count=0 if _es_patente_cajas(pat) else anom_pat_count,
                top_skus=[],
            )
            continue

        skus_a = sum(1 for p in prods_pat if (p.clase_abc or "B") == "A")
        skus_b = sum(1 for p in prods_pat if (p.clase_abc or "B") == "B")
        skus_c = sum(1 for p in prods_pat if (p.clase_abc or "B") == "C")

        venta_pat = sum(int(p.venta_valorizada_ventana or 0) for p in prods_pat)
        unidades_pat = sum(int(p.unidades_vendidas_ventana or 0) for p in prods_pat)
        participacion_pat = (
            round(float(venta_pat) / float(venta_total_tienda), 6)
            if venta_total_tienda > 0
            else 0.0
        )

        if venta_pat > 0:
            venta_por_clase = {"A": 0, "B": 0, "C": 0}
            for p in prods_pat:
                c_abc = p.clase_abc if p.clase_abc in ("A", "B", "C") else "B"
                venta_por_clase[c_abc] += int(p.venta_valorizada_ventana or 0)
            clase_dom = max(
                ("A", "B", "C"),
                key=lambda c: (venta_por_clase[c], prioridad_clase[c]),
            )
        else:
            conteo_pat = {"A": skus_a, "B": skus_b, "C": skus_c}
            clase_dom = max(
                ("A", "B", "C"),
                key=lambda c: (conteo_pat[c], prioridad_clase[c]),
            )

        zona_termica = mapa_zona[clase_dom]
        if zona_termica == "CALIENTE_A":
            calientes_a += 1
        elif zona_termica == "MEDIA_B":
            medias_b += 1
        else:
            frias_c += 1

        prods_ordenados = sorted(
            prods_pat,
            key=lambda p: (
                -int(p.venta_valorizada_ventana or 0),
                -int(p.unidades_vendidas_ventana or 0),
                p.sku,
            ),
        )
        top_skus = [
            {
                "sku": p.sku,
                "nombre": p.nombre,
                "clase_abc": p.clase_abc or "B",
                "venta_valorizada_clp": int(p.venta_valorizada_ventana or 0),
                "unidades_vendidas": int(p.unidades_vendidas_ventana or 0),
            }
            for p in prods_ordenados[:5]
        ]

        patentes_map[pat.id_patente] = ZonaAbcPatenteItem(
            id_patente=pat.id_patente,
            zona_termica=zona_termica,  # type: ignore[arg-type]
            clase_dominante=clase_dom,
            skus_total_count=len(prods_pat),
            skus_a_count=skus_a,
            skus_b_count=skus_b,
            skus_c_count=skus_c,
            venta_valorizada_patente_clp=venta_pat,
            unidades_vendidas_patente=unidades_pat,
            participacion_patente=participacion_pat,
            anomalias_abiertas_count=anom_pat_count,
            top_skus=top_skus,
        )

    return AbcPlanoResumenResponse(
        ventana_w_dias=cfg.ventana_w_dias,
        venta_total_ventana_clp=venta_total_tienda,
        patentes_calientes_a=calientes_a,
        patentes_medias_b=medias_b,
        patentes_frias_c=frias_c,
        patentes_sin_datos=sin_datos,
        anomalias_abiertas_total=len(anomalias_abiertas),
        calculado_at=ultimo_calculo,
        patentes=patentes_map,
    )


# ── 4. Anomalías de Stock y Discrepancias en Vitrina ──────────────────────

def registrar_discrepancia_vitrina(
    db: Session,
    sku: str,
    ubicacion_id: Optional[str] = None,
    detalles: Optional[str] = None,
    user_id: Optional[int] = None,
) -> AnomaliaStockResponse:
    """
    Registra una anomalía física reportada por un operario en sala de ventas
    (ej: góndola vacía cuando el sistema indica stock > 0).
    """
    producto = db.query(Catalogo_Producto).filter(Catalogo_Producto.sku == sku).first()
    if not producto:
        raise LookupError(f"No se encontró el producto con SKU '{sku}' en el catálogo.")

    anomalia = Anomalia_Stock(
        sku=producto.sku,
        ubicacion_id=(ubicacion_id or "").strip() or None,
        tipo="DISCREPANCIA_VITRINA",
        estado="ABIERTA",
        unidades_deficit=0,
        referencia_ticket=None,
        detalles=(detalles or "Discrepancia física / góndola vacía reportada en sala de ventas.").strip(),
        reportado_por_id=user_id,
        created_at=datetime.now(timezone.utc),
    )
    db.add(anomalia)
    db.flush()

    return AnomaliaStockResponse(
        id=anomalia.id,
        sku=anomalia.sku,
        nombre_producto=producto.nombre,
        clase_abc=producto.clase_abc or "B",
        ubicacion_id=anomalia.ubicacion_id,
        tipo=anomalia.tipo,
        estado=anomalia.estado,
        unidades_deficit=anomalia.unidades_deficit or 0,
        referencia_ticket=anomalia.referencia_ticket,
        detalles=anomalia.detalles,
        reportado_por_id=anomalia.reportado_por_id,
        created_at=anomalia.created_at,
        resolved_at=anomalia.resolved_at,
    )


def listar_anomalias_stock(
    db: Session,
    solo_abiertas: bool = True,
    limit: int = 100,
) -> List[AnomaliaStockResponse]:
    """
    Lista las anomalías de stock (`VENTA_SIN_STOCK` y `DISCREPANCIA_VITRINA`)
    del tenant activo, enriquecidas con nombre y clase ABC del producto.
    """
    query = (
        db.query(Anomalia_Stock, Catalogo_Producto.nombre, Catalogo_Producto.clase_abc)
        .outerjoin(
            Catalogo_Producto,
            (Anomalia_Stock.tenant_id == Catalogo_Producto.tenant_id)
            & (Anomalia_Stock.sku == Catalogo_Producto.sku),
        )
    )
    if solo_abiertas:
        query = query.filter(Anomalia_Stock.estado == "ABIERTA")

    filas = (
        query.order_by(Anomalia_Stock.created_at.desc(), Anomalia_Stock.id.desc())
        .limit(limit)
        .all()
    )

    return [
        AnomaliaStockResponse(
            id=anom.id,
            sku=anom.sku,
            nombre_producto=nombre_prod or anom.sku,
            clase_abc=clase_abc or "B",
            ubicacion_id=anom.ubicacion_id,
            tipo=anom.tipo,
            estado=anom.estado,
            unidades_deficit=anom.unidades_deficit or 0,
            referencia_ticket=anom.referencia_ticket,
            detalles=anom.detalles,
            reportado_por_id=anom.reportado_por_id,
            created_at=anom.created_at,
            resolved_at=anom.resolved_at,
        )
        for anom, nombre_prod, clase_abc in filas
    ]
