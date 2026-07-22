"""管理员 API：用户管理、系统统计、审计日志、系统设置、全局文件。全部需要 admin token。"""

from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session
from sqlalchemy import func, or_
from pydantic import BaseModel

from ..db.models import User, File, FileGroup, AccessToken, AccessLog, SystemSetting, LlmProvider, get_db, get_setting, set_setting, get_trash_retention_days, DEFAULT_TRASH_RETENTION_DAYS, login_limiter_check, login_limiter_record, login_limiter_reset
from ..core.security import hash_password, generate_token_hash, encrypt_api_key, decrypt_api_key, validate_password, verify_password
from ..core import storage, indexer
from ..config import settings
from ..version import __version__
from ..services import trash as trash_service
from .auth import get_current_admin, _log, _bump_password_version, _limiter_key, _set_user_password

router = APIRouter(prefix="/admin", tags=["admin"])


class CreateUserRequest(BaseModel):
    username: str
    password: str
    quota_mb: int = 0


class UpdateUserRequest(BaseModel):
    status: str = ""
    quota_mb: int = -1
    password: str = ""


class SaveLlmProviderRequest(BaseModel):
    name: str
    provider: str = "openai"
    api_key: str = ""
    base_url: str = ""
    model: str = ""
    enabled: bool = True
    is_default: bool = False


class UpdateUserAiRequest(BaseModel):
    ai_enabled: bool = True
    llm_provider_id: str = ""


class CreateTokenRequest(BaseModel):
    label: str = "device"
    expires_days: int = 0


class ChangeAdminPasswordRequest(BaseModel):
    old_password: str
    new_password: str


# ---- 管理员信息 ----

@router.get("/me")
def admin_info(admin=Depends(get_current_admin)):
    return {"id": admin.id, "username": admin.username, "role": "admin"}


@router.put("/me/password")
def change_admin_password(req: ChangeAdminPasswordRequest, request: Request, db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    # 限流：管理端改密同样防在线爆破旧密码。独立 admin-stepup scope，
    # 按纯用户名计（cookie 会话认证不绑 IP）。
    key = _limiter_key("admin-stepup", admin.username)
    locked = login_limiter_check(db, key)
    if locked:
        raise HTTPException(429, f"尝试过于频繁，请 {locked} 秒后再试")
    if not verify_password(req.old_password, admin.password_hash):
        login_limiter_record(db, key)
        _log(db, None, "admin_password_change_failed", "原密码错误", request)
        raise HTTPException(400, "原密码错误")
    pwd_err = validate_password(req.new_password, admin.username)
    if pwd_err:
        # 422（区别于 400 原密码错误）：前端按状态码把错误定位到新密码字段
        raise HTTPException(422, pwd_err)
    login_limiter_reset(db, key)
    admin.password_hash = hash_password(req.new_password)
    db.commit()
    _log(db, None, "admin_password_change", "", request)
    return {"message": "密码已更新"}


# ---- 用户管理 ----

@router.get("/users")
def list_users(
    search: str = Query(""),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=200),
    db: Session = Depends(get_db),
    admin=Depends(get_current_admin),
):
    q = db.query(User)
    if search:
        q = q.filter(User.username.contains(search))
    total = q.count()
    users = q.order_by(User.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    result = []
    for u in users:
        file_count = db.query(File).filter_by(owner_id=u.id).count()
        used_bytes = db.query(func.sum(File.size)).filter(File.owner_id == u.id).scalar() or 0
        result.append({
            "id": u.id, "username": u.username, "status": u.status,
            "quota_mb": u.quota_mb, "file_count": file_count,
            "used_mb": round(used_bytes / 1024 / 1024, 2),
            "ai_enabled": u.ai_enabled,
            "last_login": str(u.last_login_at).split(".")[0] if u.last_login_at else "",
            "created_at": str(u.created_at),
        })
    return {"users": result, "total": total, "page": page, "page_size": page_size}


@router.post("/users")
def create_user(req: CreateUserRequest, request: Request, db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    if len(req.username) < 2:
        raise HTTPException(400, "用户名至少 2 个字符")
    pwd_err = validate_password(req.password, req.username)
    if pwd_err:
        raise HTTPException(400, pwd_err)
    if db.query(User).filter_by(username=req.username).first():
        raise HTTPException(409, "用户名已存在")
    user = User(
        username=req.username,
        password_hash=hash_password(req.password),
        status="active",
        quota_mb=req.quota_mb,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    _log(db, None, "admin_create_user", f"新建用户「{req.username}」", request)
    return {"id": user.id, "username": user.username, "message": "用户已创建"}


@router.put("/users/{user_id}")
def update_user(user_id: str, req: UpdateUserRequest, request: Request, db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    user = db.query(User).filter_by(id=user_id).first()
    if not user:
        raise HTTPException(404, "用户不存在")
    if req.status in ("active", "disabled"):
        user.status = req.status
    if req.quota_mb >= 0:
        user.quota_mb = req.quota_mb
    if req.password:
        pwd_err = validate_password(req.password, user.username)
        if pwd_err:
            raise HTTPException(400, pwd_err)
        _set_user_password(db, user, req.password)  # 哈希+时间戳+bump 原子内聚
    db.commit()
    changes = []
    if req.status in ("active", "disabled"):
        changes.append(f"状态改为{'启用' if req.status == 'active' else '禁用'}")
    if req.quota_mb >= 0:
        changes.append(f"配额改为 {req.quota_mb}MB")
    if req.password:
        changes.append("重置了密码")
    detail = f"用户「{user.username}」" + (f"（{'、'.join(changes)}）" if changes else "")
    _log(db, None, "admin_update_user", detail, request)
    return {"message": "用户已更新"}


@router.delete("/users/{user_id}")
def delete_user(user_id: str, request: Request, db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    user = db.query(User).filter_by(id=user_id).first()
    if not user:
        raise HTTPException(404, "用户不存在")
    username = user.username
    storage.delete_user_storage(user_id)
    db.query(File).filter_by(owner_id=user_id).delete()
    db.query(FileGroup).filter_by(owner_id=user_id).delete()
    from ..db.models import ChatMessage, SyncEvent
    db.query(ChatMessage).filter_by(user_id=user_id).delete()
    db.query(SyncEvent).filter_by(user_id=user_id).delete()
    db.query(AccessToken).filter_by(user_id=user_id).delete()
    db.delete(user)
    db.commit()
    _log(db, None, "admin_delete_user", f"删除用户「{username}」", request)
    return {"message": f"用户 {username} 已删除"}


# ---- 全局回收站统计与清理 ----

@router.get("/trash/stats")
def admin_trash_stats(db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    """全局回收站统计：总文件数、总占用、按用户分布、7 天内将过期数。"""
    rows = db.query(File).filter(File.deleted_at.isnot(None)).all()
    total_size = sum(f.size for f in rows)
    retention_days = get_trash_retention_days(db)
    now = datetime.utcnow()
    cutoff = now + timedelta(days=7)
    per_user = {}
    expiring_soon = 0
    locked_count = 0
    for f in rows:
        per_user.setdefault(f.owner_id, {"count": 0, "size": 0})
        per_user[f.owner_id]["count"] += 1
        per_user[f.owner_id]["size"] += f.size
        if f.locked_at:
            locked_count += 1
        elif f.deleted_at + timedelta(days=retention_days) <= cutoff:
            expiring_soon += 1
    # 解析用户名为可读形式
    user_map = {}
    if per_user:
        for u in db.query(User).filter(User.id.in_(list(per_user.keys()))).all():
            user_map[u.id] = u.username
    user_distribution = [{
        "user_id": uid,
        "username": user_map.get(uid, uid),
        "count": v["count"],
        "size": v["size"],
    } for uid, v in sorted(per_user.items(), key=lambda x: -x[1]["count"])]
    return {
        "total": len(rows),
        "total_size": total_size,
        "retention_days": retention_days,
        "expiring_soon": expiring_soon,
        "locked_count": locked_count,
        "user_distribution": user_distribution,
    }


@router.post("/trash/purge")
def admin_trash_purge(request: Request, db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    """手动触发全局回收站过期清理（实现收敛至 services/trash.py）。"""
    retention_days = get_trash_retention_days(db)
    purged = trash_service.purge_expired(db, user_id=None, write_access_log=False)
    _log(db, None, "admin_trash_purge", f"管理员清理回收站过期文件 {purged} 个", request)
    return {"purged": purged, "retention_days": retention_days}


# ---- 用户详情 ----

@router.get("/users/{user_id}/detail")
def user_detail(user_id: str, db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    user = db.query(User).filter_by(id=user_id).first()
    if not user:
        raise HTTPException(404, "用户不存在")
    files = db.query(File).filter_by(owner_id=user_id).order_by(File.uploaded_at.desc()).limit(50).all()
    logs = db.query(AccessLog).filter_by(user_id=user_id).order_by(AccessLog.created_at.desc()).limit(20).all()
    used = db.query(func.sum(File.size)).filter(File.owner_id == user_id).scalar() or 0
    return {
        "user": {
            "id": user.id, "username": user.username, "status": user.status,
            "quota_mb": user.quota_mb,
            "used_mb": round(used / 1024 / 1024, 2),
            "file_count": db.query(File).filter_by(owner_id=user_id).count(),
            "ai_enabled": user.ai_enabled,
            "llm_provider_id": user.llm_provider_id or "",
            "has_security_question": bool(user.security_question),
            "last_login": str(user.last_login_at) if user.last_login_at else "",
            "created_at": str(user.created_at),
        },
        "files": [{
           "id": f.id, "path": f.path, "name": f.name, "size": f.size,
            "guard_status": f.guard_status,
           "group_id": f.group_id or "",
           "group_name": (db.query(FileGroup).filter_by(id=f.group_id).first().name if f.group_id else ""),
           "uploaded_at": str(f.uploaded_at),
        } for f in files],
        "logs": [{
            "id": l.id, "action": l.action, "detail": l.detail,
            "ip": l.ip, "time": str(l.created_at),
        } for l in logs],
    }


# ---- 用户访问令牌管理 ----

@router.get("/users/{user_id}/tokens")
def list_user_tokens(user_id: str, db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    """列出指定用户的全部访问令牌（含已吊销/已过期，便于审计）。"""
    user = db.query(User).filter_by(id=user_id).first()
    if not user:
        raise HTTPException(404, "用户不存在")
    tokens = db.query(AccessToken).filter_by(user_id=user_id).order_by(AccessToken.created_at.desc()).all()
    now = datetime.utcnow()
    result = []
    for t in tokens:
        item = {
            "id": t.id, "kind": t.kind or "device", "label": t.label, "revoked": t.revoked,
            "ip": t.ip or "", "geo": t.geo or "",
            "expires_at": str(t.expires_at) if t.expires_at else "",
            "last_used_at": str(t.last_used_at) if t.last_used_at else "",
            "created_at": str(t.created_at),
        }
        if t.kind == "session":
            item["download_granted"] = bool(t.download_granted_until and t.download_granted_until > now)
        result.append(item)
    return result


@router.post("/users/{user_id}/tokens")
def create_user_token(user_id: str, req: CreateTokenRequest, request: Request, db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    """为指定用户创建访问令牌，原始令牌仅返回一次。"""
    user = db.query(User).filter_by(id=user_id).first()
    if not user:
        raise HTTPException(404, "用户不存在")
    if not req.label.strip():
        req.label = "device"
    raw, h = generate_token_hash()
    expires = None
    if req.expires_days > 0:
        expires = datetime.utcnow() + timedelta(days=req.expires_days)
    db.add(AccessToken(user_id=user_id, label=req.label, token_hash=h, expires_at=expires))
    db.commit()
    _log(db, user_id, "admin_create_token", f"为用户「{user.username}」创建令牌「{req.label}」", request)
    return {"token": raw, "label": req.label, "expires_at": str(expires) if expires else ""}


@router.delete("/users/{user_id}/tokens/{token_id}")
def revoke_user_token(user_id: str, token_id: str, request: Request, db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    """吊销指定用户的某个访问令牌。"""
    user = db.query(User).filter_by(id=user_id).first()
    if not user:
        raise HTTPException(404, "用户不存在")
    t = db.query(AccessToken).filter_by(id=token_id, user_id=user_id).first()
    if not t:
        raise HTTPException(404, "令牌不存在")
    label = t.label
    t.revoked = True
    db.commit()
    _log(db, user_id, "admin_revoke_token", f"吊销用户「{user.username}」的令牌「{label}」", request)
    return {"message": f"已吊销令牌: {label}"}


@router.delete("/users/{user_id}/tokens")
def revoke_all_user_tokens(user_id: str, request: Request, db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    """一键吊销指定用户全部有效令牌（应急下线设备）。"""
    user = db.query(User).filter_by(id=user_id).first()
    if not user:
        raise HTTPException(404, "用户不存在")
    tokens = db.query(AccessToken).filter_by(user_id=user_id, revoked=False).all()
    count = 0
    for t in tokens:
        t.revoked = True
        count += 1
    db.commit()
    _log(db, user_id, "admin_revoke_all_tokens", f"吊销用户「{user.username}」的全部令牌（{count} 个）", request)
    return {"message": f"已吊销 {count} 个令牌", "count": count}


# ---- 系统统计 ----

@router.get("/stats")
def system_stats(db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    total_users = db.query(User).count()
    active_users = db.query(User).filter_by(status="active").count()
    disabled_users = db.query(User).filter_by(status="disabled").count()
    total_files = db.query(File).count()
    total_size = db.query(func.sum(File.size)).scalar() or 0

    user_stats = []
    for u in db.query(User).all():
        count = db.query(File).filter_by(owner_id=u.id).count()
        size = db.query(func.sum(File.size)).filter(File.owner_id == u.id).scalar() or 0
        user_stats.append({
            "username": u.username, "status": u.status,
            "file_count": count, "used_mb": round(size / 1024 / 1024, 2),
            "last_login": str(u.last_login_at).split(".")[0] if u.last_login_at else "",
        })

    import shutil
    disk = shutil.disk_usage(settings.storage_path)

    # 最近活跃用户（7天内有登录）
    from datetime import timedelta
    week_ago = datetime.utcnow() - timedelta(days=7)
    active_recent = db.query(User).filter(User.last_login_at >= week_ago).count()

    return {
        "total_users": total_users,
        "active_users": active_users,
        "disabled_users": disabled_users,
        "recent_active": active_recent,
        "total_files": total_files,
        "total_size_mb": round(total_size / 1024 / 1024, 2),
        "disk": {
            "total_gb": round(disk.total / 1024 / 1024 / 1024, 2),
            "used_gb": round(disk.used / 1024 / 1024 / 1024, 2),
            "free_gb": round(disk.free / 1024 / 1024 / 1024, 2),
        },
        "user_stats": user_stats,
    }


# ---- 全局文件浏览 ----

@router.get("/files")
def all_files(
    search: str = Query(""),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=200),
    db: Session = Depends(get_db),
    admin=Depends(get_current_admin),
):
    q = db.query(File, User.username).join(User, File.owner_id == User.id)
    if search:
        q = q.filter(or_(File.name.contains(search), File.path.contains(search)))
    total = q.count()
    rows = q.order_by(File.uploaded_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    # 批量解析分组名
    gids = {f.group_id for f, _ in rows if f.group_id}
    group_map = {}
    if gids:
        for g in db.query(FileGroup).filter(FileGroup.id.in_(gids)).all():
            group_map[g.id] = g.name
    return {
        "files": [{
            "id": f.id, "owner": uname, "owner_id": f.owner_id,
           "path": f.path, "name": f.name, "size": f.size,
            "guard_status": f.guard_status,
           "group_id": f.group_id or "",
           "group_name": group_map.get(f.group_id, "") if f.group_id else "",
           "uploaded_at": str(f.uploaded_at),
        } for f, uname in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


# ---- 全局分组总览 ----

@router.get("/groups")
def all_groups(
    search: str = Query(""),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=200),
    db: Session = Depends(get_db),
    admin=Depends(get_current_admin),
):
    """列出全部用户的分组，便于管理员跟进分组使用情况。"""
    q = db.query(FileGroup, User.username).join(User, FileGroup.owner_id == User.id)
    if search:
        q = q.filter(or_(FileGroup.name.contains(search), User.username.contains(search)))
    total = q.count()
    rows = q.order_by(FileGroup.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    result = []
    for g, uname in rows:
        files = db.query(File).filter_by(group_id=g.id).all()
        total_size = sum(f.size for f in files)
        result.append({
            "id": g.id, "name": g.name, "owner_id": g.owner_id,
            "owner": uname, "file_count": len(files),
            "size": total_size,
            "created_at": str(g.created_at),
            "updated_at": str(g.updated_at),
        })
    return {"groups": result, "total": total, "page": page, "page_size": page_size}


@router.delete("/groups/{group_id}")
def admin_delete_group(group_id: str, request: Request, db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    """管理员删除任意用户的分组（文件保留，仅解除关联）。"""
    g = db.query(FileGroup).filter_by(id=group_id).first()
    if not g:
        raise HTTPException(404, "分组不存在")
    name = g.name
    owner_id = g.owner_id
    db.query(File).filter_by(group_id=group_id).update({File.group_id: None})
    db.delete(g)
    db.commit()
    _log(db, owner_id, "admin_delete_group", f"管理员删除分组「{name}」", request)
    return {"message": f"分组「{name}」已删除"}


# ---- 审计日志 ----

@router.get("/logs")
def audit_logs(
    action: str = Query(""),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=200),
    db: Session = Depends(get_db),
    admin=Depends(get_current_admin),
):
    q = db.query(AccessLog)
    if action:
        q = q.filter(AccessLog.action.contains(action))
    total = q.count()
    logs = q.order_by(AccessLog.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    # 关联用户名
    user_map = {}
    if logs:
        uids = set(l.user_id for l in logs if l.user_id)
        if uids:
            for u in db.query(User).filter(User.id.in_(uids)).all():
                user_map[u.id] = u.username
    return {"logs": [{
        "id": l.id,
        "user_id": l.user_id or "",
        "username": user_map.get(l.user_id, "-"),
        "action": l.action,
        "detail": l.detail,
        "ip": l.ip,
        "time": str(l.created_at),
    } for l in logs], "total": total, "page": page, "page_size": page_size}


# ---- 系统设置 ----

@router.get("/settings")
def get_settings_api(db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    from ..core.security import decrypt_api_key
    secret_enc = get_setting(db, "sms_aliyun_access_key_secret", "")
    secret_masked = ""
    if secret_enc:
        plain = decrypt_api_key(secret_enc)
        secret_masked = plain[:4] + "****" + plain[-4:] if len(plain) > 8 else "****"
    return {
        "allow_register": get_setting(db, "allow_register", str(settings.ALLOW_REGISTER).lower()),
        "default_quota_mb": int(get_setting(db, "default_quota_mb", str(settings.DEFAULT_QUOTA_MB))),
        "site_name": get_setting(db, "site_name", ""),
        "trash_retention_days": int(get_setting(db, "trash_retention_days", str(DEFAULT_TRASH_RETENTION_DAYS))),
        # 短信
        "sms_enabled": get_setting(db, "sms_enabled", "false"),
        "sms_aliyun_access_key_id": get_setting(db, "sms_aliyun_access_key_id", ""),
        "sms_aliyun_access_key_secret_masked": secret_masked,
        "sms_aliyun_sign_name": get_setting(db, "sms_aliyun_sign_name", ""),
        "sms_aliyun_template_code": get_setting(db, "sms_aliyun_template_code", ""),
        "sms_aliyun_endpoint": get_setting(db, "sms_aliyun_endpoint", "dysmsapi.aliyuncs.com"),
        "sms_required_for_login": get_setting(db, "sms_required_for_login", "true"),
        "sms_required_for_register": get_setting(db, "sms_required_for_register", "true"),
        "sms_code_ttl_seconds": int(get_setting(db, "sms_code_ttl_seconds", "300")),
        "sms_max_attempts": int(get_setting(db, "sms_max_attempts", "5")),
        "sms_cooldown_seconds": int(get_setting(db, "sms_cooldown_seconds", "60")),
        "sms_daily_limit_per_phone": int(get_setting(db, "sms_daily_limit_per_phone", "20")),
    }


@router.put("/settings")
def update_settings(req: dict, request: Request, db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    from ..core.sms import invalidate_sms_config_cache
    if "allow_register" in req:
        set_setting(db, "allow_register", str(req["allow_register"]).lower())
    if "default_quota_mb" in req:
        try:
            set_setting(db, "default_quota_mb", str(int(req["default_quota_mb"])))
        except (ValueError, TypeError):
            raise HTTPException(400, "配额必须是数字")
    if "site_name" in req:
        set_setting(db, "site_name", str(req["site_name"]))
    if "trash_retention_days" in req:
        try:
            v = int(req["trash_retention_days"])
            if not (1 <= v <= 90):
                raise ValueError
            set_setting(db, "trash_retention_days", str(v))
        except (ValueError, TypeError):
            raise HTTPException(400, "保留天数必须是 1-90 之间的整数")
    # 短信设置
    sms_bool_keys = ("sms_enabled", "sms_required_for_login", "sms_required_for_register")
    for k in sms_bool_keys:
        if k in req:
            set_setting(db, k, str(req[k]).lower() in ("true", "1", "yes"))
    if "sms_aliyun_access_key_id" in req:
        set_setting(db, "sms_aliyun_access_key_id", str(req["sms_aliyun_access_key_id"]).strip())
    if "sms_aliyun_access_key_secret" in req:
        v = str(req["sms_aliyun_access_key_secret"]).strip()
        if v and v != "****":
            set_setting(db, "sms_aliyun_access_key_secret", encrypt_api_key(v))
    if "sms_aliyun_sign_name" in req:
        set_setting(db, "sms_aliyun_sign_name", str(req["sms_aliyun_sign_name"]).strip())
    if "sms_aliyun_template_code" in req:
        set_setting(db, "sms_aliyun_template_code", str(req["sms_aliyun_template_code"]).strip())
    if "sms_aliyun_endpoint" in req:
        set_setting(db, "sms_aliyun_endpoint", str(req["sms_aliyun_endpoint"]).strip() or "dysmsapi.aliyuncs.com")
    for k, lo, hi in (
        ("sms_code_ttl_seconds", 60, 3600),
        ("sms_max_attempts", 3, 10),
        ("sms_cooldown_seconds", 30, 300),
        ("sms_daily_limit_per_phone", 5, 100),
    ):
        if k in req:
            try:
                v = int(req[k])
                if not (lo <= v <= hi):
                    raise ValueError
                set_setting(db, k, str(v))
            except (ValueError, TypeError):
                raise HTTPException(400, f"{k} 必须是 {lo}-{hi} 之间的整数")
    invalidate_sms_config_cache()
    parts = []
    if "allow_register" in req:
        parts.append(f"允许注册={'开' if str(req['allow_register']).lower() == 'true' else '关'}")
    if "default_quota_mb" in req:
        parts.append(f"默认配额={req['default_quota_mb']}MB")
    if "site_name" in req:
        parts.append(f"站点名称={req['site_name']}")
    if "trash_retention_days" in req:
        parts.append(f"回收站保留={req['trash_retention_days']}天")
    if "sms_enabled" in req:
        parts.append(f"短信={'开' if str(req['sms_enabled']).lower() == 'true' else '关'}")
    _log(db, None, "admin_update_settings", "、".join(parts) or "短信配置更新", request)
    return {"message": "设置已保存"}


class _SmsTestRequest(BaseModel):
    phone: str


@router.post("/settings/sms/test")
def test_sms_settings(req: _SmsTestRequest, request: Request,
                      db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    """给指定手机号发一条测试短信（验证配置是否生效）。"""
    from ..services.sms_code import create_and_send_code
    from ..core.sms import is_sms_enabled, SmsError
    if not is_sms_enabled(db):
        raise HTTPException(400, "短信服务未启用或配置不完整")
    try:
        res = create_and_send_code(db, req.phone, "bind", client_ip=_client_ip(request))
        _log(db, None, "admin_sms_test", f"测试发送至 {res.get('masked_phone', '')}", request)
        return {"ok": True, "message": f"测试短信已发送至 {res['masked_phone']}"}
    except SmsError as e:
        raise HTTPException(502, f"发送失败: {e}")


# ---- 系统信息 ----

@router.get("/system-info")
def system_info(admin=Depends(get_current_admin)):
    import platform
    import sys
    # LLM 信息从数据库读取（不再依赖 env）
    from ..db.models import SessionLocal
    _db = SessionLocal()
    try:
        providers = _db.query(LlmProvider).order_by(LlmProvider.sort_order).all()
        active = [p for p in providers if p.enabled]
        default = next((p for p in providers if p.is_default and p.enabled), None)
    finally:
        _db.close()
    return {
        "python_version": sys.version.split()[0],
        "platform": platform.platform(),
        "app_version": __version__,
        "storage_dir": settings.STORAGE_DIR,
        "database_path": settings.DATABASE_PATH,
        "llm_provider": (default.name if default else "未配置"),
        "llm_model": (default.model if default else "-"),
        "llm_count": len(active),
    }


# ---- 大模型配置管理 ----

def _provider_to_dict(p, mask_key=True):
    return {
        "id": p.id,
        "name": p.name,
        "provider": p.provider,
        "api_key": ("•" * 8 if mask_key and p.api_key_enc else ""),
        "has_key": bool(p.api_key_enc),
        "base_url": p.base_url,
        "model": p.model,
        "enabled": p.enabled,
        "is_default": p.is_default,
        "sort_order": p.sort_order,
        "created_at": str(p.created_at),
    }


@router.get("/llm/providers")
def list_llm_providers(db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    providers = db.query(LlmProvider).order_by(LlmProvider.sort_order, LlmProvider.created_at).all()
    return {"providers": [_provider_to_dict(p) for p in providers]}


@router.post("/llm/providers")
def create_llm_provider(req: SaveLlmProviderRequest, request: Request, db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    if not req.name.strip():
        raise HTTPException(400, "名称不能为空")
    if not req.api_key.strip():
        raise HTTPException(400, "API Key 不能为空")
    if not req.base_url.strip():
        req.base_url = "https://api.openai.com/v1"
    if not req.model.strip():
        raise HTTPException(400, "模型名称不能为空")
    # 如果设为默认，取消其他默认
    if req.is_default:
        db.query(LlmProvider).filter(LlmProvider.is_default == True).update({LlmProvider.is_default: False})
    provider = LlmProvider(
        name=req.name.strip(),
        provider=req.provider,
        api_key_enc=encrypt_api_key(req.api_key.strip()),
        base_url=req.base_url.strip(),
        model=req.model.strip(),
        enabled=req.enabled,
        is_default=req.is_default,
        sort_order=db.query(LlmProvider).count(),
    )
    db.add(provider)
    db.commit()
    db.refresh(provider)
    _log(db, None, "admin_create_llm", f"新建大模型「{provider.name}」", request)
    return _provider_to_dict(provider)


@router.put("/llm/providers/{provider_id}")
def update_llm_provider(provider_id: str, req: SaveLlmProviderRequest, request: Request, db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    p = db.query(LlmProvider).filter_by(id=provider_id).first()
    if not p:
        raise HTTPException(404, "大模型配置不存在")
    if not req.name.strip():
        raise HTTPException(400, "名称不能为空")
    p.name = req.name.strip()
    p.provider = req.provider
    # api_key 为空表示不修改
    if req.api_key.strip():
        p.api_key_enc = encrypt_api_key(req.api_key.strip())
    if req.base_url.strip():
        p.base_url = req.base_url.strip()
    if req.model.strip():
        p.model = req.model.strip()
    p.enabled = req.enabled
    if req.is_default and not p.is_default:
        db.query(LlmProvider).filter(LlmProvider.id != provider_id).update({LlmProvider.is_default: False})
    p.is_default = req.is_default
    p.updated_at = datetime.utcnow()
    db.commit()
    _log(db, None, "admin_update_llm", f"修改大模型「{p.name}」", request)
    return _provider_to_dict(p)


@router.delete("/llm/providers/{provider_id}")
def delete_llm_provider(provider_id: str, request: Request, db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    p = db.query(LlmProvider).filter_by(id=provider_id).first()
    if not p:
        raise HTTPException(404, "大模型配置不存在")
    name = p.name
    was_default = p.is_default
    # 解除引用此模型的用户分配
    db.query(User).filter(User.llm_provider_id == provider_id).update({User.llm_provider_id: None})
    db.delete(p)
    db.commit()
    # 如果删除的是默认模型，自动将第一个启用的模型设为默认
    if was_default:
        first = db.query(LlmProvider).filter_by(enabled=True).order_by(LlmProvider.sort_order).first()
        if first:
            first.is_default = True
            db.commit()
    _log(db, None, "admin_delete_llm", f"删除大模型「{name}」", request)
    return {"message": f"大模型「{name}」已删除"}


@router.post("/llm/providers/{provider_id}/test")
def test_llm_provider(provider_id: str, db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    p = db.query(LlmProvider).filter_by(id=provider_id).first()
    if not p:
        raise HTTPException(404, "大模型配置不存在")
    api_key = decrypt_api_key(p.api_key_enc)
    if not api_key:
        raise HTTPException(400, "该模型未配置 API Key")
    try:
        from openai import OpenAI
        client = OpenAI(api_key=api_key, base_url=p.base_url)
        resp = client.chat.completions.create(
            model=p.model,
            messages=[{"role": "user", "content": "请回复 ok"}],
            max_tokens=10,
        )
        return {"ok": True, "reply": resp.choices[0].message.content}
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ---- 用户 AI 权限管理 ----

@router.get("/llm/assignable")
def list_assignable_providers(db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    """列出可分配给用户的大模型（用于用户详情页下拉选择）。"""
    providers = db.query(LlmProvider).filter_by(enabled=True).order_by(LlmProvider.sort_order).all()
    return {"providers": [{"id": p.id, "name": p.name, "model": p.model, "is_default": p.is_default} for p in providers]}


@router.put("/users/{user_id}/ai")
def update_user_ai(user_id: str, req: UpdateUserAiRequest, request: Request, db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    user = db.query(User).filter_by(id=user_id).first()
    if not user:
        raise HTTPException(404, "用户不存在")
    user.ai_enabled = req.ai_enabled
    # 空字符串表示清除分配（回退到默认模型）
    user.llm_provider_id = req.llm_provider_id.strip() or None
    if user.llm_provider_id:
        p = db.query(LlmProvider).filter_by(id=user.llm_provider_id).first()
        if not p:
            raise HTTPException(400, "指定的大模型不存在")
        if not p.enabled:
            # 禁用的模型不能分配：_resolve_provider 会因 enabled=True 过滤而跳过它，
            # 导致用户实际回退到默认模型，与界面上看到的分配不一致。
            raise HTTPException(400, "指定的大模型已禁用，请先启用或选择其他模型")
    db.commit()
    detail = f"用户「{user.username}」AI 权限={'开启' if req.ai_enabled else '关闭'}"
    if req.llm_provider_id.strip():
        pname = db.query(LlmProvider).filter_by(id=req.llm_provider_id.strip()).first()
        detail += f"，分配模型「{pname.name if pname else '?'}」"
    _log(db, user_id, "admin_update_ai", detail, request)
    return {"message": "AI 设置已更新"}
