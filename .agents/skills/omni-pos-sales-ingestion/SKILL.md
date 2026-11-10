---
name: omni-pos-sales-ingestion
description: >-
  Use this skill when adding, modifying, or debugging external Point of Sale (POS)
  integrations, sales webhooks (with API Key), or legacy POS file/batch importers
  (CSV, TXT, JSON without API Key) in SG-BVC.
---

# Skill: Conector Universal de Ventas Externas (Omni-POS Ingestion)

**SG-BVC** no tiene caja registradora propia. Las ventas se originan en los sistemas POS del cliente (modernos con API Key o tradicionales sin API) y se ingieren mediante el motor unificado en [`app/services/external_sales_service.py`](file:///c:/Users/Acer/OneDrive/Desktop/BVCore%20-%20Proyecto/app/services/external_sales_service.py).

## 1. Arquitectura de los Dos Canales

| Canal | Endpoint | Autenticación | Idempotencia | Caso de Uso |
| :--- | :--- | :--- | :--- | :--- |
| **Canal A (Con API Key)** | `POST /api/v1/integration/sales/webhook` | `X-API-Key` (`verify_api_key`) + `X-Tenant-ID` | Redis (`Idempotency-Key` 24h) + DB (`uq_venta_externa_tenant_source_ticket`) | POS modernos (Bsale, Loyverse, Shopify POS, Toteat, agentes locales) |
| **Canal B1 (Lote JSON)** | `POST /api/v1/integration/sales/import-batch` | JWT (`Admin` / `Supervisor`) + `X-Tenant-ID` | DB (`uq_venta_externa_tenant_source_ticket`) + `SAVEPOINT` por ticket | Integradores batch o sincronizadores de cierre de turno |
| **Canal B2 (Archivo CSV/TXT/JSON)** | `POST /api/v1/integration/sales/import-file` | JWT (`Admin` / `Supervisor`) + `X-Tenant-ID` | Hash SHA-256 del archivo o folio de boleta + `SAVEPOINT` por ticket | Cajas registradoras legacy, exportaciones Excel/CSV/TXT sin API |

## 2. Procedimiento para Añadir un Nuevo Formato o Adaptador de POS

1. **Si el POS envía CSV/TXT con nombres de columna particulares**:
   - Revisar los conjuntos de alias en [`app/services/external_sales_service.py`](file:///c:/Users/Acer/OneDrive/Desktop/BVCore%20-%20Proyecto/app/services/external_sales_service.py):
     - `_ALIAS_EAN` (código de barras)
     - `_ALIAS_SKU` (código interno / PLU)
     - `_ALIAS_CANT` (unidades vendidas)
     - `_ALIAS_TICKET` (folio / boleta / transacción)
     - `_ALIAS_FECHA` (timestamp de venta)
   - Añadir el nuevo alias normalizado (minúsculas, sin tildes, espacios reemplazados por `_`).
2. **Si el POS envía un Webhook JSON propietario (ej. estructura anidada específica)**:
   - Crear un transformador ligero en `app/domains/integration/schemas.py` o un endpoint adaptador en `app/domains/integration/routers/integration.py` que convierta el payload nativo a `ExternalSaleWebhookRequest` y delegue siempre en `procesar_venta_externa()`.
   - **Nunca duplicar la lógica FEFO fuera de `external_sales_service.py`.**

## 3. Reglas Inquebrantables del Descuento de Ventas

1. **Resolución Dual (`SKU` $\leftrightarrow$ `EAN`)**: `_resolver_producto()` busca por `sku` y `ean` dentro del tenant actual.
2. **Orden FEFO Anti-Deadlock**:
   - Siempre consultar `Sato` con `.order_by(Sato.fecha_vencimiento.asc().nulls_last(), Sato.sato_id.asc()).with_for_update()`.
3. **Aislamiento por Savepoints en Lotes**:
   - En `procesar_lote_ventas_externas()`, cada ticket se ejecuta dentro de `savepoint = db.begin_nested()`. Si un ticket tiene quiebre de stock (`QuiebreStockError`) o producto inexistente (`ProductoNoEncontradoError`), hacer `savepoint.rollback()` y continuar con el siguiente ticket.
4. **Invalidación Post-Commit**:
   - Llamar a `invalidar_stock_y_kpis()` únicamente después de `db.commit()`.

## 4. Verificación

Ejecutar la suite de pruebas del conector:
```powershell
pytest tests/test_omni_pos_and_multitenant.py -k "sales or omni_pos" -v
```
