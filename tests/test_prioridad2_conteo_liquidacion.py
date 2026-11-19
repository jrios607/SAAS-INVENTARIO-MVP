"""
tests/test_prioridad2_conteo_liquidacion.py
─────────────────────────────────────────────────────────────────────────────
Suite de verificación Prioridad 2:
  1. Persistencia de Conteo Cíclico OK (`POST /api/v1/abc/conteo-ok`):
     - Persiste `Catalogo_Producto.ultimo_conteo_at` y lo expone en `/api/v1/catalogo/stock-agrupado`.
     - Inserta `CONTEO_CICLICO_SIN_DIFERENCIA` en `Log_Transaccional`.
     - Cierra anomalías `ABIERTA` del mismo SKU (`estado == "RESUELTA"`, `resolved_at != None`).
     - SKU válido con 0 SATOs históricos no falla por FK `NOT NULL` (`log_registrado == False`).
     - Aislamiento Multi-Tenant estricto (`404` cruzado).
  2. Flujo de Liquidación / Remate pre-merma (`POST /api/v1/inventario/satos/{sato_id}/liquidacion`):
     - Marca lote próximo a vencer con `descuento_pct` sin mutar `Sato.estado` (`Vitrina`/`Bodega`).
     - Registra `MARCADO_LIQUIDACION` / `RETIRO_LIQUIDACION` en `Log_Transaccional`.
     - Expone `en_liquidacion` y `precio_liquidacion` en `/api/v1/dashboard/kpis` y `/api/v1/catalogo/stock-agrupado`.
     - Rechaza con `400` lotes vencidos, agotados y contenedores LPN; `404` cross-tenant.
     - Mantiene vendibilidad FEFO intacta mediante venta externa POS (`/api/v1/integration/sales/webhook`).
  3. Contract-Sentinel OpenAPI <-> TypeScript (`frontend/src/services/api.ts`).
"""

import pathlib
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.tenant import current_tenant_id
from app.database import Base, RoutingSessionLocal, engine
from app.main import app
from app.models import (
    Anomalia_Stock,
    Catalogo_Producto,
    Categoria,
    Integration_Log,
    Log_Transaccional,
    Patente,
    Sato,
    Tenant,
    Usuario,
    Venta_Externa,
    Venta_Externa_Descuento,
    Venta_Externa_Huerfano,
    Venta_Externa_Item,
)
from app.services.catalogo_service import invalidar_cache_catalogo

TENANT_A = "p2aa1111-1111-1111-1111-111111111111"
TENANT_B = "p2bb2222-2222-2222-2222-222222222222"
API_KEY = "test-prioridad2-api-key-2026"


def _purgar_tenants_p2(db) -> None:
    for tid in (TENANT_A, TENANT_B):
        current_tenant_id.set(tid)
        db.query(Venta_Externa_Descuento).filter(
            Venta_Externa_Descuento.tenant_id == tid
        ).delete(synchronize_session=False)
        db.query(Venta_Externa_Huerfano).filter(
            Venta_Externa_Huerfano.tenant_id == tid
        ).delete(synchronize_session=False)
        db.query(Anomalia_Stock).filter(Anomalia_Stock.tenant_id == tid).delete(
            synchronize_session=False
        )
        db.query(Venta_Externa_Item).filter(
            Venta_Externa_Item.tenant_id == tid
        ).delete(synchronize_session=False)
        db.query(Venta_Externa).filter(Venta_Externa.tenant_id == tid).delete(
            synchronize_session=False
        )
        db.query(Log_Transaccional).filter(Log_Transaccional.tenant_id == tid).delete(
            synchronize_session=False
        )
        db.query(Integration_Log).filter(Integration_Log.tenant_id == tid).delete(
            synchronize_session=False
        )
        db.query(Sato).filter(Sato.tenant_id == tid).delete(synchronize_session=False)
        db.query(Patente).filter(Patente.tenant_id == tid).delete(
            synchronize_session=False
        )
        db.query(Catalogo_Producto).filter(
            Catalogo_Producto.tenant_id == tid
        ).delete(synchronize_session=False)
        db.query(Categoria).filter(Categoria.tenant_id == tid).delete(
            synchronize_session=False
        )
        db.query(Usuario).filter(Usuario.tenant_id == tid).delete(
            synchronize_session=False
        )
        invalidar_cache_catalogo()
    db.commit()


@pytest.fixture(autouse=True)
def setup_clean_p2_db():
    prev_api_key = settings.INTEGRATION_API_KEY
    prev_auth = settings.AUTH_REQUIRED
    settings.INTEGRATION_API_KEY = API_KEY
    settings.AUTH_REQUIRED = False
    Base.metadata.create_all(bind=engine)

    db = RoutingSessionLocal()
    try:
        _purgar_tenants_p2(db)
        for tid, nombre in [
            (TENANT_A, "Minimarket Prueba A"),
            (TENANT_B, "Minimarket Prueba B"),
        ]:
            t = db.query(Tenant).filter(Tenant.id == tid).first()
            if not t:
                db.add(Tenant(id=tid, nombre=nombre, activo=True, settings={}))
        db.commit()
    finally:
        db.close()

    yield

    settings.INTEGRATION_API_KEY = prev_api_key
    settings.AUTH_REQUIRED = prev_auth
    db_clean = RoutingSessionLocal()
    try:
        _purgar_tenants_p2(db_clean)
    finally:
        db_clean.close()


def _seed_producto_con_satos(
    db,
    tenant_id: str,
    sku: str,
    ean: str,
    nombre: str,
    precio: int = 2000,
    costo: int = 1200,
    stock_vitrina: int = 6,
    dias_vencimiento: int = 3,
    con_anomalia: bool = False,
) -> uuid.UUID:
    current_tenant_id.set(tenant_id)
    cat = db.query(Categoria).filter(Categoria.tenant_id == tenant_id).first()
    if not cat:
        cat = Categoria(tenant_id=tenant_id, nombre="Lácteos y Frescos")
        db.add(cat)
        db.flush()

    db.add(
        Catalogo_Producto(
            tenant_id=tenant_id,
            sku=sku,
            nombre=nombre,
            ean=ean,
            categoria_id=cat.id,
            costo_unitario=costo,
            precio=precio,
            stock_minimo=3,
            activo=True,
            clase_abc="A",
        )
    )
    db.flush()

    sato_id = uuid.uuid4()
    if stock_vitrina > 0:
        db.add(
            Sato(
                sato_id=sato_id,
                tenant_id=tenant_id,
                tipo_sato="PRODUCTO",
                sku=sku,
                lote=f"L-{sku}",
                cantidad=stock_vitrina,
                estado="Vitrina",
                fecha_vencimiento=date.today() + timedelta(days=dias_vencimiento),
            )
        )
    if con_anomalia:
        db.add(
            Anomalia_Stock(
                tenant_id=tenant_id,
                sku=sku,
                ubicacion_id="GOND-01",
                tipo="VENTA_SIN_STOCK",
                estado="ABIERTA",
                unidades_deficit=2,
                referencia_ticket="BOL-ANOM-01",
                detalles="Déficit detectado en vitrina.",
            )
        )
    db.commit()
    return sato_id


def test_01_conteo_ciclico_ok_persiste_cierra_anomalias_y_respeta_multitenant():
    client = TestClient(app)
    db = RoutingSessionLocal()
    try:
        sato_id = _seed_producto_con_satos(
            db,
            TENANT_A,
            sku="SKU-P2-YOG",
            ean="7801111000011",
            nombre="Yogurt Natural 1L",
            stock_vitrina=8,
            dias_vencimiento=4,
            con_anomalia=True,
        )
        # Producto en Tenant A sin ningún SATO histórico (debe guardar ultimo_conteo_at sin fallar por FK)
        _seed_producto_con_satos(
            db,
            TENANT_A,
            sku="SKU-P2-CERO",
            ean="7801111000022",
            nombre="Producto Sin Lotes Históricos",
            stock_vitrina=0,
            con_anomalia=False,
        )
        # Producto en Tenant B para validar aislamiento
        _seed_producto_con_satos(
            db,
            TENANT_B,
            sku="SKU-P2-TB",
            ean="7802222000011",
            nombre="Producto Tenant B",
            stock_vitrina=5,
        )
    finally:
        db.close()

    # 1. Confirmar Conteo OK en Tenant A (debe persistir ultimo_conteo_at, cerrar anomalía y loguear)
    r_ok = client.post(
        "/api/v1/abc/conteo-ok",
        headers={"X-Tenant-ID": TENANT_A},
        json={"sku": "SKU-P2-YOG", "origen": "RUTINA_10MIN", "resolver_anomalias": True},
    )
    assert r_ok.status_code == 200, r_ok.text
    body = r_ok.json()
    assert body["sku"] == "SKU-P2-YOG"
    assert body["stock_verificado_vitrina"] == 8
    assert body["stock_verificado_total"] == 8
    assert body["anomalias_cerradas"] == 1
    assert body["log_registrado"] is True
    assert body["ultimo_conteo_at"] is not None

    # 2. Verificar que /catalogo/stock-agrupado exponga ultimo_conteo_at para sobrevivir reloads
    r_stock = client.get("/api/v1/catalogo/stock-agrupado", headers={"X-Tenant-ID": TENANT_A})
    assert r_stock.status_code == 200
    productos_flat = [
        p
        for fam in r_stock.json()
        for sub in fam.get("sub_familias", [])
        for p in sub.get("productos", [])
    ]
    yog = next(p for p in productos_flat if p["sku"] == "SKU-P2-YOG")
    assert yog["ultimo_conteo_at"] is not None

    # 3. Verificar en BD que la anomalía quedó RESUELTA y se registró CONTEO_CICLICO_SIN_DIFERENCIA
    db_chk = RoutingSessionLocal()
    try:
        current_tenant_id.set(TENANT_A)
        anom = db_chk.query(Anomalia_Stock).filter(Anomalia_Stock.sku == "SKU-P2-YOG").first()
        assert anom is not None
        assert anom.estado == "RESUELTA"
        assert anom.resolved_at is not None

        log = (
            db_chk.query(Log_Transaccional)
            .filter(
                Log_Transaccional.sato_id == sato_id,
                Log_Transaccional.accion == "CONTEO_CICLICO_SIN_DIFERENCIA",
            )
            .first()
        )
        assert log is not None
        assert "RUTINA_10MIN" in (log.detalles or "")
    finally:
        db_chk.close()

    # 4. Producto sin ningún SATO histórico debe retornar 200 con log_registrado=False
    r_zero = client.post(
        "/api/v1/abc/conteo-ok",
        headers={"X-Tenant-ID": TENANT_A},
        json={"sku": "SKU-P2-CERO", "origen": "MODO_PISTOLA"},
    )
    assert r_zero.status_code == 200, r_zero.text
    assert r_zero.json()["log_registrado"] is False
    assert r_zero.json()["ultimo_conteo_at"] is not None

    # 5. Aislamiento Multi-Tenant: Tenant A no puede confirmar SKU perteneciente solo a Tenant B
    r_cross = client.post(
        "/api/v1/abc/conteo-ok",
        headers={"X-Tenant-ID": TENANT_A},
        json={"sku": "SKU-P2-TB"},
    )
    assert r_cross.status_code == 404


def test_02_liquidacion_sato_pre_merma_y_vendibilidad_fefo():
    client = TestClient(app)
    db = RoutingSessionLocal()
    try:
        sato_ok_id = _seed_producto_con_satos(
            db,
            TENANT_A,
            sku="SKU-LIQ-01",
            ean="7803333000011",
            nombre="Queso Fresco 250g",
            precio=3000,
            costo=1800,
            stock_vitrina=5,
            dias_vencimiento=2,
        )
        # Segundo SKU para validar rechazos 400 (vencido, agotado, contenedor) sin interferir en el FEFO de SKU-LIQ-01
        _seed_producto_con_satos(
            db,
            TENANT_A,
            sku="SKU-LIQ-BAD",
            ean="7803333000028",
            nombre="Leche Entera Control",
            precio=1500,
            costo=900,
            stock_vitrina=0,
        )
        current_tenant_id.set(TENANT_A)
        sato_vencido_id = uuid.uuid4()
        db.add(
            Sato(
                sato_id=sato_vencido_id,
                tenant_id=TENANT_A,
                tipo_sato="PRODUCTO",
                sku="SKU-LIQ-BAD",
                lote="L-VENCIDO",
                cantidad=3,
                estado="Vitrina",
                fecha_vencimiento=date.today() - timedelta(days=1),
            )
        )
        sato_agotado_id = uuid.uuid4()
        db.add(
            Sato(
                sato_id=sato_agotado_id,
                tenant_id=TENANT_A,
                tipo_sato="PRODUCTO",
                sku="SKU-LIQ-BAD",
                lote="L-AGOTADO",
                cantidad=0,
                estado="Agotado",
                fecha_vencimiento=date.today() + timedelta(days=2),
            )
        )
        sato_lpn_id = uuid.uuid4()
        db.add(
            Sato(
                sato_id=sato_lpn_id,
                tenant_id=TENANT_A,
                tipo_sato="CONTENEDOR",
                lpn="LPN-PALLET-P2",
                cantidad=None,
                estado="Bodega",
            )
        )
        db.commit()
    finally:
        db.close()

    # 1. Marcar lote vigente en liquidación (-30% sobre $3.000 = $2.100)
    r_liq = client.post(
        f"/api/v1/inventario/satos/{sato_ok_id}/liquidacion",
        headers={"X-Tenant-ID": TENANT_A},
        json={"en_liquidacion": True, "descuento_pct": 30},
    )
    assert r_liq.status_code == 200, r_liq.text
    res_liq = r_liq.json()
    assert res_liq["en_liquidacion"] is True
    assert res_liq["estado"] == "Vitrina"  # Invariante FEFO: conserva estado activo
    assert res_liq["precio_regular"] == 3000
    assert res_liq["precio_liquidacion"] == 2100

    # 2. Dashboard y Catálogo muestran el lote en remate
    r_kpi = client.get("/api/v1/dashboard/kpis", headers={"X-Tenant-ID": TENANT_A})
    assert r_kpi.status_code == 200
    kpi = r_kpi.json()
    assert kpi["alertas_operativas"]["lotes_en_liquidacion_count"] == 1
    radar_match = next(i for i in kpi["radar_fefo_items"] if i["sato_id"] == str(sato_ok_id))
    assert radar_match["en_liquidacion"] is True
    assert radar_match["precio_liquidacion"] == 2100

    r_cat = client.get("/api/v1/catalogo/stock-agrupado", headers={"X-Tenant-ID": TENANT_A})
    assert r_cat.status_code == 200
    lote_cat = next(
        l
        for fam in r_cat.json()
        for sub in fam.get("sub_familias", [])
        for p in sub.get("productos", [])
        if p["sku"] == "SKU-LIQ-01"
        for l in p.get("lotes", [])
        if l["sato_id"] == str(sato_ok_id)
    )
    assert lote_cat["en_liquidacion"] is True
    assert lote_cat["precio_liquidacion"] == 2100

    # 3. Validaciones de negocio (400) y Multi-Tenant (404)
    for bad_id in (sato_vencido_id, sato_agotado_id, sato_lpn_id):
        r_bad = client.post(
            f"/api/v1/inventario/satos/{bad_id}/liquidacion",
            headers={"X-Tenant-ID": TENANT_A},
            json={"en_liquidacion": True, "descuento_pct": 30},
        )
        assert r_bad.status_code == 400, f"Esperado 400 para {bad_id}, got {r_bad.status_code}"

    r_mt = client.post(
        f"/api/v1/inventario/satos/{sato_ok_id}/liquidacion",
        headers={"X-Tenant-ID": TENANT_B},
        json={"en_liquidacion": True, "descuento_pct": 30},
    )
    assert r_mt.status_code == 404

    # 4. Vendibilidad FEFO intacta: una venta POS externa sigue descontando del lote en liquidación
    r_sale = client.post(
        "/api/v1/integration/sales/webhook",
        headers={"X-Tenant-ID": TENANT_A, "X-API-Key": API_KEY},
        json={
            "external_ticket_id": "BOL-LIQ-VENTA-01",
            "pos_source": "BSALE_POS",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "items": [{"sku": "SKU-LIQ-01", "cantidad": 2, "precio_unitario": 2100}],
        },
    )
    assert r_sale.status_code == 200, r_sale.text
    assert r_sale.json()["total_descontado"] == 2
    assert r_sale.json()["satos_afectados"][0]["sato_id"] == str(sato_ok_id)

    # 5. Retirar de remate limpia los campos y registra RETIRO_LIQUIDACION
    r_off = client.post(
        f"/api/v1/inventario/satos/{sato_ok_id}/liquidacion",
        headers={"X-Tenant-ID": TENANT_A},
        json={"en_liquidacion": False},
    )
    assert r_off.status_code == 200, r_off.text
    assert r_off.json()["en_liquidacion"] is False
    assert r_off.json()["precio_liquidacion"] is None
    assert r_off.json()["cantidad"] == 3  # 5 - 2 vendidos

    db_chk = RoutingSessionLocal()
    try:
        current_tenant_id.set(TENANT_A)
        acciones = [
            row.accion
            for row in db_chk.query(Log_Transaccional)
            .filter(Log_Transaccional.sato_id == sato_ok_id)
            .order_by(Log_Transaccional.id.asc())
            .all()
        ]
        assert "MARCADO_LIQUIDACION" in acciones
        assert "VENTA_EXTERNA_POS" in acciones
        assert "RETIRO_LIQUIDACION" in acciones
    finally:
        db_chk.close()


def test_03_contract_sentinel_prioridad2_openapi_vs_typescript():
    spec = app.openapi()
    paths = spec.get("paths", {})
    assert "/api/v1/abc/conteo-ok" in paths
    assert "post" in paths["/api/v1/abc/conteo-ok"]
    assert "/api/v1/inventario/satos/{sato_id}/liquidacion" in paths
    assert "post" in paths["/api/v1/inventario/satos/{sato_id}/liquidacion"]

    api_ts = pathlib.Path("frontend/src/services/api.ts").read_text(encoding="utf-8")
    for required_symbol in (
        "confirmarConteoCiclicoOk",
        "configurarLiquidacionSato",
        "/api/v1/abc/conteo-ok",
        "/liquidacion",
        "ultimo_conteo_at",
        "en_liquidacion",
        "precio_liquidacion",
    ):
        assert required_symbol in api_ts, f"Falta '{required_symbol}' en frontend/src/services/api.ts"
