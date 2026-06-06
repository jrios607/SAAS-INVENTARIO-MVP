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

class Planograma(Base):
    __tablename__ = 'planograma'
    id = Column(Integer, primary_key=True, autoincrement=True)
    pasillo = Column(String, nullable=False)
    gondola = Column(String, nullable=False)
    nivel = Column(String, nullable=False)

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
    ubicacion_id = Column(Integer, ForeignKey('planograma.id'), nullable=True)
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