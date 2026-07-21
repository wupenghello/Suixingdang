"""飞书连接器（S5 展位：骨架冻结，实现随连接器波次接入）。

接入路线：
1. 飞书开放平台自建应用：app_id/app_secret → tenant_access_token
2. pull(): 云文档 API（wiki/v2/spaces 遍历 + docx raw_content）→ SourceDocument；
   多维表格走 bitable records
3. webhook_to_refs(): 事件订阅（drive.file.edit_v1 等）→ 解析出 file_token 列表
4. bot 渠道（客服场景）：im/v1/messages 收发，与 runtime 事件协议对接
5. 也可先经飞书 MCP server 以工具形态接入（MCP 波次），深度同步再走本连接器
"""

from typing import Iterator

from .base import SourceDocument


class FeishuConnector:
    source = "feishu"

    def pull(self, config: dict) -> Iterator[SourceDocument]:
        raise NotImplementedError(
            "飞书连接器尚未实现（S5 展位）。接入路线见本文件 docstring。"
        )

    def webhook_to_refs(self, payload: dict) -> list[str]:
        raise NotImplementedError("飞书连接器尚未实现（S5 展位）。")
