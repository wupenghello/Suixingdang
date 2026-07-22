"""对话记忆：历史回放保留工具结果（修复多轮丢证据）+ 回合持久化。"""

import json
import logging

from ...db.models import ChatMessage, SessionLocal

logger = logging.getLogger(__name__)


def history_to_messages(user_id: str, limit: int = 5, db_factory=SessionLocal) -> list[dict]:
    """重建对话历史为 OpenAI messages。

    修复：原实现只回放 role/content，前几轮工具结果被丢弃，
    导致多轮工具推理失去证据。现为含工具结果的助手回合追加
    一条 system 摘要消息，把证据带回上下文。
    """
    db = db_factory()
    try:
        rows = (db.query(ChatMessage)
                .filter_by(user_id=user_id)
                .order_by(ChatMessage.created_at.desc())
                .limit(limit * 2).all())
        rows = list(reversed(rows))
        out = []
        for m in rows:
            out.append({"role": m.role, "content": m.content})
            tool_results = _parse(getattr(m, "tool_results", None))
            if m.role == "assistant" and tool_results:
                summary = _summarize_tool_results(tool_results)
                if summary:
                    out.append({"role": "system", "content": f"（上一轮工具执行结果摘要）{summary}"})
        return out
    finally:
        db.close()


def save_turn(user_id: str, user_message: str, reply: str,
              tool_calls: list[dict] | None = None,
              tool_results: list[dict] | None = None,
              trace_id: str = "", db_factory=SessionLocal):
    db = db_factory()
    try:
        db.add(ChatMessage(user_id=user_id, role="user", content=user_message))
        db.add(ChatMessage(
            user_id=user_id, role="assistant", content=reply,
            tool_calls=json.dumps(tool_calls or [], ensure_ascii=False),
            tool_results=json.dumps(tool_results or [], ensure_ascii=False),
            trace_id=trace_id or None,
        ))
        db.commit()
    finally:
        db.close()


def _parse(raw) -> list:
    if not raw:
        return []
    try:
        v = json.loads(raw)
        return v if isinstance(v, list) else []
    except Exception:
        return []


def _summarize_tool_results(tool_results: list, max_len: int = 800) -> str:
    parts = []
    for tr in tool_results:
        tool = tr.get("tool", "?")
        result = str(tr.get("result", ""))[:240]
        parts.append(f"[{tool}] {result}")
    return "；".join(parts)[:max_len]
