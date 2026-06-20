import logging
from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from typing import List

from app.database import get_db, get_db_read
from app.models import Patente, Sato, DecoracionPlano
from app.schemas import PatenteCreate, PatenteResponse, PatenteUpdate, ComplianceResponse, DecoracionPlanoCreate, DecoracionPlanoResponse, DecoracionPlanoUpdate
from app.core.security import get_current_user, require_role
from app.services.slotting_service import calcular_compliance_patente, get_compliance_batch
from app.core.cache import (
    cache_get, cache_set,
    invalidar_planograma_patente,
    CacheKeys, TTL_PLANOGRAMA,
)

logger = logging.getLogger("sg-wms.patente")

router = APIRouter(
    prefix="/patentes",
    tags=["Gestión de Patentes (Muebles)"]
)

@router.post("/", response_model=PatenteResponse, status_code=201)
def crear_patente(payload: PatenteCreate, db: Session = Depends(get_db), user = Depends(require_role("Admin", "Supervisor"))):
    """
    Registra un nuevo mueble o góndola (Patente) en la sala de ventas.
    """
    patente_existente = db.query(Patente).filter(Patente.id_patente == payload.id_patente).first()
    if patente_existente:
        raise HTTPException(status_code=400, detail="Ya existe una patente con ese ID.")
        
    nueva_patente = Patente(**payload.model_dump())
    db.add(nueva_patente)
    db.commit()
    db.refresh(nueva_patente)
    return nueva_patente

@router.get("/", response_model=List[PatenteResponse])
def listar_patentes(db: Session = Depends(get_db_read), user = Depends(get_current_user)):
    """
    Obtiene la lista de todas las patentes registradas.
    Ruta a Read Replica (CQRS) — sin afectar el Primary.
    """
    try:
        patentes = db.query(Patente).filter(Patente.tipo_ubicacion == "SALA_VENTA").all()
        return patentes
    except Exception:
        logger.exception("Error inesperado en listar_patentes")
        raise HTTPException(status_code=500, detail="Error interno del servidor.")

@router.get("/batch/compliance")
def get_compliance_batch_endpoint(db: Session = Depends(get_db_read), user = Depends(get_current_user)):
    """
    Lee el compliance pre-calculado desde Redis (Asíncrono).
    Si hay Cache Miss, dispara la tarea en background y calcula de forma síncrona como fallback.
    """
    try:
        from app.worker.tasks import calculate_compliance_batch_task
        
        cache_key = "sg:compliance:batch"
        cached_data = cache_get(cache_key)
        
        if cached_data:
            logger.info("CACHE HIT: Retornando compliance batch desde Redis.")
            return cached_data
            
        logger.info("CACHE MISS: Calculando compliance batch en vivo y encolando actualización.")
        # Disparar actualización asíncrona para la próxima vez
        calculate_compliance_batch_task.delay()
        
        # Fallback síncrono para esta petición puntual
        resultado = get_compliance_batch(db)
        cache_set(cache_key, resultado, ttl=600)
        return resultado
        
    except Exception as e:
        logger.exception("Error inesperado en get_compliance_batch_endpoint")
        raise HTTPException(status_code=500, detail="Error interno del servidor.")

# ─── Decoraciones (Textos y Zonas) ───

@router.get("/decoraciones", response_model=List[DecoracionPlanoResponse])
def get_decoraciones(db: Session = Depends(get_db)):
    return db.query(DecoracionPlano).all()

@router.post("/decoraciones", response_model=DecoracionPlanoResponse)
def crear_decoracion(payload: DecoracionPlanoCreate, db: Session = Depends(get_db), user = Depends(require_role("Admin", "Supervisor"))):
    dec = DecoracionPlano(**payload.model_dump())
    db.add(dec)
    db.commit()
    db.refresh(dec)
    return dec

@router.patch("/decoraciones/{dec_id}", response_model=DecoracionPlanoResponse)
def actualizar_decoracion(dec_id: str, payload: DecoracionPlanoUpdate, db: Session = Depends(get_db), user = Depends(require_role("Admin", "Supervisor"))):
    dec = db.query(DecoracionPlano).filter(DecoracionPlano.id == dec_id).first()
    if not dec:
        raise HTTPException(status_code=404, detail="Decoración no encontrada")
    
    update_data = payload.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(dec, key, value)
        
    db.commit()
    db.refresh(dec)
    return dec

@router.delete("/decoraciones/{dec_id}", status_code=204)
def eliminar_decoracion(dec_id: str, db: Session = Depends(get_db), user = Depends(require_role("Admin", "Supervisor"))):
    dec = db.query(DecoracionPlano).filter(DecoracionPlano.id == dec_id).first()
    if not dec:
        raise HTTPException(status_code=404, detail="Decoración no encontrada")
    db.delete(dec)
    db.commit()

# ─── Operaciones Patentes ───

@router.get("/{id_patente}", response_model=PatenteResponse)
def obtener_patente(id_patente: str, db: Session = Depends(get_db), user = Depends(get_current_user)):
    """
    Obtiene los detalles de una patente específica.
    """
    try:
        patente = db.query(Patente).filter(Patente.id_patente == id_patente).first()
        if not patente:
            raise HTTPException(status_code=404, detail="Patente no encontrada")
        return patente
    except HTTPException:
        raise
    except Exception as e:
        import logging
        raise HTTPException(status_code=500, detail="Error interno del servidor.")

@router.put("/{id_patente}", response_model=PatenteResponse)
def actualizar_patente(id_patente: str, payload: PatenteUpdate, db: Session = Depends(get_db), user = Depends(require_role("Admin", "Supervisor"))):
    """
    Actualiza los datos y coordenadas de una patente existente.
    Invalida la caché del planograma de esta patente al finalizar.
    """
    try:
        patente = db.query(Patente).filter(Patente.id_patente == id_patente).first()
        if not patente:
            raise HTTPException(status_code=404, detail="Patente no encontrada")
        
        update_data = payload.model_dump(exclude_unset=True)
        for key, value in update_data.items():
            setattr(patente, key, value)
            
        db.commit()
        db.refresh(patente)

        # ── Invalidación de caché ──────────────────────────────────────
        # Purga planograma individual + compliance batch + mapa bodega
        invalidar_planograma_patente(id_patente)
        logger.info("Patente %s actualizada. Cache de planograma purgado.", id_patente)

        return patente
    except HTTPException:
        raise
    except Exception:
        logger.exception("Error inesperado en actualizar_patente")
        raise HTTPException(status_code=500, detail="Error interno del servidor.")

@router.delete("/{id_patente}", status_code=204)
def eliminar_patente(id_patente: str, db: Session = Depends(get_db), user = Depends(require_role("Admin"))):
    """
    Elimina una patente de la sala de ventas.
    Invalida la caché del planograma de esta patente al finalizar.
    """
    try:
        patente = db.query(Patente).filter(Patente.id_patente == id_patente).first()
        if not patente:
            raise HTTPException(status_code=404, detail="Patente no encontrada")
            
        satos_asociados = db.query(Sato).filter(Sato.ubicacion_id == id_patente).count()
        if satos_asociados > 0:
            raise HTTPException(status_code=400, detail=f"No se puede eliminar la patente porque tiene {satos_asociados} SATOs asociados.")
            
        db.delete(patente)
        db.commit()

        # ── Invalidación de caché ──────────────────────────────────────
        invalidar_planograma_patente(id_patente)
        logger.info("Patente %s eliminada. Cache de planograma purgado.", id_patente)

    except HTTPException:
        raise
    except Exception:
        logger.exception("Error inesperado en eliminar_patente")
        raise HTTPException(status_code=500, detail="Error interno del servidor.")

@router.get("/{id_patente}/compliance", response_model=ComplianceResponse)
def get_compliance_patente(id_patente: str, db: Session = Depends(get_db), user = Depends(get_current_user)):
    """
    Calcula el nivel de cumplimiento del planograma (Micro-Slotting) para una patente específica.
    """
    try:
        patente = db.query(Patente).filter(Patente.id_patente == id_patente).first()
        if not patente:
            raise HTTPException(status_code=404, detail="Patente no encontrada")
            
        satos_vitrina = db.query(Sato).filter(Sato.ubicacion_id == id_patente, Sato.estado == "Vitrina").all()
        return calcular_compliance_patente(patente, satos_vitrina)
    except HTTPException:
        raise
    except Exception as e:
        import logging
        logging.exception("Error inesperado en get_compliance_patente")
        raise HTTPException(status_code=500, detail="Error interno del servidor.")


