"""Liquidacion / Remate pre-merma en lotes Sato

Revision ID: 0003_liquidacion_sato
Revises: 0002_onboarding_omnipos_v2
Create Date: 2026-11-19 00:45:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0003_liquidacion_sato"
down_revision: Union[str, None] = "0002_onboarding_omnipos_v2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tablas = set(inspector.get_table_names())

    if "satos" in tablas:
        cols_satos = {c["name"] for c in inspector.get_columns("satos")}
        nuevas_cols = [
            (
                "en_liquidacion",
                sa.Column(
                    "en_liquidacion",
                    sa.Boolean(),
                    nullable=False,
                    server_default=sa.false(),
                ),
            ),
            (
                "precio_liquidacion",
                sa.Column("precio_liquidacion", sa.Integer(), nullable=True),
            ),
            (
                "liquidacion_at",
                sa.Column("liquidacion_at", sa.DateTime(), nullable=True),
            ),
        ]
        for col_name, col_def in nuevas_cols:
            if col_name not in cols_satos:
                op.add_column("satos", col_def)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tablas = set(inspector.get_table_names())

    if "satos" in tablas:
        cols_satos = {c["name"] for c in inspector.get_columns("satos")}
        for col_name in ("liquidacion_at", "precio_liquidacion", "en_liquidacion"):
            if col_name in cols_satos:
                op.drop_column("satos", col_name)
