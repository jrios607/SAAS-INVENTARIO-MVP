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
  categoria: string;
  tolerancia_vencimiento_dias?: number;
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
