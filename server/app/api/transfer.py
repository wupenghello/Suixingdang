"""文件传输助手 API：文本便签 + 文件自动入库，统一时间线。"""

from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File as FAFile, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel

from ..db.models import (
    TransferMessage, File as FileModel, User, SyncEvent, AccessLog, get_db,
)
from ..core import storage, indexer, guard
from ..services.ingest import ingest_file, IngestError
from .auth import get_current_user

from ..core import mask as M

router = APIRouter(prefix="/transfer", tags=["transfer"])


class TextRequest(BaseModel):
    content: str


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
    """传输助手文件入库。走统一入库管道（services/ingest.py）——
    修复：原实现的配额把回收站文件计入已用空间、去重不排除软删文件。
    """
    rel_path = file.filename or "未命名文件"
    try:
        outcome = ingest_file(
            db, user, rel_path, fileobj=file.file, source="transfer",
            access_action="transfer_file",
        )
    except IngestError as e:
        raise HTTPException(e.status, e.message, headers=e.headers or None)

    # 传输助手时间线记录
    msg = TransferMessage(user_id=user.id, type="file", file_id=outcome.file.id)
    db.add(msg)
    db.commit()
    db.refresh(msg)

    result = _serialize(db, msg)
    result["guard_warning"] = outcome.guard_status == "warning"
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

    # 文件消息：软删除文件库中的文件(进回收站,保留期内可恢复)
    if msg.type == "file" and msg.file_id:
        f = db.query(FileModel).filter_by(id=msg.file_id, owner_id=user.id).first()
        if f:
            f.deleted_at = datetime.utcnow()
            try:
                indexer.remove_from_index(user.id, f.path)
            except Exception:
                pass
            db.add(SyncEvent(user_id=user.id, file_name=f.path, direction="delete", status="completed", detail="soft_delete"))
            db.add(AccessLog(user_id=user.id, action="file_soft_delete", detail=f.path))

    elif msg.type == "text":
        try:
            indexer.remove_text_from_index(user.id, msg.id)
        except Exception:
            pass

    db.delete(msg)
    db.add(AccessLog(user_id=user.id, action="transfer_delete", detail=msg.type))
    db.commit()
    return {"message": "已删除"}
