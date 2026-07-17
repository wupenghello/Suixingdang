"""Agent 工具集（多账户版）：所有工具接收 user_id 做隔离。"""

import json
import logging
from datetime import datetime, timedelta
from pathlib import Path

from ..db.models import File, SyncEvent, AccessToken, TransferMessage, SessionLocal
from ..core import storage, indexer, guard

logger = logging.getLogger(__name__)


def _short(s: str, n: int = 4000) -> str:
    return s[:n] if s else ""


# ---- LLM 调用辅助 ----

def _call_llm(system_prompt: str, user_prompt: str, max_tokens: int = 1024, user_id: str = "") -> str:
    """调用 LLM 生成文本（用于摘要 / QA）。"""
    from ..core.llm_service import get_llm_config
    cfg = get_llm_config(user_id)
    from openai import OpenAI
    client = OpenAI(api_key=cfg.api_key, base_url=cfg.base_url)
    resp = client.chat.completions.create(
        model=cfg.model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.3,
        max_tokens=max_tokens,
    )
    return resp.choices[0].message.content or ""


# ============ 传输助手：列出近期消息（文本便签 + 已入库文件） ============

def list_transfer_messages(user_id: str, limit: int = 20) -> str:
    """列出文件传输助手中最近的消息（文本便签与文件统一时间线）。

    用于回答「传输助手里有什么」「我最近发了什么笔记/文件」类问题；
    与 search_files / qa 的语义检索互补——后者需要关键词，本工具按时间倒序列出。
    """
    db = SessionLocal()
    try:
        rows = (
            db.query(TransferMessage)
            .filter_by(user_id=user_id)
            .order_by(TransferMessage.created_at.desc())
            .limit(min(max(limit, 1), 100))
            .all()
        )
        # 一次性预取所有文件消息关联的 File，避免循环内逐条查询（N+1）
        file_ids = [m.file_id for m in rows if m.type == "file" and m.file_id]
        file_map = (
            {f.id: f for f in db.query(File).filter(File.id.in_(file_ids)).all()}
            if file_ids else {}
        )
        items = []
        for m in reversed(rows):
            if m.type == "text":
                items.append({
                    "type": "text",
                    "message_id": m.id,
                    "content": _short(m.content or "", 500),
                    "created_at": str(m.created_at),
                })
            elif m.type == "file" and m.file_id:
                f = file_map.get(m.file_id)
                if f:
                    items.append({
                        "type": "file",
                        "message_id": m.id,
                        "file_id": f.id,
                        "name": f.name,
                        "path": f.path,
                        "size": f.size,
                        "guard_status": f.guard_status or "safe",
                        "created_at": str(m.created_at),
                    })
        return json.dumps({
            "count": len(items),
            "messages": items,
            "message": f"传输助手最近 {len(items)} 条记录" if items else "传输助手中暂无记录",
        }, ensure_ascii=False)
    finally:
        db.close()


def restore_file(user_id: str, file_id: str = "", file_path: str = "") -> str:
    """从回收站恢复文件至原位置（Agent 调用）。

    优先用 file_id（精准定位）；未提供时按 file_path 在回收站内查找。
    内部直接调用 files 模块的恢复核心，与原 POST /api/files/trash/restore 逻辑一致。
    """
    from ..api.files import restore_trash_file_core
    db = SessionLocal()
    try:
        data = restore_trash_file_core(db, user_id, file_id=file_id, file_path=file_path)
        if "error" not in data:
            db.commit()
        return json.dumps(data, ensure_ascii=False)
    except Exception:
        logger.exception("tool restore_file failed for user %s", user_id)
        return json.dumps({"error": "恢复文件时出错"}, ensure_ascii=False)
    finally:
        db.close()


# ============ 基础文件工具 ============

def search_files(user_id: str, query: str, limit: int = 10) -> str:
    results = indexer.semantic_search(user_id, query, n_results=limit)
    if not results:
        return json.dumps({"results": [], "message": "没有找到匹配的文件"}, ensure_ascii=False)
    return json.dumps({"results": results}, ensure_ascii=False)


def list_files(user_id: str, directory: str = "") -> str:
    items = storage.list_directory(user_id, directory)
    return json.dumps({"directory": directory or "/", "items": items}, ensure_ascii=False)


def get_file_info(user_id: str, file_path: str) -> str:
    db = SessionLocal()
    try:
        f = db.query(File).filter_by(owner_id=user_id, path=file_path).first()
        if f:
            return json.dumps({
                "path": f.path, "name": f.name, "size": f.size,
                "guard_status": f.guard_status, "guard_reason": f.guard_reason,
                "modified_at": str(f.modified_at), "source": f.source,
            }, ensure_ascii=False)
        return json.dumps({"error": "文件未找到"}, ensure_ascii=False)
    finally:
        db.close()


def delete_file(user_id: str, file_path: str, purge: bool = False) -> str:
    """删除文件。

    purge=False(默认):软删除移入回收站,保留期内可恢复;
    purge=True:直接物理清除,不可恢复(仅用于 Agent 明确被要求"彻底删除"的场景)。
    """
    db = SessionLocal()
    try:
        f = db.query(File).filter(
            File.owner_id == user_id, File.path == file_path, File.deleted_at.is_(None),
        ).first()
        if not f:
            raise FileNotFoundError(f"文件不存在: {file_path}")
        if purge:
            # 直接物理清除(不可恢复)
            from ..core import storage, indexer
            storage.delete_file(user_id, file_path)
            try:
                indexer.remove_from_index(user_id, file_path)
            except Exception:
                pass
            db.delete(f)
            db.add(SyncEvent(user_id=user_id, file_name=file_path, direction="delete", status="completed", detail="purge"))
            db.commit()
            return json.dumps({"success": True, "message": f"已彻底删除 {file_path}（不可恢复）", "file_id": f.id}, ensure_ascii=False)
        # 软删除：设 deleted_at + 移除语义索引,保留物理文件与 DB 记录(回收站保留期内可恢复)
        from datetime import datetime
        f.deleted_at = datetime.utcnow()
        # 记录删除时所在目录,恢复时优先归位到此目录(而非根目录)
        try:
            parent = str(Path(file_path).parent)
            f.original_dir = parent if parent != "." else ""
        except Exception:
            pass
        try:
            indexer.remove_from_index(user_id, file_path)
        except Exception:
            pass
        db.add(SyncEvent(user_id=user_id, file_name=file_path, direction="delete", status="completed", detail="soft_delete"))
        db.commit()
        return json.dumps({"success": True, "message": f"已移入回收站 {file_path}（保留 7 天,期间可恢复）", "file_id": f.id}, ensure_ascii=False)
    except Exception:
        logger.exception("tool delete_file failed for user %s path %s", user_id, file_path)
        return json.dumps({"error": "删除文件时出错"}, ensure_ascii=False)
    finally:
        db.close()


def check_guard(user_id: str, file_path: str, direction: str = "") -> str:
    status, reason = guard.guard_file(user_id, file_path, direction=direction)
    risk_map = {"safe": "安全", "warning": "需注意", "blocked": "敏感文件"}
    return json.dumps({
        "file": file_path, "direction": direction or "未指定",
        "risk_level": status, "risk_label": risk_map.get(status, status),
        "reason": reason,
    }, ensure_ascii=False)


# ============ summarize：LLM 驱动的文档摘要 ============

def summarize_file(user_id: str, file_path: str) -> str:
    """提取文件内容并调用 LLM 生成摘要。"""
    text = indexer._extract_text(user_id, file_path)
    if not text:
        return json.dumps({"error": "无法提取文件内容（可能是不支持的格式或空文件）"}, ensure_ascii=False)

    try:
        summary = _call_llm(
            system_prompt="你是一个文档摘要助手。请用简洁的中文总结文档的核心内容，提炼关键信息，分条列出要点。",
            user_prompt=f"请为以下文件内容生成摘要：\n\n文件：{file_path}\n\n内容：\n{_short(text, 8000)}",
            user_id=user_id,
        )
        return json.dumps({
            "file": file_path,
            "length": len(text),
            "summary": summary,
        }, ensure_ascii=False)
    except Exception:
        logger.exception("tool summarize_file failed for user %s path %s", user_id, file_path)
        # LLM 不可用时退回预览
        return json.dumps({
            "file": file_path,
            "length": len(text),
            "summary": f"（LLM 调用失败，返回内容预览）\n{_short(text, 1000)}",
            "error": "摘要生成失败",
        }, ensure_ascii=False)


# ============ qa：基于 RAG 的文件内容问答 ============

def qa(user_id: str, question: str, file_path: str = "") -> str:
    """基于 RAG 的内容问答。

    语义检索相关文件内容，拼入 LLM 上下文回答问题。
    如果指定 file_path，则只针对该文件回答。
    """
    # 限定单文件时直接提取该文件全文
    if file_path:
        text = indexer._extract_text(user_id, file_path)
        if not text:
            return json.dumps({"error": f"无法提取文件内容: {file_path}"}, ensure_ascii=False)
        context = text[:8000]
        sources = [file_path]
    else:
        # 语义检索相关文件
        results = indexer.semantic_search(user_id, question, n_results=5)
        if not results:
            return json.dumps({"answer": "没有找到与问题相关的文件，无法回答。"}, ensure_ascii=False)

        # 拼接相关片段
        context_parts = []
        sources = []
        for r in results:
            path = r.get("path", "")
            snippet = r.get("snippet", "")
            if path:
                # 补充完整文本（如果可提取）
                full = indexer._extract_text(user_id, path)
                context_parts.append(f"【文件: {path}】\n{_short(full or snippet, 2000)}")
                sources.append(path)
            elif snippet:
                context_parts.append(f"【便签片段】\n{_short(snippet, 2000)}")
                sources.append("文字便签")
        context = "\n\n".join(context_parts)[:8000]

    try:
        answer = _call_llm(
            system_prompt=(
                "你是随行档的 AI 文件助手。请根据以下检索到的文件内容回答用户的问题。"
                "如果内容中没有相关信息，请明确说明。回答要简洁准确，引用来源文件名。"
            ),
            user_prompt=(
                f"参考文件内容：\n{context}\n\n"
                f"用户问题：{question}"
            ),
            max_tokens=1500,
            user_id=user_id,
        )
        return json.dumps({
            "answer": answer,
            "sources": sources,
        }, ensure_ascii=False)
    except Exception:
        logger.exception("tool qa failed for user %s", user_id)
        return json.dumps({"error": "问答服务暂时不可用，请稍后重试", "sources": sources}, ensure_ascii=False)


# ============ sync：同步状态与推送意图 ============

def sync(user_id: str, action: str = "status", file_path: str = "") -> str:
    """管理同步状态。

    action：
      - "status"：返回同步统计与最近事件
      - "pending"：列出仅在服务器上、尚未被守护进程拉取的文件
      - "push"：为指定文件创建同步推送事件（守护进程轮询时感知）
    """
    db = SessionLocal()
    try:
        if action == "status":
            total = db.query(SyncEvent).filter_by(user_id=user_id).count()
            failed = db.query(SyncEvent).filter_by(user_id=user_id, status="failed").count()
            latest = db.query(SyncEvent).filter_by(user_id=user_id).order_by(
                SyncEvent.created_at.desc()).first()
            return json.dumps({
                "total_events": total,
                "failed_events": failed,
                "last_sync": str(latest.created_at) if latest else None,
            }, ensure_ascii=False)

        if action == "pending":
            # 列出服务器上所有文件，用户可据此判断哪些还没同步到本地
            files = db.query(File).filter_by(owner_id=user_id).order_by(
                File.modified_at.desc()).limit(50).all()
            return json.dumps({
                "files_on_server": [
                    {"path": f.path, "name": f.name, "size": f.size,
                     "modified_at": str(f.modified_at), "source": f.source}
                    for f in files
                ],
                "message": f"服务器上有 {len(files)} 个文件。守护进程会自动轮询同步。",
            }, ensure_ascii=False)

        if action == "push":
            if not file_path:
                return json.dumps({"error": "push 需要指定 file_path"}, ensure_ascii=False)
            f = db.query(File).filter_by(owner_id=user_id, path=file_path).first()
            if not f:
                return json.dumps({"error": f"文件不存在: {file_path}"}, ensure_ascii=False)
            # 创建推送事件，守护进程轮询时可以读取
            db.add(SyncEvent(
                user_id=user_id, file_id=f.id, file_name=file_path,
                direction="server_to_home", status="pending",
                detail="agent push request",
            ))
            db.commit()
            return json.dumps({
                "success": True,
                "message": f"已为 {file_path} 创建同步推送请求，守护进程将在下次轮询时拉取。",
            }, ensure_ascii=False)

        return json.dumps({"error": f"未知 action: {action}"}, ensure_ascii=False)
    finally:
        db.close()


# ============ cleanup_assistant：离职清理助手 ============

def cleanup_assistant(user_id: str) -> str:
    """离职清理助手：检查设备令牌、敏感文件，给出清理建议。"""
    db = SessionLocal()
    try:
        # 活跃设备令牌
        tokens = db.query(AccessToken).filter_by(
            user_id=user_id, revoked=False
        ).order_by(AccessToken.created_at.desc()).all()
        token_list = [{
            "label": t.label, "created_at": str(t.created_at),
            "last_used_at": str(t.last_used_at) if t.last_used_at else "",
            "expires_at": str(t.expires_at) if t.expires_at else "",
        } for t in tokens]

        # 敏感文件
        files = db.query(File).filter_by(owner_id=user_id).all()
        sensitive = []
        for f in files:
            if f.guard_status in ("warning", "blocked"):
                sensitive.append({
                    "path": f.path, "name": f.name,
                    "guard_status": f.guard_status, "guard_reason": f.guard_reason,
                })

        # 最近修改的文件（可能需要带走或清理）
        recent = db.query(File).filter_by(owner_id=user_id).order_by(
            File.modified_at.desc()).limit(10).all()
        recent_list = [{"path": f.path, "name": f.name, "modified_at": str(f.modified_at)}
                       for f in recent]

        tips = []
        if token_list:
            tips.append(f"你有 {len(token_list)} 个活跃的设备令牌，离职时可在设置页逐个吊销，或让管理员一键吊销全部。")
        if sensitive:
            tips.append(f"发现 {len(sensitive)} 个标记为敏感的文件，建议确认是否需要删除或带走。")
        tips.append("在管理后台点「全部吊销令牌」即可切断所有设备访问，之后只需清理浏览器记录。")

        return json.dumps({
            "active_tokens": token_list,
            "sensitive_files": sensitive,
            "recent_files": recent_list,
            "total_files": len(files),
            "tips": tips,
        }, ensure_ascii=False)
    finally:
        db.close()


# ============ smart_sync_suggestions：智能同步建议 ============

def smart_sync_suggestions(user_id: str) -> str:
    """基于文件使用习惯给出智能同步建议。"""
    db = SessionLocal()
    try:
        now = datetime.utcnow()
        files = db.query(File).filter_by(owner_id=user_id).all()

        # 工作日即将到来（周一前）常用的文件
        recent_7days = [f for f in files if f.modified_at and f.modified_at > now - timedelta(days=7)]
        # 常见办公文件（可能在公司需要）
        office_exts = {".docx", ".xlsx", ".pptx", ".pdf", ".doc", ".xls", ".ppt", ".md", ".txt"}
        work_like = [f for f in recent_7days
                     if any(f.name.lower().endswith(ext) for ext in office_exts)]
        # 长期未用（可归档/删除）
        old = [f for f in files if f.modified_at and f.modified_at < now - timedelta(days=90)]

        suggestions = []
        if work_like:
            suggestions.append({
                "type": "push_to_company",
                "title": "建议提前推送到公司",
                "files": [{"path": f.path, "name": f.name, "modified_at": str(f.modified_at)}
                          for f in work_like[:5]],
                "reason": "这些是你最近 7 天修改的办公文件，可能周一会用到。",
            })
        if old:
            suggestions.append({
                "type": "archive",
                "title": "考虑归档或清理",
                "count": len(old),
                "examples": [{"path": f.path, "name": f.name, "modified_at": str(f.modified_at)}
                             for f in sorted(old, key=lambda x: x.modified_at)[:5]],
                "reason": f"有 {len(old)} 个文件超过 90 天未修改，可考虑归档或删除以释放空间。",
            })

        return json.dumps({
            "suggestions": suggestions,
            "message": "以上建议基于文件修改时间和类型推断，仅供参考。",
        }, ensure_ascii=False)
    finally:
        db.close()


# ============ 同步记录 / 清理建议 / 存储统计 ============

def list_sync_events(user_id: str, limit: int = 20) -> str:
    db = SessionLocal()
    try:
        events = db.query(SyncEvent).filter_by(user_id=user_id).order_by(
            SyncEvent.created_at.desc()).limit(limit).all()
        return json.dumps([{
            "file_name": e.file_name, "direction": e.direction, "status": e.status,
            "detail": e.detail, "time": str(e.created_at),
        } for e in events], ensure_ascii=False)
    finally:
        db.close()


def trash_cleanup_assistant(user_id: str) -> str:
    """回收站清理助手:扫描回收站,按「最旧 / 最大 / 即将过期 / 已锁存」分桶给建议。

    规则扫描,无 LLM 调用(零额外成本)。返回结构化的清理建议。
    """
    db = SessionLocal()
    try:
        from ..db.models import get_trash_retention_days
        rows = db.query(File).filter(
            File.owner_id == user_id, File.deleted_at.isnot(None),
        ).all()
        if not rows:
            return json.dumps({"message": "回收站为空,无需清理", "total": 0, "suggestions": []}, ensure_ascii=False)
        now = datetime.utcnow()
        retention_days = get_trash_retention_days(db)
        locked = [f for f in rows if f.locked_at]
        unlocked = [f for f in rows if not f.locked_at]
        expiring_soon = [f for f in unlocked if f.deleted_at + timedelta(days=retention_days) <= now + timedelta(hours=24)]
        old = sorted(unlocked, key=lambda f: f.deleted_at)[:10]
        largest = sorted(unlocked, key=lambda f: f.size, reverse=True)[:10]
        total_size = sum(f.size for f in rows)

        def _fmt(files):
            return [{"path": f.path, "name": f.name, "size": f.size,
                     "deleted_at": str(f.deleted_at)} for f in files]

        suggestions = []
        if expiring_soon:
            suggestions.append({
                "type": "expiring_soon",
                "title": "即将过期(24 小时内自动永久删除)",
                "files": _fmt(expiring_soon),
                "reason": f"这 {len(expiring_soon)} 个文件将在 24 小时内被自动永久删除,若仍请先恢复或锁存。",
            })
        if old:
            suggestions.append({
                "type": "oldest",
                "title": "最早进入回收站(优先清理)",
                "files": _fmt(old),
                "reason": f"这 {len(old)} 个文件最早进入回收站,可考虑彻底删除以释放空间。",
            })
        if largest:
            suggestions.append({
                "type": "largest",
                "title": "占用空间最大(清理收益最高)",
                "files": _fmt(largest),
                "reason": f"这 {len(largest)} 个文件占用空间最大,彻底删除可显著释放磁盘。",
            })
        return json.dumps({
            "total": len(rows),
            "total_size": total_size,
            "locked_count": len(locked),
            "retention_days": retention_days,
            "suggestions": suggestions,
            "message": f"回收站共 {len(rows)} 个文件(占用 {round(total_size/1024/1024, 2)} MB),锁存 {len(locked)} 个。" + (
                "发现可清理项,建议查看下方" if suggestions else "暂无明显可清理项。"
            ),
        }, ensure_ascii=False)
    finally:
        db.close()


def cleanup_suggestions(user_id: str, days: int = 90) -> str:
    cutoff = datetime.utcnow() - timedelta(days=days)
    db = SessionLocal()
    try:
        old_files = db.query(File).filter(
            File.owner_id == user_id, File.modified_at < cutoff).all()
        result = [{"path": f.path, "name": f.name,
                   "modified_at": str(f.modified_at), "size": f.size} for f in old_files]
        return json.dumps({"threshold_days": days, "count": len(result), "files": result,
                           "message": f"发现 {len(result)} 个超过 {days} 天未修改的文件"},
                          ensure_ascii=False)
    finally:
        db.close()


def get_storage_stats(user_id: str) -> str:
    db = SessionLocal()
    try:
        files = db.query(File).filter_by(owner_id=user_id).all()
        total_size = sum(f.size for f in files)
        return json.dumps({"total_files": len(files),
                           "total_size_mb": round(total_size / 1024 / 1024, 2)},
                          ensure_ascii=False)
    finally:
        db.close()


# ============ 注册表 ============

TOOL_FUNCTIONS = {
    "list_transfer_messages": list_transfer_messages,
    "search_files": search_files,
    "list_files": list_files,
    "get_file_info": get_file_info,
    "delete_file": delete_file,
    "restore_file": restore_file,
    "trash_cleanup_assistant": trash_cleanup_assistant,
    "check_guard": check_guard,
    "summarize_file": summarize_file,
    "qa": qa,
    "sync": sync,
    "list_sync_events": list_sync_events,
    "cleanup_suggestions": cleanup_suggestions,
    "cleanup_assistant": cleanup_assistant,
    "smart_sync_suggestions": smart_sync_suggestions,
    "get_storage_stats": get_storage_stats,
}

TOOL_SCHEMAS = [
    {"type": "function", "function": {"name": "list_transfer_messages", "description": "列出文件传输助手中最近的消息（文本便签与文件，按时间倒序），用于查看传输助手里存了什么", "parameters": {"type": "object", "properties": {"limit": {"type": "integer", "default": 20, "description": "返回条数，最多 100"}}, "required": []}}},
    {"type": "function", "function": {"name": "search_files", "description": "语义搜索文件和文字便签，返回匹配结果及内容片段", "parameters": {"type": "object", "properties": {"query": {"type": "string"}, "limit": {"type": "integer", "default": 10}}, "required": ["query"]}}},
    {"type": "function", "function": {"name": "list_files", "description": "列出目录文件", "parameters": {"type": "object", "properties": {"directory": {"type": "string"}}}}},
    {"type": "function", "function": {"name": "get_file_info", "description": "获取文件详情", "parameters": {"type": "object", "properties": {"file_path": {"type": "string"}}, "required": ["file_path"]}}},
    {"type": "function", "function": {"name": "delete_file", "description": "删除文件。默认 purge=false 软删除移入回收站(保留期内可恢复);purge=true 直接物理清除不可恢复,仅在用户明确要求「彻底删除」时使用。", "parameters": {"type": "object", "properties": {"file_path": {"type": "string"}, "purge": {"type": "boolean", "default": False, "description": "true=直接物理清除不可恢复;false=软删除入回收站(默认)"}}, "required": ["file_path"]}}},
    {"type": "function", "function": {"name": "restore_file", "description": "从回收站恢复文件至原位置。优先传 file_id(从 delete_file 返回或 trash 列表中获取)；也可按原路径 file_path 查找。原路径被占用时自动重命名。", "parameters": {"type": "object", "properties": {"file_id": {"type": "string", "description": "回收站文件的 opaque UUID(优先)"}, "file_path": {"type": "string", "description": "文件的原始路径(备选)"}}, "required": []}}},
    {"type": "function", "function": {"name": "trash_cleanup_assistant", "description": "回收站清理助手:扫描回收站并按「即将过期/最早进入/占用最大」分桶给出清理建议(规则扫描,无 AI 调用)。回答「帮我清理回收站」「我回收站里哪些该删」时调用。", "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {"name": "check_guard", "description": "检查文件敏感度（支持方向感知）", "parameters": {"type": "object", "properties": {"file_path": {"type": "string"}, "direction": {"type": "string", "description": "同步方向: home_to_server / server_to_home / server_to_company / upload，不传则不区分方向"}}, "required": ["file_path"]}}},
    {"type": "function", "function": {"name": "summarize_file", "description": "用 AI 生成文件内容摘要", "parameters": {"type": "object", "properties": {"file_path": {"type": "string"}}, "required": ["file_path"]}}},
    {"type": "function", "function": {"name": "qa", "description": "基于文件内容的问答（RAG 检索相关文件后回答）", "parameters": {"type": "object", "properties": {"question": {"type": "string"}, "file_path": {"type": "string", "description": "可选，指定文件则只针对该文件回答"}}, "required": ["question"]}}},
    {"type": "function", "function": {"name": "sync", "description": "管理同步：查看状态(status)、列出服务器上的文件(pending)、为文件创建推送请求(push)", "parameters": {"type": "object", "properties": {"action": {"type": "string", "enum": ["status", "pending", "push"], "default": "status"}, "file_path": {"type": "string"}}, "required": ["action"]}}},
    {"type": "function", "function": {"name": "list_sync_events", "description": "查看同步记录", "parameters": {"type": "object", "properties": {"limit": {"type": "integer", "default": 20}}}}},
    {"type": "function", "function": {"name": "cleanup_suggestions", "description": "清理建议：找出长期未用的文件", "parameters": {"type": "object", "properties": {"days": {"type": "integer", "default": 90}}}}},
    {"type": "function", "function": {"name": "cleanup_assistant", "description": "离职清理助手：检查设备令牌、敏感文件，给出离职清理建议", "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {"name": "smart_sync_suggestions", "description": "智能同步建议：基于文件修改时间和类型给出推送/归档建议", "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {"name": "get_storage_stats", "description": "存储统计", "parameters": {"type": "object", "properties": {}}}},
]
