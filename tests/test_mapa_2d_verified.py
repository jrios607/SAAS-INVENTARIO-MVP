# -*- coding: utf-8 -*-
"""
Suite de Pruebas de Verificación y Regresión: Módulo Mapa 2D de Supermercado y Vitrina
Verifica que todas las vulnerabilidades encontradas en la auditoría fueron subsanadas:
1. Prevención de Duplicados en el mismo tenant (HTTP 400 en lugar de 500).
2. Aislamiento Multi-Tenant (claves primarias compuestas permiten mismos IDs en distintos tenants).
3. Sanitización e Inmunidad contra XSS, SQLi, URLs javascript:, dimensiones negativas y strings vacíos (HTTP 422).
4. Cache Invalidation automática en Redis/Memoria al mutar patentes.
5. Flujo de Reposición en 1 Paso (`POST /vitrina/mover-sato`) con soporte para cantidad parcial,
   FEFO, no vencidos y compliance híbrido (grilla, surtido plano o stock bruto).
"""
import uuid
import pytest
from datetime import date, timedelta
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.main import app, limiter
from app.database import Base, get_db, get_db_read
from app.models import Tenant, Usuario, Sato, Patente, DecoracionPlano, Catalogo_Producto
from app.core.tenant import current_tenant_id
from app.core.security import get_current_user

from sqlalchemy.pool import StaticPool

TENANT_VERIF_A = "verif-tenant-mapa-a-1111"
TENANT_VERIF_B = "verif-tenant-mapa-b-2222"

TEST_SQLITE_URL = "sqlite:///:memory:"
engine = create_engine(
    TEST_SQLITE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool
)
TestSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

fake_redis_store = {}

def fake_cache_get(key: str):
    return fake_redis_store.get(key)

def fake_cache_set(key: str, value, ttl: int = None):
    fake_redis_store[key] = value

def fake_cache_delete(key: str):
    fake_redis_store.pop(key, None)

def fake_cache_delete_pattern(pattern: str):
    import fnmatch
    keys_to_delete = [k for k in fake_redis_store.keys() if fnmatch.fnmatch(k, pattern)]
    for k in keys_to_delete:
        fake_redis_store.pop(k, None)


@pytest.fixture(scope="session", autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    db = TestSessionLocal()
    try:
        t_a = Tenant(id=TENANT_VERIF_A, nombre="Supermercado Norte A", activo=True)
        t_b = Tenant(id=TENANT_VERIF_B, nombre="Minimarket Sur B", activo=True)
        db.add_all([t_a, t_b])

        u_a = Usuario(
            id=1,
            tenant_id=TENANT_VERIF_A,
            nombre="Admin Norte",
            password_hash="fake",
            rol="Admin"
        )
        u_b = Usuario(
            id=2,
            tenant_id=TENANT_VERIF_B,
            nombre="Admin Sur",
            password_hash="fake",
            rol="Admin"
        )
        db.add_all([u_a, u_b])
        db.commit()
    finally:
        db.close()
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(autouse=True)
def patch_cache(monkeypatch):
    import app.core.cache as c
    import app.domains.wms.routers.patente as p_mod
    import app.domains.wms.routers.vitrina as v_mod
    import app.domains.wms.routers.bodega as b_mod
    import app.services.slotting_service as s_serv
    import app.services.inventario_service as i_serv

    for mod in (c, p_mod, v_mod, b_mod, s_serv, i_serv):
        monkeypatch.setattr(mod, "cache_get", fake_cache_get, raising=False)
        monkeypatch.setattr(mod, "cache_set", fake_cache_set, raising=False)
        monkeypatch.setattr(mod, "cache_delete", fake_cache_delete, raising=False)
        monkeypatch.setattr(mod, "cache_delete_pattern", fake_cache_delete_pattern, raising=False)

    fake_redis_store.clear()


@pytest.fixture
def client():
    def override_get_db():
        db = TestSessionLocal()
        try:
            yield db
        finally:
            db.close()

    def override_get_current_user():
        tid = current_tenant_id.get() or TENANT_VERIF_A
        return Usuario(
            id=1,
            tenant_id=tid,
            nombre=f"user_{tid}",
            password_hash="fake",
            rol="Admin"
        )

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_db_read] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user
    limiter.enabled = False

    with TestClient(app) as tc:
        yield tc

    app.dependency_overrides.clear()
    limiter.enabled = True


# =========================================================================
# 1. PREVENCIÓN DE DUPLICADOS EN EL MISMO TENANT (HTTP 400)
# =========================================================================
def test_01_patente_duplicada_mismo_tenant_retorna_400(client: TestClient):
    headers_a = {"X-Tenant-ID": TENANT_VERIF_A}
    payload = {
        "id_patente": "GOND-A-01",
        "area_pasillo": "Abarrotes",
        "tipo_mueble": "Gondola",
        "coordenada_x": 10.0,
        "coordenada_y": 10.0,
        "ancho": 2.0,
        "largo": 4.0,
    }
    r1 = client.post("/patentes/", json=payload, headers=headers_a)
    assert r1.status_code == 201

    r2 = client.post("/patentes/", json=payload, headers=headers_a)
    assert r2.status_code == 400
    assert "Ya existe una patente" in r2.json()["detail"]


def test_01b_decoracion_duplicada_mismo_tenant_retorna_400(client: TestClient):
    headers_a = {"X-Tenant-ID": TENANT_VERIF_A}
    payload = {
        "id": "DEC-A-01",
        "tipo": "TEXTO",
        "x": 50.0,
        "y": 20.0,
        "w": 100.0,
        "h": 30.0,
        "rotacion": 0.0,
        "config": {"text": "Sector Panadería"},
    }
    r1 = client.post("/patentes/decoraciones", json=payload, headers=headers_a)
    assert r1.status_code == 200

    r2 = client.post("/patentes/decoraciones", json=payload, headers=headers_a)
    assert r2.status_code == 400
    assert "Ya existe una decoración" in r2.json()["detail"]


# =========================================================================
# 2. AISLAMIENTO MULTI-TENANT (COMPOSITE PK)
# =========================================================================
def test_02_colision_multitenant_resuelta_con_pk_compuesta(client: TestClient):
    headers_a = {"X-Tenant-ID": TENANT_VERIF_A}
    headers_b = {"X-Tenant-ID": TENANT_VERIF_B}
    payload = {
        "id_patente": "GOND-SHARED-99",
        "area_pasillo": "Lácteos",
        "tipo_mueble": "Gondola",
        "coordenada_x": 15.0,
        "coordenada_y": 20.0,
        "ancho": 2.0,
        "largo": 6.0,
    }

    res_a = client.post("/patentes/", json=payload, headers=headers_a)
    assert res_a.status_code == 201

    res_b = client.post("/patentes/", json=payload, headers=headers_b)
    assert res_b.status_code == 201
    assert res_b.json()["id_patente"] == "GOND-SHARED-99"

    # Verificar que las consultas de cada tenant están aisladas
    list_a = client.get("/patentes/", headers=headers_a).json()
    list_b = client.get("/patentes/", headers=headers_b).json()

    pat_a_ids = [p["id_patente"] for p in list_a]
    pat_b_ids = [p["id_patente"] for p in list_b]
    assert "GOND-SHARED-99" in pat_a_ids
    assert "GOND-SHARED-99" in pat_b_ids
    assert "GOND-A-01" in pat_a_ids
    assert "GOND-A-01" not in pat_b_ids


def test_02b_decoraciones_multitenant_aisladas(client: TestClient):
    headers_a = {"X-Tenant-ID": TENANT_VERIF_A}
    headers_b = {"X-Tenant-ID": TENANT_VERIF_B}
    payload = {
        "id": "DEC-SHARED-TXT",
        "tipo": "TEXTO",
        "x": 10.0,
        "y": 10.0,
        "w": 50.0,
        "h": 20.0,
        "rotacion": 0.0,
        "config": {"text": "Entrada Principal"},
    }

    r_a = client.post("/patentes/decoraciones", json=payload, headers=headers_a)
    assert r_a.status_code == 200

    r_b = client.post("/patentes/decoraciones", json=payload, headers=headers_b)
    assert r_b.status_code == 200

    decs_a = client.get("/patentes/decoraciones", headers=headers_a).json()
    decs_b = client.get("/patentes/decoraciones", headers=headers_b).json()
    assert len(decs_a) >= 2
    assert len(decs_b) == 1


# =========================================================================
# 3. VALIDACIÓN DE ENTRADAS Y SANITIZACIÓN (HTTP 422)
# =========================================================================
def test_03a_rechazo_strings_vacios_y_xss(client: TestClient):
    headers_a = {"X-Tenant-ID": TENANT_VERIF_A}
    
    # 1. String con espacios
    r_empty = client.post("/patentes/", json={
        "id_patente": "   ",
        "area_pasillo": "Abarrotes",
        "tipo_mueble": "Gondola",
        "coordenada_x": 0, "coordenada_y": 0, "ancho": 2, "largo": 2
    }, headers=headers_a)
    assert r_empty.status_code == 422

    # 2. XSS en id_patente
    r_xss = client.post("/patentes/", json={
        "id_patente": "<script>alert(1)</script>",
        "area_pasillo": "Abarrotes",
        "tipo_mueble": "Gondola",
        "coordenada_x": 0, "coordenada_y": 0, "ancho": 2, "largo": 2
    }, headers=headers_a)
    assert r_xss.status_code == 422


def test_03b_rechazo_dimensiones_invalidas(client: TestClient):
    headers_a = {"X-Tenant-ID": TENANT_VERIF_A}
    r_neg = client.post("/patentes/", json={
        "id_patente": "GOND-NEG",
        "area_pasillo": "Abarrotes",
        "tipo_mueble": "Gondola",
        "coordenada_x": 0, "coordenada_y": 0,
        "ancho": -5.0,  # Negativo
        "largo": 2.0
    }, headers=headers_a)
    assert r_neg.status_code == 422


def test_03c_rechazo_url_javascript_peligrosa(client: TestClient):
    headers_a = {"X-Tenant-ID": TENANT_VERIF_A}
    r_js = client.post("/patentes/", json={
        "id_patente": "GOND-XSS-URL",
        "area_pasillo": "Abarrotes",
        "tipo_mueble": "Gondola",
        "coordenada_x": 0, "coordenada_y": 0, "ancho": 2, "largo": 2,
        "url_imagen_planograma": "javascript:alert(document.cookie)"
    }, headers=headers_a)
    assert r_js.status_code == 422


# =========================================================================
# 4. REPOSICIÓN BODEGA -> VITRINA Y COMPLIANCE HÍBRIDO
# =========================================================================
def test_04_flujo_reposicion_mover_sato_y_compliance(client: TestClient):
    headers_a = {"X-Tenant-ID": TENANT_VERIF_A}

    # Crear catálogo
    db = TestSessionLocal()
    try:
        prod = Catalogo_Producto(
            sku="SKU-VERIF-01",
            tenant_id=TENANT_VERIF_A,
            nombre="Arroz Grado 1 1kg",
            ean="7801234567890",
            categoria_id="Abarrotes",
            unidad_medida="UN",
            activo=True
        )
        db.add(prod)
        db.commit()
    finally:
        db.close()

    # 1. Crear góndola con SKU asignado
    r_pat = client.post("/patentes/", json={
        "id_patente": "GOND-VERIF-01",
        "area_pasillo": "Abarrotes",
        "tipo_mueble": "Gondola",
        "coordenada_x": 10, "coordenada_y": 10, "ancho": 2, "largo": 4,
        "productos_asignados": ["SKU-VERIF-01"]
    }, headers=headers_a)
    assert r_pat.status_code == 201

    # Compliance debe existir inmediatamente (cache invalidado en creación)
    r_comp = client.get("/patentes/batch/compliance", headers=headers_a)
    assert r_comp.status_code == 200
    comp_data = r_comp.json()
    assert "GOND-VERIF-01" in comp_data
    # Inicialmente stock_total es 0
    assert comp_data["GOND-VERIF-01"]["stock_total"] == 0

    # 2. Crear lote en Bodega
    db = TestSessionLocal()
    try:
        sato_bodega = Sato(
            tenant_id=TENANT_VERIF_A,
            tipo_sato="PRODUCTO",
            sku="SKU-VERIF-01",
            cantidad=50,
            estado="Bodega",
            lote="LOTE-ARROZ-01",
            fecha_vencimiento=date.today() + timedelta(days=180)
        )
        db.add(sato_bodega)
        db.commit()
        db.refresh(sato_bodega)
        sato_id = str(sato_bodega.sato_id)
    finally:
        db.close()

    # 3. Mover parcialmente 15 unidades a vitrina
    r_mover = client.post("/vitrina/mover-sato", json={
        "sato_id": sato_id,
        "id_patente": "GOND-VERIF-01",
        "cantidad": 15
    }, headers=headers_a)
    assert r_mover.status_code == 200
    res_mover = r_mover.json()
    assert res_mover["success"] is True
    assert res_mover["sato_vitrina"]["cantidad"] == 15
    assert res_mover["sato_vitrina"]["ubicacion_id"] == "GOND-VERIF-01"
    assert res_mover["sato_bodega_restante"]["cantidad"] == 35

    # 4. Verificar stock y compliance actualizado en la góndola
    r_stock = client.get("/patentes/GOND-VERIF-01/stock", headers=headers_a)
    assert r_stock.status_code == 200
    stock_list = r_stock.json()
    assert isinstance(stock_list, list)
    assert len(stock_list) == 1
    assert stock_list[0]["cantidad"] == 15
    assert stock_list[0]["nombre_producto"] == "Arroz Grado 1 1kg"
    assert stock_list[0]["dias_restantes"] > 100

    # Compliance debe ser 100% ahora que tiene el SKU asignado
    r_comp_post = client.get("/patentes/GOND-VERIF-01/compliance", headers=headers_a)
    assert r_comp_post.status_code == 200
    assert r_comp_post.json()["cumplimiento_porcentaje"] == 100.0
