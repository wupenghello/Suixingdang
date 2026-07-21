"""知识库连接器协议（S5 展位）：统一多来源文档摄入。

所有来源（本地上传 / Notion / 飞书 / web）实现同一 Connector 协议，
摄入管道（rag/pipeline.py）不感知来源差异——这是"线上知识库"产品化的地基。
"""

from dataclasses import dataclass
from typing import Iterator, Protocol, runtime_checkable


@dataclass
class SourceDocument:
    """连接器产出的一篇源文档。"""
    source_ref: str          # 来源标识（Notion page id / 飞书 doc token / URL）
    title: str
    text: str
    url: str = ""            # 原文链接（引用展示用）
    updated_at: str = ""


@runtime_checkable
class Connector(Protocol):
    """知识源连接器：拉取文档 → 交给摄入管道分块入库。"""

    source: str  # upload / notion / feishu / web

    def pull(self, config: dict) -> Iterator[SourceDocument]:
        """增量拉取文档（config 含凭据与范围；实现方负责断点/cursor）。"""
        ...

    def webhook_to_refs(self, payload: dict) -> list[str]:
        """把 webhook 事件解析为待更新的 source_ref 列表（增量同步用）。"""
        ...
