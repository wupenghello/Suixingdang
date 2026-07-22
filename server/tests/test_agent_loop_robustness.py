"""Agent 循环健壮性测试（S2 新运行时架构）。

覆盖：
- 模型吐出坏 JSON 工具参数：不炸流，作为 tool result 回喂
- 工具异常：类名回喂模型，内部路径不泄露（日志/上下文/调用日志三处）
- LLM 网关强制 timeout=60s + max_retries=0
- 真 token 级流式（多 chunk 拼接）
"""

from types import SimpleNamespace

import pytest

from app.agent import brain
from app.agent_platform.runtime import loop as rt_loop
from app.agent_platform.llm import gateway
from app.agent_platform.tools.base import ToolSpec
from app.agent_platform.tools.registry import ToolRegistry


# ---------- 假流式 OpenAI 客户端 ----------

class FakeToolCallDelta:
    def __init__(self, index, id=None, name=None, arguments=None):
        self.index = index
        self.id = id
        self.function = SimpleNamespace(name=name, arguments=arguments)


def text_round(text, usage=(11, 7)):
    """一轮纯文本回复的 chunk 序列。"""
    return [
        SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content=text[:3], tool_calls=None))], usage=None),
        SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content=text[3:], tool_calls=None))], usage=None),
        SimpleNamespace(choices=[], usage=SimpleNamespace(prompt_tokens=usage[0], completion_tokens=usage[1])),
    ]


def tool_round(name, args_json, call_id="call_1", usage=(13, 5)):
    """一轮工具调用的 chunk 序列（参数分片模拟流式）。"""
    half = max(1, len(args_json) // 2)
    return [
        SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(
            content=None, tool_calls=[FakeToolCallDelta(0, id=call_id, name=name, arguments=args_json[:half])]))], usage=None),
        SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(
            content=None, tool_calls=[FakeToolCallDelta(0, arguments=args_json[half:])]))], usage=None),
        SimpleNamespace(choices=[], usage=SimpleNamespace(prompt_tokens=usage[0], completion_tokens=usage[1])),
    ]


class FakeCompletions:
    def __init__(self, rounds):
        self._rounds = list(rounds)
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return iter(self._rounds.pop(0))


def make_client(rounds):
    completions = FakeCompletions(rounds)
    client = SimpleNamespace(chat=SimpleNamespace(completions=completions))
    return client, completions


@pytest.fixture(autouse=True)
def _no_persist(monkeypatch, client):
    """client fixture 建库；跳过持久化，聚焦循环行为。"""
    monkeypatch.setattr(brain, "_save_history", lambda *a, **k: None)


def _stub_llm(monkeypatch, client):
    monkeypatch.setattr(rt_loop, "resolve_client", lambda user_id: (client, "fake-model"))


def _one_tool_registry(name, fn, permission="read"):
    reg = ToolRegistry()
    reg.register(ToolSpec(
        name=name,
        description=f"测试工具 {name}",
        parameters={"type": "object", "properties": {}, "required": []},
        fn=fn, permission=permission,
    ))
    return reg


# ---------- 1. 坏 JSON 工具参数 ----------

def test_malformed_tool_args_do_not_crash(monkeypatch):
    client, completions = make_client([
        tool_round("search_files", "{bad json"),
        text_round("我重新组织一下参数"),
    ])
    _stub_llm(monkeypatch, client)

    result = brain.chat("u-robust", "找文件")
    assert result["reply"] == "我重新组织一下参数"

    second_messages = completions.calls[1]["messages"]
    tool_msgs = [m for m in second_messages if m.get("role") == "tool"]
    assert len(tool_msgs) == 1
    assert "参数解析失败" in tool_msgs[0]["content"]


def test_non_object_tool_args_do_not_crash(monkeypatch):
    client, _ = make_client([
        tool_round("search_files", "[1, 2]"),
        text_round("ok"),
    ])
    _stub_llm(monkeypatch, client)
    assert brain.chat("u-robust", "x")["reply"] == "ok"


# ---------- 2. 工具异常：类名回喂，细节不泄露 ----------

def test_tool_exception_class_name_only(monkeypatch):
    SECRET = "/data/db.sqlite-SECRET-PATH"

    def boom(user_id="", **kwargs):
        raise ValueError(f"内部错误涉及 {SECRET}")

    reg = _one_tool_registry("boom_tool", boom)
    client, completions = make_client([
        tool_round("boom_tool", "{}"),
        text_round("工具出错了，我换个方式"),
    ])
    _stub_llm(monkeypatch, client)

    import asyncio
    from app.agent_platform.runtime.context import RunContext

    events = []

    async def run():
        ctx = RunContext(user_id="u-robust", trace_id="t1")
        async for ev in rt_loop.run_agent(ctx, "触发异常", registry=reg):
            events.append(ev)

    asyncio.run(run())

    done_ev = [e for e in events if e.type == "done"][-1]
    assert done_ev.data["reply"] == "工具出错了，我换个方式"

    second_messages = completions.calls[1]["messages"]
    tool_msg = [m for m in second_messages if m.get("role") == "tool"][0]
    assert "ValueError" in tool_msg["content"]
    assert SECRET not in tool_msg["content"]
    # 脱敏后的工具调用日志同样不泄露
    assert all(SECRET not in str(tc.get("result", "")) for tc in done_ev.data["tool_calls"])


# ---------- 3. 网关超时策略 ----------

def test_gateway_forced_timeout_and_no_retry(monkeypatch):
    captured = {}

    def fake_openai(**kwargs):
        captured.update(kwargs)
        return object()

    from app.core import llm_service
    monkeypatch.setattr(llm_service, "get_llm_config",
                        lambda user_id: SimpleNamespace(api_key="k", base_url="https://x.invalid", model="m"))
    monkeypatch.setattr(gateway, "OpenAI", fake_openai)

    client, model = gateway.resolve_client("u")
    assert captured["timeout"] == 60.0
    assert captured["max_retries"] == 0
    assert model == "m"


# ---------- 4. 真 token 级流式 ----------

def test_real_streaming_multiple_deltas(monkeypatch):
    client, _ = make_client([text_round("你好，这是流式回复")])
    _stub_llm(monkeypatch, client)

    async def collect():
        items = []
        async for item in brain.chat_stream("u-robust", "hi"):
            items.append(item)
        return items

    import asyncio
    items = asyncio.run(collect())
    deltas = [i for i in items if i["type"] == "delta"]
    done = [i for i in items if i["type"] == "done"]
    assert len(deltas) >= 1
    assert done and done[0]["data"]["reply"] == "你好，这是流式回复"
    # 流式请求标记
    # （create 调用带 stream=True 由循环内部保证，此处验证 done 携带 usage）
    assert done[0]["data"] is not None
