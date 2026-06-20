import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import func
from app.database import SessionLocal
from app.models import Sato, Patente, Catalogo_Producto

def get_pos_stock():
    db = SessionLocal()
    try:
        # Consultar stock agrupado que cumpla con los requisitos del POS
        resultados = db.query(
            Catalogo_Producto.ean,
            Catalogo_Producto.nombre,
            Catalogo_Producto.precio,
            func.sum(Sato.cantidad).label("stock_total")
        ).select_from(Sato).join(Patente, Sato.ubicacion_id == Patente.id_patente)\
         .join(Catalogo_Producto, Sato.sku == Catalogo_Producto.sku)\
         .filter(
            Sato.estado == "Vitrina",
            Patente.tipo_ubicacion == "SALA_VENTA",
            Sato.cantidad > 0
        ).group_by(
            Catalogo_Producto.ean,
            Catalogo_Producto.nombre,
            Catalogo_Producto.precio
        ).all()

        if not resultados:
            print("No hay stock disponible en Sala de Venta (Vitrinas).")
        else:
            print(f"Encontrados {len(resultados)} productos listos para la venta:")
            print("-" * 60)
            print(f"{'EAN (CÓDIGO)':<15} | {'NOMBRE':<25} | {'PRECIO':<7} | {'STOCK'}")
            print("-" * 60)
            for r in resultados:
                print(f"{r.ean:<15} | {r.nombre:<25} | ${r.precio:<6} | {r.stock_total}")

    except Exception as e:
        print(f"Error consultando stock: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    get_pos_stock()
