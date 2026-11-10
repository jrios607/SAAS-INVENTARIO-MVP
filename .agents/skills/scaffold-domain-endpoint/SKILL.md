---
name: scaffold-domain-endpoint
description: >-
  Use this skill when creating or refactoring FastAPI endpoints, Pydantic v2 schemas,
  or business services in SG-BVC to comply with DDD, CQRS Lite, Redis cache invalidation,
  and transactional logging.
---

# Skill: Creación de Endpoints y Servicios por Dominio (DDD + CQRS Lite)

Sigue este procedimiento paso a paso cada vez que agregues o modifiques un endpoint en **SG-BVC**.

## 1. Ubicar el Dominio Correcto

- `app/domains/wms/routers/`: Bodega, recepción, vitrina, merma, catálogo, inventario, patentes, mapa 2D y dashboard.
- `app/domains/auth/routers/`: Autenticación JWT, usuarios, logs transaccionales y auditoría.
- `app/domains/integration/routers/`: Webhooks ERP, ASN, picking outbound, trazabilidad de lotes e ingesta Omni-POS.

## 2. Definir los Contratos en Pydantic v2

- En [`app/schemas.py`](file:///c:/Users/Acer/OneDrive/Desktop/BVCore%20-%20Proyecto/app/schemas.py) o `app/domains/<dominio>/schemas.py`:
  - Usar `ConfigDict(from_attributes=True)` en los schemas de respuesta que serialicen modelos SQLAlchemy (nunca usar `orm_mode = True`).
  - Validar rangos numéricos con `Field(..., gt=0)`.

## 3. Implementar la Lógica en `app/services/`

- **Prohibido escribir lógica de negocio compleja o múltiples queries dentro del router.**
- La función de servicio en `app/services/<modulo>_service.py` debe:
  1. Recibir `db: Session` (y `user_id: Optional[int]` si genera auditoría).
  2. Lanzar excepciones de dominio (`ValueError`, `InventarioError`, etc.) en lugar de `HTTPException` cuando sea posible, para mantener el servicio reutilizable desde Celery o lotes.
  3. Registrar toda mutación de `Sato` en `Log_Transaccional`.
  4. Si el evento debe notificarse al ERP externo, llamar a `emit_event()` de [`app/services/integration_service.py`](file:///c:/Users/Acer/OneDrive/Desktop/BVCore%20-%20Proyecto/app/services/integration_service.py) **antes** del `commit()` (patrón Transactional Outbox).

## 4. Construir el Router Thin con CQRS y RBAC

```python
@router.post("/recurso", response_model=MiResponse, status_code=201)
def crear_recurso(
    payload: MiRequest,
    db: Session = Depends(get_db),  # get_db para escrituras; get_db_read para SELECT analítico
    user=Depends(require_role("Admin", "Supervisor")),
):
    try:
        resultado = mi_servicio(db, payload, user_id=getattr(user, "id", None))
        invalidar_stock_y_kpis()  # Invalidar caché después del commit
        return resultado
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception:
        db.rollback()
        logger.exception("Error inesperado en crear_recurso")
        raise HTTPException(status_code=500, detail="Error interno del servidor.")
```

## 5. Checklist de Verificación

- [ ] ¿Usa `Depends(get_db_read)` si es solo lectura o `Depends(get_db)` si escribe?
- [ ] ¿Tiene `Depends(get_current_user)` o `Depends(require_role(...))` (o `Depends(verify_api_key)` si es M2M)?
- [ ] ¿Invalida las claves correspondientes de `CacheKeys` en [`app/core/cache.py`](file:///c:/Users/Acer/OneDrive/Desktop/BVCore%20-%20Proyecto/app/core/cache.py)?
- [ ] ¿Está sincronizado con [`frontend/src/services/api.ts`](file:///c:/Users/Acer/OneDrive/Desktop/BVCore%20-%20Proyecto/frontend/src/services/api.ts) si el frontend lo consume?
