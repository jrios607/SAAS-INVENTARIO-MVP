import logging
import re
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from app.database import engine, Base
from app.db_migrations import ensure_schema_up_to_date
from app.domains.wms.routers import (
    catalogo,
    patente,
    bodega,
    vitrina,
    merma,
    inventario,
    dashboard,
    mapa_bodega,
    abc,
    tenant_settings,
)
# (POS Caja propio retirado: las ventas llegan desde POS externos vía /api/v1/integration/sales/*)
from app.domains.auth.routers import auth, logs
from app.domains.integration.routers import integration, asn, outbound, trazabilidad
from app.core.config import settings
from app.core.logger import setup_logger
from app.core.tenant import current_tenant_id
import uuid
import structlog

# Crear tablas en BD y sincronizar columnas nuevas (idempotente en SQLite y PostgreSQL / Neon)
# Si Neon usa PgBouncer (DATABASE_POOLER_URL) separado de DATABASE_URL directa, ejecutar DDL
# preferentemente sobre DATABASE_URL directa para evitar bloqueos de sesión en PgBouncer.
_ddl_synced_on_direct = False
if (
    settings.DATABASE_POOLER_URL
    and settings.DATABASE_URL
    and settings.DATABASE_URL != settings.DATABASE_POOLER_URL
    and settings.DATABASE_URL.startswith("postgresql")
):
    _direct_engine = None
    try:
        from sqlalchemy import create_engine as _create_direct_engine

        _direct_engine = _create_direct_engine(settings.DATABASE_URL, pool_pre_ping=True)
        Base.metadata.create_all(bind=_direct_engine)
        ensure_schema_up_to_date(_direct_engine)
        _ddl_synced_on_direct = True
    except Exception as _mig_exc:
        logging.getLogger("sg-wms.migrations").warning(
            "No se pudo sincronizar DDL en DATABASE_URL directa: %s", _mig_exc
        )
    finally:
        if _direct_engine is not None:
            _direct_engine.dispose()

if not _ddl_synced_on_direct:
    Base.metadata.create_all(bind=engine)
    ensure_schema_up_to_date(engine)

setup_logger()
logger = structlog.get_logger("sg-wms")

# Configurar Rate Limiting
limiter = Limiter(key_func=get_remote_address, default_limits=[settings.RATE_LIMIT_DEFAULT])

app = FastAPI(
    title="WMS SG-BVC API",
    description="API Core para Gestión de Bodega, Vitrina y Mermas",
    version="1.0.0"
)

_UNSAFE_TENANT_HEADER_RE = re.compile(r"[\*\?\[\]\\:\x00-\x1f]")

@app.middleware("http")
async def tenant_middleware(request: Request, call_next):
    # Extraemos tenant_id desde el header (MVP) y bloqueamos metacaracteres glob / control
    tenant_id = request.headers.get("X-Tenant-ID")
    if tenant_id:
        tenant_id = tenant_id.strip()
        if len(tenant_id) > 64 or _UNSAFE_TENANT_HEADER_RE.search(tenant_id):
            return JSONResponse(
                status_code=400,
                content={"detail": "Header X-Tenant-ID contiene caracteres no permitidos o excede 64 caracteres."},
            )
    if not tenant_id:
        tenant_id = settings.DEFAULT_TENANT_ID
    current_tenant_id.set(tenant_id)
    response = await call_next(request)
    return response

@app.middleware("http")
async def add_request_id_middleware(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
    structlog.contextvars.clear_contextvars()
    structlog.contextvars.bind_contextvars(request_id=request_id)
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CRÍTICO-04: CORS restrictivo usando configuraciones
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_origin_regex=r"https://.*\.ngrok-free\.(app|dev)|https://.*\.ngrok\.(app|dev)|https://.*\.loca\.lt",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["Authorization", "Content-Type", "Accept", "ngrok-skip-browser-warning", "Bypass-Tunnel-Reminder", "X-Tenant-ID"],
)

from fastapi.exceptions import RequestValidationError

@app.exception_handler(RequestValidationError)
async def safe_validation_exception_handler(request: Request, exc: RequestValidationError):
    safe_errors = []
    for err in exc.errors():
        clean_err = {k: v for k, v in err.items() if k != "input"}
        if "ctx" in clean_err and isinstance(clean_err["ctx"], dict):
            clean_err["ctx"] = {k: str(v) for k, v in clean_err["ctx"].items()}
        safe_errors.append(clean_err)
    return JSONResponse(status_code=422, content={"detail": safe_errors})

# CRÍTICO-06: Global Exception Handler Seguro
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error("Error global no capturado", exc_info=exc, path=request.url.path, method=request.method)
    return JSONResponse(
        status_code=500,
        content={"detail": "Se produjo un error interno en el servidor."},
    )

# Registrar Routers
app.include_router(auth.router)
app.include_router(bodega.router)
app.include_router(vitrina.router)
app.include_router(vitrina.router, prefix="/api/v1")
app.include_router(merma.router)
app.include_router(merma.router, prefix="/api/v1")
app.include_router(patente.router)
app.include_router(patente.router, prefix="/api/v1")
app.include_router(catalogo.router)
app.include_router(catalogo.router, prefix="/api/v1")
app.include_router(abc.router)
app.include_router(abc.router, prefix="/api/v1")
app.include_router(tenant_settings.router)
app.include_router(tenant_settings.router, prefix="/api/v1")
app.include_router(logs.router)
app.include_router(integration.router, prefix="/api/v1/integration", tags=["Integración ERP"])  # Mantenemos el router de ASN original (mock)
app.include_router(asn.router)  # Mantenemos el router de ASN original (mock)
app.include_router(inventario.router)
app.include_router(inventario.router, prefix="/api/v1")
app.include_router(trazabilidad.router)
app.include_router(outbound.router)
app.include_router(dashboard.router)
app.include_router(mapa_bodega.router)
# Ventas: ver integration.router → /api/v1/integration/sales/{webhook,import-batch,import-file}

@app.get("/")
@limiter.limit("5/minute")
def root(request: Request):
    return {"message": "Bienvenido a la API del WMS SG-BVC (Auditoría v2)"}
