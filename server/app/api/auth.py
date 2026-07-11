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

from ..db.models import User, Admin, AccessToken, AccessLog, SystemSetting, get_db, get_setting, set_setting
from ..core.security import (
    verify_password, hash_password, create_access_token, create_refresh_token,
    decode_token, generate_token_hash, generate_totp_secret,
    get_totp_uri, verify_totp,
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


# ---- 用户登录 ----

@router.post("/login", response_model=TokenResponse)
def login(req: LoginRequest, request: Request, db: Session = Depends(get_db)):
    user = db.query(User).filter_by(username=req.username).first()
    if not user or not verify_password(req.password, user.password_hash):
        _log(db, None, "login_failed", f"{req.username}（账号或密码错误）", request)
        raise HTTPException(401, "用户名或密码错误")
    if user.status == "disabled":
        _log(db, user.id, "login_blocked", "账号已被禁用", request)
        raise HTTPException(403, "账户已被禁用")
    if user.totp_enabled:
        if not req.totp_code or not verify_totp(user.totp_secret, req.totp_code):
            _log(db, user.id, "login_totp_failed", "动态验证码错误", request)
            raise HTTPException(401, "需要双因子验证码")

    user.last_login_at = datetime.utcnow()
    db.commit()

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
    if len(req.password) < 4:
        raise HTTPException(400, "密码至少 4 个字符")
    if db.query(User).filter_by(username=req.username).first():
        raise HTTPException(409, "用户名已存在")
    if not req.security_question or not req.security_answer:
        raise HTTPException(400, "请设置密保问题和答案")

    # 密保答案哈希存储
    answer_hash = hashlib.sha256(req.security_answer.strip().lower().encode()).hexdigest()

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
    """根据用户名返回密保问题。"""
    user = db.query(User).filter_by(username=req.username).first()
    if not user or not user.security_question:
        raise HTTPException(404, "用户不存在或未设置密保问题")
    return {"username": user.username, "question": user.security_question}


@router.post("/forgot-password/reset")
def reset_password(req: ForgotPasswordStep2Request, request: Request, db: Session = Depends(get_db)):
    """验证密保答案后重置密码。"""
    user = db.query(User).filter_by(username=req.username).first()
    if not user or not user.security_answer:
        raise HTTPException(404, "用户不存在或未设置密保问题")

    answer_hash = hashlib.sha256(req.answer.strip().lower().encode()).hexdigest()
    if answer_hash != user.security_answer:
        _log(db, user.id, "password_reset_failed", "安全问题回答错误", request)
        raise HTTPException(400, "密保答案错误")

    if len(req.new_password) < 4:
        raise HTTPException(400, "新密码至少 4 个字符")

    user.password_hash = hash_password(req.new_password)
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
    admin = db.query(Admin).filter_by(username=req.username).first()
    if not admin or not verify_password(req.password, admin.password_hash):
        _log(db, None, "admin_login_failed", f"{req.username}（账号或密码错误）", request)
        raise HTTPException(401, "管理员用户名或密码错误")
    if admin.totp_enabled:
        if not req.totp_code or not verify_totp(admin.totp_secret, req.totp_code):
            raise HTTPException(401, "需要双因子验证码")

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


# ---- 修改密码 ----

class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str


@router.post("/change-password")
def change_password(req: ChangePasswordRequest, db: Session = Depends(get_db), user=Depends(get_current_user)):
    if not verify_password(req.old_password, user.password_hash):
        raise HTTPException(400, "原密码错误")
    if len(req.new_password) < 4:
        raise HTTPException(400, "新密码至少 4 个字符")
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
    # 优先从反向代理头取真实客户端 IP（Caddy/Nginx 会写入 X-Forwarded-For）
    ip = ""
    xff = request.headers.get("x-forwarded-for")
    if xff:
        ip = xff.split(",")[0].strip()
    elif request.headers.get("x-real-ip"):
        ip = request.headers["x-real-ip"].strip()
    elif request.client:
        ip = request.client.host
    db.add(AccessLog(user_id=user_id, action=action, detail=detail, ip=ip))
    db.commit()
