---
name: contract-sync-api-frontend
description: >-
  Use this skill when adding or modifying API endpoints, request/response schemas,
  or frontend data fetching in frontend/src/services/api.ts to keep FastAPI and
  Next.js 14 contracts synchronized.
---

# Skill: Sincronización de Contratos Backend (FastAPI) $\leftrightarrow$ Frontend (Next.js 14)

Esta skill asegura que cualquier cambio en los routers o schemas de FastAPI se refleje sin errores de tipado ni pérdida de cabeceras Multi-Tenant en [`frontend/src/services/api.ts`](file:///c:/Users/Acer/OneDrive/Desktop/BVCore%20-%20Proyecto/frontend/src/services/api.ts).

## 1. Reglas del Cliente HTTP (`frontend/src/services/api.ts`)

1. **Cabeceras Obligatorias (`getHeaders`)**:
   - **Toda** llamada `fetch` hacia `${API_URL}` DEBE incluir `headers: getHeaders()` (o `headers: getHeaders(false)` cuando se envía un `FormData` / `UploadFile` para que el navegador establezca el `boundary` de `multipart/form-data`).
   - `getHeaders()` inyecta automáticamente:
     - `X-Tenant-ID`: leído desde `localStorage.getItem("tenant_id")` o `NEXT_PUBLIC_DEFAULT_TENANT_ID`.
     - `Authorization`: `Bearer ${token}` si existe `access_token` o `token` en `localStorage`.
2. **Deshabilitar Caché Estática de Next.js en Datos Operativos**:
   - En lecturas de stock, olas de picking, patentes y KPIs, incluir `cache: "no-store"` en `fetch`.

## 2. Procedimiento de Sincronización

1. **Inspeccionar el Schema Pydantic**:
   - Revisar el modelo de entrada/salida en [`app/schemas.py`](file:///c:/Users/Acer/OneDrive/Desktop/BVCore%20-%20Proyecto/app/schemas.py) o `app/domains/<dominio>/schemas.py`.
2. **Actualizar la Interfaz TypeScript en [`api.ts`](file:///c:/Users/Acer/OneDrive/Desktop/BVCore%20-%20Proyecto/frontend/src/services/api.ts)**:
   - Mantener exactitud en nombres de campos (`snake_case` tal como los serializa FastAPI) y nulabilidad (`Optional[T]` $\rightarrow$ `campo?: T | null`).
3. **Operaciones con Soporte Offline (Bodega / Picking)**:
   - Si la operación se ejecuta en pasillos de bodega con conectividad inestable (como completar tareas de picking en [`frontend/src/app/picking/ola/[ola_id]/page.tsx`](file:///c:/Users/Acer/OneDrive/Desktop/BVCore%20-%20Proyecto/frontend/src/app/picking/ola/%5Bola_id%5D/page.tsx)), envolver la función de envío con el hook [`useOfflineSync`](file:///c:/Users/Acer/OneDrive/Desktop/BVCore%20-%20Proyecto/frontend/src/hooks/useOfflineSync.ts).

## 3. Verificación

Ejecutar el linter y chequeo de tipos del frontend:
```powershell
cd frontend; npm run lint
```
