"""
app/db_migrations.py
─────────────────────────────────────────────────────────────────────────────
Sincronización Idempotente de Esquema DDL (SQLite & PostgreSQL / Neon)
─────────────────────────────────────────────────────────────────────────────
Garantiza que las columnas agregadas en Etapa 1 existan en bases de datos
preexistentes antes de ejecutar consultas ORM, complementando `create_all()`
y las migraciones formales con Alembic.
"""

import logging
from typing import List, Tuple, Union

from sqlalchemy import event, inspect, text
from sqlalchemy.engine import Connection, Engine

logger = logging.getLogger("sg-wms.migrations")

_LISTENER_REGISTERED = False


def _columnas_catalogo_producto(is_postgres: bool) -> List[Tuple[str, str]]:
    bool_false = "FALSE" if is_postgres else "0"
    return [
        ("clase_abc", "VARCHAR(8) NOT NULL DEFAULT 'B'"),
        ("es_perecible_corto", f"BOOLEAN NOT NULL DEFAULT {bool_false}"),
        ("venta_valorizada_ventana", "INTEGER NOT NULL DEFAULT 0"),
        ("unidades_vendidas_ventana", "INTEGER NOT NULL DEFAULT 0"),
        ("participacion_ventas", "FLOAT NOT NULL DEFAULT 0.0"),
        ("intervalo_medio_venta_dias", "FLOAT"),
        ("ultima_venta_at", "TIMESTAMP"),
        ("ultimo_conteo_at", "TIMESTAMP"),
        ("abc_calculado_at", "TIMESTAMP"),
        ("created_at", "TIMESTAMP"),
    ]


def _columnas_tenant(is_postgres: bool) -> List[Tuple[str, str]]:
    json_ddl = "JSONB NOT NULL DEFAULT '{}'::jsonb" if is_postgres else "JSON NOT NULL DEFAULT '{}'"
    return [
        ("settings", json_ddl),
    ]


def _columnas_venta_externa(is_postgres: bool) -> List[Tuple[str, str]]:
    bool_false = "FALSE" if is_postgres else "0"
    return [
        ("total_valorizado", "INTEGER NOT NULL DEFAULT 0"),
        ("unidades_deficit", "INTEGER NOT NULL DEFAULT 0"),
        ("es_carga_historica", f"BOOLEAN NOT NULL DEFAULT {bool_false}"),
        ("estado_procesamiento", "VARCHAR(24) NOT NULL DEFAULT 'COMPLETO'"),
        ("items_huerfanos_count", "INTEGER NOT NULL DEFAULT 0"),
        ("revertido_por", "VARCHAR(128)"),
        ("revertido_at", "TIMESTAMP"),
        ("motivo_reversion", "TEXT"),
        ("fecha_venta_dt", "TIMESTAMP"),
    ]


def _apply_ddl_on_connection(conn: Connection) -> None:
    inspector = inspect(conn)
    tablas = set(inspector.get_table_names())
    is_postgres = conn.dialect.name == "postgresql"

    if "tenant" in tablas:
        existentes_t = {col["name"] for col in inspector.get_columns("tenant")}
        for col_name, col_ddl in _columnas_tenant(is_postgres):
            if col_name not in existentes_t:
                conn.execute(text(f"ALTER TABLE tenant ADD COLUMN {col_name} {col_ddl}"))
                logger.info("[migrations] Columna agregada: tenant.%s", col_name)

    if "catalogo_producto" in tablas:
        existentes_cat = {col["name"] for col in inspector.get_columns("catalogo_producto")}
        for col_name, col_ddl in _columnas_catalogo_producto(is_postgres):
            if col_name not in existentes_cat:
                conn.execute(text(f"ALTER TABLE catalogo_producto ADD COLUMN {col_name} {col_ddl}"))
                logger.info("[migrations] Columna agregada: catalogo_producto.%s", col_name)

    if "venta_externa" in tablas:
        existentes_ve = {col["name"] for col in inspector.get_columns("venta_externa")}
        for col_name, col_ddl in _columnas_venta_externa(is_postgres):
            if col_name not in existentes_ve:
                conn.execute(text(f"ALTER TABLE venta_externa ADD COLUMN {col_name} {col_ddl}"))
                logger.info("[migrations] Columna agregada: venta_externa.%s", col_name)
        conn.execute(
            text("CREATE INDEX IF NOT EXISTS idx_venta_externa_fecha_dt ON venta_externa (fecha_venta_dt)")
        )


def ensure_schema_up_to_date(target_engine: Union[Engine, Connection]) -> None:
    """
    Inspecciona el motor o conexión dada con `sqlalchemy.inspect` y aplica
    `ALTER TABLE ... ADD COLUMN` de forma 100% idempotente para cualquier
    columna nueva faltante en `catalogo_producto` y `venta_externa`.
    Compatible con SQLite y PostgreSQL (Neon Serverless).
    """
    if isinstance(target_engine, Connection):
        _apply_ddl_on_connection(target_engine)
    else:
        with target_engine.begin() as conn:
            _apply_ddl_on_connection(conn)


def register_metadata_auto_upgrade(metadata) -> None:
    """
    Engancha `ensure_schema_up_to_date` tras `Base.metadata.create_all(...)`
    para que archivos SQLite o esquemas preexistentes en tests/entornos locales
    se actualicen automáticamente sin intervención manual.
    """
    global _LISTENER_REGISTERED
    if _LISTENER_REGISTERED:
        return

    @event.listens_for(metadata, "after_create")
    def _after_create_upgrade(target, connection, **kw):
        _apply_ddl_on_connection(connection)

    _LISTENER_REGISTERED = True
