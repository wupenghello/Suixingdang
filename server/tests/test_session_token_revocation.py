"""浏览器会话令牌吊销 + 密码版本号 + refresh（不轮转）的端到端验证。

令牌已迁移到 HttpOnly cookie：register/login/change-password 不再在响应体返回令牌，
/refresh 从 refresh cookie 读取。测试用 _grab 从 TestClient cookie jar 取令牌后清空 jar，
避免 cookie 优先级（get_current_user 先读 cookie）干扰多用户 Bearer 头场景；
/refresh 用 _refresh 显式设 refresh cookie。

覆盖安全改动的行为契约：
- 浏览器登录会话进 access_tokens 表（kind=session），可在设置页吊销；
- 改/重置密码 bump password_version，旧 access/refresh 立即失效；
- revoke_all 同时 bump password_version，已签发的 access JWT 立即失效；
- refresh 不轮转：复用原 refresh，避免并发竞态与重试失败；
- 会话行有过期时间，再次登录时清理已死会话行。
"""
import io

from auth_helpers import register as _reg, login as _login, do_refresh as _refresh, admin_login, grab as _grab


def _me(client, access):
    return client.get("/api/auth/me", headers={"Authorization": f"Bearer {access}"})


def test_refresh_reusable_no_rotation(client):
    """refresh 不轮转：原 refresh 可多次重复使用，无并发/重试孤儿问题。"""
    _access, refresh, _ = _reg(client)
    r, new_access = _refresh(client, refresh)
    assert r.status_code == 200, r.text
    # refresh 不轮转：原 refresh 仍可重复使用
    assert _refresh(client, refresh)[0].status_code == 200
    assert _refresh(client, refresh)[0].status_code == 200
    # 续期后的新 access 可用
    assert _me(client, new_access).status_code == 200


def test_change_password_invalidates_old_and_reissues_for_caller(client):
    """改密码后旧 refresh/access 失效，但新签发令牌可用（调用者续登）。"""
    access, refresh, username = _reg(client, password="Old1234pass")
    h = {"Authorization": f"Bearer {access}"}
    r = client.post("/api/auth/change-password", headers=h, json={
        "old_password": "Old1234pass", "new_password": "New1234pass"})
    assert r.status_code == 200, r.text
    new_access, new_refresh = _grab(client)
    assert new_access and new_refresh
    # 旧 refresh 失效
    assert _refresh(client, refresh)[0].status_code == 401
    # 旧 access 失效
    assert _me(client, access).status_code == 401
    # 新令牌可用
    assert _me(client, new_access).status_code == 200
    assert _refresh(client, new_refresh)[0].status_code == 200
    # 新密码登录正常
    _a2, refresh2 = _login(client, username, "New1234pass")
    assert _refresh(client, refresh2)[0].status_code == 200


def test_change_password_cleans_old_session_rows(client):
    """改密码后旧会话行被清理，令牌列表只剩新会话（不留虚假「有效」行）。"""
    access, _refresh, _ = _reg(client, password="Old1234pass")
    h = {"Authorization": f"Bearer {access}"}
    r = client.post("/api/auth/change-password", headers=h, json={
        "old_password": "Old1234pass", "new_password": "New1234pass"})
    assert r.status_code == 200, r.text
    new_access, _ = _grab(client)
    new_h = {"Authorization": f"Bearer {new_access}"}
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
    assert _refresh(client, refresh)[0].status_code == 401


def test_revoke_all_kills_access_and_refresh(client):
    """吊销全部令牌：refresh 失效，且 access JWT 因 password_version bump 立即失效。"""
    access, refresh, _ = _reg(client)
    h = {"Authorization": f"Bearer {access}"}
    r = client.delete("/api/auth/tokens", headers=h)
    assert r.status_code == 200
    assert r.json()["count"] >= 1
    # refresh 失效
    assert _refresh(client, refresh)[0].status_code == 401
    # access 也立即失效（不留 60 分钟窗口）
    assert _me(client, access).status_code == 401


def test_device_token_survives_password_change(client):
    """设备令牌不绑密码版本，改密码后仍可访问。"""
    access, _refresh, _ = _reg(client, password="Old1234pass")
    h = {"Authorization": f"Bearer {access}"}
    r = client.post("/api/auth/tokens?label=my-daemon&expires_days=0", headers=h)
    assert r.status_code == 200, r.text
    device_token = r.json()["token"]
    assert _me(client, device_token).status_code == 200
    client.post("/api/auth/change-password", headers=h, json={
        "old_password": "Old1234pass", "new_password": "New1234pass"})
    client.cookies.clear()  # 清掉 change-password 设的会话 cookie，确保 _me 走设备令牌头
    # 设备令牌不受 password_version 影响
    assert _me(client, device_token).status_code == 200


def test_forgot_password_reset_invalidates_session(client):
    """密保重置密码同样 bump version，使旧会话失效。"""
    access, refresh, username = _reg(client, password="Old1234pass")
    r = client.post("/api/auth/forgot-password/reset", json={
        "username": username, "answer": "a", "new_password": "Reset1234pass"})
    assert r.status_code == 200, r.text
    assert _refresh(client, refresh)[0].status_code == 401
    _a2, refresh2 = _login(client, username, "Reset1234pass")
    assert _refresh(client, refresh2)[0].status_code == 200


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
    admin_h = {"Authorization": f"Bearer {admin_login(client)}"}
    r2 = client.get(f"/api/admin/users/{uid}/tokens", headers=admin_h)
    assert r2.status_code == 200, r2.text
    tokens = r2.json()
    assert tokens  # 用户有 session 令牌
    assert "kind" in tokens[0]



def test_same_device_session_reuse_within_window(client):
    """同设备(IP+UA)在复用窗口内重复登录：复用既有会话行，不新增、不重置下载授权。"""
    from app.config import settings
    access_a, refresh_a, username = _reg(client, password="Old1234pass")
    ha = {"Authorization": f"Bearer {access_a}"}
    # A 开启临时下载授权
    assert client.post("/api/files/download-grant", headers=ha).status_code == 200
    sessions_before = [t for t in client.get("/api/auth/tokens", headers=ha).json() if t["kind"] == "session"]
    assert len(sessions_before) == 1
    # 同设备再次登录：应复用同一会话行（不新增）
    access_b, refresh_b = _login(client, username, "Old1234pass")
    hb = {"Authorization": f"Bearer {access_b}"}
    sessions_after = [t for t in client.get("/api/auth/tokens", headers=hb).json() if t["kind"] == "session"]
    assert len(sessions_after) == 1, "同设备重复登录不应新增会话行"
    # 复用后下载授权仍保留（未被重置）
    assert client.get("/api/files/download-status", headers=hb).json()["granted"] is True
    # 旧 refresh 因轮转而失效，新 refresh 可用
    assert _refresh(client, refresh_a)[0].status_code == 401
    assert _refresh(client, refresh_b)[0].status_code == 200


def test_different_device_creates_new_session(client):
    """不同设备(不同 UA)登录：创建独立会话，互不影响。"""
    access_a, _ra, username = _reg(client, password="Old1234pass")
    ha = {"Authorization": f"Bearer {access_a}"}
    access_b, _rb = _login(client, username, "Old1234pass", headers={"User-Agent": "device-B/1.0 (Macintosh)"})
    hb = {"Authorization": f"Bearer {access_b}"}
    sessions = [t for t in client.get("/api/auth/tokens", headers=ha).json() if t["kind"] == "session"]
    assert len(sessions) == 2, "不同设备应各有一条会话"


def _upload(client, access, name="a.txt", content=b"abc"):
    h = {"Authorization": f"Bearer {access}"}
    r = client.post("/api/files/upload", headers=h,
                    files={"file": (name, io.BytesIO(content), "text/plain")})
    assert r.status_code == 200, r.text
    return h


def test_download_blocked_by_default(client):
    """浏览器端默认禁下载：未开启临时下载窗口时 download 返回 403。"""
    access, _refresh, _ = _reg(client)
    h = _upload(client, access)
    assert client.get("/api/files/download", headers=h, params={"path": "a.txt"}).status_code == 403


def test_download_grant_then_revoke(client):
    """开启临时下载后可下载；手动关闭后 403。"""
    access, _refresh, _ = _reg(client)
    h = _upload(client, access)
    g = client.post("/api/files/download-grant", headers=h)
    assert g.status_code == 200 and g.json()["granted"] is True
    assert client.get("/api/files/download-status", headers=h).json()["granted"] is True
    d = client.get("/api/files/download", headers=h, params={"path": "a.txt"})
    assert d.status_code == 200 and d.content == b"abc"
    client.post("/api/files/download-revoke", headers=h)
    assert client.get("/api/files/download-status", headers=h).json()["granted"] is False
    assert client.get("/api/files/download", headers=h, params={"path": "a.txt"}).status_code == 403


def test_download_grant_isolated_per_session(client):
    """临时下载授权精确到会话：A 开启不影响 B（多设备场景）。

    注意：同设备(IP+UA)登录会复用会话，因此这里 B 必须用不同 User-Agent
    模拟另一台设备，才能得到独立会话以验证隔离性。"""
    access_a, _ra, username = _reg(client, password="Old1234pass")
    access_b, _rb = _login(client, username, "Old1234pass", headers={"User-Agent": "device-B/1.0 (Macintosh)"})
    ha = {"Authorization": f"Bearer {access_a}"}
    hb = {"Authorization": f"Bearer {access_b}"}
    assert client.post("/api/files/download-grant", headers=ha).status_code == 200
    assert client.get("/api/files/download-status", headers=ha).json()["granted"] is True
    # B 的会话未受影响
    assert client.get("/api/files/download-status", headers=hb).json()["granted"] is False


def test_preview_responses_have_no_store(client):
    """预览/预览文本响应带 Cache-Control: no-store，不进浏览器磁盘缓存。"""
    access, _refresh, _ = _reg(client)
    h = _upload(client, access)
    r = client.get("/api/files/preview", headers=h, params={"path": "a.txt"})
    assert r.status_code == 200
    assert r.headers.get("cache-control") == "no-store"
    t = client.get("/api/files/preview-text", headers=h, params={"path": "a.txt"})
    assert t.headers.get("cache-control") == "no-store"


def test_sync_download_rejects_browser_jwt(client):
    """sync 通道仅接受设备令牌；浏览器 session JWT 调 /api/sync/download 返回 403，设备令牌可下载。"""
    access, _refresh, _ = _reg(client)
    h = _upload(client, access)
    # 浏览器 JWT 被拒
    assert client.get("/api/sync/download", headers=h, params={"path": "a.txt"}).status_code == 403
    # 设备令牌可走 sync 下载
    dev = client.post("/api/auth/tokens?label=t&expires_days=0", headers=h)
    assert dev.status_code == 200
    dr = client.get("/api/sync/download", headers={"Authorization": f"Bearer {dev.json()['token']}"},
                    params={"path": "a.txt"})
    assert dr.status_code == 200 and dr.content == b"abc"


def test_revoked_session_cannot_grant_or_download(client):
    """单令牌吊销后，该会话不能开启临时下载也不能下载（get_current_session 过滤 revoked）。"""
    access, _refresh, _ = _reg(client)
    h = _upload(client, access)
    sid = [t for t in client.get("/api/auth/tokens", headers=h).json() if t["kind"] == "session"][0]["id"]
    client.delete(f"/api/auth/tokens/{sid}", headers=h)
    # access JWT 仍有效（单吊销不 bump password_version）
    assert _me(client, access).status_code == 200
    # 但会话已吊销：grant 401、download 403
    assert client.post("/api/files/download-grant", headers=h).status_code == 401
    assert client.get("/api/files/download", headers=h, params={"path": "a.txt"}).status_code == 403


def test_preview_unsafe_type_rejected(client):
    """HTML 等不安全类型不支持浏览器预览（415），不再以 attachment 形式触发下载绕过限制。"""
    access, _refresh, _ = _reg(client)
    h = {"Authorization": f"Bearer {access}"}
    up = client.post("/api/files/upload", headers=h,
                     files={"file": ("page.html", io.BytesIO(b"<script>x</script>"), "text/html")})
    assert up.status_code == 200, up.text
    assert client.get("/api/files/preview", headers=h, params={"path": "page.html"}).status_code == 415
