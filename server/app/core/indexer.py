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
}

TAG_RULES = [
    ("work", ["工作", "公司", "项目", "work", "company", "project", "report", "报告", "会议"]),
    ("study", ["学习", "课程", "笔记", "study", "course", "note", "tutorial", "教程", "book"]),
    ("personal", ["个人", "简历", "照片", "personal", "photo", "resume", "private"]),
    ("project", ["代码", "code", "src", "source", "github", "git", "repo"]),
]


def _get_client() -> chromadb.ClientAPI:
    global _client
    if _client is None:
        chroma_path = str(Path(settings.storage_path).parent / "chroma")
        Path(chroma_path).mkdir(parents=True, exist_ok=True)
        _client = chromadb.PersistentClient(path=chroma_path)
    return _client


def _get_collection(user_id: str):
    global _collections
    if user_id not in _collections:
        client = _get_client()
        col_name = f"files_{user_id.replace('-', '_')}"
        _collections[user_id] = client.get_or_create_collection(
            name=col_name, metadata={"hnsw:space": "cosine"}
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
    return ""


def auto_tag(user_id: str, rel_path: str) -> str:
    from . import storage
    name_lower = Path(rel_path).name.lower()
    text_lower = _extract_text(user_id, rel_path).lower()
    combined = name_lower + " " + text_lower
    scores = {}
    for tag, keywords in TAG_RULES:
        scores[tag] = sum(1 for kw in keywords if kw.lower() in combined)
    best = max(scores, key=scores.get)
    return best if scores[best] > 0 else "other"


def index_file(user_id: str, file_id: str, rel_path: str, tag: str = ""):
    text = _extract_text(user_id, rel_path)
    name = Path(rel_path).name
    doc_text = f"{name}\n{tag}\n{text}" if text else f"{name}\n{tag}"
    doc_text = doc_text[:50000]
    doc_id = hashlib.md5(f"{user_id}:{rel_path}".encode()).hexdigest()

    col = _get_collection(user_id)
    try:
        col.delete(ids=[doc_id])
    except Exception:
        pass
    col.add(
        ids=[doc_id], documents=[doc_text],
        metadatas=[{"file_id": file_id, "path": rel_path, "name": name, "tag": tag}],
    )


def remove_from_index(user_id: str, rel_path: str):
    doc_id = hashlib.md5(f"{user_id}:{rel_path}".encode()).hexdigest()
    try:
        _get_collection(user_id).delete(ids=[doc_id])
    except Exception:
        pass


def semantic_search(user_id: str, query: str, n_results: int = 10) -> list:
    results = _get_collection(user_id).query(query_texts=[query], n_results=n_results)
    files = []
    if results["ids"] and results["ids"][0]:
        for i, doc_id in enumerate(results["ids"][0]):
            meta = results["metadatas"][0][i] if results["metadatas"] else {}
            dist = results["distances"][0][i] if results["distances"] else 0
            files.append({
                "file_id": meta.get("file_id"), "path": meta.get("path"),
                "name": meta.get("name"), "tag": meta.get("tag"),
                "score": 1 - dist,
            })
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
                tag = auto_tag(user_id, rel_path)
                f = File(
                    owner_id=user_id, path=rel_path, name=Path(rel_path).name,
                    size=storage.get_file_size(user_id, rel_path),
                    content_hash="", source="scan", tag=tag,
                )
                db.add(f)
                db.commit()
                db.refresh(f)
            index_file(user_id, f.id, rel_path, f.tag or "")
            f.indexed = True
            db.commit()
    finally:
        db.close()
    return len(files)
