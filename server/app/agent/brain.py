"""Agent 大脑（多账户版）：编排 LLM 对话、function-calling。"""

import json
from typing import Optional

from openai import OpenAI

from ..config import settings
from ..db.models import ChatMessage, SessionLocal
from . import tools as T

SYSTEM_PROMPT = """你是"随行档"的 AI 文件助手。你管理着一个私人文件中枢，用户通过你查找、管理、同步文件。

你的能力：
1. 语义搜索文件（search_files）
2. 浏览目录结构（list_files）
3. 查看文件详情（get_file_info）
4. 删除文件（delete_file）
5. 检查文件敏感度（check_guard）
6. 自动分类标签（auto_tag_file）
7. 文件内容摘要（summarize_file）
8. 查看同步记录（list_sync_events）
9. 清理建议（cleanup_suggestions）
10. 存储统计（get_storage_stats）

行为准则：
- 用户说"找文件""那个东西""上次那个"时，用 search_files 语义搜索
- 用户说"删""清理"时，先确认，对敏感文件先 check_guard
- 始终用中文回复，简洁直接
- 执行操作前简要说明你要做什么
- 如果用户意图模糊，先列出最可能的文件让用户确认
"""


def _get_client() -> OpenAI:
    return OpenAI(api_key=settings.llm_api_key, base_url=settings.llm_base_url)


def chat(user_id: str, user_message: str, history: Optional[list] = None) -> dict:
    client = _get_client()
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    if history:
        messages.extend(history[-10:])
    messages.append({"role": "user", "content": user_message})

    tool_call_log = []
    max_rounds = 5

    for _ in range(max_rounds):
        response = client.chat.completions.create(
            model=settings.llm_model, messages=messages,
            tools=T.TOOL_SCHEMAS, tool_choice="auto", temperature=0.7,
        )
        msg = response.choices[0].message

        if not msg.tool_calls:
            result = {"reply": msg.content or "", "tool_calls": tool_call_log}
            _save_history(user_id, user_message, result)
            return result

        messages.append(msg)

        for tc in msg.tool_calls:
            fn_name = tc.function.name
            fn_args = json.loads(tc.function.arguments or "{}")
            fn_args["user_id"] = user_id  # 注入用户隔离

            tool_call_log.append({"tool": fn_name, "args": fn_args})

            fn = T.TOOL_FUNCTIONS.get(fn_name)
            if fn:
                try:
                    result = fn(**fn_args)
                except Exception as e:
                    result = json.dumps({"error": str(e)}, ensure_ascii=False)
            else:
                result = json.dumps({"error": f"未知工具: {fn_name}"}, ensure_ascii=False)

            tool_call_log[-1]["result"] = result[:500]
            messages.append({"role": "tool", "tool_call_id": tc.id, "content": result})

    result = {"reply": "我已经执行了所需的操作。还有什么需要帮忙的吗？", "tool_calls": tool_call_log}
    _save_history(user_id, user_message, result)
    return result


def _save_history(user_id: str, user_message: str, result: dict):
    db = SessionLocal()
    try:
        db.add(ChatMessage(user_id=user_id, role="user", content=user_message))
        db.add(ChatMessage(
            user_id=user_id, role="assistant", content=result["reply"],
            tool_calls=json.dumps(result.get("tool_calls", []), ensure_ascii=False),
        ))
        db.commit()
    finally:
        db.close()


def get_history(user_id: str, limit: int = 50) -> list:
    db = SessionLocal()
    try:
        msgs = db.query(ChatMessage).filter_by(user_id=user_id).order_by(
            ChatMessage.created_at.desc()).limit(limit).all()
        return [{
            "role": m.role, "content": m.content,
            "tool_calls": json.loads(m.tool_calls) if m.tool_calls else [],
            "time": str(m.created_at),
        } for m in reversed(msgs)]
    finally:
        db.close()


def chat_history_for_llm(user_id: str, limit: int = 10) -> list:
    db = SessionLocal()
    try:
        msgs = db.query(ChatMessage).filter_by(user_id=user_id).order_by(
            ChatMessage.created_at.desc()).limit(limit * 2).all()
        msgs = list(reversed(msgs))
        return [{"role": m.role, "content": m.content} for m in msgs]
    finally:
        db.close()
