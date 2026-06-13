from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List

from app.database import get_db
from app.models import Patente, Sato
from app.schemas import PatenteCreate, PatenteResponse, PatenteUpdate, StockPatenteResponse, ComplianceResponse

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

@router.delete("/{id_patente}", status_code=status.HTTP_204_NO_CONTENT)
def delete_patente(id_patente: str, db: Session = Depends(get_db)):
    """Elimina una patente si no tiene SATOs en estado 'Vitrina' en ella."""
    try:
        patente = db.query(Patente).filter(Patente.id_patente == id_patente).first()
        if not patente:
            raise HTTPException(status_code=404, detail="Patente no encontrada")

        satos_en_vitrina = db.query(Sato).filter(
            Sato.ubicacion_id == id_patente,
            Sato.estado == "Vitrina"
        ).first()

        if satos_en_vitrina:
            raise HTTPException(
                status_code=400, 
                detail="No se puede eliminar la patente porque actualmente tiene stock en estado 'Vitrina'."
            )

        db.delete(patente)
        db.commit()
        return

    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{id_patente}/compliance", response_model=ComplianceResponse)
def get_patente_compliance(id_patente: str, db: Session = Depends(get_db)):
    patente = db.query(Patente).filter(Patente.id_patente == id_patente).first()
    if not patente:
        raise HTTPException(status_code=404, detail="Patente no encontrada")

    satos_vitrina = db.query(Sato).filter(
        Sato.ubicacion_id == id_patente,
        Sato.estado == "Vitrina"
    ).all()

    submapeo = patente.submapeo_grid
    
    if not submapeo or not isinstance(submapeo, dict) or "celdas" not in submapeo:
        return {"cumplimiento_porcentaje": 100.0, "discrepancias": ["Sin planograma asignado"]}

    celdas_esperadas = [c for c in submapeo.get("celdas", []) if c.get("sku_asignado")]
    
    if not celdas_esperadas:
        return {"cumplimiento_porcentaje": 100.0, "discrepancias": []}

    aciertos = 0
    discrepancias = []
    
    for celda in celdas_esperadas:
        sku = celda["sku_asignado"]
        r, c = celda["coordenadas"]
        nivel_esperado = r + 1
        frente_esperado = c + 1
        
        encontrado = any(
            s.sku == sku and s.nivel_estante == nivel_esperado and s.frente_posicion == frente_esperado
            for s in satos_vitrina
        )
        
        if encontrado:
            aciertos += 1
        else:
            discrepancias.append(f"Falta SKU {sku} en Nivel {nivel_esperado}, Frente {frente_esperado}")
            
    esperados_set = set(
        (celda["sku_asignado"], celda["coordenadas"][0] + 1, celda["coordenadas"][1] + 1)
        for celda in celdas_esperadas
    )
    
    sobrantes_count = 0
    # Agrupar sobrantes por posición y SKU para no repetir en la lista
    sobrantes_vistos = set()
    for sato in satos_vitrina:
        if not sato.sku:
            continue
        key = (sato.sku, sato.nivel_estante, sato.frente_posicion)
        if key not in esperados_set:
            if key not in sobrantes_vistos:
                sobrantes_count += 1
                discrepancias.append(f"Sobrante: SKU {sato.sku} en Nivel {sato.nivel_estante}, Frente {sato.frente_posicion}")
                sobrantes_vistos.add(key)

    total_esperados = len(celdas_esperadas)
    porcentaje = (aciertos / total_esperados) * 100.0 if total_esperados > 0 else 100.0
    
    # Penalizar sobrantes (5% por cada ubicación errónea)
    porcentaje -= sobrantes_count * 5.0
    porcentaje = max(0.0, min(100.0, round(porcentaje, 1)))

    return {
        "cumplimiento_porcentaje": porcentaje,
        "discrepancias": discrepancias
    }
