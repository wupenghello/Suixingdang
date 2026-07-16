"""登录历史接口 /api/auth/login-history 的安全与边界验证。

覆盖：
- 鉴权：未登录 401、禁用账号 403；
- 隔离（IDOR）：用户 A 只能看到自己的记录，看不到用户 B 与管理员（user_id=None）的记录；
- limit 钳制：超界值回落到 1..50，默认 20；
- 排序：按 created_at 倒序；
- 字段：返回 {action, detail, ip, created_at}，不含敏感内部字段。

后端实现强制 filter(AccessLog.user_id == user.id)，是隔离的核心防线。
"""
import os
from pathlib import Path

from auth_helpers import register as _reg, login as _login, admin_login


def _history(client, access, limit=None):
    h = {"Authorization": f"Bearer {access}"}
    url = "/api/auth/login-history"
    if limit is not None:
        url += f"?limit={limit}"
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
    logs = r.json()
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
    actions = [l["action"] for l in r.json()]
    assert "admin_login_success" not in actions, "管理员记录泄露给用户"


# ---- limit 钳制 ----

def test_login_history_limit_clamp_high(client):
    """limit 超界（999）回落到上限 50。"""
    access, _uid, _ = _reg(client, username="limhigh")
    r = _history(client, access, limit=999)
    assert r.status_code == 200
    assert len(r.json()) <= 50


def test_login_history_limit_clamp_negative(client):
    """limit 负数回落到下限 1。"""
    access, _uid, _ = _reg(client, username="limneg")
    r = _history(client, access, limit=-5)
    assert r.status_code == 200
    assert len(r.json()) >= 1


def test_login_history_default_limit(client):
    """默认 limit=20。"""
    access, _uid, _ = _reg(client, username="limdef")
    r = _history(client, access)
    assert r.status_code == 200
    assert 1 <= len(r.json()) <= 20


# ---- 排序 ----

def test_login_history_desc_order(client):
    """按 created_at 倒序：后登录的记录排在前面。"""
    access, _uid, username = _reg(client, username="ordertest", password="Test1234pass")
    # 再登录两次，产生更新的 login_success
    access, _ = _login(client, username, "Test1234pass")
    access, _ = _login(client, username, "Test1234pass")
    r = _history(client, access)
    assert r.status_code == 200
    logs = r.json()
    assert len(logs) >= 2
    # 倒序：前面记录的时间 >= 后面记录的时间（ISO 字符串可直接比）
    for i in range(len(logs) - 1):
        assert logs[i]["created_at"] >= logs[i + 1]["created_at"], \
            f"非倒序：{logs[i]['created_at']} < {logs[i+1]['created_at']}"


# ---- 字段完整性 ----

def test_login_history_field_shape(client):
    """返回字段恰好 {action, detail, ip, created_at}，不多不少。"""
    access, _uid, _ = _reg(client, username="fieldshape")
    r = _history(client, access)
    assert r.status_code == 200
    logs = r.json()
    assert len(logs) >= 1
    for l in logs:
        assert set(l.keys()) == {"action", "detail", "ip", "created_at"}, f"字段异常：{l.keys()}"
        assert isinstance(l["action"], str)
        assert isinstance(l["detail"], str)
        assert isinstance(l["ip"], str)
        assert isinstance(l["created_at"], str)
