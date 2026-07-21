"""RAG 分块与向量存储单测。

用 FakeCollection 模拟 ChromaDB collection 行为（dict 存储 + 朴素子串相关度：
命中 distance 0.2、未命中 0.95），不依赖真实嵌入模型；
conftest 已把 chromadb 整体 mock，本文件不直接 import chromadb。
"""

import hashlib

from app.agent_platform.rag import ChromaVectorStore, VectorHit, chunk_text
from app.agent_platform.rag import pipeline


# ---------------- FakeCollection：模拟 ChromaDB collection ----------------

class FakeCollection:
    """模拟 ChromaDB collection 的 add/query/delete 调用形态，数据存 dict。"""

    def __init__(self):
        self.docs: dict[str, tuple[str, dict]] = {}  # id -> (文本, metadata)

    def add(self, ids, documents, metadatas):
        for i, _id in enumerate(ids):
            self.docs[_id] = (documents[i], metadatas[i])

    def delete(self, ids=None, where=None):
        if ids:
            for _id in ids:
                self.docs.pop(_id, None)
        if where:
            for _id in list(self.docs):
                meta = self.docs[_id][1]
                if all(meta.get(k) == v for k, v in where.items()):
                    del self.docs[_id]

    def query(self, query_texts, n_results=10, include=None):
        q = (query_texts[0] or "").strip().lower()
        items = []
        for _id, (text, meta) in self.docs.items():
            # 命中 distance 0.2（score 0.8），未命中 0.95（score 0.05，触发过滤）
            dist = 0.2 if q and q in text.lower() else 0.95
            items.append((dist, _id, text, meta))
        items.sort(key=lambda it: it[0])  # 按距离升序取前 n_results
        picked = items[:n_results]
        return {
            "ids": [[it[1] for it in picked]],
            "documents": [[it[2] for it in picked]],
            "metadatas": [[it[3] for it in picked]],
            "distances": [[it[0] for it in picked]],
        }


class FakeClient:
    """记录 get_or_create_collection 调用参数，便于断言 collection 名/metadata。"""

    def __init__(self, col):
        self.col = col
        self.calls: list[dict] = []

    def get_or_create_collection(self, **kwargs):
        self.calls.append(kwargs)
        return self.col


def make_store():
    """构造注入假实现的 ChromaVectorStore，返回 (store, col, client)。"""
    col = FakeCollection()
    client = FakeClient(col)
    store = ChromaVectorStore(client_factory=lambda: client, embedding_factory=lambda: None)
    return store, col, client


# ---------------- chunk_text ----------------

def test_empty_input():
    assert chunk_text("") == []
    assert chunk_text("   \n\t  ") == []
    assert chunk_text(None) == []  # 防御性：None 视同空


def test_short_text_single_chunk():
    assert chunk_text("今天天气真好。") == ["今天天气真好。"]


def test_long_text_multi_chunks_within_limit():
    paras = [f"§{i}§" + "内容文字填充" * 7 for i in range(40)]  # 每段约 45 字
    text = "\n\n".join(paras)
    chunks = chunk_text(text, max_chars=100, overlap=20)
    assert len(chunks) > 1
    assert all(len(c) <= 100 for c in chunks)  # 含 overlap 拼接后仍 ≤ max_chars
    # 内容完整性：每个原始段落完整出现在某个块中
    for p in paras:
        assert any(p in c for c in chunks), p


def test_deterministic():
    text = "第一段内容在这里。\n\n## 标题\n\n第二段内容在那里。" * 50
    assert chunk_text(text) == chunk_text(text)


def test_overlap_between_adjacent_chunks():
    paras = [f"§{i}§" + chr(ord("a") + i % 26) * 46 for i in range(30)]
    text = "\n\n".join(paras)
    chunks = chunk_text(text, max_chars=100, overlap=20)
    assert len(chunks) > 2
    for prev, cur in zip(chunks, chunks[1:]):
        # 后一块头部 20 字符 == 前一块尾部 20 字符（拼接而来，相邻块有公共子串）
        assert cur[:20] == prev[-20:]


def test_max_200_chunks_cap():
    text = "\n\n".join(["x" * 25] * 300)  # 每段超 max_chars，触发硬切产生大量块
    chunks = chunk_text(text, max_chars=10, overlap=0)
    assert len(chunks) == 200  # 上限截断
    assert all(len(c) <= 10 for c in chunks)


def test_markdown_heading_starts_new_chunk():
    text = ("# 标题甲\n" + "甲段正文填充内容。" * 3 + "\n"
            "# 标题乙\n" + "乙段正文填充内容。" * 3)
    chunks = chunk_text(text, max_chars=60, overlap=0)
    assert any(c.startswith("# 标题甲") for c in chunks)
    assert any(c.startswith("# 标题乙") for c in chunks)  # 标题各自成块起点


def test_long_paragraph_sentence_split_and_hard_cut():
    # 单个长段落（无空行/标题）：按句号降级再切
    text = "这是一个句子。" * 100  # 700 字
    chunks = chunk_text(text, max_chars=100, overlap=0)
    assert len(chunks) > 1
    assert all(len(c) <= 100 for c in chunks)
    # 超长无标点串：落到硬切（2000 / 100 = 20 块）
    chunks2 = chunk_text("字" * 2000, max_chars=100, overlap=0)
    assert len(chunks2) == 20
    assert all(len(c) == 100 for c in chunks2)


# ---------------- ChromaVectorStore ----------------

def test_add_then_query_hit():
    store, col, _ = make_store()
    store.add_document("u-1", "file:a.txt",
                       ["第一块讲苹果 apple", "第二块讲香蕉 banana"],
                       {"name": "a.txt"})
    hits = store.query("u-1", "apple")
    assert len(hits) == 1
    hit = hits[0]
    assert isinstance(hit, VectorHit)
    assert hit.doc_key == "file:a.txt"
    assert hit.ord == 0
    assert hit.score == 0.8  # 1 - 0.2
    assert hit.text == "第一块讲苹果 apple"
    assert hit.meta == {"name": "a.txt"}  # doc_key/ord 已拆到独立字段


def test_query_empty_collection():
    store, _col, _ = make_store()
    assert store.query("u-1", "任意查询") == []


def test_remove_document():
    store, col, _ = make_store()
    store.add_document("u-1", "file:a.txt", ["块一", "块二"], {})
    store.remove_document("u-1", "file:a.txt")
    assert col.docs == {}
    assert store.query("u-1", "块") == []


def test_readd_same_doc_key_overwrites():
    store, col, _ = make_store()
    store.add_document("u-1", "file:a.txt", ["旧块A", "旧块B"], {"v": 1})
    store.add_document("u-1", "file:a.txt", ["新块唯一"], {"v": 2})
    assert len(col.docs) == 1  # 旧块已清理，无重复块
    assert store.query("u-1", "旧块") == []
    hits = store.query("u-1", "新块")
    assert len(hits) == 1 and hits[0].meta == {"v": 2}


def test_low_score_filtered():
    store, _col, _ = make_store()
    store.add_document("u-1", "file:a.txt", ["讲苹果的块"], {})
    # 未命中查询：distance 0.95 → score 0.05 < 0.1 被过滤
    assert store.query("u-1", "完全不相关的查询词") == []


def test_add_empty_chunks_only_deletes():
    store, col, _ = make_store()
    store.add_document("u-1", "file:a.txt", ["块一"], {})
    store.add_document("u-1", "file:a.txt", [], {})  # chunks 为空：仅删除旧数据
    assert col.docs == {}


def test_legacy_id_cleanup_and_collection_meta():
    store, col, client = make_store()
    legacy = hashlib.md5("u-1:file:a.txt".encode()).hexdigest()
    col.docs[legacy] = ("旧整文档索引", {"path": "a.txt"})  # 模拟旧版单向量记录
    store.add_document("u-1", "file:a.txt", ["新块"], {})
    assert legacy not in col.docs  # legacy id 被顺带清理
    # collection 命名/metadata 与旧版 indexer 一致
    kwargs = client.calls[0]
    assert kwargs["name"] == "files_u_1"
    assert kwargs["metadata"] == {"hnsw:space": "cosine"}
    assert "embedding_function" in kwargs


def test_chunk_id_format():
    store, col, _ = make_store()
    store.add_document("u-1", "file:a.txt", ["块一", "块二"], {})
    base = hashlib.md5("u-1:file:a.txt".encode()).hexdigest()
    assert set(col.docs) == {f"{base}:0", f"{base}:1"}
    assert col.docs[f"{base}:1"][1]["doc_key"] == "file:a.txt"
    assert col.docs[f"{base}:1"][1]["ord"] == 1


# ---------------- pipeline ----------------

def test_index_document_returns_chunk_count():
    store, col, _ = make_store()
    text = "\n\n".join([f"§{i}§" + "内容文字填充" * 7 for i in range(40)])  # 超默认 max_chars，必切多块
    n = pipeline.index_document("u-1", "file:a.txt", text, {"name": "a.txt"}, store=store)
    assert n == len(chunk_text(text)) > 1
    assert len(col.docs) == n


def test_index_document_empty_text_returns_zero():
    store, col, _ = make_store()
    assert pipeline.index_document("u-1", "file:a.txt", "   ", {}, store=store) == 0
    assert col.docs == {}


def test_pipeline_default_store_via_monkeypatch(monkeypatch):
    store, col, _ = make_store()
    monkeypatch.setattr(pipeline, "_default_store", store)  # 替换模块级单例
    n = pipeline.index_document("u-1", "text:42", "这条便签讨论项目验收与尾款安排。", {"message_id": "42"})
    assert n == 1
    assert len(col.docs) == 1  # add_document 被调用，写入发生在被替换的单例上
    pipeline.remove_document("u-1", "text:42")
    assert col.docs == {}


def test_get_default_store_singleton():
    s1 = pipeline.get_default_store()
    s2 = pipeline.get_default_store()
    assert isinstance(s1, ChromaVectorStore)
    assert s1 is s2  # 模块级单例
