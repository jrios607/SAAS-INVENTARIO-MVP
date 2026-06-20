"""
app/worker/celery_app.py
─────────────────────────────────────────────────────────────────────────────
Celery Application Factory — SG-BVC EDA Message Broker Layer
─────────────────────────────────────────────────────────────────────────────
Topología:
  Broker  : Redis (mismo nodo que el caché, namespace separado)
  Backend : Redis (para inspect, flower monitoring, task states)
  Workers : Procesos independientes (no bloquean Uvicorn/FastAPI)

Colas definidas:
  sg.integration.erp   → Webhooks hacia ERP externo (alta prioridad)
  sg.integration.dlq   → Dead Letter Queue — tareas que fallaron N reintentos
  sg.celery.default     → Tareas internas de baja prioridad

Configuración de seguridad:
  • Solo serialización JSON (no pickle) para evitar deserialización arbitraria.
  • Task acks_late=True → la tarea NO se confirma al broker hasta finalizar,
    garantizando re-entrega si el worker muere a mitad de ejecución.
  • reject_on_worker_lost=True → si el worker se pierde, la tarea vuelve a la cola.
"""

import os
from celery import Celery
from celery.utils.log import get_task_logger

# Leer la URL de Redis desde el entorno (con fallback a localhost)
REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")

# ── Instancia Celery ──────────────────────────────────────────────────────
celery_app = Celery(
    "sg_wms",
    broker=REDIS_URL,
    backend=REDIS_URL,
    include=[
        "app.worker.tasks",   # Módulo de tareas a auto-descubrir
    ],
)

# ── Configuración de la aplicación ───────────────────────────────────────
celery_app.conf.update(
    # ── Serialización (seguridad) ─────────────────────────────────────
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    event_serializer="json",

    # ── Timezone ─────────────────────────────────────────────────────
    timezone="America/Santiago",
    enable_utc=True,

    # ── Confiabilidad ────────────────────────────────────────────────
    # acks_late: la tarea confirma al broker DESPUÉS de ejecutarse.
    # Si el worker muere, Redis re-entrega la tarea al siguiente worker.
    task_acks_late=True,
    task_reject_on_worker_lost=True,

    # Prefetch: procesar una tarea a la vez por worker.
    # Evita que un worker acumule muchas tareas y se muera con ellas.
    worker_prefetch_multiplier=1,

    # ── Routing de colas ─────────────────────────────────────────────
    task_default_queue="sg.celery.default",
    task_queues={
        "sg.integration.erp": {
            "exchange": "sg.integration",
            "routing_key": "erp",
        },
        "sg.integration.dlq": {
            "exchange": "sg.integration",
            "routing_key": "dlq",
        },
        "sg.celery.default": {
            "exchange": "sg.celery",
            "routing_key": "default",
        },
    },
    task_routes={
        "app.worker.tasks.notify_erp_task": {
            "queue": "sg.integration.erp",
        },
        "app.worker.tasks.dead_letter_task": {
            "queue": "sg.integration.dlq",
        },
    },

    # ── Result backend ───────────────────────────────────────────────
    result_expires=3600,          # Los resultados expiran en 1 hora en Redis
    result_backend_transport_options={
        "master_name": "mymaster"
    },

    # ── Reintentos globales ──────────────────────────────────────────
    # Cada tarea define sus propios reintentos, esto es el fallback.
    task_max_retries=5,

    # ── Monitoreo (para Flower) ──────────────────────────────────────
    worker_send_task_events=True,
    task_send_sent_event=True,
)

# Alias para importar desde otros módulos
app = celery_app
