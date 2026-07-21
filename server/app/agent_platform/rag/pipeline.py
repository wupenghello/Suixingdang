"""RAG 索引管线：文本分块 → 写入向量库（对外一站式入口）。

doc_key 约定（由调用方传入）：
- 文件："file:{rel_path}"
- 文字便签："text:{message_id}"
"""

from __future__ import annotations

from typing import Optional

from .chunking import chunk_text
from .store import ChromaVectorStore

_default_store: Optional[ChromaVectorStore] = None  # 模块级单例，lazy 创建


def get_default_store() -> ChromaVectorStore:
    """返回模块级单例 ChromaVectorStore（首次调用时创建）。"""
    global _default_store
    if _default_store is None:
        _default_store = ChromaVectorStore()
    return _default_store


def index_document(
    user_id: str,
    doc_key: str,
    text: str,
    meta: dict,
    store: ChromaVectorStore | None = None,
) -> int:
    """把文本分块并写入向量库（覆盖语义），返回写入块数。

    store 为 None 时使用模块级默认单例（lazy 创建）。
    """
    chunks = chunk_text(text)
    (store or get_default_store()).add_document(user_id, doc_key, chunks, meta)
    return len(chunks)


def remove_document(
    user_id: str,
    doc_key: str,
    store: ChromaVectorStore | None = None,
) -> None:
    """从向量库删除文档的全部分块。"""
    (store or get_default_store()).remove_document(user_id, doc_key)
