"""Onboarding Adaptativo (Tenant.settings) y Refactorizacion Omni-POS v2 (Cuarentena PARCIAL y Descuentos Estructurados)

Revision ID: 0002_onboarding_omnipos_v2
Revises: 0001_etapa1_abc_omnipos
Create Date: 2026-11-05 18:35:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0002_onboarding_omnipos_v2"
down_revision: Union[str, None] = "0001_etapa1_abc_omnipos"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tablas = set(inspector.get_table_names())

    # 1. Extender tenant con settings (JSON)
    if "tenant" in tablas:
        cols_tenant = {c["name"] for c in inspector.get_columns("tenant")}
        if "settings" not in cols_tenant:
            op.add_column(
                "tenant",
                sa.Column(
                    "settings",
                    sa.JSON(),
                    nullable=False,
                    server_default=sa.text("'{}'::jsonb") if bind.dialect.name == "postgresql" else sa.text("'{}'"),
                ),
            )

    # 2. Extender venta_externa con estado_procesamiento, items_huerfanos_count y campos de reversion
    if "venta_externa" in tablas:
        cols_ve = {c["name"] for c in inspector.get_columns("venta_externa")}
        nuevas_ve = [
            ("estado_procesamiento", sa.Column("estado_procesamiento", sa.String(), nullable=False, server_default="COMPLETO")),
            ("items_huerfanos_count", sa.Column("items_huerfanos_count", sa.Integer(), nullable=False, server_default="0")),
            ("revertido_por", sa.Column("revertido_por", sa.String(), nullable=True)),
            ("revertido_at", sa.Column("revertido_at", sa.DateTime(), nullable=True)),
            ("motivo_reversion", sa.Column("motivo_reversion", sa.String(), nullable=True)),
        ]
        for col_name, col_def in nuevas_ve:
            if col_name not in cols_ve:
                op.add_column("venta_externa", col_def)

    # 3. Crear venta_externa_descuento
    if "venta_externa_descuento" not in tablas:
        op.create_table(
            "venta_externa_descuento",
            sa.Column("tenant_id", sa.String(), sa.ForeignKey("tenant.id", ondelete="CASCADE"), nullable=False),
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("venta_id", sa.Integer(), sa.ForeignKey("venta_externa.id", ondelete="CASCADE"), nullable=False),
            sa.Column("sku", sa.String(), nullable=False),
            sa.Column("sato_id", sa.Uuid(as_uuid=True), sa.ForeignKey("satos.sato_id", ondelete="SET NULL"), nullable=True),
            sa.Column("lote", sa.String(), nullable=True),
            sa.Column("ubicacion_id", sa.String(), nullable=True),
            sa.Column("estado_origen", sa.String(), nullable=False, server_default="Vitrina"),
            sa.Column("fecha_vencimiento", sa.Date(), nullable=True),
            sa.Column("unidades_descontadas", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(
                ["tenant_id", "sku"],
                ["catalogo_producto.tenant_id", "catalogo_producto.sku"],
                ondelete="CASCADE",
            ),
        )
        op.create_index("ix_venta_externa_descuento_tenant_id", "venta_externa_descuento", ["tenant_id"])
        op.create_index("ix_venta_externa_descuento_venta_id", "venta_externa_descuento", ["venta_id"])
        op.create_index("ix_venta_externa_descuento_sku", "venta_externa_descuento", ["sku"])
        op.create_index("ix_venta_externa_descuento_sato_id", "venta_externa_descuento", ["sato_id"])
        op.create_index("idx_ved_tenant_venta", "venta_externa_descuento", ["tenant_id", "venta_id"])

    # 4. Crear venta_externa_huerfano
    if "venta_externa_huerfano" not in tablas:
        op.create_table(
            "venta_externa_huerfano",
            sa.Column("tenant_id", sa.String(), sa.ForeignKey("tenant.id", ondelete="CASCADE"), nullable=False),
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("venta_id", sa.Integer(), sa.ForeignKey("venta_externa.id", ondelete="CASCADE"), nullable=False),
            sa.Column("external_ticket_id", sa.String(), nullable=False),
            sa.Column("pos_source", sa.String(), nullable=False),
            sa.Column("codigo_original", sa.String(), nullable=False),
            sa.Column("tipo_codigo", sa.String(), nullable=False, server_default="EAN"),
            sa.Column("cantidad", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("precio_unitario", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("estado", sa.String(), nullable=False, server_default="PENDIENTE"),
            sa.Column("sku_vinculado", sa.String(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("resolved_at", sa.DateTime(), nullable=True),
        )
        op.create_index("ix_venta_externa_huerfano_tenant_id", "venta_externa_huerfano", ["tenant_id"])
        op.create_index("ix_venta_externa_huerfano_venta_id", "venta_externa_huerfano", ["venta_id"])
        op.create_index("ix_venta_externa_huerfano_external_ticket_id", "venta_externa_huerfano", ["external_ticket_id"])
        op.create_index("ix_venta_externa_huerfano_codigo_original", "venta_externa_huerfano", ["codigo_original"])
        op.create_index("ix_venta_externa_huerfano_estado", "venta_externa_huerfano", ["estado"])
        op.create_index("ix_venta_externa_huerfano_created_at", "venta_externa_huerfano", ["created_at"])
        op.create_index("idx_veh_tenant_estado_cod", "venta_externa_huerfano", ["tenant_id", "estado", "codigo_original"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tablas = set(inspector.get_table_names())

    if "venta_externa_huerfano" in tablas:
        op.drop_table("venta_externa_huerfano")
    if "venta_externa_descuento" in tablas:
        op.drop_table("venta_externa_descuento")
