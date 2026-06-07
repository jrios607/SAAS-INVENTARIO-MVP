from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.database import engine, Base
from app.routers import catalogo, bodega, vitrina, patente, caja, merma, auditoria

Base.metadata.create_all(bind=engine)

app = FastAPI(title="SG - Módulos BVC")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(catalogo.router)
app.include_router(bodega.router)
app.include_router(vitrina.router) 
app.include_router(patente.router)
app.include_router(caja.router)
app.include_router(merma.router)
app.include_router(auditoria.router)
