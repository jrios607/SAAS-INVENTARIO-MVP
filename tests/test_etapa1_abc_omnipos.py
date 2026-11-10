"""
tests/test_etapa1_abc_omnipos.py
─────────────────────────────────────────────────────────────────────────────
Suite exhaustiva de certificación Backend — Etapa 1 (SG-BVC WMS v2.0):
  1. Clasificación Pareto ABC exacta (80% / 95%) y ventana móvil W=90 días.
  2. Piso mínimo Clase "B" para productos nuevos (<= 30d) y perecibles de vida corta.
  3. Importación Excel (.xlsx) estilo Facturacion.cl + Modo Carga Histórica 90d
     (0 descuento en SATOs, recálculo ABC automático) + blindaje binario PK\\x03\\x04
     y rechazo de doble extensión peligrosa (.exe.xlsx).
  4. Venta POS real con déficit de stock: Sato.cantidad >= 0 (Agotado, jamás negativo),
     valorización completa de unidades vendidas para ABC y Anomalia_Stock(VENTA_SIN_STOCK).
  5. Zonas Térmicas ABC por Patente (CALIENTE_A, MEDIA_B, FRIA_C, SIN_DATOS),
     reporte de Discrepancia en Vitrina (HTTP 201) e invalidación de caché Redis.
  6. Aislamiento Multi-Tenant estricto en ventas, clases ABC, zonas térmicas,
     configuraciones, anomalías y caché particionada (_scoped_key).
  7. Configuración por defecto RF-03 (frecuencia_a_dias=14, W=90, 0.80/0.95)
     en modo lectura pura (Read Replica) sin insertar filas en BD.
"""

import fnmatch
import io
import os
from datetime import date, datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple

# Forzar base de datos SQLite aislada antes de importar app.*
os.environ["DATABASE_URL"] = "sqlite:///./test_etapa1_abc_suite.db"
os.environ["DATABASE_POOLER_URL"] = ""
os.environ["DATABASE_READ_URL"] = ""
os.environ["REDIS_URL"] = ""
os.environ["INTEGRATION_API_KEY"] = "test-etapa1-pos-api-key-2026"

import openpyxl
import pytest
from fastapi.testclient import TestClient

import app.core.cache as cache_module
from app.core.cache import CacheKeys, _scoped_key
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
    Venta_Externa_Item,
)
from app.services.catalogo_service import invalidar_cache_catalogo

TENANT_A = "e1aa1111-1111-1111-1111-111111111111"
TENANT_B = "e1bb2222-2222-2222-2222-222222222222"
API_KEY = "test-etapa1-pos-api-key-2026"


class FakeRedisClient:
    """Stub Redis en memoria compatible con cache_get / cache_set / cache_delete_pattern."""

    def __init__(self) -> None:
        self.store: Dict[str, str] = {}

    def ping(self) -> bool:
        return True

    def get(self, key: str) -> Optional[str]:
        return self.store.get(key)

    def setex(self, key: str, ttl: int, value: str) -> bool:
        assert ttl > 0
        self.store[key] = value
        return True

    def delete(self, *keys: str) -> int:
        deleted = 0
        for k in keys:
            if k in self.store:
                del self.store[k]
                deleted += 1
        return deleted

    def scan(self, cursor: int = 0, match: str = "*", count: int = 100) -> Tuple[int, List[str]]:
        matched = [k for k in list(self.store.keys()) if fnmatch.fnmatch(k, match)]
        return 0, matched


def _purgar_tenants_etapa1(db) -> None:
    """Elimina exclusivamente los datos de TENANT_A y TENANT_B respetando orden de FKs."""
    for tid in (TENANT_A, TENANT_B):
        current_tenant_id.set(tid)
        db.query(Anomalia_Stock).filter(Anomalia_Stock.tenant_id == tid).delete(synchronize_session=False)
        db.query(Venta_Externa_Item).filter(Venta_Externa_Item.tenant_id == tid).delete(synchronize_session=False)
        db.query(Venta_Externa).filter(Venta_Externa.tenant_id == tid).delete(synchronize_session=False)
        db.query(Configuracion_Conteo_Tenant).filter(
            Configuracion_Conteo_Tenant.tenant_id == tid
        ).delete(synchronize_session=False)
        db.query(Log_Transaccional).filter(Log_Transaccional.tenant_id == tid).delete(synchronize_session=False)
        db.query(Integration_Log).filter(Integration_Log.tenant_id == tid).delete(synchronize_session=False)
        db.query(Sato).filter(Sato.tenant_id == tid).delete(synchronize_session=False)
        db.query(Patente).filter(Patente.tenant_id == tid).delete(synchronize_session=False)
        db.query(Catalogo_Producto).filter(Catalogo_Producto.tenant_id == tid).delete(synchronize_session=False)
        db.query(Categoria).filter(Categoria.tenant_id == tid).delete(synchronize_session=False)
        db.query(Usuario).filter(Usuario.tenant_id == tid).delete(synchronize_session=False)
        invalidar_cache_catalogo()
    db.commit()


@pytest.fixture(autouse=True)
def setup_clean_etapa1_db():
    """Prepara TENANT_A y TENANT_B limpios antes y después de cada test."""
    settings.INTEGRATION_API_KEY = API_KEY
    settings.AUTH_REQUIRED = False
    Base.metadata.create_all(bind=engine)

    db = RoutingSessionLocal()
    try:
        _purgar_tenants_etapa1(db)
        for tid, nombre in [
            (TENANT_A, "Supermercado Etapa1 Tenant A"),
            (TENANT_B, "Minimarket Etapa1 Tenant B"),
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
        _purgar_tenants_etapa1(db_clean)
    finally:
        db_clean.close()


@pytest.fixture(scope="session", autouse=True)
def cleanup_sqlite_file():
    yield
    engine.dispose()
    for suffix in ("", "-wal", "-shm"):
        path = f"./test_etapa1_abc_suite.db{suffix}"
        if os.path.exists(path):
            try:
                os.remove(path)
            except OSError:
                pass


def _construir_xlsx_bytes(headers: List[str], rows: List[List[object]]) -> bytes:
    """Construye en memoria un archivo Excel (.xlsx) real con openpyxl."""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Ventas_FacturacionCL"
    ws.append(headers)
    for row in rows:
        ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    wb.close()
    return buf.getvalue()


# ── 1. Clasificación Pareto 80% / 95% Exacta ──────────────────────────────

def test_01_clasificacion_pareto_80_95_exacta():
    ahora = datetime.now(timezone.utc)
    hace_45_dias = ahora - timedelta(days=45)
    hace_10_dias = ahora - timedelta(days=10)
    fuera_ventana_120_dias = ahora - timedelta(days=120)

    db = RoutingSessionLocal()
    try:
        current_tenant_id.set(TENANT_A)
        db.add_all(
            [
                Catalogo_Producto(
                    sku="SKU-A1",
                    nombre="Aceite Maravilla 1L",
                    ean="7801010000011",
                    precio=5000,
                    es_perecible_corto=False,
                    dias_vida_util=365,
                    created_at=hace_45_dias,
                ),
                Catalogo_Producto(
                    sku="SKU-A2",
                    nombre="Detergente Líquido 3L",
                    ean="7801010000028",
                    precio=5000,
                    es_perecible_corto=False,
                    dias_vida_util=365,
                    created_at=hace_45_dias,
                ),
                Catalogo_Producto(
                    sku="SKU-B1",
                    nombre="Café Molido 250g",
                    ean="7801010000035",
                    precio=5000,
                    es_perecible_corto=False,
                    dias_vida_util=365,
                    created_at=hace_45_dias,
                ),
                Catalogo_Producto(
                    sku="SKU-C1",
                    nombre="Sal Fina 1kg",
                    ean="7801010000042",
                    precio=5000,
                    es_perecible_corto=False,
                    dias_vida_util=365,
                    created_at=hace_45_dias,
                ),
                Catalogo_Producto(
                    sku="SKU-C2",
                    nombre="Vinagre Manzana 500ml",
                    ean="7801010000059",
                    precio=2500,
                    es_perecible_corto=False,
                    dias_vida_util=365,
                    created_at=hace_45_dias,
                ),
            ]
        )
        db.flush()

        # Venta vigente dentro de la ventana W=90d (Total = $100.000, 20 UN)
        venta_vigente = Venta_Externa(
            pos_source="POS_PARETO",
            external_ticket_id="TKT-PARETO-001",
            canal="WEBHOOK_API",
            total_unidades=20,
            total_valorizado=100_000,
            es_carga_historica=True,
            fecha_venta_dt=hace_10_dias,
        )
        # Venta antigua fuera de ventana (120d > 90d) sobre SKU-C2: debe ser ignorada
        venta_expirada = Venta_Externa(
            pos_source="POS_PARETO",
            external_ticket_id="TKT-PARETO-OLD",
            canal="ARCHIVO",
            total_unidades=40,
            total_valorizado=100_000,
            es_carga_historica=True,
            fecha_venta_dt=fuera_ventana_120_dias,
        )
        db.add_all([venta_vigente, venta_expirada])
        db.flush()

        db.add_all(
            [
                Venta_Externa_Item(
                    venta_id=venta_vigente.id,
                    sku="SKU-A1",
                    cantidad=10,
                    precio_unitario=5000,
                    subtotal=50_000,  # 50% (acum 50% <= 80% -> A)
                    es_carga_historica=True,
                    fecha_venta=hace_10_dias,
                ),
                Venta_Externa_Item(
                    venta_id=venta_vigente.id,
                    sku="SKU-A2",
                    cantidad=6,
                    precio_unitario=5000,
                    subtotal=30_000,  # 30% (acum 80% <= 80% -> A)
                    es_carga_historica=True,
                    fecha_venta=hace_10_dias,
                ),
                Venta_Externa_Item(
                    venta_id=venta_vigente.id,
                    sku="SKU-B1",
                    cantidad=3,
                    precio_unitario=5000,
                    subtotal=15_000,  # 15% (acum 95% <= 95% -> B)
                    es_carga_historica=True,
                    fecha_venta=hace_10_dias,
                ),
                Venta_Externa_Item(
                    venta_id=venta_vigente.id,
                    sku="SKU-C1",
                    cantidad=1,
                    precio_unitario=5000,
                    subtotal=5_000,   # 5% (acum 100% > 95% -> C)
                    es_carga_historica=True,
                    fecha_venta=hace_10_dias,
                ),
                Venta_Externa_Item(
                    venta_id=venta_expirada.id,
                    sku="SKU-C2",
                    cantidad=40,
                    precio_unitario=2500,
                    subtotal=100_000,  # Fuera de ventana 90d -> $0 en ventana -> C
                    es_carga_historica=True,
                    fecha_venta=fuera_ventana_120_dias,
                ),
            ]
        )
        db.commit()
    finally:
        db.close()

    client = TestClient(app)
    res = client.post("/api/v1/abc/recalcular", headers={"X-Tenant-ID": TENANT_A})
    assert res.status_code == 200, res.text
    payload = res.json()

    assert payload["ventana_w_dias"] == 90
    assert payload["total_productos_evaluados"] == 5
    assert payload["venta_total_ventana_clp"] == 100_000
    assert payload["unidades_totales_ventana"] == 20
    assert payload["clase_a_count"] == 2
    assert payload["clase_b_count"] == 1
    assert payload["clase_c_count"] == 2
    assert payload["protegidos_piso_b_count"] == 0
    assert payload["conteo_clases"] == {"A": 2, "B": 1, "C": 2}

    db_verif = RoutingSessionLocal()
    try:
        current_tenant_id.set(TENANT_A)
        prods = {p.sku: p for p in db_verif.query(Catalogo_Producto).all()}

        assert prods["SKU-A1"].clase_abc == "A"
        assert prods["SKU-A1"].venta_valorizada_ventana == 50_000
        assert prods["SKU-A1"].unidades_vendidas_ventana == 10
        assert prods["SKU-A1"].participacion_ventas == pytest.approx(0.50, abs=1e-6)

        assert prods["SKU-A2"].clase_abc == "A"
        assert prods["SKU-A2"].venta_valorizada_ventana == 30_000
        assert prods["SKU-A2"].unidades_vendidas_ventana == 6
        assert prods["SKU-A2"].participacion_ventas == pytest.approx(0.30, abs=1e-6)

        assert prods["SKU-B1"].clase_abc == "B"
        assert prods["SKU-B1"].venta_valorizada_ventana == 15_000
        assert prods["SKU-B1"].unidades_vendidas_ventana == 3
        assert prods["SKU-B1"].participacion_ventas == pytest.approx(0.15, abs=1e-6)

        assert prods["SKU-C1"].clase_abc == "C"
        assert prods["SKU-C1"].venta_valorizada_ventana == 5_000
        assert prods["SKU-C1"].unidades_vendidas_ventana == 1
        assert prods["SKU-C1"].participacion_ventas == pytest.approx(0.05, abs=1e-6)

        assert prods["SKU-C2"].clase_abc == "C"
        assert prods["SKU-C2"].venta_valorizada_ventana == 0
        assert prods["SKU-C2"].unidades_vendidas_ventana == 0
        assert prods["SKU-C2"].participacion_ventas == pytest.approx(0.0, abs=1e-6)
    finally:
        db_verif.close()


# ── 2. Piso Mínimo Clase "B": Productos Nuevos y Perecibles Cortos ────────

def test_02_piso_minimo_clase_b_nuevos_y_perecibles_cortos():
    ahora = datetime.now(timezone.utc)
    hace_2_dias = ahora - timedelta(days=2)
    hace_60_dias = ahora - timedelta(days=60)

    db = RoutingSessionLocal()
    try:
        current_tenant_id.set(TENANT_A)
        db.add_all(
            [
                # Producto ancla con ventas para fijar V > 0
                Catalogo_Producto(
                    sku="SKU-TOP-VENTAS",
                    nombre="Bebida Cola 2L",
                    ean="7802020000011",
                    precio=2000,
                    es_perecible_corto=False,
                    dias_vida_util=180,
                    created_at=hace_60_dias,
                ),
                # Producto antiguo seco sin ventas -> debe caer a "C"
                Catalogo_Producto(
                    sku="SKU-ANTIGUO-SECO-C",
                    nombre="Fósforos Caja Grande",
                    ean="7802020000028",
                    precio=1000,
                    es_perecible_corto=False,
                    dias_vida_util=365,
                    created_at=hace_60_dias,
                ),
                # Caso 1: Producto recién creado (hace 2 días <= 30d) con $0 ventas -> protegido en "B"
                Catalogo_Producto(
                    sku="SKU-NUEVO-2D",
                    nombre="Snack Proteico Lanzamiento",
                    ean="7802020000035",
                    precio=1800,
                    es_perecible_corto=False,
                    dias_vida_util=180,
                    created_at=hace_2_dias,
                ),
                # Caso 2a: Producto antiguo (60d) con $0 ventas pero es_perecible_corto=True -> protegido en "B"
                Catalogo_Producto(
                    sku="SKU-PERECIBLE-FLAG",
                    nombre="Pan Molde Artesanal Fresco",
                    ean="7802020000042",
                    precio=2200,
                    es_perecible_corto=True,
                    dias_vida_util=None,
                    created_at=hace_60_dias,
                ),
                # Caso 2b: Producto antiguo (60d) con $0 ventas pero dias_vida_util=7 (<= 15) -> protegido en "B"
                Catalogo_Producto(
                    sku="SKU-PERECIBLE-7D",
                    nombre="Yogurt Natural Artesanal",
                    ean="7802020000059",
                    precio=950,
                    es_perecible_corto=False,
                    dias_vida_util=7,
                    created_at=hace_60_dias,
                ),
            ]
        )
        db.flush()

        venta = Venta_Externa(
            pos_source="POS_PISO_B",
            external_ticket_id="TKT-PISO-001",
            canal="WEBHOOK_API",
            total_unidades=25,
            total_valorizado=50_000,
            es_carga_historica=True,
            fecha_venta_dt=ahora - timedelta(days=3),
        )
        db.add(venta)
        db.flush()
        db.add(
            Venta_Externa_Item(
                venta_id=venta.id,
                sku="SKU-TOP-VENTAS",
                cantidad=25,
                precio_unitario=2000,
                subtotal=50_000,
                es_carga_historica=True,
                fecha_venta=ahora - timedelta(days=3),
            )
        )
        db.commit()
    finally:
        db.close()

    client = TestClient(app)
    res = client.post("/api/v1/abc/recalcular", headers={"X-Tenant-ID": TENANT_A})
    assert res.status_code == 200, res.text
    body = res.json()

    assert body["protegidos_piso_b_count"] == 3
    assert body["clase_a_count"] == 1
    assert body["clase_b_count"] == 3
    assert body["clase_c_count"] == 1

    db_verif = RoutingSessionLocal()
    try:
        current_tenant_id.set(TENANT_A)
        prods = {p.sku: p for p in db_verif.query(Catalogo_Producto).all()}

        assert prods["SKU-TOP-VENTAS"].clase_abc == "A"
        assert prods["SKU-ANTIGUO-SECO-C"].clase_abc == "C"
        assert prods["SKU-NUEVO-2D"].clase_abc == "B"
        assert prods["SKU-NUEVO-2D"].venta_valorizada_ventana == 0
        assert prods["SKU-PERECIBLE-FLAG"].clase_abc == "B"
        assert prods["SKU-PERECIBLE-FLAG"].venta_valorizada_ventana == 0
        assert prods["SKU-PERECIBLE-7D"].clase_abc == "B"
        assert prods["SKU-PERECIBLE-7D"].venta_valorizada_ventana == 0
    finally:
        db_verif.close()


# ── 3. Importación Excel (.xlsx) Facturacion.cl + Modo Histórico ABC ──────

def test_03_importacion_excel_xlsx_facturacion_cl_y_modo_historico_abc():
    ahora = datetime.now(timezone.utc)
    hace_60_dias = ahora - timedelta(days=60)

    db = RoutingSessionLocal()
    try:
        current_tenant_id.set(TENANT_A)
        db.add_all(
            [
                Catalogo_Producto(
                    sku="SKU-XLSX-A",
                    nombre="Arroz Grado 1 1kg",
                    ean="7803030000011",
                    precio=2000,
                    es_perecible_corto=False,
                    dias_vida_util=365,
                    created_at=hace_60_dias,
                ),
                Catalogo_Producto(
                    sku="SKU-XLSX-B",
                    nombre="Azúcar Blanca 1kg",
                    ean="7803030000028",
                    precio=1500,
                    es_perecible_corto=False,
                    dias_vida_util=365,
                    created_at=hace_60_dias,
                ),
                Catalogo_Producto(
                    sku="SKU-XLSX-C",
                    nombre="Té Ceylán 20 Bolsitas",
                    ean="7803030000035",
                    precio=1000,
                    es_perecible_corto=False,
                    dias_vida_util=365,
                    created_at=hace_60_dias,
                ),
                Catalogo_Producto(
                    sku="SKU-XLSX-SIN-VENTA",
                    nombre="Orégano Sobre 15g",
                    ean="7803030000042",
                    precio=500,
                    es_perecible_corto=False,
                    dias_vida_util=365,
                    created_at=hace_60_dias,
                ),
            ]
        )
        db.add(
            Patente(
                id_patente="GOND-XLSX-1",
                area_pasillo="PASILLO ABARROTES",
                tipo_mueble="Gondola",
                tipo_ubicacion="SALA_VENTA",
            )
        )
        db.flush()

        # Stock físico actual: 15 en Vitrina y 25 en Bodega (la carga histórica venderá 40 uds de SKU-XLSX-A
        # y NO debe tocar ni una sola unidad ni generar anomalía de déficit).
        sato_vitrina = Sato(
            tipo_sato="PRODUCTO",
            sku="SKU-XLSX-A",
            ubicacion_id="GOND-XLSX-1",
            lote="LOTE-VIT-INTACTO",
            fecha_vencimiento=date.today() + timedelta(days=90),
            cantidad=15,
            estado="Vitrina",
        )
        sato_bodega = Sato(
            tipo_sato="PRODUCTO",
            sku="SKU-XLSX-A",
            ubicacion_id=None,
            lote="LOTE-BOD-INTACTO",
            fecha_vencimiento=date.today() + timedelta(days=120),
            cantidad=25,
            estado="Bodega",
        )
        db.add_all([sato_vitrina, sato_bodega])
        db.commit()
    finally:
        db.close()

    fecha_reciente_1 = (ahora - timedelta(days=12)).strftime("%Y-%m-%d %H:%M:%S")
    fecha_reciente_2 = (ahora - timedelta(days=5)).strftime("%Y-%m-%d %H:%M:%S")

    # Construir .xlsx real estilo Facturacion.cl (Total = $100.000: 80k A, 15k B, 5k C)
    xlsx_bytes = _construir_xlsx_bytes(
        headers=["Folio", "Codigo_Barras", "Cantidad", "Precio_Unitario", "Fecha"],
        rows=[
            ["FOL-8001", "7803030000011", 40, 2000, fecha_reciente_1],  # $80.000 (80% -> A)
            ["FOL-8002", "7803030000028", 10, 1500, fecha_reciente_2],  # $15.000 (95% -> B)
            ["FOL-8002", "7803030000035", 5, 1000, fecha_reciente_2],   # $5.000  (100% -> C)
        ],
    )
    assert xlsx_bytes[:4] == b"PK\x03\x04"

    client = TestClient(app)
    res = client.post(
        "/api/v1/integration/sales/import-file",
        headers={"X-Tenant-ID": TENANT_A},
        files={
            "file": (
                "reporte_90d_facturacion_cl.xlsx",
                io.BytesIO(xlsx_bytes),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
        data={
            "pos_source": "FACTURACION_CL",
            "allow_bodega_fallback": "true",
            "modo_historico_abc": "true",
        },
    )
    assert res.status_code == 200, res.text
    data = res.json()

    assert data["tickets_recibidos"] == 2
    assert data["tickets_procesados"] == 2
    assert data["tickets_fallidos"] == 0
    assert data["unidades_descontadas"] == 0
    assert data["unidades_deficit"] == 0
    assert data["total_valorizado"] == 100_000
    assert data["es_carga_historica"] is True

    db_verif = RoutingSessionLocal()
    try:
        current_tenant_id.set(TENANT_A)

        # (a) Sato.cantidad en vitrina y bodega 100% intactos; 0 logs y 0 anomalías
        vit = db_verif.query(Sato).filter(Sato.lote == "LOTE-VIT-INTACTO").one()
        bod = db_verif.query(Sato).filter(Sato.lote == "LOTE-BOD-INTACTO").one()
        assert vit.cantidad == 15
        assert vit.estado == "Vitrina"
        assert bod.cantidad == 25
        assert bod.estado == "Bodega"
        assert db_verif.query(Log_Transaccional).count() == 0
        assert db_verif.query(Anomalia_Stock).count() == 0

        # (b) Venta_Externa y Venta_Externa_Item persistidos con es_carga_historica=True y valorizado exacto
        ventas = {
            v.external_ticket_id: v
            for v in db_verif.query(Venta_Externa).all()
        }
        assert set(ventas.keys()) == {"FOL-8001", "FOL-8002"}
        assert ventas["FOL-8001"].es_carga_historica is True
        assert ventas["FOL-8001"].total_valorizado == 80_000
        assert ventas["FOL-8001"].unidades_deficit == 0
        assert ventas["FOL-8002"].es_carga_historica is True
        assert ventas["FOL-8002"].total_valorizado == 20_000
        assert ventas["FOL-8002"].unidades_deficit == 0

        items_db = db_verif.query(Venta_Externa_Item).all()
        assert len(items_db) == 3
        assert all(it.es_carga_historica is True for it in items_db)
        assert all(it.unidades_descontadas == 0 and it.unidades_deficit == 0 for it in items_db)
        assert sum(it.subtotal for it in items_db) == 100_000

        # (c) Clasificación ABC actualizada automáticamente tras la carga histórica
        prods = {p.sku: p for p in db_verif.query(Catalogo_Producto).all()}
        assert prods["SKU-XLSX-A"].clase_abc == "A"
        assert prods["SKU-XLSX-A"].venta_valorizada_ventana == 80_000
        assert prods["SKU-XLSX-B"].clase_abc == "B"
        assert prods["SKU-XLSX-B"].venta_valorizada_ventana == 15_000
        assert prods["SKU-XLSX-C"].clase_abc == "C"
        assert prods["SKU-XLSX-C"].venta_valorizada_ventana == 5_000
        assert prods["SKU-XLSX-SIN-VENTA"].clase_abc == "C"
        assert prods["SKU-XLSX-SIN-VENTA"].venta_valorizada_ventana == 0
    finally:
        db_verif.close()

    # (d) Seguridad: falso .xlsx (texto plano sin firma PK\x03\x04) -> HTTP 422
    fake_xlsx = b"Folio;Codigo_Barras;Cantidad;Precio_Unitario\nFOL-9;7803030000011;2;2000\n"
    res_fake = client.post(
        "/api/v1/integration/sales/import-file",
        headers={"X-Tenant-ID": TENANT_A},
        files={
            "file": (
                "falso_texto_renombrado.xlsx",
                io.BytesIO(fake_xlsx),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
        data={"pos_source": "FACTURACION_CL", "modo_historico_abc": "true"},
    )
    assert res_fake.status_code == 422, res_fake.text

    # (e) Seguridad: doble extensión peligrosa (virus.exe.xlsx) -> HTTP 422
    res_double_ext = client.post(
        "/api/v1/integration/sales/import-file",
        headers={"X-Tenant-ID": TENANT_A},
        files={
            "file": (
                "virus.exe.xlsx",
                io.BytesIO(xlsx_bytes),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
        data={"pos_source": "FACTURACION_CL", "modo_historico_abc": "true"},
    )
    assert res_double_ext.status_code == 422, res_double_ext.text


# ── 4. Venta POS Real con Déficit: Sato >= 0 + Anomalía VENTA_SIN_STOCK ───

def test_04_venta_pos_con_deficit_mantiene_sato_no_negativo_y_dispara_anomalia():
    ahora = datetime.now(timezone.utc)
    db = RoutingSessionLocal()
    try:
        current_tenant_id.set(TENANT_A)
        db.add(
            Catalogo_Producto(
                sku="SKU-DEFICIT-01",
                nombre="Queso Gauda Laminado 500g",
                ean="7804040000011",
                precio=3500,
                es_perecible_corto=False,
                dias_vida_util=60,
                created_at=ahora - timedelta(days=50),
            )
        )
        db.add(
            Patente(
                id_patente="GOND-LACTEOS-1",
                area_pasillo="PASILLO FRIO",
                tipo_mueble="Vitrina Frio",
                tipo_ubicacion="SALA_VENTA",
                productos_asignados=["SKU-DEFICIT-01"],
            )
        )
        db.flush()

        sato_parcial = Sato(
            tipo_sato="PRODUCTO",
            sku="SKU-DEFICIT-01",
            ubicacion_id="GOND-LACTEOS-1",
            lote="LOTE-Q-01",
            fecha_vencimiento=date.today() + timedelta(days=15),
            cantidad=4,
            estado="Vitrina",
        )
        db.add(sato_parcial)
        db.commit()
    finally:
        db.close()

    client = TestClient(app)
    res = client.post(
        "/api/v1/integration/sales/webhook",
        headers={"X-Tenant-ID": TENANT_A, "X-API-Key": API_KEY},
        json={
            "external_ticket_id": "BOL-DEFICIT-001",
            "pos_source": "BSALE_CAJA_1",
            "timestamp": ahora.isoformat(),
            "modo_historico_abc": False,
            "allow_bodega_fallback": False,
            "items": [
                {
                    "sku": "SKU-DEFICIT-01",
                    "cantidad": 10,
                    "precio_unitario": 3500,
                }
            ],
        },
    )
    assert res.status_code == 200, res.text
    body = res.json()

    assert body["estado"] == "PROCESADO"
    assert body["total_descontado"] == 4
    assert body["unidades_deficit"] == 6
    assert body["total_valorizado"] == 35_000
    assert body["es_carga_historica"] is False
    assert len(body["satos_afectados"]) == 1
    assert body["satos_afectados"][0]["descontado"] == 4

    db_verif = RoutingSessionLocal()
    try:
        current_tenant_id.set(TENANT_A)

        # Invariante inquebrantable: Sato.cantidad jamás es negativo
        assert db_verif.query(Sato).filter(Sato.cantidad < 0).count() == 0
        sato_db = db_verif.query(Sato).filter(Sato.lote == "LOTE-Q-01").one()
        assert sato_db.cantidad == 0
        assert sato_db.estado == "Agotado"

        # Las 10 unidades completas quedaron valorizadas en Venta_Externa_Item y en Catalogo_Producto para ABC
        item_db = db_verif.query(Venta_Externa_Item).filter(Venta_Externa_Item.sku == "SKU-DEFICIT-01").one()
        assert item_db.cantidad == 10
        assert item_db.precio_unitario == 3500
        assert item_db.subtotal == 35_000
        assert item_db.unidades_descontadas == 4
        assert item_db.unidades_deficit == 6

        prod_db = db_verif.query(Catalogo_Producto).filter(Catalogo_Producto.sku == "SKU-DEFICIT-01").one()
        assert prod_db.clase_abc == "A"
        assert prod_db.venta_valorizada_ventana == 35_000
        assert prod_db.unidades_vendidas_ventana == 10

        # Trazabilidad física por las 4 unidades efectivamente descontadas
        logs = db_verif.query(Log_Transaccional).filter(Log_Transaccional.accion == "VENTA_EXTERNA_POS").all()
        assert len(logs) == 1

        # Anomalía persistida en BD
        anom_db = db_verif.query(Anomalia_Stock).one()
        assert anom_db.sku == "SKU-DEFICIT-01"
        assert anom_db.tipo == "VENTA_SIN_STOCK"
        assert anom_db.estado == "ABIERTA"
        assert anom_db.unidades_deficit == 6
        assert anom_db.referencia_ticket == "BSALE_CAJA_1:BOL-DEFICIT-001"
    finally:
        db_verif.close()

    # Visible en GET /api/v1/abc/anomalias
    res_anom = client.get("/api/v1/abc/anomalias", headers={"X-Tenant-ID": TENANT_A})
    assert res_anom.status_code == 200, res_anom.text
    anomalias = res_anom.json()
    assert len(anomalias) == 1
    assert anomalias[0]["sku"] == "SKU-DEFICIT-01"
    assert anomalias[0]["tipo"] == "VENTA_SIN_STOCK"
    assert anomalias[0]["estado"] == "ABIERTA"
    assert anomalias[0]["unidades_deficit"] == 6
    assert anomalias[0]["clase_abc"] == "A"


# ── 5. Zonas Calientes por Patente + Discrepancia Vitrina + Invalidación ──

def test_05_zonas_calientes_patentes_y_discrepancia_vitrina(monkeypatch):
    fake_redis = FakeRedisClient()
    monkeypatch.setattr(cache_module, "_redis_client", fake_redis)
    monkeypatch.setattr(cache_module, "_redis_failed", False)

    ahora = datetime.now(timezone.utc)
    hace_60_dias = ahora - timedelta(days=60)

    db = RoutingSessionLocal()
    try:
        current_tenant_id.set(TENANT_A)
        db.add_all(
            [
                Catalogo_Producto(
                    sku="SKU-HOT-A",
                    nombre="Cerveza Pack 6x350ml",
                    ean="7805050000011",
                    precio=8000,
                    es_perecible_corto=False,
                    dias_vida_util=365,
                    created_at=hace_60_dias,
                ),
                Catalogo_Producto(
                    sku="SKU-MED-B",
                    nombre="Jugo Naranja 1L",
                    ean="7805050000028",
                    precio=1500,
                    es_perecible_corto=False,
                    dias_vida_util=365,
                    created_at=hace_60_dias,
                ),
                Catalogo_Producto(
                    sku="SKU-COLD-C",
                    nombre="Agua Tónica 500ml",
                    ean="7805050000035",
                    precio=1000,
                    es_perecible_corto=False,
                    dias_vida_util=365,
                    created_at=hace_60_dias,
                ),
            ]
        )
        db.add_all(
            [
                Patente(
                    id_patente="GOND-HOT-A",
                    area_pasillo="PASILLO 1",
                    tipo_mueble="Gondola",
                    tipo_ubicacion="SALA_VENTA",
                    productos_asignados=["SKU-HOT-A"],
                ),
                Patente(
                    id_patente="GOND-MED-B",
                    area_pasillo="PASILLO 2",
                    tipo_mueble="Gondola",
                    tipo_ubicacion="SALA_VENTA",
                    productos_asignados=["SKU-MED-B"],
                ),
                Patente(
                    id_patente="GOND-COLD-C",
                    area_pasillo="PASILLO 3",
                    tipo_mueble="Gondola",
                    tipo_ubicacion="SALA_VENTA",
                    productos_asignados=["SKU-COLD-C"],
                ),
                Patente(
                    id_patente="GOND-VACIA",
                    area_pasillo="PASILLO 4",
                    tipo_mueble="Gondola",
                    tipo_ubicacion="SALA_VENTA",
                    productos_asignados=[],
                ),
            ]
        )
        db.flush()

        venta = Venta_Externa(
            pos_source="POS_ZONAS",
            external_ticket_id="TKT-ZONAS-01",
            canal="WEBHOOK_API",
            total_unidades=25,
            total_valorizado=100_000,
            es_carga_historica=True,
            fecha_venta_dt=ahora - timedelta(days=4),
        )
        db.add(venta)
        db.flush()
        db.add_all(
            [
                Venta_Externa_Item(
                    venta_id=venta.id,
                    sku="SKU-HOT-A",
                    cantidad=10,
                    precio_unitario=8000,
                    subtotal=80_000,  # 80% -> A
                    es_carga_historica=True,
                    fecha_venta=ahora - timedelta(days=4),
                ),
                Venta_Externa_Item(
                    venta_id=venta.id,
                    sku="SKU-MED-B",
                    cantidad=10,
                    precio_unitario=1500,
                    subtotal=15_000,  # 95% -> B
                    es_carga_historica=True,
                    fecha_venta=ahora - timedelta(days=4),
                ),
                Venta_Externa_Item(
                    venta_id=venta.id,
                    sku="SKU-COLD-C",
                    cantidad=5,
                    precio_unitario=1000,
                    subtotal=5_000,   # 100% -> C
                    es_carga_historica=True,
                    fecha_venta=ahora - timedelta(days=4),
                ),
            ]
        )
        db.commit()
    finally:
        db.close()

    client = TestClient(app)
    headers_a = {"X-Tenant-ID": TENANT_A}

    res_calc = client.post("/api/v1/abc/recalcular", headers=headers_a)
    assert res_calc.status_code == 200, res_calc.text

    res_zonas = client.get("/api/v1/abc/zonas-patentes", headers=headers_a)
    assert res_zonas.status_code == 200, res_zonas.text
    zonas = res_zonas.json()

    assert zonas["patentes_calientes_a"] == 1
    assert zonas["patentes_medias_b"] == 1
    assert zonas["patentes_frias_c"] == 1
    assert zonas["patentes_sin_datos"] == 1
    assert zonas["anomalias_abiertas_total"] == 0

    pats = zonas["patentes"]
    assert pats["GOND-HOT-A"]["zona_termica"] == "CALIENTE_A"
    assert pats["GOND-HOT-A"]["clase_dominante"] == "A"
    assert pats["GOND-HOT-A"]["anomalias_abiertas_count"] == 0
    assert pats["GOND-MED-B"]["zona_termica"] == "MEDIA_B"
    assert pats["GOND-MED-B"]["clase_dominante"] == "B"
    assert pats["GOND-COLD-C"]["zona_termica"] == "FRIA_C"
    assert pats["GOND-COLD-C"]["clase_dominante"] == "C"
    assert pats["GOND-VACIA"]["zona_termica"] == "SIN_DATOS"
    assert pats["GOND-VACIA"]["clase_dominante"] is None

    # Confirmar que el resultado quedó almacenado en caché Redis bajo clave scoped del tenant
    current_tenant_id.set(TENANT_A)
    scoped_zonas_key = _scoped_key(CacheKeys.ABC_ZONAS_PATENTES)
    assert scoped_zonas_key in fake_redis.store

    # Disparar POST /api/v1/abc/discrepancia-vitrina sobre GOND-HOT-A -> HTTP 201 + invalidar_abc()
    res_disc = client.post(
        "/api/v1/abc/discrepancia-vitrina",
        headers=headers_a,
        json={
            "sku": "SKU-HOT-A",
            "ubicacion_id": "GOND-HOT-A",
            "detalles": "Góndola vacía en sala pese a stock teórico positivo.",
        },
    )
    assert res_disc.status_code == 201, res_disc.text
    disc_body = res_disc.json()
    assert disc_body["tipo"] == "DISCREPANCIA_VITRINA"
    assert disc_body["estado"] == "ABIERTA"
    assert disc_body["ubicacion_id"] == "GOND-HOT-A"
    assert disc_body["sku"] == "SKU-HOT-A"

    # La clave cacheada debió ser invalidada tras el commit
    assert scoped_zonas_key not in fake_redis.store

    # Re-consultar GET /api/v1/abc/zonas-patentes y verificar incremento de anomalías en GOND-HOT-A
    res_zonas_2 = client.get("/api/v1/abc/zonas-patentes", headers=headers_a)
    assert res_zonas_2.status_code == 200, res_zonas_2.text
    zonas_2 = res_zonas_2.json()
    assert zonas_2["anomalias_abiertas_total"] == 1
    assert zonas_2["patentes"]["GOND-HOT-A"]["anomalias_abiertas_count"] == 1


# ── 6. Aislamiento Multi-Tenant Estricto (ABC, Zonas, Config y Anomalías) ─

def test_06_aislamiento_multitenant_abc_y_anomalias(monkeypatch):
    fake_redis = FakeRedisClient()
    monkeypatch.setattr(cache_module, "_redis_client", fake_redis)
    monkeypatch.setattr(cache_module, "_redis_failed", False)

    ahora = datetime.now(timezone.utc)
    hace_60_dias = ahora - timedelta(days=60)

    db = RoutingSessionLocal()
    try:
        # Poblar Tenant A con SKU compartido, patente y SATO insuficiente
        current_tenant_id.set(TENANT_A)
        db.add(
            Catalogo_Producto(
                sku="SKU-COMPARTIDO-MT",
                nombre="Café Grano Selección Tenant A",
                ean="7806060000011",
                precio=10_000,
                es_perecible_corto=False,
                dias_vida_util=365,
                created_at=hace_60_dias,
            )
        )
        db.add(
            Patente(
                id_patente="GOND-PRIVADA-TA",
                area_pasillo="PASILLO CENTRAL A",
                tipo_mueble="Gondola",
                tipo_ubicacion="SALA_VENTA",
                productos_asignados=["SKU-COMPARTIDO-MT"],
            )
        )
        db.flush()
        db.add(
            Sato(
                tipo_sato="PRODUCTO",
                sku="SKU-COMPARTIDO-MT",
                ubicacion_id="GOND-PRIVADA-TA",
                lote="LOTE-TA-1",
                fecha_vencimiento=date.today() + timedelta(days=60),
                cantidad=2,
                estado="Vitrina",
            )
        )
        db.commit()

        # Poblar Tenant B con exactamente el mismo código de SKU pero sin ventas ni anomalías
        current_tenant_id.set(TENANT_B)
        db.add(
            Catalogo_Producto(
                sku="SKU-COMPARTIDO-MT",
                nombre="Café Grano Selección Tenant B",
                ean="7806060000011",
                precio=10_000,
                es_perecible_corto=False,
                dias_vida_util=365,
                created_at=hace_60_dias,
            )
        )
        db.commit()
    finally:
        db.close()

    client = TestClient(app)
    headers_a = {"X-Tenant-ID": TENANT_A}
    headers_b = {"X-Tenant-ID": TENANT_B}

    # Personalizar configuración ABC en Tenant A
    res_cfg_a = client.put(
        "/api/v1/abc/config",
        headers=headers_a,
        json={"ventana_w_dias": 60, "frecuencia_a_dias": 7, "capacidad_diaria_skus": 45},
    )
    assert res_cfg_a.status_code == 200, res_cfg_a.text

    # Ingerir venta con déficit en Tenant A (genera venta, Clase A y anomalía VENTA_SIN_STOCK)
    res_sale_a = client.post(
        "/api/v1/integration/sales/webhook",
        headers={**headers_a, "X-API-Key": API_KEY},
        json={
            "external_ticket_id": "BOL-TA-SECRET-1",
            "pos_source": "POS_TENANT_A",
            "items": [{"sku": "SKU-COMPARTIDO-MT", "cantidad": 9, "precio_unitario": 10_000}],
        },
    )
    assert res_sale_a.status_code == 200, res_sale_a.text
    assert res_sale_a.json()["unidades_deficit"] == 7

    # Calentar caché de zonas calientes de Tenant A
    res_zonas_a = client.get("/api/v1/abc/zonas-patentes", headers=headers_a)
    assert res_zonas_a.status_code == 200
    assert "GOND-PRIVADA-TA" in res_zonas_a.json()["patentes"]
    assert res_zonas_a.json()["venta_total_ventana_clp"] == 90_000

    # ── Verificaciones desde TENANT_B (cero fugas de datos o caché) ───────
    # 1) Configuración de Tenant B intacta en valores default
    res_cfg_b = client.get("/api/v1/abc/config", headers=headers_b)
    assert res_cfg_b.status_code == 200
    assert res_cfg_b.json()["ventana_w_dias"] == 90
    assert res_cfg_b.json()["frecuencia_a_dias"] == 14
    assert res_cfg_b.json()["capacidad_diaria_skus"] == 20

    # 2) Historial de ventas externas vacío en Tenant B
    res_hist_b = client.get("/api/v1/integration/sales/history", headers=headers_b)
    assert res_hist_b.status_code == 200
    assert res_hist_b.json() == []

    # 3) Anomalías vacías en Tenant B
    res_anom_b = client.get("/api/v1/abc/anomalias", headers=headers_b)
    assert res_anom_b.status_code == 200
    assert res_anom_b.json() == []

    # 4) Zonas térmicas de Tenant B no ven patentes ni ventas cacheadas de Tenant A
    res_zonas_b = client.get("/api/v1/abc/zonas-patentes", headers=headers_b)
    assert res_zonas_b.status_code == 200
    zonas_b = res_zonas_b.json()
    assert zonas_b["patentes"] == {}
    assert zonas_b["venta_total_ventana_clp"] == 0
    assert zonas_b["anomalias_abiertas_total"] == 0

    # 5) Recálculo ABC en Tenant B clasifica su SKU-COMPARTIDO-MT con $0 ventas ("C") sin cruzar con Tenant A ("A")
    res_recalc_b = client.post("/api/v1/abc/recalcular", headers=headers_b)
    assert res_recalc_b.status_code == 200
    assert res_recalc_b.json()["venta_total_ventana_clp"] == 0

    db_verif = RoutingSessionLocal()
    try:
        current_tenant_id.set(TENANT_A)
        prod_a = db_verif.query(Catalogo_Producto).filter(Catalogo_Producto.sku == "SKU-COMPARTIDO-MT").one()
        assert prod_a.clase_abc == "A"
        assert prod_a.venta_valorizada_ventana == 90_000

        current_tenant_id.set(TENANT_B)
        prod_b = db_verif.query(Catalogo_Producto).filter(Catalogo_Producto.sku == "SKU-COMPARTIDO-MT").one()
        assert prod_b.clase_abc == "C"
        assert prod_b.venta_valorizada_ventana == 0
    finally:
        db_verif.close()


# ── 7. Frecuencia Default Clase A = 14 días (RF-03) sin INSERT en GET ─────

def test_07_frecuencia_default_a_14_dias_rf03():
    db = RoutingSessionLocal()
    try:
        current_tenant_id.set(TENANT_A)
        assert db.query(Configuracion_Conteo_Tenant).count() == 0
    finally:
        db.close()

    client = TestClient(app)
    res = client.get("/api/v1/abc/config", headers={"X-Tenant-ID": TENANT_A})
    assert res.status_code == 200, res.text
    cfg = res.json()

    assert cfg["ventana_w_dias"] == 90
    assert cfg["umbral_a"] == pytest.approx(0.80)
    assert cfg["umbral_b"] == pytest.approx(0.95)
    assert cfg["frecuencia_a_dias"] == 14
    assert cfg["frecuencia_b_dias"] == 30
    assert cfg["frecuencia_c_dias"] == 90

    # Verificar que GET /api/v1/abc/config (Read Replica) NO insertó fila en configuracion_conteo_tenant
    db_after = RoutingSessionLocal()
    try:
        current_tenant_id.set(TENANT_A)
        assert db_after.query(Configuracion_Conteo_Tenant).count() == 0
    finally:
        db_after.close()


# ── 8. Idempotencia Re-Upload .XLSX + FEFO Multi-Lote con Fallback Bodega ─

def test_08_idempotencia_xlsx_reupload_y_fefo_multilote_con_fallback_bodega():
    ahora = datetime.now(timezone.utc)
    db = RoutingSessionLocal()
    try:
        current_tenant_id.set(TENANT_A)
        db.add(
            Catalogo_Producto(
                sku="SKU-FEFO-MULTI",
                nombre="Mantequilla Sin Sal 250g",
                ean="7808080000011",
                precio=3000,
                es_perecible_corto=False,
                dias_vida_util=90,
                created_at=ahora - timedelta(days=60),
            )
        )
        db.add(
            Patente(
                id_patente="GOND-FEFO-1",
                area_pasillo="PASILLO FRIO 2",
                tipo_mueble="Vitrina Frio",
                tipo_ubicacion="SALA_VENTA",
                productos_asignados=["SKU-FEFO-MULTI"],
            )
        )
        db.flush()

        # Vitrina: lote sin fecha (NULLS LAST -> sale después) y lote que vence pronto (sale primero)
        s_vit_null = Sato(
            tipo_sato="PRODUCTO",
            sku="SKU-FEFO-MULTI",
            ubicacion_id="GOND-FEFO-1",
            lote="LOTE-VIT-SIN-VENC",
            fecha_vencimiento=None,
            cantidad=2,
            estado="Vitrina",
        )
        s_vit_pronto = Sato(
            tipo_sato="PRODUCTO",
            sku="SKU-FEFO-MULTI",
            ubicacion_id="GOND-FEFO-1",
            lote="LOTE-VIT-PRONTO",
            fecha_vencimiento=date.today() + timedelta(days=4),
            cantidad=3,
            estado="Vitrina",
        )
        # Bodega: 2 unidades adicionales para fallback
        s_bodega = Sato(
            tipo_sato="PRODUCTO",
            sku="SKU-FEFO-MULTI",
            ubicacion_id=None,
            lote="LOTE-BOD-BACKUP",
            fecha_vencimiento=date.today() + timedelta(days=30),
            cantidad=2,
            estado="Bodega",
        )
        db.add_all([s_vit_null, s_vit_pronto, s_bodega])
        db.commit()
    finally:
        db.close()

    # Archivo .xlsx SIN columna Folio -> idempotencia por hash SHA-256 (ARCHIVO-<hash>)
    # Vende 9 unidades contra 7 disponibles (3 vitrina pronto + 2 vitrina null + 2 bodega) -> déficit = 2
    xlsx_sin_folio = _construir_xlsx_bytes(
        headers=["Codigo_Barras", "Cantidad", "Precio_Unitario", "Fecha"],
        rows=[
            ["7808080000011", 9, 3000, ahora.strftime("%Y-%m-%d %H:%M:%S")],
        ],
    )

    client = TestClient(app)
    res_1 = client.post(
        "/api/v1/integration/sales/import-file",
        headers={"X-Tenant-ID": TENANT_A},
        files={
            "file": (
                "cierre_sin_folio.xlsx",
                io.BytesIO(xlsx_sin_folio),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
        data={
            "pos_source": "CAJA_EXCEL_SIN_FOLIO",
            "allow_bodega_fallback": "true",
            "modo_historico_abc": "false",
        },
    )
    assert res_1.status_code == 200, res_1.text
    b1 = res_1.json()
    assert b1["tickets_procesados"] == 1
    assert b1["unidades_descontadas"] == 7
    assert b1["unidades_deficit"] == 2
    assert b1["total_valorizado"] == 27_000

    # Re-subir exactamente el mismo .xlsx: 100% idempotente (no duplica ventas ABC ni anomalías)
    res_2 = client.post(
        "/api/v1/integration/sales/import-file",
        headers={"X-Tenant-ID": TENANT_A},
        files={
            "file": (
                "cierre_sin_folio.xlsx",
                io.BytesIO(xlsx_sin_folio),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
        data={
            "pos_source": "CAJA_EXCEL_SIN_FOLIO",
            "allow_bodega_fallback": "true",
            "modo_historico_abc": "false",
        },
    )
    assert res_2.status_code == 200, res_2.text
    b2 = res_2.json()
    assert b2["tickets_procesados"] == 0
    assert b2["tickets_duplicados"] == 1
    assert b2["unidades_descontadas"] == 0
    assert b2["unidades_deficit"] == 0

    db_verif = RoutingSessionLocal()
    try:
        current_tenant_id.set(TENANT_A)
        assert db_verif.query(Sato).filter(Sato.cantidad < 0).count() == 0
        satos = {s.lote: s for s in db_verif.query(Sato).all()}
        assert satos["LOTE-VIT-PRONTO"].cantidad == 0
        assert satos["LOTE-VIT-PRONTO"].estado == "Agotado"
        assert satos["LOTE-VIT-SIN-VENC"].cantidad == 0
        assert satos["LOTE-VIT-SIN-VENC"].estado == "Agotado"
        assert satos["LOTE-BOD-BACKUP"].cantidad == 0
        assert satos["LOTE-BOD-BACKUP"].estado == "Agotado"

        prod = db_verif.query(Catalogo_Producto).filter(Catalogo_Producto.sku == "SKU-FEFO-MULTI").one()
        assert prod.venta_valorizada_ventana == 27_000
        assert prod.unidades_vendidas_ventana == 9
        assert db_verif.query(Anomalia_Stock).count() == 1
    finally:
        db_verif.close()


# ── 9. Hardening Seguridad: Anti-ZipBomb/XXE OOXML, Glob Tenant y Schemas ─

def test_09_seguridad_zipbomb_xxe_glob_tenant_y_overflow_pos():
    import zipfile

    client = TestClient(app)
    headers_a = {"X-Tenant-ID": TENANT_A}

    # 1) Bloqueo de metacaracteres Glob en X-Tenant-ID (anti Redis SCAN injection)
    res_bad_tenant = client.get("/api/v1/abc/config", headers={"X-Tenant-ID": "tenant-*"})
    assert res_bad_tenant.status_code == 400

    # 2) Bloqueo de XXE / DOCTYPE dentro de contenedor .xlsx con firma PK\x03\x04
    xxe_buf = io.BytesIO()
    with zipfile.ZipFile(xxe_buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(
            "xl/workbook.xml",
            '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol">]><workbook>&lol;</workbook>',
        )
    res_xxe = client.post(
        "/api/v1/integration/sales/import-file",
        headers=headers_a,
        files={
            "file": (
                "malicioso_xxe.xlsx",
                io.BytesIO(xxe_buf.getvalue()),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
        data={"pos_source": "FACTURACION_CL"},
    )
    assert res_xxe.status_code == 422

    # 3) Bloqueo de Zip Bomb (ratio de compresión > 50:1 para entradas > 64 KB)
    bomb_buf = io.BytesIO()
    with zipfile.ZipFile(bomb_buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("xl/workbook.xml", "<workbook/>")
        zf.writestr("xl/sharedStrings.xml", "A" * 500_000)  # 500 KB de 'A' comprime a ~500 bytes (ratio ~1000:1)
    res_bomb = client.post(
        "/api/v1/integration/sales/import-file",
        headers=headers_a,
        files={
            "file": (
                "zipbomb.xlsx",
                io.BytesIO(bomb_buf.getvalue()),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
        data={"pos_source": "FACTURACION_CL"},
    )
    assert res_bomb.status_code == 422

    # 4) Bloqueo de overflow INT4 / XSS en webhook Omni-POS
    res_overflow = client.post(
        "/api/v1/integration/sales/webhook",
        headers={**headers_a, "X-API-Key": API_KEY},
        json={
            "external_ticket_id": "BOL-OVERFLOW-1",
            "pos_source": "POS_EXT",
            "items": [{"sku": "SKU-ANY", "cantidad": 1, "precio_unitario": 3_000_000_000}],
        },
    )
    assert res_overflow.status_code == 422

    res_xss = client.post(
        "/api/v1/integration/sales/webhook",
        headers={**headers_a, "X-API-Key": API_KEY},
        json={
            "external_ticket_id": "<script>alert(1)</script>",
            "pos_source": "POS_EXT",
            "items": [{"sku": "SKU-ANY", "cantidad": 1, "precio_unitario": 1000}],
        },
    )
    assert res_xss.status_code == 422


# ── 10. Contract Sentinel: Sincronización 100% OpenAPI ↔ TypeScript ───────

def test_10_contract_sentinel_openapi_vs_typescript_etapa1():
    from pathlib import Path

    openapi = app.openapi()
    schemas = openapi["components"]["schemas"]
    api_ts = Path("frontend/src/services/api.ts").read_text(encoding="utf-8")

    # Verificar que todos los modelos de Etapa 1 existen tanto en OpenAPI como en api.ts
    modelos_etapa1 = [
        "ConfigConteoResponse",
        "ConfigConteoUpdate",
        "AbcRecalculoResponse",
        "ZonaAbcSkuTopItem",
        "ZonaAbcPatenteItem",
        "AbcPlanoResumenResponse",
        "DiscrepanciaVitrinaRequest",
        "AnomaliaStockResponse",
        "ExternalSaleItem",
        "ExternalSaleWebhookRequest",
        "ExternalSaleBatchRequest",
        "ExternalSaleResponse",
        "ExternalSaleBatchResponse",
        "ExternalSaleHistoryItem",
        "ProductoDetalleStock",
    ]
    for model_name in modelos_etapa1:
        assert model_name in schemas, f"Falta schema {model_name} en /openapi.json"
        assert model_name in api_ts, f"Falta tipo/interfaz {model_name} en frontend/src/services/api.ts"
        for prop_name in schemas[model_name].get("properties", {}).keys():
            assert prop_name in api_ts, f"Falta propiedad '{prop_name}' de {model_name} en api.ts"



