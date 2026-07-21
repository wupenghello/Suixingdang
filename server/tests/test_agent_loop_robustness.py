"""Agent 循环健壮性回归测试（S0 止血）。

覆盖：
- 模型吐出坏 JSON 工具参数不再炸成 500/断流，而是作为 tool result 回喂
- 工具真实异常以异常类名回喂模型（细节只进服务端日志，不泄露内部路径）
- LLM 客户端强制 timeout=60s + max_retries=0（防 30 分钟钉连接）
"""

from types import SimpleNamespace

import pytest

from app.agent import brain
from app.agent import tools as T


# ---------- 假 OpenAI 客户端 ----------

class FakeToolCall:
    def __init__(self, name, arguments, call_id="call_1"):
        self.id = call_id
        self.function = SimpleNamespace(name=name, arguments=arguments)


class FakeMessage:
    def __init__(self, content=None, tool_calls=None):
        self.content = content
        self.tool_calls = tool_calls


class FakeCompletions:
    """按顺序返回预置响应，并记录每次 create 的入参。"""

    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(choices=[SimpleNamespace(message=self._responses.pop(0))])


def _make_client(responses):
    completions = FakeCompletions(responses)
    client = SimpleNamespace(chat=SimpleNamespace(completions=completions))
    return client, completions


def _role(m):
    """messages 列表里混有 dict 与 FakeMessage，统一取 role/content。"""
    return m["role"] if isinstance(m, dict) else getattr(m, "role", None)


def _content(m):
    return m["content"] if isinstance(m, dict) else getattr(m, "content", None)


@pytest.fixture
def no_history_save(monkeypatch):
    monkeypatch.setattr(brain, "_save_history", lambda *a, **k: None)


def _stub_llm(monkeypatch, client):
    monkeypatch.setattr(brain, "_get_llm", lambda user_id: (client, "fake-model"))


# ---------- 1. 坏 JSON 工具参数 ----------

def test_malformed_tool_args_do_not_crash(monkeypatch, no_history_save):
    """模型吐出 '{bad json' 时：不抛异常，错误作为 tool result 回喂，循环继续。"""
    client, completions = _make_client([
        FakeMessage(tool_calls=[FakeToolCall("search_files", "{bad json")]),
        FakeMessage(content="我重新组织一下参数"),
    ])
    _stub_llm(monkeypatch, client)

    result = brain.chat("u-robust", "找文件")

    assert result["reply"] == "我重新组织一下参数"
    # 第二次调用携带了"参数解析失败"的 tool result
    second_messages = completions.calls[1]["messages"]
    tool_msgs = [m for m in second_messages if _role(m) == "tool"]
    assert len(tool_msgs) == 1
    assert "参数解析失败" in _content(tool_msgs[0])


def test_non_object_tool_args_do_not_crash(monkeypatch, no_history_save):
    """参数是合法 JSON 但非对象（如 '[1,2]'）同样要优雅处理。"""
    client, _ = _make_client([
        FakeMessage(tool_calls=[FakeToolCall("search_files", "[1, 2]")]),
        FakeMessage(content="ok"),
    ])
    _stub_llm(monkeypatch, client)
    result = brain.chat("u-robust", "x")
    assert result["reply"] == "ok"


# ---------- 2. 工具异常回喂（不泄露内部信息） ----------

def test_tool_exception_fed_back_with_class_name_only(monkeypatch, no_history_save):
    SECRET = "/data/db.sqlite-SECRET-PATH"

    def boom(**kwargs):
        raise ValueError(f"内部错误涉及 {SECRET}")

    monkeypatch.setattr(T, "TOOL_FUNCTIONS", {**T.TOOL_FUNCTIONS, "boom_tool": boom})
    monkeypatch.setattr(T, "TOOL_SCHEMAS", T.TOOL_SCHEMAS)

    client, completions = _make_client([
        FakeMessage(tool_calls=[FakeToolCall("boom_tool", "{}")]),
        FakeMessage(content="工具出错了，我换个方式"),
    ])
    _stub_llm(monkeypatch, client)

    result = brain.chat("u-robust", "触发异常")
    assert result["reply"] == "工具出错了，我换个方式"

    second_messages = completions.calls[1]["messages"]
    tool_msg = [m for m in second_messages if _role(m) == "tool"][0]
    tool_content = _content(tool_msg)
    # 模型看得到异常类名（可据此调整策略）
    assert "ValueError" in tool_content
    # 但看不到内部路径细节（防泄露进 LLM 上下文 → 前端）
    assert SECRET not in tool_content
    # 工具调用日志同样不泄露
    assert all(SECRET not in str(tc.get("result", "")) for tc in result["tool_calls"])


# ---------- 3. 超时/重试策略 ----------

def test_llm_client_forced_timeout_and_no_retry(monkeypatch):
    captured = {}

    def fake_openai(**kwargs):
        captured.update(kwargs)
        return object()

    from app.core import llm_service
    monkeypatch.setattr(llm_service, "get_llm_config",
                        lambda user_id: SimpleNamespace(api_key="k", base_url="https://x.invalid", model="m"))
    monkeypatch.setattr(brain, "OpenAI", fake_openai)

    client, model = brain._get_llm("u")
    assert captured["timeout"] == 60.0
    assert captured["max_retries"] == 0
    assert model == "m"


def test_tools_llm_client_forced_timeout_and_no_retry(monkeypatch):
    """tools.py 的 _call_llm 同样不得继承 SDK 默认 ~600s 超时 + 2 次重试。"""
    import openai as openai_mod
    captured = {}

    def fake_openai(**kwargs):
        captured.update(kwargs)
        raise RuntimeError("stop-here")  # 只捕获构造参数

    from app.core import llm_service
    monkeypatch.setattr(llm_service, "get_llm_config",
                        lambda user_id: SimpleNamespace(api_key="k", base_url="https://x.invalid", model="m"))
    monkeypatch.setattr(openai_mod, "OpenAI", fake_openai)  # _call_llm 函数内 from openai import OpenAI

    with pytest.raises(RuntimeError, match="stop-here"):
        T._call_llm("sys", "user", user_id="u")
    assert captured["timeout"] == 60.0
    assert captured["max_retries"] == 0
