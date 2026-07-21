"""Agent 运行时主循环（S2 核心）。

真 token 级流式 + 工具循环 + HITL 挂起/恢复 + 流式脱敏 + usage 捕获。
引擎当前为 OpenAI 兼容 SDK 实现；runtime 对外只暴露事件协议（events.py），
未来替换 Pydantic AI 等引擎只需重写本文件，上层（chat 端点/前端）无感。

HITL 协议：destructive 工具（如 delete_file purge=true）在首次调用时不执行，
产出 confirm_request 事件并以 done(pending=True, pending_state=...) 收尾；
确认端点凭 pending_state + 已确认指纹调用 run_agent(resume_state=...) 恢复：
从挂起点确定性继续（不重新询问模型）。
"""

import json
import logging
import time
from typing import AsyncIterator

from .context import RunContext
from . import events as E
from .masking import MaskingStream
from ..tools.registry import ToolRegistry, get_default_registry
from ..llm.gateway import resolve_client
from ..llm.prompts import get_prompt

logger = logging.getLogger(__name__)

SYSTEM_PROMPT_NAME = "file-assistant"


def _system_message() -> dict:
    text, _version = get_prompt(SYSTEM_PROMPT_NAME)
    return {"role": "system", "content": text}


async def run_agent(
    ctx: RunContext,
    message: str = "",
    history: list | None = None,
    *,
    resume_state: dict | None = None,
    registry: ToolRegistry | None = None,
) -> AsyncIterator[E.AgentEvent]:
    """运行一轮 agent 对话，产出事件流。

    - 普通模式：message + history
    - 恢复模式：resume_state = {"messages": [...], "pending": {"tool_call_id","name","arguments"}}
      （调用前应把批准的指纹加入 ctx.confirmed）
    """
    registry = registry or get_default_registry()
    masking = MaskingStream(ctx.user_id)
    tool_call_log: list[dict] = []
    usage_out: dict = {}
    t_start = time.time()

    if resume_state:
        messages = list(resume_state["messages"])
        pending = resume_state.get("pending")
    else:
        messages = [_system_message()]
        messages.extend(history or [])
        messages.append({"role": "user", "content": message})
        pending = None

    try:
        client, model = resolve_client(ctx.user_id)
    except Exception as e:
        logger.warning("resolve LLM client failed for user %s: %s", ctx.user_id, e)
        yield E.error(str(e), code="LLM_UNAVAILABLE")
        return

    tools_schema = registry.openai_schemas()

    # ---- 恢复模式：先执行被挂起的破坏性调用（确定性继续，不重新问模型） ----
    if pending:
        async for ev in _exec_tool_calls(
            ctx, registry, client, model, messages,
            [pending], tool_call_log, masking, usage_out,
        ):
            if ev.type == "done" and ev.data.get("pending"):
                yield ev
                return  # 又一个调用需要确认
            yield ev

    # ---- 主循环 ----
    for _round in range(ctx.max_rounds):
        content_buf = ""
        tool_calls_acc: dict[int, dict] = {}  # index -> {id, name, arguments}

        try:
            stream = client.chat.completions.create(
                model=model, messages=messages,
                tools=tools_schema, tool_choice="auto", temperature=0.3,
                stream=True, stream_options={"include_usage": True},
            )
            for chunk in stream:
                if getattr(chunk, "usage", None):
                    u = chunk.usage
                    usage_out = {
                        "input_tokens": getattr(u, "prompt_tokens", 0) or 0,
                        "output_tokens": getattr(u, "completion_tokens", 0) or 0,
                    }
                if not chunk.choices:
                    continue
                d = chunk.choices[0].delta
                if d and d.content:
                    content_buf += d.content
                    out = masking.feed(d.content)
                    if out:
                        yield E.delta(out)
                if d and d.tool_calls:
                    for tc in d.tool_calls:
                        slot = tool_calls_acc.setdefault(
                            tc.index or 0, {"id": "", "name": "", "arguments": ""})
                        if tc.id:
                            slot["id"] = tc.id
                        if tc.function and tc.function.name:
                            slot["name"] += tc.function.name
                        if tc.function and tc.function.arguments:
                            slot["arguments"] += tc.function.arguments
        except Exception as e:
            logger.exception("agent stream failed for user %s", ctx.user_id)
            yield E.error("处理失败，请稍后重试", code="LLM_STREAM_ERROR")
            return

        if not tool_calls_acc:
            # 最终回复：释放脱敏缓冲，产出规范 done
            tail = masking.finish()
            if tail:
                yield E.delta(tail)
            masked_reply = masking.mask_full(content_buf)
            yield E.done(
                reply=masked_reply,
                tool_calls=_masked_tool_log(masking, tool_call_log),
                trace_id=ctx.trace_id,
                usage=usage_out,
                raw_reply=content_buf,
                raw_tool_calls=list(tool_call_log),
            )
            return

        # 助手工具调用消息入上下文
        messages.append({
            "role": "assistant", "content": content_buf or None,
            "tool_calls": [
                {"id": tc["id"] or f"call_{i}", "type": "function",
                 "function": {"name": tc["name"], "arguments": tc["arguments"]}}
                for i, tc in tool_calls_acc.items()
            ],
        })

        pending_calls = [
            {"tool_call_id": tc["id"] or f"call_{i}",
             "name": tc["name"], "arguments": tc["arguments"]}
            for i, tc in tool_calls_acc.items()
        ]
        async for ev in _exec_tool_calls(
            ctx, registry, client, model, messages,
            pending_calls, tool_call_log, masking, usage_out,
        ):
            if ev.type == "done" and ev.data.get("pending"):
                yield ev
                return  # 挂起等待确认
            yield ev

    # 达到最大轮次
    yield E.done(
        reply="我已经执行了所需的操作。还有什么需要帮忙吗？",
        tool_calls=_masked_tool_log(masking, tool_call_log),
        trace_id=ctx.trace_id, usage=usage_out,
        raw_reply="我已经执行了所需的操作。还有什么需要帮忙吗？",
        raw_tool_calls=list(tool_call_log),
    )


async def _exec_tool_calls(ctx, registry, client, model, messages,
                           calls, tool_call_log, masking, usage_out):
    """执行一批工具调用；遇未确认的 destructive 调用 → 挂起（产出 confirm_request + pending done）。"""
    for call in calls:
        name = call["name"]
        raw_args = call.get("arguments") or "{}"
        tool_call_id = call.get("tool_call_id") or "call_x"

        try:
            args = json.loads(raw_args)
            if not isinstance(args, dict):
                raise ValueError("工具参数必须是 JSON 对象")
        except (json.JSONDecodeError, ValueError):
            logger.warning("tool %s args parse failed: %r", name, raw_args[:200])
            err = json.dumps({"error": "工具参数解析失败，请检查参数格式后重试"}, ensure_ascii=False)
            tool_call_log.append({"tool": name, "args": {}, "result": err[:500]})
            messages.append({"role": "tool", "tool_call_id": tool_call_id, "content": err})
            continue

        permission = registry.effective_permission(name, args)
        fingerprint = RunContext.fingerprint(name, args)

        if permission == "destructive" and fingerprint not in ctx.confirmed:
            # HITL 挂起：不执行，等待用户确认。挂起状态随 done 事件外传，
            # 调用方持久化后凭此 + 已确认指纹确定性恢复（不重新询问模型）。
            display_args = {k: v for k, v in args.items() if k != "user_id"}
            yield E.confirm_request(
                call_id=fingerprint, tool=name, args=display_args,
                message=f"即将执行不可逆操作「{name}」，请确认",
            )
            yield E.done(
                reply="我需要你确认后再继续这个操作。",
                tool_calls=_masked_tool_log(masking, tool_call_log),
                trace_id=ctx.trace_id, pending=True,
                usage=usage_out,
                raw_reply="我需要你确认后再继续这个操作。",
                raw_tool_calls=list(tool_call_log),
                pending_state={
                    "messages": messages,
                    "pending": {"tool_call_id": tool_call_id, "name": name, "arguments": raw_args},
                },
            )
            return

        display_args = {k: v for k, v in args.items() if k != "user_id"}
        yield E.tool_start(name, display_args)

        spec = registry.get(name)
        args["user_id"] = ctx.user_id  # 租户隔离注入
        if spec:
            try:
                result = spec.fn(**args)
                ok = '"error"' not in (result or "")[:80]
            except Exception as e:
                # 异常类名回喂模型（细节只进日志，防泄露内部路径）
                logger.exception("tool %s failed for user %s", name, ctx.user_id)
                result = json.dumps({"error": f"工具执行出错: {type(e).__name__}"}, ensure_ascii=False)
                ok = False
        else:
            result = json.dumps({"error": f"未知工具: {name}"}, ensure_ascii=False)
            ok = False

        tool_call_log.append({"tool": name, "args": args, "result": result[:500]})
        messages.append({"role": "tool", "tool_call_id": tool_call_id, "content": result})
        yield E.tool_end(name, ok=ok, summary=(result or "")[:160])


def _masked_tool_log(masking: MaskingStream, tool_call_log: list[dict]) -> list[dict]:
    """工具调用日志脱敏（移除 user_id，遮罩参数与结果中的敏感值）。"""
    out = []
    for tc in tool_call_log:
        args = {k: v for k, v in (tc.get("args") or {}).items() if k != "user_id"}
        out.append({
            "tool": tc["tool"],
            "args": args,
            "result": masking.mask_full(str(tc.get("result", "")))[:500],
        })
    return out
