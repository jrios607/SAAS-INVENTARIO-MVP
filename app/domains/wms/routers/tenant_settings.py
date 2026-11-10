"""
app/domains/wms/routers/tenant_settings.py
─────────────────────────────────────────────────────────────────────────────
Endpoints de Configuración Operativa del Local y Onboarding Adaptativo (Feature Flags).
"""

import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.cache import CacheKeys, cache_set
from app.core.security import get_current_user, require_role
from app.database import get_db, get_db_read
from app.schemas import TenantSettingsResponse, TenantSettingsUpdate
from app.services.tenant_settings_service import (
    actualizar_configuracion_tenant,
    invalidar_cache_tenant_settings,
    obtener_configuracion_tenant,
)

logger = logging.getLogger("sg-wms.router.tenant_settings")

router = APIRouter(prefix="/tenant", tags=["Perfil del Local y Feature Flags"])


@router.get(
    "/settings",
    response_model=TenantSettingsResponse,
    summary="Obtener configuración de perfil, onboarding y módulos habilitados del local",
)
def get_tenant_settings(
    db: Session = Depends(get_db_read),
    user=Depends(get_current_user),
):
    return obtener_configuracion_tenant(db)


@router.put(
    "/settings",
    response_model=TenantSettingsResponse,
    summary="Actualizar perfil operativo, estrategia POS y módulos visibles del local",
)
def put_tenant_settings(
    payload: TenantSettingsUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_role("Admin", "Supervisor")),
):
    try:
        resultado = actualizar_configuracion_tenant(db, payload)
        db.commit()
        invalidar_cache_tenant_settings()
        cache_set(CacheKeys.TENANT_SETTINGS, resultado.model_dump(), ttl=1800)
        return resultado
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception:
        db.rollback()
        logger.exception("Error inesperado al actualizar configuración del tenant")
        raise HTTPException(status_code=500, detail="Error interno al guardar la configuración del local.")
