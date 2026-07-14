"""文件操作 API（多账户版）：所有操作带 owner_id 隔离。"""

from datetime import datetime, timedelta
from pathlib import Path
import mimetypes
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File as FAFile, Query, Request
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy.orm import Session
from sqlalchemy import func

from ..db.models import File as FileModel, FileGroup, SyncEvent, AccessLog, User, AccessToken, get_db
from ..core import storage, indexer, guard
from ..config import settings
from .auth import get_current_user, get_current_session, _log
from pydantic import BaseModel

router = APIRouter(prefix="/api/files", tags=["files"])


# 可在浏览器内联渲染并执行脚本的类型：预览时强制下载，避免上传恶意 HTML/SVG 后预览触发存储型 XSS。
_UNSAFE_PREVIEW_TYPES = {
    "text/html", "application/xhtml+xml", "image/svg+xml",
    "application/xml", "text/xml",
}


class GroupRequest(BaseModel):
    name: str


class NoteRequest(BaseModel):
    name: str
    content: str
    directory: str = ""
    group_id: str = ""


def _check_quota(db: Session, user: User, file_size: int):
    if user.quota_mb <= 0:
        return
    used = db.query(func.sum(FileModel.size)).filter(FileModel.owner_id == user.id).scalar() or 0
    if used + file_size > user.quota_mb * 1024 * 1024:
        raise HTTPException(413, f"存储空间不足（配额 {user.quota_mb}MB）")


_NO_STORE = {"Cache-Control": "no-store"}


def _download_granted(session, now):
    """当前会话是否处于临时下载授权窗口内（单一真源，避免 download 与 status 谓词漂移）。"""
    return bool(session and session.download_granted_until and session.download_granted_until > now)


@router.get("/list")
def list_files(
    directory: str = Query(""),
    group_id: str = Query(""),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    # 按分组筛选：返回该分组下全部文件（跨目录）
    if group_id:
        rows = db.query(FileModel).filter(
            FileModel.owner_id == user.id, FileModel.group_id == group_id
        ).order_by(FileModel.uploaded_at.desc()).all()
        group_map = {}
        g = db.query(FileGroup).filter_by(owner_id=user.id).all()
        for grp in g:
            group_map[grp.id] = grp.name
        items = []
        for f in rows:
            items.append({
                "name": f.name, "path": f.path, "is_dir": False,
                "size": f.size,
                "modified": f.modified_at.timestamp() if f.modified_at else 0,
                "guard_status": f.guard_status or "safe",
                "file_id": f.id, "group_id": f.group_id or "",
                "group_name": group_map.get(f.group_id, "") if f.group_id else "",
            })
        return {"directory": directory or "/", "group_id": group_id, "items": items}

    items = storage.list_directory(user.id, directory)
    group_map = {}
    for grp in db.query(FileGroup).filter_by(owner_id=user.id).all():
        group_map[grp.id] = grp.name
    for item in items:
        if not item["is_dir"]:
            f = db.query(FileModel).filter_by(owner_id=user.id, path=item["path"]).first()
            if f:
                item["guard_status"] = f.guard_status
                item["file_id"] = f.id
                item["group_id"] = f.group_id or ""
                item["group_name"] = group_map.get(f.group_id, "") if f.group_id else ""
            else:
                item["guard_status"] = "safe"
                item["file_id"] = None
                item["group_id"] = ""
                item["group_name"] = ""
        else:
            item["guard_status"] = ""
            item["file_id"] = None
            item["group_id"] = ""
            item["group_name"] = ""
    return {"directory": directory or "/", "items": items}


@router.post("/upload")
async def upload_file(
    file: UploadFile = FAFile(...),
    directory: str = Query(""),
    source: str = Query("manual"),
    skip_guard: bool = Query(False),
    group_id: str = Query(""),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    # 校验分组归属
    if group_id:
        grp = db.query(FileGroup).filter_by(id=group_id, owner_id=user.id).first()
        if not grp:
            raise HTTPException(404, "分组不存在")
    rel_path = f"{directory}/{file.filename}" if directory else file.filename

    # Guard
    status, reason = guard.check_filename(rel_path)
    if status == "blocked":
        raise HTTPException(403, f"Guard 拦截: {reason}")

    # 配额预估
    _check_quota(db, user, 0)  # 先检查是否有配额（size 未知时放宽）

    meta = storage.save_fileobj(user.id, rel_path, file.file, source=source)

    # 配额精确检查
    _check_quota(db, user, meta["size"])

    # 自动去重：相同 content_hash 的文件不重复入库
    dup = db.query(FileModel).filter(
        FileModel.owner_id == user.id,
        FileModel.content_hash == meta["content_hash"],
        FileModel.path != meta["path"],
    ).first()
    if dup:
        storage.delete_file(user.id, rel_path)
        raise HTTPException(409, f"文件内容已存在（重复）: {dup.path}")

    c_status, c_reason = guard.check_content(user.id, rel_path, direction="upload")
    if c_status == "blocked" and not skip_guard:
        storage.delete_file(user.id, rel_path)
        raise HTTPException(403, f"Guard 拦截: {c_reason}")

    final_status = c_status if c_status != "safe" else status
    final_reason = c_reason if c_reason else reason
    existing = db.query(FileModel).filter_by(owner_id=user.id, path=meta["path"]).first()
    if existing:
        existing.size = meta["size"]
        existing.content_hash = meta["content_hash"]
        existing.modified_at = datetime.utcnow()
        existing.guard_status = final_status
        existing.guard_reason = final_reason
        existing.group_id = group_id or None
        f = existing
    else:
        f = FileModel(
            owner_id=user.id, path=meta["path"], name=meta["name"], size=meta["size"],
            content_hash=meta["content_hash"], mime_type=meta["mime_type"],
            source=source, guard_status=final_status, guard_reason=final_reason,
            group_id=group_id or None,
        )
        db.add(f)
    db.commit()
    db.refresh(f)

    try:
        indexer.index_file(user.id, f.id, rel_path)
    except Exception:
        pass

    db.add(SyncEvent(user_id=user.id, file_id=f.id, file_name=rel_path, direction="upload", status="completed"))
    db.commit()
    db.add(AccessLog(user_id=user.id, action="file_upload", detail=rel_path))
    db.commit()

    return {
        "id": f.id, "path": f.path, "name": f.name, "size": f.size,
        "guard_status": f.guard_status, "guard_reason": f.guard_reason,
        "message": "上传成功",
    }


@router.post("/note")
def create_note(
    req: NoteRequest,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """以笔记形式创建文件（写入文本内容落盘为 .md 文件），不必上传。

    与上传走同一入库流程：配额、Guard（文件名 + 内容）、去重、索引、同步事件。
    """
    # 校验分组归属
    if req.group_id:
        grp = db.query(FileGroup).filter_by(id=req.group_id, owner_id=user.id).first()
        if not grp:
            raise HTTPException(404, "分组不存在")

    # 笔记文件名：仅取文件名部分（禁止穿越），无扩展名则补 .md
    raw_name = (req.name or "").strip().replace("\\", "/").split("/")[-1].strip()
    if not raw_name:
        raw_name = "未命名笔记"
    if "." not in raw_name or raw_name.rsplit(".", 1)[-1].lower() not in {
        "md", "txt", "markdown", "rst",
    }:
        raw_name = raw_name + ".md"
    rel_path = f"{req.directory}/{raw_name}" if req.directory else raw_name

    # Guard - 文件名
    status, reason = guard.check_filename(rel_path)
    if status == "blocked":
        raise HTTPException(403, f"Guard 拦截: {reason}")

    content = req.content or ""
    if not content.strip():
        raise HTTPException(400, "内容不能为空")
    content_bytes = content.encode("utf-8")
    if len(content_bytes) > 5 * 1024 * 1024:
        raise HTTPException(400, "笔记内容不能超过 5MB")

    # 配额预检：笔记字节数已知，直接按真实大小预估，避免写盘后才超配额
    _check_quota(db, user, len(content_bytes))

    meta = storage.save_file(user.id, rel_path, content_bytes, source="note")

    # 配额精确检查
    try:
        _check_quota(db, user, meta["size"])
    except HTTPException:
        storage.delete_file(user.id, rel_path)
        raise

    # 自动去重
    dup = db.query(FileModel).filter(
        FileModel.owner_id == user.id,
        FileModel.content_hash == meta["content_hash"],
        FileModel.path != meta["path"],
    ).first()
    if dup:
        storage.delete_file(user.id, rel_path)
        raise HTTPException(409, f"文件内容已存在（重复）: {dup.path}")

    # Guard - 内容
    c_status, c_reason = guard.check_content(user.id, rel_path, direction="upload")
    if c_status == "blocked":
        storage.delete_file(user.id, rel_path)
        raise HTTPException(403, f"Guard 拦截: {c_reason}")

    final_status = c_status if c_status != "safe" else status
    final_reason = c_reason if c_reason else reason
    existing = db.query(FileModel).filter_by(owner_id=user.id, path=meta["path"]).first()
    if existing:
        existing.size = meta["size"]
        existing.content_hash = meta["content_hash"]
        existing.modified_at = datetime.utcnow()
        existing.guard_status = final_status
        existing.guard_reason = final_reason
        existing.group_id = req.group_id or None
        f = existing
    else:
        f = FileModel(
            owner_id=user.id, path=meta["path"], name=meta["name"], size=meta["size"],
            content_hash=meta["content_hash"], mime_type=meta["mime_type"],
            source="note", guard_status=final_status, guard_reason=final_reason,
            group_id=req.group_id or None,
        )
        db.add(f)
    db.commit()
    db.refresh(f)

    try:
        indexer.index_file(user.id, f.id, rel_path)
    except Exception:
        pass

    db.add(SyncEvent(user_id=user.id, file_id=f.id, file_name=rel_path, direction="upload", status="completed"))
    db.add(AccessLog(user_id=user.id, action="file_note", detail=rel_path))
    db.commit()

    return {
        "id": f.id, "path": f.path, "name": f.name, "size": f.size,
        "guard_status": f.guard_status, "guard_reason": f.guard_reason,
        "message": "笔记已保存",
    }


@router.get("/download")
def download_file(path: str = Query(...), db: Session = Depends(get_db), user=Depends(get_current_user), session=Depends(get_current_session)):
    # 浏览器端下载需开启临时下载窗口；守护进程走 /api/sync/download 不受此限
    if not _download_granted(session, datetime.utcnow()):
        raise HTTPException(403, "未开启临时下载，请到设置页开启")
    f = db.query(FileModel).filter_by(owner_id=user.id, path=path).first()
    try:
        p = storage.read_file(user.id, path)
    except FileNotFoundError:
        raise HTTPException(404, "文件不存在")
    db.add(AccessLog(user_id=user.id, action="file_download", detail=path))
    db.commit()
    return FileResponse(path=str(p), filename=p.name,
                        media_type=f.mime_type if f else "application/octet-stream",
                        headers=_NO_STORE)


# ---- 临时下载授权（浏览器端默认禁下载，主动开启短期窗口）----

@router.post("/download-grant")
def grant_download(request: Request, db: Session = Depends(get_db), user=Depends(get_current_user), session=Depends(get_current_session)):
    """开启当前浏览器会话的临时下载窗口（默认 5 分钟，可配置 DOWNLOAD_GRANT_MINUTES）。"""
    if not session:
        # 旧 token 无 sid / device token / 已吊销会话：401 触发前端刷新续签
        raise HTTPException(401, "登录状态需刷新，请重试")
    until = datetime.utcnow() + timedelta(minutes=settings.DOWNLOAD_GRANT_MINUTES)
    session.download_granted_until = until
    # _log 内部 commit，与授权写入同事务，避免「授权已生效但日志失败返回 500」的不一致
    _log(db, user.id, "download_grant", f"开启临时下载（{settings.DOWNLOAD_GRANT_MINUTES} 分钟）", request)
    return {"granted": True, "until": until.isoformat(), "minutes": settings.DOWNLOAD_GRANT_MINUTES}


@router.post("/download-revoke")
def revoke_download(request: Request, db: Session = Depends(get_db), user=Depends(get_current_user), session=Depends(get_current_session)):
    """手动关闭当前会话的临时下载窗口。"""
    if session and session.download_granted_until:
        session.download_granted_until = None
        _log(db, user.id, "download_revoke", "手动关闭临时下载", request)
    return {"granted": False}


@router.get("/download-status")
def download_status(db: Session = Depends(get_db), user=Depends(get_current_user), session=Depends(get_current_session)):
    """查询当前会话的临时下载状态。"""
    granted = _download_granted(session, datetime.utcnow())
    return {"granted": granted, "until": session.download_granted_until.isoformat() if granted else ""}


@router.get("/preview")
def preview_file(path: str = Query(...), db: Session = Depends(get_db), user=Depends(get_current_user)):
    """以 inline 方式返回文件，供前端预览（图片/视频/音频/PDF 等）。

    HTML/SVG/XML 等可执行类型不支持浏览器预览（避免存储型 XSS，也避免预览触发
    attachment 下载绕过临时下载限制）；请在守护进程设备查看。
    """
    f = db.query(FileModel).filter_by(owner_id=user.id, path=path).first()
    try:
        p = storage.read_file(user.id, path)
    except FileNotFoundError:
        raise HTTPException(404, "文件不存在")
    media_type = f.mime_type if f else (mimetypes.guess_type(str(p))[0] or "application/octet-stream")
    if media_type in _UNSAFE_PREVIEW_TYPES:
        raise HTTPException(415, "此类型不支持浏览器预览，请在守护进程设备查看")
    db.add(AccessLog(user_id=user.id, action="file_preview", detail=path))
    db.commit()
    return FileResponse(path=str(p), media_type=media_type, headers=_NO_STORE)


@router.get("/preview-text")
def preview_text(path: str = Query(...), db: Session = Depends(get_db), user=Depends(get_current_user)):
    """返回文本文件内容（限制 1MB），供前端预览代码/文本。"""
    try:
        p = storage.read_file(user.id, path)
    except FileNotFoundError:
        raise HTTPException(404, "文件不存在")
    MAX_CHARS = 1024 * 1024
    size = p.stat().st_size
    truncated = size > MAX_CHARS
    with open(p, "r", encoding="utf-8", errors="replace") as fh:
        content = fh.read(MAX_CHARS)
    db.add(AccessLog(user_id=user.id, action="file_preview", detail=path))
    db.commit()
    return JSONResponse(content={"content": content, "truncated": truncated, "size": size},
                        headers=_NO_STORE)


@router.delete("")
def delete_file(path: str = Query(...), db: Session = Depends(get_db), user=Depends(get_current_user)):
    f = db.query(FileModel).filter_by(owner_id=user.id, path=path).first()
    storage.delete_file(user.id, path)
    indexer.remove_from_index(user.id, path)
    if f:
        db.delete(f)
    db.add(SyncEvent(user_id=user.id, file_name=path, direction="delete", status="completed"))
    db.add(AccessLog(user_id=user.id, action="file_delete", detail=path))
    db.commit()
    return {"message": f"已删除 {path}"}


# ---- 分组管理 ----

@router.get("/groups")
def list_groups(db: Session = Depends(get_db), user=Depends(get_current_user)):
    """列出当前用户的所有分组，含文件数与占用空间。"""
    groups = db.query(FileGroup).filter_by(owner_id=user.id).order_by(FileGroup.created_at.desc()).all()
    result = []
    for g in groups:
        files = db.query(FileModel).filter_by(owner_id=user.id, group_id=g.id).all()
        total_size = sum(f.size for f in files)
        result.append({
            "id": g.id, "name": g.name,
            "file_count": len(files),
            "size": total_size,
            "created_at": str(g.created_at),
            "updated_at": str(g.updated_at),
        })
    return {"groups": result}


@router.post("/groups")
def create_group(req: GroupRequest, db: Session = Depends(get_db), user=Depends(get_current_user)):
    name = (req.name or "").strip()
    if not name:
        raise HTTPException(400, "分组名称不能为空")
    if len(name) > 50:
        raise HTTPException(400, "分组名称过长（最多 50 字符）")
    if db.query(FileGroup).filter_by(owner_id=user.id, name=name).first():
        raise HTTPException(409, "分组名称已存在")
    g = FileGroup(owner_id=user.id, name=name)
    db.add(g)
    db.commit()
    db.refresh(g)
    db.add(AccessLog(user_id=user.id, action="group_create", detail=name))
    db.commit()
    return {"id": g.id, "name": g.name, "message": "分组已创建"}


@router.put("/groups/{group_id}")
def rename_group(group_id: str, req: GroupRequest, db: Session = Depends(get_db), user=Depends(get_current_user)):
    name = (req.name or "").strip()
    if not name:
        raise HTTPException(400, "分组名称不能为空")
    g = db.query(FileGroup).filter_by(id=group_id, owner_id=user.id).first()
    if not g:
        raise HTTPException(404, "分组不存在")
    if db.query(FileGroup).filter_by(owner_id=user.id, name=name).first():
        raise HTTPException(409, "分组名称已存在")
    old_name = g.name
    g.name = name
    g.updated_at = datetime.utcnow()
    db.commit()
    db.add(AccessLog(user_id=user.id, action="group_rename", detail=f"{old_name} -> {name}"))
    db.commit()
    return {"id": g.id, "name": g.name, "message": "分组已重命名"}


@router.delete("/groups/{group_id}")
def delete_group(group_id: str, db: Session = Depends(get_db), user=Depends(get_current_user)):
    g = db.query(FileGroup).filter_by(id=group_id, owner_id=user.id).first()
    if not g:
        raise HTTPException(404, "分组不存在")
    name = g.name
    # 解除该分组下文件的关联（文件保留，仅移出分组）
    db.query(FileModel).filter_by(owner_id=user.id, group_id=group_id).update({FileModel.group_id: None})
    db.delete(g)
    db.commit()
    db.add(AccessLog(user_id=user.id, action="group_delete", detail=name))
    db.commit()
    return {"message": f"分组「{name}」已删除"}


@router.post("/move-to-group")
def move_to_group(
    path: str = Query(...),
    group_id: str = Query(""),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """将文件移入（或移出，group_id 为空时移出）分组。"""
    f = db.query(FileModel).filter_by(owner_id=user.id, path=path).first()
    if not f:
        raise HTTPException(404, "文件不存在")
    if group_id:
        if not db.query(FileGroup).filter_by(id=group_id, owner_id=user.id).first():
            raise HTTPException(404, "分组不存在")
        f.group_id = group_id
    else:
        f.group_id = None
    db.commit()
    db.add(AccessLog(user_id=user.id, action="file_move_group", detail=path))
    db.commit()
    return {"message": "已更新分组", "group_id": f.group_id or ""}


@router.get("/search")
def search_files(q: str = Query(...), limit: int = Query(10), db: Session = Depends(get_db), user=Depends(get_current_user)):
    try:
        results = indexer.semantic_search(user.id, q, n_results=limit)
    except Exception:
        results = _keyword_search(db, user.id, q, limit)
    return {"query": q, "results": results}


@router.get("/stats")
def storage_stats(db: Session = Depends(get_db), user=Depends(get_current_user)):
    files = db.query(FileModel).filter_by(owner_id=user.id).all()
    total_size = sum(f.size for f in files)
    import shutil
    disk = shutil.disk_usage(settings.storage_path)

    return {
        "total_files": len(files),
        "total_size_mb": round(total_size / 1024 / 1024, 2),
        "quota_mb": user.quota_mb,
        "disk": {
            "total_gb": round(disk.total / 1024 / 1024 / 1024, 2),
            "used_gb": round(disk.used / 1024 / 1024 / 1024, 2),
            "free_gb": round(disk.free / 1024 / 1024 / 1024, 2),
        },
    }


@router.post("/index-all")
def index_all_files(db: Session = Depends(get_db), user=Depends(get_current_user)):
    count = indexer.index_all(user.id)
    return {"message": f"已索引 {count} 个文件", "count": count}


def _keyword_search(db: Session, user_id: str, q: str, limit: int) -> list:
    results = db.query(FileModel).filter(
        FileModel.owner_id == user_id, FileModel.name.contains(q)
    ).limit(limit).all()
    return [{"file_id": f.id, "path": f.path, "name": f.name, "score": 1.0} for f in results]
