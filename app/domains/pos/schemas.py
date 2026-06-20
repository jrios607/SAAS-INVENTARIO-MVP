from pydantic import BaseModel, Field
from typing import List, Dict, Any

# ─── POS (Caja SaaS) ────────────────────────────────────────

class PosScanRequest(BaseModel):
    ean: str

class PosScanResponse(BaseModel):
    sku: str
    nombre: str
    precio: int
    cantidad_disponible: int

class PosCheckoutItem(BaseModel):
    ean: str
    cantidad: int = Field(..., gt=0)

class PosCheckoutRequest(BaseModel):
    items: List[PosCheckoutItem]

class PosCheckoutResponse(BaseModel):
    mensaje: str
    total_descontado: int

class PosSyncTicket(BaseModel):
    id_ticket: str
    timestamp: str
    items: List[PosCheckoutItem]

class PosSyncRequest(BaseModel):
    tickets: List[PosSyncTicket]

class PosSyncResponse(BaseModel):
    mensaje: str
    tickets_procesados: int
    tickets_fallidos: int
    detalles_fallos: List[Dict[str, Any]]
