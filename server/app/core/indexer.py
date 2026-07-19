"""文件索引与语义搜索（多账户版，按用户隔离 collection）。"""

import hashlib
from pathlib import Path
from typing import Optional

import chromadb

from ..config import settings

_client: Optional[chromadb.ClientAPI] = None
_collections: dict = {}  # user_id -> Collection 缓存

TEXT_EXTENSIONS = {
    ".txt", ".md", ".rst", ".csv", ".json", ".yaml", ".yml",
    ".xml", ".html", ".htm", ".js", ".ts", ".py", ".java",
    ".go", ".rs", ".c", ".cpp", ".h", ".sh", ".sql",
    ".ini", ".cfg", ".conf", ".toml", ".properties", ".log",
    ".tex", ".tsv", ".pdf",
    ".docx", ".doc", ".xlsx", ".xls", ".pptx", ".ppt",
}

def _get_client() -> chromadb.ClientAPI:
    global _client
    if _client is None:
        chroma_path = str(Path(settings.storage_path).parent / "chroma")
        Path(chroma_path).mkdir(parents=True, exist_ok=True)
        _client = chromadb.PersistentClient(path=chroma_path)
    return _client


def _get_embedding_function():
    """根据 EMBEDDING_PROVIDER 配置返回嵌入函数。

    - "default"：ChromaDB 内置的 all-MiniLM-L6-v2（零配置）
    - "openai"：使用 OpenAI Embedding API
    """
    provider = getattr(settings, "EMBEDDING_PROVIDER", "default").lower()
    if provider == "openai":
        try:
            from chromadb.utils import embedding_functions
            # 复用默认大模型的 API Key（不再从 env 读取）
            from .llm_service import get_default_embedding_config
            api_key, _base_url = get_default_embedding_config()
            if not api_key:
                # 尚未配置默认大模型：返回 None 回退到 ChromaDB 内置嵌入，
                # 避免构造一个空 key 的 OpenAIEmbeddingFunction 被 collection 缓存，
                # 导致后续上传/搜索持续 401 直到重启进程。
                return None
            return embedding_functions.OpenAIEmbeddingFunction(
                api_key=api_key,
                model_name=getattr(settings, "OPENAI_EMBEDDING_MODEL", "text-embedding-3-small"),
            )
        except Exception:
            pass  # 回退到默认
    # 默认：ChromaDB 内置嵌入模型
    return None


def _get_collection(user_id: str):
    global _collections
    if user_id not in _collections:
        client = _get_client()
        col_name = f"files_{user_id.replace('-', '_')}"
        _collections[user_id] = client.get_or_create_collection(
            name=col_name,
            metadata={"hnsw:space": "cosine"},
            embedding_function=_get_embedding_function(),
        )
    return _collections[user_id]


def _extract_text(user_id: str, rel_path: str, max_chars: int = 50000) -> str:
    from . import storage
    try:
        p = storage._safe_path(user_id, rel_path)
    except FileNotFoundError:
        return ""  # 路径越界：视作无内容
    if not p.exists():
        return ""
    suffix = p.suffix.lower()
    if suffix in {".txt", ".md", ".rst", ".csv", ".json", ".yaml", ".yml",
                  ".xml", ".html", ".htm", ".js", ".ts", ".py", ".java",
                  ".go", ".rs", ".c", ".cpp", ".h", ".sh", ".sql",
                  ".ini", ".cfg", ".conf", ".toml", ".properties", ".log", ".tsv"}:
        try:
            return p.read_text(encoding="utf-8", errors="ignore")[:max_chars]
        except Exception:
            return ""
    if suffix == ".pdf":
        try:
            import fitz
            doc = fitz.open(str(p))
            text = "".join(page.get_text() for page in doc)
            doc.close()
            return text[:max_chars]
        except Exception:
            return ""
    # Word / Excel / PowerPoint：用 unstructured 解析
    if suffix in {".docx", ".doc", ".xlsx", ".xls", ".pptx", ".ppt"}:
        try:
            from unstructured.partition.auto import partition
            elements = partition(str(p))
            text = "\n".join(str(el) for el in elements)
            return text[:max_chars]
        except Exception:
            return ""
    return ""


def index_file(user_id: str, file_id: str, rel_path: str):
    text = _extract_text(user_id, rel_path)
    name = Path(rel_path).name
    doc_text = f"{name}\n{text}" if text else name
    doc_text = doc_text[:50000]
    doc_id = hashlib.md5(f"{user_id}:{rel_path}".encode()).hexdigest()

    # 取文件修改时间，便于搜索结果按时间排序（与 keyword_search 的 modified 字段对齐）
    modified_at = None
    try:
        from ..db.models import File, SessionLocal
        db = SessionLocal()
        try:
            f = db.query(File).filter_by(id=file_id).first()
            modified_at = f.modified_at.isoformat() if f and f.modified_at else None
        finally:
            db.close()
    except Exception:
        pass

    col = _get_collection(user_id)
    try:
        col.delete(ids=[doc_id])
    except Exception:
        pass
    meta = {"type": "file", "file_id": file_id, "path": rel_path, "name": name}
    if modified_at:
        meta["modified_at"] = modified_at
    col.add(ids=[doc_id], documents=[doc_text], metadatas=[meta])


def remove_from_index(user_id: str, rel_path: str):
    doc_id = hashlib.md5(f"{user_id}:{rel_path}".encode()).hexdigest()
    try:
        _get_collection(user_id).delete(ids=[doc_id])
    except Exception:
        pass


def index_text(user_id: str, message_id: str, content: str):
    """索引文件传输助手的文字便签，使其可被语义搜索命中。"""
    doc_id = hashlib.md5(f"{user_id}:text:{message_id}".encode()).hexdigest()
    doc_text = content[:50000]
    col = _get_collection(user_id)
    try:
        col.delete(ids=[doc_id])
    except Exception:
        pass
    col.add(
        ids=[doc_id], documents=[doc_text],
        metadatas=[{"type": "text", "message_id": message_id, "name": "文字便签"}],
    )


def remove_text_from_index(user_id: str, message_id: str):
    doc_id = hashlib.md5(f"{user_id}:text:{message_id}".encode()).hexdigest()
    try:
        _get_collection(user_id).delete(ids=[doc_id])
    except Exception:
        pass


def _query_snippet(doc: str, query: str, window: int = 120) -> str:
    """返回围绕查询命中的文本窗口；未命中则退回文档前 500 字。

    对齐落地页演示的「…尾款 ¥62,400 应于验收后 15 日内结清…」式命中段落，
    而非机械截取文档头部（doc[:500]）。
    """
    if not doc:
        return ""
    q = (query or "").strip()
    if q:
        idx = doc.lower().find(q.lower())
        if idx < 0:
            # 整句未命中时退到单字符/词片段匹配，取首个命中位置
            for ch in q:
                ci = doc.lower().find(ch.lower())
                if ci >= 0:
                    idx = ci
                    break
        if idx >= 0:
            start = max(0, idx - window // 2)
            end = min(len(doc), idx + len(q) + window // 2)
            return ("…" if start > 0 else "") + doc[start:end] + ("…" if end < len(doc) else "")
    return doc[:500]


def semantic_search(user_id: str, query: str, n_results: int = 10) -> list:
    results = _get_collection(user_id).query(
        query_texts=[query], n_results=n_results,
        include=["documents", "metadatas", "distances"],
    )
    files = []
    if results["ids"] and results["ids"][0]:
        for i, doc_id in enumerate(results["ids"][0]):
            meta = results["metadatas"][0][i] if results["metadatas"] else {}
            dist = results["distances"][0][i] if results["distances"] else 0
            doc = results["documents"][0][i] if results.get("documents") else ""
            score = round(1 - dist, 4)
            if score < 0.1:
                continue  # 相关度阈值：丢弃负分/极低相关，避免空库或无关查询返回垃圾结果
            item_type = meta.get("type", "file")
            item = {
                "type": item_type,
                "name": meta.get("name", ""),
                "score": score,
                "snippet": _query_snippet(doc, query),
            }
            if item_type == "text":
                item["message_id"] = meta.get("message_id")
            else:
                item["file_id"] = meta.get("file_id")
                item["path"] = meta.get("path")
                item["modified"] = meta.get("modified_at")  # ISO 时间字符串，供前端时间排序
            files.append(item)
    return files


def _scan_hash(user_id: str, rel_path: str) -> str:
    """计算扫描入库文件的 sha256，参与去重（对齐上传/同步路径，避免空 hash 漏去重）。"""
    try:
        from . import storage
        p = storage.read_file(user_id, rel_path)
        h = hashlib.sha256()
        with open(p, "rb") as f:
            for chunk in iter(lambda: f.read(65536), b""):
                h.update(chunk)
        return h.hexdigest()
    except Exception:
        return ""


def index_all(user_id: str):
    from . import storage
    from ..db.models import File, SessionLocal
    files = storage.list_all_files(user_id)
    db = SessionLocal()
    try:
        for rel_path in files:
            f = db.query(File).filter_by(owner_id=user_id, path=rel_path).first()
            if not f:
                f = File(
                    owner_id=user_id, path=rel_path, name=Path(rel_path).name,
                    size=storage.get_file_size(user_id, rel_path),
                    content_hash=_scan_hash(user_id, rel_path), source="scan",
                )
                db.add(f)
                db.commit()
                db.refresh(f)
            index_file(user_id, f.id, rel_path)
            f.indexed = True
            db.commit()
    finally:
        db.close()
    return len(files)
