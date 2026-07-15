"""文件传输助手 API：文本便签 + 文件自动入库，统一时间线。"""

from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File as FAFile, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel

from ..db.models import (
    TransferMessage, File as FileModel, User, SyncEvent, AccessLog, get_db,
)
from ..core import storage, indexer, guard
from .auth import get_current_user

from ..core import mask as M

router = APIRouter(prefix="/api/transfer", tags=["transfer"])


class TextRequest(BaseModel):
    content: str


def _check_quota(db: Session, user: User, file_size: int):
    if user.quota_mb <= 0:
        return
    used = db.query(func.sum(FileModel.size)).filter(FileModel.owner_id == user.id).scalar() or 0
    if used + file_size > user.quota_mb * 1024 * 1024:
        raise HTTPException(413, f"存储空间不足（配额 {user.quota_mb}MB）")


def _serialize(db: Session, msg: TransferMessage) -> dict:
    item = {
        "id": msg.id,
        "type": msg.type,
        "content": msg.content or "",
        "file_id": msg.file_id or "",
        "created_at": str(msg.created_at),
    }
    if msg.type == "file" and msg.file_id:
        f = db.query(FileModel).filter_by(id=msg.file_id).first()
        if f:
           item["file"] = {
               "name": f.name,
               "path": f.path,
                "file_id": f.id,
               "size": f.size,
               "guard_status": f.guard_status or "safe",
               "mime_type": f.mime_type or "",
            }
        else:
            item["file"] = None
    else:
        item["file"] = None
    return item


@router.post("/text")
def send_text(req: TextRequest, db: Session = Depends(get_db), user=Depends(get_current_user)):
    text = (req.content or "").strip()
    if not text:
        raise HTTPException(400, "内容不能为空")
    if len(text) > 5000:
        raise HTTPException(400, "单条文字不能超过 5000 字符")
    msg = TransferMessage(user_id=user.id, type="text", content=text)
    db.add(msg)
    db.add(AccessLog(user_id=user.id, action="transfer_text", detail=text[:80]))
    db.commit()
    db.refresh(msg)
    try:
        indexer.index_text(user.id, msg.id, text)
    except Exception:
        pass
    serialized = _serialize(db, msg)
    return M.mask_transfer_messages([serialized], user.id)[0]


@router.post("/file")
async def send_file(
    file: UploadFile = FAFile(...),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    rel_path = file.filename or "未命名文件"

    # Guard - 文件名
    status, reason = guard.check_filename(rel_path)
    if status == "blocked":
        raise HTTPException(403, f"Guard 拦截: {reason}")

    # 配额预估
    _check_quota(db, user, 0)

    meta = storage.save_fileobj(user.id, rel_path, file.file, source="transfer")

    # 配额精确检查（失败时清理已落盘的文件）
    try:
        _check_quota(db, user, meta["size"])
    except HTTPException:
        storage.delete_file(user.id, rel_path)
        raise

    # 自动去重（DB 查询）
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
        f = existing
    else:
        f = FileModel(
            owner_id=user.id, path=meta["path"], name=meta["name"], size=meta["size"],
            content_hash=meta["content_hash"], mime_type=meta["mime_type"],
            source="transfer", guard_status=final_status, guard_reason=final_reason,
        )
        db.add(f)
    db.commit()
    db.refresh(f)

    # 索引
    try:
        indexer.index_file(user.id, f.id, rel_path)
    except Exception:
        pass

    # 传输助手时间线记录
    msg = TransferMessage(user_id=user.id, type="file", file_id=f.id)
    db.add(msg)
    db.add(SyncEvent(user_id=user.id, file_id=f.id, file_name=rel_path, direction="upload", status="completed"))
    db.add(AccessLog(user_id=user.id, action="transfer_file", detail=rel_path))
    db.commit()
    db.refresh(msg)

    result = _serialize(db, msg)
    result["guard_warning"] = final_status == "warning"
    return M.mask_transfer_messages([result], user.id)[0]


@router.get("/messages")
def list_messages(limit: int = Query(100), db: Session = Depends(get_db), user=Depends(get_current_user)):
    rows = (
        db.query(TransferMessage)
        .filter_by(user_id=user.id)
        .order_by(TransferMessage.created_at.desc())
        .limit(limit)
        .all()
    )
    items = [_serialize(db, m) for m in reversed(rows)]
    items = M.mask_transfer_messages(items, user.id)
    return {"messages": items}


@router.delete("/{message_id}")
def delete_message(message_id: str, db: Session = Depends(get_db), user=Depends(get_current_user)):
    msg = db.query(TransferMessage).filter_by(id=message_id, user_id=user.id).first()
    if not msg:
        raise HTTPException(404, "消息不存在")

    # 文件消息：同时删除文件库中的文件
    if msg.type == "file" and msg.file_id:
        f = db.query(FileModel).filter_by(id=msg.file_id, owner_id=user.id).first()
        if f:
            storage.delete_file(user.id, f.path)
            indexer.remove_from_index(user.id, f.path)
            db.add(SyncEvent(user_id=user.id, file_name=f.path, direction="delete", status="completed"))
            db.delete(f)

    elif msg.type == "text":
        try:
            indexer.remove_text_from_index(user.id, msg.id)
        except Exception:
            pass

    db.delete(msg)
    db.add(AccessLog(user_id=user.id, action="transfer_delete", detail=msg.type))
    db.commit()
    return {"message": "已删除"}
