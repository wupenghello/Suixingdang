"""用户界面偏好端点测试（/api/auth/prefs GET/PUT）。

覆盖 PRD §7 越权用例与白名单校验：
- 读写闭环：PUT 后 GET 原样返回；
- 多账户隔离：用户 B 读不到用户 A 的偏好（owner 隔离，无 IDOR 面）；
- 管理端令牌无法命中用户端点（两套独立认证体系）;
- 白名单/类型/取值/体积校验：脏输入一律 400，绝不落库。
"""
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))
from auth_helpers import register, admin_login


ADMIN_USER = "admin"
ADMIN_PASS = "test-admin-pw-12345"


def _hdr(token):
    return {"Authorization": f"Bearer {token}"}


def test_prefs_roundtrip(client):
    """PUT 合法偏好后 GET 原样返回。"""
    access, _, _ = register(client)
    payload = {"prefs": {"sidebarCollapsed": True, "modKeyHint": "mac", "cmdActionUse": {"新建笔记": 3}}}

    r = client.put("/api/auth/prefs", json=payload, headers=_hdr(access))
    assert r.status_code == 200, r.text

    r2 = client.get("/api/auth/prefs", headers=_hdr(access))
    assert r2.status_code == 200, r2.text
    assert r2.json()["prefs"] == payload["prefs"]


def test_prefs_default_empty(client):
    """新用户未写过偏好时 GET 返回空对象而非报错。"""
    access, _, _ = register(client)
    r = client.get("/api/auth/prefs", headers=_hdr(access))
    assert r.status_code == 200, r.text
    assert r.json() == {"prefs": {}}


def test_prefs_owner_isolation(client):
    """用户 B 读不到用户 A 的偏好；B 写入也不影响 A。"""
    a, _, _ = register(client)
    b, _, _ = register(client)

    client.put("/api/auth/prefs", json={"prefs": {"modKeyHint": "mac"}}, headers=_hdr(a))

    rb = client.get("/api/auth/prefs", headers=_hdr(b))
    assert rb.json()["prefs"] == {}  # B 看不到 A 的偏好

    client.put("/api/auth/prefs", json={"prefs": {"modKeyHint": "win"}}, headers=_hdr(b))
    ra = client.get("/api/auth/prefs", headers=_hdr(a))
    assert ra.json()["prefs"] == {"modKeyHint": "mac"}  # B 的写入不影响 A


def test_prefs_rejects_admin_token(client):
    """管理端令牌走独立认证体系，不能读写用户偏好。"""
    token = admin_login(client, ADMIN_USER, ADMIN_PASS)
    r1 = client.get("/api/auth/prefs", headers=_hdr(token))
    assert r1.status_code in (401, 403), r1.text
    r2 = client.put("/api/auth/prefs", json={"prefs": {}}, headers=_hdr(token))
    assert r2.status_code in (401, 403), r2.text


def test_prefs_requires_auth(client):
    """匿名访问 401。"""
    assert client.get("/api/auth/prefs").status_code == 401
    assert client.put("/api/auth/prefs", json={"prefs": {}}).status_code == 401


def test_prefs_unknown_key_rejected(client):
    """白名单外的 key 一律 400（防止 prefs 变成任意数据通道）。"""
    access, _, _ = register(client)
    r = client.put("/api/auth/prefs", json={"prefs": {"isAdmin": True}}, headers=_hdr(access))
    assert r.status_code == 400, r.text
    # 拒绝后库内仍为空
    assert client.get("/api/auth/prefs", headers=_hdr(access)).json()["prefs"] == {}


def test_prefs_type_validation(client):
    """类型不符 / 取值非法 → 400。"""
    access, _, _ = register(client)
    bad_payloads = [
        {"prefs": {"sidebarCollapsed": "yes"}},            # bool 位给字符串
        {"prefs": {"modKeyHint": "linux"}},                # 取值不在 auto/mac/win
        {"prefs": {"cmdActionUse": {"a": "3"}}},           # 计数必须整数
        {"prefs": {"cmdActionUse": {"a": True}}},          # bool 是 int 子类，须显式排除
        {"prefs": {"cmdActionUse": {str(i): i for i in range(65)}}},  # 超过 64 项
    ]
    for p in bad_payloads:
        r = client.put("/api/auth/prefs", json=p, headers=_hdr(access))
        assert r.status_code == 400, f"{p} 应当被拒绝: {r.text}"


def test_prefs_malformed_body(client):
    """缺 prefs 字段 / 非 JSON → 400。"""
    access, _, _ = register(client)
    assert client.put("/api/auth/prefs", json={}, headers=_hdr(access)).status_code == 400
    r = client.put("/api/auth/prefs", content=b"not-json",
                   headers={**_hdr(access), "Content-Type": "application/json"})
    assert r.status_code == 400, r.text


def test_prefs_oversize_rejected(client):
    """体积超 4KB → 400。"""
    access, _, _ = register(client)
    # 64 个长 key，总量稳定超过 4KB
    big = {f"{'k' * 60}{i:03d}": 1 for i in range(64)}
    r = client.put("/api/auth/prefs", json={"prefs": {"cmdActionUse": big}}, headers=_hdr(access))
    assert r.status_code == 400, r.text
