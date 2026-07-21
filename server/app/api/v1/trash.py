"""v1 回收站端点（类型化契约，走统一回收站服务）。

- GET  /api/v1/trash/items              列表（含剩余保留天数）
- POST /api/v1/trash/{file_id}/restore  恢复（冲突自动重命名）
- DELETE /api/v1/trash/{file_id}        彻底删除
- POST /api/v1/trash/purge-expired      清理过期
"""

from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ...core.errors import AppError, not_found
from ...core.settings_store import get_trash_retention_days
from ...db.models import File as FileModel, AccessLog, get_db
from ...api.auth import get_current_user
from ...services import trash as trash_service
from .schemas import TrashItemOut, RestoredOut, PurgedOut, MessageOut

router = APIRouter(prefix="/trash", tags=["v1-trash"])


@router.get("/items", response_model=list[TrashItemOut])
def v1_trash_items(db: Session = Depends(get_db), user=Depends(get_current_user)):
    rows = (db.query(FileModel)
            .filter(FileModel.owner_id == user.id, FileModel.deleted_at.isnot(None))
            .order_by(FileModel.deleted_at.desc()).all())
    retention = get_trash_retention_days(db)
    now = datetime.utcnow()
    out = []
    for f in rows:
        remaining = retention - (now - f.deleted_at).total_seconds() / 86400 if f.deleted_at else 0
        out.append(TrashItemOut(
            id=f.id, path=f.path, name=f.name, size=f.size,
            deleted_at=f.deleted_at, locked=bool(f.locked_at),
            remaining_days=round(max(0.0, remaining), 2),
        ))
    return out


@router.post("/{file_id}/restore", response_model=RestoredOut)
def v1_trash_restore(file_id: str, db: Session = Depends(get_db), user=Depends(get_current_user)):
    # 复用既有核心逻辑（API 与 Agent 工具共享），错误映射为 v1 错误码
    from ...api.files import restore_trash_file_core
    data = restore_trash_file_core(db, user.id, file_id=file_id)
    if "error" in data:
        detail = {"trash_preview": data["trash_preview"]} if data.get("trash_preview") else {}
        if "配额" in data["error"] or "空间不足" in data["error"]:
            raise AppError("QUOTA_EXCEEDED", data["error"], status=413, detail=detail)
        raise not_found("TRASH_NOT_FOUND", data["error"], **detail)
    db.commit()
    return RestoredOut(path=data["path"], file_id=data["file_id"],
                       renamed=data.get("renamed", False))


@router.delete("/{file_id}", response_model=MessageOut)
def v1_trash_delete(file_id: str, db: Session = Depends(get_db), user=Depends(get_current_user)):
    f = db.query(FileModel).filter(
        FileModel.owner_id == user.id, FileModel.id == file_id,
        FileModel.deleted_at.isnot(None),
    ).first()
    if not f:
        raise not_found("TRASH_NOT_FOUND", "回收站中不存在该文件")
    path = f.path
    trash_service.purge_file(db, user.id, f)
    db.add(AccessLog(user_id=user.id, action="file_purge", detail=f"彻底删除 {path}"))
    db.commit()
    return MessageOut(message="已彻底删除", file_id=file_id)


@router.post("/purge-expired", response_model=PurgedOut)
def v1_trash_purge_expired(db: Session = Depends(get_db), user=Depends(get_current_user)):
    retention = get_trash_retention_days(db)
    purged = trash_service.purge_expired(db, user_id=user.id, retention_days=retention)
    return PurgedOut(purged=purged, retention_days=retention)
