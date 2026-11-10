import uuid
from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks
from sqlalchemy.orm import Session
from app.database import get_db, get_db_read
from app.models import Sato
from app.schemas import PalletReceptionRequest, PalletReceptionResponse, LpnReceptionRequest, LpnReceptionResponse, AjusteInventarioRequest, SatoRecepcionDetalle, SatoModel
from app.core.security import get_current_user, require_role
from app.services.recepcion_service import recepcionar_pallet, recepcionar_lpn, get_satos_en_recepcion, DuplicateLPNError
from app.services.inventario_service import ajustar_inventario_sato, InventarioError
from app.core.cache import invalidar_stock_y_kpis

router = APIRouter(
    prefix="/bodega",
    tags=["Bodega - Recepción"]
)

@router.post("/recepcion/pallet", response_model=PalletReceptionResponse, status_code=201)
def route_recepcionar_pallet(payload: PalletReceptionRequest, db: Session = Depends(get_db), user = Depends(require_role("Operario", "Admin", "Supervisor"))):
    user_id = getattr(user, "id", None)
    try:
        resultado = recepcionar_pallet(
            db,
            payload.barcode_text,
            ubicacion_id=payload.ubicacion_id,
            user_id=user_id,
            modo_ingreso=payload.modo_ingreso,
            cantidad_recibida=payload.cantidad_recibida,
        )
        invalidar_stock_y_kpis()
        return PalletReceptionResponse(**resultado)
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        import logging
        logging.exception("Error inesperado en recepcionar_pallet")
        raise HTTPException(status_code=500, detail="Error interno del servidor.")

@router.get("/recepcion/satos", response_model=list[SatoRecepcionDetalle])
def route_get_satos_en_recepcion(db: Session = Depends(get_db_read), user = Depends(get_current_user)):
    return get_satos_en_recepcion(db)

@router.post("/satos/{sato_id}/ajuste")
def route_ajustar_inventario(sato_id: str, payload: AjusteInventarioRequest, db: Session = Depends(get_db), user = Depends(require_role("Admin", "Supervisor"))):
    user_id = getattr(user, "id", None)
    try:
        res = ajustar_inventario_sato(
            db=db,
            sato_id=sato_id,
            cantidad_a_restar=payload.cantidad_a_restar,
            motivo=payload.motivo,
            url_foto=payload.url_foto,
            user_id=user_id
        )
        invalidar_stock_y_kpis()
        return res
    except InventarioError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        import logging
        logging.exception("Error inesperado en ajustar_inventario_sato")
        raise HTTPException(status_code=500, detail="Error interno del servidor.")

@router.post("/recepcion/lpn", response_model=LpnReceptionResponse, status_code=201)
def route_recepcionar_lpn(request: LpnReceptionRequest, background_tasks: BackgroundTasks, db: Session = Depends(get_db), user = Depends(require_role("Operario", "Admin", "Supervisor"))):
    user_id = getattr(user, "id", None)
    try:
        resultado = recepcionar_lpn(db, request.model_dump(), background_tasks, user_id=user_id)
        invalidar_stock_y_kpis()
        return LpnReceptionResponse(**resultado)
    except DuplicateLPNError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        import logging
        logging.exception("Error inesperado en recepcionar_lpn")
        raise HTTPException(status_code=500, detail="Error interno del servidor al recepcionar LPN.")

@router.get("/satos/disponibles", response_model=list[SatoModel])
def route_get_satos_disponibles(db: Session = Depends(get_db_read), user = Depends(get_current_user)):
    try:
        from datetime import date
        from app.models import Catalogo_Producto
        hoy = date.today()

        filas = (
            db.query(Sato, Catalogo_Producto.nombre, Catalogo_Producto.unidad_medida)
            .outerjoin(Catalogo_Producto, (Sato.sku == Catalogo_Producto.sku) & (Sato.tenant_id == Catalogo_Producto.tenant_id))
            .filter(
                Sato.tipo_sato == "PRODUCTO",
                Sato.estado.in_(["Bodega", "Bodega Recepcion"]),
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
                "padre_id": sato.padre_id,
                "tipo_sato": sato.tipo_sato,
                "lpn": sato.lpn,
                "sku": sato.sku,
                "nombre_producto": nombre or sato.sku,
                "lote": sato.lote,
                "ubicacion_id": sato.ubicacion_id,
                "cantidad": sato.cantidad,
                "estado": sato.estado,
                "fecha_elaboracion": sato.fecha_elaboracion,
                "fecha_vencimiento": sato.fecha_vencimiento,
                "dias_restantes": dias_restantes,
                "estado_vencimiento": estado_venc,
                "unidad_medida": unidad or "UN"
            })
        return resultado
    except Exception as e:
        import logging
        logging.exception("Error inesperado en get_satos_disponibles")
        raise HTTPException(status_code=500, detail="Error interno del servidor.")