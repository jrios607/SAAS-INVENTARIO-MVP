from datetime import datetime, timedelta, timezone
from typing import Optional

from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, status, Security
from fastapi.security import OAuth2PasswordBearer, APIKeyHeader
from sqlalchemy.orm import Session

from app.core.config import settings

# ── Hashing de passwords ──────────────────────────────────────
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

def hash_password(password: str) -> str:
    return pwd_context.hash(password)

# ── JWT ───────────────────────────────────────────────────────
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login", auto_error=False)

# ── API Key (M2M) ─────────────────────────────────────────────
api_key_header = APIKeyHeader(name="X-API-Key", auto_error=True)

def verify_api_key(api_key: str = Security(api_key_header)):
    if api_key != settings.INTEGRATION_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API Key"
        )
    return api_key

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)

# ── Dependencies (DESHABILITADAS para MVP) ────────────────────
# Para activar auth, cambiar auto_error=True en oauth2_scheme arriba
# y usar get_current_user / require_role como Depends() en los routers.

def get_current_user(token: Optional[str] = Depends(oauth2_scheme)):
    """
    Extrae el usuario del JWT. 
    En modo MVP (auto_error=False), si no hay token, retorna None.
    """
    if token is None:
        return None  # MVP: sin auth obligatoria
    
    from app.database import SessionLocal
    from app.models import Usuario
    
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Token inválido o expirado",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
        user_id: int = payload.get("sub")
        if user_id is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    
    db = SessionLocal()
    try:
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
            return None  # MVP: sin auth obligatoria
        if user.rol not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"El rol '{user.rol}' no tiene permisos para esta acción"
            )
        return user
    return role_checker
