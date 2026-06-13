from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from sqlalchemy import func
from typing import List

from app.database import get_db
from app.models import Catalogo_Producto, Sato
from app.schemas import ProductoCreate, ProductoResponse, ProductoModel, StockAgrupadoFamilia

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

@router.get("/stock-agrupado", response_model=List[StockAgrupadoFamilia])
def get_stock_agrupado(db: Session = Depends(get_db)):
    # 1. Agrupar por producto y sumar stock
    stock_por_producto = (
        db.query(
            Catalogo_Producto.sku,
            Catalogo_Producto.nombre,
            Catalogo_Producto.ean,
            Catalogo_Producto.familia,
            Catalogo_Producto.sub_familia,
            Catalogo_Producto.proveedor_marca,
            func.sum(Sato.cantidad).label("total_stock")
        )
        .outerjoin(Sato, Sato.sku == Catalogo_Producto.sku)
        .group_by(
            Catalogo_Producto.sku,
            Catalogo_Producto.nombre,
            Catalogo_Producto.ean,
            Catalogo_Producto.familia,
            Catalogo_Producto.sub_familia,
            Catalogo_Producto.proveedor_marca
        )
        .all()
    )

    # 2. Reestructurar en familia -> sub_familia -> productos
    agrupado = {}
    for p in stock_por_producto:
        fam = p.familia or "Sin Familia"
        sub = p.sub_familia or "General"
        stock_ind = p.total_stock or 0

        if fam not in agrupado:
            agrupado[fam] = {
                "familia": fam,
                "stock_global_familia": 0,
                "sub_familias_dict": {}
            }
        
        agrupado[fam]["stock_global_familia"] += stock_ind
        
        if sub not in agrupado[fam]["sub_familias_dict"]:
            agrupado[fam]["sub_familias_dict"][sub] = {
                "nombre_sub_familia": sub,
                "stock_sub_familia": 0,
                "productos": []
            }
            
        agrupado[fam]["sub_familias_dict"][sub]["stock_sub_familia"] += stock_ind
        
        agrupado[fam]["sub_familias_dict"][sub]["productos"].append({
            "sku": p.sku,
            "nombre": p.nombre,
            "ean": p.ean,
            "proveedor_marca": p.proveedor_marca,
            "stock_individual": stock_ind
        })

    # Convertir sub_familias_dict a lista
    resultado = []
    for fam_key, fam_val in agrupado.items():
        sub_list = list(fam_val["sub_familias_dict"].values())
        resultado.append({
            "familia": fam_val["familia"],
            "stock_global_familia": fam_val["stock_global_familia"],
            "sub_familias": sub_list
        })

    return resultado