"""HttpOnly Cookie 认证安全契约测试。

锁定令牌迁移到 HttpOnly cookie 后的安全不变量，防回归（如有人不小心把令牌放回响应体）：
- login/register/admin-login 响应体不含令牌明文；
- 令牌通过 HttpOnly + SameSite=Lax cookie 下发，前端 JS 不可读；
- /me 凭 cookie 认证（无需 Authorization 头）；无 cookie/头则 401；
- /refresh 只认 refresh cookie，不接受 body；
- /logout 清除 cookie，之后 /me 401。
"""
import uuid
import random


def _random_phone():
    return f"139{random.randint(10000000, 99999999)}"


def _register(client, username=None, password="Test1234pass"):
    username = username or f"u{uuid.uuid4().hex[:8]}"
    r = client.post("/api/auth/register", json={
        "username": username, "password": password,
        "security_question": "q?", "security_answer": "a",
        "phone": _random_phone(),
    })
    assert r.status_code == 200, r.text
    return r, username


def test_login_response_body_has_no_token_plaintext(client):
    """登录/注册响应体不得包含令牌明文（防 XSS 偷令牌的核心契约）。"""
    r, _ = _register(client)
    body = r.json()
    assert "access_token" not in body
    assert "refresh_token" not in body
    assert "token" not in body


def test_session_cookies_are_httponly_samesite_lax(client):
    """会话令牌 cookie 必须 HttpOnly（JS 不可读）+ SameSite=Lax（防 CSRF）。"""
    r, _ = _register(client)
    set_cookies = r.headers.get_list("set-cookie")
    assert set_cookies, "未下发任何 cookie"
    names = {c.split("=", 1)[0] for c in set_cookies}
    assert "access_token" in names
    assert "refresh_token" in names
    for c in set_cookies:
        if c.startswith("access_token=") or c.startswith("refresh_token="):
            assert "HttpOnly" in c, f"cookie 非 HttpOnly: {c}"
            assert "SameSite=lax" in c, f"cookie 非 SameSite=Lax: {c}"


def test_me_authenticates_via_cookie_without_header(client):
    """有 cookie 即认证通过，无需 Authorization 头（同源浏览器自动带 cookie）。"""
    _register(client)  # cookie 进 jar，不清空
    me = client.get("/api/auth/me")  # 不带 Authorization 头
    assert me.status_code == 200, me.text
    assert me.json()["username"]


def test_me_rejects_without_cookie_or_header(client):
    """无 cookie 且无 Authorization 头时 /me 返回 401。"""
    client.cookies.clear()
    assert client.get("/api/auth/me").status_code == 401


def test_refresh_reads_cookie_only_not_body(client):
    """/refresh 只认 refresh cookie：无 cookie 即便 body 带令牌也 401。"""
    _r, _ = _register(client)
    refresh = client.cookies.get("refresh_token")
    client.cookies.clear()
    # 无 cookie，body 带令牌 -> 仍 401（body 被忽略）
    assert client.post("/api/auth/refresh", json={"refresh_token": refresh}).status_code == 401
    # 设回 refresh cookie -> 200
    client.cookies.set("refresh_token", refresh)
    ok = client.post("/api/auth/refresh")
    assert ok.status_code == 200, ok.text
    # 续期后 access cookie 已更新，/me 凭 cookie 通过
    assert client.get("/api/auth/me").status_code == 200


def test_logout_clears_cookies(client):
    """/logout 清除会话 cookie，之后 /me 401。"""
    _register(client)
    assert client.get("/api/auth/me").status_code == 200
    assert client.post("/api/auth/logout").status_code == 200
    assert client.get("/api/auth/me").status_code == 401


def test_admin_login_sets_httponly_cookie_no_body_token(client):
    """管理员登录同样：响应体无令牌，admin_access cookie HttpOnly。"""
    r = client.post("/api/auth/admin/login", json={
        "username": "admin", "password": "test-admin-pw-12345"})
    assert r.status_code == 200, r.text
    assert "access_token" not in r.json()
    set_cookies = r.headers.get_list("set-cookie")
    admin_cookies = [c for c in set_cookies if c.startswith("admin_access=")]
    assert admin_cookies, "未下发 admin_access cookie"
    assert "HttpOnly" in admin_cookies[0]
    # 凭 admin cookie 访问管理端接口
    assert client.get("/api/admin/me").status_code == 200
    # 管理员登出清 cookie
    assert client.post("/api/auth/admin/logout").status_code == 200
    assert client.get("/api/admin/me").status_code == 401


def test_logout_revokes_session_so_refresh_fails(client):
    """登出吊销会话行：refresh cookie 被清后即便手动设回，/refresh 也 401。

    覆盖 /logout 用 refresh cookie 的 hash 查会话行吊销（access 过期时仍能定位）。
    """
    from auth_helpers import get_cookie
    client.cookies.clear()  # 清掉先前测试残留 cookie，避免干扰
    _r, _ = _register(client)
    refresh = get_cookie(client, "refresh_token")
    assert client.post("/api/auth/logout").status_code == 200
    client.cookies.clear()
    client.cookies.set("refresh_token", refresh)  # 模拟令牌被其他途径保留
    assert client.post("/api/auth/refresh").status_code == 401
    client.cookies.clear()  # 清掉手动设的 cookie，避免污染后续测试
