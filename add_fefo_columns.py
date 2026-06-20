import os
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL")

engine = create_engine(DATABASE_URL)

with engine.begin() as connection:
    try:
        connection.execute(text("ALTER TABLE catalogo_producto ADD COLUMN controla_vencimiento BOOLEAN DEFAULT FALSE;"))
        print("Añadido controla_vencimiento a catalogo_producto")
    except Exception as e:
        print("Error o columna ya existe:", e)

    try:
        connection.execute(text("ALTER TABLE catalogo_producto ADD COLUMN dias_vida_util INTEGER;"))
        print("Añadido dias_vida_util a catalogo_producto")
    except Exception as e:
        print("Error o columna ya existe:", e)
        
    try:
        connection.execute(text("ALTER TABLE satos ADD COLUMN fecha_elaboracion DATE;"))
        print("Añadido fecha_elaboracion a satos")
    except Exception as e:
        print("Error o columna ya existe:", e)

print("Actualización de base de datos finalizada.")
