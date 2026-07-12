"""认证 API（多账户版）：用户登录/注册、忘记密码、管理员登录、设备令牌、TOTP。"""

from datetime import datetime, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel
import hashlib
import qrcode
import qrcode.image.svg
import io
import base64

from ..db.models import (
    User, Admin, AccessToken, AccessLog, SystemSetting,
    get_db, get_setting, set_setting,
    login_limiter_check, login_limiter_record, login_limiter_reset,
)
from ..core.security import (
    verify_password, hash_password, create_access_token, create_refresh_token,
    decode_token, generate_token_hash, generate_totp_secret,
    get_totp_uri, verify_totp, validate_password,
)
from ..config import settings

router = APIRouter(prefix="/api/auth", tags=["auth"])


# ---- 请求/响应模型 ----

class LoginRequest(BaseModel):
    username: str
    password: str
    totp_code: str = ""


class RegisterRequest(BaseModel):
    username: str
    password: str
    security_question: str = ""
    security_answer: str = ""


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    role: str = "user"


class AdminLoginRequest(BaseModel):
    username: str
    password: str
    totp_code: str = ""


class RefreshRequest(BaseModel):
    refresh_token: str


class TOTPSetupResponse(BaseModel):
    secret: str
    qr_code: str
    uri: str


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


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Security(security_scheme),
    db: Session = Depends(get_db),
) -> User:
    if not credentials:
        raise HTTPException(401, "未提供认证信息")
    raw = credentials.credentials
    user = None
    # JWT 形如 header.payload.signature（含两个 "."）；否则按 opaque 设备令牌解析
    if raw.count(".") == 2:
        payload = decode_token(raw)
        if not payload or payload.get("type") != "access":
            raise HTTPException(401, "无效或过期的令牌")
        if payload.get("role") != "user":
            raise HTTPException(403, "此接口需要普通用户权限")
        user = db.query(User).filter_by(id=payload.get("sub")).first()
        if not user:
            raise HTTPException(401, "用户不存在")
    else:
        user = _resolve_device_token(raw, db)
        if not user:
            raise HTTPException(401, "无效或已吊销的令牌")
    if user.status == "disabled":
        raise HTTPException(403, "账户已被禁用")
    return user


def get_current_admin(
    credentials: HTTPAuthorizationCredentials = Security(security_scheme),
    db: Session = Depends(get_db),
) -> Admin:
    if not credentials:
        raise HTTPException(401, "未提供管理员认证信息")
    payload = decode_token(credentials.credentials)
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

@router.post("/login", response_model=TokenResponse)
def login(req: LoginRequest, request: Request, db: Session = Depends(get_db)):
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
    if user.totp_enabled:
        if not req.totp_code or not verify_totp(user.totp_secret, req.totp_code):
            login_limiter_record(db, key)
            _log(db, user.id, "login_totp_failed", "动态验证码错误", request)
            raise HTTPException(401, "需要双因子验证码")

    user.last_login_at = datetime.utcnow()
    db.commit()
    login_limiter_reset(db, key)

    token_data = {"sub": user.id, "username": user.username, "role": "user"}
    _log(db, user.id, "login_success", "", request)
    return TokenResponse(
        access_token=create_access_token(token_data),
        refresh_token=create_refresh_token(token_data),
        role="user",
    )


# ---- 用户注册 ----

@router.post("/register", response_model=TokenResponse)
def register(req: RegisterRequest, request: Request, db: Session = Depends(get_db)):
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

    token_data = {"sub": user.id, "username": user.username, "role": "user"}
    _log(db, user.id, "register", "", request)
    return TokenResponse(
        access_token=create_access_token(token_data),
        refresh_token=create_refresh_token(token_data),
        role="user",
    )


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
    # 顺带把旧 sha256 密保答案升级为 bcrypt（sha256 预哈希）
    if _is_legacy_answer(user.security_answer):
        user.security_answer = _hash_security_answer(req.answer)
    db.commit()
    _log(db, user.id, "password_reset_success", "", request)
    return {"message": "密码已重置，请使用新密码登录"}


# ---- 刷新令牌 ----

@router.post("/refresh", response_model=TokenResponse)
def refresh_token(req: RefreshRequest, db: Session = Depends(get_db)):
    payload = decode_token(req.refresh_token)
    if not payload or payload.get("type") != "refresh":
        raise HTTPException(401, "无效的刷新令牌")
    role = payload.get("role", "user")
    # 校验账户仍然有效（被禁用的用户不能刷新令牌）
    if role == "user":
        user = db.query(User).filter_by(id=payload.get("sub")).first()
        if not user:
            raise HTTPException(401, "用户不存在")
        if user.status == "disabled":
            raise HTTPException(403, "账户已被禁用")
    elif role == "admin":
        admin = db.query(Admin).filter_by(id=payload.get("sub")).first()
        if not admin:
            raise HTTPException(401, "管理员不存在")
    token_data = {
        "sub": payload.get("sub"),
        "username": payload.get("username"),
        "role": role,
    }
    return TokenResponse(
        access_token=create_access_token(token_data),
        refresh_token=create_refresh_token(token_data),
        role=role,
    )


# ---- 管理员登录（独立入口）----

@router.post("/admin/login", response_model=TokenResponse)
def admin_login(req: AdminLoginRequest, request: Request, db: Session = Depends(get_db)):
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
    if admin.totp_enabled:
        if not req.totp_code or not verify_totp(admin.totp_secret, req.totp_code):
            login_limiter_record(db, key)
            raise HTTPException(401, "需要双因子验证码")

    login_limiter_reset(db, key)
    token_data = {"sub": admin.id, "username": admin.username, "role": "admin"}
    _log(db, None, "admin_login_success", "", request)
    return TokenResponse(
        access_token=create_access_token(token_data),
        refresh_token=create_refresh_token(token_data),
        role="admin",
    )


# ---- 注册状态查询（公开）----

@router.get("/register-status")
def register_status(db: Session = Depends(get_db)):
    db_flag = get_setting(db, "allow_register", "")
    if db_flag:
        allow = db_flag.lower() == "true"
    else:
        allow = settings.ALLOW_REGISTER
    return {"allow_register": allow}


# ---- TOTP ----

@router.get("/totp/setup", response_model=TOTPSetupResponse)
def setup_totp():
    secret = generate_totp_secret()
    uri = get_totp_uri(secret)
    factory = qrcode.image.svg.SvgImage
    img = qrcode.make(uri, image_factory=factory)
    buf = io.BytesIO()
    img.save(buf)
    qr_b64 = base64.b64encode(buf.getvalue()).decode()
    return TOTPSetupResponse(
        secret=secret,
        qr_code=f"data:image/svg+xml;base64,{qr_b64}",
        uri=uri,
    )


@router.post("/totp/enable")
def enable_totp(secret: str, code: str, db: Session = Depends(get_db), user=Depends(get_current_user)):
    if not verify_totp(secret, code):
        raise HTTPException(400, "验证码错误")
    user.totp_secret = secret
    user.totp_enabled = True
    db.commit()
    return {"message": "双因子验证已开启"}


@router.post("/totp/disable")
def disable_totp(db: Session = Depends(get_db), user=Depends(get_current_user)):
    user.totp_enabled = False
    user.totp_secret = ""
    db.commit()
    return {"message": "双因子验证已关闭"}


# ---- 设备令牌 ----

@router.post("/tokens", response_model=DeviceTokenResponse)
def create_device_token(label: str = "device", expires_days: int = 0, db: Session = Depends(get_db), user=Depends(get_current_user)):
    raw, h = generate_token_hash()
    expires = None
    if expires_days > 0:
        expires = datetime.utcnow() + timedelta(days=expires_days)
    db.add(AccessToken(user_id=user.id, label=label, token_hash=h, expires_at=expires))
    db.commit()
    return DeviceTokenResponse(token=raw, label=label, expires_at=str(expires) if expires else "")


@router.get("/tokens")
def list_tokens(db: Session = Depends(get_db), user=Depends(get_current_user)):
    tokens = db.query(AccessToken).filter_by(user_id=user.id).order_by(AccessToken.created_at.desc()).all()
    return [{
        "id": t.id, "label": t.label, "revoked": t.revoked,
        "expires_at": str(t.expires_at) if t.expires_at else "",
        "last_used_at": str(t.last_used_at) if t.last_used_at else "",
        "created_at": str(t.created_at),
    } for t in tokens]


@router.delete("/tokens/{token_id}")
def revoke_token(token_id: str, db: Session = Depends(get_db), user=Depends(get_current_user)):
    t = db.query(AccessToken).filter_by(id=token_id, user_id=user.id).first()
    if t:
        t.revoked = True
        db.commit()
    return {"message": f"已吊销令牌: {t.label if t else token_id}"}


@router.delete("/tokens")
def revoke_all_tokens(request: Request, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """吊销当前用户的全部有效令牌（紧急下线所有设备）。"""
    tokens = db.query(AccessToken).filter_by(user_id=user.id, revoked=False).all()
    for t in tokens:
        t.revoked = True
    db.commit()
    _log(db, user.id, "revoke_all_tokens", f"用户主动吊销全部令牌（{len(tokens)} 个）", request)
    return {"message": f"已吊销 {len(tokens)} 个令牌", "count": len(tokens)}


# ---- 修改密码 ----

class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str


@router.post("/change-password")
def change_password(req: ChangePasswordRequest, db: Session = Depends(get_db), user=Depends(get_current_user)):
    if not verify_password(req.old_password, user.password_hash):
        raise HTTPException(400, "原密码错误")
    pwd_err = validate_password(req.new_password, user.username)
    if pwd_err:
        raise HTTPException(400, pwd_err)
    user.password_hash = hash_password(req.new_password)
    db.commit()
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
        "totp_enabled": user.totp_enabled,
        "ai_enabled": user.ai_enabled,
        "last_login_at": str(user.last_login_at) if user.last_login_at else "",
        "created_at": str(user.created_at) if user.created_at else "",
    }


# ---- 日志 ----

def _log(db: Session, user_id: Optional[str], action: str, detail: str, request: Request):
    ip = _client_ip(request) if request else ""
    db.add(AccessLog(user_id=user_id, action=action, detail=detail, ip=ip))
    db.commit()
