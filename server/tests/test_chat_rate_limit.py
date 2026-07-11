"""聊天接口按用户限流测试。

验证 /api/chat 在窗口内超过 CHAT_RATE_LIMIT_MAX 次后返回 429，且限流按用户隔离。
测试环境未配置 LLM：_check_ai_access 先跑（已放行），故放行的请求会走到 brain.chat
并因 NoLlmConfigured 返回 403（而非 200），但 403 ≠ 429，足以区分「被限流」与「未限流」。
"""
import pytest
from app.db.models import CHAT_RATE_LIMIT_MAX


def _h(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(autouse=True)
def _allow_ai(monkeypatch):
    """测试环境未配置 LLM；放行 AI 权限检查，使请求走到限流逻辑。"""
    from app.core import llm_service
    monkeypatch.setattr(llm_service, "check_ai_access", lambda uid: (True, ""))


def test_chat_rate_limit_blocks_after_max(client, make_user):
    token, _uid, _ = make_user()
    # 前 MAX 次：限流放行（不应 429）
    for i in range(CHAT_RATE_LIMIT_MAX):
        r = client.post("/api/chat", json={"message": "hi"}, headers=_h(token))
        assert r.status_code != 429, f"第 {i + 1} 次请求不应被限流，实际 {r.status_code}"
    # 第 MAX+1 次起：被限流
    for _ in range(5):
        r = client.post("/api/chat", json={"message": "hi"}, headers=_h(token))
        assert r.status_code == 429, f"超限后应返回 429，实际 {r.status_code}"


def test_chat_rate_limit_is_per_user(client, make_user):
    token_a, _uid_a, _ = make_user()
    token_b, _uid_b, _ = make_user()
    # A 打满配额并被锁
    for _ in range(CHAT_RATE_LIMIT_MAX + 3):
        client.post("/api/chat", json={"message": "hi"}, headers=_h(token_a))
    # B 不受 A 影响
    r = client.post("/api/chat", json={"message": "hi"}, headers=_h(token_b))
    assert r.status_code != 429, "A 的限流不应连累 B"
