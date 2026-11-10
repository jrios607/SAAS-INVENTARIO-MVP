"""
tests/test_omni_pos_and_multitenant.py
─────────────────────────────────────────────────────────────────────────────
Suite de verificación automatizada para:
  1. Aislamiento Multi-Tenant en Caché Redis (_scoped_key) y Memoria (TTLCache).
  2. Aislamiento Multi-Tenant en ORM SQLAlchemy (do_orm_execute + before_insert).
  3. Conector Universal de Ventas Externas (Omni-POS):
     - Canal A: POS con API Key (/api/v1/integration/sales/webhook) + FEFO + Idempotencia.
     - Canal B: POS sin API Key (/api/v1/integration/sales/import-file CSV/JSON y import-batch)
       con savepoints por ticket y resolución dual SKU/EAN.
  4. Seguridad configurable (AUTH_REQUIRED) y protección anti-spoofing JWT ↔ Tenant.
"""

import io
import os
from datetime import date, timedelta

# Forzar base de datos SQLite aislada para tests antes de importar app.*
os.environ["DATABASE_URL"] = "sqlite:///./test_omni_pos_suite.db"
os.environ["DATABASE_POOLER_URL"] = ""
os.environ["DATABASE_READ_URL"] = ""
os.environ["REDIS_URL"] = ""
os.environ["INTEGRATION_API_KEY"] = "test-pos-api-key-secret-2026"

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.tenant import current_tenant_id
from app.core.cache import _scoped_key, CacheKeys
from app.core.security import create_access_token
from app.database import Base, engine, RoutingSessionLocal
from app.models import (
    Tenant, Catalogo_Producto, Categoria, Patente, Sato,
    Log_Transaccional, Usuario, Venta_Externa, Integration_Log
)
from app.services.catalogo_service import listar_productos, invalidar_cache_catalogo
from app.main import app

TENANT_A = "aaaa1111-1111-1111-1111-111111111111"
TENANT_B = "bbbb2222-2222-2222-2222-222222222222"
API_KEY = "test-pos-api-key-secret-2026"


def _purgar_tenants_test(db):
    """Elimina únicamente los registros de TENANT_A y TENANT_B sin tocar datos de otros tenants."""
    for tid in (TENANT_A, TENANT_B):
        current_tenant_id.set(tid)
        db.query(Log_Transaccional).filter(Log_Transaccional.tenant_id == tid).delete(synchronize_session=False)
        db.query(Venta_Externa).filter(Venta_Externa.tenant_id == tid).delete(synchronize_session=False)
        db.query(Integration_Log).filter(Integration_Log.tenant_id == tid).delete(synchronize_session=False)
        db.query(Sato).filter(Sato.tenant_id == tid).delete(synchronize_session=False)
        db.query(Patente).filter(Patente.tenant_id == tid).delete(synchronize_session=False)
        db.query(Catalogo_Producto).filter(Catalogo_Producto.tenant_id == tid).delete(synchronize_session=False)
        db.query(Categoria).filter(Categoria.tenant_id == tid).delete(synchronize_session=False)
        db.query(Usuario).filter(Usuario.tenant_id == tid).delete(synchronize_session=False)
    db.commit()


@pytest.fixture(autouse=True)
def setup_clean_db():
    """Prepara datos aislados para TENANT_A y TENANT_B sin borrar datos de otros tenants."""
    settings.INTEGRATION_API_KEY = API_KEY
    settings.AUTH_REQUIRED = False
    Base.metadata.create_all(bind=engine)

    db = RoutingSessionLocal()
    try:
        _purgar_tenants_test(db)
        for tid, nombre in [(TENANT_A, "Supermercado Tenant A"), (TENANT_B, "Farmacia Tenant B")]:
            if not db.query(Tenant).filter(Tenant.id == tid).first():
                db.add(Tenant(id=tid, nombre=nombre, activo=True))
        db.commit()

        # Sembrar datos del Tenant A
        current_tenant_id.set(TENANT_A)
        invalidar_cache_catalogo()
        db.add(Catalogo_Producto(
            sku="SKU-LECHE-A",
            nombre="Leche Entera 1L Tenant A",
            ean="7800000000011",
            precio=1200,
            controla_vencimiento=True,
        ))
        db.add(Patente(
            id_patente="GOND-A1",
            area_pasillo="PASILLO 1",
            tipo_mueble="Gondola",
            tipo_ubicacion="SALA_VENTA",
        ))
        # Dos lotes con distinto vencimiento para verificar FEFO estricto
        sato_vence_tarde = Sato(
            tipo_sato="PRODUCTO",
            sku="SKU-LECHE-A",
            ubicacion_id="GOND-A1",
            lote="LOTE-TARDE",
            fecha_vencimiento=date.today() + timedelta(days=30),
            cantidad=10,
            estado="Vitrina",
        )
        sato_vence_pronto = Sato(
            tipo_sato="PRODUCTO",
            sku="SKU-LECHE-A",
            ubicacion_id="GOND-A1",
            lote="LOTE-PRONTO",
            fecha_vencimiento=date.today() + timedelta(days=5),
            cantidad=4,
            estado="Vitrina",
        )
        db.add_all([sato_vence_tarde, sato_vence_pronto])
        db.commit()

        # Sembrar datos del Tenant B
        current_tenant_id.set(TENANT_B)
        invalidar_cache_catalogo()
        db.add(Catalogo_Producto(
            sku="SKU-PARACET-B",
            nombre="Paracetamol 500mg Tenant B",
            ean="7800000000011",  # Mismo EAN en distinto tenant (permitido por UniqueConstraint)
            precio=2500,
        ))
        db.commit()
    finally:
        db.close()

    yield

    settings.AUTH_REQUIRED = False
    db_clean = RoutingSessionLocal()
    try:
        _purgar_tenants_test(db_clean)
    finally:
        db_clean.close()


@pytest.fixture(scope="session", autouse=True)
def cleanup_sqlite_file():
    yield
    engine.dispose()
    for suffix in ("", "-wal", "-shm"):
        path = f"./test_omni_pos_suite.db{suffix}"
        if os.path.exists(path):
            try:
                os.remove(path)
            except OSError:
                pass


# ── 1. Aislamiento Multi-Tenant en Caché Redis y Memoria ──────────────────

def test_redis_scoped_key_isolates_tenants():
    current_tenant_id.set(TENANT_A)
    key_a = _scoped_key(CacheKeys.CATALOGO_ALL)
    pattern_a = _scoped_key("sg:mapa:*")

    current_tenant_id.set(TENANT_B)
    key_b = _scoped_key(CacheKeys.CATALOGO_ALL)
    pattern_b = _scoped_key("sg:mapa:*")

    assert key_a == f"sg:t:{TENANT_A}:catalogo:productos:all"
    assert key_b == f"sg:t:{TENANT_B}:catalogo:productos:all"
    assert key_a != key_b
    assert pattern_a != pattern_b
    # Idempotencia si se pasa una clave ya particionada
    assert _scoped_key(key_b) == key_b


def test_in_memory_catalog_cache_isolates_tenants():
    db = RoutingSessionLocal()
    try:
        current_tenant_id.set(TENANT_A)
        prods_a = listar_productos(db)
        assert len(prods_a) == 1
        assert prods_a[0].sku == "SKU-LECHE-A"

        # Consultar inmediatamente con Tenant B no debe retornar la caché de Tenant A
        current_tenant_id.set(TENANT_B)
        prods_b = listar_productos(db)
        assert len(prods_b) == 1
        assert prods_b[0].sku == "SKU-PARACET-B"
    finally:
        db.close()


# ── 2. Canal A: POS Externo con API Key (/sales/webhook) + FEFO ───────────

def test_external_pos_webhook_fefo_and_idempotency():
    client = TestClient(app)
    headers = {
        "X-Tenant-ID": TENANT_A,
        "X-API-Key": API_KEY,
    }
    payload = {
        "external_ticket_id": "BOL-9001",
        "pos_source": "BSALE_POS",
        "timestamp": "2026-10-20T14:30:00Z",
        "items": [
            {"ean": "7800000000011", "cantidad": 6}
        ],
    }

    # Primera llamada: debe descontar 4 del LOTE-PRONTO (queda en 0 / Agotado) y 2 del LOTE-TARDE
    res = client.post("/api/v1/integration/sales/webhook", json=payload, headers=headers)
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["estado"] == "PROCESADO"
    assert data["total_descontado"] == 6
    assert len(data["satos_afectados"]) == 2
    assert data["satos_afectados"][0]["lote"] == "LOTE-PRONTO"
    assert data["satos_afectados"][0]["descontado"] == 4
    assert data["satos_afectados"][1]["lote"] == "LOTE-TARDE"
    assert data["satos_afectados"][1]["descontado"] == 2

    # Segunda llamada con el mismo external_ticket_id: debe ser idempotente y NO descontar otra vez
    res_dup = client.post("/api/v1/integration/sales/webhook", json=payload, headers=headers)
    assert res_dup.status_code == 200
    assert res_dup.json()["estado"] == "DUPLICADO"
    assert res_dup.json()["total_descontado"] == 0

    # Verificar en BD el stock restante y el Log_Transaccional
    db = RoutingSessionLocal()
    try:
        current_tenant_id.set(TENANT_A)
        pronto = db.query(Sato).filter(Sato.lote == "LOTE-PRONTO").first()
        tarde = db.query(Sato).filter(Sato.lote == "LOTE-TARDE").first()
        assert pronto.cantidad == 0
        assert pronto.estado == "Agotado"
        assert tarde.cantidad == 8
        assert tarde.estado == "Vitrina"

        logs = db.query(Log_Transaccional).filter(
            Log_Transaccional.accion == "VENTA_EXTERNA_POS"
        ).all()
        assert len(logs) == 2
    finally:
        db.close()


def test_external_pos_webhook_rejects_invalid_api_key():
    client = TestClient(app)
    res = client.post(
        "/api/v1/integration/sales/webhook",
        json={
            "external_ticket_id": "BOL-9999",
            "pos_source": "BSALE_POS",
            "items": [{"sku": "SKU-LECHE-A", "cantidad": 1}],
        },
        headers={"X-Tenant-ID": TENANT_A, "X-API-Key": "wrong-key"},
    )
    assert res.status_code == 401


# ── 3. Canal B: POS sin API Key (Importación CSV y Lotes con Savepoints) ──

def test_legacy_pos_csv_file_import_semicolon_and_savepoints():
    client = TestClient(app)
    # CSV típico de caja registradora en Latinoamérica (separado por ';' y cabeceras en español)
    # Boleta 1001: 3 unidades válidas
    # Boleta 1002: SKU inexistente → falla solo ese ticket sin abortar Boleta 1001 ni 1003
    # Boleta 1003: 2 unidades válidas por SKU
    csv_content = (
        "nro_boleta;codigo_barras;codigo_producto;unidades;fecha\n"
        "BOL-1001;7800000000011;;3;2026-10-20 10:15\n"
        "BOL-1002;;SKU-NO-EXISTE;2;2026-10-20 10:18\n"
        "BOL-1003;;SKU-LECHE-A;2;2026-10-20 10:20\n"
    ).encode("utf-8")

    res = client.post(
        "/api/v1/integration/sales/import-file",
        headers={"X-Tenant-ID": TENANT_A},
        files={"file": ("cierre_caja_z.csv", io.BytesIO(csv_content), "text/csv")},
        data={"pos_source": "CAJA_TRADICIONAL_Z", "allow_bodega_fallback": "false"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["tickets_recibidos"] == 3
    assert body["tickets_procesados"] == 2
    assert body["tickets_fallidos"] == 1
    assert body["unidades_descontadas"] == 5
    assert body["detalles_errores"][0]["external_ticket_id"] == "BOL-1002"

    # Re-subir exactamente el mismo archivo CSV: los 2 tickets válidos se detectan como DUPLICADO
    res_repeat = client.post(
        "/api/v1/integration/sales/import-file",
        headers={"X-Tenant-ID": TENANT_A},
        files={"file": ("cierre_caja_z.csv", io.BytesIO(csv_content), "text/csv")},
        data={"pos_source": "CAJA_TRADICIONAL_Z", "allow_bodega_fallback": "false"},
    )
    assert res_repeat.status_code == 200
    body_repeat = res_repeat.json()
    assert body_repeat["tickets_procesados"] == 0
    assert body_repeat["tickets_duplicados"] == 2
    assert body_repeat["unidades_descontadas"] == 0

    # Consultar historial desde el endpoint de la nueva UI (/sales/history)
    res_hist = client.get(
        "/api/v1/integration/sales/history?canal=ARCHIVO",
        headers={"X-Tenant-ID": TENANT_A},
    )
    assert res_hist.status_code == 200
    hist_items = res_hist.json()
    assert len(hist_items) == 2
    assert {h["external_ticket_id"] for h in hist_items} == {"BOL-1001", "BOL-1003"}

    # El Tenant B no debe ver el historial del Tenant A
    res_hist_b = client.get(
        "/api/v1/integration/sales/history",
        headers={"X-Tenant-ID": TENANT_B},
    )
    assert res_hist_b.status_code == 200
    assert res_hist_b.json() == []


# ── 4. Seguridad Configurable (AUTH_REQUIRED) y Cruce JWT ↔ Tenant ────────

def test_auth_required_flag_and_cross_tenant_jwt_protection():
    client = TestClient(app)

    # Crear usuario en Tenant A
    db = RoutingSessionLocal()
    try:
        current_tenant_id.set(TENANT_A)
        user_a = Usuario(nombre="supervisor_a", password_hash="x", rol="Supervisor")
        db.add(user_a)
        db.commit()
        db.refresh(user_a)
        user_a_id = user_a.id
    finally:
        db.close()

    # Activar modo estricto de producción
    settings.AUTH_REQUIRED = True

    # Sin token → 401 Unauthorized
    res_no_token = client.post(
        "/api/v1/integration/sales/import-batch",
        headers={"X-Tenant-ID": TENANT_A},
        json={
            "pos_source": "BATCH_POS",
            "tickets": [{"external_ticket_id": "T-1", "items": [{"sku": "SKU-LECHE-A", "cantidad": 1}]}],
        },
    )
    assert res_no_token.status_code == 401

    # Con token de Tenant A pero intentando operar sobre el header X-Tenant-ID de Tenant B → 403 Forbidden
    token_a = create_access_token({"sub": str(user_a_id), "rol": "Supervisor", "tenant_id": TENANT_A})
    res_cross_tenant = client.post(
        "/api/v1/integration/sales/import-batch",
        headers={"X-Tenant-ID": TENANT_B, "Authorization": f"Bearer {token_a}"},
        json={
            "pos_source": "BATCH_POS",
            "tickets": [{"external_ticket_id": "T-1", "items": [{"sku": "SKU-PARACET-B", "cantidad": 1}]}],
        },
    )
    assert res_cross_tenant.status_code == 403

    # Con token de Tenant A y header X-Tenant-ID de Tenant A → 200 OK
    res_valid = client.post(
        "/api/v1/integration/sales/import-batch",
        headers={"X-Tenant-ID": TENANT_A, "Authorization": f"Bearer {token_a}"},
        json={
            "pos_source": "BATCH_POS",
            "tickets": [{"external_ticket_id": "T-OK-1", "items": [{"sku": "SKU-LECHE-A", "cantidad": 2}]}],
        },
    )
    assert res_valid.status_code == 200
    assert res_valid.json()["unidades_descontadas"] == 2
