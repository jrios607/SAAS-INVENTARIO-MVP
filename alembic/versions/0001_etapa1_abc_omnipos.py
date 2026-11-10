"""Etapa 1: Motor ABC Dinamico, Ingesta Omni-POS Valorizada y Anomalias de Stock

Revision ID: 0001_etapa1_abc_omnipos
Revises: None
Create Date: 2026-10-29 14:20:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0001_etapa1_abc_omnipos"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tablas = set(inspector.get_table_names())

    # 1. Extender catalogo_producto si ya existe
    if "catalogo_producto" in tablas:
        cols_cat = {c["name"] for c in inspector.get_columns("catalogo_producto")}
        nuevas_cat = [
            ("clase_abc", sa.Column("clase_abc", sa.String(), nullable=False, server_default="B")),
            ("es_perecible_corto", sa.Column("es_perecible_corto", sa.Boolean(), nullable=False, server_default=sa.text("false") if bind.dialect.name == "postgresql" else sa.text("0"))),
            ("venta_valorizada_ventana", sa.Column("venta_valorizada_ventana", sa.Integer(), nullable=False, server_default="0")),
            ("unidades_vendidas_ventana", sa.Column("unidades_vendidas_ventana", sa.Integer(), nullable=False, server_default="0")),
            ("participacion_ventas", sa.Column("participacion_ventas", sa.Float(), nullable=False, server_default="0.0")),
            ("intervalo_medio_venta_dias", sa.Column("intervalo_medio_venta_dias", sa.Float(), nullable=True)),
            ("ultima_venta_at", sa.Column("ultima_venta_at", sa.DateTime(), nullable=True)),
            ("ultimo_conteo_at", sa.Column("ultimo_conteo_at", sa.DateTime(), nullable=True)),
            ("abc_calculado_at", sa.Column("abc_calculado_at", sa.DateTime(), nullable=True)),
            ("created_at", sa.Column("created_at", sa.DateTime(), nullable=True)),
        ]
        for col_name, col_def in nuevas_cat:
            if col_name not in cols_cat:
                op.add_column("catalogo_producto", col_def)

    # 2. Extender venta_externa si ya existe
    if "venta_externa" in tablas:
        cols_ve = {c["name"] for c in inspector.get_columns("venta_externa")}
        nuevas_ve = [
            ("total_valorizado", sa.Column("total_valorizado", sa.Integer(), nullable=False, server_default="0")),
            ("unidades_deficit", sa.Column("unidades_deficit", sa.Integer(), nullable=False, server_default="0")),
            ("es_carga_historica", sa.Column("es_carga_historica", sa.Boolean(), nullable=False, server_default=sa.text("false") if bind.dialect.name == "postgresql" else sa.text("0"))),
            ("fecha_venta_dt", sa.Column("fecha_venta_dt", sa.DateTime(), nullable=True)),
        ]
        for col_name, col_def in nuevas_ve:
            if col_name not in cols_ve:
                op.add_column("venta_externa", col_def)

    # 3. Crear configuracion_conteo_tenant
    if "configuracion_conteo_tenant" not in tablas:
        op.create_table(
            "configuracion_conteo_tenant",
            sa.Column("tenant_id", sa.String(), sa.ForeignKey("tenant.id", ondelete="CASCADE"), nullable=False),
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("ventana_w_dias", sa.Integer(), nullable=False, server_default="90"),
            sa.Column("umbral_a", sa.Float(), nullable=False, server_default="0.80"),
            sa.Column("umbral_b", sa.Float(), nullable=False, server_default="0.95"),
            sa.Column("dias_producto_nuevo", sa.Integer(), nullable=False, server_default="30"),
            sa.Column("frecuencia_a_dias", sa.Integer(), nullable=False, server_default="7"),
            sa.Column("frecuencia_b_dias", sa.Integer(), nullable=False, server_default="30"),
            sa.Column("frecuencia_c_dias", sa.Integer(), nullable=False, server_default="90"),
            sa.Column("capacidad_diaria_skus", sa.Integer(), nullable=False, server_default="20"),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.UniqueConstraint("tenant_id", name="uq_config_conteo_tenant"),
        )
        op.create_index("ix_configuracion_conteo_tenant_tenant_id", "configuracion_conteo_tenant", ["tenant_id"])

    # 4. Crear venta_externa_item
    if "venta_externa_item" not in tablas:
        op.create_table(
            "venta_externa_item",
            sa.Column("tenant_id", sa.String(), sa.ForeignKey("tenant.id", ondelete="CASCADE"), nullable=False),
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("venta_id", sa.Integer(), sa.ForeignKey("venta_externa.id", ondelete="CASCADE"), nullable=False),
            sa.Column("sku", sa.String(), nullable=False),
            sa.Column("cantidad", sa.Integer(), nullable=False),
            sa.Column("precio_unitario", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("subtotal", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("unidades_descontadas", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("unidades_deficit", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("es_carga_historica", sa.Boolean(), nullable=False, server_default=sa.text("false") if bind.dialect.name == "postgresql" else sa.text("0")),
            sa.Column("fecha_venta", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(
                ["tenant_id", "sku"],
                ["catalogo_producto.tenant_id", "catalogo_producto.sku"],
                ondelete="CASCADE",
            ),
        )
        op.create_index("ix_venta_externa_item_tenant_id", "venta_externa_item", ["tenant_id"])
        op.create_index("ix_venta_externa_item_venta_id", "venta_externa_item", ["venta_id"])
        op.create_index("ix_venta_externa_item_sku", "venta_externa_item", ["sku"])
        op.create_index("ix_venta_externa_item_fecha_venta", "venta_externa_item", ["fecha_venta"])
        op.create_index("idx_vei_tenant_fecha_sku", "venta_externa_item", ["tenant_id", "fecha_venta", "sku"])

    # 5. Crear anomalia_stock
    if "anomalia_stock" not in tablas:
        op.create_table(
            "anomalia_stock",
            sa.Column("tenant_id", sa.String(), sa.ForeignKey("tenant.id", ondelete="CASCADE"), nullable=False),
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("sku", sa.String(), nullable=False),
            sa.Column("ubicacion_id", sa.String(), nullable=True),
            sa.Column("tipo", sa.String(), nullable=False, server_default="VENTA_SIN_STOCK"),
            sa.Column("estado", sa.String(), nullable=False, server_default="ABIERTA"),
            sa.Column("unidades_deficit", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("referencia_ticket", sa.String(), nullable=True),
            sa.Column("detalles", sa.String(), nullable=True),
            sa.Column("reportado_por_id", sa.Integer(), sa.ForeignKey("usuario.id", ondelete="SET NULL"), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("resolved_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(
                ["tenant_id", "sku"],
                ["catalogo_producto.tenant_id", "catalogo_producto.sku"],
                ondelete="CASCADE",
            ),
        )
        op.create_index("ix_anomalia_stock_tenant_id", "anomalia_stock", ["tenant_id"])
        op.create_index("ix_anomalia_stock_sku", "anomalia_stock", ["sku"])
        op.create_index("ix_anomalia_stock_ubicacion_id", "anomalia_stock", ["ubicacion_id"])
        op.create_index("ix_anomalia_stock_created_at", "anomalia_stock", ["created_at"])
        op.create_index("idx_anomalia_tenant_estado_sku", "anomalia_stock", ["tenant_id", "estado", "sku"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tablas = set(inspector.get_table_names())

    if "anomalia_stock" in tablas:
        op.drop_table("anomalia_stock")
    if "venta_externa_item" in tablas:
        op.drop_table("venta_externa_item")
    if "configuracion_conteo_tenant" in tablas:
        op.drop_table("configuracion_conteo_tenant")
