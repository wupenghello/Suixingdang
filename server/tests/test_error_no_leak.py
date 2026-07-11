"""错误信息不泄露内部细节测试。

验证两处修复：
- /api/chat 出现意外异常时，返回通用提示而非 str(e)（含内部路径/DB 细节）；
- agent 工具异常时，回传给 LLM 的是通用提示而非 str(e)。
"""
def _h(token):
    return {"Authorization": f"Bearer {token}"}


def test_chat_500_does_not_leak_internals(client, make_user, monkeypatch):
    token, _uid, _ = make_user()
    from app.agent import brain
    from app.core import llm_service

    # 测试环境未配置 LLM，绕过 AI 权限检查以走到 brain.chat
    monkeypatch.setattr(llm_service, "check_ai_access", lambda uid: (True, ""))
    monkeypatch.setattr(brain, "chat_history_for_llm", lambda *a, **k: [])

    def boom(*a, **k):
        raise RuntimeError("SECRET-INTERNAL-PATH-/data/db.sqlite")
    monkeypatch.setattr(brain, "chat", boom)

    r = client.post("/api/chat", json={"message": "hi"}, headers=_h(token))
    assert r.status_code == 500
    assert "SECRET-INTERNAL-PATH" not in r.text
    assert "处理失败" in r.text


def test_tool_error_does_not_leak_internals(client, monkeypatch, user):
    from app.agent import tools
    from app.core import storage

    # storage.delete_file 抛出含「内部细节」的异常
    def boom(*a, **k):
        raise RuntimeError("SECRET-INTERNAL-DB-/data/db.sqlite")
    monkeypatch.setattr(storage, "delete_file", boom)

    result = tools.delete_file(user, "somefile.txt")
    assert "SECRET-INTERNAL-DB" not in result
    assert "删除文件时出错" in result
