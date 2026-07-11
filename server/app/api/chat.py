"""对话 API（多账户版）。"""

import json
from fastapi import APIRouter, Depends, HTTPException, Query
from sse_starlette.sse import EventSourceResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel

from ..db.models import ChatMessage, get_db
from ..agent import brain
from ..core.llm_service import AiDisabled, NoLlmConfigured
from .auth import get_current_user

router = APIRouter(prefix="/api/chat", tags=["chat"])


class ChatRequest(BaseModel):
    message: str


def _check_ai_access(user_id: str):
    """检查用户 AI 助手权限，无权限时抛出 HTTPException。"""
    from ..core.llm_service import check_ai_access
    ok, msg = check_ai_access(user_id)
    if not ok:
        raise HTTPException(403, msg)


@router.post("")
def chat(req: ChatRequest, db: Session = Depends(get_db), user=Depends(get_current_user)):
    _check_ai_access(user.id)
    try:
        history = brain.chat_history_for_llm(user.id, limit=5)
        result = brain.chat(user.id, req.message, history=history)
        return result
    except (AiDisabled, NoLlmConfigured) as e:
        # 权限/配置问题（含 _check_ai_access 与 brain 调用之间的 TOCTOU）→ 403
        raise HTTPException(403, str(e))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Agent 处理失败: {str(e)}")


@router.post("/stream")
def chat_stream(req: ChatRequest, user=Depends(get_current_user)):
    """SSE 流式对话端点。

    返回 text/event-stream，每行格式：
      data: {"type": "tool", "data": {...}}
      data: {"type": "delta", "data": "文本增量"}
      data: {"type": "done", "data": {"reply": "...", "tool_calls": [...]}}
    """
    _check_ai_access(user.id)
    history = brain.chat_history_for_llm(user.id, limit=5)

    def event_generator():
        try:
            for item in brain.chat_stream(user.id, req.message, history=history):
                yield {"event": "message", "data": json.dumps(item, ensure_ascii=False)}
        except Exception as e:
            yield {"event": "message", "data": json.dumps({"type": "error", "data": str(e)}, ensure_ascii=False)}

    return EventSourceResponse(event_generator())


@router.get("/history")
def get_history(limit: int = Query(50), db: Session = Depends(get_db), user=Depends(get_current_user)):
    return {"messages": brain.get_history(user.id, limit)}


@router.delete("/history")
def clear_history(db: Session = Depends(get_db), user=Depends(get_current_user)):
    db.query(ChatMessage).filter_by(user_id=user.id).delete()
    db.commit()
    return {"message": "对话历史已清空"}
