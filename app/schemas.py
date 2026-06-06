import uuid
from pydantic import BaseModel
from typing import Optional

class ProductoCreate(BaseModel):
    sku: str
    nombre: str
    ean: str
    categoria: Optional[str] = None
    tolerancia_vencimiento_dias: int = 0

class ProductoResponse(BaseModel):
    mensaje: str
    sku: str

class PalletReceptionRequest(BaseModel):
    barcode_text: str

class PalletReceptionResponse(BaseModel):
    mensaje: str
    sato_id: uuid.UUID
    ean_leido: str

class SatoFraccionarRequest(BaseModel):
    sato_padre_id: uuid.UUID
    cantidad_a_mover: int
    planograma_destino_id: Optional[str] = None  # Cambiado de int a str para aceptar patentes como "485"

class SatoFraccionarResponse(BaseModel):
    mensaje: str
    sato_hijo_id: uuid.UUID

from datetime import date

class PatenteCreate(BaseModel):
    id_patente: str
    area_pasillo: str
    tipo_mueble: str
    coordenada_x: int
    coordenada_y: int
    ancho: int
    largo: int
    url_imagen_planograma: Optional[str] = None

class PatenteResponse(BaseModel):
    id_patente: str
    area_pasillo: str
    tipo_mueble: str
    coordenada_x: int
    coordenada_y: int
    ancho: int
    largo: int
    url_imagen_planograma: Optional[str] = None
    
    class Config:
        from_attributes = True
        orm_mode = True

class StockPatenteResponse(BaseModel):
    sku: str
    lote: str
    cantidad: int
    fecha_vencimiento: date
    
    class Config:
        from_attributes = True
        orm_mode = True

from typing import List, Dict, Any
from pydantic import Field

class VentaCajaRequest(BaseModel):
    ean_producto: str
    cantidad_vendida: int = Field(..., gt=0)

class VentaCajaResponse(BaseModel):
    mensaje: str
    cantidad_total_vendida: int
    satos_afectados: List[Dict[str, Any]]

from typing import Literal

class MermaRequest(BaseModel):
    sato_id: uuid.UUID
    cantidad: int = Field(..., gt=0)
    motivo: Literal["Vencimiento", "Dañado", "Robo", "Otro"]
    comentarios: Optional[str] = None

class MermaResponse(BaseModel):
    mensaje: str
    sato_id: uuid.UUID
    cantidad_registrada: int

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
