"""Agent 大脑（多账户版）：编排 LLM 对话、function-calling。"""

import json
import logging
from typing import Optional

from openai import OpenAI

from ..db.models import ChatMessage, SessionLocal
from . import tools as T
from ..core import mask as M

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """你是"随行档"的 AI 文件助手。你管理着一个私人文件中枢，用户通过你查找、管理、同步文件。

你的能力：
1. 查看文件传输助手内容（list_transfer_messages：列出传输助手中的便签与文件）
2. 语义搜索文件与便签（search_files）
3. 浏览目录结构（list_files）
4. 查看文件详情（get_file_info）
5. 删除文件（delete_file）
6. 检查文件敏感度（check_guard，支持方向感知）
7. 文件内容摘要（summarize_file，AI 生成）
8. 文件内容问答（qa，RAG 检索后回答）
9. 同步管理（sync：状态/推送/列出文件）
10. 查看同步记录（list_sync_events）
11. 清理建议（cleanup_suggestions）
12. 离职清理助手（cleanup_assistant）
13. 智能同步建议（smart_sync_suggestions）
14. 存储统计（get_storage_stats）

行为准则：
- 用户说"传输助手里有什么""我最近发了什么""我存的便签"时，用 list_transfer_messages 列出传输助手记录
- 用户说"找文件""那个东西""上次那个"时，用 search_files 语义搜索（传输助手中的便签与文件也会被检索到）
- 用户问"这份合同的关键条款""这个文件讲了什么"时，用 qa 或 summarize_file
- 用户说"把XX同步过来""推到公司"时，用 sync 的 push action
- 用户说"删""清理"时，先确认，对敏感文件先 check_guard
- 用户说"离职""离开公司""清理设备"时，用 cleanup_assistant
- 用户说"该同步什么""最近该带什么文件"时，用 smart_sync_suggestions
- 始终用中文回复，简洁直接
- 执行操作前简要说明你要做什么
- 如果用户意图模糊，先列出最可能的文件让用户确认
- 涉及敏感文件（身份证、银行流水、体检报告、简历等）时，回复中引用文件名可用简称，不要完整复述文件内容中的身份证号、手机号等隐私数字

诚实准则（最高优先级）：
- 工具返回空结果时，必须明确告知用户"没有找到"，绝不可编造答案。
- 当 search_files / list_transfer_messages 返回空列表时，直接说"没有找到相关内容"，可建议换关键词或浏览目录。
- 当 qa 工具返回"没有找到相关文件，无法回答"时，照实转述，不要自行补充"根据一般情况..."等无依据内容。
- 不确定就说"我不确定"或"档案室里没有记录"，不要用"可能是""应该是"来掩盖。
- 禁止在无工具结果支撑的情况下，生成看似具体的内容（金额、日期、条款、文件名等）。
"""


def _get_llm(user_id: str):
    """解析用户大模型配置并构造 OpenAI 客户端，返回 (client, model)。

    单次调用只解析一次配置（避免重复打开 DB 会话 / 解密，并消除配置在两次
    读取之间被改动导致 client 与 model 不一致的时间窗）。
    """
    from ..core.llm_service import get_llm_config
    cfg = get_llm_config(user_id)
    return OpenAI(api_key=cfg.api_key, base_url=cfg.base_url), cfg.model


def chat(user_id: str, user_message: str, history: Optional[list] = None) -> dict:
    client, model = _get_llm(user_id)
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    if history:
        messages.extend(history[-10:])
    messages.append({"role": "user", "content": user_message})

    tool_call_log = []
    max_rounds = 5

    for _ in range(max_rounds):
        response = client.chat.completions.create(
            model=model, messages=messages,
            tools=T.TOOL_SCHEMAS, tool_choice="auto", temperature=0.3,
        )
        msg = response.choices[0].message

        if not msg.tool_calls:
            raw_result = {"reply": msg.content or "", "tool_calls": tool_call_log}
            _save_history(user_id, user_message, raw_result)
            masked_reply, masked_tc = M.mask_result(raw_result["reply"], raw_result["tool_calls"], user_id)
            return {"reply": masked_reply, "tool_calls": masked_tc}

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
                except Exception:
                    logger.exception("tool %s failed for user %s", fn_name, user_id)
                    result = json.dumps({"error": "工具执行失败"}, ensure_ascii=False)
            else:
                result = json.dumps({"error": f"未知工具: {fn_name}"}, ensure_ascii=False)

            tool_call_log[-1]["result"] = result[:500]
            messages.append({"role": "tool", "tool_call_id": tc.id, "content": result})

    raw_result = {"reply": "我已经执行了所需的操作。还有什么需要帮忙吗？", "tool_calls": tool_call_log}
    _save_history(user_id, user_message, raw_result)
    # Mask sensitive data before sending to frontend (raw stays in DB for LLM context)
    masked_reply, masked_tc = M.mask_result(raw_result["reply"], raw_result["tool_calls"], user_id)
    return {"reply": masked_reply, "tool_calls": masked_tc}


def chat_stream(user_id: str, user_message: str, history: Optional[list] = None):
    """流式对话生成器：工具调用阶段静默执行，最终回复逐 token yield。

    yield 的每一项是 dict：
      {"type": "tool", "data": {...}}   — 工具调用通知（可选）
      {"type": "delta", "data": "xxx"}  — 文本增量
      {"type": "done", "data": {...}}   — 完整结果（含 tool_calls）
    """
    import json as _json
    client, model = _get_llm(user_id)
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
            model=model, messages=messages,
            tools=T.TOOL_SCHEMAS, tool_choice="auto", temperature=0.3,
            )
        msg = response.choices[0].message

        if msg.tool_calls:
            messages.append(msg)
            for tc in msg.tool_calls:
                fn_name = tc.function.name
                fn_args = _json.loads(tc.function.arguments or "{}")
                fn_args["user_id"] = user_id
                tool_call_log.append({"tool": fn_name, "args": fn_args})
                # Strip user_id before sending to frontend
                _display_args = {k: v for k, v in fn_args.items() if k != "user_id"}
                yield {"type": "tool", "data": {"tool": fn_name, "args": _display_args}}

                fn = T.TOOL_FUNCTIONS.get(fn_name)
                if fn:
                    try:
                        result = fn(**fn_args)
                    except Exception:
                        logger.exception("tool %s failed for user %s", fn_name, user_id)
                        result = _json.dumps({"error": "工具执行失败"}, ensure_ascii=False)
                else:
                    result = _json.dumps({"error": f"未知工具: {fn_name}"}, ensure_ascii=False)

                tool_call_log[-1]["result"] = result[:500]
                messages.append({"role": "tool", "tool_call_id": tc.id, "content": result})
            continue  # 继续下一轮（可能继续调用工具）
        else:
            # 非流式响应已包含最终回复，直接使用（避免重复请求）
            full_reply = msg.content or ""
            # Mask before sending to frontend (raw saved to DB below)
            _ms = M.MaskSession(user_id)
            _masked_tc = _ms.mask_tool_calls(tool_call_log)
            _masked_reply = _ms.mask_text(full_reply, extra_values=_ms.sensitive_names)
            _ms.flush()
            yield {"type": "delta", "data": _masked_reply}
            break

    else:
        # max_rounds 耗尽（工具调用循环过多）
        full_reply = "我已经执行了所需的操作。还有什么需要帮忙吗？"
        _ms = M.MaskSession(user_id)
        _masked_tc = _ms.mask_tool_calls(tool_call_log)
        _masked_reply = _ms.mask_text(full_reply, extra_values=_ms.sensitive_names)
        _ms.flush()
        yield {"type": "delta", "data": _masked_reply}

    # Save RAW to DB for LLM context; send MASKED to frontend.
    # _masked_reply / _masked_tc are set in either the if-else or for-else branch above.
    raw_result = {"reply": full_reply, "tool_calls": tool_call_log}
    _save_history(user_id, user_message, raw_result)
    yield {"type": "done", "data": {"reply": _masked_reply, "tool_calls": _masked_tc}}


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
        raw = [{
            "role": m.role, "content": m.content,
            "tool_calls": json.loads(m.tool_calls) if m.tool_calls else [],
            "time": str(m.created_at),
        } for m in reversed(msgs)]
    finally:
        db.close()
    # Mask sensitive data for frontend display (raw stays in DB for LLM context)
    return M.mask_history_messages(raw, user_id)


def chat_history_for_llm(user_id: str, limit: int = 10) -> list:
    db = SessionLocal()
    try:
        msgs = db.query(ChatMessage).filter_by(user_id=user_id).order_by(
            ChatMessage.created_at.desc()).limit(limit * 2).all()
        msgs = list(reversed(msgs))
        return [{"role": m.role, "content": m.content} for m in msgs]
    finally:
        db.close()
