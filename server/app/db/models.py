"""数据库模型与表结构定义（多账户版）。"""

import uuid
import sqlite3
from datetime import datetime
from sqlalchemy import Column, String, Integer, DateTime, Text, Boolean, ForeignKey, create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from pathlib import Path

from ..config import settings


class Base(DeclarativeBase):
    pass


def _uuid():
    return str(uuid.uuid4())


class User(Base):
    """普通用户。"""
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=_uuid)
    username = Column(String, unique=True, nullable=False)
    password_hash = Column(String, nullable=False)
    totp_secret = Column(String, default="")
    totp_enabled = Column(Boolean, default=False)
    role = Column(String, default="user")
    status = Column(String, default="active")        # active / disabled
    quota_mb = Column(Integer, default=0)             # 存储配额 MB，0=无限
    security_question = Column(Text, default="")      # 密保问题
    security_answer = Column(Text, default="")        # 密保答案（哈希存储）
    last_login_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class Admin(Base):
    """管理员（独立表，与普通用户彻底分离）。"""
    __tablename__ = "admins"

    id = Column(String, primary_key=True, default=_uuid)
    username = Column(String, unique=True, nullable=False)
    password_hash = Column(String, nullable=False)
    totp_secret = Column(String, default="")
    totp_enabled = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class SystemSetting(Base):
    """系统设置键值表，管理员可运行时修改。"""
    __tablename__ = "system_settings"

    key = Column(String, primary_key=True)
    value = Column(Text, default="")
    updated_at = Column(DateTime, default=datetime.utcnow)


class FileGroup(Base):
    """用户自定义文件分组。"""
    __tablename__ = "file_groups"

    id = Column(String, primary_key=True, default=_uuid)
    owner_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)


class File(Base):
    __tablename__ = "files"

    id = Column(String, primary_key=True, default=_uuid)
    owner_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    path = Column(String, nullable=False)
    name = Column(String, nullable=False)
    size = Column(Integer, default=0)
    content_hash = Column(String, index=True)
    mime_type = Column(String, default="application/octet-stream")
    group_id = Column(String, ForeignKey("file_groups.id"), nullable=True, index=True)
    uploaded_at = Column(DateTime, default=datetime.utcnow)
    modified_at = Column(DateTime, default=datetime.utcnow)
    source = Column(String, default="manual")
    guard_status = Column(String, default="safe")
    guard_reason = Column(Text, default="")
    indexed = Column(Boolean, default=False)


class SyncEvent(Base):
    __tablename__ = "sync_events"

    id = Column(String, primary_key=True, default=_uuid)
    user_id = Column(String, ForeignKey("users.id"), nullable=True, index=True)
    file_id = Column(String, ForeignKey("files.id"), nullable=True)
    file_name = Column(String, default="")
    direction = Column(String, nullable=False)
    status = Column(String, default="pending")
    detail = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.utcnow)


class ChatMessage(Base):
    __tablename__ = "chat_history"

    id = Column(String, primary_key=True, default=_uuid)
    user_id = Column(String, ForeignKey("users.id"), nullable=True, index=True)
    role = Column(String, nullable=False)
    content = Column(Text, nullable=False)
    tool_calls = Column(Text, default="[]")
    created_at = Column(DateTime, default=datetime.utcnow)


class AccessToken(Base):
    __tablename__ = "access_tokens"

    id = Column(String, primary_key=True, default=_uuid)
    user_id = Column(String, ForeignKey("users.id"), nullable=True, index=True)
    label = Column(String, default="")
    token_hash = Column(String, unique=True, nullable=False)
    expires_at = Column(DateTime, nullable=True)
    revoked = Column(Boolean, default=False)
    last_used_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class AccessLog(Base):
    __tablename__ = "access_logs"

    id = Column(String, primary_key=True, default=_uuid)
    user_id = Column(String, nullable=True, index=True)
    action = Column(String, nullable=False)
    detail = Column(Text, default="")
    ip = Column(String, default="")
    created_at = Column(DateTime, default=datetime.utcnow)


class TransferMessage(Base):
    """文件传输助手消息：文本便签或已入库文件，统一时间线。"""
    __tablename__ = "transfer_messages"

    id = Column(String, primary_key=True, default=_uuid)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    type = Column(String, nullable=False)            # text / file
    content = Column(Text, default="")               # 文本内容（type=text）
    file_id = Column(String, ForeignKey("files.id"), nullable=True)  # 关联文件（type=file）
    created_at = Column(DateTime, default=datetime.utcnow)


# ---- 引擎 ----
engine = create_engine(
    f"sqlite:///{settings.DATABASE_PATH}",
    connect_args={"check_same_thread": False},
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def get_setting(db, key, default=""):
    s = db.query(SystemSetting).filter_by(key=key).first()
    return s.value if s else default


def set_setting(db, key, value):
    s = db.query(SystemSetting).filter_by(key=key).first()
    if s:
        s.value = str(value)
        s.updated_at = datetime.utcnow()
    else:
        db.add(SystemSetting(key=key, value=str(value)))
    db.commit()


def init_db():
    Path(settings.DATABASE_PATH).parent.mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(bind=engine)
    _migrate_columns()
    _seed_admin()
    _seed_initial_user()


def _migrate_columns():
    """SQLite ALTER TABLE: 为已有表添加新列（create_all 不会自动加列）。"""
    if not Path(settings.DATABASE_PATH).exists():
        return
    conn = sqlite3.connect(settings.DATABASE_PATH)
    cursor = conn.cursor()

    cursor.execute("PRAGMA table_info(users)")
    cols = [r[1] for r in cursor.fetchall()]
    additions = {
        "security_question": 'TEXT DEFAULT ""',
        "security_answer": 'TEXT DEFAULT ""',
        "last_login_at": "DATETIME",
    }
    for col, coltype in additions.items():
        if col not in cols:
            try:
                cursor.execute(f"ALTER TABLE users ADD COLUMN {col} {coltype}")
            except Exception:
                pass

    # files 表新增 group_id 列（关联 file_groups）
    cursor.execute("PRAGMA table_info(files)")
    fcols = [r[1] for r in cursor.fetchall()]
    if "group_id" not in fcols:
        try:
            cursor.execute('ALTER TABLE files ADD COLUMN group_id TEXT DEFAULT NULL')
            try:
                cursor.execute('CREATE INDEX IF NOT EXISTS ix_files_group_id ON files (group_id)')
            except Exception:
                pass
        except Exception:
            pass
    conn.commit()
    conn.close()


def _seed_admin():
    from ..core.security import hash_password
    db = SessionLocal()
    try:
        existing = db.query(Admin).filter_by(username=settings.ADMIN_USERNAME).first()
        if not existing:
            db.add(Admin(
                username=settings.ADMIN_USERNAME,
                password_hash=hash_password(settings.ADMIN_PASSWORD),
            ))
            db.commit()
            print(f"[Suixingdang] 管理员账户已创建: {settings.ADMIN_USERNAME}")
    finally:
        db.close()


def _seed_initial_user():
    from ..core.security import hash_password
    import hashlib
    db = SessionLocal()
    try:
        if db.query(User).count() == 0:
            answer_hash = hashlib.sha256("篮球".strip().lower().encode()).hexdigest()
            db.add(User(
                username="demo",
                password_hash=hash_password("demo"),
                status="active",
                quota_mb=0,
                security_question="你最喜爱的运动是什么？",
                security_answer=answer_hash,
            ))
            db.commit()
            print("[Suixingdang] 初始用户已创建: demo / demo")
    finally:
        db.close()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
