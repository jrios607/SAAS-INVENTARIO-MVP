import uuid
from datetime import datetime
from sqlalchemy import Column, String, Integer, Date, DateTime, ForeignKey, Uuid
from app.database import Base

class Catalogo_Producto(Base):
    __tablename__ = 'catalogo_producto'
    sku = Column(String, primary_key=True, index=True)
    nombre = Column(String, nullable=False)
    ean = Column(String, nullable=False)
    categoria = Column(String, nullable=True)
    tolerancia_vencimiento_dias = Column(Integer, default=0)

class Patente(Base):
    __tablename__ = 'patente'
    
    id_patente = Column(String, primary_key=True, index=True) # Ej: "485" o "486"
    area_pasillo = Column(String, nullable=False) # Ej: "AREA 20"
    tipo_mueble = Column(String, nullable=False, default="Gondola") # Gondola, Vitrina Frío, etc.
    # Coordenadas para el Gemelo Digital 2D
    coordenada_x = Column(Integer, default=0)
    coordenada_y = Column(Integer, default=0)
    ancho = Column(Integer, default=1)
    largo = Column(Integer, default=1)
    url_imagen_planograma = Column(String, nullable=True) 

class Usuario(Base):
    __tablename__ = 'usuario'
    id = Column(Integer, primary_key=True, autoincrement=True)
    nombre = Column(String, nullable=False)
    rol = Column(String, nullable=False)

class Sato(Base):
    __tablename__ = 'satos'
    sato_id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    padre_id = Column(Uuid(as_uuid=True), ForeignKey('satos.sato_id'), nullable=True) 
    sku = Column(String, ForeignKey('catalogo_producto.sku'), nullable=False, index=True)
    
    # Llave foránea apuntando a la nueva tabla patente
    ubicacion_id = Column(String, ForeignKey('patente.id_patente'), nullable=True)
    
    lote = Column(String, nullable=False)
    fecha_vencimiento = Column(Date, nullable=False)
    cantidad = Column(Integer, nullable=False)
    estado = Column(String, nullable=False, default="Bodega") 

class Log_Transaccional(Base):
    __tablename__ = 'log_transaccional'
    id = Column(Integer, primary_key=True, autoincrement=True)
    sato_id = Column(Uuid(as_uuid=True), ForeignKey('satos.sato_id'), nullable=False)
    usuario_id = Column(Integer, ForeignKey('usuario.id'), nullable=True)
    accion = Column(String, nullable=False)
    fecha_hora = Column(DateTime, default=datetime.utcnow)
    detalles = Column(String, nullable=True)