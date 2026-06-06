from fastapi import FastAPI
from app.database import engine, Base
from app.routers import catalogo, bodega, vitrina # 1. Agregas 'vitrina' aquí
from app.routers import patente
from app.routers import caja
from app.routers import merma
from app.routers import auditoria

# Creamos las tablas al iniciar
Base.metadata.create_all(bind=engine)

app = FastAPI(title="SG - Módulos BVC")

# Conectamos las rutas
app.include_router(catalogo.router)
app.include_router(bodega.router)
app.include_router(vitrina.router) 
app.include_router(patente.router)
app.include_router(caja.router)
app.include_router(merma.router)
app.include_router(auditoria.router)
