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
        from app.models import Categoria
        # Extraemos y removemos 'categoria' del payload
        data = payload.model_dump()
        nombre_cat = data.pop("categoria", None)
        
        if nombre_cat:
            # Buscar o crear la categoría
            cat_db = db.query(Categoria).filter(Categoria.nombre == nombre_cat).first()
            if not cat_db:
                # Opcional: auto-crear si no existe (ya que el dropdown del frontend está predefinido)
                cat_db = Categoria(nombre=nombre_cat, color_hex="#94a3b8")
                db.add(cat_db)
                db.commit()
                db.refresh(cat_db)
            data["categoria_id"] = cat_db.id

        nuevo_producto = Catalogo_Producto(**data)
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