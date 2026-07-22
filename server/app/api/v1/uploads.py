"""v1 入库端点（类型化契约，走统一入库服务）。

- POST /api/v1/uploads   文件上传
- POST /api/v1/notes     笔记创建/编辑

错误直接抛 IngestError（AppError 子类）→ 全局 handler 输出 {code,message,detail}。
"""

from fastapi import APIRouter, Depends, UploadFile, File as FAFile, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ...db.models import get_db
from ...api.auth import get_current_user
from ...services.ingest import ingest_file
from .schemas import IngestOut, FileOut

router = APIRouter(tags=["v1-uploads"])

_NOTE_EXTS = {"md", "txt", "markdown", "rst"}


def normalize_note_name(raw: str) -> str:
    """笔记文件名规范化：仅取文件名部分（禁穿越），无合法扩展名补 .md。"""
    name = (raw or "").strip().replace("\\", "/").split("/")[-1].strip()
    if not name:
        name = "未命名笔记"
    if "." not in name or name.rsplit(".", 1)[-1].lower() not in _NOTE_EXTS:
        name = name + ".md"
    return name


@router.post("/uploads", response_model=IngestOut, status_code=201)
async def v1_upload(
    file: UploadFile = FAFile(...),
    directory: str = Query(""),
    source: str = Query("manual"),
    skip_guard: bool = Query(False),
    group_id: str = Query(""),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    rel_path = f"{directory}/{file.filename}" if directory else file.filename
    outcome = ingest_file(
        db, user, rel_path, fileobj=file.file, source=source,
        skip_content_guard=skip_guard, group_id=group_id,
        access_action="file_upload",
    )
    return IngestOut(file=FileOut.model_validate(outcome.file), message="上传成功")


class NoteIn(BaseModel):
    name: str
    content: str
    directory: str = ""
    group_id: str = ""
    file_id: str = ""


@router.post("/notes", response_model=IngestOut, status_code=201)
def v1_create_note(
    req: NoteIn,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    from ...core.errors import AppError
    from ...db.models import File as FileModel

    content = req.content or ""
    if not content.strip():
        raise AppError("NOTE_EMPTY", "内容不能为空", status=400)
    content_bytes = content.encode("utf-8")
    if len(content_bytes) > 5 * 1024 * 1024:
        raise AppError("NOTE_TOO_LARGE", "笔记内容不能超过 5MB", status=400)

    rel_path = normalize_note_name(req.name)
    if req.directory:
        rel_path = f"{req.directory}/{rel_path}"

    editing = None
    if req.file_id:
        editing = db.query(FileModel).filter(
            FileModel.id == req.file_id, FileModel.owner_id == user.id,
            FileModel.deleted_at.is_(None),
        ).first()

    outcome = ingest_file(
        db, user, rel_path, data=content_bytes, source="note",
        group_id=req.group_id,
        exclude_file_id=editing.id if editing else "",
        update_file_id=editing.id if editing else "",
        access_action="file_note",
    )
    return IngestOut(file=FileOut.model_validate(outcome.file), message="笔记已保存")
