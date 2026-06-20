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
    controla_vencimiento: bool = False
    dias_vida_util: Optional[int] = None
    precio: int = 0

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
    ubicacion_id: Optional[str] = None

class PalletReceptionResponse(BaseModel):
    mensaje: str
    sato_id: uuid.UUID
    ean_leido: str

class ComplianceResponse(BaseModel):
    cumplimiento_porcentaje: Optional[float] = None
    discrepancias: List[str]

class SatoModel(BaseModel):
    sato_id: uuid.UUID
    padre_id: Optional[uuid.UUID] = None
    tipo_sato: str
    lpn: Optional[str] = None
    sku: Optional[str] = None
    cantidad: Optional[int] = None
    estado: str
    fecha_elaboracion: Optional[date] = None
    fecha_vencimiento: Optional[date] = None

    class Config:
        from_attributes = True

# ─── Recepción (LPN) ────────────────────────────────────────────────

class LpnReceptionRequest(BaseModel):
    lpn: str
    destino: str
    tipo_carga: str
    original_barcode: str
    ubicacion_id: Optional[str] = None

class LpnReceptionResponse(BaseModel):
    mensaje: str
    sato_padre_id: uuid.UUID
    lpn_registrado: str
    bultos_creados: int

class AjusteInventarioRequest(BaseModel):
    cantidad_a_restar: int
    motivo: str
    url_foto: Optional[str] = None

class SatoRecepcionDetalle(BaseModel):
    sato_id: uuid.UUID
    sku: Optional[str] = None
    nombre_producto: Optional[str] = None
    lpn_padre: Optional[str] = None
    cantidad_actual: Optional[int] = None
    estado: str

    class Config:
        from_attributes = True


# ─── Merma ─────────────────────────────────────────────────

class MermaRequest(BaseModel):
    sato_id: uuid.UUID
    cantidad: int
    motivo: str
    comentarios: Optional[str] = None

class MermaResponse(BaseModel):
    mensaje: str
    sato_id: uuid.UUID
    cantidad_registrada: int

# ─── Inventario / Alertas ───────────────────────────────────

class AlertaVencimientoItem(BaseModel):
    sato_id: uuid.UUID
    sku: str
    nombre_producto: str
    lote: Optional[str] = None
    fecha_vencimiento: Optional[date] = None
    dias_restantes: int
    estado: str
    ubicacion_id: Optional[str] = None
    cantidad: int

    class Config:
        from_attributes = True

class AlertaVencimientoResponse(BaseModel):
    alertas: List[AlertaVencimientoItem]

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
    rotacion: Optional[float] = 0.0
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
    rotacion: Optional[float] = 0.0
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
    rotacion: Optional[float] = None
    url_imagen_planograma: Optional[str] = None
    productos_asignados: Optional[List[str]] = None
    submapeo_grid: Optional[Dict[str, Any]] = None

class DecoracionPlanoCreate(BaseModel):
    id: str
    tipo: str
    x: float = 0.0
    y: float = 0.0
    w: float = 100.0
    h: float = 50.0
    rotacion: float = 0.0
    config: Optional[Dict[str, Any]] = {}

class DecoracionPlanoUpdate(BaseModel):
    x: Optional[float] = None
    y: Optional[float] = None
    w: Optional[float] = None
    h: Optional[float] = None
    rotacion: Optional[float] = None
    config: Optional[Dict[str, Any]] = None

class DecoracionPlanoResponse(DecoracionPlanoCreate):
    class Config:
        from_attributes = True

class StockPatenteResponse(BaseModel):
    sku: Optional[str] = None
    lote: Optional[str] = None
    cantidad: Optional[int] = None
    fecha_vencimiento: Optional[date] = None
    nivel_estante: Optional[int] = None
    frente_posicion: Optional[int] = None

    class Config:
        from_attributes = True

# ─── ASN (Inbound) ──────────────────────────────────────────

class AsnDetalleItem(BaseModel):
    sku: str
    cantidad: int
    lote: Optional[str] = None
    fecha_vencimiento: Optional[date] = None

class AsnInyeccionRequest(BaseModel):
    lpn: str
    origen: str
    detalles: List[AsnDetalleItem]

# ─── Outbound / Picking ─────────────────────────────────────

class GenerarOlaRequest(BaseModel):
    pedido_ids: List[int]

class TareaPickingItem(BaseModel):
    tarea_id: int
    pedido_id: int
    sku: str
    nombre_producto: str
    sato_id: uuid.UUID
    cantidad_a_extraer: int
    estado: str
    id_patente: str
    area_pasillo: str
    nivel_estante: Optional[int] = None
    frente_posicion: Optional[int] = None

    class Config:
        from_attributes = True

class OlaPickingResponse(BaseModel):
    ola_id: int
    estado: str
    total_tareas: int
    tareas: List[TareaPickingItem]

class CompletarTareaRequest(BaseModel):
    ean_escaneado: str

# ─── Trazabilidad ───────────────────────────────────────────

class TrazabilidadSatoItem(BaseModel):
    sato_id: uuid.UUID
    estado: str
    cantidad: int
    ubicacion_id: Optional[str] = None
    fecha_vencimiento: Optional[date] = None

    class Config:
        from_attributes = True

class TrazabilidadLoteResponse(BaseModel):
    lote: str
    sku: str
    nombre_producto: str
    cantidad_total: int
    satos: List[TrazabilidadSatoItem]
