import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import text
from app.database import engine

def add_precio_column():
    with engine.begin() as conn:
        try:
            conn.execute(text("ALTER TABLE catalogo_producto ADD COLUMN precio INTEGER NOT NULL DEFAULT 0;"))
            print("Columna 'precio' agregada exitosamente a 'catalogo_producto'.")
        except Exception as e:
            if "already exists" in str(e) or "duplicate column" in str(e):
                print("La columna 'precio' ya existe.")
            else:
                print(f"Error al agregar columna: {e}")

if __name__ == "__main__":
    add_precio_column()
