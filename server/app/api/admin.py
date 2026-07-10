"""管理员 API：用户管理、系统统计、审计日志、系统设置、全局文件。全部需要 admin token。"""

from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session
from sqlalchemy import func, or_
from pydantic import BaseModel

from ..db.models import User, File, FileGroup, AccessToken, AccessLog, SystemSetting, get_db, get_setting, set_setting
from ..core.security import hash_password, generate_token_hash
from ..core import storage
from ..config import settings
from .auth import get_current_admin, _log

router = APIRouter(prefix="/api/admin", tags=["admin"])


class CreateUserRequest(BaseModel):
    username: str
    password: str
    quota_mb: int = 0


class UpdateUserRequest(BaseModel):
    status: str = ""
    quota_mb: int = -1
    password: str = ""


class CreateTokenRequest(BaseModel):
    label: str = "device"
    expires_days: int = 0


# ---- 管理员信息 ----

@router.get("/me")
def admin_info(admin=Depends(get_current_admin)):
    return {"id": admin.id, "username": admin.username, "role": "admin"}


# ---- 用户管理 ----

@router.get("/users")
def list_users(search: str = Query(""), db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    q = db.query(User)
    if search:
        q = q.filter(User.username.contains(search))
    users = q.order_by(User.created_at.desc()).all()
    result = []
    for u in users:
        file_count = db.query(File).filter_by(owner_id=u.id).count()
        used_bytes = db.query(func.sum(File.size)).filter(File.owner_id == u.id).scalar() or 0
        result.append({
            "id": u.id, "username": u.username, "status": u.status,
            "quota_mb": u.quota_mb, "file_count": file_count,
            "used_mb": round(used_bytes / 1024 / 1024, 2),
            "totp_enabled": u.totp_enabled,
            "last_login": str(u.last_login_at).split(".")[0] if u.last_login_at else "",
            "created_at": str(u.created_at),
        })
    return {"users": result}


@router.post("/users")
def create_user(req: CreateUserRequest, request: Request, db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    if len(req.username) < 2:
        raise HTTPException(400, "用户名至少 2 个字符")
    if len(req.password) < 4:
        raise HTTPException(400, "密码至少 4 个字符")
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
        user.password_hash = hash_password(req.password)
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
            "totp_enabled": user.totp_enabled,
            "has_security_question": bool(user.security_question),
            "last_login": str(user.last_login_at) if user.last_login_at else "",
            "created_at": str(user.created_at),
        },
        "files": [{
            "id": f.id, "path": f.path, "name": f.name, "size": f.size,
            "tag": f.tag, "guard_status": f.guard_status,
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
    return [{
        "id": t.id, "label": t.label, "revoked": t.revoked,
        "expires_at": str(t.expires_at) if t.expires_at else "",
        "last_used_at": str(t.last_used_at) if t.last_used_at else "",
        "created_at": str(t.created_at),
    } for t in tokens]


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
    page_size: int = Query(50, ge=1, le=200),
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
            "tag": f.tag, "guard_status": f.guard_status,
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
    db: Session = Depends(get_db),
    admin=Depends(get_current_admin),
):
    """列出全部用户的分组，便于管理员跟进分组使用情况。"""
    q = db.query(FileGroup, User.username).join(User, FileGroup.owner_id == User.id)
    if search:
        q = q.filter(or_(FileGroup.name.contains(search), User.username.contains(search)))
    rows = q.order_by(FileGroup.created_at.desc()).all()
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
    return {"groups": result, "total": len(result)}


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
    limit: int = Query(100),
    offset: int = Query(0),
    action: str = Query(""),
    db: Session = Depends(get_db),
    admin=Depends(get_current_admin),
):
    q = db.query(AccessLog)
    if action:
        q = q.filter(AccessLog.action.contains(action))
    total = q.count()
    logs = q.order_by(AccessLog.created_at.desc()).offset(offset).limit(limit).all()
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
    } for l in logs], "total": total}


# ---- 系统设置 ----

@router.get("/settings")
def get_settings_api(db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    return {
        "allow_register": get_setting(db, "allow_register", str(settings.ALLOW_REGISTER).lower()),
        "default_quota_mb": int(get_setting(db, "default_quota_mb", str(settings.DEFAULT_QUOTA_MB))),
        "site_name": get_setting(db, "site_name", ""),
    }


@router.put("/settings")
def update_settings(req: dict, request: Request, db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    if "allow_register" in req:
        set_setting(db, "allow_register", str(req["allow_register"]).lower())
    if "default_quota_mb" in req:
        try:
            set_setting(db, "default_quota_mb", str(int(req["default_quota_mb"])))
        except (ValueError, TypeError):
            raise HTTPException(400, "配额必须是数字")
    if "site_name" in req:
        set_setting(db, "site_name", str(req["site_name"]))
    parts = []
    if "allow_register" in req:
        parts.append(f"允许注册={'开' if str(req['allow_register']).lower() == 'true' else '关'}")
    if "default_quota_mb" in req:
        parts.append(f"默认配额={req['default_quota_mb']}MB")
    if "site_name" in req:
        parts.append(f"站点名称={req['site_name']}")
    _log(db, None, "admin_update_settings", "、".join(parts), request)
    return {"message": "设置已保存"}


# ---- 系统信息 ----

@router.get("/system-info")
def system_info(admin=Depends(get_current_admin)):
    import platform
    import sys
    return {
        "python_version": sys.version.split()[0],
        "platform": platform.platform(),
        "app_version": "2.0.0",
        "storage_dir": settings.STORAGE_DIR,
        "database_path": settings.DATABASE_PATH,
        "llm_provider": settings.LLM_PROVIDER,
        "llm_model": settings.llm_model,
    }
