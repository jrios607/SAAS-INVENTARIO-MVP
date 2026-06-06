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
    planograma_destino_id: Optional[int] = None

class SatoFraccionarResponse(BaseModel):
    mensaje: str
    sato_hijo_id: uuid.UUID