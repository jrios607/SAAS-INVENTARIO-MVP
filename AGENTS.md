# Reglas de Gobernanza y Orquestación Multi-Agente — SG-BVC (WMS v2.0)

Este documento define las reglas inquebrantables de arquitectura, seguridad Multi-Tenant y orquestación de subagentes para el repositorio **SG-BVC (Sistema de Gestión de Bodegas, Vitrina y Control de Mermas)**.

---

## 1. Protocolo del Agente Orquestador Principal

Cuando el agente principal reciba tareas complejas, de múltiples capas o auditorías, debe actuar como **Orquestador** delegando el trabajo mediante `define_subagent` / `invoke_subagent` en los siguientes 8 perfiles especializados:

### 1.1 Perfiles de Arquitectura e Implementación
1. **`wms-backend-architect` (Backend, CQRS, FEFO y Celery)**:
   - Responsable de [`app/domains/`](file:///c:/Users/Acer/OneDrive/Desktop/BVCore%20-%20Proyecto/app/domains), [`app/services/`](file:///c:/Users/Acer/OneDrive/Desktop/BVCore%20-%20Proyecto/app/services), [`app/database.py`](file:///c:/Users/Acer/OneDrive/Desktop/BVCore%20-%20Proyecto/app/database.py), [`app/core/cache.py`](file:///c:/Users/Acer/OneDrive/Desktop/BVCore%20-%20Proyecto/app/core/cache.py) y [`app/worker/`](file:///c:/Users/Acer/OneDrive/Desktop/BVCore%20-%20Proyecto/app/worker).
   - Consulta: `scaffold-domain-endpoint`, `fefo-and-locking-audit` y `omni-pos-sales-ingestion`.
2. **`tenant-security-auditor` (Aislamiento Multi-Tenant, Caché y Seguridad)**:
   - Responsable de [`app/core/security.py`](file:///c:/Users/Acer/OneDrive/Desktop/BVCore%20-%20Proyecto/app/core/security.py), [`app/core/tenant.py`](file:///c:/Users/Acer/OneDrive/Desktop/BVCore%20-%20Proyecto/app/core/tenant.py), hooks ORM en [`app/database.py`](file:///c:/Users/Acer/OneDrive/Desktop/BVCore%20-%20Proyecto/app/database.py) y validación HMAC/API-Key en integraciones.
   - Consulta: `multi-tenant-security-audit`.
3. **`wms-frontend-specialist` (Next.js 14, Gemelo Digital 2D y Offline Sync)**:
   - Responsable de [`frontend/src/`](file:///c:/Users/Acer/OneDrive/Desktop/BVCore%20-%20Proyecto/frontend/src), el lienzo 2D SVG/DOM nativo ([`frontend/src/app/patentes/page.tsx`](file:///c:/Users/Acer/OneDrive/Desktop/BVCore%20-%20Proyecto/frontend/src/app/patentes/page.tsx)), sincronización offline de picking ([`useOfflineSync.ts`](file:///c:/Users/Acer/OneDrive/Desktop/BVCore%20-%20Proyecto/frontend/src/hooks/useOfflineSync.ts)) y cliente HTTP ([`api.ts`](file:///c:/Users/Acer/OneDrive/Desktop/BVCore%20-%20Proyecto/frontend/src/services/api.ts)).
   - Consulta: `contract-sync-api-frontend`.
4. **`qa-concurrency-tester` (Testing Automatizado y Condiciones de Carrera)**:
   - Responsable de verificar descuentos FEFO concurrentes, idempotencia de ventas externas/ASN y ausencia de fugas de datos entre tenants en [`tests/`](file:///c:/Users/Acer/OneDrive/Desktop/BVCore%20-%20Proyecto/tests).

### 1.2 Perfiles de Automatización, Resiliencia y Verificación Rigurosa
5. **`hardware-offline-tester` (Dispositivos, Cámara POS Express y Resiliencia Offline)**:
   - Responsable de auditar la estabilidad de la cámara web/móvil con `@zxing/library`, lectura en ráfaga de pistolas láser/USB, almacenamiento en `IndexedDB` y reconciliación de picking cuando se interrumpe la conexión a internet.
   - Garantiza que ninguna venta o picking se pierda ni duplique ante caídas de red o fallos de dispositivo.
6. **`chaos-fefo-auditor` (Caos Logístico, Mermas Extremas y Cadena de Frío)**:
   - Responsable de inyectar escenarios adversos en el inventario: intentos de stock negativo, lotes caducados movidos a vitrina, violación de temperaturas (`CONGELADO` en góndola seca), particiones erróneas de SATO Padre $\rightarrow$ Hijos y mermas por merma/destrucción.
   - Verifica que el motor de inventario lance excepciones controladas y jamás corrompa el balance de stock.
7. **`load-stress-tester` (Pruebas de Carga, Saturación Omni-POS y Benchmark Gemelo 2D)**:
   - Responsable de simular ráfagas masivas de venta (50 a 100 tickets/segundo) evaluando el pool de conexiones PostgreSQL (Neon), la latencia de Redis y la estabilidad a 60/120 FPS del lienzo SVG al cargar cientos de góndolas.
8. **`contract-sentinel` (Vigilancia de Contratos OpenAPI ↔ TypeScript y Anti-Drift)**:
   - Responsable de comparar de forma automatizada los modelos Pydantic v2 expuestos en `/openapi.json` con las interfaces TypeScript en [`frontend/src/services/api.ts`](file:///c:/Users/Acer/OneDrive/Desktop/BVCore%20-%20Proyecto/frontend/src/services/api.ts).
   - Bloquea cualquier cambio en backend o frontend que altere nombres de campos, tipos o parámetros obligatorios sin sincronización previa.

---

## 2. Invariantes de Dominio y Arquitectura (Obligatorios)

### 2.1 Sin POS Caja Propio — Integración Omni-POS
- **SG-BVC NO incluye una terminal de caja propia.** Nunca recrear rutas `/pos` interactivas de cajero.
- Toda salida de stock por venta proviene de **Puntos de Venta (POS) externos** a través de [`app/services/external_sales_service.py`](file:///c:/Users/Acer/OneDrive/Desktop/BVCore%20-%20Proyecto/app/services/external_sales_service.py) y los endpoints en [`app/domains/integration/routers/integration.py`](file:///c:/Users/Acer/OneDrive/Desktop/BVCore%20-%20Proyecto/app/domains/integration/routers/integration.py):
  - **POS con API Key**: `POST /api/v1/integration/sales/webhook` (`X-API-Key` + `Idempotency-Key`).
  - **POS sin API Key (Legacy)**: `POST /api/v1/integration/sales/import-file` (`.csv`, `.txt`, `.json`) y `POST /api/v1/integration/sales/import-batch`.

### 2.2 Separación DDD y CQRS Lite
- **Routers Thin**: Los routers en `app/domains/{wms,auth,integration}/routers/` solo validan HTTP/RBAC, invocan funciones de `app/services/`, manejan `db.commit()` / `db.rollback()` e invalidan caché.
- **Read/Write Routing**:
  - Usar `db: Session = Depends(get_db_read)` en endpoints puramente analíticos o de consulta (`GET`).
  - Usar `db: Session = Depends(get_db)` en endpoints transaccionales (`POST`, `PUT`, `PATCH`, `DELETE`).
  - En [`RoutingSession`](file:///c:/Users/Acer/OneDrive/Desktop/BVCore%20-%20Proyecto/app/database.py#L120-L185), toda consulta con `.with_for_update()` se enruta siempre al nodo `Primary`.

### 2.3 Aislamiento Multi-Tenant (5 Capas + Caché)
- **Modelos ORM**: Toda nueva tabla de negocio en [`app/models.py`](file:///c:/Users/Acer/OneDrive/Desktop/BVCore%20-%20Proyecto/app/models.py) DEBE definir `tenant_id = Column(String, ForeignKey('tenant.id'), nullable=False, index=True)` y declarar sus restricciones de unicidad compuestas con `tenant_id` (`UniqueConstraint('tenant_id', ...)`).
- **Caché Redis y Memoria**:
  - En Redis, usar exclusivamente los helpers de [`app/core/cache.py`](file:///c:/Users/Acer/OneDrive/Desktop/BVCore%20-%20Proyecto/app/core/cache.py) (`cache_get`, `cache_set`, `cache_delete`, `cache_delete_pattern`), los cuales aplican `_scoped_key()` (`sg:t:{tenant_id}:*`).
  - Prohibido crear cachés en memoria (`TTLCache`, `@lru_cache`, dicts globales) sin incluir `current_tenant_id.get()` en la clave.
- **Workers Celery**: Toda tarea en [`app/worker/tasks.py`](file:///c:/Users/Acer/OneDrive/Desktop/BVCore%20-%20Proyecto/app/worker/tasks.py) debe recibir `tenant_id: str` como argumento y llamar a `_set_tenant_context(tenant_id)` antes de abrir una sesión de base de datos.

### 2.4 Operaciones sobre `Sato` (FEFO, Bloqueo Pesimista y Trazabilidad)
- Todo descuento o movimiento de stock sobre `Sato` debe:
  1. Adquirir bloqueo de fila con `.with_for_update()`.
  2. Cuando se descuenta por producto (`SKU`), ordenar de forma determinista por `(Sato.fecha_vencimiento.asc().nulls_last(), Sato.sato_id.asc())` para cumplir **FEFO** y prevenir deadlocks.
  3. Cambiar `sato.estado = "Agotado"` cuando `sato.cantidad == 0`.
  4. Insertar un registro en `Log_Transaccional` dentro de la misma transacción.
  5. Invalidar la caché del tenant (`invalidar_stock_y_kpis()` o helper específico) **después** de `db.commit()`.
