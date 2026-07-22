"""cookie 认证共享测试 helper。

令牌在 HttpOnly cookie（响应体不返回），测试从 TestClient cookie jar 取令牌后清空 jar，
避免 cookie 优先级（get_current_user 先读 cookie）干扰多用户 Bearer 头测试。
各测试文件复用，避免 grab/register/login/refresh 逻辑四处复制。

取令牌用 get_cookie 遍历底层 jar，容忍同名多 cookie（httpx CookieConflict）--
手动 set 的 cookie 与服务端 Set-Cookie 可能因 domain 差异共存。
"""
import uuid


def get_cookie(client, name):
    """取 cookie 值，遍历底层 jar 容忍同名多 cookie（避免 httpx CookieConflict）。"""
    for c in client.cookies.jar:
        if c.name == name:
            return c.value
    return None


def grab(client):
    """从 cookie jar 取 access/refresh 并清空 jar。"""
    access = get_cookie(client, "access_token")
    refresh = get_cookie(client, "refresh_token")
    client.cookies.clear()
    return access, refresh


def register(client, username=None, password="Test1234pass", phone=None):
    """注册新用户，返回 (access, refresh, username)；取令牌后清 jar。"""
    username = username or f"u{uuid.uuid4().hex[:8]}"
    body = {
        "username": username, "password": password,
        "security_question": "q?", "security_answer": "a",
    }
    if phone:
        body["phone"] = phone
    r = client.post("/api/auth/register", json=body)
    assert r.status_code == 200, r.text
    access, refresh = grab(client)
    return access, refresh, username


def login(client, username, password, headers=None):
    """登录，返回 (access, refresh)；取令牌后清 jar。"""
    r = client.post("/api/auth/login", json={"username": username, "password": password}, headers=headers)
    assert r.status_code == 200, r.text
    return grab(client)


def do_refresh(client, refresh_token):
    """用 refresh cookie 调 /refresh；返回 (response, new_access)。"""
    client.cookies.set("refresh_token", refresh_token)
    r = client.post("/api/auth/refresh")
    new_access = get_cookie(client, "access_token")
    client.cookies.clear()
    return r, new_access


def admin_login(client, username="admin", password="test-admin-pw-12345"):
    """管理员登录，返回 admin_access token；取令牌后清 jar。"""
    r = client.post("/api/auth/admin/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    token = get_cookie(client, "admin_access")
    client.cookies.clear()
    return token
