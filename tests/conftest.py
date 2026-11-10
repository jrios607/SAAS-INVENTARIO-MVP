import os
import pathlib

# Garantizar que toda ejecución de pytest use SQLite local aislado por defecto
# (sin golpear la base de datos remota Neon definida en .env a menos que se fuerce TEST_USE_NEON=1).
if os.environ.get("TEST_USE_NEON") != "1":
    os.environ["DATABASE_URL"] = "sqlite:///./test_chaos_suite.db"
    os.environ["DATABASE_POOLER_URL"] = ""
    os.environ["READ_REPLICA_URL"] = ""


def pytest_sessionfinish(session, exitstatus):
    """Limpia archivos SQLite temporales al finalizar la suite de pruebas."""
    for db_name in ("test_chaos_suite.db", "test_chaos_suite.db-journal", "test_chaos_suite.db-wal"):
        p = pathlib.Path(db_name)
        if p.exists():
            try:
                p.unlink()
            except OSError:
                pass
