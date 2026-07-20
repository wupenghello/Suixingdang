"""登录历史接口 /api/auth/login-history 的安全与边界验证。

覆盖：
- 鉴权：未登录 401、禁用账号 403；
- 隔离（IDOR）：用户 A 只能看到自己的记录，看不到用户 B 与管理员（user_id=None）的记录；
- 分页信封：{items, total, offset, limit}；offset/limit 钳制；切片正确；
- 分类过滤：kind=login/security 与前端 audit-actions.js 词表一致，非法 kind 回落全量；
- 排序：按 created_at 倒序；
- 字段：items 内每条 {action, detail, ip, created_at}，不含敏感内部字段。

后端实现强制 filter(AccessLog.user_id == user.id)，是隔离的核心防线。
"""
import os
from pathlib import Path

from auth_helpers import register as _reg, login as _login, admin_login


def _change_pw(client, access, old_password, new_password):
    """改密（产生 security 类 password_changed / stepup_failed 审计记录）。"""
    return client.post(
        "/api/auth/change-password",
        json={"old_password": old_password, "new_password": new_password},
        headers={"Authorization": f"Bearer {access}"},
    )


def _history(client, access, limit=None, offset=None, kind=None):
    h = {"Authorization": f"Bearer {access}"}
    params = []
    if limit is not None:
        params.append(f"limit={limit}")
    if offset is not None:
        params.append(f"offset={offset}")
    if kind is not None:
        params.append(f"kind={kind}")
    url = "/api/auth/login-history" + ("?" + "&".join(params) if params else "")
    return client.get(url, headers=h)


def _make_user_with_logs(client, username=None, password="Test1234pass"):
    """注册并登录（产生 register + login_success 两条记录），返回 (access, user_id, username)。"""
    access, _refresh, username = _reg(client, username=username, password=password)
    # 再登录一次，多产生一条 login_success
    access2, _ = _login(client, username, password)
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {access2}"})
    return access2, me.json()["id"], username


def _set_status_db(username, status):
    """测试工具：直接改库设置用户 status（禁用场景）。"""
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from app.db.models import User
    db_path = os.environ["DATABASE_PATH"]
    db = sessionmaker(bind=create_engine(f"sqlite:///{db_path}"))()
    db.query(User).filter_by(username=username).update({"status": status})
    db.commit()
    db.close()


# ---- 鉴权 ----

def test_login_history_requires_auth(client):
    """未登录访问 401。"""
    r = client.get("/api/auth/login-history")
    assert r.status_code == 401, r.text


def test_login_history_disabled_user_forbidden(client):
    """禁用账号 403——get_current_user 检查 status==disabled。"""
    access, _uid, username = _reg(client, password="Test1234pass")
    _set_status_db(username, "disabled")
    r = _history(client, access)
    assert r.status_code == 403, f"期望 403，实际 {r.status_code}: {r.text}"


# ---- 隔离（IDOR）----

def test_login_history_isolation(client):
    """用户 A 看不到用户 B 与管理员的记录——核心隔离断言。"""
    access_a, _uid_a, _ = _make_user_with_logs(client, username="isol_a")
    _make_user_with_logs(client, username="isol_b")

    # 管理员登录，产生一条 user_id=None 的 admin_login_success
    admin_login(client)

    r = _history(client, access_a)
    assert r.status_code == 200, r.text
    logs = r.json()["items"]
    assert len(logs) > 0, "A 应至少有注册+登录记录"
    actions = {l["action"] for l in logs}
    # 隔离性：只能看到自己的 register/login_success，绝不能看到 admin 动作
    assert actions <= {"register", "login_success"}, f"越权：A 看到非自身动作 {actions - {'register', 'login_success'}}"
    assert "admin_login_success" not in actions, "管理员记录泄露"
    # 看到全部自己的记录（>=2：register + 至少一次 login_success），而非他人/管理员的
    assert len(logs) >= 2, f"期望 A 至少 2 条记录，实际 {len(logs)}"


def test_login_history_admin_log_not_leaked(client):
    """管理员的 user_id=None 记录不出现在任何用户的历史中。"""
    access, _uid, _ = _reg(client, username="leakcheck")
    admin_login(client)  # 产生 admin_login_success（user_id=None）
    r = _history(client, access)
    assert r.status_code == 200
    actions = [l["action"] for l in r.json()["items"]]
    assert "admin_login_success" not in actions, "管理员记录泄露给用户"


# ---- 分页信封 ----

def test_login_history_envelope_shape(client):
    """响应为 {items, total, offset, limit} 信封，total 为过滤后总数。"""
    access, _uid, _ = _make_user_with_logs(client, username="envelope")
    r = _history(client, access, limit=2)
    assert r.status_code == 200
    d = r.json()
    assert set(d.keys()) == {"items", "total", "offset", "limit"}, f"信封字段异常：{d.keys()}"
    assert isinstance(d["items"], list)
    assert d["total"] >= 2  # register + 再次登录的 login_success
    assert d["offset"] == 0
    assert d["limit"] == 2
    assert len(d["items"]) == 2


def test_login_history_pagination_slices(client):
    """offset/limit 切片正确：两页拼起来等于整页，且不重不漏。"""
    access, _uid, _ = _make_user_with_logs(client, username="pageslice")
    full = _history(client, access, limit=50).json()
    total, all_actions = full["total"], full["items"]

    p1 = _history(client, access, limit=2, offset=0).json()
    p2 = _history(client, access, limit=2, offset=2).json()
    assert p1["total"] == p2["total"] == total
    assert len(p1["items"]) == min(2, total)
    # 不重不漏：拼接后与整页一致
    stitched = p1["items"] + p2["items"] + _history(client, access, limit=50, offset=4).json()["items"]
    assert stitched == all_actions, "分页拼接与整页不一致"


def test_login_history_offset_past_end(client):
    """offset 超出总数返回空 items，total 不变（前端据此回落末页）。"""
    access, _uid, _ = _make_user_with_logs(client, username="pastend")
    r = _history(client, access, limit=10, offset=9999)
    assert r.status_code == 200
    d = r.json()
    assert d["items"] == []
    assert d["total"] >= 2
    assert d["offset"] == 9999


def test_login_history_offset_clamp_negative(client):
    """offset 负数回落到 0。"""
    access, _uid, _ = _make_user_with_logs(client, username="offneg")
    r = _history(client, access, offset=-7)
    assert r.status_code == 200
    assert r.json()["offset"] == 0
    assert len(r.json()["items"]) >= 1


def test_login_history_limit_clamp_high(client):
    """limit 超界（999）回落到上限 50。"""
    access, _uid, _ = _reg(client, username="limhigh")
    r = _history(client, access, limit=999)
    assert r.status_code == 200
    d = r.json()
    assert d["limit"] == 50
    assert len(d["items"]) <= 50


def test_login_history_limit_clamp_negative(client):
    """limit 负数回落到下限 1。"""
    access, _uid, _ = _reg(client, username="limneg")
    r = _history(client, access, limit=-5)
    assert r.status_code == 200
    d = r.json()
    assert d["limit"] == 1
    assert len(d["items"]) == 1


def test_login_history_default_paging(client):
    """默认 offset=0 / limit=10 / kind=all。"""
    access, _uid, _ = _reg(client, username="limdef")
    r = _history(client, access)
    assert r.status_code == 200
    d = r.json()
    assert d["offset"] == 0 and d["limit"] == 10
    assert 1 <= len(d["items"]) <= 10


# ---- 分类过滤 ----

def test_login_history_kind_login_only(client):
    """kind=login 只返回登录类事件（与前端 audit-actions.js 词表一致）。"""
    access, _uid, username = _make_user_with_logs(client, username="kindlogin")
    _change_pw(client, access, "Test1234pass", "New5678pass")  # 产生 security 类 password_changed
    access2, _ = _login(client, username, "New5678pass")
    r = _history(client, access2, kind="login")
    assert r.status_code == 200
    d = r.json()
    login_actions = {"login_success", "login_failed", "login_locked", "login_blocked",
                     "login_new_device", "register"}
    got = {l["action"] for l in d["items"]}
    assert got <= login_actions, f"kind=login 混入非登录类事件：{got - login_actions}"
    assert "password_changed" not in got
    assert d["total"] == len(d["items"])  # 记录少时一页即全量，total 与条数一致


def test_login_history_kind_security_only(client):
    """kind=security 只返回密码/授权/令牌类事件。"""
    access, _uid, _ = _make_user_with_logs(client, username="kindsec")
    _change_pw(client, access, "Test1234pass", "New5678pass")
    access2, _ = _login(client, "kindsec", "New5678pass")
    r = _history(client, access2, kind="security")
    assert r.status_code == 200
    d = r.json()
    got = {l["action"] for l in d["items"]}
    assert got == {"password_changed"}, f"期望仅 password_changed，实际 {got}"
    assert d["total"] == 1


def test_login_history_kind_invalid_falls_back_all(client):
    """非法 kind 不报错，回落全量（白名单外一律不过滤）。"""
    access, _uid, _ = _make_user_with_logs(client, username="kindbad")
    r_all = _history(client, access)
    r_bad = _history(client, access, kind="drop-table")
    assert r_bad.status_code == 200
    assert r_bad.json()["total"] == r_all.json()["total"]


def test_login_history_kind_isolated_total(client):
    """total 为过滤后的总数，且分页跨类不串：login 与 security 的 total 之和 <= 全量 total。"""
    access, _uid, _ = _make_user_with_logs(client, username="kindtotal")
    _change_pw(client, access, "Test1234pass", "New5678pass")
    access2, _ = _login(client, "kindtotal", "New5678pass")
    t_all = _history(client, access2).json()["total"]
    t_login = _history(client, access2, kind="login").json()["total"]
    t_sec = _history(client, access2, kind="security").json()["total"]
    # 该用户只产生 login 类与 security 类事件（无 file 类），两者恰好互补
    assert t_login + t_sec == t_all, f"{t_login} + {t_sec} != {t_all}"


# ---- 排序 ----

def test_login_history_desc_order(client):
    """按 created_at 倒序：后登录的记录排在前面。"""
    access, _uid, username = _reg(client, username="ordertest", password="Test1234pass")
    # 再登录两次，产生更新的 login_success
    access, _ = _login(client, username, "Test1234pass")
    access, _ = _login(client, username, "Test1234pass")
    r = _history(client, access)
    assert r.status_code == 200
    logs = r.json()["items"]
    assert len(logs) >= 2
    # 倒序：前面记录的时间 >= 后面记录的时间（ISO 字符串可直接比）
    for i in range(len(logs) - 1):
        assert logs[i]["created_at"] >= logs[i + 1]["created_at"], \
            f"非倒序：{logs[i]['created_at']} < {logs[i+1]['created_at']}"


# ---- 字段完整性 ----

def test_login_history_field_shape(client):
    """items 内每条字段恰好 {action, detail, ip, created_at}，不多不少。"""
    access, _uid, _ = _reg(client, username="fieldshape")
    r = _history(client, access)
    assert r.status_code == 200
    logs = r.json()["items"]
    assert len(logs) >= 1
    for l in logs:
        assert set(l.keys()) == {"action", "detail", "ip", "created_at"}, f"字段异常：{l.keys()}"
        assert isinstance(l["action"], str)
        assert isinstance(l["detail"], str)
        assert isinstance(l["ip"], str)
        assert isinstance(l["created_at"], str)
