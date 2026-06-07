from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from typing import List

from app.database import get_db
from app.models import Catalogo_Producto
from app.schemas import ProductoCreate, ProductoResponse, ProductoModel

router = APIRouter(
    prefix="/catalogo",
    tags=["Catálogo de Productos"]
)

@router.post("/producto", response_model=ProductoResponse, status_code=201)
def crear_producto(payload: ProductoCreate, db: Session = Depends(get_db)):
    try:
        nuevo_producto = Catalogo_Producto(**payload.model_dump())
        db.add(nuevo_producto)
        db.commit()
        return ProductoResponse(mensaje="Producto creado exitosamente", sku=nuevo_producto.sku)
    except IntegrityError as e:
        db.rollback()
        # Verificar qué campo causó la duplicación
        error_str = str(e.orig).lower()
        if "ean" in error_str:
            mensaje = "Ya existe un producto registrado con ese mismo código EAN / GS1."
        elif "sku" in error_str:
            mensaje = "Ya existe un producto registrado con ese mismo SKU."
        else:
            mensaje = "Error de integridad de datos (posible registro duplicado)."
        raise HTTPException(status_code=400, detail=mensaje)
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Error inesperado al crear producto: {str(e)}")

@router.get("/productos", response_model=List[ProductoModel])
def listar_productos(db: Session = Depends(get_db)):
    return db.query(Catalogo_Producto).all()