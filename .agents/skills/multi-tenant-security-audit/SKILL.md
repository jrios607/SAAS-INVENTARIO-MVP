---
name: multi-tenant-security-audit
description: >-
  Use this skill when auditing or modifying multi-tenant isolation, SQLAlchemy
  do_orm_execute filters, Redis/in-memory cache keys, JWT/RBAC authentication,
  or M2M API Key and HMAC webhook security in SG-BVC.
---

# Skill: Auditoría de Aislamiento Multi-Tenant y Seguridad

**SG-BVC** opera bajo un modelo SaaS B2B Multi-Tenant con **Row-Level Security (RLS) lógico de 5 capas** más aislamiento de caché.

## 1. Checklist de las 5 Capas de Aislamiento de Datos

1. **Capa 1 — Header HTTP (`X-Tenant-ID`)**:
   - [`tenant_middleware`](file:///c:/Users/Acer/OneDrive/Desktop/BVCore%20-%20Proyecto/app/main.py#L36-L44) extrae `X-Tenant-ID` (o usa `settings.DEFAULT_TENANT_ID` en desarrollo) y lo asigna a `current_tenant_id`.
2. **Capa 2 — ContextVar (`current_tenant_id`)**:
   - Definida en [`app/core/tenant.py`](file:///c:/Users/Acer/OneDrive/Desktop/BVCore%20-%20Proyecto/app/core/tenant.py). En workers Celery ([`app/worker/tasks.py`](file:///c:/Users/Acer/OneDrive/Desktop/BVCore%20-%20Proyecto/app/worker/tasks.py)), toda tarea debe llamar a `_set_tenant_context(tenant_id)`.
3. **Capa 3 — Filtro Global SELECT (`do_orm_execute`)**:
   - En [`app/database.py`](file:///c:/Users/Acer/OneDrive/Desktop/BVCore%20-%20Proyecto/app/database.py#L204-L215), `_add_tenant_filter` inyecta `with_loader_criteria` para filtrar `cls.tenant_id == tenant_id` en todas las consultas ORM.
   - **Alerta**: Nunca ejecutar SQL crudo (`db.execute(text("SELECT ..."))`) sin incluir explícitamente `WHERE tenant_id = :tenant_id`.
4. **Capa 4 — Auto-Asignación en INSERT (`before_insert`)**:
   - `_set_tenant_id` asigna automáticamente `target.tenant_id = current_tenant_id.get()` si no fue especificado.
5. **Capa 5 — Esquema y Constraints en Base de Datos**:
   - Toda tabla de negocio debe tener `tenant_id NOT NULL` y `UniqueConstraint('tenant_id', '<campo_unico>')`.

## 2. Prevención de Cross-Tenant Cache Poisoning

- **Redis ([`app/core/cache.py`](file:///c:/Users/Acer/OneDrive/Desktop/BVCore%20-%20Proyecto/app/core/cache.py))**:
  - Todas las funciones (`cache_get`, `cache_set`, `cache_delete`, `cache_delete_pattern`) pasan por `_scoped_key(key)`, transformando `sg:<ns>:<key>` en `sg:t:<tenant_id>:<ns>:<key>`.
  - Nunca llamar al cliente Redis directo (`_get_redis().get(...)`) saltándose `_scoped_key()`.
- **Memoria ([`app/services/catalogo_service.py`](file:///c:/Users/Acer/OneDrive/Desktop/BVCore%20-%20Proyecto/app/services/catalogo_service.py))**:
  - Toda caché en memoria (`TTLCache`) debe construir su clave con `_catalogo_cache_key()` (`f"all_products:{tenant_id}"`).

## 3. Autenticación Dual: JWT/RBAC (`AUTH_REQUIRED`) y M2M (`X-API-Key`)

- **Usuarios Humanos (`JWT` en [`app/core/security.py`](file:///c:/Users/Acer/OneDrive/Desktop/BVCore%20-%20Proyecto/app/core/security.py))**:
  - Controlado por `settings.AUTH_REQUIRED` (`False` en desarrollo MVP, `True` en producción).
  - Cuando se envía un token Bearer, `get_current_user` verifica:
    1. Firma y expiración del JWT.
    2. Que `payload["tenant_id"] == current_tenant_id.get()` (devuelve `403 Forbidden` si alguien intenta usar un token del Tenant A con un header `X-Tenant-ID` del Tenant B).
    3. Que el usuario exista dentro del tenant activo.
- **Integraciones M2M (`X-API-Key`)**:
  - `verify_api_key` compara `X-API-Key` contra `settings.INTEGRATION_API_KEY` usando `hmac.compare_digest` (tiempo constante).

## 4. Verificación Automatizada

```powershell
pytest tests/test_omni_pos_and_multitenant.py -v
```
