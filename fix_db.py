from app.database import engine
from sqlalchemy import text

with engine.connect() as conn:
    queries = [
        "ALTER TABLE satos ADD COLUMN IF NOT EXISTS destino VARCHAR;",
        "ALTER TABLE satos ADD COLUMN IF NOT EXISTS tipo_carga VARCHAR;",
        "ALTER TABLE satos ADD COLUMN IF NOT EXISTS barcode_original VARCHAR;",
        "ALTER TABLE satos ADD COLUMN IF NOT EXISTS lpn VARCHAR;",
        "ALTER TABLE satos ADD COLUMN IF NOT EXISTS tipo_sato VARCHAR NOT NULL DEFAULT 'PRODUCTO';",
    ]
    for q in queries:
        try:
            conn.execute(text(q))
            print(f"Success: {q}")
        except Exception as e:
            print(f"Skipped/Error: {q} -> {e}")
    conn.commit()
    print("All done.")
