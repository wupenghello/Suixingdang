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
            return embedding_functions.OpenAIEmbeddingFunction(
                api_key=getattr(settings, "OPENAI_API_KEY", ""),
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


def _extract_text(user_id: str, rel_path: str) -> str:
    from . import storage
    p = storage._user_dir(user_id) / rel_path
    if not p.exists():
        return ""
    suffix = p.suffix.lower()
    if suffix in {".txt", ".md", ".rst", ".csv", ".json", ".yaml", ".yml",
                  ".xml", ".html", ".htm", ".js", ".ts", ".py", ".java",
                  ".go", ".rs", ".c", ".cpp", ".h", ".sh", ".sql",
                  ".ini", ".cfg", ".conf", ".toml", ".properties", ".log", ".tsv"}:
        try:
            return p.read_text(encoding="utf-8", errors="ignore")[:50000]
        except Exception:
            return ""
    if suffix == ".pdf":
        try:
            import fitz
            doc = fitz.open(str(p))
            text = "".join(page.get_text() for page in doc)
            doc.close()
            return text[:50000]
        except Exception:
            return ""
    # Word / Excel / PowerPoint：用 unstructured 解析
    if suffix in {".docx", ".doc", ".xlsx", ".xls", ".pptx", ".ppt"}:
        try:
            from unstructured.partition.auto import partition
            elements = partition(str(p))
            text = "\n".join(str(el) for el in elements)
            return text[:50000]
        except Exception:
            return ""
    return ""


def index_file(user_id: str, file_id: str, rel_path: str):
    text = _extract_text(user_id, rel_path)
    name = Path(rel_path).name
    doc_text = f"{name}\n{text}" if text else name
    doc_text = doc_text[:50000]
    doc_id = hashlib.md5(f"{user_id}:{rel_path}".encode()).hexdigest()

    col = _get_collection(user_id)
    try:
        col.delete(ids=[doc_id])
    except Exception:
        pass
    col.add(
        ids=[doc_id], documents=[doc_text],
        metadatas=[{"type": "file", "file_id": file_id, "path": rel_path, "name": name}],
    )


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
            item_type = meta.get("type", "file")
            item = {
                "type": item_type,
                "name": meta.get("name", ""),
                "score": round(1 - dist, 4),
                "snippet": doc[:500] if doc else "",
            }
            if item_type == "text":
                item["message_id"] = meta.get("message_id")
            else:
                item["file_id"] = meta.get("file_id")
                item["path"] = meta.get("path")
            files.append(item)
    return files


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
                    content_hash="", source="scan",
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
