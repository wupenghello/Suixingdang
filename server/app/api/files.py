"""文件操作 API（多账户版）：所有操作带 owner_id 隔离。"""

from datetime import datetime, timedelta
from pathlib import Path
import mimetypes
import json
import re
from app.core.text_util import plain_excerpt
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File as FAFile, Query, Request, Body
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy.orm import Session
from sqlalchemy import func

from ..db.models import File as FileModel, FileGroup, SyncEvent, AccessLog, User, AccessToken, get_db, get_trash_retention_days, DEFAULT_TRASH_LOCK_LIMIT, rate_limit_acquire
from ..core import storage, indexer, guard
from ..core.llm_service import chat_complete
from ..config import settings
from ..services.ingest import ingest_file, IngestError
from ..services import trash as trash_service
from .auth import get_current_user, get_current_session, _log, verify_stepup_password
from pydantic import BaseModel

router = APIRouter(prefix="/files", tags=["files"])


# 笔记正文节选缓存：file_id -> (content_hash, modified_ts, snippet)。
# list_notes 每次刷新都跑，命中缓存的笔记跳过磁盘 IO，仅内容变化（content_hash 变）的重读 → 刷新 ~O(变化数) 而非 O(N)。
_snippet_cache = {}


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


def clean_tags(raw, max_len=30, max_count=20):
    """标签清洗：去空白、去重、限长、限量。/tags 与 ai_enhance 共用同一套规则。"""
    seen = set()
    out = []
    for t in raw or []:
        t = str(t).strip()
        if t and t not in seen and len(t) <= max_len:
            seen.add(t)
            out.append(t)
        if len(out) >= max_count:
            break
    return out


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
    file_id: str = ""  # 编辑已有笔记时传入，用于原地更新（含重命名时删旧文件/旧索引）


def _check_quota(db: Session, user: User, file_size: int):
    if user.quota_mb <= 0:
        return
    used = db.query(func.sum(FileModel.size)).filter(
        FileModel.owner_id == user.id, FileModel.deleted_at.is_(None),
    ).scalar() or 0
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
            FileModel.owner_id == user.id, FileModel.group_id == group_id,
            FileModel.deleted_at.is_(None),
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
    # 软删除路径集合：磁盘上仍存在但已进回收站的文件需从活跃列表剔除
    trashed = {r[0] for r in db.query(FileModel.path).filter(
        FileModel.owner_id == user.id, FileModel.deleted_at.isnot(None),
    ).all()}
    filtered = []
    for item in items:
        if not item["is_dir"] and item["path"] in trashed:
            continue  # 已软删除：从活跃列表移除
        filtered.append(item)
        if not item["is_dir"]:
            f = db.query(FileModel).filter(
                FileModel.owner_id == user.id, FileModel.path == item["path"],
                FileModel.deleted_at.is_(None),
            ).first()
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
    return {"directory": directory or "/", "items": filtered}


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
    rel_path = f"{directory}/{file.filename}" if directory else file.filename
    try:
        outcome = ingest_file(
            db, user, rel_path, fileobj=file.file, source=source,
            skip_content_guard=skip_guard, group_id=group_id,
            access_action="file_upload",
        )
    except IngestError as e:
        raise HTTPException(e.status, e.message, headers=e.headers or None)
    f = outcome.file
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

    与上传走同一入库管道（services/ingest.py）：分组校验、配额、Guard（文件名 + 内容）、
    去重、索引、同步事件。路由层只保留笔记特有逻辑：文件名规范化、内容校验、编辑定位。
    """
    # 笔记文件名：仅取文件名部分（禁止穿越），无扩展名则补 .md
    raw_name = (req.name or "").strip().replace("\\", "/").split("/")[-1].strip()
    if not raw_name:
        raw_name = "未命名笔记"
    if "." not in raw_name or raw_name.rsplit(".", 1)[-1].lower() not in {
        "md", "txt", "markdown", "rst",
    }:
        raw_name = raw_name + ".md"
    rel_path = f"{req.directory}/{raw_name}" if req.directory else raw_name

    content = req.content or ""
    if not content.strip():
        raise HTTPException(400, "内容不能为空")
    content_bytes = content.encode("utf-8")
    if len(content_bytes) > 5 * 1024 * 1024:
        raise HTTPException(400, "笔记内容不能超过 5MB")

    # 编辑模式：定位当前用户持有的该笔记（用于原地更新 / 重命名）
    editing = None
    if req.file_id:
        editing = db.query(FileModel).filter(
            FileModel.id == req.file_id, FileModel.owner_id == user.id,
            FileModel.deleted_at.is_(None),
        ).first()

    try:
        outcome = ingest_file(
            db, user, rel_path, data=content_bytes, source="note",
            group_id=req.group_id,
            exclude_file_id=editing.id if editing else "",
            update_file_id=editing.id if editing else "",
            access_action="file_note",
        )
    except IngestError as e:
        raise HTTPException(e.status, e.message, headers=e.headers or None)
    f = outcome.file
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
    result = {"content": content, "name": f.name if f else path, "path": path, "file_id": f.id if f else ""}
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
    f = db.query(FileModel).filter(
        FileModel.owner_id == user.id, FileModel.path == req.path,
        FileModel.deleted_at.is_(None),
    ).first()
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
    if new_path != old_path and db.query(FileModel).filter(
        FileModel.owner_id == user.id, FileModel.path == new_path, FileModel.deleted_at.is_(None),
    ).first():
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
    f = db.query(FileModel).filter(
        FileModel.owner_id == user.id, FileModel.path == req.path,
        FileModel.deleted_at.is_(None),
    ).first()
    if not f:
        raise HTTPException(404, "文件不存在")
    # 清洗：去重、去空白、限长、最多 20 个（与 ai_enhance 同一套 clean_tags）
    cleaned = clean_tags(req.tags)
    f.tags = json.dumps(cleaned, ensure_ascii=False)
    db.commit()
    return {"path": f.path, "tags": cleaned}


@router.get("/all-tags")
def all_tags(db: Session = Depends(get_db), user=Depends(get_current_user)):
    """聚合当前用户所有活跃标签及其计数，用于标签云。"""
    rows = db.query(FileModel).filter(
        FileModel.owner_id == user.id, FileModel.deleted_at.is_(None),
    ).all()
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
    f = db.query(FileModel).filter(
        FileModel.owner_id == user.id, FileModel.path == req.path,
        FileModel.deleted_at.is_(None),
    ).first()
    if not f:
        raise HTTPException(404, "文件不存在")
    f.pinned = bool(req.pinned)
    db.commit()
    db.add(AccessLog(user_id=user.id, action="file_pin" if req.pinned else "file_unpin", detail=f.path))
    db.commit()
    return {"path": f.path, "pinned": bool(f.pinned)}


@router.get("/ai-status")
def ai_status(user=Depends(get_current_user)):
    """轻量探测当前用户 AI 可用性，供前端决定是否展示 AI 入口（不触发 LLM 调用）。"""
    from ..core.llm_service import check_ai_access
    ok, msg = check_ai_access(user.id)
    return {"available": ok, "reason": msg}


@router.post("/ai-enhance")
def ai_enhance(path: str = Query(...), db: Session = Depends(get_db), user=Depends(get_current_user)):
    """对笔记内容调用 LLM 生成摘要与建议标签，结果落库并返回。

    校验顺序：404 文件 → 400 内容 → 403 AI 配置 → 429 限流 → LLM 调用。
    这样 404/400/403 不消耗 LLM 配额；fallback 第 2 次调用前再次限流，
    使「一次点击最多消耗配额等量的 LLM 调用」。每次 LLM 调用 timeout=15s、
    max_retries=0，最坏 primary+fallback ≈ 30s < 前端 AbortController 35s。
    """
    from ..core.llm_service import get_llm_config, AiDisabled, NoLlmConfigured
    import openai

    # 1. 文件存在校验（404）—— 限流之前，避免无效请求消耗 LLM 配额
    f = db.query(FileModel).filter(
        FileModel.owner_id == user.id, FileModel.path == path,
        FileModel.deleted_at.is_(None),
    ).first()
    if not f:
        raise HTTPException(404, "文件不存在")

    # 2. 内容提取（400）
    try:
        text = indexer._extract_text(user.id, path)
    except Exception:
        text = ""
    if not text:
        raise HTTPException(400, "无法提取内容（空文件或不支持的格式）")

    # 3. AI 配置校验（403）
    try:
        cfg = get_llm_config(user.id)
    except (AiDisabled, NoLlmConfigured) as e:
        raise HTTPException(403, str(e))

    # 4. 限流（429）—— 在真正调用 LLM 之前
    locked = rate_limit_acquire(db, key=f"airl:{user.id}", max_requests=10, window=60, lock_seconds=60)
    if locked:
        raise HTTPException(429, f"操作过于频繁，请 {locked} 秒后再试")

    # max_retries=0：不依赖 SDK 内置重试，超时由 chat_complete 的 timeout 控制
    client = openai.OpenAI(api_key=cfg.api_key, base_url=cfg.base_url, max_retries=0)
    snippet = text[:8000]
    primary_messages = [
        {"role": "system", "content": "你是笔记整理专家，擅长提炼摘要和打标签。输出严格 JSON。"},
        {"role": "user", "content": (
            "请阅读以下笔记内容，用中文输出：\n"
            "1. 一句话摘要（不超过 80 字，提炼核心观点或结论，不要复述标题）\n"
            "2. 3-5 个标签（每个 2-6 字，覆盖主题/类型/状态，如「工作」「待办」「技术」「灵感」）\n"
            "严格按 JSON 格式返回，不要 markdown 代码块，不要任何其他文字："
            '{"summary":"...","tags":["..."]}'
            f"\n\n笔记内容：\n{snippet}"
        )},
    ]
    fallback_messages = [
        {"role": "user", "content": f"用中文阅读下面笔记，输出 JSON {{\"summary\":\"80字内摘要\",\"tags\":[\"3-5个2-6字标签\"]}}：\n{snippet}"},
    ]

    # 5. LLM 调用；openai.APIError → 502；其它异常（含 ValueError）冒泡为 500
    try:
        raw = chat_complete(client, cfg.model, primary_messages, timeout=15.0)
        # 空响应兜底：部分模型对冗长中文 prompt 偶发返回空，精简 prompt 重试一次
        if not raw:
            # 第 2 次调用前再 acquire 一次配额（fallback 也算一次 LLM 调用）
            locked = rate_limit_acquire(db, key=f"airl:{user.id}", max_requests=10, window=60, lock_seconds=60)
            if locked:
                raise HTTPException(502, "AI 未返回内容，请稍后重试")
            raw = chat_complete(client, cfg.model, fallback_messages, timeout=15.0)
    except openai.APIError as e:
        raise HTTPException(502, f"AI 调用失败: {e}")
    if not raw:
        raise HTTPException(502, "AI 未返回内容，请重试")

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
        ai_tags = list(obj.get("tags", []))
    except Exception:
        summary = raw.strip()[:200]
    # 标签清洗：去重、限长、限量（复用 clean_tags，AI 建议上限 5 个）
    cleaned_tags = clean_tags(ai_tags, max_count=5)
    if summary:
        f.summary = summary[:300]
    if cleaned_tags:
        f.ai_tags = json.dumps(cleaned_tags, ensure_ascii=False)
    db.commit()
    return {"summary": summary, "tags": cleaned_tags}


@router.get("/notes")
def list_notes(db: Session = Depends(get_db), user=Depends(get_current_user)):
    """列出当前用户所有 .md 笔记（含子目录与分组），pinned 优先、其次 modified_at 倒序。

    /list 仅返回单层目录，会漏掉子目录与其它分组里的笔记；本端点一次性拉齐，
    供前端 renderNotes 使用。只取 source='note' 且未软删除的 markdown 文件。
    """
    ext_cond = (
        FileModel.name.like("%.md")
        | FileModel.name.like("%.markdown")
        | FileModel.name.like("%.mdown")
        | FileModel.name.like("%.mkd")
    )
    rows = db.query(FileModel).filter(
        FileModel.owner_id == user.id,
        FileModel.source == "note",
        FileModel.deleted_at.is_(None),
        ext_cond,
    ).order_by(FileModel.pinned.desc(), FileModel.modified_at.desc()).all()
    group_map = {g.id: g.name for g in db.query(FileGroup).filter_by(owner_id=user.id).all()}
    notes = []
    for f in rows:
        meta = _file_meta(f)
        # 正文节选（摘要回退链第二档）：有 AI 摘要则跳过磁盘 IO；否则按 (content_hash, mtime) 缓存，
        # 仅内容变化的笔记重读磁盘（前 2KB 剥离格式，IO 受限、失败静默为空）
        summary = meta["summary"]
        if summary:
            snippet = ""                       # 前端优先用摘要，跳过磁盘 IO
        else:
            _ck = (f.content_hash, f.modified_at.timestamp() if f.modified_at else 0)
            _hit = _snippet_cache.get(f.id)
            if _hit and _hit[0] == _ck[0] and _hit[1] == _ck[1]:
                snippet = _hit[2]
            else:
                try:
                    _p = storage.read_file(user.id, f.path)
                    with open(_p, "r", encoding="utf-8", errors="replace") as _fh:
                        snippet = plain_excerpt(_fh.read(2048))
                except Exception:
                    snippet = ""
                _snippet_cache[f.id] = (_ck[0], _ck[1], snippet)
        notes.append({
            "file_id": f.id,
            "path": f.path,
            "name": f.name,
            "summary": summary,
            "snippet": snippet,
            "tags": meta["tags"],
            "ai_tags": meta["ai_tags"],
            "pinned": meta["pinned"],
            "modified": f.modified_at.timestamp() if f.modified_at else 0,
            "created": f.uploaded_at.timestamp() if f.uploaded_at else 0,
            "size": f.size,
            "group_id": f.group_id or "",
            "group_name": group_map.get(f.group_id, "") if f.group_id else "",
        })
    return {"notes": notes}


class AiTagsRequest(BaseModel):
    tags: list


@router.post("/ai-tags")
def set_ai_tags(req: AiTagsRequest, path: str = Query(...), db: Session = Depends(get_db), user=Depends(get_current_user)):
    """整体覆盖笔记的 AI 建议标签（owner 隔离，不存在 404）。

    用于前端在「接受/忽略建议标签」后持久化剩余建议，避免重开时被忽略的标签复活。
    """
    f = db.query(FileModel).filter(
        FileModel.owner_id == user.id, FileModel.path == path,
        FileModel.deleted_at.is_(None),
    ).first()
    if not f:
        raise HTTPException(404, "文件不存在")
    cleaned = clean_tags(req.tags)
    f.ai_tags = json.dumps(cleaned, ensure_ascii=False)
    db.commit()
    db.add(AccessLog(user_id=user.id, action="note_ai_tags", detail=path))
    db.commit()
    return {"ok": True, "tags": cleaned}


def _resolve_file_path(db: Session, user_id: str, path: str = None, file_id: str = None) -> tuple[str, FileModel]:
    """Resolve a file reference to (path, FileModel). Accepts file_id (preferred,
    opaque UUID) or path (legacy). Used by preview/download endpoints so the
    real path never needs to be sent from the browser. 仅解析活跃文件（回收站文件不可预览/下载）。"""
    if file_id:
        f = db.query(FileModel).filter(
            FileModel.owner_id == user_id, FileModel.id == file_id,
            FileModel.deleted_at.is_(None),
        ).first()
        if not f:
            raise HTTPException(404, "文件不存在")
        return f.path, f
    if path:
        f = db.query(FileModel).filter(
            FileModel.owner_id == user_id, FileModel.path == path,
            FileModel.deleted_at.is_(None),
        ).first()
        if not f:
            raise HTTPException(404, "文件不存在")
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
    # 统一 stepup 验证（限流 + 审计，与改密/吊销共享猜测预算）
    verify_stepup_password(db, user, req.password, request,
                           action="download-grant", fail_action="download_grant_failed",
                           missing_msg="请输入密码")
    allowed_minutes = {0: settings.DOWNLOAD_GRANT_MINUTES, 5: 5, 15: 15, 30: 30}
    minutes = allowed_minutes.get(req.minutes, settings.DOWNLOAD_GRANT_MINUTES)
    now = datetime.utcnow()
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
    verify_stepup_password(db, user, req.password, request,
                           action="download-grant-single", fail_action="download_grant_failed",
                           missing_msg="请输入密码")
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
    f = db.query(FileModel).filter(
        FileModel.owner_id == user.id, FileModel.path == path,
        FileModel.deleted_at.is_(None),
    ).first()
    if not f:
        raise HTTPException(404, "文件不存在")
    # 软删除：设 deleted_at，从语义索引移除，但保留物理文件与 DB 记录（回收站保留期内可恢复）
    f.deleted_at = datetime.utcnow()
    # 记录删除时所在目录,恢复时优先归位到此目录(而非根目录)
    try:
        parent = str(Path(path).parent)
        f.original_dir = parent if parent != "." else ""
    except Exception:
        pass
    try:
        indexer.remove_from_index(user.id, path)
    except Exception:
        pass
    db.add(SyncEvent(user_id=user.id, file_name=path, direction="delete", status="completed", detail="soft_delete"))
    db.add(AccessLog(user_id=user.id, action="file_soft_delete", detail=path))
    db.commit()
    return {"message": f"已移入回收站 {path}", "file_id": f.id}


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
    f = db.query(FileModel).filter(
        FileModel.owner_id == user.id, FileModel.path == path,
        FileModel.deleted_at.is_(None),
    ).first()
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
        FileModel.deleted_at.is_(None),
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
                # 围绕 wikilink 的上下文窗口（~60 字），对齐落地页反链摘录
                wl_pos = content.find(f"[[{wl}")
                if wl_pos < 0:
                    snippet = ""
                else:
                    _start = max(0, wl_pos - 30)
                    _end = min(len(content), wl_pos + len(wl) + 32)
                    snippet = content[_start:_end].replace("\n", " ").strip()
                    if _start > 0:
                        snippet = "…" + snippet
                    if _end < len(content):
                        snippet = snippet + "…"
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
        FileModel.deleted_at.is_(None),
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
    files = db.query(FileModel).filter(
        FileModel.owner_id == user.id, FileModel.deleted_at.is_(None),
    ).all()
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
    query = db.query(FileModel).filter(
        FileModel.owner_id == user.id, FileModel.deleted_at.is_(None),
    )
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
        FileModel.owner_id == user_id, FileModel.name.ilike(f"%{q}%"),
        FileModel.deleted_at.is_(None),
    ).limit(limit * 2).all()
    for f in name_hits:
        matched[f.id] = {
            "file_id": f.id, "path": f.path, "name": f.name, "size": f.size,
            "score": 1.0, "snippet": "", "modified": f.modified_at.isoformat() if f.modified_at else None,
        }
    # 2) 正文内容匹配（所有文本类文件：md/txt/markdown/rst/text，不限 source）
    _text_exts = ('.md', '.markdown', '.mdown', '.mkd', '.txt', '.rst', '.text')
    _candidates = db.query(FileModel).filter(
        FileModel.owner_id == user_id,
        FileModel.deleted_at.is_(None),
    ).limit(500).all()
    text_files = [f for f in _candidates if f.name.lower().endswith(_text_exts)][:200]
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
            "modified": f.modified_at.isoformat() if f.modified_at else None,
        }
    return list(matched.values())[:limit]


# ================== 回收站 ==================


def _purge_expired(db: Session, user_id: str, retention_days: int) -> int:
    """物理清除某用户超过保留期的回收站文件。返回清除条数。

    实现收敛至 services/trash.py（原 main.py/admin.py 各有一份拷贝）。
    """
    return trash_service.purge_expired(db, user_id=user_id, retention_days=retention_days)


@router.get("/trash")
def trash_list(db: Session = Depends(get_db), user=Depends(get_current_user)):
    """列出当前用户回收站中的文件，按删除时间倒序。"""
    rows = db.query(FileModel).filter(
        FileModel.owner_id == user.id, FileModel.deleted_at.isnot(None),
    ).order_by(FileModel.deleted_at.desc()).all()
    group_map = {}
    for grp in db.query(FileGroup).filter_by(owner_id=user.id).all():
        group_map[grp.id] = grp.name
    retention_days = get_trash_retention_days(db)
    now = datetime.utcnow()
    items = []
    for f in rows:
        remaining = retention_days - (now - f.deleted_at).total_seconds() / 86400
        items.append({
            "file_id": f.id, "name": f.name, "path": f.path, "size": f.size,
            "mime_type": f.mime_type or "application/octet-stream",
            "source": f.source or "manual",
            "group_id": f.group_id or "",
            "group_name": group_map.get(f.group_id, "") if f.group_id else "",
            "deleted_at": f.deleted_at.isoformat(),
            "remaining_days": round(max(remaining, 0), 2),
            "locked": bool(f.locked_at),
            "original_dir": f.original_dir or "",
        })
    return {"items": items, "retention_days": retention_days, "total": len(items)}


@router.get("/trash/stats")
def trash_stats(db: Session = Depends(get_db), user=Depends(get_current_user)):
    """当前用户回收站统计：文件数、占用空间、锁存数、24 小时内将过期数。"""
    rows = db.query(FileModel).filter(
        FileModel.owner_id == user.id, FileModel.deleted_at.isnot(None),
    ).all()
    retention_days = get_trash_retention_days(db)
    now = datetime.utcnow()
    expire_24h_cutoff = now + timedelta(hours=24)
    locked_count = 0
    will_expire_soon = 0
    for f in rows:
        if f.locked_at:
            locked_count += 1
        elif f.deleted_at + timedelta(days=retention_days) <= expire_24h_cutoff:
            will_expire_soon += 1
    return {
        "total": len(rows),
        "total_size": sum(f.size for f in rows),
        "locked_count": locked_count,
        "will_expire_24h": will_expire_soon,
    }


@router.post("/trash/restore")
def trash_restore(file_id: str = Query(...), db: Session = Depends(get_db), user=Depends(get_current_user)):
    """恢复回收站中的文件至原位置。原路径被占用时自动重命名。"""
    data = restore_trash_file_core(db, user.id, file_id=file_id)
    if "error" in data:
        raise HTTPException(404 if "不存在" in data["error"] or "为空" in data["error"] else 400, data["error"])
    db.commit()
    return data


def restore_trash_file_core(db: Session, user_id: str, file_id: str = "", file_path: str = "") -> dict:
    """恢复回收站文件的核心逻辑（供 API 端点与 Agent 工具复用）。

    返回 dict：成功时含 message/path/file_id/renamed；失败时含 error（中文友好描述）。
    调用方负责 commit。
    """
    from ..db.models import User as _User
    f = None
    if file_id:
        f = db.query(FileModel).filter(
            FileModel.owner_id == user_id, FileModel.id == file_id, FileModel.deleted_at.isnot(None),
        ).first()
    elif file_path:
        f = db.query(FileModel).filter(
            FileModel.owner_id == user_id, FileModel.path == file_path, FileModel.deleted_at.isnot(None),
        ).first()
    if not f:
        rows = db.query(FileModel).filter(
            FileModel.owner_id == user_id, FileModel.deleted_at.isnot(None),
        ).order_by(FileModel.deleted_at.desc()).limit(10).all()
        if not rows:
            return {"error": "回收站为空，没有可恢复的文件"}
        hint = ", ".join(r.path for r in rows[:5])
        return {"error": "回收站中未找到该文件", "trash_preview": hint}

    # 配额检查
    user_obj = db.query(_User).filter_by(id=user_id).first()
    if not user_obj:
        raise HTTPException(404, "用户不存在")
    try:
        _check_quota(db, user_obj, f.size)
    except HTTPException as e:
        return {"error": e.detail}

    original_path = f.path
    # 恢复目标路径:优先归位到删除时所在目录(original_dir),否则回到原路径
    restore_dir = (f.original_dir or "").strip()
    target_name = Path(original_path).name
    target_path = f"{restore_dir}/{target_name}" if restore_dir else original_path
    # 若目标路径已被占用(或 original_dir 未记录时回退到原路径仍被占),自动重命名
    if db.query(FileModel).filter(
        FileModel.owner_id == user_id, FileModel.path == target_path, FileModel.deleted_at.is_(None),
    ).first():
        p = Path(target_path)
        stem, suffix = p.stem, p.suffix
        parent = str(p.parent) if str(p.parent) != "." else ""
        for i in range(1, 100):
            cand = f"{stem} (恢复){suffix}" if i == 1 else f"{stem} (恢复 {i}){suffix}"
            new_path = f"{parent}/{cand}" if parent else cand
            if not db.query(FileModel).filter(
                FileModel.owner_id == user_id, FileModel.path == new_path, FileModel.deleted_at.is_(None),
            ).first():
                target_path = new_path
                break
        else:
            return {"error": "原路径附近同名文件过多，请手动清理后重试"}

    f.path = target_path
    f.name = Path(target_path).name
    f.deleted_at = None
    f.modified_at = datetime.utcnow()

    try:
        indexer.index_file(user_id, f.id, target_path)
    except Exception:
        pass

    db.add(AccessLog(user_id=user_id, action="file_restore", detail=f"{f.path}{' (重命名)' if target_path != original_path else ''}"))
    return {"message": "已恢复", "path": f.path, "file_id": f.id, "renamed": target_path != original_path}


@router.delete("/trash")
def trash_purge_one(file_id: str = Query(...), db: Session = Depends(get_db), user=Depends(get_current_user)):
    """彻底删除回收站中的单个文件（物理清除，不可恢复）。"""
    f = db.query(FileModel).filter(
        FileModel.owner_id == user.id, FileModel.id == file_id, FileModel.deleted_at.isnot(None),
    ).first()
    if not f:
        raise HTTPException(404, "回收站中不存在该文件")
    trash_service.purge_file(db, user.id, f)
    db.add(AccessLog(user_id=user.id, action="file_purge", detail=f"彻底删除 {f.path}"))
    db.commit()
    return {"message": "已彻底删除", "file_id": file_id}


@router.post("/trash/purge")
def trash_purge_expired(db: Session = Depends(get_db), user=Depends(get_current_user)):
    """机会性清理当前用户过期的回收站文件（可在读时调用）。返回清理数。"""
    retention_days = get_trash_retention_days(db)
    purged = _purge_expired(db, user.id, retention_days)
    return {"purged": purged, "retention_days": retention_days}


# ---- 回收站增强：锁存 / 批量 / 只读预览 / 清空确认 ----

def _get_trash_file(db: Session, user_id: str, file_id: str) -> FileModel:
    """取当前用户回收站内单个文件,不存在则 404。所有回收站操作共用此入口,守隔离。"""
    f = db.query(FileModel).filter(
        FileModel.owner_id == user_id, FileModel.id == file_id,
        FileModel.deleted_at.isnot(None),
    ).first()
    if not f:
        raise HTTPException(404, "回收站中不存在该文件")
    return f


@router.get("/trash/preview")
def trash_preview(file_id: str = Query(...), db: Session = Depends(get_db), user=Depends(get_current_user)):
    """回收站内只读预览(图片/视频/音频/PDF/文本)。

    与普通预览两点差异：
    1. 以 file_id 在回收站命名空间定位(用 _get_trash_file),而非活跃文件;
    2. HTML/SVG/XML 等可执行类型仍按 _UNSAFE_PREVIEW_TYPES 禁止(防存储型 XSS)。
    """
    f = _get_trash_file(db, user.id, file_id)
    try:
        p = storage.read_file(user.id, f.path)
    except FileNotFoundError:
        raise HTTPException(404, "物理文件已不存在")
    media_type = f.mime_type or mimetypes.guess_type(str(p))[0] or "application/octet-stream"
    if media_type in _UNSAFE_PREVIEW_TYPES:
        raise HTTPException(415, "此类型不支持浏览器预览")
    db.add(AccessLog(user_id=user.id, action="trash_preview", detail=f"[trash] {f.path}"))
    db.commit()
    return FileResponse(path=str(p), media_type=media_type, headers=_NO_STORE)


class TrashLockRequest(BaseModel):
    file_id: str
    locked: bool


@router.post("/trash/lock")
def trash_lock(req: TrashLockRequest, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """锁存/解锁回收站中的单个文件。

    锁存 = 跳出自动清理(手动保护),直到用户解锁。
    单用户锁存上限 DEFAULT_TRASH_LOCK_LIMIT(默认 200),超出应先解锁部分。
    """
    f = _get_trash_file(db, user.id, req.file_id)
    now_locked = bool(f.locked_at)
    if req.locked and not now_locked:
        # 上限校验(不包含本次)
        cur_locked = db.query(FileModel).filter(
            FileModel.owner_id == user.id, FileModel.deleted_at.isnot(None),
            FileModel.locked_at.isnot(None),
        ).count()
        if cur_locked >= DEFAULT_TRASH_LOCK_LIMIT:
            raise HTTPException(409, f"锁存数已达上限 {DEFAULT_TRASH_LOCK_LIMIT},请先解锁部分文件")
        f.locked_at = datetime.utcnow()
        db.add(AccessLog(user_id=user.id, action="file_lock", detail=f.path))
        db.commit()
    elif not req.locked and now_locked:
        f.locked_at = None
        db.add(AccessLog(user_id=user.id, action="file_unlock", detail=f.path))
        db.commit()
    return {"file_id": f.id, "locked": bool(f.locked_at)}


class TrashBatchRequest(BaseModel):
    file_ids: list[str]


@router.post("/trash/restore-batch")
def trash_restore_batch(req: TrashBatchRequest, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """批量恢复回收站文件。逐项执行,部分失败不回滚已成功的项。

    返回每项回执(results)与成功/跳过的汇总(counts)。
    """
    if not req.file_ids or len(req.file_ids) > 200:
        raise HTTPException(400, "file_ids 数量需在 1..200 之间")
    results = []
    ok = 0
    for fid in req.file_ids:
        data = restore_trash_file_core(db, user.id, file_id=fid)
        if "error" in data:
            results.append({"file_id": fid, "ok": False, "error": data["error"]})
        else:
            ok += 1
            results.append({**data, "file_id": fid, "ok": True})
    if ok:
        db.add(AccessLog(user_id=user.id, action="file_batch_restore", detail=f"批量恢复 {ok}/{len(req.file_ids)} 个文件"))
        db.commit()
    return {
        "results": results,
        "succeeded": ok,
        "failed": len(req.file_ids) - ok,
        "total": len(req.file_ids),
    }


@router.post("/trash/purge-batch")
def trash_purge_batch(req: TrashBatchRequest, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """批量彻底删除(物理清除)。已锁存文件一律跳过,不报错但体现在结果中。"""
    if not req.file_ids or len(req.file_ids) > 200:
        raise HTTPException(400, "file_ids 数量需在 1..200 之间")
    results = []
    purged = 0
    skipped_locked = 0
    for fid in req.file_ids:
        f = db.query(FileModel).filter(
            FileModel.owner_id == user.id, FileModel.id == fid,
            FileModel.deleted_at.isnot(None),
        ).first()
        if not f:
            results.append({"file_id": fid, "ok": False, "error": "不存在"})
            continue
        if f.locked_at:
            skipped_locked += 1
            results.append({"file_id": fid, "ok": False, "skipped": True, "error": "已锁存,跳过"})
            continue
        storage.delete_file(user.id, f.path)
        try:
            indexer.remove_from_index(user.id, f.path)
        except Exception:
            pass
        db.delete(f)
        purged += 1
        results.append({"file_id": fid, "ok": True})
    if purged:
        db.add(AccessLog(user_id=user.id, action="file_batch_purge", detail=f"批量彻底删除 {purged} 个文件"))
        db.commit()
    return {"results": results, "succeeded": purged, "skipped_locked": skipped_locked, "total": len(req.file_ids)}


CONFIRM_EMPTY_TOKEN = "永久删除"


@router.delete("/trash/all")
def trash_empty_legacy(confirm: str = Query(""), db: Session = Depends(get_db), user=Depends(get_current_user)):
    """兼容旧版前端 / 测试的清空回收站端点。需传 confirm="永久删除"。

    DELETE 带 body 在部分客户端支持不一,故旧路径改用 Query 参数 confirm;
    新前端推荐使用 POST /trash/empty (JSON body)。
    """
    if confirm != CONFIRM_EMPTY_TOKEN:
        raise HTTPException(400, f"清空回收站需携带 confirm=\"{CONFIRM_EMPTY_TOKEN}\"")
    return _do_trash_empty(db, user.id)


def _do_trash_empty(db: Session, user_id: str) -> dict:
    """清空回收站的实际逻辑(POST /trash/empty 与 DELETE /trash/all 共用)。"""
    rows = db.query(FileModel).filter(
        FileModel.owner_id == user_id, FileModel.deleted_at.isnot(None),
    ).all()
    count = 0
    locked_skipped = 0
    for f in rows:
        if f.locked_at:
            locked_skipped += 1
            continue
        storage.delete_file(user_id, f.path)
        try:
            indexer.remove_from_index(user_id, f.path)
        except Exception:
            pass
        db.delete(f)
        count += 1
    if count:
        db.add(AccessLog(user_id=user_id, action="file_trash_empty", detail=f"清空回收站 {count} 个文件(跳过锁存 {locked_skipped})"))
        db.commit()
    return {
        "message": f"已清空回收站（{count} 个文件）",
        "count": count,
        "locked_skipped": locked_skipped,
    }


@router.post("/trash/empty")
def trash_empty_confirm(confirm: str = Body("", embed=True), db: Session = Depends(get_db), user=Depends(get_current_user)):
    """清空回收站的安全端点。必须传 JSON body {"confirm":"永久删除"}。embed=True 让 FastAPI 从 {"confirm":"..."} 取值。"""
    if confirm != CONFIRM_EMPTY_TOKEN:
        raise HTTPException(400, f"清空回收站需携带 confirm=\"{CONFIRM_EMPTY_TOKEN}\"")
    return _do_trash_empty(db, user.id)
