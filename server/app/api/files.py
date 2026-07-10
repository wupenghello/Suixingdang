"""文件操作 API（多账户版）：所有操作带 owner_id 隔离。"""

from datetime import datetime
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File as FAFile, Query
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from sqlalchemy import func

from ..db.models import File as FileModel, SyncEvent, AccessLog, User, get_db
from ..core import storage, indexer, guard
from ..config import settings
from .auth import get_current_user

router = APIRouter(prefix="/api/files", tags=["files"])


def _check_quota(db: Session, user: User, file_size: int):
    if user.quota_mb <= 0:
        return
    used = db.query(func.sum(FileModel.size)).filter(FileModel.owner_id == user.id).scalar() or 0
    if used + file_size > user.quota_mb * 1024 * 1024:
        raise HTTPException(413, f"存储空间不足（配额 {user.quota_mb}MB）")


@router.get("/list")
def list_files(directory: str = Query(""), db: Session = Depends(get_db), user=Depends(get_current_user)):
    items = storage.list_directory(user.id, directory)
    for item in items:
        if not item["is_dir"]:
            f = db.query(FileModel).filter_by(owner_id=user.id, path=item["path"]).first()
            if f:
                item["tag"] = f.tag
                item["guard_status"] = f.guard_status
                item["file_id"] = f.id
            else:
                item["tag"] = ""
                item["guard_status"] = "safe"
                item["file_id"] = None
        else:
            item["tag"] = ""
            item["guard_status"] = ""
            item["file_id"] = None
    return {"directory": directory or "/", "items": items}


@router.post("/upload")
async def upload_file(
    file: UploadFile = FAFile(...),
    directory: str = Query(""),
    source: str = Query("manual"),
    skip_guard: bool = Query(False),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
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

    c_status, c_reason = guard.check_content(user.id, rel_path)
    if c_status == "blocked" and not skip_guard:
        storage.delete_file(user.id, rel_path)
        raise HTTPException(403, f"Guard 拦截: {c_reason}")

    final_status = c_status if c_status != "safe" else status
    final_reason = c_reason if c_reason else reason
    tag = indexer.auto_tag(user.id, rel_path)

    existing = db.query(FileModel).filter_by(owner_id=user.id, path=meta["path"]).first()
    if existing:
        existing.size = meta["size"]
        existing.content_hash = meta["content_hash"]
        existing.modified_at = datetime.utcnow()
        existing.guard_status = final_status
        existing.guard_reason = final_reason
        existing.tag = tag
        f = existing
    else:
        f = FileModel(
            owner_id=user.id, path=meta["path"], name=meta["name"], size=meta["size"],
            content_hash=meta["content_hash"], mime_type=meta["mime_type"],
            source=source, guard_status=final_status, guard_reason=final_reason, tag=tag,
        )
        db.add(f)
    db.commit()
    db.refresh(f)

    try:
        indexer.index_file(user.id, f.id, rel_path, tag)
    except Exception:
        pass

    db.add(SyncEvent(user_id=user.id, file_id=f.id, file_name=rel_path, direction="upload", status="completed"))
    db.commit()
    db.add(AccessLog(user_id=user.id, action="file_upload", detail=rel_path))
    db.commit()

    return {
        "id": f.id, "path": f.path, "name": f.name, "size": f.size,
        "tag": f.tag, "guard_status": f.guard_status, "guard_reason": f.guard_reason,
        "message": "上传成功",
    }


@router.get("/download")
def download_file(path: str = Query(...), db: Session = Depends(get_db), user=Depends(get_current_user)):
    f = db.query(FileModel).filter_by(owner_id=user.id, path=path).first()
    try:
        p = storage.read_file(user.id, path)
    except FileNotFoundError:
        raise HTTPException(404, "文件不存在")
    db.add(AccessLog(user_id=user.id, action="file_download", detail=path))
    db.commit()
    return FileResponse(path=str(p), filename=p.name, media_type=f.mime_type if f else "application/octet-stream")


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
    tags = {}
    for f in files:
        t = f.tag or "other"
        tags[t] = tags.get(t, 0) + 1

    import shutil
    disk = shutil.disk_usage(settings.storage_path)

    return {
        "total_files": len(files),
        "total_size_mb": round(total_size / 1024 / 1024, 2),
        "by_tag": tags,
        "quota_mb": user.quota_mb,
        "disk": {
            "total_gb": round(disk.total / 1024 / 1024 / 1024, 2),
            "used_gb": round(disk.used / 1024 / 1024 / 1024, 2),
            "free_gb": round(disk.free / 1024 / 1024 / 1024, 2),
        },
    }


@router.post("/tag")
def update_tag(path: str = Query(...), tag: str = Query(...), db: Session = Depends(get_db), user=Depends(get_current_user)):
    f = db.query(FileModel).filter_by(owner_id=user.id, path=path).first()
    if not f:
        raise HTTPException(404, "文件不存在")
    f.tag = tag
    db.commit()
    try:
        indexer.index_file(user.id, f.id, f.path, tag)
    except Exception:
        pass
    return {"message": "标签已更新", "tag": tag}


@router.post("/index-all")
def index_all_files(db: Session = Depends(get_db), user=Depends(get_current_user)):
    count = indexer.index_all(user.id)
    return {"message": f"已索引 {count} 个文件", "count": count}


def _keyword_search(db: Session, user_id: str, q: str, limit: int) -> list:
    results = db.query(FileModel).filter(
        FileModel.owner_id == user_id, FileModel.name.contains(q)
    ).limit(limit).all()
    return [{"file_id": f.id, "path": f.path, "name": f.name, "tag": f.tag, "score": 1.0} for f in results]
