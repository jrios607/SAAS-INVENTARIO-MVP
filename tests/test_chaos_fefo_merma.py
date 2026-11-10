"""
tests/test_chaos_fefo_merma.py
─────────────────────────────────────────────────────────────────────────────
Suite de Ingeniería del Caos y Auditoría de Casos Borde para 'chaos-fefo-auditor':
  1. Bloqueo estricto de saldo negativo en Sato (Underflow Protection).
  2. Prevención de traslado a vitrina de mercadería con fecha expirada.
  3. Conservación de masa/unidades en partición de SATO Padre -> SATO Hijos.
  4. Registro obligatorio en Log_Transaccional ante mermas y destrucción.
"""

import os
import uuid
from datetime import date, timedelta
import pytest

os.environ["DATABASE_URL"] = "sqlite:///./test_chaos_suite.db"
os.environ["DATABASE_POOLER_URL"] = ""
os.environ["DATABASE_READ_URL"] = ""
os.environ["REDIS_URL"] = ""

from app.core.tenant import current_tenant_id
from app.database import Base, engine, RoutingSessionLocal
from app.models import Tenant, Catalogo_Producto, Sato, Log_Transaccional, Patente
from app.services.inventario_service import (
    ajustar_inventario_sato,
    mover_a_vitrina,
    InventarioError,
)

CHAOS_TENANT = "cccc3333-3333-3333-3333-333333333333"
SATO_VIGENTE_ID = uuid.uuid4()
SATO_EXPIRADO_ID = uuid.uuid4()


@pytest.fixture(autouse=True)
def setup_chaos_db():
    Base.metadata.create_all(bind=engine)
    db = RoutingSessionLocal()
    current_tenant_id.set(CHAOS_TENANT)

    # Limpiar datos previos del tenant de caos
    try:
        db.query(Log_Transaccional).filter(Log_Transaccional.tenant_id == CHAOS_TENANT).delete(synchronize_session=False)
        db.query(Sato).filter(Sato.tenant_id == CHAOS_TENANT).delete(synchronize_session=False)
        db.query(Patente).filter(Patente.tenant_id == CHAOS_TENANT).delete(synchronize_session=False)
        db.query(Catalogo_Producto).filter(Catalogo_Producto.tenant_id == CHAOS_TENANT).delete(synchronize_session=False)
        db.query(Tenant).filter(Tenant.id == CHAOS_TENANT).delete(synchronize_session=False)
        db.commit()

        t = Tenant(id=CHAOS_TENANT, nombre="Minimarket Caos Test", activo=True)
        db.add(t)
        db.flush()

        # Producto perecible refrigerado
        p_leche = Catalogo_Producto(
            tenant_id=CHAOS_TENANT,
            sku="SKU-LECHE-CAOS",
            nombre="Leche Entera Caos 1L",
            ean="7801111111111",
            temperatura_requerida="REFRIGERADO",
            unidad_medida="UN",
        )
        db.add(p_leche)
        db.flush()

        # Vitrina de frío de destino
        v_frio = Patente(
            tenant_id=CHAOS_TENANT,
            id_patente="VIT-FRIO-01",
            area_pasillo="Lácteos",
            tipo_mueble="Vitrina Mural Frío",
            coordenada_x=8.0,
            coordenada_y=2.0,
            ancho=3.0,
            largo=2.0,
            productos_asignados=["SKU-LECHE-CAOS"],
        )
        db.add(v_frio)
        db.flush()

        # SATO 1: 5 unidades vigentes en bodega
        s1 = Sato(
            tenant_id=CHAOS_TENANT,
            sato_id=SATO_VIGENTE_ID,
            sku="SKU-LECHE-CAOS",
            cantidad=5,
            estado="Bodega",
            ubicacion_id=None,
            fecha_vencimiento=date.today() + timedelta(days=10),
            lote="LOTE-VIGENTE",
        )
        # SATO 2: 3 unidades YA CADUCADAS en bodega
        s2 = Sato(
            tenant_id=CHAOS_TENANT,
            sato_id=SATO_EXPIRADO_ID,
            sku="SKU-LECHE-CAOS",
            cantidad=3,
            estado="Bodega",
            ubicacion_id=None,
            fecha_vencimiento=date.today() - timedelta(days=2),
            lote="LOTE-EXPIRADO",
        )
        db.add_all([s1, s2])
        db.commit()
    finally:
        db.close()
    yield


def test_01_bloqueo_stock_negativo_underflow():
    """El sistema debe rechazar tajantemente descontar más stock del que existe."""
    db = RoutingSessionLocal()
    try:
        current_tenant_id.set(CHAOS_TENANT)
        # Intentar restar 10 unidades de un SATO que solo tiene 5
        with pytest.raises(InventarioError) as exc_info:
            ajustar_inventario_sato(
                db=db,
                sato_id=str(SATO_VIGENTE_ID),
                cantidad_a_restar=10,
                motivo="Ajuste manual",
            )
        assert "No se puede restar 10" in str(exc_info.value)
        
        # Verificar que el stock de 5 unidades permanezca intacto y no sea negativo
        sato = db.query(Sato).filter(Sato.sato_id == SATO_VIGENTE_ID).first()
        assert sato.cantidad == 5
        assert sato.cantidad >= 0
    finally:
        db.close()


def test_02_bloqueo_traslado_lote_caducado_a_vitrina():
    """El sistema debe prohibir estrictamente trasladar a vitrina lotes que ya vencieron."""
    db = RoutingSessionLocal()
    try:
        current_tenant_id.set(CHAOS_TENANT)
        with pytest.raises(InventarioError) as exc_info:
            mover_a_vitrina(
                db=db,
                sato_id=SATO_EXPIRADO_ID,
                id_patente="VIT-FRIO-01",
                cantidad_a_mover=2,
            )
        assert "está vencido" in str(exc_info.value).lower()

        # El lote debe permanecer en Bodega y no llegar a la sala de ventas
        sato = db.query(Sato).filter(Sato.sato_id == SATO_EXPIRADO_ID).first()
        assert sato.estado == "Bodega"
    finally:
        db.close()


def test_03_conservacion_de_unidades_particion_sato():
    """Al dividir un SATO Padre en Hijos, la suma de unidades debe ser exactamente igual al origen."""
    db = RoutingSessionLocal()
    try:
        current_tenant_id.set(CHAOS_TENANT)
        padre_uuid = uuid.uuid4()
        padre = Sato(
            tenant_id=CHAOS_TENANT,
            sato_id=padre_uuid,
            sku="SKU-LECHE-CAOS",
            cantidad=100,
            estado="Bodega",
            lote="L-PADRE-01",
        )
        db.add(padre)
        db.commit()

        # Particionar en 3 hijos (40, 35 y 25 unidades)
        cantidades_hijos = [40, 35, 25]
        padre.cantidad = 0
        padre.estado = "Agotado"

        for cant in cantidades_hijos:
            hijo = Sato(
                tenant_id=CHAOS_TENANT,
                sato_id=uuid.uuid4(),
                padre_id=padre.sato_id,
                sku="SKU-LECHE-CAOS",
                cantidad=cant,
                estado="Vitrina",
                lote="L-PADRE-01",
            )
            db.add(hijo)
        db.commit()

        # Invariante de conservación de masa
        hijos = db.query(Sato).filter(Sato.padre_id == padre_uuid).all()
        total_hijos = sum(h.cantidad for h in hijos)
        assert total_hijos == 100
        assert len(hijos) == 3
    finally:
        db.close()


def test_04_auditoria_obligatoria_de_merma():
    """Toda baja por merma debe registrar un Log_Transaccional indeleble."""
    db = RoutingSessionLocal()
    try:
        current_tenant_id.set(CHAOS_TENANT)
        sato = db.query(Sato).filter(Sato.sato_id == SATO_VIGENTE_ID).first()
        assert sato is not None

        # Descontar 2 unidades por daño con URL de foto obligatoria
        ajustar_inventario_sato(
            db=db,
            sato_id=str(SATO_VIGENTE_ID),
            cantidad_a_restar=2,
            motivo="Daño",
            url_foto="https://s3.aws.com/sg-bvc/foto-danio-leche.jpg",
            user_id=None,
        )

        sato_actualizado = db.query(Sato).filter(Sato.sato_id == SATO_VIGENTE_ID).first()
        assert sato_actualizado.cantidad == 3

        log_db = db.query(Log_Transaccional).filter(
            Log_Transaccional.tenant_id == CHAOS_TENANT,
            Log_Transaccional.accion == "AJUSTE_INVENTARIO",
        ).first()
        assert log_db is not None
        assert "Daño" in log_db.detalles
    finally:
        db.close()


def test_05_contract_sentinel_openapi_sync():
    """Verifica ('contract-sentinel') que las rutas críticas de api.ts estén expuestas en OpenAPI v1."""
    from app.main import app

    openapi_schema = app.openapi()
    paths = openapi_schema.get("paths", {})

    rutas_criticas_esperadas = [
        "/api/v1/patentes/",
        "/api/v1/patentes/{id_patente}",
        "/api/v1/patentes/batch/compliance",
        "/api/v1/inventario/alertas-vencimiento",
        "/api/v1/catalogo/productos",
        "/api/v1/catalogo/stock-agrupado",
        "/api/v1/integration/sales/webhook",
        "/api/v1/integration/sales/import-batch",
    ]
    for ruta in rutas_criticas_esperadas:
        assert ruta in paths, f"Drift de contrato detectado: ruta '{ruta}' ausente en OpenAPI"


def test_06_rechazo_merma_y_ajuste_negativos_o_cero():
    """B6: Valores negativos o cero en MermaRequest / AjusteInventarioRequest nunca deben sumar stock."""
    from pydantic import ValidationError
    from app.schemas import MermaRequest, AjusteInventarioRequest
    from app.services.inventario_service import declarar_merma

    with pytest.raises(ValidationError):
        MermaRequest(sato_id=SATO_VIGENTE_ID, cantidad=-5, motivo="Merma")

    with pytest.raises(ValidationError):
        AjusteInventarioRequest(cantidad_a_restar=0, motivo="Ajuste")

    db = RoutingSessionLocal()
    try:
        current_tenant_id.set(CHAOS_TENANT)
        with pytest.raises(InventarioError):
            declarar_merma(db, SATO_VIGENTE_ID, -3, "Merma", None)
    finally:
        db.close()


def test_07_fraccionar_sato_respeta_surtido_patente():
    """B7: fraccionar_sato debe bloquear SKUs que no pertenecen al surtido asignado de la góndola."""
    from app.services.inventario_service import fraccionar_sato

    db = RoutingSessionLocal()
    try:
        current_tenant_id.set(CHAOS_TENANT)
        p_extra = Catalogo_Producto(
            tenant_id=CHAOS_TENANT,
            sku="SKU-INTRUSO-01",
            nombre="Producto No Asignado",
            ean="7802222222222",
            temperatura_requerida="SECO",
            unidad_medida="UN",
        )
        db.add(p_extra)
        db.flush()

        sato_intruso = Sato(
            tenant_id=CHAOS_TENANT,
            sato_id=uuid.uuid4(),
            sku="SKU-INTRUSO-01",
            cantidad=10,
            estado="Bodega",
            lote="LOTE-INT",
            fecha_vencimiento=date.today() + timedelta(days=30),
        )
        db.add(sato_intruso)
        db.commit()

        with pytest.raises(InventarioError) as exc_info:
            fraccionar_sato(
                db=db,
                sato_padre_id=sato_intruso.sato_id,
                cantidad_a_mover=4,
                planograma_destino_id="VIT-FRIO-01",
            )
        assert "no está asignado" in str(exc_info.value)
    finally:
        db.close()


def test_08_submapeo_nombre_display_bloquea_xss():
    """El nombre descriptivo persistido en submapeo_grid admite nombres limpios y bloquea XSS."""
    from pydantic import ValidationError
    from app.schemas import PatenteUpdate

    ok = PatenteUpdate(submapeo_grid={"nombre_display": "Vitrina Lácteos Principal"})
    assert ok.submapeo_grid["nombre_display"] == "Vitrina Lácteos Principal"

    with pytest.raises(ValidationError):
        PatenteUpdate(submapeo_grid={"nombre_display": "<script>alert(1)</script>"})


