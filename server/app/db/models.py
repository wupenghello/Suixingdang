"""数据库模型与表结构定义（多账户版）。"""

import uuid
import threading
from datetime import datetime, timedelta
from sqlalchemy import Column, String, Integer, DateTime, Text, Boolean, ForeignKey, JSON, create_engine, event
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
    password_version = Column(Integer, default=1)     # 密码版本号：改/重置密码时 +1，使旧 refresh/access 立即失效
    password_changed_at = Column(DateTime, nullable=True)  # 最近一次修改/重置密码时间（注册初始设置不计，NULL=从未修改）
    prefs = Column(Text, default="{}")                # 界面偏好 JSON 串（侧栏状态/快捷键风格等）；key 白名单与类型校验在 api/auth.py，无 PII
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
    tags = Column(Text, default="[]")           # JSON 数组字符串，笔记标签
    pinned = Column(Boolean, default=False)     # 收藏/置顶
    summary = Column(Text, default="")          # AI 自动摘要
    ai_tags = Column(Text, default="[]")        # AI 建议标签（JSON 数组），与人工 tags 区分
    deleted_at = Column(DateTime, nullable=True, index=True)  # 软删除时间：NULL=活跃，非NULL=在回收站内
    locked_at = Column(DateTime, nullable=True, index=True)  # 锁存时间：非NULL=跳出自动清理（用户手动保护）
    original_dir = Column(Text, default="")     # 删除时所在目录，恢复时优先归位到此目录


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
    kind = Column(String, default="device")           # device=守护进程等外部令牌 / session=浏览器登录会话
    label = Column(String, default="")
    device_fingerprint = Column(String, default="", index=True)  # 同设备指纹(sha256(ip|ua))，用于会话复用去重
    ip = Column(String, default="")                    # 登录时的客户端 IP（会话审计与展示）
    geo = Column(String, default="")                   # IP 地域（城市·国家），登录时解析一次缓存
    token_hash = Column(String, unique=True, nullable=False)
    expires_at = Column(DateTime, nullable=True)
    revoked = Column(Boolean, default=False)
    last_used_at = Column(DateTime, nullable=True)
    download_granted_until = Column(DateTime, nullable=True)  # 临时下载授权窗口（仅 session 用）
    download_granted_at = Column(DateTime, nullable=True)    # 临时下载授权开启时间（用于审计本次窗口内的下载记录）
    single_download_path = Column(Text, default="")        # 单次下载授权路径（验证密码后仅允许下载此文件一次）
    created_at = Column(DateTime, default=datetime.utcnow)


class AccessLog(Base):
    __tablename__ = "access_logs"

    id = Column(String, primary_key=True, default=_uuid)
    user_id = Column(String, nullable=True, index=True)
    action = Column(String, nullable=False)
    detail = Column(Text, default="")
    ip = Column(String, default="")
    created_at = Column(DateTime, default=datetime.utcnow)


class LoginAttempt(Base):
    """登录限流计数（DB 共享，多 worker 生效；按 key 隔离 login/admin/reset）。"""
    __tablename__ = "login_attempts"

    key = Column(String, primary_key=True)
    fail_count = Column(Integer, default=0)
    first_fail_at = Column(DateTime, nullable=True)
    locked_until = Column(DateTime, nullable=True)


class TransferMessage(Base):
    """文件传输助手消息：文本便签或已入库文件，统一时间线。"""
    __tablename__ = "transfer_messages"

    id = Column(String, primary_key=True, default=_uuid)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    type = Column(String, nullable=False)            # text / file
    content = Column(Text, default="")               # 文本内容（type=text）
    file_id = Column(String, ForeignKey("files.id"), nullable=True)  # 关联文件（type=file）
    created_at = Column(DateTime, default=datetime.utcnow)


class MaskMapping(Base):
    """脱敏映射表：mask_id -> real_value，用于服务端脱敏后按需解密。

    mask_id 为确定性哈希（user_id + 服务端密钥 + 原文），同一用户同一值
    始终生成相同 mask_id，解密时校验 user_id 归属。
    """
    __tablename__ = "mask_mappings"

    mask_id = Column(String, primary_key=True)       # 16 位 hex
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    real_value = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


# ---- 引擎 ----
# SQLite 默认（自托管零配置）；DATABASE_URL 指向 PostgreSQL 时切换方言
# （终局形态：Postgres+pgvector，见 docs/plans/refactor-tobe.md §6.6）。
_engine_kwargs = {}
if settings.sql_database_url.startswith("sqlite"):
    _engine_kwargs["connect_args"] = {"check_same_thread": False}
engine = create_engine(settings.sql_database_url, **_engine_kwargs)


@event.listens_for(engine, "connect")
def _set_sqlite_pragmas(dbapi_conn, conn_record):
    """WAL + synchronous=NORMAL：大幅降低每次 COMMIT 的 fsync 开销，且无损坏风险
   （仅在断电时可能丢失最后一个未 checkpoint 的事务）。仅 SQLite 生效。"""
    if not settings.sql_database_url.startswith("sqlite"):
        return
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA journal_mode=WAL")
    cur.execute("PRAGMA synchronous=NORMAL")
    cur.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Job(Base):
    """异步任务队列条目（任务表 + SKIP LOCKED 领取，零额外基建）。

    kind 约定：reindex_file / purge_trash / rebuild_user_index 等。
    worker 以 FOR UPDATE SKIP LOCKED（PG）或 BEGIN IMMEDIATE（SQLite）领取。
    """
    __tablename__ = "jobs"

    id = Column(String, primary_key=True, default=_uuid)
    kind = Column(String, nullable=False, index=True)
    payload = Column(JSON, default=dict)
    status = Column(String, default="pending", index=True)   # pending/running/done/failed
    attempts = Column(Integer, default=0)
    max_attempts = Column(Integer, default=3)
    run_after = Column(DateTime, default=datetime.utcnow, index=True)
    locked_at = Column(DateTime, nullable=True)
    locked_by = Column(String, nullable=True)
    result = Column(JSON, nullable=True)
    error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ---- 兼容再导出：限流器与设置存储已迁至 core/rate_limit.py、core/settings_store.py ----
# 旧调用点（auth/files/admin/chat/tools）仍从 db.models 导入，过渡期保持可用。
from ..core.settings_store import (  # noqa: E402,F401
    get_setting, set_setting, get_cached_setting,
    DEFAULT_TRASH_RETENTION_DAYS, DEFAULT_TRASH_LOCK_LIMIT, get_trash_retention_days,
)
from ..core.rate_limit import (  # noqa: E402,F401
    LOGIN_LIMIT_WINDOW, LOGIN_LIMIT_MAX_FAILURES, LOGIN_LIMIT_LOCK_SECONDS,
    login_limiter_check, login_limiter_record, login_limiter_reset,
    CHAT_RATE_LIMIT_WINDOW, CHAT_RATE_LIMIT_MAX, CHAT_RATE_LIMIT_LOCK_SECONDS,
    rate_limit_acquire,
)


def init_db():
    from ..config import validate_runtime_secrets
    validate_runtime_secrets()
    if settings.sql_database_url.startswith("sqlite"):
        Path(settings.DATABASE_PATH).parent.mkdir(parents=True, exist_ok=True)
    run_migrations()
    _seed_admin()
    _migrate_llm_from_env()
    _migrate_fernet_keys()


def run_migrations():
    """Alembic 升级到 head（取代手写 _migrate_columns 的 try/except:pass 迁移）。

    遗留库（有业务表但无 alembic_version）自动 stamp head 再升级，
    存量部署无需手工介入。
    """
    from alembic.config import Config as AlembicConfig
    from alembic import command
    server_dir = Path(__file__).resolve().parents[2]
    cfg = AlembicConfig(str(server_dir / "alembic.ini"))
    cfg.set_main_option("script_location", str(server_dir / "alembic"))
    cfg.set_main_option("sqlalchemy.url", settings.sql_database_url)
    _stamp_legacy_sqlite_if_needed(cfg)
    command.upgrade(cfg, "head")


def _stamp_legacy_sqlite_if_needed(cfg):
    """SQLite 库已有业务表但无 alembic_version → 视为遗留部署，先 stamp head。"""
    if not settings.sql_database_url.startswith("sqlite"):
        return
    import sqlite3
    from alembic import command
    db_path = settings.DATABASE_PATH
    if not Path(db_path).exists():
        return
    conn = sqlite3.connect(db_path)
    try:
        tables = {r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'")}
    finally:
        conn.close()
    if tables and "users" in tables and "alembic_version" not in tables:
        command.stamp(cfg, "head")


def _migrate_fernet_keys(db=None):
    """每次启动透明重加密：把任何用历史密钥加密的 API Key 重加密为当前密钥。

    不使用一次性 flag--这样运维在首次启动后才设置或更换 DATA_ENCRYPTION_KEY 时，
    旧密文（用 HKDF(SECRET_KEY) 或裸 SHA256(SECRET_KEY) 加密）仍能被历史密钥解开
    并自动重加密为当前密钥，避免密钥轮换导致 API Key 永久不可解。
    """
    owns_session = db is None
    if owns_session:
        db = SessionLocal()
    try:
        from cryptography.fernet import Fernet
        from ..core.security import _fernet_key, _legacy_fernet_keys, encrypt_api_key
        cur = _fernet_key()
        legacy = _legacy_fernet_keys()
        changed = False
        for p in db.query(LlmProvider).all():
            if not p.api_key_enc:
                continue
            try:
                Fernet(cur).decrypt(p.api_key_enc.encode())  # 已是当前密钥
                continue
            except Exception:
                pass
            plaintext = None
            for k in legacy:
                try:
                    plaintext = Fernet(k).decrypt(p.api_key_enc.encode()).decode()
                    break
                except Exception:
                    continue
            if plaintext is not None:
                p.api_key_enc = encrypt_api_key(plaintext)
                changed = True
        if changed:
            db.commit()
    finally:
        if owns_session:
            db.close()


def _seed_admin():
    from ..core.security import hash_password, validate_password
    db = SessionLocal()
    try:
        existing = db.query(Admin).filter_by(username=settings.ADMIN_USERNAME).first()
        if existing:
            return
        pwd = settings.ADMIN_PASSWORD
        err = validate_password(pwd, settings.ADMIN_USERNAME)
        if err and not settings.ALLOW_WEAK_ADMIN_PASSWORD:
            raise RuntimeError(
                f"[Suixingdang] 拒绝创建管理员：{err}。"
                f"请设置强密码后重试，或在调试环境显式置 ALLOW_WEAK_ADMIN_PASSWORD=true。"
            )
        db.add(Admin(
            username=settings.ADMIN_USERNAME,
            password_hash=hash_password(pwd),
        ))
        db.commit()
        print(f"[Suixingdang] 管理员账户已创建: {settings.ADMIN_USERNAME}")
        if err:
            print(f"[Suixingdang] ⚠️ 安全告警：管理员密码较弱（{err}），建议尽快修改。")
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
                    for line in env_path.read_text(encoding="utf-8").splitlines():
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
