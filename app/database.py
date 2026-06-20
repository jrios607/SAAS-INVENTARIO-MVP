"""
app/database.py
─────────────────────────────────────────────────────────────────────────────
CQRS Lite — Database Layer con Read/Write Routing Automático
─────────────────────────────────────────────────────────────────────────────
Arquitectura implementada:

  ┌─────────────────────────────────────────────────────────┐
  │                  SQLAlchemy Session Layer                │
  │                                                         │
  │  ┌─────────────────┐      ┌──────────────────────────┐  │
  │  │  RoutingSession │──────│  execute() interceptado  │  │
  │  │  (auto-detect)  │      │  analiza el SQL statement│  │
  │  └────────┬────────┘      └──────────────────────────┘  │
  │           │                                             │
  │     ┌─────┴──────┐                                      │
  │     │  ¿Mutar?   │                                      │
  │     └──┬──────┬──┘                                      │
  │    SÍ  │      │  NO                                     │
  │        ▼      ▼                                         │
  │   engine   engine_read                                   │
  │  (Primary)  (Replica)                                   │
  └─────────────────────────────────────────────────────────┘

Estrategia de routing:
  • INSERT / UPDATE / DELETE / MERGE  → engine (Primary Writer / Neon Main)
  • SELECT puro                       → engine_read (Read Replica / Neon Branch)
  • Fallback: si DATABASE_READ_URL no está configurada, engine_read = engine
    (modo desarrollo/single-node transparente).

Dependencias FastAPI:
  get_db()       → RoutingSession completa (escribe en primary, lee en replica)
  get_db_read()  → Sesión explícita solo lectura (backward-compat + semántica
                   clara para endpoints analíticos como el Dashboard Gerencial)

IMPORTANTE — Limitación de RoutingSession:
  Si una transacción realiza primero un INSERT y luego un SELECT sobre la
  misma sesión, ambas operaciones irán al Primary para garantizar
  consistencia Read-Your-Writes. El routing solo cambia engine cuando la
  sesión NO tiene una transacción activa de escritura.
"""

import logging
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import sessionmaker, declarative_base, Session
from app.core.config import settings

logger = logging.getLogger("sg-wms.database")

# ── MOTOR DE ESCRITURA (Primary Writer / Neon Main Branch) ────────────────
_db_url = settings.DATABASE_POOLER_URL or settings.DATABASE_URL

engine = create_engine(
    _db_url,
    pool_pre_ping=True,
    pool_size=settings.DB_POOL_SIZE,
    max_overflow=settings.DB_MAX_OVERFLOW,
    pool_timeout=settings.DB_POOL_TIMEOUT,
    pool_recycle=settings.DB_POOL_RECYCLE,
    pool_use_lifo=True,          # Reusar conexiones calientes (óptimo para PgBouncer)
    connect_args={"options": "-c timezone=utc"},
)

# ── MOTOR DE LECTURA (Read Replica / Neon Read Replica Branch) ────────────────────
# IMPORTANTE: Si DATABASE_READ_URL no está configurada, reusar el mismo
# objeto engine (no crear uno nuevo con la misma URL). Dos engines con la
# misma URL duplican el pool de conexiones, agotando los límites de
# Neon Serverless (~10 conexiones en free tier).
if settings.DATABASE_READ_URL:
    engine_read = create_engine(
        settings.DATABASE_READ_URL,
        pool_pre_ping=True,
        pool_size=settings.DB_POOL_SIZE,
        max_overflow=settings.DB_MAX_OVERFLOW,
        pool_timeout=settings.DB_POOL_TIMEOUT,
        pool_recycle=settings.DB_POOL_RECYCLE,
        pool_use_lifo=True,
        connect_args={"options": "-c timezone=utc"},
    )
else:
    # Single-node: Read Replica = Primary (mismo objeto, mismo pool)
    engine_read = engine

# ── Pool hygiene: rollback al devolver conexión ─────────────────────────────────
@event.listens_for(engine, "checkin")
def _reset_on_return(dbapi_conn, connection_record):
    dbapi_conn.rollback()

# Solo registrar el evento de checkin en engine_read si es un objeto distinto
if engine_read is not engine:
    @event.listens_for(engine_read, "checkin")
    def _reset_on_return_read(dbapi_conn, connection_record):
        dbapi_conn.rollback()

# ── Log de configuración al arrancar ──────────────────────────────────────
_is_split = engine_read is not engine
if _is_split:
    logger.info("[CQRS] Read/Write Routing ACTIVO: Primary=%s | Read Replica configurada", engine.url.host)
else:
    logger.warning("[CQRS] Modo SINGLE-NODE activo (DATABASE_READ_URL no definida). "
                   "Define DATABASE_READ_URL en .env para activar el Read Replica.")


# ── RoutingSession ────────────────────────────────────────────────────────

class RoutingSession(Session):
    """
    Sesión SQLAlchemy que enruta automáticamente READ vs WRITE.

    Lógica de detección:
      • Se inspecciona si la sesión tiene transacciones de escritura pendientes
        (_flushing) o si hay objetos en estado 'dirty' / 'new'.
      • Si es una sesión "limpia" y el statement comienza con SELECT,
        se usa el engine de lectura.
      • En cualquier otro caso (o si hay escrituras pendientes), se usa el Primary.

    Esta implementación es compatible con el uso estándar de SQLAlchemy ORM
    (db.query(...), db.add(...), db.commit()) sin necesidad de anotaciones
    especiales en los routers existentes.
    """

    def get_bind(self, mapper=None, clause=None, **kwargs):
        """
        Override del método de binding de SQLAlchemy.
        Determina qué engine usar basado en el tipo de operación.
        """
        # Si hay escrituras pendientes en la sesión → forzar Primary
        # (garantiza consistencia Read-Your-Writes dentro de una transacción)
        if self._flushing or self.new or self.dirty or self.deleted:
            logger.debug("DB BIND → PRIMARY (dirty session / mutation context)")
            return engine

        # Inspeccionar el clause (statement SQL) si está disponible
        if clause is not None:
            # Obtener el texto de la cláusula para clasificarla
            clause_type = type(clause).__name__.upper()

            # Operaciones de escritura → Primary
            WRITE_TYPES = {"INSERT", "UPDATE", "DELETE", "MERGE"}
            if any(wt in clause_type for wt in WRITE_TYPES):
                logger.debug("DB BIND → PRIMARY (clause_type=%s)", clause_type)
                return engine

            # SELECT puro en sesión limpia → Read Replica
            if "SELECT" in clause_type:
                logger.debug("DB BIND → REPLICA (clause_type=%s)", clause_type)
                return engine_read

        # Default: Primary (safe fallback)
        return engine


# ── Fábricas de Sesiones ──────────────────────────────────────────────────

# Sesión de enrutamiento automático (CQRS Lite)
# Usada por get_db() → la mayoría de los routers
RoutingSessionLocal = sessionmaker(
    class_=RoutingSession,
    autocommit=False,
    autoflush=False,
)

# Sesión explícita de solo lectura (backward-compat + Dashboard Gerencial)
SessionLocalRead = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine_read
)

# Sesión directa al Primary — para uso de workers Celery
# Los workers son procesos externos a Uvicorn y siempre escriben
# en el Primary (Integration_Log, audit entries).
SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine
)

# Base ORM
Base = declarative_base()


# ── Dependencias FastAPI ──────────────────────────────────────────────────

def get_db():
    """
    Dependencia principal.
    Inyecta una RoutingSession con enrutamiento automático READ/WRITE.
    
    Uso en routers:
        db: Session = Depends(get_db)
    
    → SELECTs van a Read Replica.
    → INSERTs/UPDATEs/DELETEs van a Primary.
    → La misma sesión mantiene consistencia transaccional.
    """
    db = RoutingSessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_db_read():
    """
    Dependencia explícita de solo lectura.
    Garantiza que NUNCA se use el Primary, incluso accidentalmente.
    Ideal para:
      - Dashboard Gerencial (queries analíticas pesadas)
      - Reportes y exports
      - Cualquier endpoint anotado explícitamente como "read-only"

    Uso en routers:
        db: Session = Depends(get_db_read)
    """
    db = SessionLocalRead()
    try:
        yield db
    finally:
        db.close()