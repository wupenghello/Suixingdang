"""工具注册表：统一本地工具的注册、检索、schema 导出与权限判定。

当前工具实现仍驻留 agent/tools.py（16 个，经审计验证可用），
本注册表将其包装为 ToolSpec；未来新工具（MCP 远程 / Skill 附带）
经同一 register() 入口接入，循环层不感知来源。
"""

from .base import ToolSpec, Permission


class ToolRegistry:
    def __init__(self):
        self._specs: dict[str, ToolSpec] = {}

    def register(self, spec: ToolSpec):
        self._specs[spec.name] = spec

    def get(self, name: str) -> ToolSpec | None:
        return self._specs.get(name)

    def specs(self) -> list[ToolSpec]:
        return list(self._specs.values())

    def openai_schemas(self) -> list[dict]:
        return [s.openai_schema() for s in self._specs.values()]

    def effective_permission(self, name: str, args: dict) -> Permission:
        """按调用参数解析实际权限级别（delete_file 的 purge 升级为 destructive）。"""
        spec = self._specs.get(name)
        if spec is None:
            return "read"
        if name == "delete_file" and args.get("purge"):
            return "destructive"
        return spec.permission


# 权限分级：read=只读；write=可逆写；destructive=不可逆（需 HITL 确认）
_PERMISSIONS: dict[str, Permission] = {
    "list_transfer_messages": "read",
    "search_files": "read",
    "list_files": "read",
    "get_file_info": "read",
    "check_guard": "read",
    "summarize_file": "read",
    "qa": "read",
    "list_sync_events": "read",
    "cleanup_suggestions": "read",
    "cleanup_assistant": "read",
    "smart_sync_suggestions": "read",
    "get_storage_stats": "read",
    "trash_cleanup_assistant": "read",   # 仅扫描建议，不执行删除
    "restore_file": "write",
    "delete_file": "write",              # 默认软删；purge=True 时按调用升级为 destructive
    "sync": "write",                     # push 动作为写
}


def default_registry() -> ToolRegistry:
    """从既有 agent.tools 构建默认注册表（包装而非重写，行为零变化）。"""
    from ...agent.tools import TOOL_FUNCTIONS, TOOL_SCHEMAS

    registry = ToolRegistry()
    fn_by_name = TOOL_FUNCTIONS
    for schema in TOOL_SCHEMAS:
        f = schema["function"]
        name = f["name"]
        fn = fn_by_name.get(name)
        if fn is None:
            continue
        registry.register(ToolSpec(
            name=name,
            description=f["description"],
            parameters=f["parameters"],
            fn=fn,
            permission=_PERMISSIONS.get(name, "read"),
        ))
    return registry


_default: ToolRegistry | None = None


def get_default_registry() -> ToolRegistry:
    global _default
    if _default is None:
        _default = default_registry()
    return _default
