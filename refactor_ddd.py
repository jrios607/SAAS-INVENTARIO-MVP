import os
import shutil

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
APP_DIR = os.path.join(BASE_DIR, "app")
ROUTERS_DIR = os.path.join(APP_DIR, "routers")
DOMAINS_DIR = os.path.join(APP_DIR, "domains")

# Definir la estructura de dominios y sus routers
DOMAINS = {
    "pos": ["pos.py", "caja.py"],
    "auth": ["auth.py", "logs.py", "auditoria.py"],
    "integration": ["integration.py", "asn.py", "outbound.py", "trazabilidad.py"],
    "wms": ["bodega.py", "vitrina.py", "merma.py", "patente.py", "catalogo.py", "inventario.py", "dashboard.py", "mapa_bodega.py"]
}

def create_dirs():
    os.makedirs(DOMAINS_DIR, exist_ok=True)
    with open(os.path.join(DOMAINS_DIR, "__init__.py"), "w") as f:
        pass
        
    for domain in DOMAINS.keys():
        domain_path = os.path.join(DOMAINS_DIR, domain)
        os.makedirs(domain_path, exist_ok=True)
        # Crear __init__.py en cada dominio
        with open(os.path.join(domain_path, "__init__.py"), "w") as f:
            pass
        # Crear la carpeta de routers dentro del dominio
        router_dir = os.path.join(domain_path, "routers")
        os.makedirs(router_dir, exist_ok=True)
        with open(os.path.join(router_dir, "__init__.py"), "w") as f:
            pass
        # Crear schemas.py vacío en cada dominio
        with open(os.path.join(domain_path, "schemas.py"), "w") as f:
            pass

def move_routers():
    for domain, routers in DOMAINS.items():
        router_dir = os.path.join(DOMAINS_DIR, domain, "routers")
        for r_file in routers:
            src = os.path.join(ROUTERS_DIR, r_file)
            dst = os.path.join(router_dir, r_file)
            if os.path.exists(src):
                shutil.move(src, dst)
                print(f"Moved {src} to {dst}")
            else:
                print(f"Warning: {src} not found.")

def update_main_py():
    main_path = os.path.join(APP_DIR, "main.py")
    with open(main_path, "r", encoding="utf-8") as f:
        content = f.read()

    # Reemplazar los imports antiguos
    # from app.routers import (...)
    # Lo reemplazaremos por imports específicos por dominio.
    new_imports = """
from app.domains.wms.routers import catalogo, patente, bodega, vitrina, merma, inventario, dashboard, mapa_bodega
from app.domains.pos.routers import pos, caja
from app.domains.auth.routers import auth, logs, auditoria
from app.domains.integration.routers import integration, asn, outbound, trazabilidad
"""

    # Quitar el bloque antiguo de import app.routers
    import re
    content = re.sub(r"from app\.routers import \([\s\S]*?\)", new_imports.strip(), content)

    with open(main_path, "w", encoding="utf-8") as f:
        f.write(content)
        
if __name__ == "__main__":
    print("Iniciando refactorización DDD...")
    create_dirs()
    move_routers()
    update_main_py()
    print("¡Estructura de dominios creada y routers movidos!")
