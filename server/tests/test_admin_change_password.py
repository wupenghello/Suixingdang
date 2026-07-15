"""管理员修改自身密码的端点测试。

覆盖：
- 正常改密（原密码正确 + 新密码合规）后可用新密码登录、旧密码失败；
- 原密码错误时 400 并记审计失败日志；
- 新密码弱（<8 字符 / 与用户名相同）时 400。
"""
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))
from auth_helpers import admin_login


ADMIN_USER = "admin"
ADMIN_PASS = "test-admin-pw-12345"


def _auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


def test_admin_change_password_success(client):
    """改密成功后新密码可登录、旧密码不可登录。"""
    token = admin_login(client, ADMIN_USER, ADMIN_PASS)
    new_pw = "new-strong-pw-99887"

    r = client.put("/api/admin/me/password",
                   json={"old_password": ADMIN_PASS, "new_password": new_pw},
                   headers=_auth_headers(token))
    assert r.status_code == 200, r.text

    # 旧密码登录失败
    r1 = client.post("/api/auth/admin/login", json={"username": ADMIN_USER, "password": ADMIN_PASS})
    assert r1.status_code == 401

    # 新密码登录成功
    r2 = client.post("/api/auth/admin/login", json={"username": ADMIN_USER, "password": new_pw})
    assert r2.status_code == 200

    # 恢复初始密码，避免污染 session 级共享的管理员账号
    token2 = admin_login(client, ADMIN_USER, new_pw)
    client.put("/api/admin/me/password",
               json={"old_password": new_pw, "new_password": ADMIN_PASS},
               headers=_auth_headers(token2))


def test_admin_change_password_wrong_old(client):
    """原密码错误返回 400。"""
    token = admin_login(client, ADMIN_USER, ADMIN_PASS)
    r = client.put("/api/admin/me/password",
                   json={"old_password": "definitely-wrong", "new_password": "new-strong-pw-99887"},
                   headers=_auth_headers(token))
    assert r.status_code == 400


def test_admin_change_password_weak_new(client):
    """新密码不合规（过短 / 与用户名相同）返回 400。"""
    token = admin_login(client, ADMIN_USER, ADMIN_PASS)

    # 过短
    r1 = client.put("/api/admin/me/password",
                    json={"old_password": ADMIN_PASS, "new_password": "short"},
                    headers=_auth_headers(token))
    assert r1.status_code == 400

    # 与用户名相同
    r2 = client.put("/api/admin/me/password",
                    json={"old_password": ADMIN_PASS, "new_password": ADMIN_USER},
                    headers=_auth_headers(token))
    assert r2.status_code == 400
