"""Agent 工具集（多账户版）：所有工具接收 user_id 做隔离。"""

import json
from pathlib import Path

from ..db.models import File, SyncEvent, SessionLocal
from ..core import storage, indexer, guard


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
                "path": f.path, "name": f.name, "size": f.size, "tag": f.tag,
                "guard_status": f.guard_status, "guard_reason": f.guard_reason,
                "modified_at": str(f.modified_at), "source": f.source,
            }, ensure_ascii=False)
        return json.dumps({"error": "文件未找到"}, ensure_ascii=False)
    finally:
        db.close()


def delete_file(user_id: str, file_path: str) -> str:
    db = SessionLocal()
    try:
        f = db.query(File).filter_by(owner_id=user_id, path=file_path).first()
        storage.delete_file(user_id, file_path)
        indexer.remove_from_index(user_id, file_path)
        if f:
            db.delete(f)
        db.add(SyncEvent(user_id=user_id, file_name=file_path, direction="delete", status="completed"))
        db.commit()
        return json.dumps({"success": True, "message": f"已删除 {file_path}"}, ensure_ascii=False)
    except Exception as e:
        return json.dumps({"error": str(e)}, ensure_ascii=False)
    finally:
        db.close()


def check_guard(user_id: str, file_path: str) -> str:
    status, reason = guard.guard_file(user_id, file_path)
    risk_map = {"safe": "安全", "warning": "需注意", "blocked": "敏感文件"}
    return json.dumps({"file": file_path, "risk_level": status, "risk_label": risk_map.get(status, status), "reason": reason}, ensure_ascii=False)


def auto_tag_file(user_id: str, file_path: str) -> str:
    tag = indexer.auto_tag(user_id, file_path)
    db = SessionLocal()
    try:
        f = db.query(File).filter_by(owner_id=user_id, path=file_path).first()
        if f:
            f.tag = tag
            db.commit()
        return json.dumps({"file": file_path, "tag": tag}, ensure_ascii=False)
    finally:
        db.close()


def summarize_file(user_id: str, file_path: str) -> str:
    text = indexer._extract_text(user_id, file_path)
    if not text:
        return json.dumps({"error": "无法提取文件内容"}, ensure_ascii=False)
    return json.dumps({"file": file_path, "length": len(text), "content_preview": text[:3000]}, ensure_ascii=False)


def list_sync_events(user_id: str, limit: int = 20) -> str:
    db = SessionLocal()
    try:
        events = db.query(SyncEvent).filter_by(user_id=user_id).order_by(SyncEvent.created_at.desc()).limit(limit).all()
        return json.dumps([{
            "file_name": e.file_name, "direction": e.direction, "status": e.status,
            "detail": e.detail, "time": str(e.created_at),
        } for e in events], ensure_ascii=False)
    finally:
        db.close()


def cleanup_suggestions(user_id: str, days: int = 90) -> str:
    from datetime import datetime, timedelta
    cutoff = datetime.utcnow() - timedelta(days=days)
    db = SessionLocal()
    try:
        old_files = db.query(File).filter(File.owner_id == user_id, File.modified_at < cutoff).all()
        result = [{"path": f.path, "name": f.name, "tag": f.tag, "modified_at": str(f.modified_at), "size": f.size} for f in old_files]
        return json.dumps({"threshold_days": days, "count": len(result), "files": result, "message": f"发现 {len(result)} 个超过 {days} 天未修改的文件"}, ensure_ascii=False)
    finally:
        db.close()


def get_storage_stats(user_id: str) -> str:
    db = SessionLocal()
    try:
        files = db.query(File).filter_by(owner_id=user_id).all()
        total_size = sum(f.size for f in files)
        tags = {}
        for f in files:
            t = f.tag or "other"
            tags[t] = tags.get(t, 0) + 1
        return json.dumps({"total_files": len(files), "total_size_mb": round(total_size / 1024 / 1024, 2), "by_tag": tags}, ensure_ascii=False)
    finally:
        db.close()


TOOL_FUNCTIONS = {
    "search_files": search_files, "list_files": list_files,
    "get_file_info": get_file_info, "delete_file": delete_file,
    "check_guard": check_guard, "auto_tag_file": auto_tag_file,
    "summarize_file": summarize_file, "list_sync_events": list_sync_events,
    "cleanup_suggestions": cleanup_suggestions, "get_storage_stats": get_storage_stats,
}

TOOL_SCHEMAS = [
    {"type": "function", "function": {"name": "search_files", "description": "语义搜索文件", "parameters": {"type": "object", "properties": {"query": {"type": "string"}, "limit": {"type": "integer", "default": 10}}, "required": ["query"]}}},
    {"type": "function", "function": {"name": "list_files", "description": "列出目录文件", "parameters": {"type": "object", "properties": {"directory": {"type": "string"}}}}},
    {"type": "function", "function": {"name": "get_file_info", "description": "获取文件详情", "parameters": {"type": "object", "properties": {"file_path": {"type": "string"}}, "required": ["file_path"]}}},
    {"type": "function", "function": {"name": "delete_file", "description": "删除文件", "parameters": {"type": "object", "properties": {"file_path": {"type": "string"}}, "required": ["file_path"]}}},
    {"type": "function", "function": {"name": "check_guard", "description": "检查文件敏感度", "parameters": {"type": "object", "properties": {"file_path": {"type": "string"}}, "required": ["file_path"]}}},
    {"type": "function", "function": {"name": "auto_tag_file", "description": "自动分类标签", "parameters": {"type": "object", "properties": {"file_path": {"type": "string"}}, "required": ["file_path"]}}},
    {"type": "function", "function": {"name": "summarize_file", "description": "文件内容摘要", "parameters": {"type": "object", "properties": {"file_path": {"type": "string"}}, "required": ["file_path"]}}},
    {"type": "function", "function": {"name": "list_sync_events", "description": "查看同步记录", "parameters": {"type": "object", "properties": {"limit": {"type": "integer", "default": 20}}}}},
    {"type": "function", "function": {"name": "cleanup_suggestions", "description": "清理建议", "parameters": {"type": "object", "properties": {"days": {"type": "integer", "default": 90}}}}},
    {"type": "function", "function": {"name": "get_storage_stats", "description": "存储统计", "parameters": {"type": "object", "properties": {}}}},
]
