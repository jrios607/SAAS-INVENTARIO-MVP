from app.database import engine, Base
import app.models

print("Creando tablas nuevas...")
Base.metadata.create_all(bind=engine)
print("Tablas creadas correctamente.")
