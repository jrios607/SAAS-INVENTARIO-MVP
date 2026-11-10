import logging
from datetime import date
from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from typing import List

from app.database import get_db, get_db_read
from app.models import Patente, Sato, DecoracionPlano, Catalogo_Producto
from app.schemas import (
    PatenteCreate, PatenteResponse, PatenteUpdate, ComplianceResponse,
    DecoracionPlanoCreate, DecoracionPlanoResponse, DecoracionPlanoUpdate,
    StockPatenteResponse
)
from app.core.security import get_current_user, require_role
from app.services.slotting_service import calcular_compliance_patente, get_compliance_batch
from app.core.cache import (
    cache_get, cache_set,
    invalidar_planograma_patente, invalidar_stock_y_kpis,
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
    try:
        patente_existente = db.query(Patente).filter(Patente.id_patente == payload.id_patente).first()
        if patente_existente:
            raise HTTPException(status_code=400, detail="Ya existe una patente con ese ID.")
            
        nueva_patente = Patente(**payload.model_dump())
        db.add(nueva_patente)
        db.commit()
        db.refresh(nueva_patente)

        invalidar_planograma_patente(payload.id_patente)
        invalidar_stock_y_kpis()
        return nueva_patente
    except HTTPException:
        raise
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Ya existe una patente con ese ID.")
    except Exception:
        db.rollback()
        logger.exception("Error en crear_patente")
        raise HTTPException(status_code=500, detail="Error interno del servidor.")

@router.get("/", response_model=List[PatenteResponse])
def listar_patentes(db: Session = Depends(get_db_read), user = Depends(get_current_user)):
    """
    Obtiene la lista de todas las patentes registradas en la sala de venta.
    Ruta a Read Replica (CQRS).
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
    Lee el compliance pre-calculado desde Redis (Asíncrono) o en vivo con fallback.
    """
    try:
        from app.worker.tasks import calculate_compliance_batch_task
        
        cache_key = CacheKeys.COMPLIANCE_BATCH
        cached_data = cache_get(cache_key)
        
        if cached_data:
            logger.info("CACHE HIT: Retornando compliance batch desde Redis.")
            return cached_data
            
        logger.info("CACHE MISS: Calculando compliance batch en vivo.")
        try:
            from app.core.cache import _get_redis
            if _get_redis() is not None:
                from app.core.tenant import current_tenant_id
                calculate_compliance_batch_task.delay(tenant_id=current_tenant_id.get())
        except Exception as e:
            logger.warning(f"No se pudo encolar calculate_compliance_batch_task: {e}")
        
        resultado = get_compliance_batch(db)
        cache_set(cache_key, resultado, ttl=600)
        return resultado
        
    except Exception as e:
        logger.exception("Error inesperado en get_compliance_batch_endpoint")
        raise HTTPException(status_code=500, detail="Error interno del servidor.")

# ─── Decoraciones (Textos y Zonas) ───

@router.get("/decoraciones", response_model=List[DecoracionPlanoResponse])
def get_decoraciones(db: Session = Depends(get_db_read), user = Depends(get_current_user)):
    return db.query(DecoracionPlano).all()

@router.post("/decoraciones", response_model=DecoracionPlanoResponse)
def crear_decoracion(payload: DecoracionPlanoCreate, db: Session = Depends(get_db), user = Depends(require_role("Admin", "Supervisor"))):
    try:
        dec_existente = db.query(DecoracionPlano).filter(DecoracionPlano.id == payload.id).first()
        if dec_existente:
            raise HTTPException(status_code=400, detail="Ya existe una decoración con ese ID.")

        dec = DecoracionPlano(**payload.model_dump())
        db.add(dec)
        db.commit()
        db.refresh(dec)
        invalidar_planograma_patente(payload.id)
        return dec
    except HTTPException:
        raise
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Ya existe una decoración con ese ID.")
    except Exception:
        db.rollback()
        logger.exception("Error en crear_decoracion")
        raise HTTPException(status_code=500, detail="Error interno del servidor.")

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
    invalidar_planograma_patente(dec_id)
    return dec

@router.delete("/decoraciones/{dec_id}", status_code=204)
def eliminar_decoracion(dec_id: str, db: Session = Depends(get_db), user = Depends(require_role("Admin", "Supervisor"))):
    dec = db.query(DecoracionPlano).filter(DecoracionPlano.id == dec_id).first()
    if not dec:
        raise HTTPException(status_code=404, detail="Decoración no encontrada")
    db.delete(dec)
    db.commit()
    invalidar_planograma_patente(dec_id)

# ─── Operaciones Patentes ───

@router.get("/{id_patente}", response_model=PatenteResponse)
def obtener_patente(id_patente: str, db: Session = Depends(get_db_read), user = Depends(get_current_user)):
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
    except Exception:
        logger.exception("Error en obtener_patente")
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

        invalidar_planograma_patente(id_patente)
        invalidar_stock_y_kpis()
        logger.info("Patente %s actualizada. Cache de planograma purgado.", id_patente)

        return patente
    except HTTPException:
        raise
    except Exception:
        db.rollback()
        logger.exception("Error inesperado en actualizar_patente")
        raise HTTPException(status_code=500, detail="Error interno del servidor.")

@router.delete("/{id_patente}", status_code=204)
def eliminar_patente(id_patente: str, db: Session = Depends(get_db), user = Depends(require_role("Admin"))):
    """
    Elimina una patente de la sala de ventas si no tiene stock activo en vitrina.
    """
    try:
        patente = db.query(Patente).filter(Patente.id_patente == id_patente).first()
        if not patente:
            raise HTTPException(status_code=404, detail="Patente no encontrada")
            
        satos_activos = db.query(Sato).filter(
            Sato.ubicacion_id == id_patente,
            Sato.estado == "Vitrina",
            Sato.cantidad > 0
        ).count()
        if satos_activos > 0:
            raise HTTPException(
                status_code=400,
                detail=f"No se puede eliminar la patente porque tiene {satos_activos} lote(s) activos en vitrina. Muévelos a bodega antes de borrar el mueble."
            )
            
        # Desvincular SATOs agotados históricos
        db.query(Sato).filter(Sato.ubicacion_id == id_patente, Sato.tenant_id == current_tenant_id.get()).update(
            {"ubicacion_id": None, "nivel_estante": None, "frente_posicion": None},
            synchronize_session=False
        )
        db.delete(patente)
        db.commit()

        invalidar_planograma_patente(id_patente)
        invalidar_stock_y_kpis()
        logger.info("Patente %s eliminada y caches purgadas.", id_patente)

    except HTTPException:
        raise
    except Exception:
        db.rollback()
        logger.exception("Error inesperado en eliminar_patente")
        raise HTTPException(status_code=500, detail="Error interno del servidor.")

@router.get("/{id_patente}/compliance", response_model=ComplianceResponse)
def get_compliance_patente(id_patente: str, db: Session = Depends(get_db_read), user = Depends(get_current_user)):
    """
    Calcula el nivel de cumplimiento del planograma (Micro o Macro Slotting) para una patente específica.
    """
    try:
        patente = db.query(Patente).filter(Patente.id_patente == id_patente).first()
        if not patente:
            raise HTTPException(status_code=404, detail="Patente no encontrada")
            
        satos_vitrina = db.query(Sato).filter(
            Sato.ubicacion_id == id_patente,
            Sato.estado == "Vitrina",
            Sato.tipo_sato == "PRODUCTO",
            Sato.cantidad > 0
        ).all()
        return calcular_compliance_patente(patente, satos_vitrina)
    except HTTPException:
        raise
    except Exception:
        logger.exception("Error inesperado en get_compliance_patente")
        raise HTTPException(status_code=500, detail="Error interno del servidor.")

@router.get("/{id_patente}/stock", response_model=List[StockPatenteResponse])
def get_stock_patente(id_patente: str, db: Session = Depends(get_db_read), user = Depends(get_current_user)):
    """
    Obtiene el stock actual en una patente (góndola) específica con datos de catálogo y orden FEFO.
    """
    try:
        patente = db.query(Patente).filter(Patente.id_patente == id_patente).first()
        if not patente:
            raise HTTPException(status_code=404, detail="Patente no encontrada")
            
        hoy = date.today()
        filas = (
            db.query(Sato, Catalogo_Producto.nombre, Catalogo_Producto.unidad_medida)
            .outerjoin(Catalogo_Producto, (Sato.sku == Catalogo_Producto.sku) & (Sato.tenant_id == Catalogo_Producto.tenant_id))
            .filter(
                Sato.ubicacion_id == id_patente,
                Sato.estado == "Vitrina",
                Sato.tipo_sato == "PRODUCTO",
                Sato.cantidad > 0
            )
            .order_by(
                Sato.fecha_vencimiento.asc().nulls_last(),
                Sato.sato_id.asc()
            )
            .all()
        )
        
        resultado = []
        for sato, nombre, unidad in filas:
            dias_restantes = None
            estado_venc = "OK"
            if sato.fecha_vencimiento:
                dias_restantes = (sato.fecha_vencimiento - hoy).days
                if dias_restantes < 0:
                    estado_venc = "VENCIDO"
                elif dias_restantes <= 3:
                    estado_venc = "CRITICO"
                elif dias_restantes <= 7:
                    estado_venc = "PROXIMO"

            resultado.append({
                "sato_id": sato.sato_id,
                "sku": sato.sku,
                "nombre_producto": nombre or sato.sku,
                "lote": sato.lote,
                "cantidad": sato.cantidad,
                "fecha_vencimiento": sato.fecha_vencimiento,
                "dias_restantes": dias_restantes,
                "estado_vencimiento": estado_venc,
                "nivel_estante": sato.nivel_estante,
                "frente_posicion": sato.frente_posicion,
                "unidad_medida": unidad or "UN"
            })
        return resultado
    except HTTPException:
        raise
    except Exception:
        logger.exception("Error en get_stock_patente")
        raise HTTPException(status_code=500, detail="Error interno del servidor.")
