import secrets
from typing import List, Optional
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Configuración centralizada del WMS SG-BVC."""

    # ── Base de Datos ──────────────────────────────────────────
    DATABASE_URL: str
    DATABASE_POOLER_URL: Optional[str] = None
    DATABASE_READ_URL: Optional[str] = None  # Para el motor de Read Replicas (CQRS)

    DB_POOL_SIZE: int = 3
    DB_MAX_OVERFLOW: int = 7
    DB_POOL_TIMEOUT: int = 30
    DB_POOL_RECYCLE: int = 180

    # ── Caché (Redis) ──────────────────────────────────────────
    REDIS_URL: Optional[str] = "redis://localhost:6379"

    # ── Seguridad ──────────────────────────────────────────────
    JWT_SECRET_KEY: str = secrets.token_urlsafe(32)
    JWT_ALGORITHM: str = "HS256"
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = 480  # 8 horas (1 turno)
    
    # ── Integración M2M ────────────────────────────────────────
    INTEGRATION_API_KEY: Optional[str] = None # Para producción debe definirse en el entorno
    ERP_WEBHOOK_URL: Optional[str] = "http://localhost:8080/wms-webhooks" # Default para desarrollo

    # ── CORS ───────────────────────────────────────────────────
    CORS_ORIGINS: List[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
    ]

    # ── Rate Limiting ──────────────────────────────────────────
    RATE_LIMIT_DEFAULT: str = "60/minute"
    RATE_LIMIT_WRITE: str = "30/minute"
    RATE_LIMIT_AUTH: str = "5/minute"

    # ── Multi-Tenant ──────────────────────────────────────────
    DEFAULT_TENANT_ID: str = "130cc80b-1971-4332-bab3-9ee5ef66063b"

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
