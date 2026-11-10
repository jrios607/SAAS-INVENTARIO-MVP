"""
app/services/tenant_settings_service.py
─────────────────────────────────────────────────────────────────────────────
Servicio de Configuración Operativa y Onboarding Adaptativo por Local (Tenant).

Seguridad Multi-Tenant:
  La tabla `Tenant` usa clave primaria `id` (y NO `tenant_id`), por lo que el
  hook global `_add_tenant_filter` en `app/database.py` NO filtra `Tenant`
  automáticamente. Toda consulta en este módulo filtra explícitamente:
      `Tenant.id == current_tenant_id.get()`
  y aplica caché Redis con `_scoped_key` (`CacheKeys.TENANT_SETTINGS`).
"""

import logging
from typing import Any, Dict, List, Optional

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.cache import CacheKeys, cache_delete, cache_get, cache_set
from app.core.config import settings
from app.core.tenant import current_tenant_id
from app.models import Tenant
from app.schemas import (
    VALID_MODULE_IDS,
    TenantBusinessProfile,
    TenantPosStrategy,
    TenantSettingsResponse,
    TenantSettingsUpdate,
)

logger = logging.getLogger("sg-wms.tenant_settings")

BASE_ALWAYS_ENABLED_MODULES: List[str] = [
    "dashboard",
    "catalogo",
    "plano_supermercado",
    "recepcion_bodega",
    "ajustes_inventario",
    "ventas_externas",
    "trazabilidad",
]


def calcular_modulos_por_perfil(
    scale: str,
    pos_mode: str,
    explicit_modules: Optional[List[str]] = None,
) -> List[str]:
    """
    Calcula la lista determinista de módulos habilitados en el Sidebar según:
      • `scale`: 'minimarket' | 'supermercado'
      • `pos_mode`: 'modern_pos' | 'legacy_file_pos' | 'reference_pos'
      • `explicit_modules`: override opcional del administrador (siempre conserva
        `dashboard` y `catalogo` activos para evitar bloqueo accidental).
    """
    if explicit_modules is not None:
        mods: List[str] = []
        for req in ("dashboard", "catalogo"):
            if req not in mods:
                mods.append(req)
        for m in explicit_modules:
            if m in VALID_MODULE_IDS and m not in mods:
                mods.append(m)
        return mods

    mods = list(BASE_ALWAYS_ENABLED_MODULES)
    if scale == "supermercado":
        for m in ("plano_bodega", "ordenes_compra", "picking"):
            if m not in mods:
                mods.append(m)

    # `pos_express` permanece oculto por defecto salvo modo demo explícito (`reference_pos`)
    if pos_mode == "reference_pos" and "pos_express" not in mods:
        mods.append("pos_express")

    # Orden canónico del Sidebar
    return [m for m in VALID_MODULE_IDS if m in mods]


def get_default_settings_dict() -> Dict[str, Any]:
    """
    Configuración por defecto para locales que aún no han ejecutado el Wizard.
    Mantiene todos los módulos operativos visibles (excepto `pos_express` demo)
    y `fallback_to_warehouse_on_zero_shelf = False` (Modo Estricto Vitrina).
    """
    return {
        "onboarding_completed": False,
        "business_profile": {
            "scale": "supermercado",
            "has_separate_warehouse_map": True,
            "uses_gs1_128_fefo": True,
        },
        "pos_strategy": {
            "mode": "legacy_file_pos",
            "accepted_no_sii_disclaimer": False,
            "external_provider": None,
            "fallback_to_warehouse_on_zero_shelf": False,
        },
        "enabled_modules": calcular_modulos_por_perfil("supermercado", "legacy_file_pos"),
    }


def _normalizar_settings_dict(raw: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    defaults = get_default_settings_dict()
    if not isinstance(raw, dict) or not raw:
        return defaults

    bp_raw = raw.get("business_profile") if isinstance(raw.get("business_profile"), dict) else {}
    scale = bp_raw.get("scale") if bp_raw.get("scale") in ("minimarket", "supermercado") else "supermercado"
    has_sep = bool(bp_raw.get("has_separate_warehouse_map", scale == "supermercado"))
    uses_gs1 = bool(bp_raw.get("uses_gs1_128_fefo", True))

    ps_raw = raw.get("pos_strategy") if isinstance(raw.get("pos_strategy"), dict) else {}
    mode = (
        ps_raw.get("mode")
        if ps_raw.get("mode") in ("modern_pos", "legacy_file_pos", "reference_pos")
        else "legacy_file_pos"
    )
    accepted_sii = bool(ps_raw.get("accepted_no_sii_disclaimer", False))
    ext_prov = ps_raw.get("external_provider")
    fallback_bod = bool(ps_raw.get("fallback_to_warehouse_on_zero_shelf", False))

    raw_mods = raw.get("enabled_modules")
    valid_explicit = (
        [m for m in raw_mods if isinstance(m, str) and m in VALID_MODULE_IDS]
        if isinstance(raw_mods, list) and len(raw_mods) > 0
        else None
    )
    enabled_modules = calcular_modulos_por_perfil(scale, mode, valid_explicit)

    return {
        "onboarding_completed": bool(raw.get("onboarding_completed", False)),
        "business_profile": {
            "scale": scale,
            "has_separate_warehouse_map": has_sep,
            "uses_gs1_128_fefo": uses_gs1,
        },
        "pos_strategy": {
            "mode": mode,
            "accepted_no_sii_disclaimer": accepted_sii,
            "external_provider": str(ext_prov)[:64] if ext_prov else None,
            "fallback_to_warehouse_on_zero_shelf": fallback_bod,
        },
        "enabled_modules": enabled_modules,
    }


def obtener_configuracion_tenant(db: Session) -> TenantSettingsResponse:
    """
    Obtiene la configuración operativa del tenant actual (con caché Redis por tenant).
    Seguro para `Depends(get_db_read)` (no muta la BD si el registro `Tenant` no existe).
    """
    tenant_id = current_tenant_id.get() or settings.DEFAULT_TENANT_ID
    cached = cache_get(CacheKeys.TENANT_SETTINGS)
    if isinstance(cached, dict) and cached.get("tenant_id") == tenant_id:
        try:
            return TenantSettingsResponse(**cached)
        except Exception:
            pass

    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    nombre_local = tenant.nombre if (tenant and tenant.nombre) else f"Local {tenant_id[:12]}"
    norm = _normalizar_settings_dict(tenant.settings if tenant else None)

    resp = TenantSettingsResponse(
        tenant_id=tenant_id,
        nombre_local=nombre_local,
        onboarding_completed=norm["onboarding_completed"],
        business_profile=TenantBusinessProfile(**norm["business_profile"]),
        pos_strategy=TenantPosStrategy(**norm["pos_strategy"]),
        enabled_modules=norm["enabled_modules"],
    )
    cache_set(CacheKeys.TENANT_SETTINGS, resp.model_dump(), ttl=1800)
    return resp


def obtener_fallback_bodega_tenant(db: Session) -> bool:
    """
    Devuelve la regla global del local `fallback_to_warehouse_on_zero_shelf`
    definida en el Paso 3 del Onboarding.
    """
    try:
        cfg = obtener_configuracion_tenant(db)
        return bool(cfg.pos_strategy.fallback_to_warehouse_on_zero_shelf)
    except Exception:
        return False


def actualizar_configuracion_tenant(
    db: Session,
    payload: TenantSettingsUpdate,
) -> TenantSettingsResponse:
    """
    Actualiza `Tenant.settings` (y opcionalmente el nombre comercial del local)
    para el tenant activo en el nodo Primary.
    NO hace commit: el router coordina `db.commit()` + invalidación de caché.
    """
    tenant_id = current_tenant_id.get() or settings.DEFAULT_TENANT_ID
    prev_force = getattr(db, "_force_primary", False)
    setattr(db, "_force_primary", True)
    try:
        tenant = (
            db.query(Tenant)
            .filter(Tenant.id == tenant_id)
            .with_for_update()
            .first()
        )
        if tenant is None:
            try:
                with db.begin_nested():
                    nombre_inicial = (
                        payload.nombre_local.strip()
                        if payload.nombre_local
                        else f"Local {tenant_id[:16]}"
                    )
                    tenant = Tenant(
                        id=tenant_id,
                        nombre=nombre_inicial,
                        activo=True,
                        settings=get_default_settings_dict(),
                    )
                    db.add(tenant)
                    db.flush()
            except IntegrityError:
                tenant = (
                    db.query(Tenant)
                    .filter(Tenant.id == tenant_id)
                    .with_for_update()
                    .one()
                )

        actual = _normalizar_settings_dict(tenant.settings)

        if payload.nombre_local and payload.nombre_local.strip():
            nuevo_nombre = payload.nombre_local.strip()
            conflicto = (
                db.query(Tenant.id)
                .filter(Tenant.nombre == nuevo_nombre, Tenant.id != tenant_id)
                .first()
            )
            if not conflicto:
                tenant.nombre = nuevo_nombre

        if payload.business_profile is not None:
            bp = payload.business_profile
            actual["business_profile"] = {
                "scale": bp.scale,
                "has_separate_warehouse_map": bool(bp.has_separate_warehouse_map),
                "uses_gs1_128_fefo": bool(bp.uses_gs1_128_fefo),
            }

        if payload.pos_strategy is not None:
            ps = payload.pos_strategy
            actual["pos_strategy"] = {
                "mode": ps.mode,
                "accepted_no_sii_disclaimer": bool(ps.accepted_no_sii_disclaimer),
                "external_provider": ps.external_provider,
                "fallback_to_warehouse_on_zero_shelf": bool(ps.fallback_to_warehouse_on_zero_shelf),
            }

        scale_eff = actual["business_profile"]["scale"]
        mode_eff = actual["pos_strategy"]["mode"]

        if payload.enabled_modules is not None:
            actual["enabled_modules"] = calcular_modulos_por_perfil(
                scale_eff, mode_eff, payload.enabled_modules
            )
        elif payload.business_profile is not None or payload.pos_strategy is not None:
            actual["enabled_modules"] = calcular_modulos_por_perfil(scale_eff, mode_eff, None)

        if payload.onboarding_completed is not None:
            actual["onboarding_completed"] = bool(payload.onboarding_completed)

        # Reasignar dict completo para que SQLAlchemy detecte mutación en columna JSON
        tenant.settings = dict(actual)
        db.flush()

        return TenantSettingsResponse(
            tenant_id=tenant_id,
            nombre_local=tenant.nombre,
            onboarding_completed=actual["onboarding_completed"],
            business_profile=TenantBusinessProfile(**actual["business_profile"]),
            pos_strategy=TenantPosStrategy(**actual["pos_strategy"]),
            enabled_modules=actual["enabled_modules"],
        )
    finally:
        setattr(db, "_force_primary", prev_force)


def invalidar_cache_tenant_settings() -> None:
    cache_delete(CacheKeys.TENANT_SETTINGS)
