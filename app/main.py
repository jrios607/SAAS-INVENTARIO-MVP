from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException
from fastapi.middleware.cors import CORSMiddleware
from app.database import engine, Base
from app.routers import catalogo, bodega, vitrina, patente, caja, merma, auditoria, asn, logs

Base.metadata.create_all(bind=engine)

app = FastAPI(title="SG - Módulos BVC")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"success": False, "error_code": "HTTP_ERROR", "message": str(exc.detail)}
    )

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=422,
        content={"success": False, "error_code": "VALIDATION_ERROR", "message": "Error de validación en la petición", "details": exc.errors()}
    )

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    print(f"Global exception: {exc}") # Idealmente usar logging
    return JSONResponse(
        status_code=500,
        content={"success": False, "error_code": "INTERNAL_SERVER_ERROR", "message": "Ha ocurrido un error inesperado en el servidor."}
    )

app.include_router(catalogo.router)
app.include_router(bodega.router)
app.include_router(vitrina.router) 
app.include_router(patente.router)
app.include_router(caja.router)
app.include_router(merma.router)
app.include_router(auditoria.router)
app.include_router(asn.router)
app.include_router(logs.router)
