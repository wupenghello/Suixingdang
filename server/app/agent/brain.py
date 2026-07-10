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
5. 检查文件敏感度（check_guard，支持方向感知）
6. 文件内容摘要（summarize_file，AI 生成）
7. 文件内容问答（qa，RAG 检索后回答）
8. 同步管理（sync：状态/推送/列出文件）
9. 查看同步记录（list_sync_events）
10. 清理建议（cleanup_suggestions）
11. 离职清理助手（cleanup_assistant）
12. 智能同步建议（smart_sync_suggestions）
13. 存储统计（get_storage_stats）

行为准则：
- 用户说"找文件""那个东西""上次那个"时，用 search_files 语义搜索
- 用户问"这份合同的关键条款""这个文件讲了什么"时，用 qa 或 summarize_file
- 用户说"把XX同步过来""推到公司"时，用 sync 的 push action
- 用户说"删""清理"时，先确认，对敏感文件先 check_guard
- 用户说"离职""离开公司""清理设备"时，用 cleanup_assistant
- 用户说"该同步什么""最近该带什么文件"时，用 smart_sync_suggestions
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


def chat_stream(user_id: str, user_message: str, history: Optional[list] = None):
    """流式对话生成器：工具调用阶段静默执行，最终回复逐 token yield。

    yield 的每一项是 dict：
      {"type": "tool", "data": {...}}   — 工具调用通知（可选）
      {"type": "delta", "data": "xxx"}  — 文本增量
      {"type": "done", "data": {...}}   — 完整结果（含 tool_calls）
    """
    import json as _json
    client = _get_client()
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    if history:
        messages.extend(history[-10:])
    messages.append({"role": "user", "content": user_message})

    tool_call_log = []
    max_rounds = 5
    full_reply = ""

    for round_idx in range(max_rounds):
        # 先检查是否有 tool_calls（非流式请求）
        response = client.chat.completions.create(
            model=settings.llm_model, messages=messages,
            tools=T.TOOL_SCHEMAS, tool_choice="auto", temperature=0.7,
            )
        msg = response.choices[0].message

        if msg.tool_calls:
            messages.append(msg)
            for tc in msg.tool_calls:
                fn_name = tc.function.name
                fn_args = _json.loads(tc.function.arguments or "{}")
                fn_args["user_id"] = user_id
                tool_call_log.append({"tool": fn_name, "args": fn_args})
                yield {"type": "tool", "data": {"tool": fn_name, "args": fn_args}}

                fn = T.TOOL_FUNCTIONS.get(fn_name)
                if fn:
                    try:
                        result = fn(**fn_args)
                    except Exception as e:
                        result = _json.dumps({"error": str(e)}, ensure_ascii=False)
                else:
                    result = _json.dumps({"error": f"未知工具: {fn_name}"}, ensure_ascii=False)

                tool_call_log[-1]["result"] = result[:500]
                messages.append({"role": "tool", "tool_call_id": tc.id, "content": result})
            continue  # 继续下一轮（可能继续调用工具）
        else:
            # 非流式响应已包含最终回复，直接使用（避免重复请求）
            full_reply = msg.content or ""
            yield {"type": "delta", "data": full_reply}
            break

    else:
        # max_rounds 耗尽（工具调用循环过多）
        full_reply = "我已经执行了所需的操作。还有什么需要帮忙的吗？"
        yield {"type": "delta", "data": full_reply}

    result = {"reply": full_reply, "tool_calls": tool_call_log}
    _save_history(user_id, user_message, result)
    yield {"type": "done", "data": result}


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
