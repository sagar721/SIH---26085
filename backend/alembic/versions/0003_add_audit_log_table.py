"""Add audit_log table for auth events and admin actions.

Revision ID: 0003_audit_log
Revises: 0002_runtime_tables
Create Date: 2026-09-13

Captures every security-relevant event: token issuance, revocations,
auth failures, admin actions, and simulation triggers. Required for
production accountability and incident forensics.
"""

from alembic import op
import sqlalchemy as sa

revision = "0003_audit_log"
down_revision = "0002_runtime_tables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "audit_log",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("event_type", sa.String(64), nullable=False),
        # Token events: TOKEN_ISSUED, TOKEN_REVOKED, TOKEN_REFRESHED, OIDC_LOGIN
        # Auth events:  AUTH_FAILED, AUTH_SUCCESS
        # Admin:        ADMIN_ACTION
        # Simulation:   SIMULATION_TRIGGERED, SIMULATION_CANCELLED
        sa.Column("username", sa.String(255), nullable=True),
        sa.Column("role", sa.String(64), nullable=True),
        sa.Column("ip_address", sa.String(64), nullable=True),
        sa.Column("success", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("detail", sa.Text, nullable=True),
        sa.Column("jti", sa.Text, nullable=True),      # JWT token ID for correlation
        sa.Column("simulation_id", sa.Text, nullable=True),  # For SIMULATION_TRIGGERED events
        sa.Column("created_at", sa.DateTime(timezone=True),
                  nullable=False, server_default=sa.text("NOW()")),
    )
    op.create_index(
        "ix_audit_log_event_type",
        "audit_log",
        ["event_type"],
    )
    op.create_index(
        "ix_audit_log_username",
        "audit_log",
        ["username"],
    )
    op.create_index(
        "ix_audit_log_created_at",
        "audit_log",
        ["created_at"],
    )
    op.create_index(
        "ix_audit_log_success",
        "audit_log",
        ["success"],
    )


def downgrade() -> None:
    op.drop_index("ix_audit_log_success", "audit_log")
    op.drop_index("ix_audit_log_created_at", "audit_log")
    op.drop_index("ix_audit_log_username", "audit_log")
    op.drop_index("ix_audit_log_event_type", "audit_log")
    op.drop_table("audit_log")
