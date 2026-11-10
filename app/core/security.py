import hmac
from datetime import datetime, timedelta, timezone
from typing import Optional

from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, status, Security
from fastapi.security import OAuth2PasswordBearer, APIKeyHeader
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.tenant import current_tenant_id

# ── Hashing de passwords ──────────────────────────────────────
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

def hash_password(password: str) -> str:
    return pwd_context.hash(password)

# ── JWT ───────────────────────────────────────────────────────
# auto_error=False: la obligatoriedad del token la decide AUTH_REQUIRED
# dentro de get_current_user (permite modo MVP en dev y estricto en prod).
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login", auto_error=False)

# ── API Key (M2M) ─────────────────────────────────────────────
api_key_header = APIKeyHeader(name="X-API-Key", auto_error=True)

def verify_api_key(api_key: str = Security(api_key_header)):
    """
    Autenticación Máquina-a-Máquina (ERP, POS externos con API Key).
    Usa comparación en tiempo constante para evitar timing attacks.
    Si INTEGRATION_API_KEY no está configurada, se rechaza todo acceso M2M.
    """
    expected = settings.INTEGRATION_API_KEY
    if not expected or not hmac.compare_digest(api_key.encode("utf-8"), expected.encode("utf-8")):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API Key"
        )
    return api_key

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    # RFC 7519 / python-jose exigen que "sub" sea string
    if "sub" in to_encode and to_encode["sub"] is not None:
        to_encode["sub"] = str(to_encode["sub"])
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)

# ── Dependencies ──────────────────────────────────────────────
# Comportamiento según settings.AUTH_REQUIRED:
#   False (dev/MVP) → sin token se retorna None y los endpoints siguen abiertos.
#   True  (prod)    → sin token se responde 401.
# En ambos modos, si se envía un token, se valida completo (firma, expiración,
# usuario existente y pertenencia al tenant de la petición).

def get_current_user(token: Optional[str] = Depends(oauth2_scheme)):
    """
    Extrae el usuario del JWT y valida que pertenezca al tenant activo.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Token inválido o expirado",
        headers={"WWW-Authenticate": "Bearer"},
    )

    if token is None:
        if settings.AUTH_REQUIRED:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="No autenticado. Envíe un token Bearer válido.",
                headers={"WWW-Authenticate": "Bearer"},
            )
        return None  # MVP: sin auth obligatoria

    from app.database import SessionLocal
    from app.models import Usuario

    try:
        payload = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
        sub = payload.get("sub")
        if sub is None:
            raise credentials_exception
        user_id = int(sub)
    except (JWTError, ValueError, TypeError):
        raise credentials_exception

    # ── Cruce JWT ↔ Tenant (anti-spoofing de X-Tenant-ID) ─────────────
    token_tenant = payload.get("tenant_id")
    request_tenant = current_tenant_id.get()
    if token_tenant and request_tenant and token_tenant != request_tenant:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="El token no pertenece al tenant solicitado.",
        )

    db = SessionLocal()
    try:
        # El filtro global multi-tenant (do_orm_execute) restringe al tenant activo
        user = db.query(Usuario).filter(Usuario.id == user_id).first()
        if user is None:
            raise credentials_exception
        return user
    finally:
        db.close()

def require_role(*roles: str):
    """
    Dependency factory para verificar roles.
    Uso: user = Depends(require_role("Admin", "Supervisor"))
    """
    def role_checker(user = Depends(get_current_user)):
        if user is None:
            # Solo alcanzable con AUTH_REQUIRED=False (get_current_user ya lanzó 401 si es True)
            return None  # MVP: sin auth obligatoria
        if user.rol not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"El rol '{user.rol}' no tiene permisos para esta acción"
            )
        return user
    return role_checker
