---
name: fefo-and-locking-audit
description: >-
  Use this skill when writing or auditing any operation that creates, splits, moves,
  picks, adjusts, or deducts stock from Sato records (FEFO ordering, SELECT FOR UPDATE,
  deadlock prevention, and Log_Transaccional).
---

# Skill: Auditoría de Concurrencia, Bloqueo Pesimista y FEFO en `Sato`

En **SG-BVC**, la tabla `satos` ([`app/models.py`](file:///c:/Users/Acer/OneDrive/Desktop/BVCore%20-%20Proyecto/app/models.py#L96-L129)) es la unidad atómica de inventario. Cualquier condición de carrera entre operarios de bodega, tareas de picking o webhooks de ventas externas puede causar stock negativo o pérdida de trazabilidad.

## 1. Reglas de Bloqueo Pesimista (`SELECT ... FOR UPDATE`)

1. **Bloqueo de SATO individual** (Fraccionamiento, Movimiento a Vitrina, Ajuste, Merma):
   ```python
   sato = (
       db.query(Sato)
       .filter(Sato.sato_id == sato_uuid)
       .with_for_update()
       .first()
   )
   ```
2. **Bloqueo de múltiples SATOs por SKU (FEFO Determinista)** (Ventas Externas, Generación de Olas de Picking):
   - **Obligatorio** ordenar por dos columnas: primero `fecha_vencimiento ASC NULLS LAST` y segundo `sato_id ASC`.
   - El desempate determinista por `sato_id ASC` garantiza que dos transacciones concurrentes adquieran los locks de fila exactamente en el mismo orden, **eliminando deadlocks en PostgreSQL**.
   ```python
   satos_fefo = (
       db.query(Sato)
       .filter(
           Sato.sku == sku,
           Sato.tipo_sato == "PRODUCTO",
           Sato.estado.in_(estados_validos),
           Sato.cantidad > 0,
       )
       .order_by(
           Sato.fecha_vencimiento.asc().nulls_last(),
           Sato.sato_id.asc(),
       )
       .with_for_update()
       .all()
   )
   ```

## 2. Máquina de Estados de `Sato`

- `tipo_sato`: `"CONTENEDOR"` (pallet LPN padre, `cantidad=None`) vs `"PRODUCTO"` (unidades con `sku` y `cantidad`).
- Prohibido fraccionar, vender o declarar merma directamente sobre un `Sato` con `tipo_sato == "CONTENEDOR"`.
- Cuando `sato.cantidad` llega a `0` tras un descuento, fraccionamiento, venta externa o merma, actualizar siempre:
  ```python
  if sato.cantidad == 0:
      sato.estado = "Agotado"
  ```

## 3. Enrutamiento CQRS en `RoutingSession`

- En [`app/database.py`](file:///c:/Users/Acer/OneDrive/Desktop/BVCore%20-%20Proyecto/app/database.py), `RoutingSession.get_bind()` detecta `getattr(clause, "_for_update_arg", None) is not None` y fuerza el uso del motor `Primary` (`engine`), nunca de la `Read Replica`.
- Nunca usar `Depends(get_db_read)` en un endpoint que ejecute `.with_for_update()`.

## 4. Trazabilidad Obligatoria (`Log_Transaccional`)

Toda modificación de `Sato` debe insertar su evento en `Log_Transaccional` antes del `db.commit()`:
- `CREACION_INGRESO_BODEGA` / `CREACION_INGRESO_LPN`
- `DESCUENTO_FRACCIONAMIENTO` / `CREACION_HIJO_VITRINA`
- `MOVIMIENTO_A_VITRINA`
- `VENTA_EXTERNA_POS`
- `DECLARACION_MERMA` / `AJUSTE_INVENTARIO` / `DECLARACION_FALTANTE_PICKING`
