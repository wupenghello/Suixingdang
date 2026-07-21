"""对话 API（多账户版）。"""

import json
import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from sse_starlette.sse import EventSourceResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel

from ..db.models import ChatMessage, get_db, rate_limit_acquire
from ..agent import brain
from ..core.llm_service import AiDisabled, NoLlmConfigured
from .auth import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chat", tags=["chat"])


class ChatRequest(BaseModel):
    message: str


def _check_ai_access(user_id: str):
    """检查用户 AI 助手权限，无权限时抛出 HTTPException。"""
    from ..core.llm_service import check_ai_access
    ok, msg = check_ai_access(user_id)
    if not ok:
        raise HTTPException(403, msg)


def _rate_limit(db: Session, user_id: str):
    """按用户限流聊天接口；超限返回 429。"""
    wait = rate_limit_acquire(db, f"chatrl:{user_id}")
    if wait:
        raise HTTPException(429, f"请求过于频繁，请 {wait} 秒后再试")


@router.post("")
def chat(req: ChatRequest, db: Session = Depends(get_db), user=Depends(get_current_user)):
    _check_ai_access(user.id)
    _rate_limit(db, user.id)
    try:
        history = brain.chat_history_for_llm(user.id, limit=5)
        result = brain.chat(user.id, req.message, history=history)
        return result
    except (AiDisabled, NoLlmConfigured) as e:
        # 权限/配置问题（含 _check_ai_access 与 brain 调用之间的 TOCTOU）→ 403
        raise HTTPException(403, str(e))
    except HTTPException:
        raise
    except Exception:
        logger.exception("agent chat failed for user %s", user.id)
        raise HTTPException(500, "处理失败，请稍后重试")



class UnmaskRequest(BaseModel):
    mask_id: str


@router.post("/unmask")
def unmask(req: UnmaskRequest, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """Reveal a masked sensitive value.

    The mask_id is deterministic (hash of server secret + user_id + value),
    so only values belonging to the requesting user can be unmasked.
    Rate-limited to prevent brute-forcing mask_ids.
    """
    _rate_limit(db, f"unmaskrl:{user.id}")
    from ..core.mask import unmask as do_unmask
    value = do_unmask(req.mask_id, user.id)
    if value is None:
        raise HTTPException(404, "无法找到对应的脱敏数据")
    return {"value": value}


@router.post("/stream")
def chat_stream(req: ChatRequest, db: Session = Depends(get_db), user=Depends(get_current_user)):
    """SSE 流式对话端点。

    返回 text/event-stream，每行格式：
      data: {"type": "tool", "data": {...}}
      data: {"type": "delta", "data": "文本增量"}
      data: {"type": "done", "data": {"reply": "...", "tool_calls": [...]}}
    """
    _check_ai_access(user.id)
    _rate_limit(db, user.id)
    history = brain.chat_history_for_llm(user.id, limit=5)

    def event_generator():
        try:
            for item in brain.chat_stream(user.id, req.message, history=history):
                yield {"event": "message", "data": json.dumps(item, ensure_ascii=False)}
        except Exception:
            logger.exception("agent chat_stream failed for user %s", user.id)
            yield {"event": "message", "data": json.dumps({"type": "error", "data": "处理失败，请稍后重试"}, ensure_ascii=False)}

    return EventSourceResponse(event_generator())


@router.get("/history")
def get_history(limit: int = Query(50), db: Session = Depends(get_db), user=Depends(get_current_user)):
    return {"messages": brain.get_history(user.id, limit)}


@router.delete("/history")
def clear_history(db: Session = Depends(get_db), user=Depends(get_current_user)):
    db.query(ChatMessage).filter_by(user_id=user.id).delete()
    db.commit()
    return {"message": "对话历史已清空"}
