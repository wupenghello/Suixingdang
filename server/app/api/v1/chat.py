"""v1 对话端点（类型化 SSE 事件协议 + HITL 确认恢复 + trace 查询）。

事件协议（每事件一行 SSE）：
  data: {"type": "delta", "data": {"text": "..."}}          token 级增量（流式脱敏）
  data: {"type": "tool_start", "data": {"tool", "args"}}
  data: {"type": "tool_end", "data": {"tool", "ok", "summary"}}
  data: {"type": "confirm_request", "data": {"call_id", "tool", "args", "message"}}
  data: {"type": "done", "data": {"reply", "tool_calls", "trace_id", "pending", "usage"}}
  data: {"type": "error", "data": {"message", "code"}}

HITL：destructive 工具（如 delete_file purge=true）触发 confirm_request 并以
done(pending=true, pending_state=...) 收尾；前端展示确认 UI，用户批准后调
POST /confirm 携带同一 pending_state + call_id 确定性恢复（不重新询问模型）。

raw_reply/raw_tool_calls 仅服务端持久化用，出口前剥离，绝不上线。
"""

import json
import time

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sse_starlette.sse import EventSourceResponse

from ...db.models import AgentTrace, get_db
from ...api.auth import get_current_user
from ...api.chat import _check_ai_access, _rate_limit
from ...agent_platform.runtime.context import RunContext
from ...agent_platform.runtime import loop as rt_loop
from ...agent_platform.memory.conversation import history_to_messages, save_turn
from ...agent_platform.observability import tracing

router = APIRouter(prefix="/chat", tags=["v1-chat"])


class ChatMessageIn(BaseModel):
    message: str


class ConfirmIn(BaseModel):
    call_id: str          # confirm_request 的 call_id（调用指纹）
    pending_state: dict   # done 事件携带的挂起状态
    approved: bool = True


def _sse_from_runtime(user_id: str, ctx: RunContext, message: str = "",
                      history: list | None = None, resume_state: dict | None = None):
    """消费运行时事件流 → SSE；剥离 raw_*；done 时持久化 + 记 trace。"""
    started = time.time()

    async def gen():
        async for ev in rt_loop.run_agent(ctx, message, history=history, resume_state=resume_state):
            data = dict(ev.data)
            raw_reply = data.pop("raw_reply", None)
            raw_tool_calls = data.pop("raw_tool_calls", None)
            if ev.type == "done":
                save_turn(
                    user_id, message or "（确认继续）",
                    raw_reply if raw_reply is not None else data.get("reply", ""),
                    tool_calls=data.get("tool_calls", []),
                    tool_results=raw_tool_calls or [],
                    trace_id=ctx.trace_id,
                )
                usage = data.get("usage", {}) or {}
                tracing.record_trace(
                    user_id, trace_id=ctx.trace_id,
                    rounds=len(data.get("tool_calls", []) or []),
                    tokens_in=usage.get("input_tokens", 0),
                    tokens_out=usage.get("output_tokens", 0),
                    duration_ms=int((time.time() - started) * 1000),
                    status="pending" if data.get("pending") else "ok",
                    tool_calls=raw_tool_calls or [],
                )
                data.pop("pending_state", None)  # 已随确认往返，不落历史
            yield {"event": "message",
                   "data": json.dumps({"type": ev.type, "data": data}, ensure_ascii=False)}

    return EventSourceResponse(gen())


@router.post("/messages")
def v1_chat_messages(req: ChatMessageIn, db: Session = Depends(get_db),
                     user=Depends(get_current_user)):
    _check_ai_access(user.id)
    _rate_limit(db, user.id)
    history = history_to_messages(user.id, limit=5)
    ctx = RunContext(user_id=user.id, trace_id=tracing.new_trace_id())
    return _sse_from_runtime(user.id, ctx, message=req.message, history=history)


@router.post("/confirm")
def v1_chat_confirm(req: ConfirmIn, db: Session = Depends(get_db),
                    user=Depends(get_current_user)):
    """HITL 确认端点：approved=true 则把 call_id 加入确认集并确定性恢复挂起的循环。"""
    _check_ai_access(user.id)
    _rate_limit(db, user.id)
    ctx = RunContext(
        user_id=user.id, trace_id=tracing.new_trace_id(),
        confirmed={req.call_id} if req.approved else set(),
    )
    if not req.approved:
        # 拒绝：不恢复循环，直接告知（前端展示取消）
        async def cancelled():
            yield {"event": "message", "data": json.dumps(
                {"type": "done", "data": {"reply": "好的，已取消这个操作。",
                                          "tool_calls": [], "pending": False}},
                ensure_ascii=False)}
        return EventSourceResponse(cancelled())
    return _sse_from_runtime(user.id, ctx, resume_state=req.pending_state)


@router.get("/traces")
def v1_chat_traces(limit: int = Query(20, ge=1, le=100), db: Session = Depends(get_db),
                   user=Depends(get_current_user)):
    rows = (db.query(AgentTrace).filter_by(user_id=user.id)
            .order_by(AgentTrace.created_at.desc()).limit(limit).all())
    return {"traces": [{
        "trace_id": t.trace_id, "skill": t.skill, "rounds": t.rounds,
        "tokens_in": t.tokens_in, "tokens_out": t.tokens_out,
        "duration_ms": t.duration_ms, "status": t.status,
        "created_at": t.created_at.isoformat() if t.created_at else "",
    } for t in rows]}
