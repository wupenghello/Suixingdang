"""文件索引与语义搜索（多账户版，按用户隔离 collection）。

S2 起检索改为块级（chunk-level）：长文档分块嵌入，深处内容可被命中
（历史实现整文件单文档，嵌入模型只看文件头）。块管理在
agent_platform/rag/（chunking + ChromaVectorStore + pipeline），
本模块保持对外 API 不变（index_file / semantic_search / index_text …），
供 8 处调用方与前端响应结构无感升级。
"""

import hashlib
import logging
from pathlib import Path
from typing import Optional

import chromadb

from ..config import settings
from ..agent_platform.rag.store import ChromaVectorStore
from ..agent_platform.rag import pipeline

logger = logging.getLogger(__name__)

_client: Optional[chromadb.ClientAPI] = None
_store: Optional[ChromaVectorStore] = None

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
    - "openai"：使用 OpenAI Embedding API（中文场景建议配置 bge-m3 或 text-embedding-3-small）
    """
    provider = getattr(settings, "EMBEDDING_PROVIDER", "default").lower()
    if provider == "openai":
        try:
            from chromadb.utils import embedding_functions
            from .llm_service import get_default_embedding_config
            api_key, _base_url = get_default_embedding_config()
            if not api_key:
                # 尚未配置默认大模型：返回 None 回退到 ChromaDB 内置嵌入，
                # 避免空 key 的 OpenAIEmbeddingFunction 被缓存导致持续 401。
                return None
            return embedding_functions.OpenAIEmbeddingFunction(
                api_key=api_key,
                model_name=getattr(settings, "OPENAI_EMBEDDING_MODEL", "text-embedding-3-small"),
            )
        except Exception as e:
            logger.warning("OpenAI embedding 初始化失败(%s)，回退到 ChromaDB 内置嵌入", e)
    try:
        from chromadb.utils import embedding_functions
        return embedding_functions.DefaultEmbeddingFunction()
    except Exception as e:
        logger.warning("ChromaDB 内置嵌入加载失败(%s)，搜索/索引将不可用", e)
        return None


def _get_store() -> ChromaVectorStore:
    """块级向量存储（collection 结构不变：files_{user_id}，cosine/HNSW）。"""
    global _store
    if _store is None:
        _store = ChromaVectorStore(
            client_factory=_get_client,
            embedding_factory=_get_embedding_function,
        )
    return _store


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
    """索引文件（分块嵌入）。doc_key = file:{rel_path}，重索引自动覆盖旧块。"""
    text = _extract_text(user_id, rel_path)
    name = Path(rel_path).name
    doc_text = f"{name}\n{text}" if text else name

    meta = {"type": "file", "file_id": file_id, "path": rel_path, "name": name}
    # 文件修改时间：供搜索结果按时间排序（与 keyword_search 的 modified 字段对齐）
    try:
        from ..db.models import File, SessionLocal
        db = SessionLocal()
        try:
            f = db.query(File).filter_by(id=file_id).first()
            if f and f.modified_at:
                meta["modified_at"] = f.modified_at.isoformat()
        finally:
            db.close()
    except Exception:
        pass

    try:
        pipeline.index_document(user_id, f"file:{rel_path}", doc_text, meta, store=_get_store())
    except Exception:
        logger.warning("索引失败: user=%s path=%s", user_id, rel_path, exc_info=True)


def remove_from_index(user_id: str, rel_path: str):
    try:
        pipeline.remove_document(user_id, f"file:{rel_path}", store=_get_store())
    except Exception:
        pass


def index_text(user_id: str, message_id: str, content: str):
    """索引文件传输助手的文字便签，使其可被语义搜索命中。"""
    try:
        pipeline.index_document(
            user_id, f"text:{message_id}", content,
            {"type": "text", "message_id": message_id, "name": "文字便签"},
            store=_get_store(),
        )
    except Exception:
        logger.warning("便签索引失败: user=%s msg=%s", user_id, message_id, exc_info=True)


def remove_text_from_index(user_id: str, message_id: str):
    try:
        pipeline.remove_document(user_id, f"text:{message_id}", store=_get_store())
    except Exception:
        pass


def _query_snippet(doc: str, query: str, window: int = 120) -> str:
    """返回围绕查询命中的文本窗口；未命中则退回文档前 500 字。

    块级索引后 doc 即命中块本身，snippet 天然贴近答案段落，
    不再像整文档时代那样机械截取文档头部。
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
    """语义搜索。块级检索后按文档聚合（同一文件取最佳块），响应结构不变。"""
    hits = _get_store().query(user_id, query, n_results=max(n_results * 3, 30))
    best: dict[str, object] = {}
    for h in hits:
        cur = best.get(h.doc_key)
        if cur is None or h.score > cur.score:
            best[h.doc_key] = h

    files = []
    for _doc_key, h in sorted(best.items(), key=lambda kv: kv[1].score, reverse=True)[:n_results]:
        meta = h.meta or {}
        item_type = meta.get("type", "file")
        item = {
            "type": item_type,
            "name": meta.get("name", ""),
            "score": h.score,
            "snippet": _query_snippet(h.text, query),
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
