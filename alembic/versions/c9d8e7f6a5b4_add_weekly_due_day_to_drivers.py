"""add weekly due day to drivers

Revision ID: c9d8e7f6a5b4
Revises: b7c8d9e0f1a2
Create Date: 2026-04-07 19:15:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "c9d8e7f6a5b4"
down_revision: Union[str, None] = "b7c8d9e0f1a2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_DUE_DAY_CHECK = (
    "weekly_due_day IS NULL OR weekly_due_day IN "
    "('monday','tuesday','wednesday','thursday','friday','saturday','sunday')"
)


def upgrade() -> None:
    op.add_column("drivers", sa.Column("weekly_due_day", sa.String(length=16), nullable=True))
    op.create_check_constraint("ck_drivers_weekly_due_day", "drivers", _DUE_DAY_CHECK)

    # 1) Weekly drivers with previous debit -> infer due day from latest debit timestamp.
    op.execute(
        """
        UPDATE drivers d
        SET weekly_due_day = CASE EXTRACT(DOW FROM ld.last_debit)::int
            WHEN 0 THEN 'sunday'
            WHEN 1 THEN 'monday'
            WHEN 2 THEN 'tuesday'
            WHEN 3 THEN 'wednesday'
            WHEN 4 THEN 'thursday'
            WHEN 5 THEN 'friday'
            WHEN 6 THEN 'saturday'
        END
        FROM (
            SELECT l.driver_id, MAX(l.created_at) AS last_debit
            FROM ledger l
            WHERE l.type = 'debit'
            GROUP BY l.driver_id
        ) ld
        WHERE d.id = ld.driver_id
          AND d.billing_type = 'weekly'
          AND d.weekly_due_day IS NULL
        """
    )

    # 2) Remaining weekly drivers without debits -> infer from created_at.
    op.execute(
        """
        UPDATE drivers d
        SET weekly_due_day = CASE EXTRACT(DOW FROM d.created_at)::int
            WHEN 0 THEN 'sunday'
            WHEN 1 THEN 'monday'
            WHEN 2 THEN 'tuesday'
            WHEN 3 THEN 'wednesday'
            WHEN 4 THEN 'thursday'
            WHEN 5 THEN 'friday'
            WHEN 6 THEN 'saturday'
        END
        WHERE d.billing_type = 'weekly'
          AND d.weekly_due_day IS NULL
        """
    )


def downgrade() -> None:
    op.drop_constraint("ck_drivers_weekly_due_day", "drivers", type_="check")
    op.drop_column("drivers", "weekly_due_day")
