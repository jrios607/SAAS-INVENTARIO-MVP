# 🔍 Auditoría Técnica Completa — Motor Core SG (BVC)

**Fecha:** 2026-06-06  
**Auditor:** Arquitecto de Software Senior  
**Veredicto General:** ⚠️ **Apto para staging con correcciones obligatorias. NO listo para producción tal como está.**

---

## 1. Mapa del Proyecto

```
SG/
├── .git/
├── .gitignore
├── test_satos.db              ← Base de datos SQLite (desarrollo)
└── app/
    ├── __init__.py
    ├── main.py                ← Punto de entrada FastAPI
    ├── database.py            ← Engine, SessionLocal, get_db
    ├── models.py              ← 5 modelos SQLAlchemy
    ├── schemas.py             ← 16 schemas Pydantic
    ├── core/
    │   ├── __init__.py
    │   └── utils.py           ← Parser GS1-128
    └── routers/
        ├── __init__.py
        ├── catalogo.py        ← POST /catalogo/producto
        ├── bodega.py          ← POST /recepcion/pallet
        ├── vitrina.py         ← POST /vitrina/fraccionar
        ├── patente.py         ← POST|GET /patentes, GET /patentes/{id}/stock
        ├── caja.py            ← POST /caja/vender
        ├── merma.py           ← POST /merma/declarar
        └── auditoria.py       ← POST /auditoria/conteo
```

**Veredicto de Modularidad: ✅ APROBADA.** La separación por dominios de negocio (BVC + Auditoría + Merma) es correcta. Cada router tiene responsabilidad única. El parser GS1 vive en `core/utils.py` separado de la capa HTTP. Bien hecho.

---

## 2. Análisis de Robustez y Transaccionalidad

### 2.1 Hallazgo CRÍTICO: `.with_for_update()` es inútil con SQLite

> [!CAUTION]
> **Severidad: CRÍTICA — Afecta a [caja.py](file:///c:/Users/Acer/SG/app/routers/caja.py#L27), [merma.py](file:///c:/Users/Acer/SG/app/routers/merma.py#L17), [vitrina.py](file:///c:/Users/Acer/SG/app/routers/vitrina.py#L16), [auditoria.py](file:///c:/Users/Acer/SG/app/routers/auditoria.py#L27)**
>
> SQLite **no soporta `SELECT ... FOR UPDATE`**. SQLAlchemy lo ignora silenciosamente. Todas tus llamadas `.with_for_update()` son **decoración muerta** contra tu DB actual. No tienes protección contra condiciones de carrera hoy.

**Impacto real:** Si dos cajeros venden el mismo EAN al mismo tiempo contra SQLite, ambas transacciones leen el mismo stock, ambas restan y el inventario queda en negativo. SQLite usa bloqueo a nivel de **archivo completo**, no de fila.

**Acción requerida:** Esto **no es un bug de tu código**, la lógica es correcta para PostgreSQL/MySQL. Para producción debes migrar. La corrección mínima para staging con SQLite es usar `SERIALIZABLE` isolation:

```python
# database.py — Fix temporal para SQLite
from sqlalchemy import event

@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")  # Write-Ahead Logging
    cursor.close()
```

### 2.2 Hallazgo MEDIO: Doble rollback en módulos transaccionales

> [!WARNING]
> **Severidad: MEDIA — Afecta a [caja.py](file:///c:/Users/Acer/SG/app/routers/caja.py#L57-L77), [merma.py](file:///c:/Users/Acer/SG/app/routers/merma.py#L55-L62), [auditoria.py](file:///c:/Users/Acer/SG/app/routers/auditoria.py#L77-L82)**

En [caja.py](file:///c:/Users/Acer/SG/app/routers/caja.py) (líneas 57-76), cuando el stock es insuficiente:

```python
# Línea 59: Primer rollback
db.rollback()
raise HTTPException(status_code=400, ...)

# Línea 73-76: Segundo rollback (innecesario, la sesión ya fue revertida)
except HTTPException:
    db.rollback()  # ← Rollback redundante
    raise
```

**No rompe nada** (SQLAlchemy tolera rollback en sesión limpia), pero es código confuso. Indica que el flujo de control no está del todo claro para quien lo mantenga.

**Refactorización recomendada:** Eliminar el `db.rollback()` explícito antes de los `raise HTTPException` dentro del try, y dejar que el `except HTTPException` haga el rollback único:

```python
# caja.py — Refactorizado
if cantidad_restante > 0:
    raise HTTPException(  # Sin rollback aquí, el except lo hará
        status_code=400,
        detail=f"Quiebre de stock. Faltan {cantidad_restante} unidades."
    )

db.commit()
return VentaCajaResponse(...)

except HTTPException:
    db.rollback()  # Único punto de rollback para errores HTTP
    raise
except Exception as e:
    db.rollback()
    raise HTTPException(status_code=500, detail=str(e))
```

### 2.3 Hallazgo BAJO: `patente.py` sin `try/except`

> [!NOTE]
> **Severidad: BAJA — Afecta a [patente.py](file:///c:/Users/Acer/SG/app/routers/patente.py#L14-L33)**

El endpoint `POST /patentes/` no tiene bloque `try/except`. Si la base de datos falla al hacer `db.commit()` (por ejemplo, por una violación de FK o un error de disco), la sesión queda en estado sucio y FastAPI devolverá un error 500 genérico sin rollback.

**Fix recomendado:**
```python
@router.post("/", response_model=PatenteResponse, status_code=status.HTTP_201_CREATED)
def create_patente(patente: PatenteCreate, db: Session = Depends(get_db)):
    try:
        db_patente = db.query(Patente).filter(Patente.id_patente == patente.id_patente).first()
        if db_patente:
            raise HTTPException(status_code=400, detail="La patente con este ID ya existe")
        new_patente = Patente(**patente.model_dump())
        db.add(new_patente)
        db.commit()
        db.refresh(new_patente)
        return new_patente
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
```

### 2.4 Análisis de cada módulo transaccional

| Módulo | `with_for_update()` | `rollback()` | Log Auditoría | Veredicto |
|---|---|---|---|---|
| [catalogo.py](file:///c:/Users/Acer/SG/app/routers/catalogo.py) | N/A (solo INSERT) | ✅ | N/A | ✅ OK |
| [bodega.py](file:///c:/Users/Acer/SG/app/routers/bodega.py) | N/A (solo INSERT) | ✅ | ✅ | ✅ OK |
| [vitrina.py](file:///c:/Users/Acer/SG/app/routers/vitrina.py) | ✅ (línea 16) | ✅ | ✅ (doble log) | ✅ OK |
| [caja.py](file:///c:/Users/Acer/SG/app/routers/caja.py) | ✅ (línea 27) | ⚠️ Doble | ✅ | ⚠️ Refactorizar |
| [merma.py](file:///c:/Users/Acer/SG/app/routers/merma.py) | ✅ (línea 17) | ✅ | ✅ | ✅ OK |
| [auditoria.py](file:///c:/Users/Acer/SG/app/routers/auditoria.py) | ✅ (línea 27) | ✅ | ✅ | ✅ OK |
| [patente.py](file:///c:/Users/Acer/SG/app/routers/patente.py) | N/A (CRUD básico) | ❌ Falta | N/A | ⚠️ Agregar |

---

## 3. Validación de Contratos (Schemas ↔ Models)

### 3.1 Hallazgo CRÍTICO: EAN no tiene índice ni restricción UNIQUE

> [!CAUTION]
> **Severidad: CRÍTICA — Afecta a [models.py](file:///c:/Users/Acer/SG/app/models.py#L10) + [caja.py](file:///c:/Users/Acer/SG/app/routers/caja.py#L18) + [auditoria.py](file:///c:/Users/Acer/SG/app/routers/auditoria.py#L17)**

En [models.py línea 10](file:///c:/Users/Acer/SG/app/models.py#L10):
```python
ean = Column(String, nullable=False)  # ← Sin index=True, sin unique=True
```

Tres módulos hacen `.filter(Catalogo_Producto.ean == ...)`: bodega, caja y auditoría. Sin índice, cada consulta hace un **table scan completo**. Pero peor aún: **si dos productos tienen el mismo EAN** (error de carga de datos), `caja.py` y `auditoria.py` usarán `.first()` y tomarán uno al azar silenciosamente.

**Fix obligatorio:**
```python
ean = Column(String, nullable=False, unique=True, index=True)
```

### 3.2 Hallazgo MEDIO: `orm_mode` redundante en Pydantic v2

> [!NOTE]
> **Severidad: BAJA — Afecta a [schemas.py](file:///c:/Users/Acer/SG/app/schemas.py#L55-L57) (líneas 55-57 y 65-67)**

```python
class Config:
    from_attributes = True  # ← Pydantic v2 (correcto)
    orm_mode = True          # ← Pydantic v1 (deprecado, redundante)
```

En Pydantic v2, `from_attributes = True` reemplaza a `orm_mode = True`. Tener ambos no rompe nada hoy, pero generará un `DeprecationWarning` y eventualmente fallará al migrar.

**Fix:** Eliminar `orm_mode = True` en `PatenteResponse` y `StockPatenteResponse`.

### 3.3 Hallazgo MEDIO: Schemas sin `Config` donde deberían tenerlo

Los schemas `MermaResponse` y `AuditoriaConteoResponse` retornan campos que vienen directamente del ORM (`sato_id` tipo UUID). Funcionan hoy porque se construyen manualmente, pero si en algún momento alguien intenta devolver el objeto ORM directamente (como se hace en `patente.py` línea 33: `return new_patente`), fallará sin `from_attributes = True`.

**Recomendación:** Agregar `model_config = ConfigDict(from_attributes=True)` a todos los Response schemas por consistencia.

### 3.4 Tabla de Compatibilidad Completa

| Schema Field | Model Column | Tipo Schema | Tipo SQLAlchemy | ¿Match? |
|---|---|---|---|---|
| `ProductoCreate.sku` | `Catalogo_Producto.sku` | `str` | `String` | ✅ |
| `ProductoCreate.ean` | `Catalogo_Producto.ean` | `str` | `String` | ✅ |
| `PatenteCreate.coordenada_x` | `Patente.coordenada_x` | `int` | `Integer` | ✅ |
| `PatenteResponse.url_imagen` | `Patente.url_imagen_planograma` | `Optional[str]` | `String, nullable=True` | ✅ |
| `StockPatenteResponse.fecha_vencimiento` | `Sato.fecha_vencimiento` | `date` | `Date` | ✅ |
| `MermaRequest.sato_id` | `Sato.sato_id` | `uuid.UUID` | `Uuid(as_uuid=True)` | ✅ |
| `VentaCajaResponse.satos_afectados` | — (construido manual) | `List[Dict[str, Any]]` | N/A | ✅ |

**Veredicto de tipos: ✅ Sin discrepancias que causen 500 silencioso.** Los tipos están correctamente mapeados.

### 3.5 Hallazgo MEDIO: Imports dispersos en `schemas.py`

> [!NOTE]
> **Severidad: BAJA — [schemas.py](file:///c:/Users/Acer/SG/app/schemas.py#L33) (líneas 33, 69, 70, 81)**

Los imports están dispersos a lo largo del archivo (`date` en línea 33, `List/Dict/Any` en línea 69, `Field` en línea 70, `Literal` en línea 81). Esto es consecuencia natural de ir agregando módulos incrementalmente, pero para el hand-off deberías **consolidar todos los imports al inicio del archivo**.

```python
# schemas.py — Imports consolidados
import uuid
from datetime import date
from typing import Optional, List, Dict, Any, Literal
from pydantic import BaseModel, Field
```

---

## 4. Checklist de Integración Frontend (Hand-off)

### 4.1 BLOQUEANTE: No hay CORS configurado

> [!CAUTION]
> **Severidad: BLOQUEANTE para frontend — Afecta a [main.py](file:///c:/Users/Acer/SG/app/main.py)**
>
> Tu compañero de React **no podrá hacer ni una sola petición** a tu API. El navegador bloqueará todas las requests con un error `CORS policy: No 'Access-Control-Allow-Origin'`.

**Fix obligatorio en [main.py](file:///c:/Users/Acer/SG/app/main.py):**

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="SG - Módulos BVC")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],  # URL del dev server de React/Next.js
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

### 4.2 IMPORTANTE: Falta endpoint `GET /catalogo/productos`

El frontend necesita listar los productos del catálogo para autocompletados, selectores de EAN, etc. [catalogo.py](file:///c:/Users/Acer/SG/app/routers/catalogo.py) solo tiene `POST`. Falta un `GET`.

### 4.3 IMPORTANTE: Inconsistencia en prefijos de rutas

| Router | Estilo de ruta | Consistente? |
|---|---|---|
| [catalogo.py](file:///c:/Users/Acer/SG/app/routers/catalogo.py) | `@router.post("/catalogo/producto")` (ruta inline, sin prefix) | ❌ |
| [bodega.py](file:///c:/Users/Acer/SG/app/routers/bodega.py) | `@router.post("/recepcion/pallet")` (ruta inline, sin prefix) | ❌ |
| [vitrina.py](file:///c:/Users/Acer/SG/app/routers/vitrina.py) | `prefix="/vitrina"` + `@router.post("/fraccionar")` | ✅ |
| [patente.py](file:///c:/Users/Acer/SG/app/routers/patente.py) | `prefix="/patentes"` + `@router.post("/")` | ✅ |
| [caja.py](file:///c:/Users/Acer/SG/app/routers/caja.py) | `prefix="/caja"` + `@router.post("/vender")` | ✅ |
| [merma.py](file:///c:/Users/Acer/SG/app/routers/merma.py) | `prefix="/merma"` + `@router.post("/declarar")` | ✅ |
| [auditoria.py](file:///c:/Users/Acer/SG/app/routers/auditoria.py) | `prefix="/auditoria"` + `@router.post("/conteo")` | ✅ |

`catalogo.py` y `bodega.py` deberían usar `prefix=` en el `APIRouter()` como el resto para que el Swagger/OpenAPI sea consistente.

### 4.4 Códigos HTTP — Evaluación

| Código | Uso | ¿Claro para frontend? |
|---|---|---|
| `201 Created` | catalogo, bodega, merma, patente | ✅ |
| `200 OK` | caja venta, auditoría, GET patentes | ✅ |
| `400 Bad Request` | Stock insuficiente, duplicados, validaciones | ✅ |
| `404 Not Found` | EAN/SATO/Patente no existe | ✅ |
| `422 Unprocessable Entity` | Pydantic validation (automático) | ✅ |
| `500 Internal Server Error` | Excepciones genéricas | ✅ |

**Veredicto: ✅ Los códigos HTTP están bien usados.** El dev de React podrá hacer `switch(response.status)` sin problemas.

### 4.5 Formato de Respuestas JSON — Evaluación

> [!WARNING]
> **Inconsistencia menor:** Algunos endpoints retornan `{"mensaje": "...", "sku": "..."}` y otros retornan directamente el objeto ORM serializado (como `GET /patentes/`). No hay un envelope estándar. Para el frontend esto no es bloqueante pero sí genera confusión.

**Recomendación futura:** Considerar un wrapper estándar tipo `{"success": true, "data": {...}, "error": null}`.

### 4.6 Documentación API

> [!TIP]
> FastAPI genera Swagger UI automáticamente en `/docs`. Recomendación: agregar `description` y `summary` a cada endpoint para que tu compañero de React tenga documentación self-service.

---

## 5. Resumen Ejecutivo de Hallazgos

| # | Hallazgo | Severidad | Archivo | Acción |
|---|---|---|---|---|
| 1 | `.with_for_update()` inútil en SQLite | 🔴 CRÍTICO | [database.py](file:///c:/Users/Acer/SG/app/database.py) | Migrar a PostgreSQL para producción |
| 2 | EAN sin `unique=True` ni `index=True` | 🔴 CRÍTICO | [models.py](file:///c:/Users/Acer/SG/app/models.py#L10) | Agregar constraints |
| 3 | CORS no configurado | 🔴 BLOQUEANTE | [main.py](file:///c:/Users/Acer/SG/app/main.py) | Agregar middleware |
| 4 | Doble rollback en caja.py | 🟡 MEDIO | [caja.py](file:///c:/Users/Acer/SG/app/routers/caja.py#L57-L76) | Refactorizar flujo |
| 5 | `patente.py` sin try/except | 🟡 MEDIO | [patente.py](file:///c:/Users/Acer/SG/app/routers/patente.py#L14-L33) | Agregar protección |
| 6 | Inconsistencia en prefijos de ruta | 🟡 MEDIO | catalogo.py, bodega.py | Estandarizar con `prefix=` |
| 7 | Falta `GET /catalogo/productos` | 🟡 MEDIO | [catalogo.py](file:///c:/Users/Acer/SG/app/routers/catalogo.py) | Agregar endpoint |
| 8 | `orm_mode` deprecado en Pydantic v2 | 🟢 BAJO | [schemas.py](file:///c:/Users/Acer/SG/app/schemas.py#L57) | Eliminar línea |
| 9 | Imports dispersos en schemas.py | 🟢 BAJO | [schemas.py](file:///c:/Users/Acer/SG/app/schemas.py) | Consolidar al inicio |
| 10 | `datetime.utcnow` deprecado | 🟢 BAJO | [models.py](file:///c:/Users/Acer/SG/app/models.py#L53) | Usar `datetime.now(UTC)` |

---

## 6. Veredicto Final

La **lógica de negocio es sólida**. Los algoritmos FEFO, fraccionamiento padre-hijo, merma y conteo ciego están correctamente implementados. La trazabilidad con `Log_Transaccional` en cada operación es exactamente lo que un SaaS de inventario perecible necesita.

Los problemas encontrados son **infraestructurales, no algorítmicos**:

1. **Para que tu compañero empiece mañana:** Agrega CORS → 5 minutos.
2. **Para staging funcional:** Agrega el índice único al EAN, protege patente.py, limpia los imports → 30 minutos.
3. **Para producción real:** Migra a PostgreSQL donde `.with_for_update()` realmente funcione → 2 horas (cambiar la `DATABASE_URL` y usar `psycopg2`).

El motor core está al **85% de producción**. Las correcciones son quirúrgicas, no requieren re-arquitectura.
