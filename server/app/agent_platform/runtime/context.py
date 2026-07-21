"""运行上下文：租户、会话、追踪、HITL 确认集、预算。"""

from dataclasses import dataclass, field

from ...db.models import SessionLocal


@dataclass
class RunContext:
    user_id: str
    session_id: str = ""
    trace_id: str = ""
    # 用户已确认的破坏性调用指纹集合（HITL）：sha256(tool_name|canonical_args)
    confirmed: set = field(default_factory=set)
    max_rounds: int = 5
    db_factory: object = SessionLocal

    @staticmethod
    def fingerprint(tool_name: str, args: dict) -> str:
        """破坏性调用的确定性指纹（user_id 不参与：同一调用参数即同一决策）。"""
        import hashlib
        import json
        clean = {k: v for k, v in (args or {}).items() if k != "user_id"}
        canonical = json.dumps(clean, sort_keys=True, ensure_ascii=False)
        return hashlib.sha256(f"{tool_name}|{canonical}".encode()).hexdigest()[:24]
