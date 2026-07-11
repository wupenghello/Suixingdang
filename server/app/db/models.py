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
    ai_enabled = Column(Boolean, default=True)         # 是否允许使用 AI 助手
    llm_provider_id = Column(String, nullable=True)    # 分配的大模型，为空则用默认
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


class LlmProvider(Base):
    """大模型配置（管理员在后台维护，可分配给用户）。"""
    __tablename__ = "llm_providers"

    id = Column(String, primary_key=True, default=_uuid)
    name = Column(String, nullable=False)              # 显示名称，如"DeepSeek 生产"
    provider = Column(String, default="openai")       # deepseek / openai / custom（均走 OpenAI 兼容协议）
    api_key_enc = Column(Text, default="")             # Fernet 加密后的 API Key
    base_url = Column(String, default="https://api.openai.com/v1")
    model = Column(String, default="gpt-4o-mini")
    enabled = Column(Boolean, default=True)
    is_default = Column(Boolean, default=False)
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
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
    _migrate_llm_from_env()


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
        "ai_enabled": "BOOLEAN DEFAULT 1",
        "llm_provider_id": "TEXT",
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


def _migrate_llm_from_env():
    """首次启动时将 env 中的 LLM 配置迁移到数据库（一次性，幂等）。"""
    import os
    from pathlib import Path as _Path
    db = SessionLocal()
    try:
        # 已经有配置则跳过
        if db.query(LlmProvider).count() > 0:
            return
        # 兼容 Docker env_file（os.environ）和本地 .env 文件
        def _strip_quotes(v: str) -> str:
            # .env 文件中值常被引号包裹（KEY="value"），需去掉首尾匹配的引号，
            # 否则迁移后的 API Key 会带上字面引号导致调用失败。
            if len(v) >= 2 and v[0] == v[-1] and v[0] in ("'", '"'):
                return v[1:-1]
            return v

        def _env(key, default=""):
            val = os.environ.get(key, "")
            if val:
                return _strip_quotes(val)
            # 尝试从 .env 文件读取
            for env_path in [_Path(".env"), _Path("server/.env"), _Path(settings.STORAGE_DIR).parent / ".env"]:
                if env_path.exists():
                    for line in env_path.read_text().splitlines():
                        line = line.strip()
                        if line.startswith(f"{key}="):
                            return _strip_quotes(line.split("=", 1)[1].strip())
            return default

        provider = os.environ.get("LLM_PROVIDER", "").lower()
        if not provider:
            provider = _env("LLM_PROVIDER", "").lower()
        if provider == "deepseek":
            api_key = _env("DEEPSEEK_API_KEY", "")
            base_url = _env("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
            model = _env("DEEPSEEK_MODEL", "deepseek-chat")
        else:
            api_key = _env("OPENAI_API_KEY", "")
            base_url = _env("OPENAI_BASE_URL", "https://api.openai.com/v1")
            model = _env("OPENAI_MODEL", "gpt-4o-mini")
        if not api_key:
            return  # env 中没有有效配置，留空由管理员在后台配置
        from ..core.security import encrypt_api_key
        db.add(LlmProvider(
            name=f"{provider or 'openai'} (迁移)",
            provider=provider or "openai",
            api_key_enc=encrypt_api_key(api_key),
            base_url=base_url,
            model=model,
            enabled=True,
            is_default=True,
        ))
        db.commit()
        print(f"[Suixingdang] LLM 配置已从环境变量迁移到数据库: {provider} / {model}")
    finally:
        db.close()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
