"""enforce alias uniqueness

Revision ID: b7c8d9e0f1a2
Revises: f1a2b3c4d5e6
Create Date: 2026-03-25 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "b7c8d9e0f1a2"
down_revision: Union[str, None] = "f1a2b3c4d5e6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Remove duplicates first so index creation does not fail.
    op.execute(
        """
        DELETE FROM aliases a
        USING (
            SELECT ctid
            FROM (
                SELECT
                    ctid,
                    ROW_NUMBER() OVER (
                        PARTITION BY alias_type, lower(alias_value)
                        ORDER BY created_at ASC NULLS LAST, id::text ASC
                    ) AS rn
                FROM aliases
            ) ranked
            WHERE ranked.rn > 1
        ) dupes
        WHERE a.ctid = dupes.ctid
        """
    )

    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS uq_aliases_type_lower_value
        ON aliases (alias_type, lower(alias_value))
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_aliases_type_lower_value")
