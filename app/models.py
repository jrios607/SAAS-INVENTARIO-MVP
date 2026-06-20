import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Integer, Float, Date, DateTime, ForeignKey, Uuid, JSON, Index, Boolean
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base



class Categoria(Base):
    __tablename__ = 'categoria'
    id = Column(Integer, primary_key=True, autoincrement=True)
    nombre = Column(String, unique=True, nullable=False, index=True) # Ej: "Abarrotes", "Lácteos"
    color_hex = Column(String, nullable=False, default="#94a3b8") # Para pintar el plano 2D y Dashboards

class Catalogo_Producto(Base):
    __tablename__ = 'catalogo_producto'
    sku = Column(String, primary_key=True, index=True)
    nombre = Column(String, nullable=False)
    ean = Column(String, nullable=False, unique=True, index=True)
    
    # Agrupación Global
    familia = Column(String, nullable=True) # Ej: Abarrotes, Frescos, Non-Food
    sub_familia = Column(String, nullable=True) # Ej: Aceites, Bebidas, Limpieza
    proveedor_marca = Column(String, nullable=True) # Ej: CCU, Unilever
    
    # Ahora la categoría no es un texto libre, es una llave foránea
    categoria_id = Column(Integer, ForeignKey('categoria.id'), nullable=True)
    categoria_rel = relationship('Categoria')
    
    @property
    def categoria(self):
        return self.categoria_rel.nombre if self.categoria_rel else None
    
    tolerancia_vencimiento_dias = Column(Integer, default=0)
    controla_vencimiento = Column(Boolean, default=False)
    dias_vida_util = Column(Integer, nullable=True)
    precio = Column(Integer, nullable=False, default=0) # Agregado para POS

class Patente(Base):
    __tablename__ = 'patente'
    
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
    id = Column(Integer, primary_key=True, autoincrement=True)
    nombre = Column(String, nullable=False, unique=True)
    password_hash = Column(String, nullable=True)  # Nullable para MVP
    rol = Column(String, nullable=False, default="Operario")

class Sato(Base):
    __tablename__ = 'satos'
    sato_id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    padre_id = Column(Uuid(as_uuid=True), ForeignKey('satos.sato_id'), nullable=True) 
    
    # Discriminador formal: CONTENEDOR (pallet LPN) vs PRODUCTO (unidad con SKU)
    tipo_sato = Column(String, nullable=False, default="PRODUCTO")
    
    # LPN (License Plate Number) para los pallets consolidados
    lpn = Column(String, nullable=True, unique=True, index=True) 
    
    # Campos de producto (Opcionales para los contenedores)
    sku = Column(String, ForeignKey('catalogo_producto.sku'), nullable=True, index=True)
    ubicacion_id = Column(String, ForeignKey('patente.id_patente'), nullable=True)
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

    id = Column(Integer, primary_key=True, autoincrement=True)
    sato_id = Column(Uuid(as_uuid=True), ForeignKey('satos.sato_id'), nullable=False, index=True)
    usuario_id = Column(Integer, ForeignKey('usuario.id'), nullable=True)
    accion = Column(String, nullable=False)
    fecha_hora = Column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)
    detalles = Column(String, nullable=True)

class ASN_Padre(Base):
    __tablename__ = 'asn_padre'
    lpn = Column(String, primary_key=True, index=True) # Ej: 8089962588
    origen = Column(String, nullable=False) # Ej: "Secos Santiago Lo Aguirre"
    estado = Column(String, default="EN_TRANSITO") # EN_TRANSITO, RECEPCIONADO

class ASN_Detalle(Base):
    __tablename__ = 'asn_detalle'
    id = Column(Integer, primary_key=True, autoincrement=True)
    lpn_padre = Column(String, ForeignKey('asn_padre.lpn'), nullable=False)
    sku = Column(String, ForeignKey('catalogo_producto.sku'), nullable=False)
    cantidad = Column(Integer, nullable=False)
    lote = Column(String, nullable=True)
    fecha_vencimiento = Column(Date, nullable=True)

class Ola_Picking(Base):
    __tablename__ = 'ola_picking'
    id = Column(Integer, primary_key=True, autoincrement=True)
    fecha_creacion = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    estado = Column(String, default="PENDIENTE") # PENDIENTE, EN_PROGRESO, COMPLETADA

class Pedido_Outbound(Base):
    __tablename__ = 'pedido_outbound'
    id = Column(Integer, primary_key=True, autoincrement=True)
    cliente = Column(String, nullable=False)
    estado = Column(String, default="PENDIENTE") # PENDIENTE, EN_OLA, COMPLETADO
    ola_id = Column(Integer, ForeignKey('ola_picking.id'), nullable=True)
    fecha_creacion = Column(DateTime, default=lambda: datetime.now(timezone.utc))

class Detalle_Pedido(Base):
    __tablename__ = 'detalle_pedido'
    id = Column(Integer, primary_key=True, autoincrement=True)
    pedido_id = Column(Integer, ForeignKey('pedido_outbound.id'))
    sku = Column(String, ForeignKey('catalogo_producto.sku'))
    cantidad = Column(Integer, nullable=False)

class Tarea_Picking(Base):
    __tablename__ = 'tarea_picking'
    id = Column(Integer, primary_key=True, autoincrement=True)
    ola_id = Column(Integer, ForeignKey('ola_picking.id'))
    pedido_id = Column(Integer, ForeignKey('pedido_outbound.id'))
    sku = Column(String, ForeignKey('catalogo_producto.sku'))
    sato_id = Column(Uuid(as_uuid=True), ForeignKey('satos.sato_id'))
    cantidad_a_extraer = Column(Integer, nullable=False)
    estado = Column(String, default="PENDIENTE") # PENDIENTE, COMPLETADA, FALTANTE

class Integration_Log(Base):
    __tablename__ = 'integration_log'
    id = Column(Integer, primary_key=True, autoincrement=True)
    event_type = Column(String, nullable=False)
    payload_json = Column(String, nullable=False) # Guardaremos el payload stringificado
    status = Column(String, default="PENDING") # PENDING, SUCCESS, FAILED
    error_message = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())