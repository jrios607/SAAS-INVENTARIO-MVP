from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.database import get_db
from app.models import Usuario
from app.core.security import verify_password, hash_password, create_access_token, get_current_user

router = APIRouter(prefix="/auth", tags=["Autenticación"])


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    usuario: str
    rol: str


class UsuarioResponse(BaseModel):
    id: int
    nombre: str
    rol: str

    class Config:
        from_attributes = True


@router.post("/login", response_model=TokenResponse)
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    """
    Autenticación con usuario y contraseña.
    Retorna un JWT válido por 8 horas (1 turno completo).
    """
    user = db.query(Usuario).filter(Usuario.nombre == form.username).first()

    if not user or not user.password_hash:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenciales incorrectas",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not verify_password(form.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenciales incorrectas",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = create_access_token(data={"sub": user.id, "rol": user.rol})
    return TokenResponse(access_token=token, usuario=user.nombre, rol=user.rol)


@router.get("/me", response_model=UsuarioResponse)
def get_me(user=Depends(get_current_user)):
    """Retorna la información del usuario logueado."""
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No autenticado. Envíe un token Bearer válido.",
        )
    return user
