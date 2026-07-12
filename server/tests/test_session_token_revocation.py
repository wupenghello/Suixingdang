"""浏览器会话令牌吊销 + 密码版本号 + refresh（不轮转）的端到端验证。

覆盖安全改动的行为契约：
- 浏览器登录会话进 access_tokens 表（kind=session），可在设置页吊销；
- 改/重置密码 bump password_version，旧 access/refresh 立即失效；
- revoke_all 同时 bump password_version，已签发的 access JWT 立即失效；
- refresh 不轮转：复用原 refresh，避免并发竞态与重试失败；
- 会话行有过期时间，再次登录时清理已死会话行。
"""
import uuid


def _reg(client, username=None, password="Test1234pass"):
    username = username or f"u{uuid.uuid4().hex[:8]}"
    r = client.post("/api/auth/register", json={
        "username": username,
        "password": password,
        "security_question": "q?",
        "security_answer": "a",
    })
    assert r.status_code == 200, r.text
    j = r.json()
    return j["access_token"], j["refresh_token"], username


def _login(client, username, password):
    r = client.post("/api/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    j = r.json()
    return j["access_token"], j["refresh_token"]


def _me(client, access):
    r = client.get("/api/auth/me", headers={"Authorization": f"Bearer {access}"})
    return r


def test_refresh_reusable_no_rotation(client):
    """refresh 不轮转：返回原 refresh，可多次重复使用，无并发/重试孤儿问题。"""
    _access, refresh, _ = _reg(client)
    r = client.post("/api/auth/refresh", json={"refresh_token": refresh})
    assert r.status_code == 200, r.text
    # 返回的 refresh 仍可用
    assert client.post("/api/auth/refresh", json={"refresh_token": r.json()["refresh_token"]}).status_code == 200
    # 原 refresh 也仍可用（未作废）
    assert client.post("/api/auth/refresh", json={"refresh_token": refresh}).status_code == 200


def test_change_password_invalidates_old_and_reissues_for_caller(client):
    """改密码后旧 refresh/access 失效，但返回的新令牌可用（调用者续登）。"""
    access, refresh, username = _reg(client, password="Old1234pass")
    h = {"Authorization": f"Bearer {access}"}
    r = client.post("/api/auth/change-password", headers=h, json={
        "old_password": "Old1234pass", "new_password": "New1234pass"})
    assert r.status_code == 200, r.text
    new_tokens = r.json()
    assert new_tokens["access_token"] and new_tokens["refresh_token"]
    # 旧 refresh 失效
    assert client.post("/api/auth/refresh", json={"refresh_token": refresh}).status_code == 401
    # 旧 access 失效
    assert _me(client, access).status_code == 401
    # 返回的新令牌可用
    assert _me(client, new_tokens["access_token"]).status_code == 200
    assert client.post("/api/auth/refresh", json={"refresh_token": new_tokens["refresh_token"]}).status_code == 200
    # 新密码登录正常
    _a2, refresh2 = _login(client, username, "New1234pass")
    assert client.post("/api/auth/refresh", json={"refresh_token": refresh2}).status_code == 200


def test_change_password_cleans_old_session_rows(client):
    """改密码后旧会话行被清理，令牌列表只剩新会话（不留虚假「有效」行）。"""
    access, _refresh, _ = _reg(client, password="Old1234pass")
    h = {"Authorization": f"Bearer {access}"}
    r = client.post("/api/auth/change-password", headers=h, json={
        "old_password": "Old1234pass", "new_password": "New1234pass"})
    new_h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    tokens = client.get("/api/auth/tokens", headers=new_h).json()
    sessions = [t for t in tokens if t["kind"] == "session"]
    assert len(sessions) == 1  # 旧会话行已清理
    assert sessions[0]["revoked"] is False


def test_revoke_single_session_token(client):
    """吊销单个浏览器会话令牌后，对应 refresh 失效。"""
    access, refresh, _ = _reg(client)
    h = {"Authorization": f"Bearer {access}"}
    tokens = client.get("/api/auth/tokens", headers=h).json()
    sessions = [t for t in tokens if t["kind"] == "session"]
    assert len(sessions) == 1
    assert sessions[0]["revoked"] is False
    assert client.delete(f"/api/auth/tokens/{sessions[0]['id']}", headers=h).status_code == 200
    assert client.post("/api/auth/refresh", json={"refresh_token": refresh}).status_code == 401


def test_revoke_all_kills_access_and_refresh(client):
    """吊销全部令牌：refresh 失效，且 access JWT 因 password_version bump 立即失效。"""
    access, refresh, _ = _reg(client)
    h = {"Authorization": f"Bearer {access}"}
    r = client.delete("/api/auth/tokens", headers=h)
    assert r.status_code == 200
    assert r.json()["count"] >= 1
    # refresh 失效
    assert client.post("/api/auth/refresh", json={"refresh_token": refresh}).status_code == 401
    # access 也立即失效（不留 60 分钟窗口）
    assert _me(client, access).status_code == 401


def test_device_token_survives_password_change(client):
    """设备令牌不绑密码版本，改密码后仍可访问。"""
    access, _refresh, _ = _reg(client, password="Old1234pass")
    h = {"Authorization": f"Bearer {access}"}
    r = client.post("/api/auth/tokens?label=my-daemon&expires_days=0", headers=h)
    assert r.status_code == 200, r.text
    device_token = r.json()["token"]
    dh = {"Authorization": f"Bearer {device_token}"}
    assert _me(client, device_token).status_code == 200
    client.post("/api/auth/change-password", headers=h, json={
        "old_password": "Old1234pass", "new_password": "New1234pass"})
    # 设备令牌不受 password_version 影响
    assert _me(client, device_token).status_code == 200


def test_forgot_password_reset_invalidates_session(client):
    """密保重置密码同样 bump version，使旧会话失效。"""
    access, refresh, username = _reg(client, password="Old1234pass")
    r = client.post("/api/auth/forgot-password/reset", json={
        "username": username, "answer": "a", "new_password": "Reset1234pass"})
    assert r.status_code == 200, r.text
    assert client.post("/api/auth/refresh", json={"refresh_token": refresh}).status_code == 401
    _a2, refresh2 = _login(client, username, "Reset1234pass")
    assert client.post("/api/auth/refresh", json={"refresh_token": refresh2}).status_code == 200


def test_session_has_last_used_and_expiry(client):
    """会话令牌创建即有 last_used_at（非「从未」）与 expires_at。"""
    access, _refresh, _ = _reg(client)
    h = {"Authorization": f"Bearer {access}"}
    tokens = client.get("/api/auth/tokens", headers=h).json()
    s = [t for t in tokens if t["kind"] == "session"][0]
    assert s["last_used_at"]  # 非空：登录即记录
    assert s["expires_at"]    # 有过期时间（1 天）


def test_revoked_session_rows_cleaned_on_relogin(client):
    """再次登录时清理已吊销的旧会话行，避免无界增长（活跃会话保留以支持多设备）。"""
    access, _refresh, username = _reg(client, password="Old1234pass")
    h = {"Authorization": f"Bearer {access}"}
    # 吊销当前会话行（仍留在表中为已吊销状态）
    sid = [t for t in client.get("/api/auth/tokens", headers=h).json() if t["kind"] == "session"][0]["id"]
    client.delete(f"/api/auth/tokens/{sid}", headers=h)
    assert len([t for t in client.get("/api/auth/tokens", headers=h).json() if t["kind"] == "session"]) == 1
    # 重新登录：清理已吊销行 + 新建 1 个活跃会话，总数仍为 1（不累积）
    a2, _ = _login(client, username, "Old1234pass")
    tokens = client.get("/api/auth/tokens", headers={"Authorization": f"Bearer {a2}"}).json()
    sessions = [t for t in tokens if t["kind"] == "session"]
    assert len(sessions) == 1
    assert sessions[0]["revoked"] is False  # 新建的活跃会话


def test_admin_list_user_tokens_has_kind(client):
    """admin 端令牌列表返回 kind 字段，可区分会话/设备令牌。"""
    access, _refresh, _ = _reg(client)
    uid = _me(client, access).json()["id"]
    r = client.post("/api/auth/admin/login", json={"username": "admin", "password": "test-admin-pw-12345"})
    assert r.status_code == 200, r.text
    admin_h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    r2 = client.get(f"/api/admin/users/{uid}/tokens", headers=admin_h)
    assert r2.status_code == 200, r2.text
    tokens = r2.json()
    assert tokens  # 用户有 session 令牌
    assert "kind" in tokens[0]
