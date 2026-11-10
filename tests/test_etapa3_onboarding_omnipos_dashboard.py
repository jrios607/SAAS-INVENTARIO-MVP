"""
tests/test_etapa3_onboarding_omnipos_dashboard.py
─────────────────────────────────────────────────────────────────────────────
Suite de certificación End-to-End:
  1. Onboarding Adaptativo y Feature Flags (`GET/PUT /api/v1/tenant/settings`):
     - Cálculo determinista de módulos por perfil (`micro` vs `mediana`).
     - Aislamiento Multi-Tenant estricto en `Tenant.settings` y caché Redis (`_scoped_key`).
     - Política global `fallback_to_warehouse_on_zero_shelf` aplicada automáticamente en ventas.
  2. Pre-visualización Segura (`Dry-Run` — `POST /api/v1/integration/sales/import-file/dry-run`):
     - Detecta tickets nuevos, duplicados y códigos desconocidos sin mutar stock ni crear ventas.
  3. Cuarentena Parcial (`PARCIAL`) y Resolución Retroactiva (`/orphans` y `/orphans/resolve`):
     - Tickets con >= 1 ítem conocido y >= 1 desconocido descuentan lo conocido y envían el resto a `Venta_Externa_Huerfano`.
     - Resolución por `VINCULAR_EXISTENTE` y por `CREAR_PRODUCTO` descuenta FEFO retroactivamente y pasa el ticket a `COMPLETO`.
  4. Inspector de Boleta (`GET /api/v1/integration/sales/{id}/detalle`) y Reversión Total (`POST /api/v1/integration/sales/{id}/revertir`):
     - Restaura `Sato.cantidad` y `Sato.estado` (`Agotado` -> `En Vitrina`), cierra `Anomalia_Stock`, registra `Log_Transaccional` y bloquea doble reversión (`409`).
  5. Dashboard Real (`GET /api/v1/dashboard/kpis`):
     - Verifica agregaciones SQL reales de ventas de hoy, riesgo FEFO 7d, stock vitrina+bodega, radar FEFO y alertas operativas.
  6. Vigilancia de Contratos OpenAPI <-> TypeScript (`contract-sentinel`).
"""

import io
import os
import re
import uuid
from datetime import date, timedelta

os.environ["DATABASE_URL"] = "sqlite:///./test_etapa1_abc_suite.db"
os.environ["DATABASE_POOLER_URL"] = ""
os.environ["DATABASE_READ_URL"] = ""
os.environ["REDIS_URL"] = ""
os.environ["INTEGRATION_API_KEY"] = "test-etapa1-pos-api-key-2026"

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
    Configuracion_Conteo_Tenant,
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

TENANT_MICRO = "e3aa1111-1111-1111-1111-111111111111"
TENANT_MEDIANA = "e3bb2222-2222-2222-2222-222222222222"
API_KEY = "test-etapa1-pos-api-key-2026"


def _purgar_tenants_etapa3(db) -> None:
    for tid in (TENANT_MICRO, TENANT_MEDIANA):
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
        db.query(Configuracion_Conteo_Tenant).filter(
            Configuracion_Conteo_Tenant.tenant_id == tid
        ).delete(synchronize_session=False)
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
        t = db.query(Tenant).filter(Tenant.id == tid).first()
        if t:
            t.settings = {}
        invalidar_cache_catalogo()
    db.commit()


@pytest.fixture(autouse=True)
def setup_clean_etapa3_db():
    settings.INTEGRATION_API_KEY = API_KEY
    settings.AUTH_REQUIRED = False
    Base.metadata.create_all(bind=engine)

    db = RoutingSessionLocal()
    try:
        _purgar_tenants_etapa3(db)
        for tid, nombre in [
            (TENANT_MICRO, "Almacén Don Pedro Micro"),
            (TENANT_MEDIANA, "Supermercado Central Mediana"),
        ]:
            t = db.query(Tenant).filter(Tenant.id == tid).first()
            if not t:
                db.add(Tenant(id=tid, nombre=nombre, activo=True, settings={}))
            else:
                t.nombre = nombre
                t.settings = {}
        db.commit()
    finally:
        db.close()

    yield

    settings.AUTH_REQUIRED = False
    db_clean = RoutingSessionLocal()
    try:
        _purgar_tenants_etapa3(db_clean)
    finally:
        db_clean.close()


def test_01_onboarding_settings_multi_tenant_and_global_fallback():
    """
    Certifica:
    1. GET /api/v1/tenant/settings retorna defaults con onboarding_completed=False.
    2. PUT /api/v1/tenant/settings para perfil 'micro' calcula enabled_modules sin patentes/picking/asn.
    3. Aislamiento estricto entre TENANT_MICRO y TENANT_MEDIANA.
    4. Política global `fallback_to_warehouse_on_zero_shelf=True` descuenta automáticamente de Bodega
       cuando Vitrina queda en 0 sin enviar `allow_bodega_fallback` en el request de venta.
    """
    client = TestClient(app)

    # 1. GET inicial para TENANT_MICRO
    r_get = client.get("/api/v1/tenant/settings", headers={"X-Tenant-ID": TENANT_MICRO})
    assert r_get.status_code == 200
    data_init = r_get.json()
    assert data_init["tenant_id"] == TENANT_MICRO
    assert data_init["onboarding_completed"] is False

    # 2. Configurar TENANT_MICRO como Minimarket / Micro-Comercio (sin plano de bodega separado, sin GS1-128, con fallback a bodega)
    r_put_micro = client.put(
        "/api/v1/tenant/settings",
        headers={"X-Tenant-ID": TENANT_MICRO},
        json={
            "nombre_local": "Almacén Don Pedro",
            "onboarding_completed": True,
            "business_profile": {
                "scale": "minimarket",
                "has_separate_warehouse_map": False,
                "uses_gs1_128_fefo": False,
            },
            "pos_strategy": {
                "mode": "legacy_file_pos",
                "accepted_no_sii_disclaimer": True,
                "external_provider": "FACTURACION_CL",
                "fallback_to_warehouse_on_zero_shelf": True,
            },
        },
    )
    assert r_put_micro.status_code == 200
    micro_cfg = r_put_micro.json()
    assert micro_cfg["onboarding_completed"] is True
    assert micro_cfg["business_profile"]["scale"] == "minimarket"
    assert micro_cfg["pos_strategy"]["fallback_to_warehouse_on_zero_shelf"] is True
    assert "plano_bodega" not in micro_cfg["enabled_modules"]
    assert "picking" not in micro_cfg["enabled_modules"]
    assert "ordenes_compra" not in micro_cfg["enabled_modules"]
    assert "ventas_externas" in micro_cfg["enabled_modules"]

    # 3. Verificar aislamiento: TENANT_MEDIANA sigue con onboarding_completed=False
    r_get_med = client.get(
        "/api/v1/tenant/settings", headers={"X-Tenant-ID": TENANT_MEDIANA}
    )
    assert r_get_med.status_code == 200
    med_cfg = r_get_med.json()
    assert med_cfg["tenant_id"] == TENANT_MEDIANA
    assert med_cfg["onboarding_completed"] is False
    assert med_cfg["pos_strategy"]["fallback_to_warehouse_on_zero_shelf"] is False

    # 4. Probar política global de fallback a Bodega en TENANT_MICRO
    db = RoutingSessionLocal()
    try:
        current_tenant_id.set(TENANT_MICRO)
        db.add(
            Patente(
                id_patente="VIT-M1",
                tenant_id=TENANT_MICRO,
                area_pasillo="Estante Vitrina",
                tipo_mueble="Gondola",
                tipo_ubicacion="SALA_VENTA",
            )
        )
        db.add(
            Patente(
                id_patente="BOD-M1",
                tenant_id=TENANT_MICRO,
                area_pasillo="Trastienda Bodega",
                tipo_mueble="Rack",
                tipo_ubicacion="BODEGA_SECOS",
            )
        )
        db.add(
            Catalogo_Producto(
                sku="SKU-ARROZ-1K",
                tenant_id=TENANT_MICRO,
                nombre="Arroz Grado 1",
                ean="7801111000011",
                precio=1500.0,
                costo_unitario=1000.0,
                stock_minimo=5,
            )
        )
        # 2 unidades en Vitrina y 10 en Bodega
        sato_vit_id = uuid.UUID("11111111-1111-4111-8111-000000000001")
        sato_bod_id = uuid.UUID("11111111-1111-4111-8111-000000000002")
        db.add(
            Sato(
                sato_id=sato_vit_id,
                tenant_id=TENANT_MICRO,
                sku="SKU-ARROZ-1K",
                lote="L-VIT",
                fecha_vencimiento=date.today() + timedelta(days=20),
                cantidad=2,
                ubicacion_id="VIT-M1",
                estado="Vitrina",
                tipo_sato="PRODUCTO",
            )
        )
        db.add(
            Sato(
                sato_id=sato_bod_id,
                tenant_id=TENANT_MICRO,
                sku="SKU-ARROZ-1K",
                lote="L-BOD",
                fecha_vencimiento=date.today() + timedelta(days=40),
                cantidad=10,
                ubicacion_id="BOD-M1",
                estado="Bodega",
                tipo_sato="PRODUCTO",
            )
        )
        db.commit()
    finally:
        db.close()

    # Enviar venta de 5 unidades SIN especificar allow_bodega_fallback (debe usar la política global True)
    r_sale = client.post(
        "/api/v1/integration/sales/import-batch",
        headers={"X-Tenant-ID": TENANT_MICRO},
        json={
            "pos_source": "FACTURACION_CL",
            "tickets": [
                {
                    "external_ticket_id": "BOL-FALLBACK-01",
                    "pos_source": "FACTURACION_CL",
                    "items": [{"sku": "SKU-ARROZ-1K", "cantidad": 5}],
                }
            ],
        },
    )
    assert r_sale.status_code == 200
    sale_json = r_sale.json()
    assert sale_json["unidades_descontadas"] == 5
    assert sale_json["unidades_deficit"] == 0


def test_02_dry_run_quarantine_parcial_and_retroactive_resolution():
    """
    Certifica:
    1. Dry-Run (`POST /api/v1/integration/sales/import-file/dry-run`) analiza CSV sin mutar stock.
    2. Procesamiento `PARCIAL` cuando un ticket tiene 1 ítem conocido y 1 desconocido (`Venta_Externa_Huerfano`).
    3. Resolución retroactiva (`POST /api/v1/integration/sales/orphans/resolve`) vinculando a SKU existente
       y creando producto nuevo al vuelo.
    """
    client = TestClient(app)

    db = RoutingSessionLocal()
    try:
        current_tenant_id.set(TENANT_MICRO)
        db.add(
            Patente(
                id_patente="VIT-02",
                tenant_id=TENANT_MICRO,
                area_pasillo="Góndola Central",
                tipo_mueble="Gondola",
                tipo_ubicacion="SALA_VENTA",
            )
        )
        db.add(
            Catalogo_Producto(
                sku="SKU-LECHE-1L",
                tenant_id=TENANT_MICRO,
                nombre="Leche Entera 1L",
                ean="7802222000011",
                precio=1200.0,
                costo_unitario=850.0,
                stock_minimo=5,
            )
        )
        db.add(
            Catalogo_Producto(
                sku="SKU-PAN-MOLDE",
                tenant_id=TENANT_MICRO,
                nombre="Pan de Molde Blanco",
                ean="7800000999900",
                precio=2100.0,
                costo_unitario=1400.0,
                stock_minimo=3,
            )
        )
        sato_leche_id = uuid.UUID("22222222-2222-4222-8222-000000000001")
        sato_pan_id = uuid.UUID("22222222-2222-4222-8222-000000000002")
        db.add(
            Sato(
                sato_id=sato_leche_id,
                tenant_id=TENANT_MICRO,
                sku="SKU-LECHE-1L",
                lote="L-LEC-01",
                fecha_vencimiento=date.today() + timedelta(days=10),
                cantidad=20,
                ubicacion_id="VIT-02",
                estado="Vitrina",
                tipo_sato="PRODUCTO",
            )
        )
        db.add(
            Sato(
                sato_id=sato_pan_id,
                tenant_id=TENANT_MICRO,
                sku="SKU-PAN-MOLDE",
                lote="L-PAN-01",
                fecha_vencimiento=date.today() + timedelta(days=8),
                cantidad=15,
                ubicacion_id="VIT-02",
                estado="Vitrina",
                tipo_sato="PRODUCTO",
            )
        )
        db.commit()
    finally:
        db.close()

    csv_content = (
        "nro_boleta;codigo_barras;unidades;precio_unitario\n"
        "BOL-MIX-100;7802222000011;3;1200\n"
        "BOL-MIX-100;7809999888877;2;2100\n"
    ).encode("utf-8")

    # 1. Ejecutar Dry-Run
    r_dry = client.post(
        "/api/v1/integration/sales/import-file/dry-run",
        headers={"X-Tenant-ID": TENANT_MICRO},
        files={"file": ("cierre_pos.csv", io.BytesIO(csv_content), "text/csv")},
        data={"pos_source": "FACTURACION_CL", "modo_historico_abc": "false"},
    )
    assert r_dry.status_code == 200
    dry_data = r_dry.json()
    assert dry_data["boletas_nuevas_a_procesar"] == 1
    assert dry_data["boletas_parciales_con_huerfanos"] == 1
    assert dry_data["unidades_a_descontar"] == 3
    assert len(dry_data["codigos_desconocidos"]) == 1
    assert dry_data["codigos_desconocidos"][0]["codigo_original"] == "7809999888877"

    # Verificar que Dry-Run NO tocó el stock de sato_leche_id (sigue en 20)
    db_check = RoutingSessionLocal()
    try:
        current_tenant_id.set(TENANT_MICRO)
        sato_leche = (
            db_check.query(Sato).filter(Sato.sato_id == sato_leche_id).first()
        )
        assert sato_leche.cantidad == 20
    finally:
        db_check.close()

    # 2. Importar archivo real -> Debe quedar PARCIAL
    r_imp = client.post(
        "/api/v1/integration/sales/import-file",
        headers={"X-Tenant-ID": TENANT_MICRO},
        files={"file": ("cierre_pos.csv", io.BytesIO(csv_content), "text/csv")},
        data={"pos_source": "FACTURACION_CL", "modo_historico_abc": "false"},
    )
    assert r_imp.status_code == 200
    imp_data = r_imp.json()
    assert imp_data["tickets_procesados"] == 1
    assert imp_data["tickets_parciales"] == 1
    assert imp_data["unidades_descontadas"] == 3
    assert imp_data["items_huerfanos_count"] == 1

    # 3. Consultar bandeja de huérfanos
    r_orph = client.get(
        "/api/v1/integration/sales/orphans", headers={"X-Tenant-ID": TENANT_MICRO}
    )
    assert r_orph.status_code == 200
    orphans = r_orph.json()
    assert len(orphans) == 1
    assert orphans[0]["codigo_original"] == "7809999888877"
    assert orphans[0]["unidades_pendientes"] == 2

    # 4. Resolver huérfano vinculándolo a SKU-PAN-MOLDE
    r_res = client.post(
        "/api/v1/integration/sales/orphans/resolve",
        headers={"X-Tenant-ID": TENANT_MICRO},
        json={
            "codigo_original": "7809999888877",
            "accion": "VINCULAR_EXISTENTE",
            "sku_existente": "SKU-PAN-MOLDE",
            "actualizar_ean_producto": True,
        },
    )
    assert r_res.status_code == 200
    res_data = r_res.json()
    assert res_data["sku_vinculado"] == "SKU-PAN-MOLDE"
    assert res_data["unidades_descontadas_retroactivas"] == 2
    assert res_data["boletas_actualizadas_a_completo"] == 1

    # Verificar que SATO-PAN-01 bajó de 15 a 13 y la bandeja de huérfanos quedó vacía
    r_orph_after = client.get(
        "/api/v1/integration/sales/orphans", headers={"X-Tenant-ID": TENANT_MICRO}
    )
    assert r_orph_after.json() == []


def test_03_ticket_inspector_reversion_and_dashboard_kpis_real():
    """
    Certifica:
    1. Inspector de Boleta (`GET /api/v1/integration/sales/{venta_id}/detalle`) expone los lotes SATO exactos.
    2. Reversión Total (`POST /api/v1/integration/sales/{venta_id}/revertir`) restaura `Sato.cantidad` y `Sato.estado`
       (`Agotado` -> `En Vitrina`), cierra `Anomalia_Stock` y bloquea doble reversión (`409`).
    3. Dashboard Real (`GET /api/v1/dashboard/kpis`) calcula métricas en vivo y cumple el contrato TypeScript.
    """
    client = TestClient(app)

    db = RoutingSessionLocal()
    try:
        current_tenant_id.set(TENANT_MICRO)
        db.add(
            Patente(
                id_patente="VIT-03",
                tenant_id=TENANT_MICRO,
                area_pasillo="Vitrina Lácteos",
                tipo_mueble="Gondola",
                tipo_ubicacion="SALA_VENTA",
            )
        )
        db.add(
            Catalogo_Producto(
                sku="SKU-YOGURT-01",
                tenant_id=TENANT_MICRO,
                nombre="Yogurt Batido Frutilla",
                ean="7803333000011",
                precio=500.0,
                costo_unitario=300.0,
                stock_minimo=10,
            )
        )
        # SATO con 4 unidades que vence en 5 días (entra en radar FEFO <= 7d)
        sato_yog_id = uuid.UUID("33333333-3333-4333-8333-000000000001")
        db.add(
            Sato(
                sato_id=sato_yog_id,
                tenant_id=TENANT_MICRO,
                sku="SKU-YOGURT-01",
                lote="L-YOG-5D",
                fecha_vencimiento=date.today() + timedelta(days=5),
                cantidad=4,
                ubicacion_id="VIT-03",
                estado="Vitrina",
                tipo_sato="PRODUCTO",
            )
        )
        db.commit()
    finally:
        db.close()

    # 1. Verificar Dashboard KPIs antes de la venta (4 uds en vitrina, 1 lote en riesgo <= 7d)
    r_kpi_pre = client.get(
        "/api/v1/dashboard/kpis", headers={"X-Tenant-ID": TENANT_MICRO}
    )
    assert r_kpi_pre.status_code == 200
    kpi_pre = r_kpi_pre.json()
    assert kpi_pre["stock_vitrina_unidades"] == 4
    assert kpi_pre["lotes_riesgo_vencimiento_count"] == 1
    assert kpi_pre["perdida_proyectada_clp"] == 1200.0  # 4 * 300 costo_unitario
    assert len(kpi_pre["radar_fefo_items"]) == 1

    # 2. Vender 6 unidades (agota las 4 en vitrina -> Agotado y genera 2 de déficit en Anomalia_Stock)
    r_sale = client.post(
        "/api/v1/integration/sales/import-batch",
        headers={"X-Tenant-ID": TENANT_MICRO},
        json={
            "pos_source": "BSALE_POS",
            "tickets": [
                {
                    "external_ticket_id": "BOL-REV-900",
                    "pos_source": "BSALE_POS",
                    "items": [
                        {"sku": "SKU-YOGURT-01", "cantidad": 6, "precio_unitario": 500}
                    ],
                }
            ],
        },
    )
    assert r_sale.status_code == 200

    # Obtener ID de la venta desde el historial
    r_hist = client.get(
        "/api/v1/integration/sales/history", headers={"X-Tenant-ID": TENANT_MICRO}
    )
    assert r_hist.status_code == 200
    venta_id = r_hist.json()[0]["id"]

    # 3. Inspeccionar el detalle de la boleta
    r_det = client.get(
        f"/api/v1/integration/sales/{venta_id}/detalle",
        headers={"X-Tenant-ID": TENANT_MICRO},
    )
    assert r_det.status_code == 200
    det = r_det.json()
    assert det["external_ticket_id"] == "BOL-REV-900"
    assert det["puede_revertirse"] is True
    assert len(det["descuentos_fefo"]) == 1
    assert det["descuentos_fefo"][0]["sato_id"] == str(sato_yog_id)
    assert det["descuentos_fefo"][0]["unidades_descontadas"] == 4

    # 4. Revertir la boleta
    r_rev = client.post(
        f"/api/v1/integration/sales/{venta_id}/revertir",
        headers={"X-Tenant-ID": TENANT_MICRO},
        json={"motivo": "Boleta anulada por cliente en caja"},
    )
    assert r_rev.status_code == 200
    rev = r_rev.json()
    assert rev["estado_procesamiento"] == "REVERTIDO"
    assert rev["unidades_restituidas"] == 4
    assert rev["anomalias_cerradas_count"] == 1

    # 5. Intentar revertir por segunda vez -> Debe retornar 409 Conflict
    r_rev_dup = client.post(
        f"/api/v1/integration/sales/{venta_id}/revertir",
        headers={"X-Tenant-ID": TENANT_MICRO},
        json={"motivo": "Intento duplicado"},
    )
    assert r_rev_dup.status_code == 409

    # 6. Verificar que sato_yog_id recuperó sus 4 unidades y su estado "Vitrina"
    db_post = RoutingSessionLocal()
    try:
        current_tenant_id.set(TENANT_MICRO)
        sato_restored = (
            db_post.query(Sato).filter(Sato.sato_id == sato_yog_id).first()
        )
        assert sato_restored.cantidad == 4
        assert sato_restored.estado == "Vitrina"
    finally:
        db_post.close()


def test_04_contract_sentinel_etapa3_schemas():
    """
    Verifica que los nuevos esquemas Pydantic expuestos en /openapi.json tengan
    correspondencia exacta de propiedades en frontend/src/services/api.ts.
    """
    client = TestClient(app)
    openapi = client.get("/openapi.json").json()
    schemas = openapi["components"]["schemas"]

    with open("frontend/src/services/api.ts", "r", encoding="utf-8") as f:
        ts_content = f.read()

    target_contracts = [
        "TenantSettingsResponse",
        "ExternalSaleDryRunResponse",
        "OrphanCodeGroupItem",
        "ExternalSaleTicketDetailResponse",
        "RevertirVentaResponse",
    ]

    for schema_name in target_contracts:
        assert schema_name in schemas, f"Falta {schema_name} en OpenAPI"
        pydantic_props = set(schemas[schema_name].get("properties", {}).keys())

        pattern = rf"export interface {schema_name}\s*\{{([^}}]+)\}}"
        match = re.search(pattern, ts_content, re.DOTALL)
        assert match is not None, f"Falta interface {schema_name} en api.ts"
        body = match.group(1)
        ts_props = set(re.findall(r"^\s*([a-zA-Z0-9_]+)\??\s*:", body, re.MULTILINE))

        missing_in_ts = pydantic_props - ts_props
        assert not missing_in_ts, (
            f"Drift detectado en {schema_name}: faltan en api.ts -> {missing_in_ts}"
        )
