const getApiUrl = () => {
  return process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
};

const API_URL = getApiUrl();

export class ApiHttpError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiHttpError";
    this.status = status;
  }
}

export const getActiveTenantId = (): string => {
  const fallback = process.env.NEXT_PUBLIC_DEFAULT_TENANT_ID || "130cc80b-1971-4332-bab3-9ee5ef66063b";
  if (typeof window !== "undefined") {
    return localStorage.getItem("tenant_id") || fallback;
  }
  return fallback;
};

const formatApiDetail = (detail: unknown, fallback: string): string => {
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail) && detail.length > 0) {
    return detail.map((d: any) => d?.msg || JSON.stringify(d)).join("; ");
  }
  return fallback;
};

const getHeaders = (includeJsonContentType: boolean = true): Record<string, string> => {
  let tenantId = process.env.NEXT_PUBLIC_DEFAULT_TENANT_ID || "130cc80b-1971-4332-bab3-9ee5ef66063b";
  let token: string | null = null;
  if (typeof window !== "undefined") {
    tenantId = localStorage.getItem("tenant_id") || tenantId;
    token = localStorage.getItem("access_token") || localStorage.getItem("token");
  }
  const headers: Record<string, string> = {
    "Bypass-Tunnel-Reminder": "true",
    "ngrok-skip-browser-warning": "true",
    "X-Tenant-ID": tenantId,
  };
  if (includeJsonContentType) {
    headers["Content-Type"] = "application/json";
  }
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
};

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface Producto {
  sku: string;
  nombre: string;
  ean: string;
  dun14?: string | null;
  unidades_por_caja?: number;
  unidad_medida?: string;
  temperatura_requerida?: string;
  stock_minimo?: number;
  dias_alerta_vencimiento?: number;
  categoria?: string;
  familia?: string;
  sub_familia?: string;
  proveedor_marca?: string;
  tolerancia_vencimiento_dias?: number;
  controla_vencimiento?: boolean;
  dias_vida_util?: number | null;
  costo_unitario?: number;
  precio?: number;
  activo?: boolean;
  // Clasificación ABC Dinámica (Etapa 1)
  clase_abc?: string;
  es_perecible_corto?: boolean;
  venta_valorizada_ventana?: number;
  unidades_vendidas_ventana?: number;
  participacion_ventas?: number;
  // Campos opcionales para Carga Inicial (Día 1)
  stock_inicial?: number;
  modo_stock_inicial?: "UNIDADES" | "CAJAS";
  estado_stock_inicial?: "Vitrina" | "Bodega";
  ubicacion_stock_inicial?: string;
  fecha_vencimiento_inicial?: string;
  lote_inicial?: string;
}

export interface CatalogoIngresoStockRequest {
  cantidad: number;
  modo_ingreso?: "UNIDADES" | "CAJAS";
  estado_destino?: "Vitrina" | "Bodega";
  ubicacion_id?: string;
  lote?: string;
  fecha_vencimiento?: string;
  motivo?: string;
}

export interface CatalogoAjusteLoteRequest {
  nueva_cantidad: number;
  modo_cantidad?: "UNIDADES" | "CAJAS";
  estado_destino?: "Vitrina" | "Bodega";
  ubicacion_id?: string;
  fecha_vencimiento?: string;
  lote?: string;
  motivo?: string;
}

export interface CatalogoStockMutationResponse {
  mensaje: string;
  sato_id: string;
  sku: string;
  cantidad_anterior: number;
  cantidad_nueva: number;
  diferencia: number;
  estado: string;
}

export interface LoteDetalleFEFO {
  sato_id: string;
  id_lote: string;
  proveedor: string;
  fecha_vencimiento?: string | null;
  dias_restantes?: number | null;
  estado_vencimiento: string;
  ubicacion: string;
  estado_sato: string;
  stock: number;
}

export interface ProductoDetalleStock {
  sku: string;
  nombre: string;
  ean: string;
  dun14?: string | null;
  unidades_por_caja?: number;
  unidad_medida?: string;
  temperatura_requerida?: string;
  stock_minimo?: number;
  dias_alerta_vencimiento?: number;
  tolerancia_vencimiento_dias?: number;
  controla_vencimiento?: boolean;
  dias_vida_util?: number | null;
  costo_unitario?: number;
  activo?: boolean;
  es_ghost_sku?: boolean;
  proveedor_marca?: string;
  clase_abc?: "A" | "B" | "C" | string;
  es_perecible_corto?: boolean;
  venta_valorizada_ventana?: number;
  unidades_vendidas_ventana?: number;
  participacion_ventas?: number;
  stock_individual: number;
  stock_vitrina?: number;
  stock_bodega?: number;
  proxima_fecha_vencimiento?: string | null;
  alerta_vencimiento?: string;
  lotes?: LoteDetalleFEFO[];
}

export interface CatalogoImportSummaryResponse {
  mensaje: string;
  filas_recibidas: number;
  productos_creados: number;
  productos_actualizados: number;
  filas_fallidas: number;
  errores: string[];
}

export interface StockAgrupadoSubFamilia {
  nombre_sub_familia: string;
  stock_sub_familia: number;
  productos: ProductoDetalleStock[];
}

export interface StockAgrupadoFamilia {
  familia: string;
  stock_global_familia: number;
  sub_familias: StockAgrupadoSubFamilia[];
}

export interface DecoracionPlano {
  id: string;
  tipo: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotacion: number;
  config: any;
}

export interface Patente {
  id_patente: string;
  area_pasillo: string;
  tipo_mueble: string;
  tipo_ubicacion?: string;
  coordenada_x: number;
  coordenada_y: number;
  ancho: number;
  largo: number;
  rotacion?: number;
  url_imagen_planograma?: string | null;
  productos_asignados?: string[];
  submapeo_grid?: any;
}

export interface StockItem {
  sato_id?: string;
  sku: string;
  nombre_producto?: string;
  lote: string;
  cantidad: number;
  fecha_vencimiento?: string | null;
  dias_restantes?: number | null;
  estado_vencimiento?: "OK" | "PROXIMO" | "CRITICO" | "VENCIDO";
  nivel_estante?: number;
  frente_posicion?: number;
  unidad_medida?: string;
}

export interface ComplianceResponse {
  cumplimiento_porcentaje: number | null;
  discrepancias: string[];
  stock_total?: number;
  skus_asignados_count?: number;
  skus_con_stock_count?: number;
  alertas_vencimiento_count?: number;
  vencidos_count?: number;
  skus_en_vitrina_count?: number;
}

export interface PalletReceptionResponse {
  mensaje: string;
  sato_id: string;
  ean_leido: string;
  sku?: string;
  nombre_producto?: string;
  unidades_ingresadas?: number;
  unidades_por_caja?: number;
  es_caja_dun14?: boolean;
  advertencia_temperatura?: string | null;
}

// ─── DECORACIONES PLANO ──────────────────────────────────────────────────

export async function getDecoraciones(): Promise<DecoracionPlano[]> {
  const res = await fetch(`${API_URL}/patentes/decoraciones`, {
    headers: getHeaders(),
  });
  if (!res.ok) throw new Error("Error fetching decoraciones");
  return res.json();
}

export async function createDecoracion(decoracion: DecoracionPlano): Promise<DecoracionPlano> {
  const res = await fetch(`${API_URL}/patentes/decoraciones`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(decoracion),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.detail || "Error creating decoración");
  }
  return res.json();
}

export async function updateDecoracion(id: string, updates: Partial<DecoracionPlano>): Promise<DecoracionPlano> {
  const res = await fetch(`${API_URL}/patentes/decoraciones/${id}`, {
    method: "PATCH",
    headers: getHeaders(),
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.detail || "Error updating decoración");
  }
  return res.json();
}

export async function deleteDecoracion(id: string): Promise<void> {
  const res = await fetch(`${API_URL}/patentes/decoraciones/${id}`, {
    method: "DELETE",
    headers: getHeaders(),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.detail || "Error deleting decoración");
  }
}

// ─── Catálogo ─────────────────────────────────────────────────────────────────

export async function getProductos(): Promise<Producto[]> {
  try {
    const res = await fetch(`${API_URL}/catalogo/productos`, {
      headers: getHeaders(),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(res.statusText);
    return await res.json();
  } catch (e) {
    console.error("getProductos:", e);
    return [];
  }
}

export async function getStockAgrupado(): Promise<StockAgrupadoFamilia[]> {
  try {
    const res = await fetch(`${API_URL}/catalogo/stock-agrupado`, {
      headers: getHeaders(),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(res.statusText);
    return await res.json();
  } catch (e) {
    console.error("getStockAgrupado:", e);
    return [];
  }
}

export async function createProducto(
  producto: Omit<Producto, "tolerancia_vencimiento_dias"> & { tolerancia_vencimiento_dias: number }
): Promise<{ mensaje: string; sku: string }> {
  const res = await fetch(`${API_URL}/catalogo/producto`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(producto),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const detail = Array.isArray(err.detail) ? err.detail.map((d: any) => d.msg).join(", ") : err.detail;
    throw new Error(detail || res.statusText);
  }
  return await res.json();
}

export async function updateProducto(
  sku: string,
  producto: Partial<Producto>
): Promise<{ mensaje: string; sku: string }> {
  const res = await fetch(`${API_URL}/catalogo/producto/${encodeURIComponent(sku)}`, {
    method: "PUT",
    headers: getHeaders(),
    body: JSON.stringify(producto),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const detail = Array.isArray(err.detail) ? err.detail.map((d: any) => d.msg).join(", ") : err.detail;
    throw new Error(detail || res.statusText);
  }
  return await res.json();
}

export async function deleteProducto(sku: string): Promise<{ mensaje: string; sku: string }> {
  const res = await fetch(`${API_URL}/catalogo/producto/${encodeURIComponent(sku)}`, {
    method: "DELETE",
    headers: getHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new ApiHttpError(formatApiDetail(err?.detail, res.statusText || "Error en solicitud API"), res.status);
  }
  return await res.json();
}

export async function importarCatalogoArchivo(file: File): Promise<CatalogoImportSummaryResponse> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${API_URL}/catalogo/import-file`, {
    method: "POST",
    headers: getHeaders(false),
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new ApiHttpError(formatApiDetail(err?.detail, res.statusText || "Error en solicitud API"), res.status);
  }
  return await res.json();
}

export async function ingresarStockCatalogo(
  sku: string,
  payload: CatalogoIngresoStockRequest
): Promise<CatalogoStockMutationResponse> {
  const res = await fetch(`${API_URL}/catalogo/producto/${encodeURIComponent(sku)}/stock`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const detail = Array.isArray(err.detail) ? err.detail.map((d: any) => d.msg).join(", ") : err.detail;
    throw new Error(detail || res.statusText);
  }
  return await res.json();
}

export async function ajustarCantidadLoteCatalogo(
  satoId: string,
  payload: CatalogoAjusteLoteRequest
): Promise<CatalogoStockMutationResponse> {
  const res = await fetch(`${API_URL}/catalogo/lote/${encodeURIComponent(satoId)}/cantidad`, {
    method: "PATCH",
    headers: getHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const detail = Array.isArray(err.detail) ? err.detail.map((d: any) => d.msg).join(", ") : err.detail;
    throw new Error(detail || res.statusText);
  }
  return await res.json();
}

// ─── Patentes ─────────────────────────────────────────────────────────────────

export async function getPatentesStrict(): Promise<Patente[]> {
  const res = await fetch(`${API_URL}/api/v1/patentes/`, {
    headers: getHeaders(),
    cache: "no-store",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new ApiHttpError(formatApiDetail(err?.detail, res.statusText || "Error al consultar patentes"), res.status);
  }
  return await res.json();
}

export async function createPatente(patente: Patente): Promise<Patente> {
  const res = await fetch(`${API_URL}/api/v1/patentes/`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(patente),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new ApiHttpError(formatApiDetail(err?.detail, res.statusText || "Error al crear patente"), res.status);
  }
  return await res.json();
}

export async function updatePatenteSafe(
  id_patente: string,
  payload: Partial<Omit<Patente, "id_patente">>
): Promise<Patente> {
  const res = await fetch(`${API_URL}/api/v1/patentes/${encodeURIComponent(id_patente)}`, {
    method: "PUT",
    headers: getHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new ApiHttpError(formatApiDetail(err?.detail, res.statusText || "Error al actualizar patente"), res.status);
  }
  return await res.json();
}

export async function getStockPatente(id_patente: string): Promise<StockItem[]> {
  try {
    const res = await fetch(`${API_URL}/patentes/${encodeURIComponent(id_patente)}/stock`, {
      headers: getHeaders(),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(res.statusText);
    return await res.json();
  } catch (e) {
    console.error("getStockPatente:", e);
    return [];
  }
}

// ─── Bodega ───────────────────────────────────────────────────────────────────

export async function recepcionarPallet(
  barcode_text: string,
  ubicacion_id?: string,
  modo_ingreso?: "AUTO" | "CAJAS" | "UNIDADES",
  cantidad_recibida?: number
): Promise<PalletReceptionResponse> {
  const res = await fetch(`${API_URL}/bodega/recepcion/pallet`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ barcode_text, ubicacion_id, modo_ingreso, cantidad_recibida }),
  });
  if (!res.ok) {
    let errorMessage = res.statusText;
    try {
      const err = await res.json().catch(() => ({}));
      if (err.detail) errorMessage = err.detail;
    } catch (e) {
      if (res.status === 409) errorMessage = "El pallet o producto ya fue recepcionado.";
    }
    throw new Error(errorMessage);
  }
  return await res.json();
}

export interface LpnReceptionResponse {
  mensaje: string;
  lpn: string;
}

export async function recepcionarLpn(lpn_data: { destino: string, lpn: string, tipo_carga: string, original_barcode: string, ubicacion_id?: string }): Promise<LpnReceptionResponse> {
  const res = await fetch(`${API_URL}/bodega/recepcion/lpn`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(lpn_data),
  });
  if (!res.ok) {
    let errorMessage = res.statusText;
    try {
      const err = await res.json().catch(() => ({}));
      if (err.detail) errorMessage = err.detail;
    } catch (e) {
      if (res.status === 409) errorMessage = "El pallet consolidado (LPN) ya fue recepcionado.";
    }
    throw new Error(errorMessage);
  }
  return await res.json();
}

export async function deletePatente(id_patente: string): Promise<void> {
  const res = await fetch(`${API_URL}/patentes/${encodeURIComponent(id_patente)}`, {
    method: "DELETE",
    headers: getHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new ApiHttpError(formatApiDetail(err?.detail, res.statusText || "Error en solicitud API"), res.status);
  }
}

export interface SatoDisponible {
  sato_id: string;
  sku: string;
  nombre_producto?: string;
  cantidad: number;
  estado: string;
  lote?: string;
  fecha_vencimiento?: string | null;
  dias_restantes?: number | null;
  estado_vencimiento?: "OK" | "PROXIMO" | "CRITICO" | "VENCIDO";
  unidad_medida?: string;
}

export async function getSatosDisponibles(): Promise<SatoDisponible[]> {
  try {
    const res = await fetch(`${API_URL}/bodega/satos/disponibles`, {
      headers: getHeaders(),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(res.statusText);
    return await res.json();
  } catch (e) {
    console.error("getSatosDisponibles:", e);
    return [];
  }
}

export async function moverSatoAVitrina(
  sato_id: string,
  id_patente: string,
  nivel_estante: number = 1,
  frente_posicion: number = 1,
  cantidad_a_mover?: number
): Promise<{
  mensaje: string;
  sato_id: string;
  nueva_ubicacion: string;
  success?: boolean;
  sato_vitrina?: any;
  sato_bodega_restante?: any;
}> {
  const res = await fetch(`${API_URL}/vitrina/${encodeURIComponent(sato_id)}/mover_a_vitrina`, {
    method: "PUT",
    headers: getHeaders(),
    body: JSON.stringify({
      id_patente,
      nivel_estante,
      frente_posicion,
      cantidad_a_mover: cantidad_a_mover && cantidad_a_mover > 0 ? cantidad_a_mover : undefined,
    }),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => null);
    throw new Error(errorData?.detail || res.statusText);
  }
  return await res.json();
}

// ─── Ajustes de Inventario ──────────────────────────────────

export interface SatoRecepcionDetalle {
  sato_id: string;
  sku: string;
  nombre_producto: string;
  lpn_padre?: string;
  cantidad_actual: number;
  estado: string;
}

export interface AjusteInventarioRequest {
  cantidad_a_restar: number;
  motivo: "Faltante de Origen" | "Rotura" | "Merma Operativa" | "Otro";
}

export async function getSatosRecepcion(): Promise<SatoRecepcionDetalle[]> {
  try {
    const res = await fetch(`${API_URL}/bodega/recepcion/satos`, {
      headers: getHeaders(),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(res.statusText);
    return await res.json();
  } catch (e) {
    console.error("getSatosRecepcion:", e);
    return [];
  }
}

export async function ajustarInventario(sato_id: string, request: AjusteInventarioRequest): Promise<{ mensaje: string }> {
  const res = await fetch(`${API_URL}/bodega/satos/${encodeURIComponent(sato_id)}/ajuste`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => null);
    throw new Error(errorData?.detail || res.statusText);
  }
  return await res.json();
}

export async function getComplianceBatch(): Promise<Record<string, ComplianceResponse>> {
  try {
    const res = await fetch(`${API_URL}/patentes/batch/compliance`, {
      headers: getHeaders(),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(res.statusText);
    return await res.json();
  } catch (e) {
    console.error("getComplianceBatch:", e);
    return {};
  }
}

export interface AlertaVencimientoItem {
  sato_id: string;
  sku: string;
  nombre_producto: string;
  lote?: string | null;
  fecha_vencimiento?: string | null;
  dias_restantes: number;
  estado: string;
  ubicacion_id?: string | null;
  cantidad: number;
}

export async function getAlertasVencimiento(diasAlerta: number = 7): Promise<AlertaVencimientoItem[]> {
  try {
    const res = await fetch(`${API_URL}/api/v1/inventario/alertas-vencimiento?dias_alerta=${diasAlerta}`, {
      headers: getHeaders(),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(res.statusText);
    const data = await res.json();
    return Array.isArray(data?.alertas) ? data.alertas : [];
  } catch (e) {
    console.error("getAlertasVencimiento:", e);
    return [];
  }
}

// ─── Outbound & Picking ──────────────────────────────────────

export interface TareaPicking {
  tarea_id: number;
  pedido_id: number;
  sku: string;
  nombre_producto: string;
  cantidad_a_extraer: number;
  estado: string;
  id_patente: string;
  area_pasillo: string;
  nivel_estante: number;
  frente_posicion: number;
}

export interface OlaPickingResponse {
  ola_id: number;
  estado: string;
  total_tareas: number;
  tareas: TareaPicking[];
}

export async function getTareasOla(ola_id: number): Promise<OlaPickingResponse | null> {
  try {
    const res = await fetch(`${API_URL}/outbound/waves/${ola_id}/tareas`, {
      headers: getHeaders(),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(res.statusText);
    return await res.json();
  } catch (e) {
    console.error("getTareasOla:", e);
    return null;
  }
}

export async function completarTarea(tarea_id: number, ean_escaneado: string): Promise<{ mensaje: string; ola_completada: boolean }> {
  const res = await fetch(`${API_URL}/outbound/tareas/${tarea_id}/completar`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ ean_escaneado }),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => null);
    throw new Error(errorData?.detail || res.statusText);
  }
  return await res.json();
}

export async function reportarFaltanteTarea(tarea_id: number): Promise<{ mensaje: string }> {
  const res = await fetch(`${API_URL}/outbound/tareas/${tarea_id}/faltante`, {
    method: "POST",
    headers: getHeaders(),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => null);
    throw new Error(errorData?.detail || res.statusText);
  }
  return await res.json();
}

export const getOlasPicking = async () => {
  const res = await fetch(`${API_URL}/outbound/waves`, {
    headers: getHeaders(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error('Error obteniendo olas');
  return res.json();
};

// ─── Dashboard ───────────────────────────────────────────────────────────────

export interface DashboardKPIs {
  stock_total_unidades: number;
  alertas_vencimiento: number;
  distribucion_inventario: { name: string; value: number }[];
  top_mermas: { sku_nombre: string; cantidad: number }[];
}

export async function getDashboardKPIs(): Promise<DashboardKPIs | null> {
  try {
    const res = await fetch(`${API_URL}/api/v1/dashboard/kpis`, {
      headers: getHeaders(),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(res.statusText);
    return await res.json();
  } catch (e) {
    console.error("getDashboardKPIs:", e);
    return null;
  }
}

// ─── Mapa Bodega (Space Management) ──────────────────────────────────────────

export interface BodegaPatente {
  id_patente: string;
  tipo_ubicacion: string;
  area_pasillo: string;
  coordenada_x: number;
  coordenada_y: number;
  ancho: number;
  largo: number;
  pallets: number;
  unidades: number;
}

export interface BodegaStockSato {
  sato_id: string;
  sku: string;
  nombre: string;
  lpn: string;
  cantidad: number;
  lote?: string;
  fecha_vencimiento?: string;
}

export async function getPatentesBodega(): Promise<BodegaPatente[]> {
  try {
    const res = await fetch(`${API_URL}/api/v1/mapa/bodega`, {
      headers: getHeaders(),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(res.statusText);
    return await res.json();
  } catch (e) {
    console.error("getPatentesBodega:", e);
    return [];
  }
}

export async function getStockBodegaZona(id_patente: string): Promise<BodegaStockSato[]> {
  try {
    const res = await fetch(`${API_URL}/api/v1/mapa/bodega/${encodeURIComponent(id_patente)}/stock`, {
      headers: getHeaders(),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(res.statusText);
    return await res.json();
  } catch (e) {
    console.error("getStockBodegaZona:", e);
    return [];
  }
}

// ─── Conector Universal de Ventas Externas (Omni-POS Ingestion) ───────────────

export interface ExternalSaleItem {
  ean?: string;
  sku?: string;
  cantidad: number;
  precio_unitario?: number;
}

export interface ExternalSaleWebhookPayload {
  external_ticket_id: string;
  pos_source?: string;
  timestamp?: string;
  allow_bodega_fallback?: boolean;
  modo_historico_abc?: boolean;
  items: ExternalSaleItem[];
}

export type ExternalSaleTicket = ExternalSaleWebhookPayload;
export type ExternalSaleWebhookRequest = ExternalSaleWebhookPayload;

export interface ExternalSaleResponse {
  estado: "PROCESADO" | "PARCIAL" | "DUPLICADO" | string;
  estado_procesamiento?: "COMPLETO" | "PARCIAL" | "REVERTIDO" | string;
  mensaje: string;
  external_ticket_id: string;
  pos_source: string;
  total_descontado: number;
  unidades_deficit?: number;
  total_valorizado?: number;
  es_carga_historica?: boolean;
  items_huerfanos_count?: number;
  items_huerfanos?: Array<Record<string, unknown>>;
  satos_afectados: Array<Record<string, unknown>>;
}

export interface ExternalSaleBatchPayload {
  pos_source?: string;
  allow_bodega_fallback?: boolean | null;
  modo_historico_abc?: boolean;
  tickets: ExternalSaleWebhookPayload[];
}

export type ExternalSaleBatchRequest = ExternalSaleBatchPayload;

export interface ExternalSaleBatchResponse {
  mensaje: string;
  pos_source: string;
  tickets_recibidos: number;
  tickets_procesados: number;
  tickets_parciales?: number;
  tickets_duplicados: number;
  tickets_fallidos: number;
  unidades_descontadas: number;
  unidades_deficit?: number;
  total_valorizado?: number;
  items_huerfanos_count?: number;
  es_carga_historica?: boolean;
  detalles_errores: Array<{ external_ticket_id: string; error: string }>;
  errores_parseo: Array<Record<string, unknown>>;
}

export async function importarVentasBatch(
  data: ExternalSaleBatchPayload
): Promise<ExternalSaleBatchResponse> {
  const response = await fetch(`${API_URL}/api/v1/integration/sales/import-batch`, {
    method: "POST",
    headers: getHeaders(),
    cache: "no-store",
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(formatApiDetail(err?.detail, "Error importando lote de ventas externas"));
  }
  return response.json();
}

export async function importarArchivoVentasPos(
  file: File,
  posSource: string = "ARCHIVO_POS",
  allowBodegaFallback?: boolean | null,
  modoHistoricoAbc: boolean = false
): Promise<ExternalSaleBatchResponse> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("pos_source", posSource);
  if (allowBodegaFallback !== undefined && allowBodegaFallback !== null) {
    formData.append("allow_bodega_fallback", String(allowBodegaFallback));
  }
  formData.append("modo_historico_abc", String(modoHistoricoAbc));

  const response = await fetch(`${API_URL}/api/v1/integration/sales/import-file`, {
    method: "POST",
    headers: getHeaders(false),
    cache: "no-store",
    body: formData,
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const detail =
      typeof err.detail === "string"
        ? err.detail
        : err.detail?.mensaje || formatApiDetail(err?.detail, "Error importando archivo de ventas del POS");
    throw new Error(detail || "Error importando archivo de ventas del POS");
  }
  return response.json();
}

export interface ExternalSaleHistoryItem {
  id: number;
  pos_source: string;
  external_ticket_id: string;
  canal: "WEBHOOK_API" | "ARCHIVO" | "BATCH_JSON" | string;
  estado_procesamiento?: "COMPLETO" | "PARCIAL" | "REVERTIDO" | string;
  items_huerfanos_count?: number;
  total_unidades: number;
  unidades_deficit?: number;
  total_valorizado?: number;
  es_carga_historica?: boolean;
  fecha_venta_origen?: string | null;
  fecha_recepcion?: string | null;
  revertido_por?: string | null;
  revertido_at?: string | null;
  motivo_reversion?: string | null;
}

export async function getHistorialVentasExternas(
  canal?: string,
  limit: number = 50
): Promise<ExternalSaleHistoryItem[]> {
  try {
    const params = new URLSearchParams({ limit: String(limit) });
    if (canal) params.set("canal", canal);
    const res = await fetch(`${API_URL}/api/v1/integration/sales/history?${params.toString()}`, {
      headers: getHeaders(),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(res.statusText);
    return await res.json();
  } catch (err) {
    console.error("getHistorialVentasExternas:", err);
    return [];
  }
}

// ─── Etapa 1: Motor ABC Dinámico, Zonas Calientes 2D y Anomalías ─────────────

export interface ZonaAbcSkuTopItem {
  sku: string;
  nombre: string;
  clase_abc: string;
  venta_valorizada_clp: number;
  unidades_vendidas: number;
}

export interface ZonaAbcPatenteItem {
  id_patente: string;
  zona_termica: "CALIENTE_A" | "MEDIA_B" | "FRIA_C" | "SIN_DATOS";
  clase_dominante?: string | null;
  skus_total_count: number;
  skus_a_count: number;
  skus_b_count: number;
  skus_c_count: number;
  venta_valorizada_patente_clp: number;
  unidades_vendidas_patente: number;
  participacion_patente: number;
  anomalias_abiertas_count: number;
  top_skus: ZonaAbcSkuTopItem[];
}

export interface AbcPlanoResumenResponse {
  ventana_w_dias: number;
  venta_total_ventana_clp: number;
  patentes_calientes_a: number;
  patentes_medias_b: number;
  patentes_frias_c: number;
  patentes_sin_datos: number;
  anomalias_abiertas_total: number;
  calculado_at?: string | null;
  patentes: Record<string, ZonaAbcPatenteItem>;
}

export interface AbcRecalculoResponse {
  mensaje: string;
  ventana_w_dias: number;
  total_productos_evaluados: number;
  venta_total_ventana_clp: number;
  unidades_totales_ventana: number;
  conteo_clases: Record<string, number>;
  clase_a_count: number;
  clase_b_count: number;
  clase_c_count: number;
  protegidos_piso_b_count: number;
  calculado_at: string;
}

export interface DiscrepanciaVitrinaRequest {
  sku: string;
  ubicacion_id?: string;
  detalles?: string;
}

export interface ConfigConteoResponse {
  ventana_w_dias: number;
  umbral_a: number;
  umbral_b: number;
  dias_producto_nuevo: number;
  frecuencia_a_dias: number;
  frecuencia_b_dias: number;
  frecuencia_c_dias: number;
  capacidad_diaria_skus: number;
  updated_at?: string | null;
}

export interface ConfigConteoUpdate {
  ventana_w_dias?: number;
  umbral_a?: number;
  umbral_b?: number;
  dias_producto_nuevo?: number;
  frecuencia_a_dias?: number;
  frecuencia_b_dias?: number;
  frecuencia_c_dias?: number;
  capacidad_diaria_skus?: number;
}

export interface AnomaliaStockResponse {
  id: number;
  sku: string;
  nombre_producto?: string | null;
  clase_abc?: string | null;
  ubicacion_id?: string | null;
  tipo: string;
  estado: string;
  unidades_deficit: number;
  referencia_ticket?: string | null;
  detalles?: string | null;
  reportado_por_id?: number | null;
  created_at: string;
  resolved_at?: string | null;
}

export async function getAbcConfig(): Promise<ConfigConteoResponse | null> {
  try {
    const res = await fetch(`${API_URL}/api/v1/abc/config`, {
      headers: getHeaders(),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(res.statusText);
    return await res.json();
  } catch (e) {
    console.error("getAbcConfig:", e);
    return null;
  }
}

export async function updateAbcConfig(payload: ConfigConteoUpdate): Promise<ConfigConteoResponse> {
  const res = await fetch(`${API_URL}/api/v1/abc/config`, {
    method: "PUT",
    headers: getHeaders(),
    cache: "no-store",
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new ApiHttpError(
      formatApiDetail(err?.detail, res.statusText || "Error al actualizar configuración ABC"),
      res.status
    );
  }
  return await res.json();
}

export async function getAnomaliasStock(
  soloAbiertas: boolean = true,
  limit: number = 100
): Promise<AnomaliaStockResponse[]> {
  try {
    const params = new URLSearchParams({
      solo_abiertas: String(soloAbiertas),
      limit: String(limit),
    });
    const res = await fetch(`${API_URL}/api/v1/abc/anomalias?${params.toString()}`, {
      headers: getHeaders(),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(res.statusText);
    return await res.json();
  } catch (e) {
    console.error("getAnomaliasStock:", e);
    return [];
  }
}

export async function getZonasAbcPatentes(): Promise<AbcPlanoResumenResponse | null> {
  try {
    const res = await fetch(`${API_URL}/api/v1/abc/zonas-patentes`, {
      headers: getHeaders(),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(res.statusText);
    return await res.json();
  } catch (e) {
    console.error("getZonasAbcPatentes:", e);
    return null;
  }
}

export async function recalcularAbc(): Promise<AbcRecalculoResponse> {
  const res = await fetch(`${API_URL}/api/v1/abc/recalcular`, {
    method: "POST",
    headers: getHeaders(),
    cache: "no-store",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new ApiHttpError(
      formatApiDetail(err?.detail, res.statusText || "Error al recalcular clasificación ABC"),
      res.status
    );
  }
  return await res.json();
}

export async function reportarDiscrepanciaVitrina(
  payload: DiscrepanciaVitrinaRequest
): Promise<AnomaliaStockResponse> {
  const res = await fetch(`${API_URL}/api/v1/abc/discrepancia-vitrina`, {
    method: "POST",
    headers: getHeaders(),
    cache: "no-store",
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new ApiHttpError(
      formatApiDetail(err?.detail, res.statusText || "Error al reportar discrepancia en vitrina"),
      res.status
    );
  }
  return await res.json();
}

// ─── Etapa 2: Flujos Rápidos en Origen (RF-01: PLU Interno y Merma Rápida) ───

export interface CodigoInternoResponse {
  sku_sugerido: string;
  ean_interno: string;
  correlativo: number;
  prefijo_sku: string;
}

export interface MermaRapidaRequest {
  sku?: string | null;
  ean?: string | null;
  sato_id?: string | null;
  cantidad: number;
  motivo: string;
  origen?: "VITRINA" | "BODEGA" | "AUTO";
  ubicacion_id?: string | null;
  comentarios?: string | null;
}

export interface MermaRapidaSatoAfectado {
  sato_id: string;
  lote?: string | null;
  estado_origen: string;
  ubicacion_id?: string | null;
  unidades_descontadas: number;
  cantidad_restante: number;
  nuevo_estado: string;
}

export interface MermaRapidaResponse {
  mensaje: string;
  sku: string;
  nombre_producto: string;
  cantidad_registrada: number;
  motivo: string;
  origen_aplicado: string;
  ubicacion_id?: string | null;
  costo_unitario_clp: number;
  valor_merma_clp: number;
  satos_afectados: MermaRapidaSatoAfectado[];
}

export interface MermaHistorialItem {
  log_id: number;
  sato_id?: string | null;
  sku: string;
  nombre_producto: string;
  lote?: string | null;
  ubicacion_id?: string | null;
  cantidad: number;
  motivo: string;
  comentarios?: string | null;
  costo_unitario_clp: number;
  valor_merma_clp: number;
  usuario_id?: number | null;
  fecha: string;
}

export async function generarCodigoInternoPlu(
  prefijo: string = "PLU"
): Promise<CodigoInternoResponse> {
  const res = await fetch(
    `${API_URL}/api/v1/catalogo/generar-codigo-interno?prefijo=${encodeURIComponent(prefijo)}`,
    {
      headers: getHeaders(),
      cache: "no-store",
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new ApiHttpError(
      formatApiDetail(err?.detail, res.statusText || "Error al generar código interno PLU"),
      res.status
    );
  }
  return await res.json();
}

export async function declararMermaRapida(
  payload: MermaRapidaRequest
): Promise<MermaRapidaResponse> {
  const res = await fetch(`${API_URL}/api/v1/merma/rapida`, {
    method: "POST",
    headers: getHeaders(),
    cache: "no-store",
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new ApiHttpError(
      formatApiDetail(err?.detail, res.statusText || "Error al registrar merma rápida"),
      res.status
    );
  }
  return await res.json();
}

export async function getHistorialMermas(
  limit: number = 50
): Promise<MermaHistorialItem[]> {
  try {
    const res = await fetch(`${API_URL}/api/v1/merma/historial?limit=${limit}`, {
      headers: getHeaders(),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(res.statusText);
    return await res.json();
  } catch (e) {
    console.error("getHistorialMermas:", e);
    return [];
  }
}

// ─── Etapa 3: Onboarding Adaptativo (Tenant.settings), Omni-POS v2 y Dashboard Real ───

export interface TenantBusinessProfile {
  scale: "minimarket" | "supermercado";
  has_separate_warehouse_map: boolean;
  uses_gs1_128_fefo: boolean;
}

export interface TenantPosStrategy {
  mode: "modern_pos" | "legacy_file_pos" | "reference_pos";
  accepted_no_sii_disclaimer: boolean;
  external_provider?: string | null;
  fallback_to_warehouse_on_zero_shelf: boolean;
}

export interface TenantSettingsResponse {
  tenant_id: string;
  nombre_local: string;
  onboarding_completed: boolean;
  business_profile: TenantBusinessProfile;
  pos_strategy: TenantPosStrategy;
  enabled_modules: string[];
}

export interface TenantSettingsUpdate {
  nombre_local?: string | null;
  onboarding_completed?: boolean | null;
  business_profile?: TenantBusinessProfile | null;
  pos_strategy?: TenantPosStrategy | null;
  enabled_modules?: string[] | null;
}

function getTenantSettingsCacheKey(): string {
  const tid =
    (typeof window !== "undefined" ? localStorage.getItem("tenant_id") : null) ||
    process.env.NEXT_PUBLIC_DEFAULT_TENANT_ID ||
    "default-tenant";
  return `bvcore_tenant_settings_${tid}`;
}

export function getCachedTenantSettings(): TenantSettingsResponse | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(getTenantSettingsCacheKey());
    if (!raw) return null;
    return JSON.parse(raw) as TenantSettingsResponse;
  } catch {
    return null;
  }
}

export function setCachedTenantSettings(settings: TenantSettingsResponse): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(getTenantSettingsCacheKey(), JSON.stringify(settings));
    window.dispatchEvent(new CustomEvent("bvcore:tenant-settings-updated", { detail: settings }));
  } catch {
    // ignore storage errors
  }
}

export async function getTenantSettings(): Promise<TenantSettingsResponse | null> {
  try {
    const res = await fetch(`${API_URL}/api/v1/tenant/settings`, {
      headers: getHeaders(),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(res.statusText);
    const data: TenantSettingsResponse = await res.json();
    setCachedTenantSettings(data);
    return data;
  } catch (e) {
    console.error("getTenantSettings:", e);
    return getCachedTenantSettings();
  }
}

export async function updateTenantSettings(
  payload: TenantSettingsUpdate
): Promise<TenantSettingsResponse> {
  const res = await fetch(`${API_URL}/api/v1/tenant/settings`, {
    method: "PUT",
    headers: getHeaders(),
    cache: "no-store",
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new ApiHttpError(
      formatApiDetail(err?.detail, res.statusText || "Error al guardar la configuración del local"),
      res.status
    );
  }
  const data: TenantSettingsResponse = await res.json();
  setCachedTenantSettings(data);
  return data;
}

export interface DryRunUnknownCodeItem {
  codigo_original: string;
  tipo_codigo: string;
  unidades_totales: number;
  boletas_afectadas: number;
}

export interface ExternalSaleDryRunResponse {
  archivo_nombre: string;
  pos_source: string;
  modo_historico_abc: boolean;
  fallback_bodega_activo: boolean;
  tickets_totales_leidos: number;
  boletas_nuevas_a_procesar: number;
  boletas_duplicadas_omitidas: number;
  boletas_parciales_con_huerfanos: number;
  boletas_sin_catalogo_100: number;
  unidades_a_descontar: number;
  valorizado_estimado_clp: number;
  codigos_desconocidos: DryRunUnknownCodeItem[];
  errores_parseo: Array<Record<string, unknown>>;
}

export async function dryRunArchivoVentasPos(
  file: File,
  posSource: string = "ARCHIVO_POS",
  allowBodegaFallback?: boolean | null,
  modoHistoricoAbc: boolean = false
): Promise<ExternalSaleDryRunResponse> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("pos_source", posSource);
  if (allowBodegaFallback !== undefined && allowBodegaFallback !== null) {
    formData.append("allow_bodega_fallback", String(allowBodegaFallback));
  }
  formData.append("modo_historico_abc", String(modoHistoricoAbc));

  const res = await fetch(`${API_URL}/api/v1/integration/sales/import-file/dry-run`, {
    method: "POST",
    headers: getHeaders(false),
    cache: "no-store",
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(formatApiDetail(err?.detail, "Error al analizar el archivo de ventas"));
  }
  return await res.json();
}

export interface OrphanCodeGroupItem {
  codigo_original: string;
  tipo_codigo: string;
  unidades_pendientes: number;
  boletas_afectadas: number;
  precio_unitario_sugerido: number;
  primera_deteccion?: string | null;
  tickets_muestra: string[];
}

export interface CrearProductoRapidoHuerfano {
  sku: string;
  nombre: string;
  ean?: string | null;
  precio?: number;
  costo_unitario?: number;
  temperatura_requerida?: string;
}

export interface ResolveOrphanRequest {
  codigo_original: string;
  accion: "VINCULAR_EXISTENTE" | "CREAR_PRODUCTO";
  sku_existente?: string | null;
  actualizar_ean_producto?: boolean;
  nuevo_producto?: CrearProductoRapidoHuerfano | null;
}

export interface ResolveOrphanResponse {
  mensaje: string;
  codigo_original: string;
  sku_vinculado: string;
  nombre_producto: string;
  registros_resueltos: number;
  boletas_actualizadas_a_completo: number;
  unidades_descontadas_retroactivas: number;
  unidades_deficit: number;
}

export async function getOrphanSalesCodes(): Promise<OrphanCodeGroupItem[]> {
  try {
    const res = await fetch(`${API_URL}/api/v1/integration/sales/orphans`, {
      headers: getHeaders(),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(res.statusText);
    return await res.json();
  } catch (e) {
    console.error("getOrphanSalesCodes:", e);
    return [];
  }
}

export async function resolveOrphanSalesCode(
  payload: ResolveOrphanRequest
): Promise<ResolveOrphanResponse> {
  const res = await fetch(`${API_URL}/api/v1/integration/sales/orphans/resolve`, {
    method: "POST",
    headers: getHeaders(),
    cache: "no-store",
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new ApiHttpError(
      formatApiDetail(err?.detail, res.statusText || "Error al resolver código en cuarentena"),
      res.status
    );
  }
  return await res.json();
}

export interface ExternalSaleTicketItemDetail {
  sku: string;
  nombre_producto: string;
  ean?: string | null;
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
  unidades_descontadas: number;
  unidades_deficit: number;
}

export interface ExternalSaleTicketFefoLotDetail {
  id: number;
  sku: string;
  nombre_producto: string;
  sato_id?: string | null;
  lote?: string | null;
  ubicacion_id?: string | null;
  nombre_ubicacion?: string | null;
  estado_origen: string;
  fecha_vencimiento?: string | null;
  unidades_descontadas: number;
}

export interface ExternalSaleTicketOrphanDetail {
  id: number;
  codigo_original: string;
  tipo_codigo: string;
  cantidad: number;
  precio_unitario: number;
  estado: string;
  sku_vinculado?: string | null;
}

export interface ExternalSaleTicketDetailResponse {
  id: number;
  pos_source: string;
  external_ticket_id: string;
  canal: string;
  estado_procesamiento: string;
  total_unidades: number;
  unidades_deficit: number;
  total_valorizado: number;
  es_carga_historica: boolean;
  items_huerfanos_count: number;
  fecha_venta_origen?: string | null;
  fecha_recepcion?: string | null;
  revertido_por?: string | null;
  revertido_at?: string | null;
  motivo_reversion?: string | null;
  puede_revertirse: boolean;
  motivo_bloqueo_reversion?: string | null;
  items: ExternalSaleTicketItemDetail[];
  descuentos_fefo: ExternalSaleTicketFefoLotDetail[];
  huerfanos: ExternalSaleTicketOrphanDetail[];
}

export interface RevertirVentaRequest {
  motivo: string;
}

export interface RevertirVentaResponse {
  mensaje: string;
  venta_id: number;
  external_ticket_id: string;
  estado_procesamiento: string;
  unidades_restituidas: number;
  satos_restituidos_count: number;
  anomalias_cerradas_count: number;
  revertido_por: string;
  revertido_at: string;
}

export async function getDetalleVentaExterna(
  ventaId: number
): Promise<ExternalSaleTicketDetailResponse> {
  const res = await fetch(`${API_URL}/api/v1/integration/sales/${ventaId}/detalle`, {
    headers: getHeaders(),
    cache: "no-store",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(formatApiDetail(err?.detail, "Error obteniendo detalle de la boleta"));
  }
  return await res.json();
}

export async function revertirVentaExterna(
  ventaId: number,
  motivo: string
): Promise<RevertirVentaResponse> {
  const res = await fetch(`${API_URL}/api/v1/integration/sales/${ventaId}/revertir`, {
    method: "POST",
    headers: getHeaders(),
    cache: "no-store",
    body: JSON.stringify({ motivo }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new ApiHttpError(
      formatApiDetail(err?.detail, res.statusText || "Error al revertir la boleta"),
      res.status
    );
  }
  return await res.json();
}

export interface DashboardRadarFefoItem {
  sato_id: string;
  sku: string;
  nombre_producto: string;
  lote: string;
  ubicacion_id?: string | null;
  nombre_ubicacion: string;
  estado: string;
  cantidad: number;
  fecha_vencimiento?: string | null;
  dias_restantes: number;
  valor_riesgo_clp: number;
}

export interface DashboardAlertasOperativas {
  anomalias_abiertas_count: number;
  skus_huerfanos_pendientes_count: number;
  lotes_por_vencer_7d_count: number;
  productos_bajo_minimo_count: number;
}

export interface DashboardDesempenoMensualItem {
  mes: string;
  Ganancias: number;
  Perdidas: number;
}

export interface DashboardKpisResponse {
  stock_total_unidades: number;
  stock_vitrina_unidades: number;
  stock_bodega_unidades: number;
  alertas_vencimiento: number;
  lotes_riesgo_vencimiento_count: number;
  perdida_proyectada_clp: number;
  ventas_hoy_clp: number;
  ventas_hoy_unidades: number;
  ventas_hoy_tickets: number;
  ventas_ayer_tickets: number;
  distribucion_inventario: Array<{ name: string; value: number }>;
  top_mermas: Array<{ sku_nombre: string; cantidad: number }>;
  radar_fefo_items: DashboardRadarFefoItem[];
  alertas_operativas: DashboardAlertasOperativas;
  desempeno_mensual: DashboardDesempenoMensualItem[];
}

export async function getDashboardKpis(): Promise<DashboardKpisResponse | null> {
  try {
    const res = await fetch(`${API_URL}/api/v1/dashboard/kpis`, {
      headers: getHeaders(),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(res.statusText);
    return await res.json();
  } catch (e) {
    console.error("getDashboardKpis:", e);
    return null;
  }
}

// ─── Trazabilidad y Árbol Genealógico SATO ──────────────────────────────────

export interface TrazabilidadLogItem {
  id: number;
  fecha_hora: string;
  accion: string;
  detalles: string | null;
  usuario: string;
  lpn_sku_afectado: string | null;
  sato_id: string;
}

export interface TrazabilidadLogResponse {
  items: TrazabilidadLogItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface SatoArbolNode {
  sato_id: string;
  tipo_sato: string;
  lpn: string | null;
  sku: string | null;
  cantidad: number | null;
  estado: string;
  hijos: SatoArbolNode[];
}

export async function getLogsTrazabilidad(params: {
  q?: string;
  accion?: string;
  fecha_inicio?: string;
  fecha_fin?: string;
  limit?: number;
  offset?: number;
}): Promise<TrazabilidadLogResponse> {
  const qs = new URLSearchParams();
  if (params.q) qs.set("q", params.q);
  if (params.accion) qs.set("accion", params.accion);
  if (params.fecha_inicio) qs.set("fecha_inicio", params.fecha_inicio);
  if (params.fecha_fin) qs.set("fecha_fin", params.fecha_fin);
  qs.set("limit", String(params.limit ?? 20));
  qs.set("offset", String(params.offset ?? 0));

  const res = await fetch(`${API_URL}/logs/?${qs.toString()}`, {
    headers: getHeaders(),
    cache: "no-store",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new ApiHttpError(
      formatApiDetail(err?.detail, res.statusText || "Error al consultar logs de trazabilidad"),
      res.status
    );
  }
  return await res.json();
}

export async function getArbolSato(satoId: string): Promise<SatoArbolNode> {
  const res = await fetch(`${API_URL}/logs/sato/${encodeURIComponent(satoId)}/arbol`, {
    headers: getHeaders(),
    cache: "no-store",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new ApiHttpError(
      formatApiDetail(err?.detail, res.statusText || "Error al consultar árbol genealógico del SATO"),
      res.status
    );
  }
  return await res.json();
}


