"""文件操作 API（多账户版）：所有操作带 owner_id 隔离。"""

from datetime import datetime, timedelta
from pathlib import Path
import mimetypes
import json
import re
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File as FAFile, Query, Request
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy.orm import Session
from sqlalchemy import func

from ..db.models import File as FileModel, FileGroup, SyncEvent, AccessLog, User, AccessToken, get_db
from ..core import storage, indexer, guard
from ..core.security import verify_password
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


def _parse_tags(raw):
    """安全解析 tags/ai_tags JSON 字符串为列表。"""
    if not raw:
        return []
    if isinstance(raw, list):
        return raw
    try:
        v = json.loads(raw)
        return v if isinstance(v, list) else []
    except Exception:
        return []


def _file_meta(f):
    """从 File ORM 对象提取笔记增强字段（标签/置顶/摘要/AI 标签）。"""
    return {
        "tags": _parse_tags(f.tags),
        "pinned": bool(f.pinned),
        "summary": f.summary or "",
        "ai_tags": _parse_tags(f.ai_tags),
    }

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
                **_file_meta(f),
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
                item.update(_file_meta(f))
            else:
                item["guard_status"] = "safe"
                item["file_id"] = None
                item["group_id"] = ""
                item["group_name"] = ""
                item.update({"tags": [], "pinned": False, "summary": "", "ai_tags": []})
        else:
            item["guard_status"] = ""
            item["file_id"] = None
            item["group_id"] = ""
            item["group_name"] = ""
            item.update({"tags": [], "pinned": False, "summary": "", "ai_tags": []})
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


@router.get("/note-content")
def get_note_content(path: str = Query(None), file_id: str = Query(None), db: Session = Depends(get_db), user=Depends(get_current_user)):
    """返回笔记（文本文件）原始内容，供编辑器加载。"""
    path, f = _resolve_file_path(db, user.id, path, file_id)
    try:
        p = storage.read_file(user.id, path)
    except FileNotFoundError:
        raise HTTPException(404, "文件不存在")
    size = p.stat().st_size
    if size > 5 * 1024 * 1024:
        raise HTTPException(413, "文件过大，不支持在线编辑（超过 5MB）")
    with open(p, "r", encoding="utf-8", errors="replace") as fh:
        content = fh.read()
    db.add(AccessLog(user_id=user.id, action="file_preview", detail=path))
    db.commit()
    result = {"content": content, "name": f.name if f else path, "path": path}
    result.update(_file_meta(f) if f else {"tags": [], "pinned": False, "summary": "", "ai_tags": []})
    return result


class RenameRequest(BaseModel):
    path: str
    new_name: str


@router.put("/rename")
def rename_file(req: RenameRequest, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """重命名文件/笔记（保持目录与扩展名逻辑不变）。"""
    new_name = (req.new_name or "").strip().replace("\\", "/").split("/")[-1].strip()
    if not new_name:
        raise HTTPException(400, "新名称不能为空")
    if new_name in {".", ".."} or "/" in new_name:
        raise HTTPException(400, "名称不合法")
    f = db.query(FileModel).filter_by(owner_id=user.id, path=req.path).first()
    if not f:
        raise HTTPException(404, "文件不存在")
    old_path = f.path
    parent = str(Path(req.path).parent) if str(Path(req.path).parent) != "." else ""
    new_path = f"{parent}/{new_name}" if parent else new_name

    # Guard 检查新路径
    status, reason = guard.check_filename(new_path)
    if status == "blocked":
        raise HTTPException(403, f"Guard 拦截: {reason}")

    # 同名冲突
    if new_path != old_path and db.query(FileModel).filter_by(owner_id=user.id, path=new_path).first():
        raise HTTPException(409, "同名文件已存在")

    # 落盘移动：读旧写新再删旧（跨设备安全，且避开 os.rename 对存在目标的行为差异）
    old_p = storage.read_file(user.id, old_path)
    data = old_p.read_bytes()
    storage.save_file(user.id, new_path, data, source=f.source or "manual")
    storage.delete_file(user.id, old_path)
    f.path = new_path
    f.name = new_name
    f.modified_at = datetime.utcnow()
    db.commit()
    db.refresh(f)
    # 重建索引（路径变了）
    try:
        indexer.remove_from_index(user.id, old_path)
        indexer.index_file(user.id, f.id, new_path)
    except Exception:
        pass
    db.add(SyncEvent(user_id=user.id, file_name=f"{old_path} -> {new_path}", direction="rename", status="completed"))
    db.add(AccessLog(user_id=user.id, action="file_rename", detail=f"{old_path} -> {new_path}"))
    db.commit()
    return {"path": new_path, "name": new_name, "message": "已重命名"}


class TagsRequest(BaseModel):
    path: str
    tags: list


@router.put("/tags")
def set_tags(req: TagsRequest, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """设置文件/笔记的标签（整体覆盖）。"""
    f = db.query(FileModel).filter_by(owner_id=user.id, path=req.path).first()
    if not f:
        raise HTTPException(404, "文件不存在")
    # 清洗：去重、去空白、限长、最多 20 个
    seen = set()
    cleaned = []
    for t in req.tags:
        t = str(t).strip()
        if t and t not in seen and len(t) <= 30:
            seen.add(t)
            cleaned.append(t)
        if len(cleaned) >= 20:
            break
    f.tags = json.dumps(cleaned, ensure_ascii=False)
    db.commit()
    return {"path": f.path, "tags": cleaned}


@router.get("/all-tags")
def all_tags(db: Session = Depends(get_db), user=Depends(get_current_user)):
    """聚合当前用户所有标签及其计数，用于标签云。"""
    rows = db.query(FileModel).filter(FileModel.owner_id == user.id).all()
    counter = {}
    for f in rows:
        for t in _parse_tags(f.tags):
            counter[t] = counter.get(t, 0) + 1
    tags = [{"name": k, "count": v} for k, v in sorted(counter.items(), key=lambda x: (-x[1], x[0]))]
    return {"tags": tags}


class PinRequest(BaseModel):
    path: str
    pinned: bool


@router.put("/pin")
def toggle_pin(req: PinRequest, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """置顶/取消置顶文件。"""
    f = db.query(FileModel).filter_by(owner_id=user.id, path=req.path).first()
    if not f:
        raise HTTPException(404, "文件不存在")
    f.pinned = bool(req.pinned)
    db.commit()
    db.add(AccessLog(user_id=user.id, action="file_pin" if req.pinned else "file_unpin", detail=f.path))
    db.commit()
    return {"path": f.path, "pinned": bool(f.pinned)}


@router.post("/ai-enhance")
def ai_enhance(path: str = Query(...), db: Session = Depends(get_db), user=Depends(get_current_user)):
    """对笔记内容调用 LLM 生成摘要与建议标签，结果落库并返回。"""
    from ..core.llm_service import get_llm_config, AiDisabled, NoLlmConfigured
    f = db.query(FileModel).filter_by(owner_id=user.id, path=path).first()
    if not f:
        raise HTTPException(404, "文件不存在")
    try:
        text = indexer._extract_text(user.id, path)
    except Exception:
        text = ""
    if not text:
        raise HTTPException(400, "无法提取内容（空文件或不支持的格式）")
    try:
        cfg = get_llm_config(user.id)
    except (AiDisabled, NoLlmConfigured) as e:
        raise HTTPException(403, str(e))
    from openai import OpenAI
    client = OpenAI(api_key=cfg.api_key, base_url=cfg.base_url)
    snippet = text[:8000]
    prompt = (
        "请阅读以下笔记内容，用中文输出：\n"
        "1. 一句话摘要（不超过 120 字）\n"
        "2. 3-5 个标签（每个标签 2-6 字，反映主题）\n"
        "严格按 JSON 格式返回，不要 markdown 代码块："
        '{"summary":"...","tags":["..."]}'
        f"\n\n笔记内容：\n{snippet}"
    )
    try:
        resp = client.chat.completions.create(
            model=cfg.model,
            messages=[
                {"role": "system", "content": "你是笔记整理助手，擅长提炼摘要和打标签。"},
                {"role": "user", "content": prompt},
            ],
            temperature=0.3,
            max_tokens=512,
        )
        raw = resp.choices[0].message.content or ""
    except Exception as e:
        raise HTTPException(502, f"AI 调用失败: {e}")
    # 容错解析：LLM 可能包代码块或多余文字
    summary = ""
    ai_tags = []
    try:
        m = raw
        if "```" in m:
            m = m.split("```")[1] if m.count("```") >= 2 else m
            m = m.strip("`")
        # 尝试截取第一个 JSON 对象
        start = m.find("{")
        end = m.rfind("}")
        if start >= 0 and end > start:
            m = m[start:end + 1]
        obj = json.loads(m)
        summary = str(obj.get("summary", "")).strip()
        ai_tags = [str(t).strip() for t in obj.get("tags", []) if str(t).strip()]
    except Exception:
        summary = raw.strip()[:200]
    if summary:
        f.summary = summary
    if ai_tags:
        f.ai_tags = json.dumps(ai_tags, ensure_ascii=False)
    db.commit()
    return {"summary": summary, "tags": ai_tags}



def _resolve_file_path(db: Session, user_id: str, path: str = None, file_id: str = None) -> tuple[str, FileModel]:
    """Resolve a file reference to (path, FileModel). Accepts file_id (preferred,
    opaque UUID) or path (legacy). Used by preview/download endpoints so the
    real path never needs to be sent from the browser."""
    if file_id:
        f = db.query(FileModel).filter_by(owner_id=user_id, id=file_id).first()
        if not f:
            raise HTTPException(404, "文件不存在")
        return f.path, f
    if path:
        f = db.query(FileModel).filter_by(owner_id=user_id, path=path).first()
        return path, f
    raise HTTPException(400, "需要提供 path 或 file_id")


@router.get("/download")
def download_file(path: str = Query(None), file_id: str = Query(None), db: Session = Depends(get_db), user=Depends(get_current_user), session=Depends(get_current_session)):
    # Resolve file_id -> path (opaque UUID reference; real path never sent from browser)
    path, f = _resolve_file_path(db, user.id, path, file_id)
    now = datetime.utcnow()
    window_granted = _download_granted(session, now)
    single_granted = bool(session and session.single_download_path and session.single_download_path == path)
    if not window_granted and not single_granted:
        raise HTTPException(403, "未授权下载，请验证密码后重试")
    f = db.query(FileModel).filter_by(owner_id=user.id, path=path).first()
    try:
        p = storage.read_file(user.id, path)
    except FileNotFoundError:
        raise HTTPException(404, "文件不存在")
    # 单次授权：下载完成后立即清除，防止同一授权被复用
    if single_granted and not window_granted:
        session.single_download_path = ""
    db.add(AccessLog(user_id=user.id, action="file_download", detail=path))
    db.commit()
    return FileResponse(path=str(p), filename=p.name,
                        media_type=f.mime_type if f else "application/octet-stream",
                        headers=_NO_STORE)


# ---- 临时下载授权（浏览器端默认禁下载，主动开启短期窗口）----

class DownloadGrantRequest(BaseModel):
    password: str
    minutes: int = 0  # 0=用默认 DOWNLOAD_GRANT_MINUTES；可选 5/15/30


@router.post("/download-grant")
def grant_download(req: DownloadGrantRequest, request: Request, db: Session = Depends(get_db), user=Depends(get_current_user), session=Depends(get_current_session)):
    """验证密码后开启当前浏览器会话的临时下载窗口。"""
    if not session:
        # 旧 token 无 sid / device token / 已吊销会话：401 触发前端刷新续签
        raise HTTPException(401, "登录状态需刷新，请重试")
    if not verify_password(req.password, user.password_hash):
        _log(db, user.id, "download_grant_failed", "密码验证失败", request)
        raise HTTPException(403, "密码错误")
    allowed_minutes = {0: settings.DOWNLOAD_GRANT_MINUTES, 5: 5, 15: 15, 30: 30}
    minutes = allowed_minutes.get(req.minutes, settings.DOWNLOAD_GRANT_MINUTES)
    now = datetime.utcnow()
    until = datetime.utcnow() + timedelta(minutes=settings.DOWNLOAD_GRANT_MINUTES)
    until = now + timedelta(minutes=minutes)
    session.download_granted_until = until
    session.download_granted_at = now
    session.single_download_path = ""  # 切换到窗口模式，清除可能残留的单次授权
    # _log 内部 commit，与授权写入同事务，避免「授权已生效但日志失败返回 500」的不一致
    _log(db, user.id, "download_grant", f"开启临时下载（{minutes} 分钟）", request)
    return {"granted": True, "until": until.isoformat(), "minutes": minutes}


class SingleDownloadRequest(BaseModel):
    password: str
    path: str = ""
    file_id: str = ""


@router.post("/download-grant-single")
def grant_single_download(req: SingleDownloadRequest, request: Request, db: Session = Depends(get_db), user=Depends(get_current_user), session=Depends(get_current_session)):
    """验证密码后授权单次下载指定文件（下载后自动失效）。"""
    if not session:
        raise HTTPException(401, "登录状态需刷新，请重试")
    if not verify_password(req.password, user.password_hash):
        _log(db, user.id, "download_grant_failed", "密码验证失败（单次下载）", request)
        raise HTTPException(403, "密码错误")
    # Resolve file_id -> path (opaque UUID; real path need not come from browser)
    real_path = req.path
    if not real_path and req.file_id:
        f_rec = db.query(FileModel).filter_by(owner_id=user.id, id=req.file_id).first()
        if not f_rec:
            raise HTTPException(404, "文件不存在")
        real_path = f_rec.path
    if not real_path:
        raise HTTPException(400, "需要提供 path 或 file_id")
    # 校验文件归属
    if not db.query(FileModel).filter_by(owner_id=user.id, path=real_path).first():
        raise HTTPException(404, "文件不存在")
    session.single_download_path = real_path
    _log(db, user.id, "download_grant_single", f"授权单次下载 {real_path}", request)
    return {"granted": True, "path": real_path}


@router.post("/download-revoke")
def revoke_download(request: Request, db: Session = Depends(get_db), user=Depends(get_current_user), session=Depends(get_current_session)):
    """手动关闭当前会话的临时下载窗口。"""
    if session:
        changed = False
        if session.download_granted_until:
            session.download_granted_until = None
            session.download_granted_at = None
            changed = True
        if session.single_download_path:
            session.single_download_path = ""
            changed = True
        if changed:
            _log(db, user.id, "download_revoke", "手动关闭临时下载", request)
    return {"granted": False}


@router.get("/download-status")
def download_status(db: Session = Depends(get_db), user=Depends(get_current_user), session=Depends(get_current_session)):
    """查询当前会话的临时下载状态。"""
    granted = _download_granted(session, datetime.utcnow())
    single_path = session.single_download_path if session else ""
    return {
        "granted": granted,
        "until": session.download_granted_until.isoformat() if granted else "",
        "single_path": single_path,
    }


@router.get("/download-history")
def download_history(db: Session = Depends(get_db), user=Depends(get_current_user), session=Depends(get_current_session)):
    """查询本次临时下载窗口内的下载记录。"""
    if not session or not session.download_granted_at:
        return {"files": [], "count": 0}
    logs = db.query(AccessLog).filter(
        AccessLog.user_id == user.id,
        AccessLog.action == "file_download",
        AccessLog.created_at >= session.download_granted_at,
    ).order_by(AccessLog.created_at.desc()).all()
    return {"files": [{"path": l.detail, "time": l.created_at.isoformat()} for l in logs], "count": len(logs)}


@router.get("/preview")
def preview_file(path: str = Query(None), file_id: str = Query(None), db: Session = Depends(get_db), user=Depends(get_current_user)):
    """以 inline 方式返回文件，供前端预览（图片/视频/音频/PDF 等）。

    HTML/SVG/XML 等可执行类型不支持浏览器预览（避免存储型 XSS，也避免预览触发
    attachment 下载绕过临时下载限制）；请在守护进程设备查看。
    """
    path, f = _resolve_file_path(db, user.id, path, file_id)
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
def preview_text(path: str = Query(None), file_id: str = Query(None), db: Session = Depends(get_db), user=Depends(get_current_user)):
    """返回文本文件内容（限制 1MB），供前端预览代码/文本。"""
    path, _f = _resolve_file_path(db, user.id, path, file_id)
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


def _extract_wikilinks(text: str) -> list:
    """从文本中提取 [[wiki link]] 目标名称。"""
    return re.findall(r'\[\[([^\]]+)\]\]', text or "")


@router.get("/backlinks")
def get_backlinks(
    path: str = Query(...),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """查找哪些笔记链接到了指定笔记（反向链接）。

    匹配逻辑：扫描用户所有笔记（source=note）的正文，
    检查是否包含 [[目标笔记名]] 或 [[目标笔记名|别名]] 格式的 wiki link。
    """
    target_name = Path(path).stem  # 去掉扩展名作为 link target
    target_variants = {
        target_name,
        target_name.lower(),
        Path(path).name,        # 也匹配带扩展名的完整文件名
    }

    notes = db.query(FileModel).filter(
        FileModel.owner_id == user.id, FileModel.source == "note",
    ).all()
    backlinks = []
    for f in notes:
        if f.path == path:
            continue
        try:
            p = storage.read_file(user.id, f.path)
            if p.stat().st_size > 2 * 1024 * 1024:
                continue
            content = p.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue
        wikilinks = _extract_wikilinks(content)
        # 检查是否有 wikilink 匹配目标
        for wl in wikilinks:
            wl_name = wl.split("|")[0].split("#")[0].strip()  # 支持 [[name|alias]] 和 [[name#anchor]]
            if wl_name in target_variants or wl_name.lower() in target_variants:
                # 找到匹配行作为上下文
                for line in content.split("\n"):
                    if f"[[{wl}" in line:
                        snippet = line.strip()[:200]
                        break
                else:
                    snippet = ""
                backlinks.append({
                    "file_id": f.id, "path": f.path, "name": f.name,
                    "modified_at": str(f.modified_at) if f.modified_at else "",
                    "snippet": snippet,
                })
                break
    return {"path": path, "backlinks": backlinks}


@router.get("/resolve-wikilink")
def resolve_wikilink(
    name: str = Query(...),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """将 [[wiki link]] 名称解析为实际文件路径。

    查找用户笔记中文件名（不含扩展名）匹配的文件。
    """
    name_clean = name.split("|")[0].split("#")[0].strip()
    name_lower = name_clean.lower()
    # 先精确匹配，再模糊匹配
    exact = db.query(FileModel).filter(
        FileModel.owner_id == user.id,
        FileModel.source == "note",
    ).all()
    for f in exact:
        stem = Path(f.name).stem
        if stem.lower() == name_lower:
            return {"file_id": f.id, "path": f.path, "name": f.name}
    # 模糊匹配（包含关系）
    for f in exact:
        stem = Path(f.name).stem
        if name_lower in stem.lower() or stem.lower() in name_lower:
            return {"file_id": f.id, "path": f.path, "name": f.name}
    raise HTTPException(404, "未找到匹配的笔记")


@router.get("/stats")
def storage_stats(db: Session = Depends(get_db), user=Depends(get_current_user)):
    files = db.query(FileModel).filter_by(owner_id=user.id).all()
    total_size = sum(f.size for f in files)

    return {
        "total_files": len(files),
        "total_size_mb": round(total_size / 1024 / 1024, 2),
        "quota_mb": user.quota_mb,
    }

from fastapi.responses import FileResponse, JSONResponse
from io import BytesIO
import zipfile as _zipfile

@router.post("/index-all")
def index_all_files(db: Session = Depends(get_db), user=Depends(get_current_user)):
    count = indexer.index_all(user.id)
    return {"message": f"已索引 {count} 个文件", "count": count}


@router.get("/export")
def export_files(
    group_id: str = Query("", description="按分组导出，空则导出全部"),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    """批量导出文件为 ZIP（笔记保留 .md 格式，其他文件原样打包）。"""
    query = db.query(FileModel).filter(FileModel.owner_id == user.id)
    if group_id:
        query = query.filter(FileModel.group_id == group_id)
    files = query.all()
    if not files:
        raise HTTPException(404, "没有可导出的文件")

    buf = BytesIO()
    with _zipfile.ZipFile(buf, "w", _zipfile.ZIP_DEFLATED) as zf:
        for f in files:
            try:
                p = storage.read_file(user.id, f.path)
                zf.writestr(f.path, p.read_bytes())
            except Exception:
                continue
    buf.seek(0)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"suixingdang-export-{timestamp}.zip"
    db.add(AccessLog(user_id=user.id, action="file_export", detail=f"导出 {len(files)} 个文件"))
    db.commit()
    return FileResponse(
        buf, media_type="application/zip", filename=filename,
    )


def _keyword_search(db: Session, user_id: str, q: str, limit: int) -> list:
    """关键词搜索：同时匹配文件名和笔记正文内容。

    对于文本类文件（md/txt/markdown/rst），读取内容并返回高亮上下文片段；
    非文本文件仅匹配文件名。
    """
    ql = q.lower()
    matched = {}
    # 1) 文件名匹配
    name_hits = db.query(FileModel).filter(
        FileModel.owner_id == user_id, FileModel.name.ilike(f"%{q}%")
    ).limit(limit * 2).all()
    for f in name_hits:
        matched[f.id] = {
            "file_id": f.id, "path": f.path, "name": f.name, "size": f.size,
            "score": 1.0, "snippet": "",
        }
    # 2) 正文内容匹配（文本/笔记文件）
    text_files = db.query(FileModel).filter(
        FileModel.owner_id == user_id,
        FileModel.source == "note",
    ).limit(200).all()
    for f in text_files:
        if f.id in matched:
            continue
        try:
            p = storage.read_file(user_id, f.path)
            if p.stat().st_size > 2 * 1024 * 1024:
                continue
            content = p.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue
        idx = content.lower().find(ql)
        if idx < 0:
            continue
        start = max(0, idx - 40)
        end = min(len(content), idx + len(q) + 60)
        snippet = content[start:end].replace("\n", " ").strip()
        if start > 0:
            snippet = "…" + snippet
        if end < len(content):
            snippet = snippet + "…"
        matched[f.id] = {
            "file_id": f.id, "path": f.path, "name": f.name, "size": f.size,
            "score": 0.8, "snippet": snippet,
        }
    return list(matched.values())[:limit]
