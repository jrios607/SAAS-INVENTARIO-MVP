import os
import sys
from datetime import timedelta, date
import uuid
import random

# Asegurar que el script puede importar 'app' desde el directorio raíz
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

try:
    from faker import Faker
except ImportError:
    print("Faker no está instalado. Instalando...")
    os.system(f"{sys.executable} -m pip install faker")
    from faker import Faker

from app.database import SessionLocal
from app.models import Patente, Sato, Catalogo_Producto

fake = Faker()

def run_seed():
    db = SessionLocal()
    try:
        print("Iniciando Data Seeding Masivo (Volumen en DB y Frontend)...")
        
        # 1. Crear un producto de prueba masivo si no existe
        sku_masivo = "SKU-MASSIVE-TEST"
        ean_masivo = "EAN-MASSIVE-TEST"
        
        prod = db.query(Catalogo_Producto).filter(Catalogo_Producto.sku == sku_masivo).first()
        if not prod:
            prod = Catalogo_Producto(
                sku=sku_masivo,
                nombre="Producto Masivo Stress Test",
                ean=ean_masivo,
                familia="Stress",
                sub_familia="Load",
                proveedor_marca="QA",
                tolerancia_vencimiento_dias=0,
                controla_vencimiento=True,
                dias_vida_util=365
            )
            db.add(prod)
            db.commit()
            print(f"Producto '{sku_masivo}' creado.")
        
        # 2. Crear 200 Patentes (Góndolas) con coordenadas aleatorias
        print("Generando 200 Patentes (Góndolas)...")
        patentes_data = []
        patente_ids = []
        for i in range(200):
            p_id = f"PAT-MASSIVE-{i}-{uuid.uuid4().hex[:6]}"
            patente_ids.append(p_id)
            patentes_data.append({
                "id_patente": p_id,
                "area_pasillo": f"AREA-STRESS-{random.randint(1, 10)}",
                "tipo_mueble": "Gondola",
                "tipo_ubicacion": "SALA_VENTA",
                "coordenada_x": random.randint(0, 1500), # Rango para el mapa 2D
                "coordenada_y": random.randint(0, 1000),
                "ancho": random.randint(50, 150),
                "largo": random.randint(50, 150),
                "rotacion": random.choice([0.0, 90.0, 180.0, 270.0]),
                "productos_asignados": [sku_masivo],
                "submapeo_grid": {}
            })
        
        # Usamos bulk_insert_mappings para máxima velocidad (bypass de eventos ORM pesados)
        db.bulk_insert_mappings(Patente, patentes_data)
        db.commit()
        print("200 Patentes insertadas exitosamente.")
        
        # 3. Crear 50,000 registros de Sato
        print("Generando 50,000 registros de Sato (Inventario Físico)...")
        satos_data = []
        today = date.today()
        
        total_satos = 50000
        batch_size = 5000
        
        for i in range(total_satos):
            dias_vencimiento = random.randint(10, 365)
            satos_data.append({
                "sato_id": uuid.uuid4(),
                "tipo_sato": "PRODUCTO",
                "sku": sku_masivo,
                "ubicacion_id": random.choice(patente_ids),
                "lote": f"LOTE-{fake.bothify(text='???-####')}",
                "fecha_elaboracion": today - timedelta(days=random.randint(10, 100)),
                "fecha_vencimiento": today + timedelta(days=dias_vencimiento),
                "cantidad": random.randint(1, 50),
                "estado": "Bodega",
                "nivel_estante": random.randint(1, 5),
                "frente_posicion": random.randint(1, 10)
            })
            
            # Inserción en bloques para evitar el colapso de RAM (Load testing de DB)
            if len(satos_data) >= batch_size:
                db.bulk_insert_mappings(Sato, satos_data)
                db.commit()
                print(f"  -> Insertados {i+1} de {total_satos} Satos...")
                satos_data.clear()
        
        if satos_data:
            db.bulk_insert_mappings(Sato, satos_data)
            db.commit()
            
        print("Seeding Masivo finalizado con éxito. Listo para pruebas de Stress frontend y backend.")
        
    except Exception as e:
        db.rollback()
        print(f"Error durante el seeding: {str(e)}")
    finally:
        db.close()

if __name__ == "__main__":
    run_seed()
