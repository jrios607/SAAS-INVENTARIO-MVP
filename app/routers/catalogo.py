from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from typing import List

from app.database import get_db
from app.models import Catalogo_Producto
from app.schemas import ProductoCreate, ProductoResponse

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
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Error al crear producto: {str(e)}")

@router.get("/productos", response_model=List[ProductoResponse])
def listar_productos(db: Session = Depends(get_db)):
    productos = db.query(Catalogo_Producto).all()
    return [
        ProductoResponse(mensaje="OK", sku=p.sku)
        for p in productos
    ]