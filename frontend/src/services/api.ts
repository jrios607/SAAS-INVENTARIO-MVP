const getApiUrl = () => {
  return process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
};

const API_URL = getApiUrl();

const DEFAULT_HEADERS = {
  "Content-Type": "application/json",
  "Bypass-Tunnel-Reminder": "true",
  "ngrok-skip-browser-warning": "true"
};

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface Producto {
  sku: string;
  nombre: string;
  ean: string;
  categoria?: string;
  familia?: string;
  sub_familia?: string;
  proveedor_marca?: string;
  tolerancia_vencimiento_dias?: number;
}

export interface ProductoDetalleStock {
  sku: string;
  nombre: string;
  ean: string;
  proveedor_marca?: string;
  stock_individual: number;
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
  sku: string;
  lote: string;
  cantidad: number;
  fecha_vencimiento: string;
  nivel_estante?: number;
  frente_posicion?: number;
}

export interface ComplianceResponse {
  cumplimiento_porcentaje: number;
  discrepancias: string[];
}

export interface PalletReceptionResponse {
  mensaje: string;
  sato_id: string;
  ean_leido: string;
}

// ─── DECORACIONES PLANO ──────────────────────────────────────────────────

export async function getDecoraciones(): Promise<DecoracionPlano[]> {
  const res = await fetch(`${API_URL}/patentes/decoraciones`);
  if (!res.ok) throw new Error("Error fetching decoraciones");
  return res.json();
}

export async function createDecoracion(decoracion: DecoracionPlano): Promise<DecoracionPlano> {
  const res = await fetch(`${API_URL}/patentes/decoraciones`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
    headers: { "Content-Type": "application/json" },
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
      headers: DEFAULT_HEADERS,
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
      headers: DEFAULT_HEADERS,
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
    headers: DEFAULT_HEADERS,
    body: JSON.stringify(producto),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || res.statusText);
  }
  return await res.json();
}

// ─── Patentes ─────────────────────────────────────────────────────────────────

export async function getPatentes(): Promise<Patente[]> {
  try {
    const res = await fetch(`${API_URL}/patentes/`, {
      headers: DEFAULT_HEADERS,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(res.statusText);
    return await res.json();
  } catch (e) {
    console.error("getPatentes:", e);
    return [];
  }
}

export async function createPatente(patente: Patente): Promise<Patente> {
  const res = await fetch(`${API_URL}/patentes/`, {
    method: "POST",
    headers: DEFAULT_HEADERS,
    body: JSON.stringify(patente),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || res.statusText);
  }
  return await res.json();
}

export async function updatePatente(
  id_patente: string,
  payload: Partial<Omit<Patente, "id_patente">>
): Promise<Patente> {
  const res = await fetch(`${API_URL}/patentes/${encodeURIComponent(id_patente)}`, {
    method: "PUT",
    headers: DEFAULT_HEADERS,
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || res.statusText);
  }
  return await res.json();
}

export async function getStockPatente(id_patente: string): Promise<StockItem[]> {
  try {
    const res = await fetch(`${API_URL}/patentes/${encodeURIComponent(id_patente)}/stock`, {
      headers: DEFAULT_HEADERS,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(res.statusText);
    return await res.json();
  } catch (e) {
    console.error("getStockPatente:", e);
    return [];
  }
}

export async function getPatenteCompliance(id_patente: string): Promise<ComplianceResponse | null> {
  try {
    const res = await fetch(`${API_URL}/patentes/${encodeURIComponent(id_patente)}/compliance`, {
      headers: DEFAULT_HEADERS,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(res.statusText);
    return await res.json();
  } catch (e) {
    console.error("getPatenteCompliance:", e);
    return null;
  }
}

// ─── Bodega ───────────────────────────────────────────────────────────────────

export async function recepcionarPallet(barcode_text: string, ubicacion_id?: string): Promise<PalletReceptionResponse> {
  const res = await fetch(`${API_URL}/bodega/recepcion/pallet`, {
    method: "POST",
    headers: DEFAULT_HEADERS,
    body: JSON.stringify({ barcode_text, ubicacion_id }),
  });
  if (!res.ok) {
    let errorMessage = res.statusText;
    try {
      const err = await res.json();
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
    headers: DEFAULT_HEADERS,
    body: JSON.stringify(lpn_data),
  });
  if (!res.ok) {
    let errorMessage = res.statusText;
    try {
      const err = await res.json();
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
    headers: DEFAULT_HEADERS,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || res.statusText);
  }
}

export interface SatoDisponible {
  sato_id: string;
  sku: string;
  cantidad: number;
  estado: string;
  lote?: string;
  fecha_vencimiento?: string;
}

export async function getSatosDisponibles(): Promise<SatoDisponible[]> {
  try {
    const res = await fetch(`${API_URL}/bodega/satos/disponibles`, {
      headers: DEFAULT_HEADERS,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(res.statusText);
    return await res.json();
  } catch (e) {
    console.error("getSatosDisponibles:", e);
    return [];
  }
}

export async function moverSatoAVitrina(sato_id: string, id_patente: string, nivel_estante: number, frente_posicion: number): Promise<{ mensaje: string; sato_id: string; nueva_ubicacion: string }> {
  const res = await fetch(`${API_URL}/vitrina/${encodeURIComponent(sato_id)}/mover_a_vitrina`, {
    method: "PUT",
    headers: DEFAULT_HEADERS,
    body: JSON.stringify({ id_patente, nivel_estante, frente_posicion }),
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
      headers: DEFAULT_HEADERS,
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
    headers: DEFAULT_HEADERS,
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
      headers: DEFAULT_HEADERS,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(res.statusText);
    return await res.json();
  } catch (e) {
    console.error("getComplianceBatch:", e);
    return {};
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
      headers: DEFAULT_HEADERS,
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
    headers: DEFAULT_HEADERS,
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
    headers: DEFAULT_HEADERS,
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => null);
    throw new Error(errorData?.detail || res.statusText);
  }
  return await res.json();
}

export const getOlasPicking = async () => {
  const res = await fetch(`${API_URL}/outbound/waves`);
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
      headers: DEFAULT_HEADERS,
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
      headers: DEFAULT_HEADERS,
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
      headers: DEFAULT_HEADERS,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(res.statusText);
    return await res.json();
  } catch (e) {
    console.error("getStockBodegaZona:", e);
    return [];
  }
}

// ─── POS (Point of Sale) ────────────────────────────────────────────────────────

export interface PosScanRequest {
  ean: string;
}

export interface PosScanResponse {
  sku: string;
  nombre: string;
  precio: number;
  cantidad_disponible: number;
}

export interface PosCheckoutItem {
  ean: string;
  cantidad: number;
}

export interface PosCheckoutRequest {
  items: PosCheckoutItem[];
}

export interface PosCheckoutResponse {
  mensaje: string;
  total_descontado: number;
}

export async function posScan(data: PosScanRequest): Promise<PosScanResponse> {
  const response = await fetch(`${API_URL}/pos/scan`, {
    method: "POST",
    headers: DEFAULT_HEADERS,
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.detail || "Error en escaneo POS");
  }
  return response.json();
}

export async function posCheckout(data: PosCheckoutRequest): Promise<PosCheckoutResponse> {
  const response = await fetch(`${API_URL}/pos/checkout`, {
    method: "POST",
    headers: DEFAULT_HEADERS,
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.detail || "Error procesando checkout");
  }
  return response.json();
}

export interface PosSyncTicket {
  id_ticket: string;
  timestamp: string;
  items: PosCheckoutItem[];
}

export interface PosSyncRequest {
  tickets: PosSyncTicket[];
}

export interface PosSyncResponse {
  mensaje: string;
  tickets_procesados: number;
  tickets_fallidos: number;
  detalles_fallos: any[];
}

export async function posSyncOffline(data: PosSyncRequest): Promise<PosSyncResponse> {
  const response = await fetch(`${API_URL}/pos/sync`, {
    method: "POST",
    headers: DEFAULT_HEADERS,
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.detail || "Error sincronizando tickets offline");
  }
  return response.json();
}
