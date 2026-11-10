---
name: alembic-neon-migration
description: >-
  Use this skill when modifying SQLAlchemy models in app/models.py, adding tables,
  columns, indexes, or UniqueConstraints, or setting up Alembic migrations for
  PostgreSQL (Neon Serverless).
---

# Skill: Evolución de Esquema y Migraciones en PostgreSQL (Neon Serverless)

Esta skill guía la modificación segura de [`app/models.py`](file:///c:/Users/Acer/OneDrive/Desktop/BVCore%20-%20Proyecto/app/models.py) y la ejecución de migraciones DDL en **Neon Serverless** (donde coexisten conexiones con PgBouncer y conexiones directas).

## 1. Reglas al Modificar `app/models.py`

1. **Columna `tenant_id` Obligatoria**:
   - Toda tabla de dominio debe incluir:
     ```python
     tenant_id = Column(String, ForeignKey('tenant.id'), nullable=False, index=True)
     ```
2. **Constraints de Unicidad por Tenant**:
   - Nunca usar `unique=True` suelto en columnas de negocio (`ean`, `nombre`, `external_ticket_id`). Usar siempre `UniqueConstraint` compuesto con `tenant_id`:
     ```python
     __table_args__ = (
         UniqueConstraint('tenant_id', 'campo', name='uq_<tabla>_tenant_<campo>'),
     )
     ```
3. **Timestamps con Zona Horaria (UTC)**:
   - Usar `default=lambda: datetime.now(timezone.utc)` (nunca `datetime.utcnow`, deprecado en Python 3.12+).

## 2. Particularidad de Neon Serverless: Pooler vs. Direct URL

- En [`app/core/config.py`](file:///c:/Users/Acer/OneDrive/Desktop/BVCore%20-%20Proyecto/app/core/config.py):
  - `DATABASE_POOLER_URL` apunta a **PgBouncer** (`-pooler` en el hostname de Neon), óptimo para el runtime de FastAPI (`engine`).
  - `DATABASE_URL` apunta a la conexión directa de PostgreSQL.
- **Importante para Alembic / DDL**: Las migraciones de esquema (`alembic upgrade head`) deben ejecutarse siempre contra `DATABASE_URL` (conexión directa), no contra `DATABASE_POOLER_URL`, para evitar bloqueos de sesión en PgBouncer.

## 3. Flujo con Alembic

1. En `alembic/env.py`, importar `Base` desde `app.database` y todos los modelos desde `app.models` para que `target_metadata = Base.metadata` detecte todas las tablas.
2. Configurar la URL en `alembic/env.py` usando `settings.DATABASE_URL`.
3. Generar y revisar la migración antes de aplicarla:
   ```powershell
   alembic revision --autogenerate -m "descripcion_del_cambio"
   alembic upgrade head
   ```
