"""修改密码加固：change-pwd 限流 + 审计日志 + password_changed_at 字段。

覆盖：
- 旧密码错误计入 change-pwd scope 失败计数，达阈值后 429（持有会话也不能在线爆破旧密码）；
- 成功后清零计数（改密动作自证身份，历史失败不再连累）；
- 新密码策略失败（400）不计入旧密码爆破计数——旧密码已验证正确，身份已确认；
- 审计：password_changed detail 恒为空（零痕迹，不记任何密码相关信息），
  password_change_failed 有记录；
- password_changed_at：注册为 NULL（初始设置不算「修改」），改密后非空，管理端重置后更新。

限流阈值对应 db/models.py LOGIN_LIMIT_MAX_FAILURES = 5。
"""
from auth_helpers import register as _reg, login as _login, grab as _grab, admin_login

LIMIT_MAX = 5


def _change(client, access, old, new):
    return client.post(
        "/api/auth/change-password",
        headers={"Authorization": f"Bearer {access}"},
        json={"old_password": old, "new_password": new},
    )


def test_wrong_old_password_counts_and_locks(client):
    """旧密码错 5 次 → 第 6 次 429（即便这次输对了也不放行）。"""
    access, _, _ = _reg(client, password="Old1234pass")
    for i in range(LIMIT_MAX):
        r = _change(client, access, f"WrongPass{i}x", "New1234pass")
        assert r.status_code == 400, r.text
        assert r.json()["detail"] == "原密码错误"
    r = _change(client, access, "Old1234pass", "New1234pass")
    assert r.status_code == 429
    assert "尝试过于频繁" in r.json()["detail"]


def test_success_resets_failure_count(client):
    """改密成功清零计数：成功后失败重新起算，不被历史失败连累。"""
    access, _, _ = _reg(client, password="Old1234pass")
    # 阈值前 1 次失败后成功改密
    assert _change(client, access, "WrongPass0x", "New1234pass").status_code == 400
    r = _change(client, access, "Old1234pass", "New1234pass")
    assert r.status_code == 200, r.text
    new_access, _ = _grab(client)
    # 若未清零，历史 1 次失败 + 下面 4 次 = 5 → 第 5 次起触发锁定；
    # 清零后这 5 次都只是普通 400（第 5 次才刚达到锁定阈值，本次仍返回 400）
    for i in range(LIMIT_MAX):
        assert _change(client, new_access, f"WrongPass{i}x", "x12345678").status_code == 400


def test_weak_new_password_does_not_count_toward_lockout(client):
    """新密码不合规是用户失误（旧密码已验证正确），不计入爆破计数。"""
    access, _, _ = _reg(client, password="Old1234pass")
    for _ in range(LIMIT_MAX + 2):
        r = _change(client, access, "Old1234pass", "short")
        assert r.status_code == 400
        assert "8" in r.json()["detail"]  # 「密码至少 8 个字符」
    # 未被锁定：旧密码仍被接受，正常改密成功
    r = _change(client, access, "Old1234pass", "New1234pass")
    assert r.status_code == 200, r.text


def test_audit_log_records_change_events(client):
    """审计落库：成功/失败都有记录；成功事件 detail 恒为空（零痕迹）。"""
    access, _, _ = _reg(client, password="Old1234pass")
    _change(client, access, "WrongPass0x", "New1234pass")  # 失败
    r = _change(client, access, "Old1234pass", "New1234pass")  # 成功
    assert r.status_code == 200, r.text
    new_access, _ = _grab(client)  # 旧 access 已被 password_version bump 作废
    logs = client.get(
        "/api/auth/login-history?limit=50",
        headers={"Authorization": f"Bearer {new_access}"},
    ).json()
    actions = [l["action"] for l in logs]
    assert "password_changed" in actions
    assert "password_change_failed" in actions
    ok = next(l for l in logs if l["action"] == "password_changed")
    assert ok["detail"] == ""  # 绝不记录密码相关信息


def test_password_changed_at_lifecycle(client):
    """注册为 NULL（从未修改）→ 改密后非空，/me 可查。"""
    access, _, _ = _reg(client, password="Old1234pass")
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {access}"}).json()
    assert me["password_changed_at"] == ""
    r = _change(client, access, "Old1234pass", "New1234pass")
    assert r.status_code == 200, r.text
    new_access, _ = _grab(client)
    me2 = client.get("/api/auth/me", headers={"Authorization": f"Bearer {new_access}"}).json()
    assert me2["password_changed_at"] != ""


def test_admin_reset_updates_password_changed_at(client):
    """管理端重置用户密码同样刷新 password_changed_at。"""
    access, _, username = _reg(client, password="Old1234pass")
    h = {"Authorization": f"Bearer {access}"}
    me0 = client.get("/api/auth/me", headers=h).json()
    user_id = me0["id"]
    assert me0["password_changed_at"] == ""
    admin_token = admin_login(client)
    r = client.put(
        f"/api/admin/users/{user_id}",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"password": "Reset1234pass"},
    )
    assert r.status_code == 200, r.text
    # 重置 bump password_version，旧 access 已失效，用新密码重新登录验证
    new_access, _ = _login(client, username, "Reset1234pass")
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {new_access}"}).json()
    assert me["password_changed_at"] != ""
