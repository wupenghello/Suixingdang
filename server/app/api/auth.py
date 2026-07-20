"""认证 API（多账户版）：用户登录/注册、忘记密码、管理员登录、设备令牌。"""

from datetime import datetime, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request, Query, Response
from sqlalchemy import or_
from sqlalchemy.orm import Session
from pydantic import BaseModel
import hashlib

import time

from ..db.models import (
    User, Admin, AccessToken, AccessLog, SystemSetting,
    get_db, get_setting, set_setting, get_cached_setting,
    login_limiter_check, login_limiter_record, login_limiter_reset,
)
from ..core.security import (
    verify_password, hash_password, create_access_token, create_refresh_token,
    decode_token, generate_token_hash, validate_password,
)
from ..config import settings

router = APIRouter(prefix="/api/auth", tags=["auth"])


# ---- 请求/响应模型 ----

class LoginRequest(BaseModel):
    username: str
    password: str
    totp_code: str = ""  # 已废弃，保留以兼容旧客户端，后端忽略


class RegisterRequest(BaseModel):
    username: str
    password: str
    security_question: str = ""
    security_answer: str = ""


class AdminLoginRequest(BaseModel):
    username: str
    password: str
    totp_code: str = ""  # 已废弃，保留以兼容旧客户端，后端忽略


class DeviceTokenResponse(BaseModel):
    token: str
    label: str
    expires_at: str = ""


class ForgotPasswordStep1Request(BaseModel):
    username: str


class ForgotPasswordStep2Request(BaseModel):
    username: str
    answer: str
    new_password: str


# ---- 依赖注入 ----

from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi import Security

security_scheme = HTTPBearer(auto_error=False)


def _resolve_device_token(raw: str, db: Session) -> Optional[User]:
    """通过 opaque 设备令牌解析用户；校验吊销/过期状态并节流更新最后使用时间。"""
    token_hash = hashlib.sha256(raw.encode()).hexdigest()
    t = db.query(AccessToken).filter_by(token_hash=token_hash).first()
    if not t or not t.user_id:
        return None
    if t.revoked:
        raise HTTPException(401, "令牌已被吊销")
    if t.expires_at and t.expires_at < datetime.utcnow():
        raise HTTPException(401, "令牌已过期")
    user = db.query(User).filter_by(id=t.user_id).first()
    if not user:
        return None
    now = datetime.utcnow()
    if not t.last_used_at or (now - t.last_used_at).total_seconds() > 60:
        t.last_used_at = now
        db.commit()
    return user


def _session_label(request: Request) -> str:
    """从 User-Agent 生成浏览器会话标签，便于在令牌列表区分来源设备。"""
    ua = request.headers.get("user-agent", "") if request else ""
    browser = "浏览器"
    if "Edg/" in ua:
        browser = "Edge"
    elif "Chrome/" in ua:
        browser = "Chrome"
    elif "Firefox/" in ua:
        browser = "Firefox"
    elif "Safari/" in ua:
        browser = "Safari"
    os_name = ""
    if "Windows" in ua:
        os_name = "Windows"
    elif "Android" in ua:
        os_name = "Android"
    elif "iPhone" in ua or "iPad" in ua:
        os_name = "iOS"
    elif "Mac OS" in ua:
        os_name = "macOS"
    elif "Linux" in ua:
        os_name = "Linux"
    return f"{browser}·{os_name}" if os_name else browser


def _device_fingerprint(request: Request) -> str:
    """同设备指纹：sha256(user-agent)。

    以 UA 为主、IP 为辅：同一浏览器在不同网络（手机切基站 / WiFi）下 IP 会变，
    但 UA 不变，仍判为同一设备，避免移动端重复登录刷出一堆会话行。
    IP 单独存入会话行（access_tokens.ip）用于展示与审计，不参与指纹。"""
    ua = request.headers.get("user-agent", "") if request else ""
    return hashlib.sha256(ua.encode()).hexdigest()


# ---- 会话策略（可由管理员运行时调整，带短缓存避免每请求查库）----


def _session_policy(db: Session, key: str, default: int) -> int:
    """读会话策略：DB 覆盖优先于 env 默认值；空值回退 default。

    使用 models.get_cached_setting（带 TTL，set_setting 写入时自动失效），
    使管理员后台调整并发上限/空闲超时立即生效。"""
    raw = get_cached_setting(db, key, "")
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


# ---- GeoIP（可选；未配置库时返回空串）----
_geoip_reader = None
_geoip_checked = False


def _geo_lookup(ip: str) -> str:
    """IP → 地域（城市·国家）；无 GeoIP 库或解析失败返回空串。"""
    global _geoip_reader, _geoip_checked
    if not ip or not settings.GEOIP_DB_PATH:
        return ""
    if not _geoip_checked:
        _geoip_checked = True
        try:
            import geoip2.database
            from pathlib import Path
            if Path(settings.GEOIP_DB_PATH).exists():
                _geoip_reader = geoip2.database.Reader(settings.GEOIP_DB_PATH)
        except Exception:
            _geoip_reader = None
    if not _geoip_reader:
        return ""
    try:
        resp = _geoip_reader.city(ip)
        parts = [p for p in (resp.city.name, resp.country.name) if p]
        return "·".join(parts)
    except Exception:
        return ""


def _bump_password_version(db: Session, user: User):
    """密码版本号 +1（使所有旧 access/refresh JWT 立即失效），并吊销已存在的浏览器
    会话行，避免它们在令牌列表里继续显示为「有效」。用于改/重置密码场景。"""
    user.password_version = (user.password_version or 0) + 1
    db.query(AccessToken).filter(
        AccessToken.user_id == user.id,
        AccessToken.kind == "session",
        AccessToken.revoked.is_(False),
    ).update({"revoked": True}, synchronize_session=False)


def _enforce_session_limit(db: Session, user: User):
    """并发会话数上限：超出时自动吊销最早的活跃会话（保留最新 N 个）。

    上限可由管理员通过 SystemSetting(max_concurrent_sessions) 运行时调整，0 表示不限制。
    仅在新建会话后调用，不影响已有会话复用路径。"""
    limit = _session_policy(db, "max_concurrent_sessions", settings.MAX_CONCURRENT_SESSIONS)
    if limit <= 0:
        return
    active = db.query(AccessToken).filter(
        AccessToken.user_id == user.id,
        AccessToken.kind == "session",
        AccessToken.revoked.is_(False),
    ).order_by(AccessToken.last_used_at.desc()).all()
    for t in active[limit:]:
        t.revoked = True


def _issue_session_tokens(db: Session, user: User, request: Request):
    """签发浏览器会话令牌对，写入 kind=session 行（可吊销），返回 (access, refresh)。

    会话复用去重：同一设备（IP+UA 指纹）在 SESSION_REUSE_HOURS 窗口内重复登录时，
    以第一次登录的会话为准--复用既有会话行（同一 sid），仅轮转 refresh 凭据，
    不新增会话行、不重置该会话的临时下载授权等状态。窗口外或换设备才新建会话。
    顺带清理该用户已过期或已吊销的旧会话行，避免 access_tokens 表无界增长；
    保留其他设备的活跃会话。access JWT 带 sid（会话行 id），供临时下载等
    session 级授权接口定位当前会话。"""
    now = datetime.utcnow()
    db.query(AccessToken).filter(
        AccessToken.user_id == user.id,
        AccessToken.kind == "session",
        or_(AccessToken.revoked.is_(True), AccessToken.expires_at < now),
    ).delete(synchronize_session=False)
    # 机会性清理：吊销超过 90 天的设备令牌（保留近期供审计，避免列表无限膨胀）
    device_cutoff = now - timedelta(days=90)
    db.query(AccessToken).filter(
        AccessToken.user_id == user.id,
        AccessToken.kind == "device",
        AccessToken.revoked.is_(True),
        AccessToken.created_at < device_cutoff,
    ).delete(synchronize_session=False)
    base_data = {"sub": user.id, "username": user.username, "role": "user",
                 "password_version": user.password_version}
    fingerprint = _device_fingerprint(request)
    reuse_window = now - timedelta(hours=settings.SESSION_REUSE_HOURS)
    ip = _client_ip(request) if request else ""
    geo = _geo_lookup(ip)
    # 查找可复用的同设备会话：未吊销、未过期、5 小时内创建
    reusable = db.query(AccessToken).filter(
        AccessToken.user_id == user.id,
        AccessToken.kind == "session",
        AccessToken.revoked.is_(False),
        AccessToken.device_fingerprint == fingerprint,
        AccessToken.created_at >= reuse_window,
    ).order_by(AccessToken.created_at.desc()).first()
    if reusable:
        # 复用既有会话行：轮转 refresh（刷新 token_hash），签发绑定同 sid 的 access；
        # 保留下载授权等会话状态（不重置），刷新设备标签与活跃时间。
        # 同步续期 expires_at，使其与新签发 refresh JWT 的有效期一致——否则会话行会
        # 先于 refresh JWT 过期，被下次登录的清理逻辑删除，导致 refresh 仍有效却 401 静默下线。
        refresh = create_refresh_token(base_data)
        reusable.token_hash = hashlib.sha256(refresh.encode()).hexdigest()
        reusable.label = _session_label(request)
        reusable.last_used_at = now
        reusable.expires_at = now + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
        reusable.ip = ip
        reusable.geo = geo
        db.flush()
        access = create_access_token({**base_data, "sid": reusable.id})
        return access, refresh
    # 新建设备会话：先签 refresh（不含 sid）建 session 行，flush 拿 id 后再签含 sid 的 access
    refresh = create_refresh_token(base_data)
    session = AccessToken(
        user_id=user.id, kind="session", label=_session_label(request),
        token_hash=hashlib.sha256(refresh.encode()).hexdigest(),
        device_fingerprint=fingerprint,
        ip=ip, geo=geo,
        expires_at=now + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
        last_used_at=now,
    )
    db.add(session)
    db.flush()  # 拿 session.id
    # 并发会话上限：超出则自动吊销最早活跃会话（保留最新）
    _enforce_session_limit(db, user)
    access = create_access_token({**base_data, "sid": session.id})
    return access, refresh


# ---- Cookie 辅助（浏览器会话令牌：HttpOnly + Secure + SameSite=Lax）----
# 令牌写入 HttpOnly cookie，前端 JS 不可读，从根上消除 XSS 偷令牌重放。
# 设备令牌（守护进程）不经此路，仍走 Authorization 头。

def _set_access_cookie(response: Response, access: str):
    """把用户访问令牌写入 HttpOnly cookie（login 与 refresh 共用，避免属性漂移）。"""
    response.set_cookie("access_token", access,
                        httponly=True, secure=settings.cookie_secure,
                        samesite=settings.COOKIE_SAMESITE, path="/")


def _set_session_cookies(response: Response, access: str, refresh: str):
    """把用户会话令牌对写入 HttpOnly cookie。"""
    _set_access_cookie(response, access)
    response.set_cookie("refresh_token", refresh,
                        httponly=True, secure=settings.cookie_secure,
                        samesite=settings.COOKIE_SAMESITE, path="/")


def _set_admin_cookie(response: Response, access: str):
    """把管理员访问令牌写入 HttpOnly cookie。"""
    response.set_cookie("admin_access", access,
                        httponly=True, secure=settings.cookie_secure,
                        samesite=settings.COOKIE_SAMESITE, path="/")


def _credential_raw(request: Request, credentials, cookie_name: str) -> Optional[str]:
    """取原始令牌串：优先 HttpOnly cookie，回退 Authorization 头（设备令牌 / 兼容）。"""
    return request.cookies.get(cookie_name) or (credentials.credentials if credentials else None)


def _clear_session_cookies(response: Response):
    for name in ("access_token", "refresh_token"):
        response.delete_cookie(name, path="/")


def _clear_admin_cookie(response: Response):
    response.delete_cookie("admin_access", path="/")


def _resolve_access_jwt(raw: str, db: Session, request: Request) -> User:
    """解析浏览器会话 access JWT：校验类型/角色/用户/密码版本/会话状态，并记录 sid。

    会话级校验（仅当 JWT 带 sid，即浏览器会话）：
    - 吊销即时生效：会话行被标记 revoked 后，access 不再等到自然过期，立即 401；
    - 空闲超时：超过 SESSION_IDLE_TIMEOUT_MINUTES 无活动则失效（0=不限制）。
    两者都依赖一次 PK 查询（按 sid），对 SQLite 而言可忽略不计。"""
    payload = decode_token(raw)
    if not payload or payload.get("type") != "access":
        raise HTTPException(401, "无效或过期的令牌")
    if payload.get("role") != "user":
        raise HTTPException(403, "此接口需要普通用户权限")
    user = db.query(User).filter_by(id=payload.get("sub")).first()
    if not user:
        raise HTTPException(401, "用户不存在")
    # 密码版本校验：改/重置密码后旧 access 立即失效
    if payload.get("password_version") != user.password_version:
        raise HTTPException(401, "登录已失效，请重新登录")
    sid = payload.get("sid")
    if sid:
        # 会话行校验：不存在或已吊销 → 立即失效（消除单吊销后的 60 分钟僵尸窗口）
        session = db.query(AccessToken).filter_by(id=sid, kind="session").first()
        if not session or session.revoked:
            raise HTTPException(401, "会话已失效，请重新登录")
        # 空闲超时：超过阈值无活动则失效（0=不限制）
        idle = _session_policy(db, "session_idle_timeout_minutes", settings.SESSION_IDLE_TIMEOUT_MINUTES)
        if idle > 0 and session.last_used_at:
            if (datetime.utcnow() - session.last_used_at).total_seconds() > idle * 60:
                session.revoked = True
                db.commit()
                raise HTTPException(401, "长时间未操作，请重新登录")
        # 节流更新活跃时间，使空闲超时按真实活动计算
        n = datetime.utcnow()
        if not session.last_used_at or (n - session.last_used_at).total_seconds() > 60:
            session.last_used_at = n
            db.commit()
    # 当前会话标识存入 request.state，供临时下载等 session 级授权接口使用
    request.state.access_sid = sid
    return user


def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Security(security_scheme),
    db: Session = Depends(get_db),
) -> User:
    # 优先 HttpOnly cookie（浏览器会话），回退 Authorization 头（设备令牌 / 兼容旧前端）
    raw = _credential_raw(request, credentials, "access_token")
    if not raw:
        raise HTTPException(401, "未提供认证信息")
    # JWT 形如 header.payload.signature（含两个 "."）；否则按 opaque 设备令牌解析
    if raw.count(".") == 2:
        user = _resolve_access_jwt(raw, db, request)
    else:
        user = _resolve_device_token(raw, db)
        if not user:
            raise HTTPException(401, "无效或已吊销的令牌")
    if user.status == "disabled":
        raise HTTPException(403, "账户已被禁用")
    return user


def get_current_session(
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Optional[AccessToken]:
    """当前浏览器会话行（按 access JWT 的 sid）；device token / 旧 token / 已吊销会话返回 None。"""
    sid = getattr(request.state, "access_sid", None)
    if not sid:
        return None
    return db.query(AccessToken).filter_by(
        id=sid, user_id=user.id, kind="session", revoked=False,
    ).first()


def get_current_device_user(
    credentials: HTTPAuthorizationCredentials = Security(security_scheme),
    db: Session = Depends(get_db),
) -> User:
    """仅接受 opaque 设备令牌（守护进程专用）；浏览器 session JWT 拒绝，
    防止浏览器走同步通道绕过临时下载限制。"""
    if not credentials:
        raise HTTPException(401, "未提供认证信息")
    raw = credentials.credentials
    if raw.count(".") == 2:
        raise HTTPException(403, "此接口需要设备令牌（守护进程专用）")
    user = _resolve_device_token(raw, db)
    if not user:
        raise HTTPException(401, "无效或已吊销的令牌")
    if user.status == "disabled":
        raise HTTPException(403, "账户已被禁用")
    return user


def get_current_admin(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Security(security_scheme),
    db: Session = Depends(get_db),
) -> Admin:
    # 优先读 HttpOnly cookie；回退 Authorization 头（兼容旧前端 / API 客户端）
    raw = _credential_raw(request, credentials, "admin_access")
    if not raw:
        raise HTTPException(401, "未提供管理员认证信息")
    payload = decode_token(raw)
    if not payload or payload.get("type") != "access":
        raise HTTPException(401, "无效或过期的令牌")
    if payload.get("role") != "admin":
        raise HTTPException(403, "此接口需要管理员权限")
    admin_id = payload.get("sub")
    admin = db.query(Admin).filter_by(id=admin_id).first()
    if not admin:
        raise HTTPException(401, "管理员不存在")
    return admin


# ---- 限流 key 构造 ----

def _limiter_key(scope: str, username: str, ip: str) -> str:
    """限流 key：按 scope 隔离 login / adminlogin / reset，
    避免用户登录锁定连累密码重置，或用户表爆破连累管理员登录。"""
    return f"{scope}:{username}|{ip or ''}"


# ---- 客户端 IP（信任代理感知）----

def _client_ip(request: Request) -> str:
    """返回真实客户端 IP。

    仅当 TCP 直连对端是受信任代理（TRUSTED_PROXIES，支持 CIDR）时才采用 X-Forwarded-For /
    X-Real-IP；否则用 TCP 对端 IP。这样直连 :8000 时无法靠伪造 XFF 绕过限流。
    """
    peer = request.client.host if request.client else ""
    if peer and settings.is_trusted_proxy(peer):
        xff = request.headers.get("x-forwarded-for")
        if xff:
            for hop in (h.strip() for h in xff.split(",")):
                if hop and not settings.is_trusted_proxy(hop):
                    return hop
            return xff.split(",")[0].strip()
        if request.headers.get("x-real-ip"):
            return request.headers["x-real-ip"].strip()
    return peer


# ---- 密保答案哈希（bcrypt + sha256 预哈希，兼容旧 sha256）----

# 懒加载的 dummy bcrypt 哈希，用于「用户不存在」分支消耗等量时间，规避时序枚举
_DUMMY_ANSWER_HASH = ""


def _dummy_answer_hash() -> str:
    global _DUMMY_ANSWER_HASH
    if not _DUMMY_ANSWER_HASH:
        _DUMMY_ANSWER_HASH = hash_password("suixingdang-dummy-answer")
    return _DUMMY_ANSWER_HASH


def _hash_security_answer(answer: str) -> str:
    """密保答案 bcrypt 哈希。

    先对归一化（去空格 + 小写）答案做 sha256 再 bcrypt，规避 bcrypt 72 字节输入
    上限，支持任意长度答案（如长中文串）。
    """
    norm = answer.strip().lower()
    return hash_password(hashlib.sha256(norm.encode()).hexdigest())


def _is_legacy_answer(stored: str) -> bool:
    """旧版 sha256 答案为 64 位十六进制；bcrypt 哈希以 $2 开头。"""
    if not stored or len(stored) != 64:
        return False
    return all(c in "0123456789abcdef" for c in stored.lower())


def _verify_security_answer(answer: str, stored: str) -> bool:
    """校验密保答案，兼容旧 sha256 与新 bcrypt（sha256 预哈希）。"""
    norm = answer.strip().lower()
    if _is_legacy_answer(stored):
        return hashlib.sha256(norm.encode()).hexdigest() == stored
    return verify_password(hashlib.sha256(norm.encode()).hexdigest(), stored)


# ---- 用户登录 ----

@router.post("/login")
def login(req: LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    ip = _client_ip(request)
    key = _limiter_key("login", req.username, ip)
    locked = login_limiter_check(db, key)
    if locked:
        _log(db, None, "login_locked", f"{req.username}（限流锁定 {locked}s）", request)
        raise HTTPException(429, f"尝试过于频繁，请 {locked} 秒后再试")
    user = db.query(User).filter_by(username=req.username).first()
    if not user or not verify_password(req.password, user.password_hash):
        login_limiter_record(db, key)
        _log(db, None, "login_failed", f"{req.username}（账号或密码错误）", request)
        raise HTTPException(401, "用户名或密码错误")
    if user.status == "disabled":
        _log(db, user.id, "login_blocked", "账号已被禁用", request)
        raise HTTPException(403, "账户已被禁用")

    user.last_login_at = datetime.utcnow()
    db.commit()
    login_limiter_reset(db, key)

    _log(db, user.id, "login_success", "", request)
    # 新设备检测：该设备指纹从未登录过 → 留痕告警（防异地/陌生设备盗号被动发现）
    fp = _device_fingerprint(request)
    seen = db.query(AccessToken).filter(
        AccessToken.user_id == user.id,
        AccessToken.device_fingerprint == fp,
    ).first()
    if not seen:
        ip = _client_ip(request)
        geo = _geo_lookup(ip)
        where = f"{geo}·{ip}" if geo else ip
        _log(db, user.id, "login_new_device", f"{_session_label(request)} {where}", request)
    access, refresh = _issue_session_tokens(db, user, request)
    db.commit()
    _set_session_cookies(response, access, refresh)
    return {"role": "user"}


# ---- 用户注册 ----

@router.post("/register")
def register(req: RegisterRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    # 检查注册开关：DB 设置优先于环境变量
    db_flag = get_setting(db, "allow_register", "")
    if db_flag:
        allow = db_flag.lower() == "true"
    else:
        allow = settings.ALLOW_REGISTER
    if not allow:
        raise HTTPException(403, "管理员未开放注册")

    if len(req.username) < 2:
        raise HTTPException(400, "用户名至少 2 个字符")
    pwd_err = validate_password(req.password, req.username)
    if pwd_err:
        raise HTTPException(400, pwd_err)
    if db.query(User).filter_by(username=req.username).first():
        raise HTTPException(409, "用户名已存在")
    if not req.security_question or not req.security_answer:
        raise HTTPException(400, "请设置密保问题和答案")

    # 密保答案 bcrypt 哈希存储
    answer_hash = _hash_security_answer(req.security_answer)

    db_quota = get_setting(db, "default_quota_mb", "")
    quota = int(db_quota) if db_quota else settings.DEFAULT_QUOTA_MB

    user = User(
        username=req.username,
        password_hash=hash_password(req.password),
        status="active",
        quota_mb=quota,
        security_question=req.security_question,
        security_answer=answer_hash,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    _log(db, user.id, "register", "", request)
    access, refresh = _issue_session_tokens(db, user, request)
    db.commit()
    _set_session_cookies(response, access, refresh)
    return {"role": "user"}


# ---- 忘记密码 ----

@router.post("/forgot-password/question")
def get_security_question(req: ForgotPasswordStep1Request, db: Session = Depends(get_db)):
    """返回密保提示。为避免用户名枚举，对所有用户名返回统一提示，
    不泄露用户是否存在或其密保问题内容。"""
    return {"username": req.username, "question": "请输入您注册时设置的密保答案"}


@router.post("/forgot-password/reset")
def reset_password(req: ForgotPasswordStep2Request, request: Request, db: Session = Depends(get_db)):
    """验证密保答案后重置密码。

    - 用户不存在与答案错误返回相同提示，避免枚举；
    - reset 用独立限流 scope，不被登录锁定连累；
    - 对不存在用户 / 旧 sha256 用户补一次 dummy bcrypt，使各分支耗时一致，规避时序枚举；
    - 答案正确后立即清零失败计数，即便新密码校验失败也不再累积。
    """
    ip = _client_ip(request)
    key = _limiter_key("reset", req.username, ip)
    locked = login_limiter_check(db, key)
    if locked:
        _log(db, None, "password_reset_locked", f"{req.username}（限流锁定 {locked}s）", request)
        raise HTTPException(429, f"尝试过于频繁，请 {locked} 秒后再试")

    user = db.query(User).filter_by(username=req.username).first()
    # 时序对齐：bcrypt 路径（存在且非 legacy）的真实校验本身就是一次 bcrypt；
    # 其余分支（不存在 / legacy sha256）补一次 dummy bcrypt，使每次请求耗时近似一致。
    if not (user and user.security_answer and not _is_legacy_answer(user.security_answer)):
        verify_password(
            hashlib.sha256(req.answer.strip().lower().encode()).hexdigest(),
            _dummy_answer_hash(),
        )

    if not user or not user.security_answer or not _verify_security_answer(req.answer, user.security_answer):
        login_limiter_record(db, key)
        _log(db, user.id if user else None, "password_reset_failed",
             f"{req.username}（用户不存在或答案错误）", request)
        raise HTTPException(400, "密保答案错误")

    # 答案已验证正确：立即清零失败计数（即便新密码校验失败也不再累积）
    login_limiter_reset(db, key)

    pwd_err = validate_password(req.new_password, req.username)
    if pwd_err:
        raise HTTPException(400, pwd_err)

    user.password_hash = hash_password(req.new_password)
    _bump_password_version(db, user)
    # 顺带把旧 sha256 密保答案升级为 bcrypt（sha256 预哈希）
    if _is_legacy_answer(user.security_answer):
        user.security_answer = _hash_security_answer(req.answer)
    db.commit()
    _log(db, user.id, "password_reset_success", "", request)
    return {"message": "密码已重置，请使用新密码登录"}


# ---- 刷新令牌 ----

@router.post("/refresh")
def refresh_token(request: Request, response: Response, db: Session = Depends(get_db)):
    # refresh 从 HttpOnly cookie 读取（前端 JS 不可读）；不接受 body，
    # 否则 refresh 须由 JS 暴露，违背 HttpOnly 防 XSS 偷令牌的初衷。
    # 仅处理用户会话 refresh--管理员登录不再签发 refresh（401 即重登）。
    refresh = request.cookies.get("refresh_token")
    if not refresh:
        raise HTTPException(401, "未提供刷新令牌")
    payload = decode_token(refresh)
    if not payload or payload.get("type") != "refresh" or payload.get("role") != "user":
        raise HTTPException(401, "无效的刷新令牌")
    user = db.query(User).filter_by(id=payload.get("sub")).first()
    if not user:
        raise HTTPException(401, "用户不存在")
    if user.status == "disabled":
        raise HTTPException(403, "账户已被禁用")
    # 密码版本校验：改/重置密码后旧 refresh 立即失效
    if payload.get("password_version") != user.password_version:
        raise HTTPException(401, "登录已失效，请重新登录")
    # 会话令牌吊销校验：refresh 必须在 access_tokens 表中且未吊销
    refresh_hash = hashlib.sha256(refresh.encode()).hexdigest()
    session_token = db.query(AccessToken).filter_by(
        token_hash=refresh_hash, kind="session").first()
    if not session_token or session_token.revoked:
        raise HTTPException(401, "登录已失效，请重新登录")
    # 节流更新最近活跃时间（与设备令牌一致）
    now = datetime.utcnow()
    if not session_token.last_used_at or (now - session_token.last_used_at).total_seconds() > 60:
        session_token.last_used_at = now
        db.commit()
    access = create_access_token({
        "sub": user.id, "username": user.username, "role": "user",
        "password_version": user.password_version, "sid": session_token.id,
    })
    # 不轮转 refresh：复用原 refresh（仍绑定会话行，可吊销、随密码失效），
    # 避免「先改库再返回响应」带来的并发竞态与重试失败。
    _set_access_cookie(response, access)
    return {"role": "user"}


# ---- 退出登录 ----

@router.post("/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    """退出登录：清用户会话 cookie，并尽力吊销当前会话行。

    不依赖 get_current_user--紧急吊销/改密后 access 已失效，仍需能清 cookie。
    优先用 refresh cookie 的 hash 查会话行吊销（refresh 有效期 1 天，远长于 access
    的 60min，access 过期时仍能定位会话）；refresh 不可用时回退 access JWT 的 sid。
    """
    revoked = False
    refresh = request.cookies.get("refresh_token")
    if refresh:
        refresh_hash = hashlib.sha256(refresh.encode()).hexdigest()
        sess = db.query(AccessToken).filter_by(
            token_hash=refresh_hash, kind="session").first()
        if sess and not sess.revoked:
            sess.revoked = True
            revoked = True
            db.commit()
    if not revoked:
        # 回退：refresh 不可用时按 access JWT 的 sid 吊销（access 仍有效的情况）
        access = request.cookies.get("access_token")
        if access:
            payload = decode_token(access)
            if payload and payload.get("type") == "access":
                sid = payload.get("sid")
                if sid:
                    s = db.query(AccessToken).filter_by(id=sid, kind="session").first()
                    if s and not s.revoked:
                        s.revoked = True
                        db.commit()
    _clear_session_cookies(response)
    return {"message": "已退出"}


# ---- 管理员登录（独立入口）----

@router.post("/admin/login")
def admin_login(req: AdminLoginRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    ip = _client_ip(request)
    key = _limiter_key("adminlogin", req.username, ip)
    locked = login_limiter_check(db, key)
    if locked:
        _log(db, None, "admin_login_locked", f"{req.username}（限流锁定 {locked}s）", request)
        raise HTTPException(429, f"尝试过于频繁，请 {locked} 秒后再试")
    admin = db.query(Admin).filter_by(username=req.username).first()
    if not admin or not verify_password(req.password, admin.password_hash):
        login_limiter_record(db, key)
        _log(db, None, "admin_login_failed", f"{req.username}（账号或密码错误）", request)
        raise HTTPException(401, "管理员用户名或密码错误")

    login_limiter_reset(db, key)
    token_data = {"sub": admin.id, "username": admin.username, "role": "admin"}
    _set_admin_cookie(response, create_access_token(token_data))
    _log(db, None, "admin_login_success", "", request)
    return {"role": "admin"}


@router.post("/admin/logout")
def admin_logout(response: Response):
    """管理员退出：清 admin_access cookie。管理员令牌不入库，无需吊销会话行。"""
    _clear_admin_cookie(response)
    return {"message": "已退出"}


# ---- 注册状态查询（公开）----

@router.get("/register-status")
def register_status(db: Session = Depends(get_db)):
    db_flag = get_setting(db, "allow_register", "")
    if db_flag:
        allow = db_flag.lower() == "true"
    else:
        allow = settings.ALLOW_REGISTER
    return {"allow_register": allow}


# ---- 设备令牌 ----

@router.post("/tokens", response_model=DeviceTokenResponse)
def create_device_token(label: str = "device", expires_days: int = 0, db: Session = Depends(get_db), user=Depends(get_current_user)):
    raw, h = generate_token_hash()
    expires = None
    if expires_days > 0:
        expires = datetime.utcnow() + timedelta(days=expires_days)
    db.add(AccessToken(user_id=user.id, kind="device", label=label, token_hash=h, expires_at=expires))
    db.commit()
    return DeviceTokenResponse(token=raw, label=label, expires_at=str(expires) if expires else "")


@router.get("/tokens")
def list_tokens(request: Request, db: Session = Depends(get_db), user=Depends(get_current_user)):
    current_sid = getattr(request.state, "access_sid", None)
    tokens = db.query(AccessToken).filter_by(user_id=user.id).order_by(AccessToken.created_at.desc()).all()
    now = datetime.utcnow()
    result = []
    for t in tokens:
        item = {
            "id": t.id, "kind": t.kind or "device", "label": t.label, "revoked": t.revoked,
            "ip": t.ip or "", "geo": t.geo or "",
            "is_current": (t.id == current_sid),
            "expires_at": str(t.expires_at) if t.expires_at else "",
            "last_used_at": str(t.last_used_at) if t.last_used_at else "",
            "created_at": str(t.created_at),
        }
        if t.kind == "session":
            granted = bool(t.download_granted_until and t.download_granted_until > now)
            item["download_granted"] = granted
        result.append(item)
    return result


@router.delete("/tokens/{token_id}")
def revoke_token(token_id: str, db: Session = Depends(get_db), user=Depends(get_current_user)):
    t = db.query(AccessToken).filter_by(id=token_id, user_id=user.id).first()
    if t:
        t.revoked = True
        db.commit()
    return {"message": f"已吊销令牌: {t.label if t else token_id}"}


@router.delete("/tokens-others")
def revoke_other_tokens(request: Request, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """退出其他设备：吊销除当前浏览器会话外的全部有效令牌（保留本机）。"""
    current_sid = getattr(request.state, "access_sid", None)
    if not current_sid:
        raise HTTPException(400, "请从浏览器会话操作")
    others = db.query(AccessToken).filter(
        AccessToken.user_id == user.id,
        AccessToken.revoked.is_(False),
    ).all()
    count = 0
    for t in others:
        if t.id != current_sid:
            t.revoked = True
            count += 1
    db.commit()
    _log(db, user.id, "revoke_other_tokens", f"退出其他设备（吊销 {count} 个令牌）", request)
    return {"message": f"已退出 {count} 台其他设备", "count": count}


@router.delete("/tokens")
def revoke_all_tokens(request: Request, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """吊销当前用户的全部有效令牌（紧急下线所有设备）。"""
    tokens = db.query(AccessToken).filter_by(user_id=user.id, revoked=False).all()
    for t in tokens:
        t.revoked = True
    # 同时 bump 密码版本号，使已签发的 access JWT 立即失效（紧急下线不留 60 分钟窗口）
    user.password_version = (user.password_version or 0) + 1
    db.commit()
    _log(db, user.id, "revoke_all_tokens", f"用户主动吊销全部令牌（{len(tokens)} 个）", request)
    return {"message": f"已吊销 {len(tokens)} 个令牌", "count": len(tokens)}


# ---- 修改密码 ----

class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str


@router.post("/change-password")
def change_password(req: ChangePasswordRequest, request: Request, response: Response, db: Session = Depends(get_db), user=Depends(get_current_user)):
    if not verify_password(req.old_password, user.password_hash):
        raise HTTPException(400, "原密码错误")
    pwd_err = validate_password(req.new_password, user.username)
    if pwd_err:
        raise HTTPException(400, pwd_err)
    user.password_hash = hash_password(req.new_password)
    _bump_password_version(db, user)  # 旧 access/refresh 立即失效；旧会话行标记吊销
    # 为调用者签发新会话令牌，避免改密码后立即被踢下线
    access, refresh = _issue_session_tokens(db, user, request)
    db.commit()
    _set_session_cookies(response, access, refresh)
    return {"message": "密码已修改"}


# ---- 用户信息 ----

@router.get("/me")
def get_me(user=Depends(get_current_user)):
    return {
        "id": user.id,
        "username": user.username,
        "role": user.role,
        "status": user.status,
        "quota_mb": user.quota_mb,
        "ai_enabled": user.ai_enabled,
        "last_login_at": str(user.last_login_at) if user.last_login_at else "",
        "created_at": str(user.created_at) if user.created_at else "",
    }


# ---- 登录历史（仅当前用户自身的 access_logs；强制 user_id 过滤，防 IDOR）----

@router.get("/login-history")
def login_history(limit: int = 20, db: Session = Depends(get_db), user=Depends(get_current_user)):
    limit = max(1, min(int(limit), 50))  # 钳制 1..50，规避超大 limit 拖库
    logs = (
        db.query(AccessLog)
        .filter(AccessLog.user_id == user.id)
        .order_by(AccessLog.created_at.desc())
        .limit(limit)
        .all()
    )
    return [
        {"action": l.action, "detail": l.detail, "ip": l.ip or "", "created_at": str(l.created_at)}
        for l in logs
    ]


# ---- 日志 ----

def _log(db: Session, user_id: Optional[str], action: str, detail: str, request: Request):
    ip = _client_ip(request) if request else ""
    db.add(AccessLog(user_id=user_id, action=action, detail=detail, ip=ip))
    db.commit()
