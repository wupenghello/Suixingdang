"""Agent 平台核心测试（S2）：注册表权限、提示词版本、记忆回放、流式脱敏、HITL。"""

import asyncio
from types import SimpleNamespace

import pytest

from app.agent_platform.tools.base import ToolSpec
from app.agent_platform.tools.registry import ToolRegistry, default_registry, get_default_registry
from app.agent_platform.llm.prompts import get_prompt, clear_cache
from app.agent_platform.runtime.context import RunContext
from app.agent_platform.runtime.masking import MaskingStream
from app.agent_platform.runtime import loop as rt_loop
from app.agent_platform.memory.conversation import save_turn, history_to_messages


# ---------- 注册表 ----------

def test_default_registry_has_16_tools():
    reg = default_registry()
    assert len(reg.specs()) == 16
    schemas = reg.openai_schemas()
    assert all(s["type"] == "function" for s in schemas)
    names = {s["function"]["name"] for s in schemas}
    assert {"delete_file", "restore_file", "trash_cleanup_assistant", "qa"} <= names


def test_permission_classification():
    reg = default_registry()
    assert reg.effective_permission("search_files", {}) == "read"
    assert reg.effective_permission("restore_file", {}) == "write"
    # delete_file 默认软删 = write；purge=True 升级为 destructive
    assert reg.effective_permission("delete_file", {"file_path": "a"}) == "write"
    assert reg.effective_permission("delete_file", {"file_path": "a", "purge": True}) == "destructive"


def test_fingerprint_stable_and_user_independent():
    f1 = RunContext.fingerprint("delete_file", {"file_path": "a.txt", "purge": True, "user_id": "u1"})
    f2 = RunContext.fingerprint("delete_file", {"file_path": "a.txt", "purge": True, "user_id": "u2"})
    f3 = RunContext.fingerprint("delete_file", {"purge": True, "file_path": "a.txt"})
    assert f1 == f2 == f3, "指纹应与参数顺序/user_id 无关"
    f4 = RunContext.fingerprint("delete_file", {"file_path": "b.txt", "purge": True})
    assert f4 != f1


# ---------- 提示词版本化 ----------

def test_prompt_registry_loads_versioned():
    clear_cache()
    text, version = get_prompt("file-assistant")
    assert version == "v1"
    assert "诚实准则" in text
    # 16 个工具全部列出（修复历史 14/16 漂移）
    assert "trash_cleanup_assistant" in text and "restore_file" in text


def test_prompt_missing_raises():
    with pytest.raises(FileNotFoundError):
        get_prompt("nonexistent-prompt")


# ---------- 记忆回放（修复多轮丢工具结果） ----------

def test_history_replay_includes_tool_results(client):
    save_turn("u-mem", "那份合同呢？", "已找到合同文件。",
              tool_calls=[{"tool": "search_files", "args": {"query": "合同"}}],
              tool_results=[{"tool": "search_files", "result": '{"files": ["合同.pdf"]}'}],
              trace_id="t-mem")
    msgs = history_to_messages("u-mem", limit=5)
    roles = [m["role"] for m in msgs]
    assert roles == ["user", "assistant", "system"]
    assert "search_files" in msgs[2]["content"], "工具结果摘要应回到上下文"
    assert "合同.pdf" in msgs[2]["content"]


# ---------- 流式脱敏 ----------

def test_masking_stream_holds_back_and_masks():
    ms = MaskingStream("u-mask", holdback=20)
    phone = "13812345678"
    out1 = ms.feed(f"我的电话是 {phone}，")  # 手机号在 holdback 窗口内，不直接吐出
    out2 = ms.feed("请拨打给我。" * 5)
    final = ms.finish()
    combined = out1 + out2 + final
    assert phone not in combined, "完整手机号不得明文出现在流输出"
    assert "我的电话是" in combined


def test_masking_stream_plain_text_passes():
    ms = MaskingStream("u-mask2", holdback=8)
    out = ms.feed("普通文本没有敏感信息，" * 3) + ms.finish()
    assert "普通文本" in out


# ---------- HITL：暂停 → 确定性恢复 ----------

class _FakeToolCallDelta:
    def __init__(self, index, id=None, name=None, arguments=None):
        self.index = index
        self.id = id
        self.function = SimpleNamespace(name=name, arguments=arguments)


def _tool_round(name, args_json, call_id="call_9"):
    return [
        SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(
            content=None, tool_calls=[_FakeToolCallDelta(0, id=call_id, name=name, arguments=args_json)]))], usage=None),
        SimpleNamespace(choices=[], usage=SimpleNamespace(prompt_tokens=5, completion_tokens=3)),
    ]


def _text_round(text):
    return [
        SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content=text, tool_calls=None))], usage=None),
        SimpleNamespace(choices=[], usage=SimpleNamespace(prompt_tokens=5, completion_tokens=3)),
    ]


class _FakeCompletions:
    def __init__(self, rounds):
        self._rounds = list(rounds)

    def create(self, **kwargs):
        return iter(self._rounds.pop(0))


def test_hitl_pauses_and_resumes(monkeypatch, client):
    """destructive 工具首调暂停（不执行），确认后恢复执行。"""
    executed = []

    def nuke(user_id="", **kwargs):
        executed.append(kwargs)
        return '{"ok": true}'

    reg = ToolRegistry()
    reg.register(ToolSpec(
        name="nuke", description="不可逆操作",
        parameters={"type": "object", "properties": {"target": {"type": "string"}}, "required": ["target"]},
        fn=nuke, permission="destructive",
    ))

    # 第一轮：模型调用 nuke → 暂停；第二轮（恢复后）：模型给出最终回复
    client = SimpleNamespace(chat=SimpleNamespace(completions=_FakeCompletions([
        _tool_round("nuke", '{"target": "x"}'),
        _text_round("已经处理完成。"),
    ])))
    monkeypatch.setattr(rt_loop, "resolve_client", lambda uid: (client, "fake"))

    async def run_first():
        ctx = RunContext(user_id="u-hitl", trace_id="t-hitl")
        events = []
        async for ev in rt_loop.run_agent(ctx, "执行 nuke", registry=reg):
            events.append(ev)
        return ctx, events

    ctx, events = asyncio.run(run_first())
    types = [e.type for e in events]
    assert "confirm_request" in types, "应产出确认请求"
    done = [e for e in events if e.type == "done"][-1]
    assert done.data["pending"] is True
    pending_state = done.data["pending_state"]
    assert executed == [], "暂停期间工具不得执行"

    # 恢复：携带确认指纹 + 挂起状态 → 确定性执行 nuke，继续循环
    fp = RunContext.fingerprint("nuke", {"target": "x"})

    async def run_resume():
        ctx2 = RunContext(user_id="u-hitl", trace_id="t-hitl-2", confirmed={fp})
        events2 = []
        async for ev in rt_loop.run_agent(ctx2, resume_state=pending_state, registry=reg):
            events2.append(ev)
        return events2

    events2 = asyncio.run(run_resume())
    assert executed and executed[0]["target"] == "x", "确认后应执行工具"
    done2 = [e for e in events2 if e.type == "done"][-1]
    assert done2.data["pending"] is False
    assert done2.data["reply"] == "已经处理完成。"


def test_hitl_skips_when_preconfirmed(monkeypatch, client):
    """已确认指纹直接执行，不暂停。"""
    executed = []

    def nuke(user_id="", **kwargs):
        executed.append(1)
        return '{"ok": true}'

    reg = ToolRegistry()
    reg.register(ToolSpec(name="nuke", description="d",
                          parameters={"type": "object", "properties": {}},
                          fn=nuke, permission="destructive"))
    client = SimpleNamespace(chat=SimpleNamespace(completions=_FakeCompletions([
        _tool_round("nuke", "{}"),
        _text_round("done"),
    ])))
    monkeypatch.setattr(rt_loop, "resolve_client", lambda uid: (client, "fake"))

    fp = RunContext.fingerprint("nuke", {})

    async def run():
        ctx = RunContext(user_id="u-hitl2", confirmed={fp})
        events = []
        async for ev in rt_loop.run_agent(ctx, "go", registry=reg):
            events.append(ev)
        return events

    events = asyncio.run(run())
    assert executed == [1]
    assert "confirm_request" not in [e.type for e in events]
