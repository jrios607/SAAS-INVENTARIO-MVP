"""
app/cli_seed_users.py
─────────────────────────────────────────────────────────────────────────────
Utilidad CLI idempotente para crear o actualizar las cuentas iniciales
(Admin, Supervisor y Operario) de un local (Tenant) en SG-BVC.

Uso:
    python -m app.cli_seed_users
    python -m app.cli_seed_users --tenant-id 130cc80b-1971-4332-bab3-9ee5ef66063b
"""

import argparse
from typing import Dict, List, Optional
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import hash_password
from app.core.tenant import current_tenant_id
from app.database import Base, SessionLocal, engine
from app.models import Tenant, Usuario


def seed_initial_users(
    db: Session,
    tenant_id: Optional[str] = None,
    nombre_local: str = "Local Principal BVCore",
    admin_user: str = "admin",
    admin_pass: str = "Admin2026!",
    supervisor_user: str = "supervisor",
    supervisor_pass: str = "Supervisor2026!",
    operario_user: str = "operario",
    operario_pass: str = "Operario2026!",
) -> List[Dict[str, str]]:
    """
    Crea o actualiza de forma idempotente las 3 cuentas base (Admin, Supervisor, Operario)
    para el `tenant_id` indicado, asegurando primero que el registro `Tenant` exista.
    """
    target_tenant = (tenant_id or settings.DEFAULT_TENANT_ID).strip()
    prev_tenant = current_tenant_id.get()
    current_tenant_id.set(target_tenant)

    try:
        tenant = db.query(Tenant).filter(Tenant.id == target_tenant).first()
        if not tenant:
            tenant = Tenant(
                id=target_tenant,
                nombre=nombre_local,
                activo=True,
                settings={},
            )
            db.add(tenant)
            db.flush()

        cuentas = [
            (admin_user, admin_pass, "Admin"),
            (supervisor_user, supervisor_pass, "Supervisor"),
            (operario_user, operario_pass, "Operario"),
        ]

        resultado: List[Dict[str, str]] = []
        for username, raw_password, rol in cuentas:
            uname = username.strip()
            existente = (
                db.query(Usuario)
                .filter(
                    Usuario.tenant_id == target_tenant,
                    Usuario.nombre == uname,
                )
                .first()
            )
            hashed = hash_password(raw_password)
            if existente:
                existente.password_hash = hashed
                existente.rol = rol
                accion = "ACTUALIZADO"
            else:
                nuevo = Usuario(
                    tenant_id=target_tenant,
                    nombre=uname,
                    password_hash=hashed,
                    rol=rol,
                )
                db.add(nuevo)
                accion = "CREADO"

            resultado.append(
                {
                    "tenant_id": target_tenant,
                    "usuario": uname,
                    "rol": rol,
                    "accion": accion,
                }
            )

        db.commit()
        return resultado
    finally:
        current_tenant_id.set(prev_tenant)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Crea o actualiza los usuarios iniciales (Admin, Supervisor, Operario) para un local en SG-BVC."
    )
    parser.add_argument(
        "--tenant-id",
        default=settings.DEFAULT_TENANT_ID,
        help="ID del local (Tenant). Por defecto usa DEFAULT_TENANT_ID.",
    )
    parser.add_argument("--nombre-local", default="Local Principal BVCore")
    parser.add_argument("--admin-user", default="admin")
    parser.add_argument("--admin-pass", default="Admin2026!")
    parser.add_argument("--supervisor-user", default="supervisor")
    parser.add_argument("--supervisor-pass", default="Supervisor2026!")
    parser.add_argument("--operario-user", default="operario")
    parser.add_argument("--operario-pass", default="Operario2026!")
    args = parser.parse_args()

    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        cuentas = seed_initial_users(
            db=db,
            tenant_id=args.tenant_id,
            nombre_local=args.nombre_local,
            admin_user=args.admin_user,
            admin_pass=args.admin_pass,
            supervisor_user=args.supervisor_user,
            supervisor_pass=args.supervisor_pass,
            operario_user=args.operario_user,
            operario_pass=args.operario_pass,
        )
        print(f"=== Usuarios listos para Tenant: {args.tenant_id} ===")
        for c in cuentas:
            print(f" - [{c['accion']}] Usuario: {c['usuario']} | Rol: {c['rol']}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
