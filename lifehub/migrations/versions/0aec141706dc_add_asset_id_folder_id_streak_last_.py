"""add_asset_id_folder_id_streak_last_completed_on

Revision ID: 0aec141706dc
Revises: 1638d9403e33
Create Date: 2026-06-05 17:37:55.638120

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '0aec141706dc'
down_revision = '1638d9403e33'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add asset_id to financial_transactions
    with op.batch_alter_table("financial_transactions") as batch_op:
        batch_op.add_column(
            sa.Column(
                "asset_id",
                sa.Integer(),
                sa.ForeignKey("assets.id", ondelete="SET NULL"),
                nullable=True,
            )
        )
        batch_op.create_index("ix_tx_asset_id", ["asset_id"])

    # Add folder_id to documents
    with op.batch_alter_table("documents") as batch_op:
        batch_op.add_column(
            sa.Column(
                "folder_id",
                sa.Integer(),
                sa.ForeignKey("folders.id", ondelete="SET NULL"),
                nullable=True,
            )
        )
        batch_op.create_index("ix_doc_folder_id", ["folder_id"])

    # Add streak and last_completed_on to tasks
    with op.batch_alter_table("tasks") as batch_op:
        batch_op.add_column(sa.Column("streak", sa.Integer(), default=0, nullable=False))
        batch_op.add_column(sa.Column("last_completed_on", sa.Date(), nullable=True))
        batch_op.create_index("ix_tasks_streak", ["streak"])
        batch_op.create_index("ix_tasks_last_completed_on", ["last_completed_on"])


def downgrade() -> None:
    # Remove columns from tasks
    with op.batch_alter_table("tasks") as batch_op:
        batch_op.drop_index("ix_tasks_last_completed_on")
        batch_op.drop_index("ix_tasks_streak")
        batch_op.drop_column("last_completed_on")
        batch_op.drop_column("streak")

    # Remove folder_id from documents
    with op.batch_alter_table("documents") as batch_op:
        batch_op.drop_index("ix_doc_folder_id")
        batch_op.drop_column("folder_id")

    # Remove asset_id from financial_transactions
    with op.batch_alter_table("financial_transactions") as batch_op:
        batch_op.drop_index("ix_tx_asset_id")
        batch_op.drop_column("asset_id")
