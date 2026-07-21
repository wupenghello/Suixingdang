"""限流器（从 db/models.py 迁出）。

DB 共享、跨 worker 生效的固定窗口限流：
- 登录限流：login_limiter_check/record/reset（key 前缀隔离 login/admin/reset/stepup）
- 通用请求限流：rate_limit_acquire（复用 login_attempts 表，独立 key 前缀）

表结构（LoginAttempt）仍定义在 db/models.py，本模块只持有行为。
"""

import threading
from datetime import datetime, timedelta

from ..db.models import LoginAttempt

# 进程内串行化限流的 read-modify-write，避免并发请求同时读到旧计数而漏计。
# 多进程（多 worker）仍由数据库写锁兜底，残余竞争只导致少量放行，非硬性绕过。
_rate_limit_lock = threading.Lock()

# ---- 登录限流 ----
LOGIN_LIMIT_WINDOW = 15 * 60        # 失败计数窗口（秒）
LOGIN_LIMIT_MAX_FAILURES = 5        # 窗口内失败上限
LOGIN_LIMIT_LOCK_SECONDS = 15 * 60  # 锁定时长（秒）


def login_limiter_check(db, key: str) -> int:
    """返回剩余锁定秒数；未锁定返回 0。过期锁自动清零。"""
    with _rate_limit_lock:
        row = db.query(LoginAttempt).filter_by(key=key).first()
        if not row or not row.locked_until:
            return 0
        now = datetime.utcnow()
        if row.locked_until > now:
            return int((row.locked_until - now).total_seconds()) + 1
        row.locked_until = None
        row.fail_count = 0
        row.first_fail_at = None
        db.commit()
        return 0


def login_limiter_record(db, key: str):
    """记录一次失败，达到阈值则锁定；顺带清理陈旧记录防表膨胀。"""
    from sqlalchemy import or_
    with _rate_limit_lock:
        now = datetime.utcnow()
        row = db.query(LoginAttempt).filter_by(key=key).first()
        if row:
            if row.first_fail_at and (now - row.first_fail_at).total_seconds() > LOGIN_LIMIT_WINDOW:
                row.fail_count = 0
                row.first_fail_at = now
            if not row.first_fail_at:
                row.first_fail_at = now
            row.fail_count = (row.fail_count or 0) + 1
        else:
            row = LoginAttempt(key=key, fail_count=1, first_fail_at=now)
            db.add(row)
        if row.fail_count >= LOGIN_LIMIT_MAX_FAILURES:
            row.locked_until = now + timedelta(seconds=LOGIN_LIMIT_LOCK_SECONDS)
        db.commit()
        # 机会性清理：删除无锁且超出窗口两倍的陈旧记录
        cutoff = now - timedelta(seconds=LOGIN_LIMIT_WINDOW * 2)
        db.query(LoginAttempt).filter(
            LoginAttempt.locked_until.is_(None),
            or_(LoginAttempt.first_fail_at.is_(None), LoginAttempt.first_fail_at < cutoff),
        ).delete(synchronize_session=False)
        db.commit()


def login_limiter_reset(db, key: str):
    """成功后清零计数。"""
    with _rate_limit_lock:
        row = db.query(LoginAttempt).filter_by(key=key).first()
        if row:
            row.fail_count = 0
            row.first_fail_at = None
            row.locked_until = None
            db.commit()


# ---- 通用请求限流（复用 login_attempts 表，按 key 前缀隔离命名空间）----
# 对这些 key 而言，fail_count 语义为「请求计数」，仅在该命名空间内成立。

CHAT_RATE_LIMIT_WINDOW = 60        # 计数窗口（秒）
CHAT_RATE_LIMIT_MAX = 20           # 窗口内每用户最大请求数
CHAT_RATE_LIMIT_LOCK_SECONDS = 60  # 超限后锁定时长（秒）


def rate_limit_acquire(db, key: str,
                       max_requests: int = CHAT_RATE_LIMIT_MAX,
                       window: int = CHAT_RATE_LIMIT_WINDOW,
                       lock_seconds: int = CHAT_RATE_LIMIT_LOCK_SECONDS) -> int:
    """尝试获取一次请求配额。返回 0 表示放行；>0 表示剩余锁定秒数（应回 429）。

    固定窗口计数：窗口内累计 max_requests 次放行，第 max_requests+1 次起锁定 lock_seconds 秒。
    """
    now = datetime.utcnow()
    with _rate_limit_lock:
        row = db.query(LoginAttempt).filter_by(key=key).first()

        # 仍在锁定期 -> 拒绝（只读，不写）
        if row and row.locked_until and row.locked_until > now:
            return int((row.locked_until - now).total_seconds()) + 1

        # 锁已过期 -> 清零，开新窗口
        if row and row.locked_until:
            row.locked_until = None
            row.fail_count = 0
            row.first_fail_at = None

        # 是否在计数窗口内（first_fail_at 缺失/过期都视为新窗口）
        in_window = bool(row and row.first_fail_at
                         and (now - row.first_fail_at).total_seconds() <= window)
        if in_window:
            count = (row.fail_count or 0) + 1
            first_at = row.first_fail_at
        else:
            count = 1
            first_at = now

        if row:
            row.fail_count = count
            row.first_fail_at = first_at
        else:
            row = LoginAttempt(key=key, fail_count=count, first_fail_at=first_at)
            db.add(row)

        locked = count > max_requests
        if locked:
            row.locked_until = now + timedelta(seconds=lock_seconds)
        db.commit()
        return lock_seconds if locked else 0
