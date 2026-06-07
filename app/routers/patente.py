from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List

from app.database import get_db
from app.models import Patente, Sato
from app.schemas import PatenteCreate, PatenteResponse, PatenteUpdate, StockPatenteResponse

router = APIRouter(
    prefix="/patentes",
    tags=["Patentes"]
)

@router.post("/", response_model=PatenteResponse, status_code=status.HTTP_201_CREATED)
def create_patente(patente: PatenteCreate, db: Session = Depends(get_db)):
    try:
        db_patente = db.query(Patente).filter(Patente.id_patente == patente.id_patente).first()
        if db_patente:
            raise HTTPException(status_code=400, detail="La patente con este ID ya existe")

        new_patente = Patente(**patente.model_dump())
        db.add(new_patente)
        db.commit()
        db.refresh(new_patente)
        return new_patente

    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/", response_model=List[PatenteResponse])
def get_patentes(db: Session = Depends(get_db)):
    patentes = db.query(Patente).all()
    return patentes

@router.put("/{id_patente}", response_model=PatenteResponse)
def update_patente(id_patente: str, payload: PatenteUpdate, db: Session = Depends(get_db)):
    """Actualiza las coordenadas y dimensiones de una patente existente (usado por el editor del mapa 2D)."""
    try:
        db_patente = db.query(Patente).filter(Patente.id_patente == id_patente).first()
        if not db_patente:
            raise HTTPException(status_code=404, detail="Patente no encontrada")

        # Solo actualiza los campos enviados (PATCH semántico con PUT)
        update_data = payload.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(db_patente, field, value)

        db.commit()
        db.refresh(db_patente)
        return db_patente

    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

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
