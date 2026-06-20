import logging
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from app.database import engine, Base
from app.domains.wms.routers import catalogo, patente, bodega, vitrina, merma, inventario, dashboard, mapa_bodega
from app.domains.pos.routers import pos
from app.domains.auth.routers import auth, logs, auditoria
from app.domains.integration.routers import integration, asn, outbound, trazabilidad
from app.core.config import settings
from app.core.logger import setup_logger
import uuid
import structlog

# Crear tablas en BD (Idealmente usar Alembic en el futuro)
Base.metadata.create_all(bind=engine)

setup_logger()
logger = structlog.get_logger("sg-wms")

# Configurar Rate Limiting
limiter = Limiter(key_func=get_remote_address, default_limits=[settings.RATE_LIMIT_DEFAULT])

app = FastAPI(
    title="WMS SG-BVC API",
    description="API Core para Gestión de Bodega, Vitrina y Mermas",
    version="1.0.0"
)

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
    allow_headers=["Authorization", "Content-Type", "Accept", "ngrok-skip-browser-warning", "Bypass-Tunnel-Reminder"],
)

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
app.include_router(merma.router)
app.include_router(patente.router)
app.include_router(catalogo.router)
app.include_router(logs.router)
app.include_router(auditoria.router)
app.include_router(integration.router, prefix="/api/v1/integration", tags=["Integración ERP"])  # Mantenemos el router de ASN original (mock)
app.include_router(asn.router)  # Mantenemos el router de ASN original (mock)
app.include_router(inventario.router)
app.include_router(trazabilidad.router)
app.include_router(outbound.router)
app.include_router(dashboard.router)
app.include_router(mapa_bodega.router)
app.include_router(pos.router)

@app.get("/")
@limiter.limit("5/minute")
def root(request: Request):
    return {"message": "Bienvenido a la API del WMS SG-BVC (Auditoría v2)"}

