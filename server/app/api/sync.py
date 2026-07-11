"""同步 API（多账户版）。"""

from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File as FAFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ..db.models import File as FileModel, SyncEvent, get_db
from ..core import storage, indexer, guard
from .auth import get_current_user

router = APIRouter(prefix="/api/sync", tags=["sync"])


@router.post("/upload")
async def sync_upload(
    file: UploadFile = FAFile(...),
    relative_path: str = Query(...),
    source: str = Query("home"),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    # 文件名检查（落盘前）
    status, reason = guard.check_filename(relative_path)
    if status == "blocked":
        db.add(SyncEvent(user_id=user.id, file_name=relative_path, direction="home_to_server", status="failed", detail=f"Guard拦截: {reason}"))
        db.commit()
        raise HTTPException(403, f"Guard 拦截: {reason}")

    meta = storage.save_fileobj(user.id, relative_path, file.file, source=source)

    # 内容检查（落盘后：文件已在磁盘上才能扫描，否则 check_content 永远返回 safe）
    c_status, c_reason = guard.check_content(user.id, relative_path, direction="home_to_server")
    if c_status == "blocked":
        storage.delete_file(user.id, relative_path)
        db.add(SyncEvent(user_id=user.id, file_name=relative_path, direction="home_to_server", status="failed", detail=f"Guard拦截: {c_reason}"))
        db.commit()
        raise HTTPException(403, f"Guard 拦截: {c_reason}")
    final_status = c_status if c_status != "safe" else status
    final_reason = c_reason if c_reason else reason

    # 自动去重：守护进程上传时，若服务器已有相同内容的文件则跳过
    dup = db.query(FileModel).filter(
        FileModel.owner_id == user.id,
        FileModel.content_hash == meta["content_hash"],
        FileModel.path != meta["path"],
    ).first()
    if dup:
        storage.delete_file(user.id, relative_path)
        db.add(SyncEvent(user_id=user.id, file_name=relative_path,
                         direction="home_to_server", status="completed",
                         detail=f"跳过上传: 内容已存在 {dup.path}"))
        db.commit()
        return {"status": "ok", "path": dup.path, "guard_status": final_status, "deduplicated": True}

    existing = db.query(FileModel).filter_by(owner_id=user.id, path=meta["path"]).first()
    if existing:
        existing.size = meta["size"]
        existing.content_hash = meta["content_hash"]
        existing.modified_at = datetime.utcnow()
        existing.source = source
        existing.guard_status = final_status
        existing.guard_reason = final_reason
        f = existing
    else:
        f = FileModel(
            owner_id=user.id, path=meta["path"], name=meta["name"], size=meta["size"],
            content_hash=meta["content_hash"], mime_type=meta["mime_type"],
            source=source, guard_status=final_status, guard_reason=final_reason,
        )
        db.add(f)
    db.commit()
    db.refresh(f)

    try:
        indexer.index_file(user.id, f.id, relative_path)
    except Exception:
        pass

    db.add(SyncEvent(user_id=user.id, file_id=f.id, file_name=relative_path, direction="home_to_server", status="completed"))
    db.commit()
    return {"status": "ok", "path": meta["path"], "guard_status": final_status}


@router.get("/download")
def sync_download(path: str = Query(...), db: Session = Depends(get_db), user=Depends(get_current_user)):
    try:
        p = storage.read_file(user.id, path)
    except FileNotFoundError:
        raise HTTPException(404, "文件不存在")
    db.add(SyncEvent(user_id=user.id, file_name=path, direction="server_to_home", status="completed"))
    db.commit()
    return FileResponse(path=str(p), filename=p.name)


@router.get("/manifest")
def get_manifest(db: Session = Depends(get_db), user=Depends(get_current_user)):
    files = storage.list_all_files(user.id)
    manifest = []
    for rel in files:
        p = storage._user_dir(user.id) / rel
        stat = p.stat()
        manifest.append({"path": rel, "size": stat.st_size, "modified": stat.st_mtime})
    return {"files": manifest}


@router.get("/events")
def sync_events(limit: int = Query(50), db: Session = Depends(get_db), user=Depends(get_current_user)):
    events = db.query(SyncEvent).filter_by(user_id=user.id).order_by(SyncEvent.created_at.desc()).limit(limit).all()
    return {"events": [{
        "id": e.id, "file_name": e.file_name, "direction": e.direction,
        "status": e.status, "detail": e.detail, "time": str(e.created_at),
    } for e in events]}


@router.get("/status")
def sync_status(db: Session = Depends(get_db), user=Depends(get_current_user)):
    total = db.query(SyncEvent).filter_by(user_id=user.id).count()
    failed = db.query(SyncEvent).filter_by(user_id=user.id, status="failed").count()
    latest = db.query(SyncEvent).filter_by(user_id=user.id).order_by(SyncEvent.created_at.desc()).first()
    return {"total_events": total, "failed_events": failed, "last_sync": str(latest.created_at) if latest else None}


@router.post("/delete")
def sync_delete(path: str = Query(...), source: str = Query("home"), db: Session = Depends(get_db), user=Depends(get_current_user)):
    storage.delete_file(user.id, path)
    indexer.remove_from_index(user.id, path)
    f = db.query(FileModel).filter_by(owner_id=user.id, path=path).first()
    if f:
        db.delete(f)
    db.add(SyncEvent(user_id=user.id, file_name=path, direction="delete", status="completed", detail=f"source={source}"))
    db.commit()
    return {"status": "ok"}
