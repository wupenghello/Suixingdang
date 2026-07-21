"""Agent 可观测性：每次运行一条 trace（数据中心的数据源）。

多租户 + 用户自带 key 场景下，trace 是发现跑飞用户、工具风暴、
成本爆炸的唯一手段。落 agent_traces 表；OTel 导出为后续选项。
"""

import logging
import uuid

from ...db.models import AgentTrace, SessionLocal

logger = logging.getLogger(__name__)


def new_trace_id() -> str:
    return uuid.uuid4().hex[:16]


def record_trace(user_id: str, *, session_id: str = "", trace_id: str = "",
                 skill: str = "file-assistant", rounds: int = 0,
                 tokens_in: int = 0, tokens_out: int = 0,
                 duration_ms: int = 0, status: str = "ok",
                 tool_calls: list | None = None,
                 db_factory=SessionLocal):
    try:
        db = db_factory()
        try:
            db.add(AgentTrace(
                user_id=user_id, session_id=session_id or "",
                trace_id=trace_id or new_trace_id(), skill=skill,
                rounds=rounds, tokens_in=tokens_in, tokens_out=tokens_out,
                duration_ms=duration_ms, status=status,
                tool_calls=_dump(tool_calls),
            ))
            db.commit()
        finally:
            db.close()
    except Exception:
        logger.warning("record_trace failed for user %s", user_id, exc_info=True)


def _dump(obj) -> str:
    import json
    try:
        return json.dumps(obj or [], ensure_ascii=False)[:4000]
    except Exception:
        return "[]"
