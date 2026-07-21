"""MCP 客户端适配层（S5 展位：接口冻结，实现随 MCP 波次接入）。

设计约定：远程 MCP server 的工具经 MCPToolAdapter 包装为标准 ToolSpec 进入
统一注册表——循环层不感知工具来源（本地 / MCP / Skill 附带同一接口）。

接入路线（后续波次）：
1. 用 `mcp` Python SDK（Streamable HTTP transport）连接 McpServer 行配置的 url
2. list_tools() → 每个远程工具生成 ToolSpec（permission 默认 read，
   带副作用的工具名模式升级为 write/destructive）
3. run() 内部转发 call_tool()，结果 JSON 文本化
4. 凭据走 mcp_servers.credential_enc（Fernet），失败熔断同 LLM 网关策略
"""

from typing import Protocol, runtime_checkable

from ..tools.base import ToolSpec


@runtime_checkable
class MCPToolAdapter(Protocol):
    """把一个远程 MCP server 的工具集适配为本地 ToolSpec 列表。"""

    def list_tools(self, server_url: str, credential: str = "") -> list[ToolSpec]:
        """拉取远程工具清单并包装为 ToolSpec（run 内部转发远程调用）。"""
        ...

    def health(self, server_url: str, credential: str = "") -> bool:
        """连通性探测（管理端"测试连接"用）。"""
        ...


class NotConnectedError(Exception):
    """MCP server 不可达/认证失败。"""
