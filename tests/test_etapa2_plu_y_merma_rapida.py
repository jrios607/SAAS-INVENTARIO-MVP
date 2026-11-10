"""
tests/test_etapa2_plu_y_merma_rapida.py
─────────────────────────────────────────────────────────────────────────────
Suite de certificación Backend — Etapa 2 (SG-BVC WMS v2.0):
  1. Generador de Código Interno / PLU (`GET /api/v1/catalogo/generar-codigo-interno`)
     con EAN-13 interno GS1 (prefijo 200 + dígito verificador módulo-10) sin colisiones.
  2. Merma Rápida en 3 Toques (`POST /api/v1/merma/rapida`) con FEFO determinista
     (`fecha_vencimiento ASC NULLS LAST, sato_id ASC`), prioridad de ubicación
     (`ubicacion_id`), transición automática a `Agotado`, valorización CLP y
     trazabilidad en `Log_Transaccional` (`DECLARACION_MERMA`) sin requerir `url_foto`.
  3. Resolución de Merma Rápida por `ean` (incluyendo EAN-13 interno `200...`) y
     protección estricta contra underflow (`HTTP 400`, `Sato.cantidad >= 0`).
  4. Historial de Mermas (`GET /api/v1/merma/historial`) y aislamiento Multi-Tenant
     estricto entre `TENANT_A` y `TENANT_B` en generador PLU, historial y bloqueo
     cross-tenant por `sato_id` (`HTTP 404`).
"""

import os
import uuid
from datetime import date, timedelta

# Forzar base de datos SQLite aislada antes de importar app.*
os.environ.setdefault("DATABASE_URL", "sqlite:///./test_etapa2_plu_merma_suite.db")
os.environ.setdefault("DATABASE_POOLER_URL", "")
os.environ.setdefault("DATABASE_READ_URL", "")
os.environ.setdefault("REDIS_URL", "")

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.tenant import current_tenant_id
from app.database import Base, RoutingSessionLocal, engine
from app.main import app
from app.models import (
    Catalogo_Producto,
    Categoria,
    Log_Transaccional,
    Patente,
    Sato,
    Tenant,
    Usuario,
)
from app.services.catalogo_service import (
    calcular_ean13_interno,
    invalidar_cache_catalogo,
)

TENANT_A = "e2aa1111-1111-1111-1111-111111111111"
TENANT_B = "e2bb2222-2222-2222-2222-222222222222"


def _validar_ean13_gs1_mod10(ean: str) -> bool:
    """Verifica longitud 13, solo dígitos y dígito verificador módulo-10 GS1."""
    if len(ean) != 13 or not ean.isdigit():
        return False
    base12 = ean[:12]
    check_esperado = (10 - (sum(int(d) * (1 if i % 2 == 0 else 3) for i, d in enumerate(base12)) % 10)) % 10
    return int(ean[12]) == check_esperado


def _purgar_tenants_etapa2(db) -> None:
    """Elimina exclusivamente los datos de TENANT_A y TENANT_B respetando FKs."""
    for tid in (TENANT_A, TENANT_B):
        current_tenant_id.set(tid)
        db.query(Log_Transaccional).filter(Log_Transaccional.tenant_id == tid).delete(synchronize_session=False)
        db.query(Sato).filter(Sato.tenant_id == tid).delete(synchronize_session=False)
        db.query(Patente).filter(Patente.tenant_id == tid).delete(synchronize_session=False)
        db.query(Catalogo_Producto).filter(Catalogo_Producto.tenant_id == tid).delete(synchronize_session=False)
        db.query(Categoria).filter(Categoria.tenant_id == tid).delete(synchronize_session=False)
        db.query(Usuario).filter(Usuario.tenant_id == tid).delete(synchronize_session=False)
        invalidar_cache_catalogo()
    db.commit()


@pytest.fixture(autouse=True)
def setup_clean_etapa2_db():
    """Prepara TENANT_A y TENANT_B limpios antes y después de cada test."""
    settings.AUTH_REQUIRED = False
    Base.metadata.create_all(bind=engine)

    db = RoutingSessionLocal()
    try:
        _purgar_tenants_etapa2(db)
        for tid, nombre in [
            (TENANT_A, "Supermercado Etapa2 Tenant A"),
            (TENANT_B, "Minimarket Etapa2 Tenant B"),
        ]:
            if not db.query(Tenant).filter(Tenant.id == tid).first():
                db.add(Tenant(id=tid, nombre=nombre, activo=True))
        db.commit()
    finally:
        db.close()

    yield

    settings.AUTH_REQUIRED = False
    db_clean = RoutingSessionLocal()
    try:
        _purgar_tenants_etapa2(db_clean)
    finally:
        db_clean.close()


@pytest.fixture(scope="session", autouse=True)
def cleanup_etapa2_sqlite_file():
    yield
    engine.dispose()
    for suffix in ("", "-wal", "-shm"):
        path = f"./test_etapa2_plu_merma_suite.db{suffix}"
        if os.path.exists(path):
            try:
                os.remove(path)
            except OSError:
                pass


# ── 1. Generador de Código Interno / PLU y EAN-13 GS1 Módulo-10 ───────────

def test_01_generador_plu_y_ean13_interno_gs1_modulo10_sin_colision():
    client = TestClient(app)

    # 1) Tenant limpio -> sugiere PLU-0001 y EAN-13 interno 2000000000015
    res_1 = client.get(
        "/api/v1/catalogo/generar-codigo-interno",
        headers={"X-Tenant-ID": TENANT_A},
    )
    assert res_1.status_code == 200, res_1.text
    data_1 = res_1.json()
    assert data_1["sku_sugerido"] == "PLU-0001"
    assert data_1["ean_interno"] == "2000000000015"
    assert data_1["correlativo"] == 1
    assert data_1["prefijo_sku"] == "PLU"
    assert data_1["ean_interno"].startswith("200")
    assert _validar_ean13_gs1_mod10(data_1["ean_interno"]) is True
    assert calcular_ean13_interno(1) == "2000000000015"

    # Verificar también que prefijo=PAN en tenant limpio genera PAN-0001
    res_pan = client.get(
        "/api/v1/catalogo/generar-codigo-interno",
        params={"prefijo": "PAN"},
        headers={"X-Tenant-ID": TENANT_A},
    )
    assert res_pan.status_code == 200, res_pan.text
    data_pan = res_pan.json()
    assert data_pan["sku_sugerido"] == "PAN-0001"
    assert data_pan["prefijo_sku"] == "PAN"
    assert data_pan["ean_interno"] == "2000000000015"

    # 2) Crear el producto PLU-0001 en el catálogo y volver a consultar -> salta a PLU-0002 y 2000000000022
    res_create = client.post(
        "/api/v1/catalogo/producto",
        headers={"X-Tenant-ID": TENANT_A},
        json={
            "sku": data_1["sku_sugerido"],
            "nombre": "Pan Hallulla Granel Propio",
            "ean": data_1["ean_interno"],
            "unidad_medida": "KG",
            "temperatura_requerida": "AMBIENTE",
            "familia": "Panadería",
            "costo_unitario": 1100,
            "precio": 1890,
            "es_perecible_corto": True,
            "dias_vida_util": 3,
        },
    )
    assert res_create.status_code == 201, res_create.text

    res_2 = client.get(
        "/api/v1/catalogo/generar-codigo-interno",
        headers={"X-Tenant-ID": TENANT_A},
    )
    assert res_2.status_code == 200, res_2.text
    data_2 = res_2.json()
    assert data_2["sku_sugerido"] == "PLU-0002"
    assert data_2["ean_interno"] == "2000000000022"
    assert data_2["correlativo"] == 2
    assert _validar_ean13_gs1_mod10(data_2["ean_interno"]) is True
    assert calcular_ean13_interno(2) == "2000000000022"

    # 3) Prefijo inválido (prefijo=A!) -> HTTP 400
    res_invalid = client.get(
        "/api/v1/catalogo/generar-codigo-interno",
        params={"prefijo": "A!"},
        headers={"X-Tenant-ID": TENANT_A},
    )
    assert res_invalid.status_code == 400, res_invalid.text


# ── 2. Merma Rápida en 3 Toques: FEFO Multilote y Prioridad de Ubicación ──

def test_02_merma_rapida_3_toques_fefo_multilote_y_prioridad_ubicacion():
    hoy = date.today()
    sato_lote1_id = uuid.UUID("00000000-0000-0000-0000-000000000201")
    sato_lote2_id = uuid.UUID("00000000-0000-0000-0000-000000000202")
    sato_lote3_id = uuid.UUID("00000000-0000-0000-0000-000000000203")

    db = RoutingSessionLocal()
    try:
        current_tenant_id.set(TENANT_A)
        db.add(
            Catalogo_Producto(
                sku="SKU-YOG-MERMA",
                nombre="Yogurt Griego Natural 150g",
                ean="7802000000991",
                costo_unitario=2000,
                precio=2990,
                controla_vencimiento=True,
                es_perecible_corto=True,
                dias_vida_util=15,
            )
        )
        db.add_all(
            [
                Patente(
                    id_patente="GOND-LAC-1",
                    area_pasillo="PASILLO LACTEOS",
                    tipo_mueble="Vitrina Frio",
                    tipo_ubicacion="SALA_VENTA",
                ),
                Patente(
                    id_patente="GOND-LAC-2",
                    area_pasillo="PASILLO LACTEOS",
                    tipo_mueble="Vitrina Frio",
                    tipo_ubicacion="SALA_VENTA",
                ),
            ]
        )
        db.flush()

        # Lote 1: Vitrina GOND-LAC-1, vence en 3 días, cantidad=2
        lote_1 = Sato(
            sato_id=sato_lote1_id,
            tipo_sato="PRODUCTO",
            sku="SKU-YOG-MERMA",
            ubicacion_id="GOND-LAC-1",
            lote="LOTE-VIT-G1",
            fecha_vencimiento=hoy + timedelta(days=3),
            cantidad=2,
            estado="Vitrina",
        )
        # Lote 2: Vitrina GOND-LAC-2, vence en 1 día, cantidad=3
        lote_2 = Sato(
            sato_id=sato_lote2_id,
            tipo_sato="PRODUCTO",
            sku="SKU-YOG-MERMA",
            ubicacion_id="GOND-LAC-2",
            lote="LOTE-VIT-G2",
            fecha_vencimiento=hoy + timedelta(days=1),
            cantidad=3,
            estado="Vitrina",
        )
        # Lote 3: Bodega, vence en 10 días, cantidad=5
        lote_3 = Sato(
            sato_id=sato_lote3_id,
            tipo_sato="PRODUCTO",
            sku="SKU-YOG-MERMA",
            ubicacion_id=None,
            lote="LOTE-BOD-03",
            fecha_vencimiento=hoy + timedelta(days=10),
            cantidad=5,
            estado="Bodega",
        )
        db.add_all([lote_1, lote_2, lote_3])
        db.commit()
    finally:
        db.close()

    client = TestClient(app)
    res = client.post(
        "/api/v1/merma/rapida",
        headers={"X-Tenant-ID": TENANT_A},
        json={
            "sku": "SKU-YOG-MERMA",
            "cantidad": 4,
            "motivo": "VENCIDO",
            "origen": "AUTO",
            "ubicacion_id": "GOND-LAC-1",
        },
    )
    assert res.status_code == 201, res.text
    body = res.json()

    assert body["sku"] == "SKU-YOG-MERMA"
    assert body["cantidad_registrada"] == 4
    assert body["motivo"] == "VENCIDO"
    assert body["costo_unitario_clp"] == 2000
    assert body["valor_merma_clp"] == 8000
    assert len(body["satos_afectados"]) == 2

    # Primero agota GOND-LAC-1 (2 uds -> 0 Agotado) y luego toma 2 uds de GOND-LAC-2 (3 uds -> 1 Vitrina)
    afectado_1, afectado_2 = body["satos_afectados"]
    assert afectado_1["ubicacion_id"] == "GOND-LAC-1"
    assert afectado_1["unidades_descontadas"] == 2
    assert afectado_1["cantidad_restante"] == 0
    assert afectado_1["nuevo_estado"] == "Agotado"

    assert afectado_2["ubicacion_id"] == "GOND-LAC-2"
    assert afectado_2["unidades_descontadas"] == 2
    assert afectado_2["cantidad_restante"] == 1
    assert afectado_2["nuevo_estado"] == "Vitrina"

    db_verif = RoutingSessionLocal()
    try:
        current_tenant_id.set(TENANT_A)
        s1 = db_verif.query(Sato).filter(Sato.sato_id == sato_lote1_id).one()
        s2 = db_verif.query(Sato).filter(Sato.sato_id == sato_lote2_id).one()
        s3 = db_verif.query(Sato).filter(Sato.sato_id == sato_lote3_id).one()

        assert s1.cantidad == 0
        assert s1.estado == "Agotado"

        assert s2.cantidad == 1
        assert s2.estado == "Vitrina"

        assert s3.cantidad == 5
        assert s3.estado == "Bodega"

        logs = (
            db_verif.query(Log_Transaccional)
            .filter(Log_Transaccional.accion == "DECLARACION_MERMA")
            .all()
        )
        assert len(logs) == 2
    finally:
        db_verif.close()


# ── 3. Merma Rápida por EAN y Bloqueo de Underflow por Stock Insuficiente ─

def test_03_merma_rapida_por_ean_y_bloqueo_underflow_stock_insuficiente():
    ean_interno = "2000000000015"
    sato_id = uuid.UUID("00000000-0000-0000-0000-000000000301")

    db = RoutingSessionLocal()
    try:
        current_tenant_id.set(TENANT_A)
        db.add(
            Catalogo_Producto(
                sku="PLU-0001",
                nombre="Queso Mantecoso Laminado Local",
                ean=ean_interno,
                costo_unitario=1500,
                precio=2500,
                controla_vencimiento=True,
                es_perecible_corto=True,
                dias_vida_util=10,
            )
        )
        db.flush()

        db.add(
            Sato(
                sato_id=sato_id,
                tipo_sato="PRODUCTO",
                sku="PLU-0001",
                ubicacion_id=None,
                lote="LOTE-EAN-01",
                fecha_vencimiento=date.today() + timedelta(days=5),
                cantidad=5,
                estado="Vitrina",
            )
        )
        db.commit()
    finally:
        db.close()

    client = TestClient(app)

    # 1) Declarar merma enviando únicamente `ean` (código interno 200...)
    res_ok = client.post(
        "/api/v1/merma/rapida",
        headers={"X-Tenant-ID": TENANT_A},
        json={
            "ean": ean_interno,
            "cantidad": 2,
            "motivo": "ROTURA_DANO",
            "origen": "AUTO",
        },
    )
    assert res_ok.status_code == 201, res_ok.text
    body_ok = res_ok.json()
    assert body_ok["sku"] == "PLU-0001"
    assert body_ok["cantidad_registrada"] == 2
    assert body_ok["valor_merma_clp"] == 3000
    assert body_ok["satos_afectados"][0]["cantidad_restante"] == 3

    # 2) Solicitar más unidades que las 3 disponibles -> HTTP 400 y stock intacto (jamás negativo)
    res_underflow = client.post(
        "/api/v1/merma/rapida",
        headers={"X-Tenant-ID": TENANT_A},
        json={
            "ean": ean_interno,
            "cantidad": 10,
            "motivo": "VENCIDO",
            "origen": "AUTO",
        },
    )
    assert res_underflow.status_code == 400, res_underflow.text

    db_verif = RoutingSessionLocal()
    try:
        current_tenant_id.set(TENANT_A)
        assert db_verif.query(Sato).filter(Sato.cantidad < 0).count() == 0
        sato_db = db_verif.query(Sato).filter(Sato.sato_id == sato_id).one()
        assert sato_db.cantidad == 3
        assert sato_db.estado == "Vitrina"

        # Solo existe el log del primer descuento válido (2 UN)
        logs = (
            db_verif.query(Log_Transaccional)
            .filter(Log_Transaccional.accion == "DECLARACION_MERMA")
            .all()
        )
        assert len(logs) == 1
    finally:
        db_verif.close()


# ── 4. Historial de Mermas y Aislamiento Multi-Tenant PLU + Merma ─────────

def test_04_historial_mermas_y_aislamiento_multitenant_plu_merma():
    sato_tenant_a_id = uuid.UUID("00000000-0000-0000-0000-000000000401")
    client = TestClient(app)

    # Crear PLU-0001 en TENANT_A vía API y cargarle un lote Sato
    res_plu_a = client.get(
        "/api/v1/catalogo/generar-codigo-interno",
        headers={"X-Tenant-ID": TENANT_A},
    )
    assert res_plu_a.status_code == 200
    plu_a = res_plu_a.json()
    assert plu_a["sku_sugerido"] == "PLU-0001"

    res_prod_a = client.post(
        "/api/v1/catalogo/producto",
        headers={"X-Tenant-ID": TENANT_A},
        json={
            "sku": plu_a["sku_sugerido"],
            "nombre": "jamón artesanal granel tenant A",
            "ean": plu_a["ean_interno"],
            "costo_unitario": 3000,
            "precio": 4990,
        },
    )
    assert res_prod_a.status_code == 201, res_prod_a.text

    db = RoutingSessionLocal()
    try:
        current_tenant_id.set(TENANT_A)
        db.add(
            Sato(
                sato_id=sato_tenant_a_id,
                tipo_sato="PRODUCTO",
                sku="PLU-0001",
                ubicacion_id=None,
                lote="LOTE-TA-401",
                fecha_vencimiento=date.today() + timedelta(days=4),
                cantidad=6,
                estado="Vitrina",
            )
        )
        db.commit()
    finally:
        db.close()

    # Declarar merma en TENANT_A (2 unidades * $3.000 = $6.000 CLP)
    res_merma_a = client.post(
        "/api/v1/merma/rapida",
        headers={"X-Tenant-ID": TENANT_A},
        json={
            "sku": "PLU-0001",
            "cantidad": 2,
            "motivo": "DETERIORO_CADENA_FRIO",
            "origen": "VITRINA",
            "comentarios": "Corte de luz nocturno",
        },
    )
    assert res_merma_a.status_code == 201, res_merma_a.text

    # 1) Verificar GET /api/v1/merma/historial en TENANT_A
    res_hist_a = client.get(
        "/api/v1/merma/historial",
        headers={"X-Tenant-ID": TENANT_A},
    )
    assert res_hist_a.status_code == 200, res_hist_a.text
    hist_a = res_hist_a.json()
    assert len(hist_a) == 1
    assert hist_a[0]["sku"] == "PLU-0001"
    assert hist_a[0]["motivo"] == "DETERIORO_CADENA_FRIO"
    assert hist_a[0]["cantidad"] == 2
    assert hist_a[0]["valor_merma_clp"] == 6000

    # 2) Desde TENANT_B:
    # (a) Generador de código interno empieza en PLU-0001 (aislado de TENANT_A)
    res_plu_b = client.get(
        "/api/v1/catalogo/generar-codigo-interno",
        headers={"X-Tenant-ID": TENANT_B},
    )
    assert res_plu_b.status_code == 200, res_plu_b.text
    plu_b = res_plu_b.json()
    assert plu_b["sku_sugerido"] == "PLU-0001"
    assert plu_b["ean_interno"] == "2000000000015"
    assert plu_b["correlativo"] == 1

    # (b) Historial de mermas en TENANT_B retorna [] (cero fugas de TENANT_A)
    res_hist_b = client.get(
        "/api/v1/merma/historial",
        headers={"X-Tenant-ID": TENANT_B},
    )
    assert res_hist_b.status_code == 200, res_hist_b.text
    assert res_hist_b.json() == []

    # (c) Intentar POST /api/v1/merma/rapida desde TENANT_B sobre sato_id de TENANT_A -> 404 y stock intacto
    res_cross = client.post(
        "/api/v1/merma/rapida",
        headers={"X-Tenant-ID": TENANT_B},
        json={
            "sato_id": str(sato_tenant_a_id),
            "cantidad": 1,
            "motivo": "OTRO",
        },
    )
    assert res_cross.status_code == 404, res_cross.text

    db_verif = RoutingSessionLocal()
    try:
        current_tenant_id.set(TENANT_A)
        sato_a = db_verif.query(Sato).filter(Sato.sato_id == sato_tenant_a_id).one()
        assert sato_a.cantidad == 4  # 6 iniciales - 2 mermadas en TENANT_A = 4 intactas
        assert sato_a.estado == "Vitrina"
    finally:
        db_verif.close()
