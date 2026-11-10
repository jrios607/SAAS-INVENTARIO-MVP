"""
Suite de Auditoría y Seguridad QA — Módulo Catálogo y Recepción DUN-14
Verifica:
  0. Disponibilidad en /catalogo/* y /api/v1/catalogo/*
  1. Rechazo de SKU duplicado en el mismo tenant (HTTP 400)
  2. Rechazo de EAN duplicado en el mismo tenant (HTTP 400)
  3. Aislamiento Multi-Tenant de SKUs (Tenant A y Tenant B pueden usar el mismo SKU sin colisión ni 500 en ASN)
  4. Rechazo de strings vacíos/espacios, XSS/SQLi, valores negativos y archivos no permitidos (.exe, .pdf, .html, NUL)
  5. CRUD completo (PUT/DELETE), hidratación de Ghost SKUs, importación masiva CSV y conversión DUN-14 en Recepción.
"""

import os
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.main import app
from app.database import Base, get_db, get_db_read
from app.models import Tenant, Sato
from app.services.catalogo_service import _catalogo_cache

TEST_DB_PATH = "./test_catalogo_audit_qa.db"
SQLALCHEMY_DATABASE_URL = f"sqlite:///{TEST_DB_PATH}"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

TENANT_A = "tenant-audit-cat-a"
TENANT_B = "tenant-audit-cat-b"


def override_get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="module", autouse=True)
def setup_audit_db():
    if os.path.exists(TEST_DB_PATH):
        try:
            os.remove(TEST_DB_PATH)
        except OSError:
            pass

    Base.metadata.create_all(bind=engine)
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_db_read] = override_get_db

    db = SessionLocal()
    try:
        db.add(Tenant(id=TENANT_A, nombre="Minimarket Audit A", activo=True))
        db.add(Tenant(id=TENANT_B, nombre="Minimarket Audit B", activo=True))
        db.commit()
    finally:
        db.close()

    _catalogo_cache.clear()
    yield

    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()
    if os.path.exists(TEST_DB_PATH):
        try:
            os.remove(TEST_DB_PATH)
        except OSError:
            pass


@pytest.fixture
def client():
    return TestClient(app, raise_server_exceptions=False)


def test_00_prefijo_ruta_catalogo_api_v1_y_raiz(client: TestClient):
    res_v1 = client.get("/api/v1/catalogo/productos", headers={"X-Tenant-ID": TENANT_A})
    res_root = client.get("/catalogo/productos", headers={"X-Tenant-ID": TENANT_A})
    assert res_v1.status_code == 200
    assert res_root.status_code == 200


def test_01_sku_duplicado_mismo_tenant_rechaza_400(client: TestClient):
    headers_a = {"X-Tenant-ID": TENANT_A}
    payload_1 = {
        "sku": "SKU-DUP-001",
        "nombre": "Arroz Grado 1 1kg",
        "ean": "7801000000011",
        "dun14": "17801000000018",
        "unidades_por_caja": 10,
        "familia": "Abarrotes",
        "sub_familia": "Granos",
        "proveedor_marca": "Miraflores",
        "tolerancia_vencimiento_dias": 30,
        "controla_vencimiento": True,
        "dias_vida_util": 365,
    }
    r1 = client.post("/catalogo/producto", json=payload_1, headers=headers_a)
    assert r1.status_code == 201, r1.text

    payload_2 = {
        **payload_1,
        "nombre": "Arroz Duplicado Sobrescritura",
        "ean": "7801000000028",
        "dun14": "17801000000025",
    }
    r2 = client.post("/catalogo/producto", json=payload_2, headers=headers_a)
    assert r2.status_code == 400
    assert "sku" in r2.json()["detail"].lower()


def test_02_ean_duplicado_mismo_tenant_distinto_sku_rechaza_400(client: TestClient):
    headers_a = {"X-Tenant-ID": TENANT_A}
    payload_1 = {
        "sku": "SKU-EAN-001",
        "nombre": "Leche Entera 1L",
        "ean": "7802000000099",
        "familia": "Lácteos y Huevos",
    }
    r1 = client.post("/catalogo/producto", json=payload_1, headers=headers_a)
    assert r1.status_code == 201

    payload_2 = {
        "sku": "SKU-EAN-002",
        "nombre": "Leche Descremada Clon EAN",
        "ean": "7802000000099",
        "familia": "Lácteos y Huevos",
    }
    r2 = client.post("/catalogo/producto", json=payload_2, headers=headers_a)
    assert r2.status_code == 400
    assert "ean" in r2.json()["detail"].lower()


def test_03_aislamiento_multitenant_sku_sin_colision_entre_locales(client: TestClient):
    """
    Verifica que Tenant A y Tenant B puedan registrar el mismo SKU ('SKU-TEST-COLLISION')
    con total independencia gracias a la PK compuesta (tenant_id, sku).
    """
    headers_a = {"X-Tenant-ID": TENANT_A}
    headers_b = {"X-Tenant-ID": TENANT_B}

    res_a = client.post(
        "/catalogo/producto",
        json={
            "sku": "SKU-TEST-COLLISION",
            "nombre": "Producto Exclusivo Tenant A",
            "ean": "7801111111111",
            "familia": "Bebidas y Líquidos",
        },
        headers=headers_a,
    )
    assert res_a.status_code == 201

    res_b = client.post(
        "/catalogo/producto",
        json={
            "sku": "SKU-TEST-COLLISION",
            "nombre": "Producto Independiente Tenant B",
            "ean": "7802222222222",
            "familia": "Bebidas y Líquidos",
        },
        headers=headers_b,
    )
    assert res_b.status_code == 201, res_b.text

    list_b = client.get("/catalogo/productos", headers=headers_b)
    assert list_b.status_code == 200
    prod_b = next(p for p in list_b.json() if p["sku"] == "SKU-TEST-COLLISION")
    assert prod_b["nombre"] == "Producto Independiente Tenant B"


def test_03b_ghost_sku_asn_multitenant_e_hidratacion(client: TestClient):
    """
    Verifica que si Tenant A crea un SKU y Tenant B recibe un ASN con ese mismo SKU (aún no creado en B),
    el ASN crea el Ghost SKU en Tenant B sin error 500, y luego Tenant B puede hidratarlo en Catálogo.
    """
    headers_a = {"X-Tenant-ID": TENANT_A}
    headers_b = {"X-Tenant-ID": TENANT_B}

    client.post(
        "/catalogo/producto",
        json={"sku": "SKU-GHOST-CROSS", "nombre": "Queso Gauda A", "ean": "7803333333331"},
        headers=headers_a,
    )

    asn_payload = {
        "lpn": "LPN-GHOST-COLLISION-B",
        "origen": "CD Central B",
        "detalles": [
            {
                "sku": "SKU-GHOST-CROSS",
                "cantidad": 10,
                "lote": "LOTE-B1",
                "fecha_vencimiento": "2027-01-01",
            }
        ],
    }
    res_asn = client.post("/asn/inyeccion", json=asn_payload, headers=headers_b)
    assert res_asn.status_code == 201, res_asn.text

    # Ahora Tenant B hidrata el Ghost SKU desde POST /catalogo/producto
    res_hydrate = client.post(
        "/catalogo/producto",
        json={
            "sku": "SKU-GHOST-CROSS",
            "nombre": "Queso Gauda Laminado 500g",
            "ean": "7804444444442",
            "familia": "Fiambrería y Lácteos",
        },
        headers=headers_b,
    )
    assert res_hydrate.status_code == 201, res_hydrate.text


def test_04a_strings_vacios_o_solo_espacios_bloqueados_422(client: TestClient):
    headers_a = {"X-Tenant-ID": TENANT_A}
    payload_vacio = {
        "sku": "   ",
        "nombre": "",
        "ean": "",
        "familia": "   ",
    }
    res = client.post("/catalogo/producto", json=payload_vacio, headers=headers_a)
    assert res.status_code == 422


def test_04b_inyeccion_xss_y_sqli_bloqueada_422(client: TestClient):
    headers_a = {"X-Tenant-ID": TENANT_A}
    payload_xss_sqli = {
        "sku": "' OR 1=1 --",
        "nombre": "<script>alert(1)</script>",
        "ean": "<img src=x onerror=alert(1)>",
        "familia": "<svg/onload=alert(1)>",
    }
    res = client.post("/catalogo/producto", json=payload_xss_sqli, headers=headers_a)
    assert res.status_code == 422


def test_04c_valores_negativos_ilogicos_bloqueados_422(client: TestClient):
    headers_a = {"X-Tenant-ID": TENANT_A}
    payload_negativo = {
        "sku": "SKU-NEGATIVO-001",
        "nombre": "Yogurt Vida Util Negativa",
        "ean": "7809999999991",
        "tolerancia_vencimiento_dias": -50,
        "controla_vencimiento": True,
        "dias_vida_util": -10,
        "precio": -1000,
    }
    res = client.post("/catalogo/producto", json=payload_negativo, headers=headers_a)
    assert res.status_code == 422


def test_04d_inyeccion_archivos_no_permitidos_bloqueada_422(client: TestClient):
    headers_a = {"X-Tenant-ID": TENANT_A}

    # 1. Multipart .exe en endpoint JSON /catalogo/producto -> 422 sin crash 500
    res_cat_file = client.post(
        "/catalogo/producto",
        files={"file": ("payload.exe", b"MZ\x90\x00\x03\x00\x00\x00", "application/x-msdownload")},
        headers=headers_a,
    )
    assert res_cat_file.status_code == 422

    # 2. Binario .exe con bytes NUL en importador de catálogo -> 422
    res_cat_import_exe = client.post(
        "/catalogo/import-file",
        files={"file": ("malware.exe", b"MZ\x90\x00\x03\x00\x00\x00", "application/x-msdownload")},
        headers=headers_a,
    )
    assert res_cat_import_exe.status_code == 422

    # 3. Archivos .exe, .pdf y .html con texto CSV disfrazado en ventas POS e importador de catálogo -> 422
    csv_disfrazado = b"ticket,sku,cantidad\nTCK-EXE-01,SKU-DUP-001,2\n"
    for bad_name, bad_mime in [
        ("trojan_pos.exe", "application/x-msdownload"),
        ("documento.pdf", "application/pdf"),
        ("xss_page.html", "text/html"),
    ]:
        r_pos = client.post(
            "/api/v1/integration/sales/import-file",
            files={"file": (bad_name, csv_disfrazado, bad_mime)},
            data={"pos_source": "CAJA_TEST", "allow_bodega_fallback": "true"},
            headers=headers_a,
        )
        assert r_pos.status_code == 422, f"Archivo {bad_name} debía ser rechazado con 422, obtuvo {r_pos.status_code}"

        r_cat = client.post(
            "/catalogo/import-file",
            files={"file": (bad_name, b"sku,nombre,ean\nSKU1,Prod,780111\n", bad_mime)},
            headers=headers_a,
        )
        assert r_cat.status_code == 422, f"Archivo {bad_name} en catálogo debía ser rechazado con 422"


def test_05_crud_importacion_csv_y_recepcion_dun14(client: TestClient):
    """
    Verifica:
      - Importación masiva CSV de catálogo con `dun14` y `unidades_por_caja`.
      - Recepción de una caja por DUN-14 en `/bodega/recepcion/pallet` multiplicando automáticamente
        las unidades ingresadas al lote Sato.
      - Consulta de lotes FEFO reales en `/catalogo/stock-agrupado`.
      - Edición (`PUT /catalogo/producto/{sku}`) y eliminación (`DELETE /catalogo/producto/{sku}`).
    """
    headers_a = {"X-Tenant-ID": TENANT_A}

    csv_catalogo = (
        "sku,nombre,ean,dun14,unidades_por_caja,unidad_medida,temperatura_requerida,familia,sub_familia,proveedor_marca,tolerancia_vencimiento_dias\n"
        "SKU-PACK-12,Leche Semidescremada 1L,7805550001112,17805550001119,12,UN,REFRIGERADO,Lácteos y Huevos,Leches,Colun,5\n"
        "SKU-BORRAR-01,Producto Temporal,7805550009990,,1,UN,SECO,Abarrotes,Varios,Genérico,0\n"
    ).encode("utf-8")

    res_imp = client.post(
        "/catalogo/import-file",
        files={"file": ("maestro_catalogo.csv", csv_catalogo, "text/csv")},
        headers=headers_a,
    )
    assert res_imp.status_code == 200, res_imp.text
    assert res_imp.json()["productos_creados"] == 2

    # Recepcionar 2 cajas escaneando el DUN-14 (17805550001119) -> debe ingresar 2 x 12 = 24 unidades
    res_rec = client.post(
        "/bodega/recepcion/pallet",
        json={
            "barcode_text": "(01)17805550001119(3102)001200(15)271231(10)LOTE-DUN-01",
            "modo_ingreso": "AUTO",
            "cantidad_recibida": 2,
        },
        headers=headers_a,
    )
    assert res_rec.status_code == 201, res_rec.text
    rec_data = res_rec.json()
    assert rec_data["es_caja_dun14"] is True
    assert rec_data["unidades_por_caja"] == 12
    assert rec_data["unidades_ingresadas"] == 24

    # Verificar que /catalogo/stock-agrupado devuelve los lotes reales FEFO con 24 unidades
    res_agrup = client.get("/catalogo/stock-agrupado", headers=headers_a)
    assert res_agrup.status_code == 200
    familias = res_agrup.json()
    prod_leche = None
    for fam in familias:
        for sub in fam["sub_familias"]:
            for pr in sub["productos"]:
                if pr["sku"] == "SKU-PACK-12":
                    prod_leche = pr
    assert prod_leche is not None
    assert prod_leche["stock_individual"] == 24
    assert len(prod_leche["lotes"]) == 1
    assert prod_leche["lotes"][0]["id_lote"] == "LOTE-DUN-01"
    assert prod_leche["lotes"][0]["stock"] == 24

    # Editar SKU-BORRAR-01 y luego eliminarlo
    res_put = client.put(
        "/catalogo/producto/SKU-BORRAR-01",
        json={"nombre": "Producto Temporal Editado", "stock_minimo": 10},
        headers=headers_a,
    )
    assert res_put.status_code == 200

    res_del = client.delete("/catalogo/producto/SKU-BORRAR-01", headers=headers_a)
    assert res_del.status_code == 200
