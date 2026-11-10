import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Integer, Float, Date, DateTime, ForeignKey, ForeignKeyConstraint, Uuid, JSON, Index, Boolean, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base
from app.core.tenant import current_tenant_id
from app.db_migrations import register_metadata_auto_upgrade


class Tenant(Base):
    __tablename__ = 'tenant'
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()), index=True)
    nombre = Column(String, nullable=False, unique=True)
    activo = Column(Boolean, default=True)
    settings = Column(JSON, nullable=False, default=dict)

class Categoria(Base):
    __tablename__ = 'categoria'
    __table_args__ = (
        UniqueConstraint('tenant_id', 'nombre', name='uq_categoria_tenant_nombre'),
    )
    tenant_id = Column(String, ForeignKey('tenant.id'), nullable=False, index=True)
    id = Column(Integer, primary_key=True, autoincrement=True)
    nombre = Column(String, nullable=False, index=True) # Ej: "Abarrotes", "Lácteos"
    color_hex = Column(String, nullable=False, default="#94a3b8") # Para pintar el plano 2D y Dashboards

class Catalogo_Producto(Base):
    __tablename__ = 'catalogo_producto'
    __table_args__ = (
        UniqueConstraint('tenant_id', 'ean', name='uq_producto_tenant_ean'),
        UniqueConstraint('tenant_id', 'dun14', name='uq_producto_tenant_dun14'),
    )
    tenant_id = Column(String, ForeignKey('tenant.id'), primary_key=True, nullable=False, index=True, default=lambda: current_tenant_id.get())
    sku = Column(String, primary_key=True, index=True)
    nombre = Column(String, nullable=False)
    ean = Column(String, nullable=False, index=True)
    dun14 = Column(String, nullable=True, index=True)
    unidades_por_caja = Column(Integer, nullable=False, default=1)
    unidad_medida = Column(String, nullable=False, default="UN")
    temperatura_requerida = Column(String, nullable=False, default="SECO")
    stock_minimo = Column(Integer, nullable=False, default=5)
    dias_alerta_vencimiento = Column(Integer, nullable=False, default=7)
    costo_unitario = Column(Integer, nullable=False, default=0)
    activo = Column(Boolean, nullable=False, default=True)
    
    # Agrupación Global
    familia = Column(String, nullable=True) # Ej: Abarrotes, Frescos, Non-Food
    sub_familia = Column(String, nullable=True) # Ej: Aceites, Bebidas, Limpieza
    proveedor_marca = Column(String, nullable=True) # Ej: CCU, Unilever
    
    # Ahora la categoría no es un texto libre, es una llave foránea
    categoria_id = Column(Integer, ForeignKey('categoria.id'), nullable=True)
    categoria_rel = relationship('Categoria', lazy='selectin')
    
    @property
    def categoria(self):
        return self.categoria_rel.nombre if self.categoria_rel else None
    
    tolerancia_vencimiento_dias = Column(Integer, default=0)
    controla_vencimiento = Column(Boolean, default=False)
    dias_vida_util = Column(Integer, nullable=True)
    precio = Column(Integer, nullable=False, default=0) # Agregado para POS

    # Etapa 1: Clasificación ABC Dinámica y Conteo Cíclico
    clase_abc = Column(String, nullable=False, default="B")
    es_perecible_corto = Column(Boolean, nullable=False, default=False)
    venta_valorizada_ventana = Column(Integer, nullable=False, default=0)
    unidades_vendidas_ventana = Column(Integer, nullable=False, default=0)
    participacion_ventas = Column(Float, nullable=False, default=0.0)
    intervalo_medio_venta_dias = Column(Float, nullable=True)
    ultima_venta_at = Column(DateTime, nullable=True)
    ultimo_conteo_at = Column(DateTime, nullable=True)
    abc_calculado_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

class Patente(Base):
    __tablename__ = 'patente'
    tenant_id = Column(String, ForeignKey('tenant.id'), primary_key=True, nullable=False, index=True, default=lambda: current_tenant_id.get())
    id_patente = Column(String, primary_key=True, index=True) # Ej: "485" o "486"
    area_pasillo = Column(String, nullable=False) # Ej: "AREA 20"
    tipo_mueble = Column(String, nullable=False, default="Gondola") # Gondola, Vitrina Frío, etc.
    tipo_ubicacion = Column(String, nullable=False, default="SALA_VENTA") # SALA_VENTA, BODEGA_SECOS, CAMARA_FRIO, CAMARA_CONGELADOS
    # Coordenadas para el Gemelo Digital 2D
    coordenada_x = Column(Integer, default=0)
    coordenada_y = Column(Integer, default=0)
    ancho = Column(Integer, default=1)
    largo = Column(Integer, default=1)
    rotacion = Column(Float, default=0.0)
    url_imagen_planograma = Column(String, nullable=True) 
    productos_asignados = Column(JSON, default=list)
    submapeo_grid = Column(JSON, nullable=True)

class DecoracionPlano(Base):
    __tablename__ = 'decoracion_plano'
    tenant_id = Column(String, ForeignKey('tenant.id'), primary_key=True, nullable=False, index=True, default=lambda: current_tenant_id.get())
    id = Column(String, primary_key=True, index=True) # UUID o string ID
    tipo = Column(String, nullable=False) # "TEXTO", "ZONA", etc.
    x = Column(Float, nullable=False, default=0)
    y = Column(Float, nullable=False, default=0)
    w = Column(Float, nullable=False, default=100)
    h = Column(Float, nullable=False, default=50)
    rotacion = Column(Float, nullable=False, default=0.0)
    config = Column(JSON, nullable=True) # Para colores, tamaños de fuente, etc.

class Usuario(Base):
    __tablename__ = 'usuario'
    __table_args__ = (
        UniqueConstraint('tenant_id', 'nombre', name='uq_usuario_tenant_nombre'),
    )
    tenant_id = Column(String, ForeignKey('tenant.id'), nullable=False, index=True)
    id = Column(Integer, primary_key=True, autoincrement=True)
    nombre = Column(String, nullable=False)
    password_hash = Column(String, nullable=True)  # Nullable para MVP
    rol = Column(String, nullable=False, default="Operario")

class Sato(Base):
    __tablename__ = 'satos'
    __table_args__ = (
        ForeignKeyConstraint(['tenant_id', 'sku'], ['catalogo_producto.tenant_id', 'catalogo_producto.sku']),
        ForeignKeyConstraint(['tenant_id', 'ubicacion_id'], ['patente.tenant_id', 'patente.id_patente'], ondelete='SET NULL'),
    )
    tenant_id = Column(String, ForeignKey('tenant.id'), nullable=False, index=True)
    sato_id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    padre_id = Column(Uuid(as_uuid=True), ForeignKey('satos.sato_id'), nullable=True) 
    
    # Discriminador formal: CONTENEDOR (pallet LPN) vs PRODUCTO (unidad con SKU)
    tipo_sato = Column(String, nullable=False, default="PRODUCTO")
    
    # LPN (License Plate Number) para los pallets consolidados
    lpn = Column(String, nullable=True, index=True) 
    
    # Campos de producto (Opcionales para los contenedores)
    sku = Column(String, nullable=True, index=True)
    ubicacion_id = Column(String, nullable=True, index=True)
    lote = Column(String, nullable=True)
    fecha_elaboracion = Column(Date, nullable=True)
    fecha_vencimiento = Column(Date, nullable=True)
    cantidad = Column(Integer, nullable=True, default=0)
    
    # Coordenadas de Micro-Slotting (Planograma)
    nivel_estante = Column(Integer, nullable=True)
    frente_posicion = Column(Integer, nullable=True)
    
    # Campos de LPN (Persistidos, antes se perdían en el log)
    destino = Column(String, nullable=True)
    tipo_carga = Column(String, nullable=True)
    barcode_original = Column(String, nullable=True)
    
    estado = Column(String, nullable=False, default="Bodega")
    
    # Relación ORM padre ↔ hijos
    hijos = relationship("Sato", backref="padre", remote_side=[sato_id], lazy="select")

class Log_Transaccional(Base):
    __tablename__ = 'log_transaccional'
    __table_args__ = (
        Index('idx_log_fecha_accion', 'fecha_hora', 'accion'),
        Index('idx_log_sato_fecha', 'sato_id', 'fecha_hora'),
    )

    tenant_id = Column(String, ForeignKey('tenant.id'), nullable=False, index=True)
    id = Column(Integer, primary_key=True, autoincrement=True)
    sato_id = Column(Uuid(as_uuid=True), ForeignKey('satos.sato_id'), nullable=False, index=True)
    usuario_id = Column(Integer, ForeignKey('usuario.id'), nullable=True)
    accion = Column(String, nullable=False)
    fecha_hora = Column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)
    detalles = Column(String, nullable=True)

class ASN_Padre(Base):
    __tablename__ = 'asn_padre'
    tenant_id = Column(String, ForeignKey('tenant.id'), nullable=False, index=True)
    lpn = Column(String, primary_key=True, index=True) # Ej: 8089962588
    origen = Column(String, nullable=False) # Ej: "Secos Santiago Lo Aguirre"
    estado = Column(String, default="EN_TRANSITO") # EN_TRANSITO, RECEPCIONADO

class ASN_Detalle(Base):
    __tablename__ = 'asn_detalle'
    __table_args__ = (
        ForeignKeyConstraint(['tenant_id', 'sku'], ['catalogo_producto.tenant_id', 'catalogo_producto.sku']),
    )
    tenant_id = Column(String, ForeignKey('tenant.id'), nullable=False, index=True)
    id = Column(Integer, primary_key=True, autoincrement=True)
    lpn_padre = Column(String, ForeignKey('asn_padre.lpn'), nullable=False)
    sku = Column(String, nullable=False)
    cantidad = Column(Integer, nullable=False)
    lote = Column(String, nullable=True)
    fecha_vencimiento = Column(Date, nullable=True)

class Ola_Picking(Base):
    __tablename__ = 'ola_picking'
    tenant_id = Column(String, ForeignKey('tenant.id'), nullable=False, index=True)
    id = Column(Integer, primary_key=True, autoincrement=True)
    fecha_creacion = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    estado = Column(String, default="PENDIENTE") # PENDIENTE, EN_PROGRESO, COMPLETADA

class Pedido_Outbound(Base):
    __tablename__ = 'pedido_outbound'
    tenant_id = Column(String, ForeignKey('tenant.id'), nullable=False, index=True)
    id = Column(Integer, primary_key=True, autoincrement=True)
    cliente = Column(String, nullable=False)
    estado = Column(String, default="PENDIENTE") # PENDIENTE, EN_OLA, COMPLETADO
    ola_id = Column(Integer, ForeignKey('ola_picking.id'), nullable=True)
    fecha_creacion = Column(DateTime, default=lambda: datetime.now(timezone.utc))

class Detalle_Pedido(Base):
    __tablename__ = 'detalle_pedido'
    __table_args__ = (
        ForeignKeyConstraint(['tenant_id', 'sku'], ['catalogo_producto.tenant_id', 'catalogo_producto.sku']),
    )
    tenant_id = Column(String, ForeignKey('tenant.id'), nullable=False, index=True)
    id = Column(Integer, primary_key=True, autoincrement=True)
    pedido_id = Column(Integer, ForeignKey('pedido_outbound.id'))
    sku = Column(String)
    cantidad = Column(Integer, nullable=False)

class Tarea_Picking(Base):
    __tablename__ = 'tarea_picking'
    __table_args__ = (
        ForeignKeyConstraint(['tenant_id', 'sku'], ['catalogo_producto.tenant_id', 'catalogo_producto.sku']),
    )
    tenant_id = Column(String, ForeignKey('tenant.id'), nullable=False, index=True)
    id = Column(Integer, primary_key=True, autoincrement=True)
    ola_id = Column(Integer, ForeignKey('ola_picking.id'))
    pedido_id = Column(Integer, ForeignKey('pedido_outbound.id'))
    sku = Column(String)
    sato_id = Column(Uuid(as_uuid=True), ForeignKey('satos.sato_id'))
    cantidad_a_extraer = Column(Integer, nullable=False)
    estado = Column(String, default="PENDIENTE") # PENDIENTE, COMPLETADA, FALTANTE

class Integration_Log(Base):
    __tablename__ = 'integration_log'
    tenant_id = Column(String, ForeignKey('tenant.id'), nullable=False, index=True)
    id = Column(Integer, primary_key=True, autoincrement=True)
    event_type = Column(String, nullable=False)
    payload_json = Column(String, nullable=False) # Guardaremos el payload stringificado
    status = Column(String, default="PENDING") # PENDING, SUCCESS, FAILED
    error_message = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Venta_Externa(Base):
    """
    Registro de tickets de venta recibidos desde puntos de venta EXTERNOS
    (POS con API Key vía webhook, o POS sin API vía importación de archivos/lotes).

    Garantiza idempotencia a nivel de base de datos: el mismo ticket del mismo
    POS nunca descuenta stock dos veces, aunque Redis no esté disponible o el
    usuario re-suba el mismo archivo de cierre de caja.
    """
    __tablename__ = 'venta_externa'
    __table_args__ = (
        UniqueConstraint('tenant_id', 'pos_source', 'external_ticket_id', name='uq_venta_externa_tenant_source_ticket'),
    )
    tenant_id = Column(String, ForeignKey('tenant.id'), nullable=False, index=True)
    id = Column(Integer, primary_key=True, autoincrement=True)
    pos_source = Column(String, nullable=False)            # Ej: "BSALE", "LOYVERSE", "CAJA_LEGACY_LOCAL_1"
    external_ticket_id = Column(String, nullable=False)    # Folio/boleta/ID de transacción en el POS origen
    canal = Column(String, nullable=False)                 # "WEBHOOK_API" | "BATCH_JSON" | "ARCHIVO"
    total_unidades = Column(Integer, nullable=False, default=0)
    total_valorizado = Column(Integer, nullable=False, default=0)
    unidades_deficit = Column(Integer, nullable=False, default=0)
    es_carga_historica = Column(Boolean, nullable=False, default=False)
    estado_procesamiento = Column(String, nullable=False, default="COMPLETO")  # COMPLETO | PARCIAL | REVERTIDO
    items_huerfanos_count = Column(Integer, nullable=False, default=0)
    revertido_por = Column(String, nullable=True)
    revertido_at = Column(DateTime, nullable=True)
    motivo_reversion = Column(String, nullable=True)
    fecha_venta_origen = Column(String, nullable=True)     # Timestamp tal como lo reporta el POS (texto libre)
    fecha_venta_dt = Column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)
    fecha_recepcion = Column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)

    items = relationship("Venta_Externa_Item", backref="venta", cascade="all, delete-orphan", passive_deletes=True)
    descuentos = relationship("Venta_Externa_Descuento", backref="venta", cascade="all, delete-orphan", passive_deletes=True)
    huerfanos = relationship("Venta_Externa_Huerfano", backref="venta", cascade="all, delete-orphan", passive_deletes=True)


class Venta_Externa_Item(Base):
    """
    Detalle por línea/SKU de cada ticket en `Venta_Externa`.
    Alimenta el Motor ABC Dinámico sobre la ventana móvil de W días.
    """
    __tablename__ = 'venta_externa_item'
    __table_args__ = (
        ForeignKeyConstraint(
            ['tenant_id', 'sku'],
            ['catalogo_producto.tenant_id', 'catalogo_producto.sku'],
            ondelete='CASCADE',
        ),
        Index('idx_vei_tenant_fecha_sku', 'tenant_id', 'fecha_venta', 'sku'),
    )
    tenant_id = Column(String, ForeignKey('tenant.id', ondelete='CASCADE'), nullable=False, index=True, default=lambda: current_tenant_id.get())
    id = Column(Integer, primary_key=True, autoincrement=True)
    venta_id = Column(Integer, ForeignKey('venta_externa.id', ondelete='CASCADE'), nullable=False, index=True)
    sku = Column(String, nullable=False, index=True)
    cantidad = Column(Integer, nullable=False)
    precio_unitario = Column(Integer, nullable=False, default=0)
    subtotal = Column(Integer, nullable=False, default=0)
    unidades_descontadas = Column(Integer, nullable=False, default=0)
    unidades_deficit = Column(Integer, nullable=False, default=0)
    es_carga_historica = Column(Boolean, nullable=False, default=False)
    fecha_venta = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc), index=True)


class Configuracion_Conteo_Tenant(Base):
    """
    Parámetros por Tenant para Clasificación ABC Dinámica y Conteo Cíclico.
    """
    __tablename__ = 'configuracion_conteo_tenant'
    __table_args__ = (
        UniqueConstraint('tenant_id', name='uq_config_conteo_tenant'),
    )
    tenant_id = Column(String, ForeignKey('tenant.id', ondelete='CASCADE'), nullable=False, index=True, default=lambda: current_tenant_id.get())
    id = Column(Integer, primary_key=True, autoincrement=True)
    ventana_w_dias = Column(Integer, nullable=False, default=90)
    umbral_a = Column(Float, nullable=False, default=0.80)
    umbral_b = Column(Float, nullable=False, default=0.95)
    dias_producto_nuevo = Column(Integer, nullable=False, default=30)
    frecuencia_a_dias = Column(Integer, nullable=False, default=14)
    frecuencia_b_dias = Column(Integer, nullable=False, default=30)
    frecuencia_c_dias = Column(Integer, nullable=False, default=90)
    capacidad_diaria_skus = Column(Integer, nullable=False, default=20)
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class Anomalia_Stock(Base):
    """
    Registro de discrepancias de inventario detectadas sin permitir stock negativo:
      • VENTA_SIN_STOCK: un POS externo reportó venta de un SKU sin stock suficiente en SATOs.
      • DISCREPANCIA_VITRINA: un operario reportó góndola vacía o descuadre físico en sala.
    """
    __tablename__ = 'anomalia_stock'
    __table_args__ = (
        ForeignKeyConstraint(
            ['tenant_id', 'sku'],
            ['catalogo_producto.tenant_id', 'catalogo_producto.sku'],
            ondelete='CASCADE',
        ),
        Index('idx_anomalia_tenant_estado_sku', 'tenant_id', 'estado', 'sku'),
    )
    tenant_id = Column(String, ForeignKey('tenant.id', ondelete='CASCADE'), nullable=False, index=True, default=lambda: current_tenant_id.get())
    id = Column(Integer, primary_key=True, autoincrement=True)
    sku = Column(String, nullable=False, index=True)
    ubicacion_id = Column(String, nullable=True, index=True)
    tipo = Column(String, nullable=False, default="VENTA_SIN_STOCK")  # VENTA_SIN_STOCK | DISCREPANCIA_VITRINA
    estado = Column(String, nullable=False, default="ABIERTA")        # ABIERTA | RESUELTA | DESCARTADA
    unidades_deficit = Column(Integer, nullable=False, default=0)
    referencia_ticket = Column(String, nullable=True)
    detalles = Column(String, nullable=True)
    reportado_por_id = Column(Integer, ForeignKey('usuario.id', ondelete='SET NULL'), nullable=True)
    created_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc), index=True)
    resolved_at = Column(DateTime, nullable=True)


class Venta_Externa_Descuento(Base):
    """
    Desglose estructurado de descuento FEFO por boleta externa (SATO, lote y ubicación).
    Permite el Inspector de Boleta (Drill-Down) y la Reversión Total con restitución
    exacta de inventario sin depender de texto libre en Log_Transaccional.
    """
    __tablename__ = 'venta_externa_descuento'
    __table_args__ = (
        ForeignKeyConstraint(
            ['tenant_id', 'sku'],
            ['catalogo_producto.tenant_id', 'catalogo_producto.sku'],
            ondelete='CASCADE',
        ),
        Index('idx_ved_tenant_venta', 'tenant_id', 'venta_id'),
    )
    tenant_id = Column(String, ForeignKey('tenant.id', ondelete='CASCADE'), nullable=False, index=True, default=lambda: current_tenant_id.get())
    id = Column(Integer, primary_key=True, autoincrement=True)
    venta_id = Column(Integer, ForeignKey('venta_externa.id', ondelete='CASCADE'), nullable=False, index=True)
    sku = Column(String, nullable=False, index=True)
    sato_id = Column(Uuid(as_uuid=True), ForeignKey('satos.sato_id', ondelete='SET NULL'), nullable=True, index=True)
    lote = Column(String, nullable=True)
    ubicacion_id = Column(String, nullable=True)
    estado_origen = Column(String, nullable=False, default="Vitrina")
    fecha_vencimiento = Column(Date, nullable=True)
    unidades_descontadas = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))


class Venta_Externa_Huerfano(Base):
    """
    Bandeja de Cuarentena para ítems vendidos en POS cuyo EAN/SKU aún no existe
    en el catálogo de BVCore (tickets procesados en estado PARCIAL).
    """
    __tablename__ = 'venta_externa_huerfano'
    __table_args__ = (
        Index('idx_veh_tenant_estado_cod', 'tenant_id', 'estado', 'codigo_original'),
    )
    tenant_id = Column(String, ForeignKey('tenant.id', ondelete='CASCADE'), nullable=False, index=True, default=lambda: current_tenant_id.get())
    id = Column(Integer, primary_key=True, autoincrement=True)
    venta_id = Column(Integer, ForeignKey('venta_externa.id', ondelete='CASCADE'), nullable=False, index=True)
    external_ticket_id = Column(String, nullable=False, index=True)
    pos_source = Column(String, nullable=False)
    codigo_original = Column(String, nullable=False, index=True)
    tipo_codigo = Column(String, nullable=False, default="EAN")  # EAN | SKU
    cantidad = Column(Integer, nullable=False, default=1)
    precio_unitario = Column(Integer, nullable=False, default=0)
    estado = Column(String, nullable=False, default="PENDIENTE", index=True)  # PENDIENTE | RESUELTO | CANCELADO
    sku_vinculado = Column(String, nullable=True)
    created_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc), index=True)
    resolved_at = Column(DateTime, nullable=True)


register_metadata_auto_upgrade(Base.metadata)
