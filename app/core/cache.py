"""
app/core/cache.py
─────────────────────────────────────────────────────────────────────────────
Distributed Redis Cache Layer — SG-BVC WMS
─────────────────────────────────────────────────────────────────────────────
Estrategia:
  • Namespaces con prefijos estructurados → fácil invalidación por patrón.
  • TTL configurables por dominio (catálogo, planogramas, dashboard).
  • Connection Pooling mediante redis.ConnectionPool para evitar overhead de
    reconexión en entornos de alta concurrencia (Uvicorn workers).
  • Fail-Open: si Redis no está disponible, todas las ops fallan silenciosamente
    y el servicio continúa leyendo directo desde PostgreSQL.
  • Serialización JSON (no pickle) → portable entre workers distintos.

Namespaces:
  sg:catalogo:productos:all          → Lista completa del catálogo
  sg:catalogo:producto:{sku}         → Producto individual
  sg:catalogo:stock_agrupado         → Vista de stock por familia
  sg:planograma:patente:{id_patente} → JSON de planograma + micro-slotting
  sg:planograma:compliance:batch     → Batch compliance de todas las patentes
  sg:mapa:bodega                     → Mapa completo de bodega
  sg:dashboard:kpis                  → KPIs del dashboard gerencial
"""

import json
import logging
from typing import Optional, Any, List

from app.core.config import settings

logger = logging.getLogger("sg-wms.cache")

# ── TTL por dominio (segundos) ─────────────────────────────────────────────
TTL_CATALOGO      = 3_600   # 1 hora  — catálogo de productos (baja mutación)
TTL_PLANOGRAMA    = 1_800   # 30 min  — planogramas/micro-slotting
TTL_MAPA_BODEGA   = 900     # 15 min  — mapa en tiempo semi-real
TTL_DASHBOARD_KPI = 300     # 5 min   — KPIs gerenciales

# ── Prefijos de namespace ─────────────────────────────────────────────────
NS_CATALOGO   = "sg:catalogo"
NS_PLANOGRAMA = "sg:planograma"
NS_MAPA       = "sg:mapa"
NS_DASHBOARD  = "sg:dashboard"


# ── Inicialización del cliente Redis con Connection Pool ───────────────────
_redis_client = None
_redis_failed = False

def _get_redis():
    """
    Lazy initialization con Connection Pool.
    Evita que el import falle si Redis no está disponible en el arranque.
    """
    global _redis_client, _redis_failed
    if _redis_client is not None:
        return _redis_client
    if _redis_failed:
        return None
        
    try:
        import redis
        if not settings.REDIS_URL:
            _redis_failed = True
            return None
        pool = redis.ConnectionPool.from_url(
            settings.REDIS_URL,
            decode_responses=True,
            max_connections=20,          # Un pool por worker de Uvicorn
            socket_connect_timeout=2,    # Fail-fast si Redis no responde
            socket_timeout=2,
        )
        _redis_client = redis.Redis(connection_pool=pool)
        # Validar la conexión al inicio (ping)
        _redis_client.ping()
        logger.info("[CACHE] Redis conectado en: %s", settings.REDIS_URL)
    except ImportError:
        logger.warning("[CACHE] Libreria 'redis' no instalada. Cache distribuido DESACTIVADO.")
        _redis_failed = True
        _redis_client = None
    except Exception as e:
        logger.warning("[CACHE] No se pudo conectar a Redis (%s). Modo fallback activado.", e)
        _redis_failed = True
        _redis_client = None
    return _redis_client


# ── Operaciones atómicas ───────────────────────────────────────────────────

def cache_get(key: str) -> Optional[Any]:
    """
    Lee un valor del caché.
    Returns None en caso de MISS o error (fail-open).
    """
    client = _get_redis()
    if not client:
        return None
    try:
        raw = client.get(key)
        if raw:
            logger.debug("CACHE HIT → %s", key)
            return json.loads(raw)
        logger.debug("CACHE MISS → %s", key)
    except Exception as e:
        logger.warning("Cache read error (key=%s): %s", key, e)
    return None


def cache_set(key: str, value: Any, ttl: int = TTL_CATALOGO) -> bool:
    """
    Escribe un valor serializado en JSON.
    Usa SETEX para atomicidad TTL+valor.
    """
    client = _get_redis()
    if not client:
        return False
    try:
        client.setex(key, ttl, json.dumps(value, default=str))
        logger.debug("CACHE SET → %s (TTL=%ds)", key, ttl)
        return True
    except Exception as e:
        logger.warning("Cache write error (key=%s): %s", key, e)
        return False


def cache_delete(key: str) -> bool:
    """Elimina una clave de forma puntual (invalidación directa)."""
    client = _get_redis()
    if not client:
        return False
    try:
        deleted = client.delete(key)
        logger.info("CACHE INVALIDATED → %s (deleted=%d)", key, deleted)
        return True
    except Exception as e:
        logger.warning("Cache delete error (key=%s): %s", key, e)
        return False


def cache_delete_pattern(pattern: str) -> int:
    """
    Invalida TODAS las claves que coincidan con un patrón glob.
    Usa SCAN (no KEYS) para evitar bloquear el event-loop de Redis en producción.

    Ejemplo: cache_delete_pattern("sg:catalogo:*")
    Retorna el número de claves eliminadas.
    """
    client = _get_redis()
    if not client:
        return 0
    deleted_count = 0
    try:
        cursor = 0
        while True:
            cursor, keys = client.scan(cursor=cursor, match=pattern, count=100)
            if keys:
                deleted_count += client.delete(*keys)
            if cursor == 0:
                break
        logger.info("CACHE PATTERN INVALIDATED → '%s' (%d claves eliminadas)", pattern, deleted_count)
    except Exception as e:
        logger.warning("Cache pattern-delete error (pattern=%s): %s", pattern, e)
    return deleted_count


# ── API Pública (helpers semánticos por dominio) ───────────────────────────

class CacheKeys:
    """
    Fábrica de claves tipadas.
    Centraliza la nomenclatura y evita 'magic strings' dispersas en el código.
    """
    CATALOGO_ALL           = f"{NS_CATALOGO}:productos:all"
    CATALOGO_STOCK_AGR     = f"{NS_CATALOGO}:stock_agrupado"
    COMPLIANCE_BATCH       = f"{NS_PLANOGRAMA}:compliance:batch"
    MAPA_BODEGA            = f"{NS_MAPA}:bodega"
    DASHBOARD_KPIS         = f"{NS_DASHBOARD}:kpis"

    @staticmethod
    def catalogo_producto(sku: str) -> str:
        return f"{NS_CATALOGO}:producto:{sku}"

    @staticmethod
    def planograma_patente(id_patente: str) -> str:
        return f"{NS_PLANOGRAMA}:patente:{id_patente}"

    @staticmethod
    def stock_zona(id_patente: str) -> str:
        return f"{NS_MAPA}:stock:{id_patente}"


def invalidar_catalogo_completo() -> None:
    """
    Invalida TODOS los artefactos de cache relacionados al catalogo.
    Llamar cuando se crea/edita/elimina cualquier producto.
    """
    cache_delete_pattern(f"{NS_CATALOGO}:*")
    logger.info("[CACHE] Cache de Catalogo INVALIDADO completamente.")


def invalidar_planograma_patente(id_patente: str) -> None:
    """
    Invalida la cache del planograma de una gondola especifica.
    Llamar cuando el Admin edita la distribucion de una patente.
    """
    cache_delete(CacheKeys.planograma_patente(id_patente))
    cache_delete(CacheKeys.COMPLIANCE_BATCH)
    cache_delete(CacheKeys.MAPA_BODEGA)
    logger.info("[CACHE] Cache de Planograma INVALIDADO -> patente=%s", id_patente)


def invalidar_mapa_bodega() -> None:
    """Invalida la vista de mapa de bodega (stock de zonas)."""
    cache_delete_pattern(f"{NS_MAPA}:*")
    logger.info("[CACHE] Cache de Mapa Bodega INVALIDADO.")


# Aliases backward-compat para no romper imports existentes
get_from_cache  = cache_get
set_to_cache    = cache_set
delete_from_cache = cache_delete
