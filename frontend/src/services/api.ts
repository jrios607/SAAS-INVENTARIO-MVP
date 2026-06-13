const getApiUrl = () => {
  if (typeof window !== "undefined") {
    return `http://${window.location.hostname}:8000`;
  }
  return process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
};

const API_URL = getApiUrl();

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

export interface Patente {
  id_patente: string;
  area_pasillo: string;
  tipo_mueble: string;
  coordenada_x: number;
  coordenada_y: number;
  ancho: number;
  largo: number;
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

// ─── Catálogo ─────────────────────────────────────────────────────────────────

export async function getProductos(): Promise<Producto[]> {
  try {
    const res = await fetch(`${API_URL}/catalogo/productos`, {
      headers: { "Content-Type": "application/json" },
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
      headers: { "Content-Type": "application/json" },
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
    headers: { "Content-Type": "application/json" },
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
      headers: { "Content-Type": "application/json" },
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
    headers: { "Content-Type": "application/json" },
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
    headers: { "Content-Type": "application/json" },
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
      headers: { "Content-Type": "application/json" },
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
      headers: { "Content-Type": "application/json" },
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

export async function recepcionarPallet(barcode_text: string): Promise<PalletReceptionResponse> {
  const res = await fetch(`${API_URL}/bodega/recepcion/pallet`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ barcode_text }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || res.statusText);
  }
  return await res.json();
}

export interface LpnReceptionResponse {
  mensaje: string;
  lpn: string;
}

export async function recepcionarLpn(lpn_data: { destino: string, lpn: string, tipo_carga: string, original_barcode: string }): Promise<LpnReceptionResponse> {
  const res = await fetch(`${API_URL}/bodega/recepcion/lpn`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(lpn_data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || res.statusText);
  }
  return await res.json();
}

export async function deletePatente(id_patente: string): Promise<void> {
  const res = await fetch(`${API_URL}/patentes/${encodeURIComponent(id_patente)}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
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
      headers: { "Content-Type": "application/json" },
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
    headers: { "Content-Type": "application/json" },
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
      headers: { "Content-Type": "application/json" },
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => null);
    throw new Error(errorData?.detail || res.statusText);
  }
  return await res.json();
}
