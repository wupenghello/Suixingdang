"""sms: users.phone + sms_verification_codes

Revision ID: sms_20260722
Revises: dbc95bcd42c7
Create Date: 2026-07-22

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'sms_20260722'
down_revision = 'dbc95bcd42c7'
branch_labels = None
depends_on = None


def upgrade():
    # users.phone：可选、唯一索引（多行 NULL 在 SQLite 不冲突，与行为一致）
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.add_column(sa.Column('phone', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('phone_verified', sa.Boolean(), nullable=True, server_default='0'))
        batch_op.create_index('ix_users_phone', ['phone'], unique=True)

    # 验证码表：bcrypt 哈希落盘，一次性消费，按用途/过期/使用标记索引
    op.create_table(
        'sms_verification_codes',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('phone', sa.String(), nullable=False),
        sa.Column('code_hash', sa.String(), nullable=False),
        sa.Column('purpose', sa.String(), nullable=False),
        sa.Column('user_id', sa.String(), nullable=True),
        sa.Column('username', sa.String(), nullable=True),          # 注册/登录时冗余存，便于审计
        sa.Column('client_ip', sa.String(), nullable=True),
        sa.Column('attempt_count', sa.Integer(), nullable=True, server_default='0'),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
        sa.Column('consumed_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('sms_verification_codes', schema=None) as batch_op:
        batch_op.create_index('ix_svc_phone_purpose', ['phone', 'purpose'])
        batch_op.create_index('ix_svc_user_id', ['user_id'])
        batch_op.create_index('ix_svc_expires', ['expires_at'])
        batch_op.create_index('ix_svc_created', ['created_at'])


def downgrade():
    with op.batch_alter_table('sms_verification_codes', schema=None) as batch_op:
        batch_op.drop_index('ix_svc_created')
        batch_op.drop_index('ix_svc_expires')
        batch_op.drop_index('ix_svc_user_id')
        batch_op.drop_index('ix_svc_phone_purpose')
    op.drop_table('sms_verification_codes')

    # ⚠️ 删除 users.phone 会永久丢失用户已绑定的手机号。
    # 如需保留，请先备份：CREATE TABLE users_phone_backup AS SELECT id, phone, phone_verified FROM users WHERE phone IS NOT NULL;
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_index('ix_users_phone')
        batch_op.drop_column('phone_verified')
        batch_op.drop_column('phone')
