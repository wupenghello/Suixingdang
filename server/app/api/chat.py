"""对话 API（多账户版）。"""

import json
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel

from ..db.models import ChatMessage, get_db
from ..agent import brain
from .auth import get_current_user

router = APIRouter(prefix="/api/chat", tags=["chat"])


class ChatRequest(BaseModel):
    message: str



@router.post("")
def chat(req: ChatRequest, db: Session = Depends(get_db), user=Depends(get_current_user)):
    try:
        history = brain.chat_history_for_llm(user.id, limit=5)
        result = brain.chat(user.id, req.message, history=history)
        return result
    except Exception as e:
        raise HTTPException(500, f"Agent 处理失败: {str(e)}")


@router.get("/history")
def get_history(limit: int = Query(50), db: Session = Depends(get_db), user=Depends(get_current_user)):
    return {"messages": brain.get_history(user.id, limit)}


@router.delete("/history")
def clear_history(db: Session = Depends(get_db), user=Depends(get_current_user)):
    db.query(ChatMessage).filter_by(user_id=user.id).delete()
    db.commit()
    return {"message": "对话历史已清空"}
