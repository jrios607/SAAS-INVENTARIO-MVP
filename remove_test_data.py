import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.database import SessionLocal
from app.models import Patente, Sato, Catalogo_Producto, Log_Transaccional

def remove_test_data():
    db = SessionLocal()
    try:
        print("Iniciando limpieza de la base de datos...")

        # 1. Eliminar los logs transaccionales asociados a los Satos de prueba (usando subquery para no saturar memoria)
        print("Eliminando Logs Transaccionales de los escaneos (Locust)...")
        satos_subquery = db.query(Sato.sato_id).filter(Sato.sku == "SKU-MASSIVE-TEST")
        db.query(Log_Transaccional).filter(Log_Transaccional.sato_id.in_(satos_subquery)).delete(synchronize_session=False)
        db.commit()

        # 2. Eliminar los 50.000 Satos
        print("Eliminando los 50.000 registros de inventario (Satos)...")
        db.query(Sato).filter(Sato.sku == "SKU-MASSIVE-TEST").delete(synchronize_session=False)
        db.commit()

        # 3. Eliminar las 200 Patentes / Góndolas
        print("Eliminando las 200 Patentes simuladas...")
        db.query(Patente).filter(Patente.id_patente.like("PAT-MASSIVE-%")).delete(synchronize_session=False)
        db.commit()

        # 4. Eliminar el producto dummy del catálogo
        print("Eliminando el Producto Maestro de prueba...")
        db.query(Catalogo_Producto).filter(Catalogo_Producto.sku == "SKU-MASSIVE-TEST").delete(synchronize_session=False)
        db.commit()

        print("¡Limpieza completada! El entorno ha regresado a su estado original.")
        
    except Exception as e:
        db.rollback()
        print(f"Error al limpiar la base de datos: {str(e)}")
    finally:
        db.close()

if __name__ == "__main__":
    remove_test_data()
