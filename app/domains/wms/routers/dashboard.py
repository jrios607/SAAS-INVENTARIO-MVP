from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func, desc
from datetime import datetime, timedelta, timezone
from app.database import get_db_read
from app.models import Sato, Log_Transaccional, Catalogo_Producto

router = APIRouter(prefix="/api/v1/dashboard", tags=["Dashboard"])

@router.get("/kpis")
def get_dashboard_kpis(db: Session = Depends(get_db_read)):
    # 1. Stock Total (Suma de unidades de SATOs)
    stock_total = db.query(func.sum(Sato.cantidad)).filter(Sato.cantidad > 0).scalar() or 0

    # 2. Alertas de Vencimiento (próximos 7 días)
    hoy = datetime.now().date()
    limite_vencimiento = hoy + timedelta(days=7)
    alertas_vencimiento = db.query(func.sum(Sato.cantidad)).filter(
        Sato.fecha_vencimiento.isnot(None),
        Sato.fecha_vencimiento <= limite_vencimiento,
        Sato.cantidad > 0
    ).scalar() or 0

    # 3. Ocupación Vitrina vs Bodega
    ocupacion = db.query(
        Sato.estado,
        func.sum(Sato.cantidad).label("total")
    ).filter(
        Sato.estado.in_(["Vitrina", "Bodega"])
    ).group_by(Sato.estado).all()
    
    distribucion = [{"name": row.estado, "value": row.total or 0} for row in ocupacion]
    
    # Asegurar que siempre haya data para el gráfico
    if not distribucion:
        distribucion = [{"name": "Vitrina", "value": 0}, {"name": "Bodega", "value": 0}]

    # 4. Top 5 Mermas de la Semana
    hace_7_dias = datetime.now(timezone.utc) - timedelta(days=7)
    top_mermas_query = (
        db.query(
            Catalogo_Producto.nombre,
            func.count(Log_Transaccional.id).label("cantidad_mermas")
        )
        .join(Sato, Log_Transaccional.sato_id == Sato.sato_id)
        .join(Catalogo_Producto, Sato.sku == Catalogo_Producto.sku)
        .filter(
            Log_Transaccional.fecha_hora >= hace_7_dias,
            Log_Transaccional.accion.in_(["MERMA_DECLARADA", "DECLARACION_FALTANTE_PICKING"])
        )
        .group_by(Catalogo_Producto.nombre)
        .order_by(desc("cantidad_mermas"))
        .limit(5)
        .all()
    )
    
    top_mermas = [{"sku_nombre": row.nombre, "cantidad": row.cantidad_mermas} for row in top_mermas_query]

    return {
        "stock_total_unidades": int(stock_total),
        "alertas_vencimiento": int(alertas_vencimiento),
        "distribucion_inventario": distribucion,
        "top_mermas": top_mermas
    }
