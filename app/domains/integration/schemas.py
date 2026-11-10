"""
app/domains/integration/schemas.py
─────────────────────────────────────────────────────────────────────────────
Contratos del Conector Universal de Ventas Externas (Omni-POS Ingestion v2).

Incluye:
  • Webhook M2M y Lotes/Archivos (.xlsx, .csv, .txt, .json)
  • Pre-visualización Segura (Dry-Run)
  • Bandeja de Cuarentena para SKUs Huérfanos (Tickets PARCIAL y Resolución Retroactiva)
  • Inspector Desplegable de Boleta (Drill-Down FEFO) y Reversión Total de Ticket
"""

import re
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

_DANGEROUS_PAYLOAD_RE = re.compile(
    r"(<\s*script\b|javascript\s*:|on\w+\s*=|<\s*iframe\b|<\s*object\b)",
    re.IGNORECASE,
)
MAX_PRECIO_UNITARIO_CLP = 100_000_000


def _sanitize_pos_string(val: Optional[str], field_label: str) -> Optional[str]:
    if val is None:
        return None
    if "\x00" in val:
        raise ValueError(f"El campo '{field_label}' contiene caracteres nulos no permitidos.")
    if _DANGEROUS_PAYLOAD_RE.search(val):
        raise ValueError(f"El campo '{field_label}' contiene patrones HTML/script no permitidos.")
    return val


class ExternalSaleItem(BaseModel):
    ean: Optional[str] = Field(None, max_length=64, description="Código de barras (EAN/UPC/GTIN) reportado por el POS")
    sku: Optional[str] = Field(None, max_length=64, description="SKU interno del catálogo SG-BVC")
    cantidad: int = Field(..., gt=0, le=100_000, description="Unidades vendidas")
    precio_unitario: Optional[int] = Field(
        None,
        ge=0,
        le=MAX_PRECIO_UNITARIO_CLP,
        description="Precio unitario de venta en CLP reportado por el POS",
    )

    @field_validator("ean", "sku")
    @classmethod
    def _validar_identificador_limpio(cls, v: Optional[str], info) -> Optional[str]:
        return _sanitize_pos_string(v, info.field_name)

    @model_validator(mode="after")
    def _requiere_identificador(self):
        if not (self.ean and self.ean.strip()) and not (self.sku and self.sku.strip()):
            raise ValueError("Cada ítem debe incluir 'ean' o 'sku'.")
        return self


class ExternalSaleWebhookRequest(BaseModel):
    external_ticket_id: str = Field(..., min_length=1, max_length=128, description="Folio/boleta/ID de la transacción en el POS origen")
    pos_source: str = Field("API_POS", min_length=1, max_length=64, description="Identificador del POS origen (ej: BSALE, LOYVERSE)")
    timestamp: Optional[str] = Field(None, max_length=64, description="Fecha/hora de la venta según el POS (ISO-8601 recomendado)")
    allow_bodega_fallback: Optional[bool] = Field(
        None,
        description="Si no se especifica (None), aplica la regla global configurada en Tenant.settings",
    )
    modo_historico_abc: bool = Field(False, description="Si es True, registra ventas históricas para ABC sin descontar stock físico en SATOs")
    items: List[ExternalSaleItem] = Field(..., min_length=1, max_length=500)

    @field_validator("external_ticket_id", "pos_source", "timestamp")
    @classmethod
    def _validar_metadatos_ticket(cls, v: Optional[str], info) -> Optional[str]:
        return _sanitize_pos_string(v, info.field_name)


class ExternalSaleBatchRequest(BaseModel):
    pos_source: str = Field("BATCH_IMPORT", min_length=1, max_length=64)
    allow_bodega_fallback: Optional[bool] = None
    modo_historico_abc: bool = Field(False)
    tickets: List[ExternalSaleWebhookRequest] = Field(..., min_length=1, max_length=5_000)


class ExternalSaleResponse(BaseModel):
    estado: str                                # "PROCESADO" | "PARCIAL" | "DUPLICADO"
    estado_procesamiento: str = "COMPLETO"     # "COMPLETO" | "PARCIAL" | "REVERTIDO"
    mensaje: str
    external_ticket_id: str
    pos_source: str
    total_descontado: int
    unidades_deficit: int = 0
    total_valorizado: int = 0
    es_carga_historica: bool = False
    items_huerfanos_count: int = 0
    items_huerfanos: List[Dict[str, Any]] = []
    satos_afectados: List[Dict[str, Any]] = []


class ExternalSaleBatchResponse(BaseModel):
    mensaje: str
    pos_source: str
    tickets_recibidos: int
    tickets_procesados: int
    tickets_parciales: int = 0
    tickets_duplicados: int
    tickets_fallidos: int
    unidades_descontadas: int
    unidades_deficit: int = 0
    total_valorizado: int = 0
    items_huerfanos_count: int = 0
    es_carga_historica: bool = False
    detalles_errores: List[Dict[str, Any]] = []
    errores_parseo: List[Dict[str, Any]] = []


class ExternalSaleHistoryItem(BaseModel):
    id: int
    pos_source: str
    external_ticket_id: str
    canal: str
    estado_procesamiento: str = "COMPLETO"     # "COMPLETO" | "PARCIAL" | "REVERTIDO"
    items_huerfanos_count: int = 0
    total_unidades: int
    unidades_deficit: int = 0
    total_valorizado: int = 0
    es_carga_historica: bool = False
    fecha_venta_origen: Optional[str] = None
    fecha_recepcion: Optional[str] = None
    revertido_por: Optional[str] = None
    revertido_at: Optional[str] = None
    motivo_reversion: Optional[str] = None


# ── Pre-visualización Segura (Dry-Run) ───────────────────────────────────

class DryRunUnknownCodeItem(BaseModel):
    codigo_original: str
    tipo_codigo: str = "EAN"
    unidades_totales: int
    boletas_afectadas: int


class ExternalSaleDryRunResponse(BaseModel):
    archivo_nombre: str
    pos_source: str
    modo_historico_abc: bool = False
    fallback_bodega_activo: bool = False
    tickets_totales_leidos: int
    boletas_nuevas_a_procesar: int
    boletas_duplicadas_omitidas: int
    boletas_parciales_con_huerfanos: int = 0
    boletas_sin_catalogo_100: int = 0
    unidades_a_descontar: int
    valorizado_estimado_clp: int = 0
    codigos_desconocidos: List[DryRunUnknownCodeItem] = []
    errores_parseo: List[Dict[str, Any]] = []


# ── Bandeja de Cuarentena para SKUs Huérfanos ────────────────────────────

class OrphanCodeGroupItem(BaseModel):
    codigo_original: str
    tipo_codigo: str
    unidades_pendientes: int
    boletas_afectadas: int
    precio_unitario_sugerido: int = 0
    primera_deteccion: Optional[str] = None
    tickets_muestra: List[str] = []


class CrearProductoRapidoHuerfano(BaseModel):
    sku: str = Field(..., min_length=2, max_length=64)
    nombre: str = Field(..., min_length=2, max_length=120)
    ean: Optional[str] = Field(default=None, max_length=64)
    precio: int = Field(default=0, ge=0, le=MAX_PRECIO_UNITARIO_CLP)
    costo_unitario: int = Field(default=0, ge=0, le=MAX_PRECIO_UNITARIO_CLP)
    temperatura_requerida: str = Field(default="SECO", max_length=32)

    @field_validator("sku", "nombre", "ean", "temperatura_requerida")
    @classmethod
    def _limpiar_campos(cls, v: Optional[str], info) -> Optional[str]:
        return _sanitize_pos_string(v, info.field_name)


class ResolveOrphanRequest(BaseModel):
    codigo_original: str = Field(..., min_length=1, max_length=64)
    accion: Literal["VINCULAR_EXISTENTE", "CREAR_PRODUCTO"]
    sku_existente: Optional[str] = Field(default=None, max_length=64)
    actualizar_ean_producto: bool = True
    nuevo_producto: Optional[CrearProductoRapidoHuerfano] = None

    @field_validator("codigo_original", "sku_existente")
    @classmethod
    def _limpiar_codigos(cls, v: Optional[str], info) -> Optional[str]:
        return _sanitize_pos_string(v, info.field_name)

    @model_validator(mode="after")
    def _validar_modo(self):
        if self.accion == "VINCULAR_EXISTENTE" and not (self.sku_existente and self.sku_existente.strip()):
            raise ValueError("Debe indicar 'sku_existente' cuando la acción es VINCULAR_EXISTENTE.")
        if self.accion == "CREAR_PRODUCTO" and self.nuevo_producto is None:
            raise ValueError("Debe proporcionar 'nuevo_producto' cuando la acción es CREAR_PRODUCTO.")
        return self


class ResolveOrphanResponse(BaseModel):
    mensaje: str
    codigo_original: str
    sku_vinculado: str
    nombre_producto: str
    registros_resueltos: int
    boletas_actualizadas_a_completo: int
    unidades_descontadas_retroactivas: int
    unidades_deficit: int = 0


# ── Inspector de Boleta (Drill-Down) y Reversión Total ───────────────────

class ExternalSaleTicketItemDetail(BaseModel):
    sku: str
    nombre_producto: str
    ean: Optional[str] = None
    cantidad: int
    precio_unitario: int
    subtotal: int
    unidades_descontadas: int
    unidades_deficit: int


class ExternalSaleTicketFefoLotDetail(BaseModel):
    id: int
    sku: str
    nombre_producto: str
    sato_id: Optional[str] = None
    lote: Optional[str] = None
    ubicacion_id: Optional[str] = None
    nombre_ubicacion: Optional[str] = None
    estado_origen: str
    fecha_vencimiento: Optional[str] = None
    unidades_descontadas: int


class ExternalSaleTicketOrphanDetail(BaseModel):
    id: int
    codigo_original: str
    tipo_codigo: str
    cantidad: int
    precio_unitario: int
    estado: str
    sku_vinculado: Optional[str] = None


class ExternalSaleTicketDetailResponse(BaseModel):
    id: int
    pos_source: str
    external_ticket_id: str
    canal: str
    estado_procesamiento: str
    total_unidades: int
    unidades_deficit: int
    total_valorizado: int
    es_carga_historica: bool
    items_huerfanos_count: int
    fecha_venta_origen: Optional[str] = None
    fecha_recepcion: Optional[str] = None
    revertido_por: Optional[str] = None
    revertido_at: Optional[str] = None
    motivo_reversion: Optional[str] = None
    puede_revertirse: bool
    motivo_bloqueo_reversion: Optional[str] = None
    items: List[ExternalSaleTicketItemDetail] = []
    descuentos_fefo: List[ExternalSaleTicketFefoLotDetail] = []
    huerfanos: List[ExternalSaleTicketOrphanDetail] = []


class RevertirVentaRequest(BaseModel):
    motivo: str = Field(
        default="Devolución o nota de crédito en punto de venta origen",
        min_length=3,
        max_length=300,
    )

    @field_validator("motivo")
    @classmethod
    def _limpiar_motivo(cls, v: str) -> str:
        cleaned = _sanitize_pos_string(v, "motivo")
        if not cleaned or len(cleaned.strip()) < 3:
            raise ValueError("El motivo de reversión debe tener al menos 3 caracteres.")
        return cleaned.strip()


class RevertirVentaResponse(BaseModel):
    mensaje: str
    venta_id: int
    external_ticket_id: str
    estado_procesamiento: str
    unidades_restituidas: int
    satos_restituidos_count: int
    anomalias_cerradas_count: int
    revertido_por: str
    revertido_at: str
