from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends
from sqlalchemy import desc, func
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.database import get_db_read
from app.models import (
    Anomalia_Stock,
    Catalogo_Producto,
    Log_Transaccional,
    Patente,
    Sato,
    Venta_Externa,
    Venta_Externa_Huerfano,
)

router = APIRouter(prefix="/api/v1/dashboard", tags=["Dashboard"])

_MESES_ES = ("Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic")


def _rango_dia_santiago_en_utc() -> tuple[datetime, datetime, datetime]:
    """
    Retorna `(inicio_hoy_utc_naive, inicio_manana_utc_naive, inicio_ayer_utc_naive)`
    calculados a partir de la medianoche local en `America/Santiago` para consultar
    columnas DateTime almacenadas en UTC (naive en SQLite / aware en PostgreSQL).
    """
    try:
        tz_cl = ZoneInfo("America/Santiago")
    except Exception:
        tz_cl = timezone(timedelta(hours=-3))

    ahora_cl = datetime.now(tz_cl)
    inicio_hoy_cl = ahora_cl.replace(hour=0, minute=0, second=0, microsecond=0)
    inicio_manana_cl = inicio_hoy_cl + timedelta(days=1)
    inicio_ayer_cl = inicio_hoy_cl - timedelta(days=1)

    return (
        inicio_hoy_cl.astimezone(timezone.utc).replace(tzinfo=None),
        inicio_manana_cl.astimezone(timezone.utc).replace(tzinfo=None),
        inicio_ayer_cl.astimezone(timezone.utc).replace(tzinfo=None),
    )


@router.get("/kpis")
def get_dashboard_kpis(db: Session = Depends(get_db_read), user=Depends(get_current_user)):
    hoy = datetime.now().date()
    limite_vencimiento_7d = hoy + timedelta(days=7)
    limite_radar_14d = hoy + timedelta(days=14)

    # 1. Ocupación Vitrina vs Bodega y Stock Total Activo
    ocupacion = (
        db.query(
            Sato.estado,
            func.coalesce(func.sum(Sato.cantidad), 0).label("total"),
        )
        .filter(
            Sato.tipo_sato == "PRODUCTO",
            Sato.estado.in_(["Vitrina", "Bodega", "Bodega Recepcion"]),
            Sato.cantidad > 0,
        )
        .group_by(Sato.estado)
        .all()
    )

    stock_vitrina = 0
    stock_bodega = 0
    for row in ocupacion:
        val = int(row.total or 0)
        if row.estado == "Vitrina":
            stock_vitrina += val
        elif row.estado in ("Bodega", "Bodega Recepcion"):
            stock_bodega += val

    stock_total = stock_vitrina + stock_bodega
    distribucion = [
        {"name": "Vitrina", "value": stock_vitrina},
        {"name": "Bodega", "value": stock_bodega},
    ]

    # 2. Riesgo por Vencimiento FEFO (<= 7 días) y Radar FEFO (<= 14 días)
    satos_vencimiento_rows = (
        db.query(
            Sato,
            Catalogo_Producto.nombre,
            Catalogo_Producto.costo_unitario,
            Catalogo_Producto.precio,
            Patente.area_pasillo,
        )
        .outerjoin(
            Catalogo_Producto,
            (Sato.tenant_id == Catalogo_Producto.tenant_id) & (Sato.sku == Catalogo_Producto.sku),
        )
        .outerjoin(
            Patente,
            (Sato.tenant_id == Patente.tenant_id) & (Sato.ubicacion_id == Patente.id_patente),
        )
        .filter(
            Sato.tipo_sato == "PRODUCTO",
            Sato.estado.in_(["Vitrina", "Bodega", "Bodega Recepcion"]),
            Sato.cantidad > 0,
            Sato.fecha_vencimiento.isnot(None),
            Sato.fecha_vencimiento <= limite_radar_14d,
        )
        .order_by(Sato.fecha_vencimiento.asc(), Sato.sato_id.asc())
        .all()
    )

    alertas_vencimiento_unidades = 0
    lotes_riesgo_7d_count = 0
    perdida_proyectada_clp = 0
    radar_fefo_items = []

    for sato, prod_nombre, costo_u, precio_u, area_pasillo in satos_vencimiento_rows:
        cant = int(sato.cantidad or 0)
        costo_ef = int(costo_u or 0) if int(costo_u or 0) > 0 else int(precio_u or 0)
        valor_lote = cant * max(0, costo_ef)
        dias_rest = (sato.fecha_vencimiento - hoy).days if sato.fecha_vencimiento else 0

        if sato.fecha_vencimiento and sato.fecha_vencimiento <= limite_vencimiento_7d:
            alertas_vencimiento_unidades += cant
            lotes_riesgo_7d_count += 1
            perdida_proyectada_clp += valor_lote

        if len(radar_fefo_items) < 6:
            radar_fefo_items.append(
                {
                    "sato_id": str(sato.sato_id),
                    "sku": sato.sku or "",
                    "nombre_producto": prod_nombre or sato.sku or "Producto",
                    "lote": sato.lote or "SIN-LOTE",
                    "ubicacion_id": sato.ubicacion_id,
                    "nombre_ubicacion": area_pasillo or sato.ubicacion_id or sato.estado,
                    "estado": sato.estado,
                    "cantidad": cant,
                    "fecha_vencimiento": sato.fecha_vencimiento.isoformat() if sato.fecha_vencimiento else None,
                    "dias_restantes": dias_rest,
                    "valor_riesgo_clp": valor_lote,
                }
            )

    # 3. Ventas de Hoy y Ayer en zona horaria America/Santiago (excluye cargas históricas y revertidas)
    ini_hoy_utc, ini_manana_utc, ini_ayer_utc = _rango_dia_santiago_en_utc()

    ventas_hoy_agg = (
        db.query(
            func.count(Venta_Externa.id),
            func.coalesce(func.sum(Venta_Externa.total_unidades), 0),
            func.coalesce(func.sum(Venta_Externa.total_valorizado), 0),
        )
        .filter(
            Venta_Externa.es_carga_historica.is_(False),
            Venta_Externa.estado_procesamiento != "REVERTIDO",
            Venta_Externa.fecha_recepcion >= ini_hoy_utc,
            Venta_Externa.fecha_recepcion < ini_manana_utc,
        )
        .first()
    )
    ventas_hoy_tickets = int(ventas_hoy_agg[0] or 0) if ventas_hoy_agg else 0
    ventas_hoy_unidades = int(ventas_hoy_agg[1] or 0) if ventas_hoy_agg else 0
    ventas_hoy_clp = int(ventas_hoy_agg[2] or 0) if ventas_hoy_agg else 0

    ventas_ayer_tickets = (
        db.query(func.count(Venta_Externa.id))
        .filter(
            Venta_Externa.es_carga_historica.is_(False),
            Venta_Externa.estado_procesamiento != "REVERTIDO",
            Venta_Externa.fecha_recepcion >= ini_ayer_utc,
            Venta_Externa.fecha_recepcion < ini_hoy_utc,
        )
        .scalar()
        or 0
    )

    # 4. Alertas Operativas del Día
    anomalias_abiertas_count = (
        db.query(func.count(Anomalia_Stock.id))
        .filter(Anomalia_Stock.estado == "ABIERTA")
        .scalar()
        or 0
    )
    skus_huerfanos_pendientes_count = (
        db.query(func.count(func.distinct(Venta_Externa_Huerfano.codigo_original)))
        .filter(Venta_Externa_Huerfano.estado == "PENDIENTE")
        .scalar()
        or 0
    )

    # Productos activos bajo stock mínimo
    stock_por_sku = dict(
        db.query(Sato.sku, func.coalesce(func.sum(Sato.cantidad), 0))
        .filter(
            Sato.tipo_sato == "PRODUCTO",
            Sato.estado.in_(["Vitrina", "Bodega", "Bodega Recepcion"]),
            Sato.cantidad > 0,
            Sato.sku.isnot(None),
        )
        .group_by(Sato.sku)
        .all()
    )
    productos_activos = (
        db.query(Catalogo_Producto.sku, Catalogo_Producto.stock_minimo)
        .filter(Catalogo_Producto.activo.is_(True))
        .all()
    )
    productos_bajo_minimo_count = sum(
        1
        for sku_p, s_min in productos_activos
        if int(stock_por_sku.get(sku_p, 0) or 0) < max(1, int(s_min or 5))
    )

    # 5. Top 5 Mermas de la Semana
    hace_7_dias = datetime.now(timezone.utc) - timedelta(days=7)
    top_mermas_query = (
        db.query(
            Catalogo_Producto.nombre,
            func.count(Log_Transaccional.id).label("cantidad_mermas"),
        )
        .select_from(Log_Transaccional)
        .join(Sato, Log_Transaccional.sato_id == Sato.sato_id)
        .join(
            Catalogo_Producto,
            (Sato.sku == Catalogo_Producto.sku) & (Sato.tenant_id == Catalogo_Producto.tenant_id),
        )
        .filter(
            Log_Transaccional.fecha_hora >= hace_7_dias,
            Log_Transaccional.accion.in_(
                ["DECLARACION_MERMA", "MERMA_DECLARADA", "MERMA_RAPIDA_3_TOQUES", "DECLARACION_FALTANTE_PICKING"]
            ),
        )
        .group_by(Catalogo_Producto.nombre)
        .order_by(desc("cantidad_mermas"))
        .limit(5)
        .all()
    )
    top_mermas = [{"sku_nombre": row.nombre, "cantidad": row.cantidad_mermas} for row in top_mermas_query]

    # 6. Desempeño últimos 6 meses desde datos reales
    hace_180_dias = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=180)
    ventas_recientes = (
        db.query(Venta_Externa.fecha_venta_dt, Venta_Externa.total_valorizado)
        .filter(
            Venta_Externa.estado_procesamiento != "REVERTIDO",
            Venta_Externa.fecha_venta_dt >= hace_180_dias,
        )
        .all()
    )
    ingresos_por_ym: dict[tuple[int, int], int] = {}
    for dt_v, tot_v in ventas_recientes:
        if dt_v:
            ym = (dt_v.year, dt_v.month)
            ingresos_por_ym[ym] = ingresos_por_ym.get(ym, 0) + int(tot_v or 0)

    desempeno_mensual = []
    for offset in range(5, -1, -1):
        mes_num = ((hoy.month - 1 - offset) % 12) + 1
        anio_num = hoy.year + ((hoy.month - 1 - offset) // 12)
        ym = (anio_num, mes_num)
        desempeno_mensual.append(
            {
                "mes": _MESES_ES[mes_num - 1],
                "Ganancias": ingresos_por_ym.get(ym, 0),
                "Perdidas": perdida_proyectada_clp if offset == 0 else 0,
            }
        )

    return {
        "stock_total_unidades": int(stock_total),
        "stock_vitrina_unidades": int(stock_vitrina),
        "stock_bodega_unidades": int(stock_bodega),
        "alertas_vencimiento": int(alertas_vencimiento_unidades),
        "lotes_riesgo_vencimiento_count": int(lotes_riesgo_7d_count),
        "perdida_proyectada_clp": int(perdida_proyectada_clp),
        "ventas_hoy_clp": int(ventas_hoy_clp),
        "ventas_hoy_unidades": int(ventas_hoy_unidades),
        "ventas_hoy_tickets": int(ventas_hoy_tickets),
        "ventas_ayer_tickets": int(ventas_ayer_tickets),
        "distribucion_inventario": distribucion,
        "top_mermas": top_mermas,
        "radar_fefo_items": radar_fefo_items,
        "alertas_operativas": {
            "anomalias_abiertas_count": int(anomalias_abiertas_count),
            "skus_huerfanos_pendientes_count": int(skus_huerfanos_pendientes_count),
            "lotes_por_vencer_7d_count": int(lotes_riesgo_7d_count),
            "productos_bajo_minimo_count": int(productos_bajo_minimo_count),
        },
        "desempeno_mensual": desempeno_mensual,
    }
