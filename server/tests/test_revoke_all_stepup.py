"""吊销全部令牌的步骤验证（step-up）：重输登录密码 + 限流 + 失败审计。

破坏面最大的不可逆操作要求密码门槛，防劫持会话者一键清场；
与改密同源威胁模型，走独立 stepup 限流 scope。
"""
from auth_helpers import register as _reg

LIMIT_MAX = 5


def _revoke_all(client, access, password=None):
    # TestClient.delete 不支持 json 参数，走通用 request
    kwargs = {"headers": {"Authorization": f"Bearer {access}"}}
    if password is not None:
        kwargs["json"] = {"password": password}
    return client.request("DELETE", "/api/auth/tokens", **kwargs)


def test_revoke_all_requires_correct_password(client):
    """密码错误 → 400 且不吊销；正确 → 200 且全部失效。"""
    access, refresh, _ = _reg(client, password="Right1234pass")
    h = {"Authorization": f"Bearer {access}"}
    r = _revoke_all(client, access, "WrongPass1x")
    assert r.status_code == 400
    assert r.json()["detail"] == "密码错误"
    # 未吊销：会话仍有效
    assert client.get("/api/auth/me", headers=h).status_code == 200
    r = _revoke_all(client, access, "Right1234pass")
    assert r.status_code == 200, r.text
    assert client.get("/api/auth/me", headers=h).status_code == 401  # 已全部吊销


def test_revoke_all_missing_password_rejected(client):
    """无 body / 空密码（旧客户端兼容路径）→ 400「需要密码验证」，且不计入爆破计数。"""
    access, _, _ = _reg(client, password="Right1234pass")
    assert _revoke_all(client, access, None).status_code == 400
    r = _revoke_all(client, access, "")
    assert r.status_code == 400
    assert r.json()["detail"] == "需要密码验证"
    # 空密码是客户端错误而非猜测：连发 5 次空调用后正确密码仍通过（未被锁）
    for _ in range(LIMIT_MAX):
        assert _revoke_all(client, access, None).status_code == 400
    r = _revoke_all(client, access, "Right1234pass")
    assert r.status_code == 200, r.text


def test_revoke_all_wrong_password_counts_and_locks(client):
    """密码错 5 次 → stepup scope 锁定，第 6 次 429（即便密码正确）。"""
    access, _, _ = _reg(client, password="Right1234pass")
    for i in range(LIMIT_MAX):
        assert _revoke_all(client, access, f"WrongPass{i}x").status_code == 400
    r = _revoke_all(client, access, "Right1234pass")
    assert r.status_code == 429
    assert "尝试过于频繁" in r.json()["detail"]


def test_revoke_all_failure_is_audited(client):
    """失败审计落库（stepup_failed）。吊销后旧令牌已死，重新登录读历史验证。"""
    access, _, username = _reg(client, password="Right1234pass")
    _revoke_all(client, access, "WrongPass1x")  # 失败 → stepup_failed 审计
    r = _revoke_all(client, access, "Right1234pass")  # 成功 → 全部吊销
    assert r.status_code == 200, r.text
    # 吊销不签发新会话；密码本身未变，重新登录后读自己的审计历史
    from auth_helpers import login as _login
    new_access, _ = _login(client, username, "Right1234pass")
    logs = client.get(
        "/api/auth/login-history?limit=50",
        headers={"Authorization": f"Bearer {new_access}"},
    ).json()["items"]
    actions = [l["action"] for l in logs]
    assert "stepup_failed" in actions
    assert "revoke_all_tokens" in actions


def test_stepup_budget_shared_across_endpoints(client):
    """同一凭证一份预算：改密与吊销共享 stepup scope，失败计数跨端点累加。

    回归 D2：此前 change-pwd 与 stepup 是独立 scope，攻击者交替调用两个端点
    即可把 5 次猜测预算翻倍。"""
    access, _, _ = _reg(client, password="Right1234pass")
    h = {"Authorization": f"Bearer {access}"}
    # 改密端点错 3 次
    for i in range(3):
        r = client.post("/api/auth/change-password", headers=h,
                        json={"old_password": f"WrongPass{i}x", "new_password": "New1234pass"})
        assert r.status_code == 400
    # 吊销端点再错 2 次 → 共享计数达阈值
    for i in range(2):
        assert _revoke_all(client, access, f"WrongPass{i}x").status_code == 400
    # 两个端点同时被锁：正确密码也 429
    assert _revoke_all(client, access, "Right1234pass").status_code == 429
    r = client.post("/api/auth/change-password", headers=h,
                    json={"old_password": "Right1234pass", "new_password": "New1234pass"})
    assert r.status_code == 429
