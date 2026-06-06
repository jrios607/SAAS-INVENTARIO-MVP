from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Catalogo_Producto
from app.schemas import ProductoCreate, ProductoResponse

router = APIRouter(tags=["Catálogo de Productos"])

@router.post("/catalogo/producto", response_model=ProductoResponse, status_code=201)
def crear_producto(payload: ProductoCreate, db: Session = Depends(get_db)):
    try:
        nuevo_producto = Catalogo_Producto(**payload.model_dump())
        db.add(nuevo_producto)
        db.commit()
        return ProductoResponse(mensaje="Producto creado exitosamente", sku=nuevo_producto.sku)
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Error al crear producto: {str(e)}")