import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

from dotenv import load_dotenv

load_dotenv()

SQLALCHEMY_DATABASE_URL = os.getenv("DATABASE_URL")

if not SQLALCHEMY_DATABASE_URL:
    raise RuntimeError("La variable de entorno DATABASE_URL no está configurada en el archivo .env")

# Crear el motor de PostgreSQL (ya no se necesita check_same_thread por ser Postgres)
engine = create_engine(SQLALCHEMY_DATABASE_URL)

# Configurar la fábrica de sesiones
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Base para los modelos ORM
Base = declarative_base()

# Dependencia para los endpoints de FastAPI
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()