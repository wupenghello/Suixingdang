"""数据库模型与表结构定义（多账户版）。"""

import uuid
import sqlite3
import threading
from datetime import datetime, timedelta
from sqlalchemy import Column, String, Integer, DateTime, Text, Boolean, ForeignKey, create_engine, event, or_
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
engine = create_engine(
    f"sqlite:///{settings.DATABASE_PATH}",
    connect_args={"check_same_thread": False},
)


@event.listens_for(engine, "connect")
def _set_sqlite_pragmas(dbapi_conn, conn_record):
    """WAL + synchronous=NORMAL：大幅降低每次 COMMIT 的 fsync 开销，且无损坏风险
   （仅在断电时可能丢失最后一个未 checkpoint 的事务）。对聊天限流等高频写入路径尤其受益。"""
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA journal_mode=WAL")
    cur.execute("PRAGMA synchronous=NORMAL")
    cur.close()


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
    _setting_cache.pop(key, None)  # 使缓存失效，使运行时调整立即生效


# ---- 策略缓存（带 TTL，避免每请求查 SystemSetting）----
# set_setting 写入时自动失效对应 key，确保管理员后台调整立即生效。
_setting_cache = {}
_SETTING_CACHE_TTL = 30


def get_cached_setting(db, key, default=""):
    """读 SystemSetting（带 30s 缓存）；set_setting 写入时自动失效。"""
    import time as _time
    now = _time.time()
    hit = _setting_cache.get(key)
    if hit and now - hit[1] < _SETTING_CACHE_TTL:
        return hit[0]
    val = get_setting(db, key, default)
    _setting_cache[key] = (val, now)
    return val


# ---- 登录限流（DB 共享，跨 worker 生效；按 key 前缀隔离 login/admin/reset）----

LOGIN_LIMIT_WINDOW = 15 * 60        # 失败计数窗口（秒）
LOGIN_LIMIT_MAX_FAILURES = 5        # 窗口内失败上限
LOGIN_LIMIT_LOCK_SECONDS = 15 * 60  # 锁定时长（秒）


def login_limiter_check(db, key: str) -> int:
    """返回剩余锁定秒数；未锁定返回 0。过期锁自动清零。"""
    row = db.query(LoginAttempt).filter_by(key=key).first()
    if not row or not row.locked_until:
        return 0
    now = datetime.utcnow()
    if row.locked_until > now:
        return int((row.locked_until - now).total_seconds()) + 1
    row.locked_until = None
    row.fail_count = 0
    row.first_fail_at = None
    db.commit()
    return 0


def login_limiter_record(db, key: str):
    """记录一次失败，达到阈值则锁定；顺带清理陈旧记录防表膨胀。"""
    now = datetime.utcnow()
    row = db.query(LoginAttempt).filter_by(key=key).first()
    if row:
        if row.first_fail_at and (now - row.first_fail_at).total_seconds() > LOGIN_LIMIT_WINDOW:
            row.fail_count = 0
            row.first_fail_at = now
        if not row.first_fail_at:
            row.first_fail_at = now
        row.fail_count = (row.fail_count or 0) + 1
    else:
        row = LoginAttempt(key=key, fail_count=1, first_fail_at=now)
        db.add(row)
    if row.fail_count >= LOGIN_LIMIT_MAX_FAILURES:
        row.locked_until = now + timedelta(seconds=LOGIN_LIMIT_LOCK_SECONDS)
    db.commit()
    # 机会性清理：删除无锁且超出窗口两倍的陈旧记录
    cutoff = now - timedelta(seconds=LOGIN_LIMIT_WINDOW * 2)
    db.query(LoginAttempt).filter(
        LoginAttempt.locked_until.is_(None),
        or_(LoginAttempt.first_fail_at.is_(None), LoginAttempt.first_fail_at < cutoff),
    ).delete(synchronize_session=False)
    db.commit()


def login_limiter_reset(db, key: str):
    """成功后清零计数。"""
    row = db.query(LoginAttempt).filter_by(key=key).first()
    if row:
        row.fail_count = 0
        row.first_fail_at = None
        row.locked_until = None
        db.commit()


# ---- 通用请求限流（复用 login_attempts 表，按 user_id 限流聊天等接口）----
# 与登录限流共用 LoginAttempt 表的 key->计数->锁定 结构；用独立 key 前缀隔离。
# 注意：对这些 key 而言，fail_count 语义为「请求计数」，仅在该命名空间内成立。

CHAT_RATE_LIMIT_WINDOW = 60        # 计数窗口（秒）
CHAT_RATE_LIMIT_MAX = 20           # 窗口内每用户最大请求数
CHAT_RATE_LIMIT_LOCK_SECONDS = 60  # 超限后锁定时长（秒）

# 进程内串行化限流的 read-modify-write，避免并发请求同时读到旧计数而漏计。
# 多进程（多 worker）仍由 SQLite 写锁兜底，残余竞争只导致少量放行，非硬性绕过。
_rate_limit_lock = threading.Lock()


def rate_limit_acquire(db, key: str,
                       max_requests: int = CHAT_RATE_LIMIT_MAX,
                       window: int = CHAT_RATE_LIMIT_WINDOW,
                       lock_seconds: int = CHAT_RATE_LIMIT_LOCK_SECONDS) -> int:
    """尝试获取一次请求配额。返回 0 表示放行；>0 表示剩余锁定秒数（应回 429）。

    固定窗口计数：窗口内累计 max_requests 次放行，第 max_requests+1 次起锁定 lock_seconds 秒。
    """
    now = datetime.utcnow()
    with _rate_limit_lock:
        row = db.query(LoginAttempt).filter_by(key=key).first()

        # 仍在锁定期 -> 拒绝（只读，不写）
        if row and row.locked_until and row.locked_until > now:
            return int((row.locked_until - now).total_seconds()) + 1

        # 锁已过期 -> 清零，开新窗口
        if row and row.locked_until:
            row.locked_until = None
            row.fail_count = 0
            row.first_fail_at = None

        # 是否在计数窗口内（first_fail_at 缺失/过期都视为新窗口）
        in_window = bool(row and row.first_fail_at
                         and (now - row.first_fail_at).total_seconds() <= window)
        if in_window:
            count = (row.fail_count or 0) + 1
            first_at = row.first_fail_at
        else:
            count = 1
            first_at = now

        if row:
            row.fail_count = count
            row.first_fail_at = first_at
        else:
            row = LoginAttempt(key=key, fail_count=count, first_fail_at=first_at)
            db.add(row)

        locked = count > max_requests
        if locked:
            row.locked_until = now + timedelta(seconds=lock_seconds)
        db.commit()
        return lock_seconds if locked else 0


def init_db():
    from ..config import validate_runtime_secrets
    validate_runtime_secrets()
    Path(settings.DATABASE_PATH).parent.mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(bind=engine)
    _migrate_columns()
    _seed_admin()
    _migrate_llm_from_env()
    _migrate_fernet_keys()


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
        "password_version": "INTEGER DEFAULT 1",
    }
    for col, coltype in additions.items():
        if col not in cols:
            try:
                cursor.execute(f"ALTER TABLE users ADD COLUMN {col} {coltype}")
            except Exception:
                pass

    # access_tokens 表新增 kind / download_granted_until 列
    cursor.execute("PRAGMA table_info(access_tokens)")
    tcols = [r[1] for r in cursor.fetchall()]
    if "kind" not in tcols:
        try:
            cursor.execute('ALTER TABLE access_tokens ADD COLUMN kind TEXT DEFAULT "device"')
        except Exception:
            pass
    if "download_granted_until" not in tcols:
        try:
            cursor.execute('ALTER TABLE access_tokens ADD COLUMN download_granted_until DATETIME')
        except Exception:
            pass
    if "single_download_path" not in tcols:
        try:
            cursor.execute('ALTER TABLE access_tokens ADD COLUMN single_download_path TEXT DEFAULT ""')
        except Exception:
            pass
    if "download_granted_at" not in tcols:
        try:
            cursor.execute('ALTER TABLE access_tokens ADD COLUMN download_granted_at DATETIME')
        except Exception:
            pass
    if "device_fingerprint" not in tcols:
        try:
            cursor.execute('ALTER TABLE access_tokens ADD COLUMN device_fingerprint TEXT DEFAULT ""')
            try:
                cursor.execute('CREATE INDEX IF NOT EXISTS ix_access_tokens_device_fingerprint ON access_tokens (device_fingerprint)')
            except Exception:
                pass
        except Exception:
            pass
    for col in ("ip", "geo"):
        if col not in tcols:
            try:
                cursor.execute(f'ALTER TABLE access_tokens ADD COLUMN {col} TEXT DEFAULT ""')
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
    # files 表新增 tags / pinned / summary / ai_tags 列（笔记增强）
    for _col, _coltype in [
        ("tags", 'TEXT DEFAULT "[]"'),
        ("pinned", "BOOLEAN DEFAULT 0"),
        ("summary", 'TEXT DEFAULT ""'),
        ("ai_tags", 'TEXT DEFAULT "[]"'),
    ]:
        if _col not in fcols:
            try:
                cursor.execute(f"ALTER TABLE files ADD COLUMN {_col} {_coltype}")
            except Exception:
                pass
    conn.commit()
    conn.close()


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
