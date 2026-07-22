"""工具协议与规格（S2：全平台第一抽象）。

本地工具、MCP 远程工具（tools/mcp/ 适配器）、Skill 附带工具统一实现 ToolSpec，
运行时循环不关心工具来源。permission 级别驱动 HITL 闸门：
- read：只读，放行
- write：可逆写操作（软删除/恢复/同步推送），放行 + 审计
- destructive：不可逆（物理清除），必须用户确认后执行
"""

from dataclasses import dataclass, field
from typing import Callable

Permission = str  # "read" | "write" | "destructive"


@dataclass
class ToolSpec:
    name: str
    description: str
    parameters: dict                      # JSON Schema（OpenAI function calling 格式）
    fn: Callable[..., str]                # fn(user_id, **args) -> str（JSON 文本）
    permission: Permission = "read"

    def openai_schema(self) -> dict:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }
