# Informe Introductorio del Proyecto SG-BVC
## Sistema de Gestión de Bodegas, Vitrina, Caja y Control de Mermas

**Versión del sistema:** 2.0 (Multi-Tenant / SaaS B2B)  
**Stack principal:** FastAPI · PostgreSQL (Neon) · Redis · Next.js 14 · TypeScript  
**Modelo de negocio:** SaaS B2B orientado a retail (supermercados, tiendas, farmacias)  
**Arquitectura:** REST API + Dominio Driven Design (DDD) + CQRS Lite + EDA (Event-Driven)

---

## 1. Propósito del Sistema

**SG-BVC** es un **Warehouse Management System (WMS)** con **Point of Sale (POS)** integrado, diseñado para digitalizar y optimizar las operaciones logísticas y de venta de establecimientos retail en Latinoamérica.

### Problema que resuelve

Los supermercados, tiendas y bodegas medianas carecen de herramientas asequibles para:
- **Controlar stock físico** con trazabilidad por lote y vencimiento (FEFO)
- **Gestionar el flujo de productos** desde recepción → bodega → vitrina → caja
- **Reducir mermas** con evidencia digital y causa raíz
- **Conectarse con ERPs** externos para sincronizar movimientos de inventario
- **Operar en modo degradado** (offline) cuando la red falla

### Objetivos de negocio
1. Ser un WMS/POS como servicio (SaaS) que distintas empresas (tenants) usen en la misma plataforma.
2. Cubrir el ciclo operativo completo: **ASN → Recepción → Bodega → Slotting → Vitrina → POS → Merma → ERP**.
3. Servir como producto de software para PYMEs logísticas, supermercados independientes y cadenas de farmacias.

---

## 2. Arquitectura General

```
Frontend (Next.js 14 / TypeScript)
  │  ↕ HTTP REST + X-Tenant-ID header
  ▼
Backend API (FastAPI / Python 3.11)
  │
  ├── Middleware: tenant_middleware (ContextVar por request)
  ├── Middleware: add_request_id_middleware (correlación de logs)
  ├── Rate Limiter (SlowAPI)
  ├── CORS restrictivo (allow_headers incluyendo X-Tenant-ID)
  │
  ├── Domain: WMS     (bodega, vitrina, merma, catálogo, mapa, inventario, dashboard)
  ├── Domain: Auth    (autenticación JWT, logs, auditoría)
  ├── Domain: POS     (escaneo, checkout FEFO, sync offline)
  ├── Domain: Integration (ERP↔WMS, ASN, outbound/picking, trazabilidad)
  │
  ├── Services Layer  (lógica de negocio, desacoplada de routers)
  ├── Database Layer  (SQLAlchemy ORM + CQRS Lite: Primary + Read Replica)
  └── Cache Layer     (Redis distribuido, fail-open, TTL por dominio)

Workers Celery (EDA)
  ├── Queue: sg.integration.erp  → Webhooks al ERP (backoff exponencial)
  └── Queue: sg.integration.dlq  → Dead Letter Queue (intervención manual)

Database
  ├── PostgreSQL - Neon (Primary para escrituras)
  └── PostgreSQL - Neon (Read Replica para lecturas analíticas)
```

---

## 3. Stack Tecnológico

| Capa | Tecnología | Razón |
|---|---|---|
| **API** | FastAPI (Python 3.11) | Alto rendimiento async, tipado, docs automáticas |
| **ORM** | SQLAlchemy | CQRS Lite, filtros multi-tenant a nivel engine |
| **Base de datos** | PostgreSQL (Neon Serverless) | Serverless, escalable, sin servidor dedicado |
| **Caché** | Redis | TTL por dominio, pub/sub, idempotencia |
| **Task Queue** | Celery + Redis broker | Webhooks ERP, backoff exponencial, DLQ |
| **Frontend** | Next.js 14 + TypeScript | SSR, App Router, soporte PWA |
| **Estilos** | Tailwind CSS | Utilidades + componentes reutilizables |
| **Gráficos** | Recharts / D3 | Dashboard KPIs y ocupación |
| **Auth** | JWT (HS256) + bcrypt | Token de 8 horas (1 turno operativo) |
| **Logging** | structlog + JSON | Correlación por request_id, JSON parseable |
| **Rate Limit** | SlowAPI | Protección por IP, configurable por ruta |
| **Validaciones** | Pydantic v2 | Schemas tipo-safe entre API y BD |

---

## 4. Modelo de Datos (Base de Datos)

Todas las tablas implementan **Row-Level Security lógica** mediante la columna `tenant_id NOT NULL`, con filtrado automático global aplicado via evento SQLAlchemy `do_orm_execute`.

### 4.1 Tablas Principales

#### `tenant` — Empresas del sistema (multi-tenancy)
| Campo | Tipo | Descripción |
|---|---|---|
| `id` | String (UUID) | PK |
| `nombre` | String UNIQUE | Nombre de la empresa |

#### `catalogo_producto` — Catálogo maestro de productos
| Campo | Tipo | Descripción |
|---|---|---|
| `sku` | String (PK) | Código interno del producto |
| `nombre` | String | Nombre del producto |
| `ean` | String (indexed) | Código de barras estándar EAN-13 |
| `categoria_id` | Int FK | Categoría del producto |
| `familia`, `sub_familia` | String | Agrupación jerárquica |
| `proveedor_marca` | String | Proveedor o marca |
| `controla_vencimiento` | Boolean | Si el producto requiere control FEFO |
| `tolerancia_vencimiento_dias` | Int | Días mínimos de vida útil al recepcionar |
| `precio` | Int | Precio de venta (para POS) |

**UniqueConstraint:** `(tenant_id, ean)` — dos tenants pueden tener el mismo EAN sin colisionar.

#### `satos` — Stock Actual Total de Operaciones (Unidad atómica de inventario)
| Campo | Tipo | Descripción |
|---|---|---|
| `sato_id` | UUID (PK) | Identificador único |
| `padre_id` | UUID FK (self) | Para estructura contenedor → hijos |
| `tipo_sato` | String | `"PRODUCTO"` o `"CONTENEDOR"` (pallet LPN) |
| `lpn` | String | License Plate Number del pallet |
| `sku` | String FK | Producto asociado |
| `ubicacion_id` | String FK → `patente` | Ubicación física actual |
| `lote`, `fecha_vencimiento` | String/Date | Datos FEFO |
| `cantidad` | Int | Unidades disponibles |
| `estado` | String | `Bodega`, `Bodega Recepcion`, `Vitrina`, `Vendido` |
| `nivel_estante`, `frente_posicion` | Int | Coordenadas micro-slotting (planograma) |

#### `patente` — Ubicaciones físicas (góndolas, cámaras, bodegas)
| Campo | Tipo | Descripción |
|---|---|---|
| `id_patente` | String (PK) | Código de la ubicación (ej: "485") |
| `area_pasillo` | String | Área o pasillo (ej: "AREA 20") |
| `tipo_mueble` | String | `Gondola`, `Vitrina Frío`, etc. |
| `tipo_ubicacion` | String | `SALA_VENTA`, `BODEGA_SECOS`, `CAMARA_FRIO`, `CAMARA_CONGELADOS` |
| `coordenada_x/y` | Int | Posición en el mapa 2D (plano digital) |
| `ancho`, `largo`, `rotacion` | Int/Float | Dimensiones para el gemelo digital |
| `productos_asignados` | JSON | Planograma: SKUs asignados a esta góndola |
| `submapeo_grid` | JSON | Grid de micro-posiciones internas |

#### `log_transaccional` — Trazabilidad de todas las acciones
| Campo | Tipo | Descripción |
|---|---|---|
| `sato_id` | UUID FK | SATO afectado |
| `usuario_id` | Int FK | Quién realizó la acción |
| `accion` | String | Tipo de evento (ver catálogo de acciones) |
| `fecha_hora` | DateTime | Timestamp UTC |
| `detalles` | String | Descripción adicional |

**Acciones registradas:** `CREACION_INGRESO_BODEGA`, `CREACION_INGRESO_LPN`, `FRACCION_PARA_VITRINA`, `MOVIMIENTO_VITRINA`, `MERMA_DECLARADA`, `DECLARACION_FALTANTE_PICKING`, `VENTA_POS_CONSOLIDADA`, `AJUSTE_INVENTARIO`

#### `usuario` — Usuarios por tenant
| Campo | Tipo | Descripción |
|---|---|---|
| `id` | Int (PK) | Auto-incremental |
| `nombre` | String | Nombre de usuario |
| `password_hash` | String | Hash bcrypt |
| `rol` | String | `Operario`, `Supervisor`, `Admin` |

**UniqueConstraint:** `(tenant_id, nombre)` — dos tenants pueden tener un usuario "admin".

#### `asn_padre` / `asn_detalle` — Advance Shipment Notices (ASN inbound del ERP)
- `asn_padre`: LPN esperado, proveedor, estado (`EN_TRANSITO` → `RECEPCIONADO`)
- `asn_detalle`: SKU, cantidad esperada, lote, fecha de vencimiento

#### `ola_picking` / `pedido_outbound` / `detalle_pedido` / `tarea_picking` — Outbound WMS
- Gestión de pedidos hacia clientes
- Generación de olas de picking con optimización de rutas
- Tareas individuales de extracción por operario

#### `integration_log` — Outbox de webhooks ERP
| Estado | Descripción |
|---|---|
| `PENDING` | Creado, esperando ser encolado en Celery |
| `RETRYING` | En reintento (backoff exponencial) |
| `SUCCESS` | Entregado exitosamente al ERP |
| `DEAD_LETTER` | Todos los reintentos agotados — requiere intervención manual |
| `FAILED` | Sin ERP URL configurada |

#### `decoracion_plano` — Elementos visuales del mapa 2D
- Etiquetas de texto, zonas coloreadas, anotaciones sobre el plano digital de la bodega

---

## 5. Dominios y Endpoints de la API

### 5.1 Autenticación (`/auth`)

| Método | Ruta | Función | Roles |
|---|---|---|---|
| POST | `/auth/login` | Genera JWT (8 horas, 1 turno) | Público |
| GET | `/auth/me` | Datos del usuario autenticado | Cualquiera con token |

**Flujo:** `OAuth2PasswordRequestForm` → verificar bcrypt → `JWT HS256` en payload `{sub: user_id, rol: rol}`.

---

### 5.2 WMS — Bodega y Recepción (`/bodega`)

| Método | Ruta | Función | Roles |
|---|---|---|---|
| POST | `/bodega/recepcion/pallet` | Recepciona producto por escaneo GS1-128 | Operario+ |
| POST | `/bodega/recepcion/lpn` | Recepciona pallet consolidado (LPN) + ASN matching | Operario+ |
| GET | `/bodega/recepcion/satos` | Lista SATOs en área de recepción | Público |
| GET | `/bodega/satos/disponibles` | Lista SATOs listos para ir a vitrina | Público |
| POST | `/bodega/satos/{sato_id}/ajuste` | Ajuste manual de inventario | Admin/Supervisor |

**Funcionalidad clave:**
- **GS1-128 Parsing** (`app/core/utils.py`): Decodifica barcodes estándar GS1 extrayendo EAN, cantidad, lote y fecha de vencimiento.
- **Validación FEFO en Recepción**: Si el producto `controla_vencimiento`, verifica que los días de vida útil restante superen la `tolerancia_vencimiento_dias` del catálogo. Rechaza automáticamente productos próximos a vencer.
- **ASN Matching**: Al recibir un LPN, busca el ASN preexistente del ERP y crea automáticamente los SATOs hijos.

---

### 5.3 WMS — Vitrina y Slotting (`/vitrina`)

| Método | Ruta | Función | Roles |
|---|---|---|---|
| POST | `/vitrina/fraccionar` | Fracciona un SATO de bodega → crea hijo para vitrina | Operario+ |
| PUT | `/vitrina/{sato_id}/mover_a_vitrina` | Mueve un SATO a góndola con coordenadas exactas | Operario+ |

**Funcionalidad clave:**
- **Fraccionamiento**: Un SATO padre de N unidades puede dividirse; se crea un SATO hijo con la cantidad a mover y el padre reduce su stock.
- **Micro-Slotting**: Al mover a vitrina se registra `nivel_estante` y `frente_posicion` — coordenadas dentro de la góndola (planograma).

---

### 5.4 WMS — Merma y Control de Pérdidas (`/merma`)

| Método | Ruta | Función | Roles |
|---|---|---|---|
| POST | `/merma/declarar` | Declara merma sobre un SATO (reduce stock) | Admin/Supervisor |

**Funcionalidad:** Registra la acción `MERMA_DECLARADA` en el log, descuenta unidades del SATO, y opcionalmente emite evento al ERP via Celery.

---

### 5.5 WMS — Catálogo de Productos (`/catalogo`)

| Método | Ruta | Función | Roles |
|---|---|---|---|
| GET | `/catalogo/productos` | Lista todos los productos (cacheado Redis 1h) | Público |
| GET | `/catalogo/stock-agrupado` | Stock jerárquico por familia/subfamilia | Público |
| POST | `/catalogo/productos` | Crea nuevo producto | Admin |
| PUT | `/catalogo/productos/{sku}` | Actualiza producto + invalida caché | Admin |
| DELETE | `/catalogo/productos/{sku}` | Elimina producto | Admin |

**Funcionalidad clave:** Caché Redis con TTL=3600s. Al crear/editar/eliminar, se llama `invalidar_catalogo_completo()` que hace SCAN de Redis eliminando todas las claves `sg:catalogo:*`.

---

### 5.6 WMS — Inventario (`/inventario`)

| Método | Ruta | Función |
|---|---|---|
| GET | `/inventario/satos` | Stock completo con filtros (estado, SKU, ubicación) |
| GET | `/inventario/stock-agrupado` | Vista agregada por producto |

---

### 5.7 WMS — Planograma y Mapa de Bodega (`/patentes`, `/api/v1/mapa/bodega`)

| Método | Ruta | Función |
|---|---|---|
| GET/POST/PUT/DELETE | `/patentes/` | CRUD de ubicaciones físicas (góndolas, cámaras) |
| GET/POST/PUT/DELETE | `/patentes/decoraciones` | CRUD de anotaciones visuales en el mapa 2D |
| GET | `/api/v1/mapa/bodega/` | Mapa completo con KPIs de ocupación (cacheado 15min) |
| GET | `/api/v1/mapa/bodega/{id}/stock` | Stock FEFO de una zona específica (cacheado 15min) |

**Funcionalidad clave:**
- **Gemelo Digital 2D**: Las patentes tienen `coordenada_x`, `coordenada_y`, `ancho`, `largo`, `rotacion`. El frontend renderiza un plano interactivo de la bodega.
- **Optimización N+1**: El mapa de bodega usa una única query de agregación `GROUP BY` en vez de una query por patente.
- **Caché por zona**: `sg:mapa:stock:{id_patente}` con TTL=900s, invalidado al mover SATOs.

---

### 5.8 WMS — Dashboard Gerencial (`/api/v1/dashboard/kpis`)

| Método | Ruta | Función |
|---|---|---|
| GET | `/api/v1/dashboard/kpis` | KPIs: stock total, alertas vencimiento, distribución, top mermas |

**Métricas retornadas:**
- `stock_total_unidades`: Suma de todas las unidades en el sistema
- `alertas_vencimiento`: Unidades que vencen en los próximos 7 días
- `distribucion_inventario`: % Vitrina vs Bodega (para gráfico de torta)
- `top_mermas`: Top 5 productos con más mermas declaradas en los últimos 7 días

---

### 5.9 POS — Point of Sale (`/pos`)

| Método | Ruta | Función | Descripción |
|---|---|---|---|
| POST | `/pos/scan` | Escanear producto en caja | Busca por EAN, verifica stock en SALA_VENTA |
| POST | `/pos/checkout` | Procesar venta | Descuenta stock FEFO con SELECT FOR UPDATE |
| POST | `/pos/sync` | Sincronizar tickets offline | Procesa lote de ventas generadas sin internet |

**Funcionalidad clave:**
- **FEFO estricto en POS**: El `checkout_service` selecciona SATOs por `fecha_vencimiento ASC` usando `with_for_update()` para evitar deadlocks entre cajeros simultáneos.
- **Anti-deadlock**: Ordenamiento dual `(fecha_vencimiento ASC, sato_id ASC)` para garantizar orden determinista.
- **Modo Offline**: El endpoint `/pos/sync` recibe un lote de tickets generados offline (PWA/Service Worker) y los procesa uno por uno con manejo individual de errores.
- **Caché de catálogo**: El `scan_producto_service` cachea en Redis el producto por EAN (TTL=1h) evitando consultas repetidas en BD.

---

### 5.10 Outbound & Picking (`/outbound`)

| Método | Ruta | Función |
|---|---|---|
| GET | `/outbound/waves` | Lista olas de picking activas |
| POST | `/outbound/waves/generar` | Genera una ola reservando SATOs FEFO |
| GET | `/outbound/waves/{ola_id}/tareas` | Tareas de la ola con optimización de ruta |
| POST | `/outbound/tareas/{tarea_id}/completar` | Completa tarea escaneando EAN físico |
| POST | `/outbound/tareas/{tarea_id}/faltante` | Reporta Short-Pick (producto no encontrado) |

**Funcionalidad clave:**
- Las tareas se ordenan por `area_pasillo` para optimizar el recorrido físico del operario.
- Al completar una tarea, se verifica que el EAN escaneado coincida con el SKU esperado.
- El Short-Pick registra `DECLARACION_FALTANTE_PICKING` en el log transaccional.

---

### 5.11 Trazabilidad (`/trazabilidad`)

| Método | Ruta | Función | Roles |
|---|---|---|---|
| GET | `/trazabilidad/lote/{numero_lote}` | Localiza todos los SATOs de un lote | Admin/Supervisor |

Responde dónde está físicamente distribuido un lote en el establecimiento (bodega, góndola, en tránsito). Crítico para recalls de productos.

---

### 5.12 Integración ERP (`/api/v1/integration`)

| Método | Ruta | Función | Auth |
|---|---|---|---|
| POST | `/api/v1/integration/asn` | Recibir ASN desde ERP (M2M) | API Key |
| POST | `/api/v1/integration/event/test` | Disparar evento de prueba | JWT Admin/Supervisor |
| GET | `/api/v1/integration/logs` | Consultar estado del Integration_Log | JWT Admin/Supervisor |
| POST | `/api/v1/integration/reconcile` | Re-encolar eventos PENDING/RETRYING | JWT Admin |

**Funcionalidad clave:**
- **Idempotencia en ASN**: Usando `Idempotency-Key` header + Redis, evita procesar el mismo webhook dos veces.
- **Seguridad M2M**: Endpoint `/asn` protegido por `X-API-Key` (HMAC verificado).
- **Reconciliación**: Si Celery/Redis estuvo caído, el endpoint `/reconcile` re-encola todos los eventos `PENDING` más viejos que N minutos.

---

### 5.13 Logs y Auditoría (`/logs`, `/auditoria`)

| Método | Ruta | Función |
|---|---|---|
| GET | `/logs/transaccionales` | Historial de movimientos de un SATO específico |
| GET | `/auditoria/acciones` | Acciones por usuario en rango de fecha |

---

## 6. Capa de Servicios (Business Logic)

Los routers de FastAPI son thin: solo validan HTTP y delegan a servicios. La lógica de negocio está en `app/services/`:

| Servicio | Responsabilidad |
|---|---|
| `recepcion_service.py` | GS1-128 parsing, validación FEFO en recepción, creación de SATOs, matching con ASN |
| `inventario_service.py` | Fraccionamiento de SATOs, movimiento a vitrina, declaración de mermas, ajustes manuales |
| `pos_service.py` | Escaneo de caja (caché), checkout FEFO con bloqueos atómicos |
| `outbound_service.py` | Generación de olas FEFO, optimización de rutas, completar tareas, Short-Pick |
| `trazabilidad_service.py` | Búsqueda de distribución física por número de lote |
| `catalogo_service.py` | CRUD de productos con invalidación de caché |
| `integration_service.py` | Emisión de eventos (Transactional Outbox), dispatch a Celery, reconciliación |
| `slotting_service.py` | Cálculo de compliance de planograma (productos asignados vs. presentes) |

---

## 7. Caché Redis — Estrategia por Dominio

| Namespace | TTL | Descripción |
|---|---|---|
| `sg:catalogo:productos:all` | 3600s (1h) | Lista completa del catálogo |
| `sg:catalogo:producto:{sku}` | 3600s | Producto individual |
| `sg:catalogo:producto:ean:{ean}` | 3600s | Lookup por EAN (POS) |
| `sg:catalogo:stock_agrupado` | 3600s | Vista jerárquica de stock |
| `sg:planograma:patente:{id}` | 1800s (30min) | Planograma de una góndola |
| `sg:planograma:compliance:batch` | 600s (10min) | Compliance pre-calculado |
| `sg:mapa:bodega` | 900s (15min) | Mapa completo de bodega |
| `sg:mapa:stock:{id_patente}` | 900s | Stock FEFO de una zona |
| `sg:dashboard:kpis` | 300s (5min) | KPIs gerenciales |
| `sg:idempotency:asn:{key}` | 86400s (24h) | Idempotencia de webhooks ERP |

**Comportamiento fail-open:** Si Redis no está disponible, el sistema no falla; simplemente sirve desde base de datos.

---

## 8. Pipeline de Eventos EDA (Celery)

```
Router FastAPI
  │
  ├─ 1. emit_event() → INSERT Integration_Log (status=PENDING)  [misma transacción DB]
  │
  └─ 2. _dispatch_to_celery() → notify_erp_task.apply_async()  [fire-and-forget]

Celery Worker (sg.integration.erp)
  │
  ├─ Intento 1: POST HTTP al ERP con firma HMAC-SHA256
  ├─ Intento 2: 60s  (si falla)
  ├─ Intento 3: 120s
  ├─ Intento 4: 240s
  ├─ Intento 5: 480s
  └─ Intento 6: → DEAD_LETTER → dead_letter_task (sg.integration.dlq)
```

**Eventos emitidos por el sistema:**
- `VENTA_POS_CONSOLIDADA` — Al cerrar ticket en caja
- `ASN_RECIBIDO` — Al recepcionar un LPN
- `MERMA_DECLARADA` — Al declarar merma
- `PICKING_COMPLETADO` — Al completar una ola de picking
- `INVENTARIO_AJUSTADO` — Al ajuste manual

**Firma HMAC:** Cada webhook lleva el header `X-SG-Signature: sha256=<hmac>` para que el ERP receptor valide la autenticidad.

---

## 9. Multi-Tenancy (Row-Level Security Lógico)

El sistema soporta múltiples empresas (tenants) compartiendo la misma base de datos con aislamiento garantizado a tres niveles:

### Nivel 1 — Header HTTP
```
Cada request debe incluir: X-Tenant-ID: <uuid-del-tenant>
```

### Nivel 2 — ContextVar (async-safe)
```python
# app/core/tenant.py
current_tenant_id: ContextVar[str] = ContextVar("current_tenant_id", default=None)
```
El middleware `tenant_middleware` en `main.py` extrae el header y setea el `ContextVar` para el request completo.

### Nivel 3 — Filtrado ORM automático
```python
# app/database.py — evento global SQLAlchemy
@event.listens_for(Session, "do_orm_execute")
def _add_tenant_filter(execute_state):
    # Inyecta WHERE tenant_id = '<current>' en TODOS los SELECTs
```

### Nivel 4 — Auto-asignación en INSERT
```python
@event.listens_for(Mapper, "before_insert")
def _set_tenant_id(mapper, connection, target):
    # Asigna tenant_id antes de cada INSERT si está vacío
```

### Nivel 5 — Base de datos (última línea de defensa)
Todas las columnas `tenant_id` son `NOT NULL` con FK a la tabla `tenant`. Ningún registro puede existir sin tenant.

### Constraints únicos por tenant
Aplicados como `UniqueConstraint(tenant_id, campo)`:
- `uq_categoria_tenant_nombre`
- `uq_producto_tenant_ean`
- `uq_usuario_tenant_nombre`

---

## 10. CQRS Lite — Read/Write Routing

El sistema separa lecturas analíticas de escrituras transaccionales:

```python
class RoutingSession(Session):
    def get_bind(self, mapper=None, clause=None, **kwargs):
        # Si hay escrituras pendientes → Primary
        if self._flushing or self.new or self.dirty or self.deleted:
            return engine  # Primary (escrituras)
        # SELECT en sesión limpia → Read Replica
        if clause_type == "SELECT":
            return engine_read
```

- `get_db()` → `RoutingSession` (enrutamiento automático)
- `get_db_read()` → explícitamente solo Read Replica (dashboard, reportes)

---

## 11. Seguridad

| Mecanismo | Descripción |
|---|---|
| **JWT HS256** | Tokens de 8 horas, payload `{sub: user_id, rol: rol}` |
| **bcrypt** | Hash de contraseñas con salt |
| **RBAC** | `require_role("Operario", "Admin", "Supervisor")` por endpoint |
| **API Key M2M** | `X-API-Key` para integración ERP (verificación HMAC) |
| **CORS restrictivo** | Lista blanca de orígenes + regex para ngrok (desarrollo) |
| **Rate Limiting** | 60 req/min por IP (configurable por tipo de endpoint) |
| **HMAC Webhook** | `X-SG-Signature: sha256=<hmac>` en todos los webhooks salientes |
| **X-Request-ID** | UUID por request para correlación de logs |
| **Global Exception Handler** | Ningún error interno se expone al cliente |

---

## 12. Frontend (Next.js 14)

### Páginas Principales

| Página | Ruta | Función |
|---|---|---|
| Dashboard | `/` | KPIs gerenciales + gráficos de stock y mermas |
| Bodega | `/bodega` | Escaneo de recepción (QR/barcode) |
| Mapa Bodega | `/patentes` | Plano 2D interactivo de la bodega |
| Vitrina | `/vitrina` | Movimiento de stock a góndolas |
| Inventario | `/inventario` | Vista completa de SATOs y stock |
| Mermas | `/merma` | Declaración de pérdidas con evidencia |
| POS | `/pos` | Caja registradora con escaneo de EAN |
| Catálogo | `/catalogo` | CRUD de productos |
| Outbound | `/outbound` | Gestión de olas de picking |
| Logs | `/logs` | Trazabilidad de movimientos |

### Patrones Frontend

```typescript
// api.ts — Cada request incluye tenant_id y auth
const getHeaders = () => ({
  "Content-Type": "application/json",
  "X-Tenant-ID": localStorage.getItem("tenant_id") || process.env.NEXT_PUBLIC_DEFAULT_TENANT_ID,
  "Authorization": `Bearer ${token}`  // cuando aplica
});
```

---

## 13. Flujos Operativos Principales

### Flujo 1: Recepción de Mercadería
```
Operario escanea barcode GS1-128
  → POST /bodega/recepcion/pallet
    → parse_gs1_128() extrae EAN, cantidad, lote, vencimiento
    → Verifica EAN en catálogo
    → Valida FEFO (días de vida útil ≥ tolerancia_vencimiento_dias)
    → Crea Sato(estado="Bodega", tipo="PRODUCTO")
    → Registra Log("CREACION_INGRESO_BODEGA")
    → commit()
```

### Flujo 2: Movimiento Bodega → Vitrina
```
Supervisor fracciona SATO
  → POST /vitrina/fraccionar
    → Reduce cantidad en SATO padre
    → Crea SATO hijo con cantidad a mover
    → Registra Log("FRACCION_PARA_VITRINA")

Operario posiciona en góndola
  → PUT /vitrina/{sato_id}/mover_a_vitrina
    → Actualiza estado="Vitrina"
    → Registra nivel_estante y frente_posicion
    → Invalida caché del mapa
```

### Flujo 3: Venta en Caja (POS)
```
Cajero escanea EAN
  → POST /pos/scan  (caché Redis → lookup en BD si miss)
    → Retorna nombre, precio, stock disponible en SALA_VENTA

Cajero procesa cobro
  → POST /pos/checkout
    → SELECT FOR UPDATE (bloqueo atómico)
    → Ordena SATOs por fecha_vencimiento ASC (FEFO)
    → Descuenta cantidades iterando SATOs
    → Registra Log("VENTA_POS_CONSOLIDADA")
    → emit_event("VENTA_POS_CONSOLIDADA") → Celery → ERP
    → commit()
```

### Flujo 4: Webhook al ERP
```
Evento de negocio
  → emit_event()
    → INSERT Integration_Log (PENDING) [misma TX]
    → notify_erp_task.apply_async(tenant_id=current, ...)
      → POST con firma HMAC al ERP
      → Si OK → UPDATE log (SUCCESS)
      → Si falla → backoff exponencial (5 reintentos)
      → Si agota → DEAD_LETTER → alerta manual
```

---

## 14. Configuración del Sistema

El sistema se configura mediante variables de entorno (`.env`):

| Variable | Descripción |
|---|---|
| `DATABASE_URL` | URL del Primary PostgreSQL |
| `DATABASE_POOLER_URL` | URL del PgBouncer (para Neon) |
| `DATABASE_READ_URL` | URL del Read Replica (opcional) |
| `REDIS_URL` | URL de Redis (opcional; sin Redis funciona en modo degradado) |
| `JWT_SECRET_KEY` | Clave para firmar tokens JWT |
| `JWT_ACCESS_TOKEN_EXPIRE_MINUTES` | Duración del token (default: 480) |
| `INTEGRATION_API_KEY` | Clave para autenticación M2M con ERP |
| `ERP_WEBHOOK_URL` | URL destino de los webhooks al ERP |
| `DEFAULT_TENANT_ID` | UUID del tenant por defecto (development) |
| `CORS_ORIGINS` | Lista de orígenes CORS permitidos |
| `RATE_LIMIT_DEFAULT` | Rate limit global (default: 60/minute) |

---

## 15. Patrones de Diseño Implementados

| Patrón | Implementación |
|---|---|
| **Transactional Outbox** | `emit_event()` inserta en `integration_log` en la misma TX del evento de negocio |
| **Dead Letter Queue** | Celery task `dead_letter_task` en `sg.integration.dlq` |
| **CQRS Lite** | `RoutingSession` enruta SELECT a Read Replica, writes a Primary |
| **Repository Pattern** | Servicios en `app/services/` desacoplados de los routers HTTP |
| **Factory Method** | `CacheKeys` centraliza la nomenclatura de claves Redis |
| **Strategy (FEFO)** | Ordenamiento por `fecha_vencimiento ASC` en checkout, picking y bodega |
| **Observer (Multi-tenant)** | SQLAlchemy `do_orm_execute` y `before_insert` como hooks globales |
| **Idempotency** | ASN inbound usa `Idempotency-Key` + Redis para prevenir duplicados |
| **Circuit Breaker (informal)** | Cache falla open; Celery falla silenciosamente dejando `PENDING` para reconciliación |
| **DDD (Domain-Driven Design)** | Código organizado en `app/domains/{wms,auth,pos,integration}/` |

---

## 16. Estado Actual y Roadmap

### ✅ Implementado
- Multi-tenancy completo con Row-Level Security lógico (5 capas)
- WMS: Recepción (GS1-128 + LPN + ASN matching)
- WMS: Bodega → Vitrina (fraccionamiento + micro-slotting)
- WMS: Mermas con trazabilidad
- WMS: Dashboard KPIs
- WMS: Mapa 2D (gemelo digital) con planograma
- WMS: Trazabilidad de lotes (recalls)
- POS: Caja con FEFO + anti-deadlock + modo offline
- Outbound: Olas de picking con optimización de rutas
- Integration: Webhooks al ERP con backoff exponencial y DLQ
- CQRS: Read Replica routing automático
- Cache Redis por dominio con invalidación granular
- Auth: JWT + RBAC por rol
- Rate Limiting, CORS, Request-ID, Global Exception Handler

### 🔮 Roadmap Planificado
- **Fase 2**: Service Workers + IndexedDB (modo offline-first avanzado)
- **Fase 3**: Soporte impresión etiquetas Zebra (ZPL via QZ Tray)
- **Fase 4**: Alembic para migraciones formales de base de datos
- **Fase 5**: Panel de administración multi-tenant (onboarding de nuevas empresas)
- **Fase 6**: Analytics avanzados (rotación de inventario, ABC analysis, previsión de demanda)

---

*Este documento fue generado a partir del análisis directo del codebase de SG-BVC. Refleja el estado actual de la implementación en la versión 2.0 (Multi-Tenant).*
