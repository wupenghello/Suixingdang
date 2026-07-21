"""向量存储抽象与 ChromaDB 实现（按用户隔离 collection，块级文档管理）。

与旧版整文档索引（core/indexer.py 把整个文档作为单条向量入库）的区别：
- 文档按分块写入多条向量，长文档深处内容也能被检索到；
- 块 id 形如 "{md5(user_id:doc_key)}:{ord}"，metadata 含 doc_key/ord，
  支持按 doc_key 整体覆盖与删除；
- 覆盖/删除时顺带清理旧版整文档索引的 legacy id（纯 md5），兼容历史数据。
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Optional, Protocol


@dataclass
class VectorHit:
    """一条检索命中：块文本 + 元数据 + 相关度分数（1 - cosine 距离）。"""

    doc_key: str
    ord: int
    text: str
    meta: dict
    score: float


class VectorStore(Protocol):
    """向量存储接口：文档以 doc_key 为粒度管理（如 "file:{rel_path}"、"text:{message_id}"）。"""

    def add_document(self, user_id: str, doc_key: str, chunks: list[str], meta: dict) -> None:
        """写入文档的分块（覆盖语义）；chunks 为空时仅删除该 doc_key 旧数据。"""
        ...

    def remove_document(self, user_id: str, doc_key: str) -> None:
        """删除文档的全部分块。"""
        ...

    def query(self, user_id: str, query_text: str, n_results: int = 10) -> list[VectorHit]:
        """语义检索，按相关度返回命中块。"""
        ...


class ChromaVectorStore:
    """基于 ChromaDB 的向量存储，collection 命名与旧版 indexer 一致（files_{user_id}，cosine/HNSW）。"""

    def __init__(
        self,
        client_factory: Optional[Callable[[], Any]] = None,
        embedding_factory: Optional[Callable[[], Any]] = None,
    ):
        self._client_factory = client_factory
        self._embedding_factory = embedding_factory
        self._collections: dict = {}  # user_id -> collection 缓存

    # ---- 默认工厂（函数内 lazy import，避免测试环境 import 期副作用）----

    def _default_client_factory(self):
        # 复用现有路径逻辑：chroma 目录与文件存储同级
        import chromadb

        from ...config import settings
        chroma_path = Path(settings.storage_path).parent / "chroma"
        chroma_path.mkdir(parents=True, exist_ok=True)
        return chromadb.PersistentClient(path=str(chroma_path))

    def _default_embedding_factory(self):
        try:
            from chromadb.utils import embedding_functions
            return embedding_functions.DefaultEmbeddingFunction()
        except Exception:
            return None  # 内置嵌入加载失败时搜索/索引不可用（与旧版 indexer 的回退一致）

    # ---- 内部工具 ----

    def _get_collection(self, user_id: str):
        if user_id not in self._collections:
            client = (self._client_factory or self._default_client_factory)()
            embedding = (self._embedding_factory or self._default_embedding_factory)()
            col_name = f"files_{user_id.replace('-', '_')}"
            self._collections[user_id] = client.get_or_create_collection(
                name=col_name,
                metadata={"hnsw:space": "cosine"},
                embedding_function=embedding,
            )
        return self._collections[user_id]

    @staticmethod
    def _legacy_id(user_id: str, doc_key: str) -> str:
        """旧版整文档索引使用的 id（纯 md5），覆盖/删除时需顺带清理。"""
        return hashlib.md5(f"{user_id}:{doc_key}".encode()).hexdigest()

    def _delete_document(self, col, user_id: str, doc_key: str) -> None:
        # 两种删除各自 try/except 吞异常（空库/部分 mock 删不存在的 id 会抛错）
        try:
            col.delete(ids=[self._legacy_id(user_id, doc_key)])
        except Exception:
            pass
        try:
            col.delete(where={"doc_key": doc_key})
        except Exception:
            pass

    # ---- VectorStore 接口 ----

    def add_document(self, user_id: str, doc_key: str, chunks: list[str], meta: dict) -> None:
        col = self._get_collection(user_id)
        self._delete_document(col, user_id, doc_key)  # 覆盖语义：先删旧块与 legacy 记录
        if not chunks:
            return
        base = self._legacy_id(user_id, doc_key)
        col.add(
            ids=[f"{base}:{ord_}" for ord_ in range(len(chunks))],
            documents=list(chunks),
            metadatas=[{"doc_key": doc_key, "ord": ord_, **meta} for ord_ in range(len(chunks))],
        )

    def remove_document(self, user_id: str, doc_key: str) -> None:
        self._delete_document(self._get_collection(user_id), user_id, doc_key)

    def query(self, user_id: str, query_text: str, n_results: int = 10) -> list[VectorHit]:
        results = self._get_collection(user_id).query(
            query_texts=[query_text], n_results=n_results,
            include=["documents", "metadatas", "distances"],
        )
        ids = (results.get("ids") or [[]])[0] or []
        if not ids:
            return []  # 空库 / mock 的空结构（ids=[[]]）安全返回 []
        metadatas = (results.get("metadatas") or [[]])[0] or []
        distances = (results.get("distances") or [[]])[0] or []
        documents = (results.get("documents") or [[]])[0] or []
        hits: list[VectorHit] = []
        for i in range(len(ids)):
            meta = metadatas[i] if i < len(metadatas) and metadatas[i] else {}
            dist = distances[i] if i < len(distances) and distances[i] is not None else 0.0
            score = round(1 - float(dist), 4)
            if score < 0.1:
                continue  # 相关度阈值：与旧版 indexer 一致，丢弃负分/极低相关
            hits.append(VectorHit(
                doc_key=meta.get("doc_key", ""),
                ord=int(meta.get("ord", 0) or 0),
                text=documents[i] if i < len(documents) and documents[i] else "",
                meta={k: v for k, v in meta.items() if k not in ("doc_key", "ord")},
                score=score,
            ))
        return hits
