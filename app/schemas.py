import uuid
from datetime import date, datetime
from typing import Optional, List, Dict, Any, Literal
from pydantic import BaseModel, Field

# ─── Catálogo ───────────────────────────────────────────────

class ProductoBase(BaseModel):
    sku: str
    nombre: str
    ean: str
    familia: Optional[str] = None
    sub_familia: Optional[str] = None
    proveedor_marca: Optional[str] = None
    categoria: Optional[str] = None
    tolerancia_vencimiento_dias: int = 0

class ProductoCreate(ProductoBase):
    pass

class ProductoModel(ProductoBase):
    class Config:
        from_attributes = True

class ProductoResponse(BaseModel):
    mensaje: str
    sku: str

class ProductoDetalleStock(BaseModel):
    sku: str
    nombre: str
    ean: str
    proveedor_marca: Optional[str] = None
    stock_individual: int

class StockAgrupadoSubFamilia(BaseModel):
    nombre_sub_familia: str
    stock_sub_familia: int
    productos: List[ProductoDetalleStock]

class StockAgrupadoFamilia(BaseModel):
    familia: str
    stock_global_familia: int
    sub_familias: List[StockAgrupadoSubFamilia]

# ─── Bodega ─────────────────────────────────────────────────

class PalletReceptionRequest(BaseModel):
    barcode_text: str

class PalletReceptionResponse(BaseModel):
    mensaje: str
    sato_id: uuid.UUID
    ean_leido: str

class ComplianceResponse(BaseModel):
    cumplimiento_porcentaje: float
    discrepancias: List[str]

# ─── Recepción (LPN) ────────────────────────────────────────────────

# ─── Vitrina ────────────────────────────────────────────────

class SatoFraccionarRequest(BaseModel):
    sato_padre_id: uuid.UUID
    cantidad_a_mover: int
    planograma_destino_id: Optional[str] = None

class SatoFraccionarResponse(BaseModel):
    mensaje: str
    sato_hijo_id: uuid.UUID

class SatoMoverVitrinaRequest(BaseModel):
    id_patente: str
    nivel_estante: int
    frente_posicion: int

class SatoMoverVitrinaResponse(BaseModel):
    mensaje: str
    sato_id: uuid.UUID
    nueva_ubicacion: str

# ─── Patentes ───────────────────────────────────────────────

class PatenteCreate(BaseModel):
    id_patente: str
    area_pasillo: str
    tipo_mueble: str
    coordenada_x: int
    coordenada_y: int
    ancho: int
    largo: int
    url_imagen_planograma: Optional[str] = None
    productos_asignados: Optional[List[str]] = []
    submapeo_grid: Optional[Dict[str, Any]] = None

class PatenteResponse(BaseModel):
    id_patente: str
    area_pasillo: str
    tipo_mueble: str
    coordenada_x: int
    coordenada_y: int
    ancho: int
    largo: int
    url_imagen_planograma: Optional[str] = None
    productos_asignados: Optional[List[str]] = []
    submapeo_grid: Optional[Dict[str, Any]] = None

    class Config:
        from_attributes = True

class PatenteUpdate(BaseModel):
    """Schema para actualización parcial de coordenadas desde el mapa 2D."""
    area_pasillo: Optional[str] = None
    tipo_mueble: Optional[str] = None
    coordenada_x: Optional[int] = None
    coordenada_y: Optional[int] = None
    ancho: Optional[int] = None
    largo: Optional[int] = None
    url_imagen_planograma: Optional[str] = None
    productos_asignados: Optional[List[str]] = None
    submapeo_grid: Optional[Dict[str, Any]] = None

class StockPatenteResponse(BaseModel):
    sku: Optional[str] = None
    lote: Optional[str] = None
    cantidad: Optional[int] = None
    fecha_vencimiento: Optional[date] = None
    nivel_estante: Optional[int] = None
    frente_posicion: Optional[int] = None

    class Config:
        from_attributes = True

# ─── Caja ───────────────────────────────────────────────────

class VentaCajaRequest(BaseModel):
    ean_producto: str
    cantidad_vendida: int = Field(..., gt=0)

class VentaCajaResponse(BaseModel):
    mensaje: str
    cantidad_total_vendida: int
    satos_afectados: List[Dict[str, Any]]

# ─── Merma ──────────────────────────────────────────────────

class MermaRequest(BaseModel):
    sato_id: uuid.UUID
    cantidad: int = Field(..., gt=0)
    motivo: Literal["Vencimiento", "Dañado", "Robo", "Otro"]
    comentarios: Optional[str] = None

class MermaResponse(BaseModel):
    mensaje: str
    sato_id: uuid.UUID
    cantidad_registrada: int

# ─── Ajustes de Inventario ──────────────────────────────────

class AjusteInventarioRequest(BaseModel):
    cantidad_a_restar: int = Field(..., gt=0)
    motivo: Literal["Faltante de Origen", "Rotura", "Merma Operativa", "Otro"]

class SatoRecepcionDetalle(BaseModel):
    sato_id: uuid.UUID
    sku: str
    nombre_producto: str
    lpn_padre: Optional[str] = None
    cantidad_actual: int
    estado: str

    class Config:
        from_attributes = True

# ─── Auditoría ──────────────────────────────────────────────

class AuditoriaConteoRequest(BaseModel):
    ean_producto: str
    id_patente: str
    lote_impreso: str
    cantidad_fisica_real: int = Field(..., ge=0)

class AuditoriaConteoResponse(BaseModel):
    mensaje: str
    sato_id: uuid.UUID
    cantidad_anterior: int
    cantidad_nueva: int
    diferencia: int

# ─── LPN (Pallet Consolidado) ──────────────────────────────

class LpnReceptionRequest(BaseModel):
    lpn: str
    destino: str
    tipo_carga: str
    original_barcode: Optional[str] = None

class LpnReceptionResponse(BaseModel):
    mensaje: str
    sato_padre_id: uuid.UUID
    lpn_registrado: str
    bultos_creados: int = 0

# ─── Inyección ASN (Integración) ────────────────────────────

class AsnInyeccionDetalle(BaseModel):
    sku: str
    cantidad: int = Field(..., gt=0)
    lote: Optional[str] = None
    fecha_vencimiento: Optional[date] = None

class AsnInyeccionRequest(BaseModel):
    lpn: str
    origen: str
    detalles: List[AsnInyeccionDetalle]

# ─── Trazabilidad (Logs) ────────────────────────────────────

class LogTransaccionalItem(BaseModel):
    id: int
    fecha_hora: datetime
    accion: str
    detalles: Optional[str] = None
    usuario: str
    lpn_sku_afectado: Optional[str] = None
    sato_id: uuid.UUID

    class Config:
        from_attributes = True

class LogTransaccionalResponse(BaseModel):
    items: List[LogTransaccionalItem]
    total: int
    limit: int
    offset: int