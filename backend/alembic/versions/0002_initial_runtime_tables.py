"""Initial runtime tables with PostGIS extension.

Revision ID: 0002_runtime_tables
Revises: 0001_initial_schema
Create Date: 2026-09-13

This migration creates the core runtime tables used by the M-FLOOD backend.
These mirror the tables auto-created by RuntimeStore._init_db() but managed
through Alembic so upgrades are tracked and reproducible.
"""

from alembic import op
import sqlalchemy as sa

revision = "0002_runtime_tables"
down_revision = "0001_initial_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Enable PostGIS extension (idempotent)
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis")

    # Runtime simulation persistence table
    op.create_table(
        "persistent_simulations",
        sa.Column("simulation_id", sa.Text, primary_key=True),
        sa.Column("status", sa.Text, nullable=False),
        sa.Column("created_at", sa.Text, nullable=False),
        sa.Column("data_json", sa.Text, nullable=False),
        sa.Column("updated_at", sa.Text, nullable=False),
    )
    op.create_index(
        "ix_persistent_simulations_status",
        "persistent_simulations",
        ["status"],
    )
    op.create_index(
        "ix_persistent_simulations_created_at",
        "persistent_simulations",
        ["created_at"],
    )

    # Runtime operational alerts table
    op.create_table(
        "persistent_alerts",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("alert_id", sa.Text, unique=True, nullable=True),
        sa.Column("severity", sa.Text, nullable=False),
        sa.Column("data_json", sa.Text, nullable=False),
        sa.Column("created_at", sa.Text, nullable=False),
    )
    op.create_index(
        "ix_persistent_alerts_severity",
        "persistent_alerts",
        ["severity"],
    )
    op.create_index(
        "ix_persistent_alerts_created_at",
        "persistent_alerts",
        ["created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_persistent_alerts_created_at", "persistent_alerts")
    op.drop_index("ix_persistent_alerts_severity", "persistent_alerts")
    op.drop_table("persistent_alerts")
    op.drop_index("ix_persistent_simulations_created_at", "persistent_simulations")
    op.drop_index("ix_persistent_simulations_status", "persistent_simulations")
    op.drop_table("persistent_simulations")
