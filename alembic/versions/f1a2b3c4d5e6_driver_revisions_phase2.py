"""driver revisions phase 2

Revision ID: f1a2b3c4d5e6
Revises: d4a311607f35
Create Date: 2026-03-24 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "f1a2b3c4d5e6"
down_revision: Union[str, None] = "d4a311607f35"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    billing_status_enum = sa.Enum("active", "paused", "terminated", name="billingstatus")
    billing_status_enum.create(op.get_bind(), checkfirst=True)

    op.add_column(
        "drivers",
        sa.Column(
            "billing_status",
            billing_status_enum,
            nullable=False,
            server_default="active",
        ),
    )
    op.add_column(
        "drivers",
        sa.Column("deposit_required", sa.Numeric(precision=10, scale=2), nullable=False, server_default="0"),
    )
    op.add_column(
        "drivers",
        sa.Column("deposit_posted", sa.Numeric(precision=10, scale=2), nullable=False, server_default="0"),
    )
    op.add_column("drivers", sa.Column("deposit_updated_at", sa.DateTime(), nullable=True))
    op.add_column("drivers", sa.Column("terminated_at", sa.DateTime(), nullable=True))
    op.add_column("drivers", sa.Column("portal_token", sa.String(length=64), nullable=True))

    op.execute("UPDATE drivers SET portal_token = replace(id::text, '-', '') WHERE portal_token IS NULL")
    op.alter_column("drivers", "portal_token", nullable=False)
    op.create_unique_constraint("uq_drivers_portal_token", "drivers", ["portal_token"])
    op.alter_column("drivers", "billing_status", server_default=None)
    op.alter_column("drivers", "deposit_required", server_default=None)
    op.alter_column("drivers", "deposit_posted", server_default=None)

    op.create_table(
        "vehicles",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("license_plate", sa.String(length=20), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("license_plate"),
    )

    op.create_table(
        "driver_vehicle_assignments",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("driver_id", sa.UUID(), nullable=False),
        sa.Column("vehicle_id", sa.UUID(), nullable=False),
        sa.Column("start_at", sa.DateTime(), nullable=False),
        sa.Column("end_at", sa.DateTime(), nullable=True),
        sa.Column("previous_assignment_id", sa.UUID(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["driver_id"], ["drivers.id"]),
        sa.ForeignKeyConstraint(["previous_assignment_id"], ["driver_vehicle_assignments.id"]),
        sa.ForeignKeyConstraint(["vehicle_id"], ["vehicles.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_driver_vehicle_assignments_driver_start",
        "driver_vehicle_assignments",
        ["driver_id", "start_at"],
        unique=False,
    )
    op.create_index(
        "ix_driver_vehicle_assignments_vehicle_start",
        "driver_vehicle_assignments",
        ["vehicle_id", "start_at"],
        unique=False,
    )

    op.add_column(
        "ledger",
        sa.Column("entry_source", sa.String(length=50), nullable=False, server_default="system"),
    )
    op.add_column("ledger", sa.Column("reversal_of_id", sa.UUID(), nullable=True))
    op.alter_column("ledger", "entry_source", server_default=None)


def downgrade() -> None:
    op.drop_column("ledger", "reversal_of_id")
    op.drop_column("ledger", "entry_source")

    op.drop_index("ix_driver_vehicle_assignments_vehicle_start", table_name="driver_vehicle_assignments")
    op.drop_index("ix_driver_vehicle_assignments_driver_start", table_name="driver_vehicle_assignments")
    op.drop_table("driver_vehicle_assignments")
    op.drop_table("vehicles")

    op.drop_constraint("uq_drivers_portal_token", "drivers", type_="unique")
    op.drop_column("drivers", "portal_token")
    op.drop_column("drivers", "terminated_at")
    op.drop_column("drivers", "deposit_updated_at")
    op.drop_column("drivers", "deposit_posted")
    op.drop_column("drivers", "deposit_required")
    op.drop_column("drivers", "billing_status")

    billing_status_enum = sa.Enum("active", "paused", "terminated", name="billingstatus")
    billing_status_enum.drop(op.get_bind(), checkfirst=True)
