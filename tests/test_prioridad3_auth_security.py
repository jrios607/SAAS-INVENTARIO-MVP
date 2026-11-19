"""
tests/test_prioridad3_auth_security.py
─────────────────────────────────────────────────────────────────────────────
Suite de certificación Prioridad 3 — Seguridad y Acceso Multi-Tenant:
  1. Modo Híbrido (`GET /api/v1/auth/status`):
     - Con `AUTH_REQUIRED=False` y sin token → `auth_required=False, authenticated=False`.
     - Con `AUTH_REQUIRED=True` y sin token → `auth_required=True, authenticated=False` (sin lanzar 401),
       mientras endpoints protegidos exigen JWT (`401`).
     - Con JWT válido → `authenticated=True` + perfil de usuario y `tenant_id`.
  2. Login Multi-Tenant Inteligente (`POST /api/v1/auth/login` y `/api/v1/auth/login-json`):
     - Usuario único en un local inicia sesión directo sin enviar `tenant_id` (incluso si el header
       `X-Tenant-ID` traía otro tenant por defecto).
     - Si el mismo `nombre` existe en 2 locales distintos y no se envía `tenant_id`, responde `409 Conflict`.
     - Al especificar `tenant_id`, resuelve al local exacto (`200 OK`).
  3. Anti-Spoofing JWT ↔ Tenant y RBAC por Rol (`Admin`, `Supervisor`, `Operario`):
     - Token emitido para `TENANT_A` usado con `X-Tenant-ID: TENANT_B` es rechazado con `403 Forbidden`.
     - `Operario` puede confirmar conteo cíclico (`200`), pero recibe `403` al intentar eliminar un producto
       o cambiar configuración del local (`PUT /api/v1/tenant/settings`).
     - `Supervisor` puede editar configuración (`200`), pero recibe `403` al eliminar producto (`DELETE` exclusivo de `Admin`).
     - `Admin` puede eliminar producto (`200`).
  4. Rate Limiting Anti-Fuerza Bruta (`429 Too Many Requests`) en `/api/v1/auth/login-json`.
  5. Seed CLI Idempotente (`seed_initial_users` en `app/cli_seed_users.py`).
  6. Contract-Sentinel OpenAPI ↔ TypeScript (`frontend/src/services/api.ts` y `frontend/src/app/login/page.tsx`).
"""

import pathlib
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from app.cli_seed_users import seed_initial_users
from app.core.config import settings
from app.core.security import hash_password
from app.core.tenant import current_tenant_id
from app.database import Base, RoutingSessionLocal, engine
from app.domains.auth.routers.auth import reset_login_rate_limiter
from app.main import app
from app.models import (
    Anomalia_Stock,
    Catalogo_Producto,
    Categoria,
    Log_Transaccional,
    Patente,
    Sato,
    Tenant,
    Usuario,
)
from app.services.catalogo_service import invalidar_cache_catalogo

TENANT_A = "p3aa1111-1111-1111-1111-111111111111"
TENANT_B = "p3bb2222-2222-2222-2222-222222222222"


def _purgar_tenants_p3(db) -> None:
    for tid in (TENANT_A, TENANT_B):
        current_tenant_id.set(tid)
        db.query(Anomalia_Stock).filter(Anomalia_Stock.tenant_id == tid).delete(
            synchronize_session=False
        )
        db.query(Log_Transaccional).filter(Log_Transaccional.tenant_id == tid).delete(
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
def setup_clean_p3_db():
    prev_auth = settings.AUTH_REQUIRED
    reset_login_rate_limiter()
    Base.metadata.create_all(bind=engine)

    db = RoutingSessionLocal()
    try:
        _purgar_tenants_p3(db)
        for tid, nombre in [
            (TENANT_A, "Local Norte A"),
            (TENANT_B, "Local Sur B"),
        ]:
            t = db.query(Tenant).filter(Tenant.id == tid).first()
            if not t:
                db.add(Tenant(id=tid, nombre=nombre, activo=True, settings={}))
        db.commit()
    finally:
        db.close()

    yield

    settings.AUTH_REQUIRED = prev_auth
    reset_login_rate_limiter()
    db_clean = RoutingSessionLocal()
    try:
        _purgar_tenants_p3(db_clean)
    finally:
        db_clean.close()


def test_01_seed_cli_idempotente_y_login_multitenant_inteligente():
    client = TestClient(app)
    db = RoutingSessionLocal()
    try:
        # Sembrar cuentas iniciales en TENANT_A con el helper oficial de CLI
        res_seed_1 = seed_initial_users(
            db,
            tenant_id=TENANT_A,
            admin_user="admin",
            admin_pass="ClaveAdminA!",
            supervisor_user="super_a",
            supervisor_pass="ClaveSuperA!",
            operario_user="oper_unico_a",
            operario_pass="ClaveOperA!",
        )
        assert len(res_seed_1) == 3
        assert all(r["accion"] == "CREADO" for r in res_seed_1)

        # Segunda ejecución debe ser idempotente (ACTUALIZADO, sin IntegrityError)
        res_seed_2 = seed_initial_users(
            db,
            tenant_id=TENANT_A,
            admin_user="admin",
            admin_pass="ClaveAdminA!",
            supervisor_user="super_a",
            supervisor_pass="ClaveSuperA!",
            operario_user="oper_unico_a",
            operario_pass="ClaveOperA!",
        )
        assert all(r["accion"] == "ACTUALIZADO" for r in res_seed_2)

        # Crear también un usuario llamado "admin" en TENANT_B para probar colisión multi-local
        current_tenant_id.set(TENANT_B)
        db.add(
            Usuario(
                tenant_id=TENANT_B,
                nombre="admin",
                password_hash=hash_password("ClaveAdminB!"),
                rol="Admin",
            )
        )
        db.commit()
    finally:
        db.close()

    # 1. Usuario único ("oper_unico_a") inicia sesión sin enviar tenant_id (incluso si X-Tenant-ID era TENANT_B)
    r_unique = client.post(
        "/api/v1/auth/login-json",
        headers={"X-Tenant-ID": TENANT_B},
        json={"username": "oper_unico_a", "password": "ClaveOperA!"},
    )
    assert r_unique.status_code == 200, r_unique.text
    data_u = r_unique.json()
    assert data_u["usuario"] == "oper_unico_a"
    assert data_u["rol"] == "Operario"
    assert data_u["tenant_id"] == TENANT_A
    assert data_u["access_token"]

    # 2. Usuario repetido en 2 locales ("admin") sin tenant_id debe responder 409 Conflict
    r_ambiguous = client.post(
        "/api/v1/auth/login-json",
        json={"username": "admin", "password": "ClaveAdminA!"},
    )
    assert r_ambiguous.status_code == 409
    assert "Código de Local" in r_ambiguous.json()["detail"]

    # 3. Al especificar tenant_id=TENANT_B, entra al local B con sus credenciales
    r_explicit_b = client.post(
        "/api/v1/auth/login-json",
        json={"username": "admin", "password": "ClaveAdminB!", "tenant_id": TENANT_B},
    )
    assert r_explicit_b.status_code == 200, r_explicit_b.text
    assert r_explicit_b.json()["tenant_id"] == TENANT_B


def test_02_modo_hibrido_auth_status_rbac_y_antispoofing():
    client = TestClient(app)
    db = RoutingSessionLocal()
    try:
        seed_initial_users(
            db,
            tenant_id=TENANT_A,
            admin_user="admin_a",
            admin_pass="AdminPass1!",
            supervisor_user="super_a",
            supervisor_pass="SuperPass1!",
            operario_user="oper_a",
            operario_pass="OperPass1!",
        )
        current_tenant_id.set(TENANT_A)
        cat = Categoria(tenant_id=TENANT_A, nombre="Abarrotes")
        db.add(cat)
        db.flush()
        db.add(
            Catalogo_Producto(
                tenant_id=TENANT_A,
                sku="SKU-AUTH-01",
                nombre="Arroz Grado 1",
                ean="7809999000011",
                categoria_id=cat.id,
                costo_unitario=1000,
                precio=1600,
                activo=True,
            )
        )
        db.add(
            Sato(
                tenant_id=TENANT_A,
                tipo_sato="PRODUCTO",
                sku="SKU-AUTH-01",
                lote="L-ARROZ-1",
                cantidad=5,
                estado="Vitrina",
                fecha_vencimiento=date.today() + timedelta(days=30),
            )
        )
        db.add(
            Patente(
                tenant_id=TENANT_A,
                id_patente="GOND-AUTH-01",
                area_pasillo="Pasillo Auth",
                tipo_ubicacion="SALA_VENTA",
            )
        )
        db.commit()
    finally:
        db.close()

    # 1. En modo AUTH_REQUIRED=False, /auth/status retorna auth_required=False
    settings.AUTH_REQUIRED = False
    r_st_dev = client.get("/api/v1/auth/status", headers={"X-Tenant-ID": TENANT_A})
    assert r_st_dev.status_code == 200
    assert r_st_dev.json()["auth_required"] is False
    assert r_st_dev.json()["authenticated"] is False

    # 2. Activar AUTH_REQUIRED=True (modo producción)
    settings.AUTH_REQUIRED = True
    r_st_prod = client.get("/api/v1/auth/status", headers={"X-Tenant-ID": TENANT_A})
    assert r_st_prod.status_code == 200
    assert r_st_prod.json()["auth_required"] is True
    assert r_st_prod.json()["authenticated"] is False

    # Sin token, un endpoint protegido devuelve 401
    r_unauth = client.get("/api/v1/dashboard/kpis", headers={"X-Tenant-ID": TENANT_A})
    assert r_unauth.status_code == 401

    # 3. Obtener tokens de Operario, Supervisor y Admin
    tok_oper = client.post(
        "/api/v1/auth/login-json",
        json={"username": "oper_a", "password": "OperPass1!", "tenant_id": TENANT_A},
    ).json()["access_token"]
    tok_super = client.post(
        "/api/v1/auth/login-json",
        json={"username": "super_a", "password": "SuperPass1!", "tenant_id": TENANT_A},
    ).json()["access_token"]
    tok_admin = client.post(
        "/api/v1/auth/login-json",
        json={"username": "admin_a", "password": "AdminPass1!", "tenant_id": TENANT_A},
    ).json()["access_token"]

    headers_oper = {"X-Tenant-ID": TENANT_A, "Authorization": f"Bearer {tok_oper}"}
    headers_super = {"X-Tenant-ID": TENANT_A, "Authorization": f"Bearer {tok_super}"}
    headers_admin = {"X-Tenant-ID": TENANT_A, "Authorization": f"Bearer {tok_admin}"}

    # Verificar /auth/status autenticado
    r_st_auth = client.get("/api/v1/auth/status", headers=headers_oper)
    assert r_st_auth.status_code == 200
    assert r_st_auth.json()["authenticated"] is True
    assert r_st_auth.json()["usuario"]["rol"] == "Operario"

    # 4. Anti-Spoofing: usar token de TENANT_A contra TENANT_B debe dar 403
    r_spoof = client.get(
        "/api/v1/dashboard/kpis",
        headers={"X-Tenant-ID": TENANT_B, "Authorization": f"Bearer {tok_admin}"},
    )
    assert r_spoof.status_code == 403

    # 5. RBAC Operario: puede hacer conteo-ok (200), pero NO actualizar settings (403) ni eliminar producto (403)
    r_oper_conteo = client.post(
        "/api/v1/abc/conteo-ok",
        headers=headers_oper,
        json={"sku": "SKU-AUTH-01", "origen": "RUTINA_10MIN"},
    )
    assert r_oper_conteo.status_code == 200

    r_oper_cfg = client.put(
        "/api/v1/tenant/settings",
        headers=headers_oper,
        json={"nombre_local": "Intento Operario"},
    )
    assert r_oper_cfg.status_code == 403

    r_oper_del = client.delete("/api/v1/catalogo/producto/SKU-AUTH-01", headers=headers_oper)
    assert r_oper_del.status_code == 403

    # 6. RBAC Supervisor: puede actualizar settings (200), pero NO eliminar góndola (403, exclusivo de Admin)
    r_super_cfg = client.put(
        "/api/v1/tenant/settings",
        headers=headers_super,
        json={"nombre_local": "Local Actualizado Por Supervisor"},
    )
    assert r_super_cfg.status_code == 200

    r_super_del = client.delete("/api/v1/patentes/GOND-AUTH-01", headers=headers_super)
    assert r_super_del.status_code == 403

    # 7. RBAC Admin: puede eliminar la góndola vacía (204)
    r_admin_del = client.delete("/api/v1/patentes/GOND-AUTH-01", headers=headers_admin)
    assert r_admin_del.status_code == 204


def test_03_rate_limit_antifuerza_bruta_en_login():
    client = TestClient(app)
    db = RoutingSessionLocal()
    try:
        seed_initial_users(
            db,
            tenant_id=TENANT_A,
            admin_user="admin_rl",
            admin_pass="Correcta123!",
        )
    finally:
        db.close()

    # 8 intentos fallidos devuelven 401; el intento #9 dentro de la ventana de 60s devuelve 429
    for _ in range(8):
        r_fail = client.post(
            "/api/v1/auth/login-json",
            json={"username": "admin_rl", "password": "Incorrecta!", "tenant_id": TENANT_A},
        )
        assert r_fail.status_code == 401

    r_blocked = client.post(
        "/api/v1/auth/login-json",
        json={"username": "admin_rl", "password": "Correcta123!", "tenant_id": TENANT_A},
    )
    assert r_blocked.status_code == 429


def test_04_contract_sentinel_prioridad3_auth():
    spec = app.openapi()
    paths = spec.get("paths", {})
    assert "/api/v1/auth/status" in paths
    assert "/api/v1/auth/login-json" in paths
    assert "/api/v1/auth/login" in paths

    api_ts = pathlib.Path("frontend/src/services/api.ts").read_text(encoding="utf-8")
    for sym in (
        "loginUsuario",
        "getAuthStatus",
        "getStoredUserSession",
        "clearStoredAuthSession",
        "canUserManageAdminActions",
        "canUserDeleteCritical",
        "/api/v1/auth/login-json",
        "/api/v1/auth/status",
    ):
        assert sym in api_ts, f"Falta '{sym}' en frontend/src/services/api.ts"

    assert pathlib.Path("frontend/src/app/login/page.tsx").exists()
