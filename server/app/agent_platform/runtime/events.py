"""Agent 运行时事件协议（S2）。

runtime 产出类型化事件，传输层（SSE/WebSocket/飞书 bot）只是哑管道。
所有事件在产出前经过脱敏（runtime/masking.py 流式脱敏器）。
"""

from dataclasses import dataclass, field
from typing import Any


@dataclass
class AgentEvent:
    type: str            # delta | tool_start | tool_end | confirm_request | citation | done | error
    data: dict = field(default_factory=dict)

    def to_sse(self) -> dict:
        """旧前端兼容形态：{"type": ..., "data": ...}。"""
        return {"type": self.type, "data": self.data}


def delta(text: str) -> AgentEvent:
    return AgentEvent("delta", {"text": text})


def tool_start(tool: str, args: dict) -> AgentEvent:
    return AgentEvent("tool_start", {"tool": tool, "args": args})


def tool_end(tool: str, ok: bool, summary: str = "") -> AgentEvent:
    return AgentEvent("tool_end", {"tool": tool, "ok": ok, "summary": summary})


def confirm_request(call_id: str, tool: str, args: dict, message: str) -> AgentEvent:
    """破坏性操作等待用户确认（HITL）。call_id 为调用指纹，确认端点凭此恢复。"""
    return AgentEvent("confirm_request", {
        "call_id": call_id, "tool": tool, "args": args, "message": message,
    })


def citation(file_id: str, name: str, snippet: str = "") -> AgentEvent:
    return AgentEvent("citation", {"file_id": file_id, "name": name, "snippet": snippet})


def done(reply: str, tool_calls: list[dict], trace_id: str = "",
         pending: bool = False, usage: dict | None = None,
         pending_state: dict | None = None,
         raw_reply: str | None = None,
         raw_tool_calls: list[dict] | None = None) -> AgentEvent:
    """raw_* 仅供服务端持久化（历史回放见真值）；SSE 出口必须 pop 后再上线。"""
    data = {
        "reply": reply, "tool_calls": tool_calls, "trace_id": trace_id,
        "pending": pending, "usage": usage or {},
    }
    if pending_state is not None:
        data["pending_state"] = pending_state
    if raw_reply is not None:
        data["raw_reply"] = raw_reply
    if raw_tool_calls is not None:
        data["raw_tool_calls"] = raw_tool_calls
    return AgentEvent("done", data)


def error(message: str, code: str = "AGENT_ERROR") -> AgentEvent:
    return AgentEvent("error", {"message": message, "code": code})
