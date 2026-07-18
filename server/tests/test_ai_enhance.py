"""AI 整理（ai-enhance / ai-status / notes / ai-tags）端点测试。

覆盖：
- ai-status 可用性探测（无 LLM 配置时应 available=False 且带原因）
- ai-enhance 的 404 / 403 边界与校验顺序
- ai-enhance 限流（10 次/分钟后 429）；404 在限流之前、不消耗限流配额
- GET /notes：pinned 优先、字段齐全
- POST /ai-tags：覆盖、清洗、404

LLM 调用本身不在此测试（需要真实 API Key），由 promptfoo 评测覆盖输出质量；
限流用例用 monkeypatch mock get_llm_config + chat_complete，避免真实网络。
"""

import pytest

from auth_helpers import register


def _h(token):
    return {"Authorization": f"Bearer {token}"}


def test_ai_status_requires_auth(client):
    r = client.get("/api/files/ai-status")
    assert r.status_code == 401


def test_ai_status_no_llm_configured(client, make_user):
    """测试环境无 LLM 配置：available=False，且 reason 非空（供前端展示降级提示）。"""
    token, _uid, _name = make_user()
    r = client.get("/api/files/ai-status", headers=_h(token))
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["available"] is False
    assert isinstance(data["reason"], str) and data["reason"]


def test_ai_enhance_note_not_found(client, make_user):
    token, _uid, _name = make_user()
    r = client.post("/api/files/ai-enhance", headers=_h(token),
                    params={"path": "不存在的笔记.md"})
    assert r.status_code == 404


def test_ai_enhance_no_llm_returns_403(client, make_user):
    """笔记存在但未配置 LLM：403（前端据此隐藏 AI 入口）。

    新校验顺序下 403 仍在限流之前，故未配置 LLM 时不会消耗限流配额。
    """
    token, _uid, _name = make_user()
    headers = _h(token)
    r = client.post("/api/files/note", headers=headers,
                    json={"name": "AI测试笔记", "content": "这是一段用于 AI 整理的测试内容。"})
    assert r.status_code == 200, r.text
    r = client.post("/api/files/ai-enhance", headers=headers,
                    params={"path": "AI测试笔记.md"})
    assert r.status_code == 403, r.text


def test_ai_enhance_404_does_not_consume_rate_limit(client, make_user):
    """404 在限流之前：对不存在的路径连打 11 次应全部 404，绝不触发 429。"""
    token, _uid, _name = make_user()
    headers = _h(token)
    for _ in range(11):
        r = client.post("/api/files/ai-enhance", headers=headers,
                        params={"path": "不存在的笔记.md"})
        assert r.status_code == 404, r.text


def test_ai_enhance_rate_limit(client, make_user, monkeypatch):
    """同一用户 10 次/分钟后触发 429（防 LLM 成本被刷）。

    新顺序下 404 在限流之前；这里用真实笔记 + mock get_llm_config / chat_complete，
    使请求走到限流与 LLM 调用逻辑（不触发真实网络）。mock 返回非空 JSON，
    故每次调用只消耗 1 次限流配额：前 10 次通过，第 11 次 429。
    """
    token, _uid, _name = make_user()
    headers = _h(token)
    # 建一篇真实笔记（文件存在 + 内容提取通过）
    r = client.post("/api/files/note", headers=headers,
                    json={"name": "限流笔记", "content": "用于 AI 整理的测试内容，需要足够文本以通过提取。"})
    assert r.status_code == 200, r.text
    path = r.json()["path"]

    # mock：放行 AI 配置（返回假 LlmConfig）+ chat_complete 立即返回非空 JSON
    from app.core import llm_service
    from app.core.llm_service import LlmConfig
    monkeypatch.setattr(llm_service, "get_llm_config",
                        lambda uid: LlmConfig(api_key="k", base_url="http://x", model="m"))
    import app.api.files as files_mod
    monkeypatch.setattr(files_mod, "chat_complete",
                        lambda *a, **k: '{"summary":"一句话摘要","tags":["工作","待办"]}')

    # 前 10 次通过限流（mock 立即返回，200）
    for i in range(10):
        rr = client.post("/api/files/ai-enhance", headers=headers, params={"path": path})
        assert rr.status_code == 200, f"第 {i + 1} 次不应被限流: {rr.status_code} {rr.text}"
    # 第 11 次：限流锁定 -> 429
    r = client.post("/api/files/ai-enhance", headers=headers, params={"path": path})
    assert r.status_code == 429, r.text


def test_list_notes(client, make_user):
    """GET /notes 返回当前用户全部 .md 笔记，pinned 优先、其次 modified_at 倒序，字段齐全。"""
    token, _uid, _name = make_user()
    headers = _h(token)
    r1 = client.post("/api/files/note", headers=headers,
                     json={"name": "笔记A", "content": "A 的内容"})
    assert r1.status_code == 200, r1.text
    path_a = r1.json()["path"]
    r2 = client.post("/api/files/note", headers=headers,
                     json={"name": "笔记B", "content": "B 的内容"})
    assert r2.status_code == 200, r2.text
    path_b = r2.json()["path"]
    # 置顶 B
    pin = client.put("/api/files/pin", headers=headers,
                     json={"path": path_b, "pinned": True})
    assert pin.status_code == 200, pin.text

    r = client.get("/api/files/notes", headers=headers)
    assert r.status_code == 200, r.text
    notes = r.json()["notes"]
    paths = [n["path"] for n in notes]
    assert path_a in paths and path_b in paths
    # pinned 优先：B 排在 A 之前
    assert paths.index(path_b) < paths.index(path_a)
    # 字段齐全
    nb = next(n for n in notes if n["path"] == path_b)
    for key in ("file_id", "path", "name", "summary", "tags", "ai_tags",
                "pinned", "modified", "size", "group_id", "group_name"):
        assert key in nb, f"缺少字段 {key}"
    assert nb["pinned"] is True
    assert isinstance(nb["tags"], list)
    assert isinstance(nb["ai_tags"], list)
    assert isinstance(nb["modified"], (int, float)) and nb["modified"] >= 0
    assert isinstance(nb["size"], int) and nb["size"] >= 0


def test_set_ai_tags(client, make_user):
    """POST /ai-tags 整体覆盖笔记的 AI 建议标签（含清洗）；不存在路径 404。"""
    token, _uid, _name = make_user()
    headers = _h(token)
    r = client.post("/api/files/note", headers=headers,
                    json={"name": "标签笔记", "content": "一些内容"})
    assert r.status_code == 200, r.text
    path = r.json()["path"]

    # 清洗：去重 + 去空白 + 限长（>30 的剔除）
    r = client.post("/api/files/ai-tags", headers=headers, params={"path": path},
                    json={"tags": ["工作", "待办", "待办", "   ", "x" * 50, "灵感"]})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["ok"] is True
    assert data["tags"] == ["工作", "待办", "灵感"]

    # 覆盖：剩余建议持久化（避免重开时被忽略的标签复活）
    r = client.post("/api/files/ai-tags", headers=headers, params={"path": path},
                    json={"tags": ["灵感"]})
    assert r.status_code == 200, r.text
    assert r.json()["tags"] == ["灵感"]
    # 落库可读回
    nc = client.get("/api/files/note-content", headers=headers, params={"path": path})
    assert nc.status_code == 200, nc.text
    assert nc.json()["ai_tags"] == ["灵感"]

    # 不存在路径 404（owner 隔离）
    r = client.post("/api/files/ai-tags", headers=headers,
                    params={"path": "不存在.md"}, json={"tags": []})
    assert r.status_code == 404, r.text
