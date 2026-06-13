from app.database import engine
from sqlalchemy import text

with engine.connect() as conn:
    queries = [
        "ALTER TABLE catalogo_producto ADD COLUMN IF NOT EXISTS familia VARCHAR;",
        "ALTER TABLE catalogo_producto ADD COLUMN IF NOT EXISTS sub_familia VARCHAR;",
        "ALTER TABLE catalogo_producto ADD COLUMN IF NOT EXISTS proveedor_marca VARCHAR;"
    ]
    for q in queries:
        try:
            conn.execute(text(q))
            print(f"Executed: {q}")
        except Exception as e:
            print(f"Error executing {q}: {e}")
    conn.commit()
    print("Database altered successfully.")
