from contextvars import ContextVar

# Almacena el tenant_id de la petición actual
current_tenant_id: ContextVar[str] = ContextVar("current_tenant_id", default=None)
