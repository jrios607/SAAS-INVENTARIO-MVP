import re
import uuid
from datetime import date, datetime
from typing import Optional, List, Dict, Any, Literal
from pydantic import BaseModel, Field, ConfigDict, field_validator, model_validator

_SKU_CODE_RE = re.compile(r"^[A-Za-z0-9._-]+$")
_DANGEROUS_HTML_RE = re.compile(r"(<\s*/?\s*(script|svg|iframe|object|embed|img|link|style|meta)\b|on\w+\s*=|javascript\s*:)", re.IGNORECASE)
_FORMULA_INJECTION_RE = re.compile(r"^\s*[=+\-@|]")


def _sanitize_text_field(val: Optional[str], field_name: str, allow_empty: bool = True) -> Optional[str]:
    if val is None:
        return None
    cleaned = val.strip()
    if not cleaned:
        if allow_empty:
            return None
        raise ValueError(f"El campo '{field_name}' no puede estar vacío ni contener solo espacios.")
    if "\x00" in cleaned:
        raise ValueError(f"El campo '{field_name}' contiene caracteres nulos inválidos.")
    if _DANGEROUS_HTML_RE.search(cleaned):
        raise ValueError(f"El campo '{field_name}' contiene etiquetas HTML o scripts no permitidos.")
    if _FORMULA_INJECTION_RE.match(cleaned):
        raise ValueError(f"El campo '{field_name}' no puede comenzar con caracteres de fórmula (=, +, -, @).")
    return cleaned


# ─── Catálogo ───────────────────────────────────────────────

class ProductoBase(BaseModel):
    sku: str
    nombre: str
    ean: str
    dun14: Optional[str] = None
    unidades_por_caja: int = 1
    unidad_medida: str = "UN"
    temperatura_requerida: str = "SECO"
    stock_minimo: int = 5
    dias_alerta_vencimiento: int = 7
    familia: Optional[str] = None
    sub_familia: Optional[str] = None
    proveedor_marca: Optional[str] = None
    categoria: Optional[str] = None
    tolerancia_vencimiento_dias: int = 0
    controla_vencimiento: bool = False
    dias_vida_util: Optional[int] = None
    costo_unitario: int = 0
    precio: int = 0
    activo: bool = True
    clase_abc: str = "B"
    es_perecible_corto: bool = False
    venta_valorizada_ventana: int = 0
    unidades_vendidas_ventana: int = 0
    participacion_ventas: float = 0.0


class ProductoCreate(BaseModel):
    sku: str = Field(..., min_length=1, max_length=64)
    nombre: str = Field(..., min_length=1, max_length=200)
    ean: str = Field(..., min_length=3, max_length=32)
    dun14: Optional[str] = Field(default=None, max_length=32)
    unidades_por_caja: int = Field(default=1, ge=1, le=10000)
    unidad_medida: str = Field(default="UN", max_length=16)
    temperatura_requerida: str = Field(default="SECO", max_length=32)
    stock_minimo: int = Field(default=5, ge=0, le=1_000_000)
    dias_alerta_vencimiento: int = Field(default=7, ge=0, le=3650)
    familia: Optional[str] = Field(default=None, max_length=100)
    sub_familia: Optional[str] = Field(default=None, max_length=100)
    proveedor_marca: Optional[str] = Field(default=None, max_length=120)
    categoria: Optional[str] = Field(default=None, max_length=100)
    tolerancia_vencimiento_dias: int = Field(default=0, ge=0, le=3650)
    controla_vencimiento: bool = False
    dias_vida_util: Optional[int] = Field(default=None, ge=1, le=36500)
    costo_unitario: int = Field(default=0, ge=0, le=100_000_000)
    precio: int = Field(default=0, ge=0, le=100_000_000)
    activo: bool = True
    es_perecible_corto: bool = False
    # Campos opcionales de Carga Inicial de Stock (Día 1 del Minimarket)
    stock_inicial: int = Field(default=0, ge=0, le=1_000_000)
    modo_stock_inicial: str = Field(default="UNIDADES", max_length=16)
    estado_stock_inicial: str = Field(default="Vitrina", max_length=32)
    ubicacion_stock_inicial: Optional[str] = Field(default=None, max_length=64)
    fecha_vencimiento_inicial: Optional[date] = None
    lote_inicial: Optional[str] = Field(default=None, max_length=64)

    @field_validator("sku")
    @classmethod
    def validate_sku(cls, v: str) -> str:
        cleaned = _sanitize_text_field(v, "sku", allow_empty=False)
        assert cleaned is not None
        if not _SKU_CODE_RE.match(cleaned):
            raise ValueError("El SKU solo puede contener letras, números, guiones (-), guiones bajos (_) y puntos (.).")
        return cleaned

    @field_validator("ean")
    @classmethod
    def validate_ean(cls, v: str) -> str:
        cleaned = _sanitize_text_field(v, "ean", allow_empty=False)
        assert cleaned is not None
        if not _SKU_CODE_RE.match(cleaned) or len(cleaned) < 3:
            raise ValueError("El código EAN/GS1 debe tener al menos 3 caracteres alfanuméricos válidos.")
        return cleaned

    @field_validator("dun14")
    @classmethod
    def validate_dun14(cls, v: Optional[str]) -> Optional[str]:
        cleaned = _sanitize_text_field(v, "dun14", allow_empty=True)
        if cleaned is None:
            return None
        if not _SKU_CODE_RE.match(cleaned) or len(cleaned) < 6:
            raise ValueError("El código DUN-14 debe tener entre 6 y 32 caracteres válidos.")
        return cleaned

    @field_validator("nombre")
    @classmethod
    def validate_nombre(cls, v: str) -> str:
        cleaned = _sanitize_text_field(v, "nombre", allow_empty=False)
        assert cleaned is not None
        return cleaned

    @field_validator("familia", "sub_familia", "proveedor_marca", "categoria")
    @classmethod
    def validate_optional_text(cls, v: Optional[str], info) -> Optional[str]:
        return _sanitize_text_field(v, info.field_name, allow_empty=True)


class ProductoUpdate(BaseModel):
    nombre: Optional[str] = Field(default=None, min_length=1, max_length=200)
    ean: Optional[str] = Field(default=None, min_length=3, max_length=32)
    dun14: Optional[str] = Field(default=None, max_length=32)
    unidades_por_caja: Optional[int] = Field(default=None, ge=1, le=10000)
    unidad_medida: Optional[str] = Field(default=None, max_length=16)
    temperatura_requerida: Optional[str] = Field(default=None, max_length=32)
    stock_minimo: Optional[int] = Field(default=None, ge=0, le=1_000_000)
    dias_alerta_vencimiento: Optional[int] = Field(default=None, ge=0, le=3650)
    familia: Optional[str] = Field(default=None, max_length=100)
    sub_familia: Optional[str] = Field(default=None, max_length=100)
    proveedor_marca: Optional[str] = Field(default=None, max_length=120)
    categoria: Optional[str] = Field(default=None, max_length=100)
    tolerancia_vencimiento_dias: Optional[int] = Field(default=None, ge=0, le=3650)
    controla_vencimiento: Optional[bool] = None
    dias_vida_util: Optional[int] = Field(default=None, ge=1, le=36500)
    costo_unitario: Optional[int] = Field(default=None, ge=0, le=100_000_000)
    precio: Optional[int] = Field(default=None, ge=0, le=100_000_000)
    activo: Optional[bool] = None
    es_perecible_corto: Optional[bool] = None

    @field_validator("ean")
    @classmethod
    def validate_ean(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        cleaned = _sanitize_text_field(v, "ean", allow_empty=False)
        assert cleaned is not None
        if not _SKU_CODE_RE.match(cleaned) or len(cleaned) < 3:
            raise ValueError("El código EAN/GS1 debe tener al menos 3 caracteres alfanuméricos válidos.")
        return cleaned

    @field_validator("dun14")
    @classmethod
    def validate_dun14(cls, v: Optional[str]) -> Optional[str]:
        cleaned = _sanitize_text_field(v, "dun14", allow_empty=True)
        if cleaned is None:
            return None
        if not _SKU_CODE_RE.match(cleaned) or len(cleaned) < 6:
            raise ValueError("El código DUN-14 debe tener entre 6 y 32 caracteres válidos.")
        return cleaned

    @field_validator("nombre")
    @classmethod
    def validate_nombre(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        return _sanitize_text_field(v, "nombre", allow_empty=False)

    @field_validator("familia", "sub_familia", "proveedor_marca", "categoria")
    @classmethod
    def validate_optional_text(cls, v: Optional[str], info) -> Optional[str]:
        return _sanitize_text_field(v, info.field_name, allow_empty=True)


class ProductoModel(ProductoBase):
    model_config = ConfigDict(from_attributes=True)


class ProductoResponse(BaseModel):
    mensaje: str
    sku: str


class LoteDetalleFEFO(BaseModel):
    sato_id: str
    id_lote: str
    proveedor: str
    fecha_vencimiento: Optional[str] = None
    dias_restantes: Optional[int] = None
    estado_vencimiento: str = "OK"  # "VENCIDO" | "CRITICO" | "PROXIMO" | "OK" | "SIN_VENCIMIENTO"
    ubicacion: str
    estado_sato: str
    stock: int


class ProductoDetalleStock(BaseModel):
    sku: str
    nombre: str
    ean: str
    dun14: Optional[str] = None
    unidades_por_caja: int = 1
    unidad_medida: str = "UN"
    temperatura_requerida: str = "SECO"
    stock_minimo: int = 5
    dias_alerta_vencimiento: int = 7
    tolerancia_vencimiento_dias: int = 0
    controla_vencimiento: bool = False
    dias_vida_util: Optional[int] = None
    costo_unitario: int = 0
    activo: bool = True
    clase_abc: str = "B"
    es_perecible_corto: bool = False
    venta_valorizada_ventana: int = 0
    unidades_vendidas_ventana: int = 0
    participacion_ventas: float = 0.0
    es_ghost_sku: bool = False
    proveedor_marca: Optional[str] = None
    stock_individual: int
    stock_vitrina: int = 0
    stock_bodega: int = 0
    proxima_fecha_vencimiento: Optional[str] = None
    alerta_vencimiento: str = "OK"
    lotes: List[LoteDetalleFEFO] = Field(default_factory=list)


class StockAgrupadoSubFamilia(BaseModel):
    nombre_sub_familia: str
    stock_sub_familia: int
    productos: List[ProductoDetalleStock]


class StockAgrupadoFamilia(BaseModel):
    familia: str
    stock_global_familia: int
    sub_familias: List[StockAgrupadoSubFamilia]


class CatalogoImportSummaryResponse(BaseModel):
    mensaje: str
    filas_recibidas: int
    productos_creados: int
    productos_actualizados: int
    filas_fallidas: int
    errores: List[str] = Field(default_factory=list)


class CatalogoIngresoStockRequest(BaseModel):
    cantidad: int = Field(..., ge=1, le=1_000_000)
    modo_ingreso: str = Field(default="UNIDADES", max_length=16, description="UNIDADES | CAJAS")
    estado_destino: str = Field(default="Vitrina", max_length=32, description="Vitrina | Bodega")
    ubicacion_id: Optional[str] = Field(default=None, max_length=64)
    lote: Optional[str] = Field(default=None, max_length=64)
    fecha_vencimiento: Optional[date] = None
    motivo: str = Field(default="Ingreso Rápido desde Catálogo", max_length=120)


class CatalogoAjusteLoteRequest(BaseModel):
    nueva_cantidad: int = Field(..., ge=0, le=1_000_000)
    modo_cantidad: str = Field(default="UNIDADES", max_length=16, description="UNIDADES | CAJAS")
    estado_destino: Optional[str] = Field(default=None, max_length=32)
    ubicacion_id: Optional[str] = Field(default=None, max_length=64)
    fecha_vencimiento: Optional[date] = None
    lote: Optional[str] = Field(default=None, max_length=64)
    motivo: str = Field(default="Conteo Físico / Ajuste Manual", max_length=120)


class CatalogoStockMutationResponse(BaseModel):
    mensaje: str
    sato_id: str
    sku: str
    cantidad_anterior: int
    cantidad_nueva: int
    diferencia: int
    estado: str


# ─── Bodega ─────────────────────────────────────────────────

class PalletReceptionRequest(BaseModel):
    barcode_text: str = Field(..., max_length=150, description="Lectura láser GS1-128")
    ubicacion_id: Optional[str] = None
    modo_ingreso: Optional[str] = Field(default="AUTO", description="AUTO | CAJAS | UNIDADES")
    cantidad_recibida: Optional[int] = Field(default=None, ge=1, le=100000, description="Cantidad de cajas o unidades")


class PalletReceptionResponse(BaseModel):
    mensaje: str
    sato_id: uuid.UUID
    ean_leido: str
    sku: Optional[str] = None
    nombre_producto: Optional[str] = None
    unidades_ingresadas: Optional[int] = None
    unidades_por_caja: Optional[int] = None
    es_caja_dun14: Optional[bool] = None

class ComplianceResponse(BaseModel):
    cumplimiento_porcentaje: Optional[float] = None
    discrepancias: List[str] = Field(default_factory=list)
    stock_total: Optional[int] = 0
    skus_asignados_count: Optional[int] = 0
    skus_con_stock_count: Optional[int] = 0
    alertas_vencimiento_count: Optional[int] = 0
    vencidos_count: Optional[int] = 0

class SatoModel(BaseModel):
    sato_id: uuid.UUID
    padre_id: Optional[uuid.UUID] = None
    tipo_sato: str
    lpn: Optional[str] = None
    sku: Optional[str] = None
    nombre_producto: Optional[str] = None
    lote: Optional[str] = None
    ubicacion_id: Optional[str] = None
    cantidad: Optional[int] = None
    estado: str
    fecha_elaboracion: Optional[date] = None
    fecha_vencimiento: Optional[date] = None
    dias_restantes: Optional[int] = None
    estado_vencimiento: Optional[str] = None
    unidad_medida: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)

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
    cantidad_a_restar: int = Field(..., gt=0, le=100000)
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

    @field_validator("cantidad")
    @classmethod
    def validate_merma_cantidad_positiva(cls, v: int) -> int:
        if v <= 0 or v > 100000:
            raise ValueError("La cantidad debe ser un entero positivo (1..100000).")
        return v

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

_URL_RE = re.compile(r"^(https?://|/[A-Za-z0-9_.-]+)", re.IGNORECASE)

def _validate_image_url(val: Optional[str]) -> Optional[str]:
    if not val:
        return None
    cleaned = val.strip()
    if not cleaned:
        return None
    if "\x00" in cleaned or _DANGEROUS_HTML_RE.search(cleaned):
        raise ValueError("URL de imagen de planograma inválida o peligrosa.")
    if not _URL_RE.match(cleaned):
        raise ValueError("URL de imagen debe comenzar con 'http://', 'https://' o ruta relativa '/'.")
    if len(cleaned) > 500:
        raise ValueError("URL de imagen excede el límite de 500 caracteres.")
    return cleaned

def _validate_submapeo_grid(val: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if val is None:
        return None
    if not isinstance(val, dict):
        raise ValueError("submapeo_grid debe ser un objeto JSON.")
    if "nombre_display" in val and val["nombre_display"] is not None:
        if not isinstance(val["nombre_display"], str):
            raise ValueError("submapeo_grid.nombre_display debe ser texto.")
        val["nombre_display"] = _sanitize_text_field(val["nombre_display"], "nombre_display", allow_empty=True)
    if "filas" in val and not (isinstance(val["filas"], int) and 1 <= val["filas"] <= 100):
        raise ValueError("submapeo_grid.filas debe ser un entero entre 1 y 100.")
    if "columnas" in val and not (isinstance(val["columnas"], int) and 1 <= val["columnas"] <= 100):
        raise ValueError("submapeo_grid.columnas debe ser un entero entre 1 y 100.")
    if "celdas" in val:
        if not isinstance(val["celdas"], list):
            raise ValueError("submapeo_grid.celdas debe ser una lista.")
        for idx, celda in enumerate(val["celdas"]):
            if not isinstance(celda, dict):
                raise ValueError(f"submapeo_grid.celdas[{idx}] debe ser un objeto.")
            if "coordenadas" in celda:
                coords = celda["coordenadas"]
                if not (isinstance(coords, (list, tuple)) and len(coords) == 2 and isinstance(coords[0], int) and isinstance(coords[1], int)):
                    raise ValueError(f"submapeo_grid.celdas[{idx}].coordenadas debe ser [fila, columna] de 2 enteros.")
    return val

def _validate_decoracion_config(val: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if val is None:
        return {}
    if not isinstance(val, dict):
        raise ValueError("config debe ser un diccionario.")
    import json
    if len(json.dumps(val)) > 16384:
        raise ValueError("El tamaño de config excede el límite máximo de 16KB.")
    for k, v in val.items():
        if isinstance(v, str) and _DANGEROUS_HTML_RE.search(v):
            raise ValueError(f"El valor de config.{k} contiene HTML o scripts no permitidos.")
    return val

# ─── Vitrina ────────────────────────────────────────────────

class SatoFraccionarRequest(BaseModel):
    sato_padre_id: uuid.UUID
    cantidad_a_mover: int = Field(..., gt=0, le=100000, description="Cantidad a mover a la vitrina")
    planograma_destino_id: Optional[str] = Field(None, max_length=64, description="ID de la patente de destino")
    nivel_estante: Optional[int] = Field(default=1, ge=1, le=100, description="Nivel de estante (piso)")
    frente_posicion: Optional[int] = Field(default=1, ge=1, le=100, description="Posición de frente")

class SatoFraccionarResponse(BaseModel):
    mensaje: str
    sato_hijo_id: uuid.UUID

class SatoMoverVitrinaRequest(BaseModel):
    sato_id: Optional[uuid.UUID] = Field(default=None, description="ID del SATO a mover")
    id_patente: str = Field(..., min_length=1, max_length=64, description="ID de la patente de destino")
    nivel_estante: Optional[int] = Field(default=1, ge=1, le=100, description="Nivel de estante (default: 1)")
    frente_posicion: Optional[int] = Field(default=1, ge=1, le=100, description="Posición de frente (default: 1)")
    cantidad_a_mover: Optional[int] = Field(default=None, gt=0, le=100000, description="Opcional: unidades a mover si es fraccionamiento")
    cantidad: Optional[int] = Field(default=None, gt=0, le=100000, description="Alias para cantidad_a_mover")

    @field_validator("id_patente")
    @classmethod
    def validate_id_patente(cls, v: str) -> str:
        cleaned = _sanitize_text_field(v, "id_patente", allow_empty=False)
        assert cleaned is not None
        if not _SKU_CODE_RE.match(cleaned):
            raise ValueError("id_patente debe ser alfanumérico válido.")
        return cleaned

class SatoMoverVitrinaResponse(BaseModel):
    mensaje: str
    sato_id: uuid.UUID
    nueva_ubicacion: str
    success: bool = True
    sato_vitrina: Optional[Dict[str, Any]] = None
    sato_bodega_restante: Optional[Dict[str, Any]] = None

# ─── Patentes ───────────────────────────────────────────────

class PatenteCreate(BaseModel):
    id_patente: str = Field(..., min_length=1, max_length=64, description="Identificador único del mueble")
    area_pasillo: str = Field(..., min_length=1, max_length=64, description="Área o pasillo del supermercado")
    tipo_mueble: str = Field(default="Gondola", min_length=1, max_length=64, description="Gondola, Vitrina Frío, Isla, etc.")
    tipo_ubicacion: Optional[str] = Field(default="SALA_VENTA", max_length=32, description="SALA_VENTA, BODEGA_SECOS, etc.")
    coordenada_x: int = Field(default=0, ge=-10000, le=100000)
    coordenada_y: int = Field(default=0, ge=-10000, le=100000)
    ancho: int = Field(default=1, ge=1, le=5000)
    largo: int = Field(default=1, ge=1, le=5000)
    rotacion: Optional[float] = Field(default=0.0, ge=-360.0, le=360.0)
    url_imagen_planograma: Optional[str] = Field(default=None, max_length=500)
    productos_asignados: Optional[List[str]] = Field(default_factory=list)
    submapeo_grid: Optional[Dict[str, Any]] = None

    @field_validator("id_patente")
    @classmethod
    def validate_id(cls, v: str) -> str:
        cleaned = _sanitize_text_field(v, "id_patente", allow_empty=False)
        assert cleaned is not None
        if not _SKU_CODE_RE.match(cleaned):
            raise ValueError("El ID de patente solo puede contener caracteres alfanuméricos, guiones o puntos.")
        return cleaned

    @field_validator("area_pasillo", "tipo_mueble", "tipo_ubicacion")
    @classmethod
    def validate_text_fields(cls, v: Optional[str], info) -> Optional[str]:
        return _sanitize_text_field(v, info.field_name, allow_empty=False)

    @field_validator("url_imagen_planograma")
    @classmethod
    def validate_url(cls, v: Optional[str]) -> Optional[str]:
        return _validate_image_url(v)

    @field_validator("submapeo_grid")
    @classmethod
    def validate_submap(cls, v: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        return _validate_submapeo_grid(v)

class PatenteResponse(BaseModel):
    id_patente: str
    area_pasillo: str
    tipo_mueble: str
    tipo_ubicacion: Optional[str] = "SALA_VENTA"
    coordenada_x: int
    coordenada_y: int
    ancho: int
    largo: int
    rotacion: Optional[float] = 0.0
    url_imagen_planograma: Optional[str] = None
    productos_asignados: Optional[List[str]] = Field(default_factory=list)
    submapeo_grid: Optional[Dict[str, Any]] = None

    model_config = ConfigDict(from_attributes=True)

class PatenteUpdate(BaseModel):
    """Schema para actualización parcial de coordenadas y configuración desde el mapa 2D."""
    area_pasillo: Optional[str] = Field(default=None, min_length=1, max_length=64)
    tipo_mueble: Optional[str] = Field(default=None, min_length=1, max_length=64)
    tipo_ubicacion: Optional[str] = Field(default=None, max_length=32)
    coordenada_x: Optional[int] = Field(default=None, ge=-10000, le=100000)
    coordenada_y: Optional[int] = Field(default=None, ge=-10000, le=100000)
    ancho: Optional[int] = Field(default=None, ge=1, le=5000)
    largo: Optional[int] = Field(default=None, ge=1, le=5000)
    rotacion: Optional[float] = Field(default=None, ge=-360.0, le=360.0)
    url_imagen_planograma: Optional[str] = Field(default=None, max_length=500)
    productos_asignados: Optional[List[str]] = None
    submapeo_grid: Optional[Dict[str, Any]] = None

    @field_validator("area_pasillo", "tipo_mueble", "tipo_ubicacion")
    @classmethod
    def validate_text_fields(cls, v: Optional[str], info) -> Optional[str]:
        return _sanitize_text_field(v, info.field_name, allow_empty=True)

    @field_validator("url_imagen_planograma")
    @classmethod
    def validate_url(cls, v: Optional[str]) -> Optional[str]:
        return _validate_image_url(v)

    @field_validator("submapeo_grid")
    @classmethod
    def validate_submap(cls, v: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        return _validate_submapeo_grid(v)

class DecoracionPlanoCreate(BaseModel):
    id: str = Field(..., min_length=1, max_length=64, description="ID único de la decoración")
    tipo: str = Field(default="TEXTO", min_length=1, max_length=32)
    x: float = Field(default=0.0, ge=-10000.0, le=100000.0)
    y: float = Field(default=0.0, ge=-10000.0, le=100000.0)
    w: float = Field(default=100.0, ge=10.0, le=10000.0)
    h: float = Field(default=50.0, ge=10.0, le=10000.0)
    rotacion: float = Field(default=0.0, ge=-360.0, le=360.0)
    config: Optional[Dict[str, Any]] = Field(default_factory=dict)

    @field_validator("id")
    @classmethod
    def validate_id(cls, v: str) -> str:
        cleaned = _sanitize_text_field(v, "id", allow_empty=False)
        assert cleaned is not None
        if not _SKU_CODE_RE.match(cleaned):
            raise ValueError("El ID de decoración solo puede contener caracteres alfanuméricos, guiones o puntos.")
        return cleaned

    @field_validator("tipo")
    @classmethod
    def validate_tipo(cls, v: str) -> str:
        cleaned = _sanitize_text_field(v, "tipo", allow_empty=False)
        assert cleaned is not None
        return cleaned

    @field_validator("config")
    @classmethod
    def validate_config(cls, v: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        return _validate_decoracion_config(v)

class DecoracionPlanoUpdate(BaseModel):
    x: Optional[float] = Field(default=None, ge=-10000.0, le=100000.0)
    y: Optional[float] = Field(default=None, ge=-10000.0, le=100000.0)
    w: Optional[float] = Field(default=None, ge=10.0, le=10000.0)
    h: Optional[float] = Field(default=None, ge=10.0, le=10000.0)
    rotacion: Optional[float] = Field(default=None, ge=-360.0, le=360.0)
    config: Optional[Dict[str, Any]] = None

    @field_validator("config")
    @classmethod
    def validate_config(cls, v: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        return _validate_decoracion_config(v)

class DecoracionPlanoResponse(DecoracionPlanoCreate):
    model_config = ConfigDict(from_attributes=True)

class StockPatenteResponse(BaseModel):
    sato_id: Optional[uuid.UUID] = None
    sku: Optional[str] = None
    nombre_producto: Optional[str] = None
    lote: Optional[str] = None
    cantidad: Optional[int] = None
    fecha_vencimiento: Optional[date] = None
    dias_restantes: Optional[int] = None
    estado_vencimiento: Optional[str] = None
    nivel_estante: Optional[int] = None
    frente_posicion: Optional[int] = None
    unidad_medida: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)

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


# ─── Etapa 1: Motor ABC Dinámico, Zonas Calientes y Anomalías ───────────────

class ConfigConteoResponse(BaseModel):
    ventana_w_dias: int = 90
    umbral_a: float = 0.80
    umbral_b: float = 0.95
    dias_producto_nuevo: int = 30
    frecuencia_a_dias: int = 14
    frecuencia_b_dias: int = 30
    frecuencia_c_dias: int = 90
    capacidad_diaria_skus: int = 20
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class ConfigConteoUpdate(BaseModel):
    ventana_w_dias: Optional[int] = Field(default=None, ge=1, le=365)
    umbral_a: Optional[float] = Field(default=None, gt=0.0, lt=1.0)
    umbral_b: Optional[float] = Field(default=None, gt=0.0, le=1.0)
    dias_producto_nuevo: Optional[int] = Field(default=None, ge=0, le=365)
    frecuencia_a_dias: Optional[int] = Field(default=None, ge=1, le=365)
    frecuencia_b_dias: Optional[int] = Field(default=None, ge=1, le=365)
    frecuencia_c_dias: Optional[int] = Field(default=None, ge=1, le=365)
    capacidad_diaria_skus: Optional[int] = Field(default=None, ge=1, le=5000)

    @model_validator(mode="after")
    def validate_umbrales_orden(self):
        if self.umbral_a is not None and self.umbral_b is not None and self.umbral_a >= self.umbral_b:
            raise ValueError("umbral_a debe ser estrictamente menor que umbral_b.")
        return self


class AbcRecalculoResponse(BaseModel):
    mensaje: str
    ventana_w_dias: int
    total_productos_evaluados: int
    venta_total_ventana_clp: int
    unidades_totales_ventana: int
    conteo_clases: Dict[str, int]
    clase_a_count: int = 0
    clase_b_count: int = 0
    clase_c_count: int = 0
    protegidos_piso_b_count: int = 0
    calculado_at: datetime


class ZonaAbcSkuTopItem(BaseModel):
    sku: str
    nombre: str
    clase_abc: str = "B"
    venta_valorizada_clp: int = 0
    unidades_vendidas: int = 0


class ZonaAbcPatenteItem(BaseModel):
    id_patente: str
    zona_termica: Literal["CALIENTE_A", "MEDIA_B", "FRIA_C", "SIN_DATOS"]
    clase_dominante: Optional[str] = None
    skus_total_count: int = 0
    skus_a_count: int = 0
    skus_b_count: int = 0
    skus_c_count: int = 0
    venta_valorizada_patente_clp: int = 0
    unidades_vendidas_patente: int = 0
    participacion_patente: float = 0.0
    anomalias_abiertas_count: int = 0
    top_skus: List[ZonaAbcSkuTopItem] = Field(default_factory=list)


class AbcPlanoResumenResponse(BaseModel):
    ventana_w_dias: int = 90
    venta_total_ventana_clp: int = 0
    patentes_calientes_a: int = 0
    patentes_medias_b: int = 0
    patentes_frias_c: int = 0
    patentes_sin_datos: int = 0
    anomalias_abiertas_total: int = 0
    calculado_at: Optional[datetime] = None
    patentes: Dict[str, ZonaAbcPatenteItem] = Field(default_factory=dict)


class DiscrepanciaVitrinaRequest(BaseModel):
    sku: str = Field(..., min_length=1, max_length=64)
    ubicacion_id: Optional[str] = Field(default=None, max_length=64)
    detalles: Optional[str] = Field(default=None, max_length=500)

    @field_validator("sku")
    @classmethod
    def validate_sku(cls, v: str) -> str:
        cleaned = _sanitize_text_field(v, "sku", allow_empty=False)
        assert cleaned is not None
        if not _SKU_CODE_RE.match(cleaned):
            raise ValueError("El SKU contiene caracteres inválidos.")
        return cleaned

    @field_validator("ubicacion_id")
    @classmethod
    def validate_ubicacion(cls, v: Optional[str]) -> Optional[str]:
        cleaned = _sanitize_text_field(v, "ubicacion_id", allow_empty=True)
        if cleaned is not None and not _SKU_CODE_RE.match(cleaned):
            raise ValueError("ubicacion_id contiene caracteres inválidos.")
        return cleaned

    @field_validator("detalles")
    @classmethod
    def validate_detalles(cls, v: Optional[str]) -> Optional[str]:
        return _sanitize_text_field(v, "detalles", allow_empty=True)


class AnomaliaStockResponse(BaseModel):
    id: int
    sku: str
    nombre_producto: Optional[str] = None
    clase_abc: Optional[str] = None
    ubicacion_id: Optional[str] = None
    tipo: str
    estado: str
    unidades_deficit: int = 0
    referencia_ticket: Optional[str] = None
    detalles: Optional[str] = None
    reportado_por_id: Optional[int] = None
    created_at: datetime
    resolved_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


# ─── Etapa 2: Flujos Rápidos en Origen (RF-01 PLU Interno y Merma 3 Toques) ─────

class CodigoInternoResponse(BaseModel):
    sku_sugerido: str
    ean_interno: str
    correlativo: int
    prefijo_sku: str = "PLU"


MOTIVOS_MERMA_ESTANDAR = (
    "VENCIDO",
    "ROTURA_DANO",
    "DETERIORO_CADENA_FRIO",
    "MERMA_CORTE_GRANEL",
    "ROBO_HURTO_DETECTADO",
    "OTRO",
)


class MermaRapidaRequest(BaseModel):
    sku: Optional[str] = Field(default=None, max_length=64)
    ean: Optional[str] = Field(default=None, max_length=64)
    sato_id: Optional[uuid.UUID] = Field(default=None)
    cantidad: int = Field(..., gt=0, le=100_000)
    motivo: str = Field(..., min_length=2, max_length=64)
    origen: Literal["VITRINA", "BODEGA", "AUTO"] = Field(default="AUTO")
    ubicacion_id: Optional[str] = Field(default=None, max_length=64)
    comentarios: Optional[str] = Field(default=None, max_length=300)

    @field_validator("sku")
    @classmethod
    def validate_sku(cls, v: Optional[str]) -> Optional[str]:
        cleaned = _sanitize_text_field(v, "sku", allow_empty=True)
        if cleaned is not None and not _SKU_CODE_RE.match(cleaned):
            raise ValueError("El SKU contiene caracteres inválidos.")
        return cleaned

    @field_validator("ean")
    @classmethod
    def validate_ean(cls, v: Optional[str]) -> Optional[str]:
        cleaned = _sanitize_text_field(v, "ean", allow_empty=True)
        if cleaned is not None and not _SKU_CODE_RE.match(cleaned):
            raise ValueError("El EAN contiene caracteres inválidos.")
        return cleaned

    @field_validator("motivo")
    @classmethod
    def validate_motivo(cls, v: str) -> str:
        cleaned = _sanitize_text_field(v, "motivo", allow_empty=False)
        assert cleaned is not None
        return cleaned

    @field_validator("ubicacion_id")
    @classmethod
    def validate_ubicacion_id(cls, v: Optional[str]) -> Optional[str]:
        cleaned = _sanitize_text_field(v, "ubicacion_id", allow_empty=True)
        if cleaned is not None and not _SKU_CODE_RE.match(cleaned):
            raise ValueError("ubicacion_id contiene caracteres inválidos.")
        return cleaned

    @field_validator("comentarios")
    @classmethod
    def validate_comentarios(cls, v: Optional[str]) -> Optional[str]:
        return _sanitize_text_field(v, "comentarios", allow_empty=True)

    @model_validator(mode="after")
    def validate_identificador_presente(self) -> "MermaRapidaRequest":
        if not self.sku and not self.ean and not self.sato_id:
            raise ValueError("Debe indicar al menos uno de: 'sku', 'ean' o 'sato_id' para declarar la merma.")
        return self


class MermaRapidaSatoAfectado(BaseModel):
    sato_id: str
    lote: Optional[str] = None
    estado_origen: str
    ubicacion_id: Optional[str] = None
    unidades_descontadas: int
    cantidad_restante: int
    nuevo_estado: str


class MermaRapidaResponse(BaseModel):
    mensaje: str
    sku: str
    nombre_producto: str
    cantidad_registrada: int
    motivo: str
    origen_aplicado: str
    ubicacion_id: Optional[str] = None
    costo_unitario_clp: int = 0
    valor_merma_clp: int = 0
    satos_afectados: List[MermaRapidaSatoAfectado] = Field(default_factory=list)


class MermaHistorialItem(BaseModel):
    log_id: int
    sato_id: Optional[str] = None
    sku: str
    nombre_producto: str
    lote: Optional[str] = None
    ubicacion_id: Optional[str] = None
    cantidad: int
    motivo: str
    comentarios: Optional[str] = None
    costo_unitario_clp: int = 0
    valor_merma_clp: int = 0
    usuario_id: Optional[int] = None
    fecha: datetime


# ─── Etapa 3: Onboarding Adaptativo y Configuración por Local (Tenant.settings) ───

VALID_MODULE_IDS = (
    "dashboard",
    "catalogo",
    "plano_supermercado",
    "plano_bodega",
    "ordenes_compra",
    "recepcion_bodega",
    "ajustes_inventario",
    "picking",
    "ventas_externas",
    "trazabilidad",
    "pos_express",
)


class TenantBusinessProfile(BaseModel):
    scale: Literal["minimarket", "supermercado"] = "supermercado"
    has_separate_warehouse_map: bool = True
    uses_gs1_128_fefo: bool = True


class TenantPosStrategy(BaseModel):
    mode: Literal["modern_pos", "legacy_file_pos", "reference_pos"] = "legacy_file_pos"
    accepted_no_sii_disclaimer: bool = False
    external_provider: Optional[str] = Field(default=None, max_length=64)
    fallback_to_warehouse_on_zero_shelf: bool = False

    @field_validator("external_provider")
    @classmethod
    def validate_external_provider(cls, v: Optional[str]) -> Optional[str]:
        return _sanitize_text_field(v, "external_provider", allow_empty=True)


class TenantSettingsResponse(BaseModel):
    tenant_id: str
    nombre_local: str
    onboarding_completed: bool = False
    business_profile: TenantBusinessProfile
    pos_strategy: TenantPosStrategy
    enabled_modules: List[str]


class TenantSettingsUpdate(BaseModel):
    nombre_local: Optional[str] = Field(default=None, min_length=2, max_length=120)
    onboarding_completed: Optional[bool] = None
    business_profile: Optional[TenantBusinessProfile] = None
    pos_strategy: Optional[TenantPosStrategy] = None
    enabled_modules: Optional[List[str]] = None

    @field_validator("nombre_local")
    @classmethod
    def validate_nombre_local(cls, v: Optional[str]) -> Optional[str]:
        return _sanitize_text_field(v, "nombre_local", allow_empty=True)

    @field_validator("enabled_modules")
    @classmethod
    def validate_enabled_modules(cls, v: Optional[List[str]]) -> Optional[List[str]]:
        if v is None:
            return None
        cleaned: List[str] = []
        for mod in v:
            m = (mod or "").strip()
            if m not in VALID_MODULE_IDS:
                raise ValueError(f"Módulo '{m}' no es un identificador válido de BVCore.")
            if m not in cleaned:
                cleaned.append(m)
        return cleaned


