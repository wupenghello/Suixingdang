"""Agent 大脑（多账户版）：薄适配层。

S2 起实际循环由 agent_platform/runtime 驱动（真 token 流式 + HITL + 脱敏流），
本模块保持既有 API（chat / chat_stream / get_history / chat_history_for_llm），
旧端点（/api/chat、/api/chat/stream）与既有测试契约不受影响。
"""

import json
import logging
import time
from typing import Optional

from ..db.models import ChatMessage, SessionLocal
from ..core import mask as M
from ..agent_platform.runtime.context import RunContext
from ..agent_platform.runtime import loop as rt_loop
from ..agent_platform.memory.conversation import history_to_messages, save_turn
from ..agent_platform.observability import tracing
from ..agent_platform.llm.prompts import get_prompt

logger = logging.getLogger(__name__)

# 系统提示已版本化（agent_platform/llm/prompts/file-assistant.v1.md，含全部 16 工具）。
# 保留模块级 SYSTEM_PROMPT 供既有引用。
SYSTEM_PROMPT = get_prompt("file-assistant")[0]


def _save_history(user_id: str, user_message: str, done_data: dict,
                  trace_id: str, started_at: float):
    """持久化回合（raw 回复/工具结果入库供回放；trace 落观测表）。

    独立函数以便测试 monkeypatch。
    """
    usage = done_data.get("usage", {}) or {}
    save_turn(
        user_id, user_message,
        done_data.get("raw_reply", done_data.get("reply", "")),
        tool_calls=done_data.get("tool_calls", []),
        tool_results=done_data.get("raw_tool_calls", []),
        trace_id=trace_id,
    )
    tracing.record_trace(
        user_id, trace_id=trace_id,
        rounds=len(done_data.get("tool_calls", []) or []),
        tokens_in=usage.get("input_tokens", 0),
        tokens_out=usage.get("output_tokens", 0),
        duration_ms=int((time.time() - started_at) * 1000),
        status="pending" if done_data.get("pending") else "ok",
        tool_calls=done_data.get("raw_tool_calls", []),
    )


def chat(user_id: str, user_message: str, history: Optional[list] = None) -> dict:
    """同步对话（旧 POST /api/chat）。驱动运行时事件流至 done。"""
    import asyncio

    trace_id = tracing.new_trace_id()
    ctx = RunContext(user_id=user_id, trace_id=trace_id)
    started = time.time()
    done_data: dict = {}

    async def _run():
        nonlocal done_data
        async for ev in rt_loop.run_agent(ctx, user_message, history=history):
            if ev.type == "done":
                done_data = ev.data

    asyncio.run(_run())

    if done_data:
        _save_history(user_id, user_message, done_data, trace_id, started)
    return {
        "reply": done_data.get("reply", "处理失败，请稍后重试"),
        "tool_calls": done_data.get("tool_calls", []),
    }


async def chat_stream(user_id: str, user_message: str, history: Optional[list] = None):
    """流式对话（旧 POST /api/chat/stream）。异步生成器，输出旧版事件形态：

      {"type": "tool", "data": {...}}    工具调用通知
      {"type": "delta", "data": "xxx"}   文本增量（真 token 级，经流式脱敏）
      {"type": "done", "data": {"reply", "tool_calls"}}
      {"type": "error", "data": "..."}
    """
    trace_id = tracing.new_trace_id()
    ctx = RunContext(user_id=user_id, trace_id=trace_id)
    started = time.time()

    async for ev in rt_loop.run_agent(ctx, user_message, history=history):
        if ev.type == "delta":
            yield {"type": "delta", "data": ev.data.get("text", "")}
        elif ev.type == "tool_start":
            yield {"type": "tool", "data": {"tool": ev.data["tool"], "args": ev.data.get("args", {})}}
        elif ev.type == "confirm_request":
            # 旧前端无确认 UI：以 tool 事件透出，答复提示用户（S3 前端实现确认流）
            yield {"type": "tool", "data": {"tool": "confirm_required", "args": ev.data}}
        elif ev.type == "error":
            yield {"type": "error", "data": ev.data.get("message", "处理失败，请稍后重试")}
        elif ev.type == "done":
            _save_history(user_id, user_message, ev.data, trace_id, started)
            yield {"type": "done", "data": {
                "reply": ev.data.get("reply", ""),
                "tool_calls": ev.data.get("tool_calls", []),
            }}


def get_history(user_id: str, limit: int = 50) -> list:
    db = SessionLocal()
    try:
        msgs = db.query(ChatMessage).filter_by(user_id=user_id).order_by(
            ChatMessage.created_at.desc()).limit(limit).all()
        raw = [{
            "role": m.role, "content": m.content,
            "tool_calls": json.loads(m.tool_calls) if m.tool_calls else [],
            "time": str(m.created_at),
        } for m in reversed(msgs)]
    finally:
        db.close()
    # 展示层脱敏（raw 留库供 LLM 上下文回放）
    return M.mask_history_messages(raw, user_id)


def chat_history_for_llm(user_id: str, limit: int = 10) -> list:
    """回放对话历史（S2：保留前几轮工具结果摘要，修复多轮丢证据）。"""
    return history_to_messages(user_id, limit=limit)
