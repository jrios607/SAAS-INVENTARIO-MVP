from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List

from app.database import get_db
from app.models import Patente, Sato
from app.schemas import PatenteCreate, PatenteResponse, StockPatenteResponse

router = APIRouter(
    prefix="/patentes",
    tags=["Patentes"]
)

@router.post("/", response_model=PatenteResponse, status_code=status.HTTP_201_CREATED)
def create_patente(patente: PatenteCreate, db: Session = Depends(get_db)):
    db_patente = db.query(Patente).filter(Patente.id_patente == patente.id_patente).first()
    if db_patente:
        raise HTTPException(status_code=400, detail="La patente con este ID ya existe")
    
    new_patente = Patente(
        id_patente=patente.id_patente,
        area_pasillo=patente.area_pasillo,
        tipo_mueble=patente.tipo_mueble,
        coordenada_x=patente.coordenada_x,
        coordenada_y=patente.coordenada_y,
        ancho=patente.ancho,
        largo=patente.largo,
        url_imagen_planograma=patente.url_imagen_planograma
    )
    db.add(new_patente)
    db.commit()
    db.refresh(new_patente)
    return new_patente

@router.get("/", response_model=List[PatenteResponse])
def get_patentes(db: Session = Depends(get_db)):
    patentes = db.query(Patente).all()
    return patentes

@router.get("/{id_patente}/stock", response_model=List[StockPatenteResponse])
def get_stock_patente(id_patente: str, db: Session = Depends(get_db)):
    patente = db.query(Patente).filter(Patente.id_patente == id_patente).first()
    if not patente:
        raise HTTPException(status_code=404, detail="Patente no encontrada")
    
    satos = db.query(Sato).filter(
        Sato.ubicacion_id == id_patente,
        Sato.estado == "Vitrina"
    ).all()
    
    return satos
