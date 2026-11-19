import time
from threading import Lock
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, Form, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from jose import JWTError, jwt
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import (
    create_access_token,
    get_current_user,
    oauth2_scheme,
    verify_password,
)
from app.core.tenant import current_tenant_id
from app.database import get_db, get_db_read
from app.models import Usuario

router = APIRouter(prefix="/auth", tags=["Autenticación"])

# ── Rate Limiting Anti-Fuerza Bruta para Login (Ventana deslizante 60s) ─────
_LOGIN_WINDOW_SECONDS = 60.0
_LOGIN_MAX_FAILURES = 8
_login_failures: Dict[str, List[float]] = {}
_login_lock = Lock()


def reset_login_rate_limiter() -> None:
    """Limpia el estado de intentos fallidos (usado por suites de pruebas)."""
    with _login_lock:
        _login_failures.clear()


def _client_rate_key(request: Request, username: str) -> str:
    client_host = request.client.host if request.client else "local"
    return f"{client_host}:{(username or '').strip().lower()}"


def _check_login_rate_limit(key: str) -> None:
    now = time.monotonic()
    with _login_lock:
        timestamps = [
            ts for ts in _login_failures.get(key, []) if (now - ts) < _LOGIN_WINDOW_SECONDS
        ]
        if timestamps:
            _login_failures[key] = timestamps
        else:
            _login_failures.pop(key, None)

        if len(timestamps) >= _LOGIN_MAX_FAILURES:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Demasiados intentos fallidos de inicio de sesión. Espera un minuto antes de reintentar.",
            )


def _record_login_failure(key: str) -> None:
    now = time.monotonic()
    with _login_lock:
        timestamps = [
            ts for ts in _login_failures.get(key, []) if (now - ts) < _LOGIN_WINDOW_SECONDS
        ]
        timestamps.append(now)
        _login_failures[key] = timestamps


def _clear_login_failures(key: str) -> None:
    with _login_lock:
        _login_failures.pop(key, None)


# ── Esquemas de Autenticación ───────────────────────────────────────────────

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    usuario: str
    rol: str
    tenant_id: str


class UsuarioResponse(BaseModel):
    id: int
    nombre: str
    rol: str
    tenant_id: str

    model_config = ConfigDict(from_attributes=True)


class LoginJsonRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=120)
    password: str = Field(..., min_length=1, max_length=200)
    tenant_id: Optional[str] = Field(default=None, max_length=64)


class AuthStatusResponse(BaseModel):
    auth_required: bool
    authenticated: bool
    usuario: Optional[UsuarioResponse] = None


def _autenticar_usuario_multitenant(
    request: Request,
    db: Session,
    username: str,
    password: str,
    tenant_id_hint: Optional[str] = None,
) -> TokenResponse:
    username_clean = (username or "").strip()
    tenant_clean = (tenant_id_hint or "").strip() or None
    rate_key = _client_rate_key(request, username_clean)

    _check_login_rate_limit(rate_key)

    prev_tenant = current_tenant_id.get()
    user: Optional[Usuario] = None
    try:
        if tenant_clean:
            current_tenant_id.set(tenant_clean)
            user = (
                db.query(Usuario)
                .filter(
                    Usuario.tenant_id == tenant_clean,
                    Usuario.nombre == username_clean,
                )
                .first()
            )
        else:
            # Búsqueda transversal sin filtro automático de tenant
            current_tenant_id.set("")
            candidatos = (
                db.query(Usuario)
                .filter(Usuario.nombre == username_clean)
                .all()
            )
            if len(candidatos) > 1:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Este usuario existe en más de un local. Indica el Código de Local para continuar.",
                )
            user = candidatos[0] if len(candidatos) == 1 else None
    finally:
        current_tenant_id.set(prev_tenant)

    if not user or not user.password_hash or not verify_password(password, user.password_hash):
        _record_login_failure(rate_key)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenciales incorrectas",
            headers={"WWW-Authenticate": "Bearer"},
        )

    _clear_login_failures(rate_key)
    token = create_access_token(
        data={"sub": str(user.id), "rol": user.rol, "tenant_id": user.tenant_id}
    )
    return TokenResponse(
        access_token=token,
        usuario=user.nombre,
        rol=user.rol,
        tenant_id=user.tenant_id,
    )


@router.post("/login", response_model=TokenResponse)
def login(
    request: Request,
    form: OAuth2PasswordRequestForm = Depends(),
    tenant_id: Optional[str] = Form(default=None),
    db: Session = Depends(get_db),
):
    """
    Autenticación OAuth2 (form-urlencoded) con usuario, contraseña y código de local opcional.
    Retorna un JWT válido por 8 horas (1 turno completo).
    """
    tenant_hint = tenant_id or form.client_id
    return _autenticar_usuario_multitenant(
        request=request,
        db=db,
        username=form.username,
        password=form.password,
        tenant_id_hint=tenant_hint,
    )


@router.post("/login-json", response_model=TokenResponse)
def login_json(
    request: Request,
    payload: LoginJsonRequest,
    db: Session = Depends(get_db),
):
    """
    Autenticación JSON para el Frontend (/login) con resolución inteligente de local (tenant_id).
    """
    return _autenticar_usuario_multitenant(
        request=request,
        db=db,
        username=payload.username,
        password=payload.password,
        tenant_id_hint=payload.tenant_id,
    )


@router.get("/status", response_model=AuthStatusResponse)
def get_auth_status(
    token: Optional[str] = Depends(oauth2_scheme),
    db: Session = Depends(get_db_read),
):
    """
    Retorna el estado de autenticación del sistema (`auth_required`) y la sesión activa
    sin lanzar 401 cuando no hay token, permitiendo al Frontend operar en modo híbrido.
    """
    auth_req = bool(settings.AUTH_REQUIRED)
    if not token:
        return AuthStatusResponse(auth_required=auth_req, authenticated=False, usuario=None)

    try:
        payload = jwt.decode(
            token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM]
        )
        sub = payload.get("sub")
        token_tenant = payload.get("tenant_id")
        if sub is None:
            return AuthStatusResponse(auth_required=auth_req, authenticated=False, usuario=None)
        user_id = int(sub)
    except (JWTError, ValueError, TypeError):
        return AuthStatusResponse(auth_required=auth_req, authenticated=False, usuario=None)

    prev_tenant = current_tenant_id.get()
    try:
        if token_tenant:
            current_tenant_id.set(token_tenant)
        user = db.query(Usuario).filter(Usuario.id == user_id).first()
        if not user:
            return AuthStatusResponse(auth_required=auth_req, authenticated=False, usuario=None)
        return AuthStatusResponse(
            auth_required=auth_req,
            authenticated=True,
            usuario=UsuarioResponse(
                id=user.id,
                nombre=user.nombre,
                rol=user.rol,
                tenant_id=user.tenant_id,
            ),
        )
    finally:
        current_tenant_id.set(prev_tenant)


@router.get("/me", response_model=UsuarioResponse)
def get_me(user=Depends(get_current_user)):
    """Retorna la información del usuario logueado."""
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No autenticado. Envíe un token Bearer válido.",
        )
    return user
