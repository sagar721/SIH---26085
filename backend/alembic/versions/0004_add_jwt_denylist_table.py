"""Add jwt_denylist table for persistent token revocation.

Revision ID: 0004_jwt_denylist
Revises: 0003_audit_log
Create Date: 2026-09-13

Replaces a process-local revoked-tokens set (which would be lost on restart
and not shared across replicas) with a durable table. It acts as the fallback
when Redis is unavailable. Both stores are written on revocation; Redis is
checked first (O(1) lookup) for read performance.
"""

from alembic import op
import sqlalchemy as sa

revision = "0004_jwt_denylist"
down_revision = "0003_audit_log"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "jwt_denylist",
        sa.Column("jti", sa.Text, primary_key=True),
        # ISO-8601 UTC expiry; allows periodic cleanup of expired entries
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_by", sa.String(255), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True),
                  nullable=False, server_default=sa.text("NOW()")),
    )
    op.create_index(
        "ix_jwt_denylist_expires_at",
        "jwt_denylist",
        ["expires_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_jwt_denylist_expires_at", "jwt_denylist")
    op.drop_table("jwt_denylist")
