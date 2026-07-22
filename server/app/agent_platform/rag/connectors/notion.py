"""Notion 连接器（S5 展位：骨架冻结，实现随连接器波次接入）。

接入路线：
1. OAuth（Notion 官方 OAuth flow）或 Integration Token（config["token"]）
2. pull(): POST /v1/databases/{id}/query 翻页 → 每页转 SourceDocument
   （blocks → markdown 文本，可用 martian/rtf 等库）
3. webhook_to_refs(): Notion 无原生 webhook → 轮询 last_edited_time 增量
   （或经第三方 webhook 桥接，payload 含 page_id 列表）
4. 凭据存 McpServer/SkillConfig 同源加密（Fernet）
"""

from typing import Iterator

from .base import SourceDocument


class NotionConnector:
    source = "notion"

    def pull(self, config: dict) -> Iterator[SourceDocument]:
        raise NotImplementedError(
            "Notion 连接器尚未实现（S5 展位）。接入路线见本文件 docstring。"
        )

    def webhook_to_refs(self, payload: dict) -> list[str]:
        raise NotImplementedError("Notion 连接器尚未实现（S5 展位）。")
