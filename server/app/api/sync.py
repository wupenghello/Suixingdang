"""同步 API（多账户版）。"""

from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File as FAFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ..db.models import File as FileModel, SyncEvent, get_db
from ..core import storage, indexer, guard
from ..services.ingest import ingest_file, IngestError
from .auth import get_current_device_user

router = APIRouter(prefix="/sync", tags=["sync"])


@router.post("/upload")
async def sync_upload(
    file: UploadFile = FAFile(...),
    relative_path: str = Query(...),
    source: str = Query("home"),
    base_hash: str = Query("", description="客户端编辑前文件的 content_hash，用于冲突检测"),
    db: Session = Depends(get_db),
    user=Depends(get_current_device_user),
):
    """守护进程上传。走统一入库管道（services/ingest.py）：
    - 冲突检测（base_hash 与服务器 hash 不一致 → 409 + X-Server-Hash）
    - 去重统一排除回收站文件（修复：软删文件曾阻塞同步）
    - 重复内容 skip 而非报错（dedup="skip"）
    - 同步通道历史不检查配额，保持 check_quota_flag=False
    """
    try:
        outcome = ingest_file(
            db, user, relative_path, fileobj=file.file, source=source,
            base_hash=base_hash, direction="home_to_server",
            event_direction="home_to_server", dedup="skip",
            check_quota_flag=False,
        )
    except IngestError as e:
        if e.code.startswith("GUARD_"):
            db.add(SyncEvent(user_id=user.id, file_name=relative_path,
                             direction="home_to_server", status="failed", detail=e.message))
            db.commit()
        raise HTTPException(e.status, e.message, headers=e.headers or None)

    if outcome.deduplicated:
        db.add(SyncEvent(user_id=user.id, file_name=relative_path,
                         direction="home_to_server", status="completed",
                         detail=f"跳过上传: 内容已存在 {outcome.file.path}"))
        db.commit()
        return {"status": "ok", "path": outcome.file.path,
                "guard_status": outcome.guard_status, "deduplicated": True}
    return {"status": "ok", "path": outcome.file.path, "guard_status": outcome.guard_status}


@router.get("/download")
def sync_download(path: str = Query(...), db: Session = Depends(get_db), user=Depends(get_current_device_user)):
    try:
        p = storage.read_file(user.id, path)
    except FileNotFoundError:
        raise HTTPException(404, "文件不存在")
    db.add(SyncEvent(user_id=user.id, file_name=path, direction="server_to_home", status="completed"))
    db.commit()
    return FileResponse(path=str(p), filename=p.name)


@router.get("/manifest")
def get_manifest(db: Session = Depends(get_db), user=Depends(get_current_device_user)):
    files = storage.list_all_files(user.id)
    # 过滤软删除文件:软删除后物理文件仍保留(回收站保留期内可恢复),
    # 但 manifest 不应暴露已删除文件(守护进程按 manifest 同步)
    active_paths = {f[0] for f in db.query(FileModel.path).filter(
        FileModel.owner_id == user.id, FileModel.deleted_at.is_(None),
    ).all()}
    manifest = []
    for rel in files:
        if rel not in active_paths:
            continue
        p = storage._user_dir(user.id) / rel
        stat = p.stat()
        manifest.append({"path": rel, "size": stat.st_size, "modified": stat.st_mtime})
    return {"files": manifest}


@router.get("/events")
def sync_events(limit: int = Query(50), db: Session = Depends(get_db), user=Depends(get_current_device_user)):
    events = db.query(SyncEvent).filter_by(user_id=user.id).order_by(SyncEvent.created_at.desc()).limit(limit).all()
    return {"events": [{
        "id": e.id, "file_name": e.file_name, "direction": e.direction,
        "status": e.status, "detail": e.detail, "time": str(e.created_at),
    } for e in events]}


@router.get("/status")
def sync_status(db: Session = Depends(get_db), user=Depends(get_current_device_user)):
    total = db.query(SyncEvent).filter_by(user_id=user.id).count()
    failed = db.query(SyncEvent).filter_by(user_id=user.id, status="failed").count()
    latest = db.query(SyncEvent).filter_by(user_id=user.id).order_by(SyncEvent.created_at.desc()).first()
    return {"total_events": total, "failed_events": failed, "last_sync": str(latest.created_at) if latest else None}


@router.post("/delete")
def sync_delete(path: str = Query(...), source: str = Query("home"), db: Session = Depends(get_db), user=Depends(get_current_device_user)):
    storage.delete_file(user.id, path)
    indexer.remove_from_index(user.id, path)
    f = db.query(FileModel).filter_by(owner_id=user.id, path=path).first()
    if f:
        db.delete(f)
    db.add(SyncEvent(user_id=user.id, file_name=path, direction="delete", status="completed", detail=f"source={source}"))
    db.commit()
    return {"status": "ok"}
