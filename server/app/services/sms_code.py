"""短信验证码服务：生成、落盘（bcrypt 哈希）、校验、频控。

安全要点：
- 验证码 bcrypt 哈希落盘，绝不存明文（即便 DB 泄露也无法直接重用）。
- 一次性消费：成功或错误达上限后标记 consumed，不可再用。
- 频控：同手机重发间隔、日上限、单码错误上限，全部可运行时调整。
- 用户不存在时走 dummy 校验（防枚举，与 auth.py 的 dummy bcrypt 同模式）。
"""

import secrets
import threading
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import or_

from ..db.models import SmsVerificationCode
from ..core.settings_store import get_cached_setting
from ..core.sms import send_sms_code, SmsError

# 进程内串行化验证码的 read-modify-write，防并发请求绕过错误上限。
_code_lock = threading.Lock()

# 懒加载的 dummy bcrypt 哈希，用于「用户不存在 / 无未消费码」分支消耗等量时间
_DUMMY_CODE_HASH = ""


def _dummy_code_hash() -> str:
    global _DUMMY_CODE_HASH
    if not _DUMMY_CODE_HASH:
        from ..core.security import hash_password
        _DUMMY_CODE_HASH = hash_password("suixingdang-dummy-sms-code")
    return _DUMMY_CODE_HASH


def _normalize_phone(phone: str) -> str:
    """手机号归一化：去空格/横线；国内 11 位直接返回，国际保留 + 前缀。"""
    p = phone.strip().replace(" ", "").replace("-", "").replace("+86", "")
    if p.startswith("86") and len(p) == 13:
        p = p[2:]
    return p


def _validate_phone_format(phone: str) -> Optional[str]:
    """校验手机号格式。通过返回 None，否则返回错误提示。"""
    p = _normalize_phone(phone)
    if not p.isdigit():
        return "手机号格式错误"
    if len(p) == 11:
        if not p.startswith("1"):
            return "手机号格式错误"
        return None
    # 国际号码：7~15 位数字（E.164）
    if 7 <= len(p) <= 15:
        return None
    return "手机号格式错误"


def _setting_int(db, key: str, default: int) -> int:
    raw = get_cached_setting(db, key, str(default))
    try:
        return int(raw)
    except (ValueError, TypeError):
        return default


def _purge_expired_codes(db):
    """机会性清理：删除已消费且超过 24h 的验证码记录，防表膨胀。"""
    cutoff = datetime.utcnow() - timedelta(hours=24)
    db.query(SmsVerificationCode).filter(
        SmsVerificationCode.consumed_at.isnot(None),
        SmsVerificationCode.created_at < cutoff,
    ).delete(synchronize_session=False)


def check_cooldown(db, phone: str) -> int:
    """返回同手机号剩余冷却秒数；0 表示可发。"""
    ttl = _setting_int(db, "sms_cooldown_seconds", 60)
    if ttl <= 0:
        return 0
    since = datetime.utcnow() - timedelta(seconds=ttl)
    recent = db.query(SmsVerificationCode).filter(
        SmsVerificationCode.phone == phone,
        SmsVerificationCode.created_at >= since,
    ).first()
    if not recent:
        return 0
    remaining = ttl - (datetime.utcnow() - recent.created_at).total_seconds()
    return max(0, int(remaining) + 1)


def daily_count(db, phone: str) -> int:
    """当日已发计数。"""
    today = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    return db.query(SmsVerificationCode).filter(
        SmsVerificationCode.phone == phone,
        SmsVerificationCode.created_at >= today,
    ).count()


def create_and_send_code(db, phone: str, purpose: str, user_id: str = "",
                        username: str = "", client_ip: str = "") -> dict:
    """生成验证码、落盘、调短信服务发送。

    返回 {"ok": True, "masked_phone": "138****8000", "cooldown_seconds": 60}。
    频控失败抛 SmsError；短信发送失败会删除刚创建的记录并上抛。
    """
    phone = _normalize_phone(phone)
    fmt_err = _validate_phone_format(phone)
    if fmt_err:
        raise SmsError(fmt_err, retryable=False)

    # 频控
    cooldown = check_cooldown(db, phone)
    if cooldown > 0:
        raise SmsError(f"请稍后再试（{cooldown}s）", retryable=False)
    daily_limit = _setting_int(db, "sms_daily_limit_per_phone", 20)
    if daily_count(db, phone) >= daily_limit:
        raise SmsError("今日发送次数已达上限", retryable=False)

    # 生成 6 位数字码
    code = f"{secrets.randbelow(1000000):06d}"
    ttl = _setting_int(db, "sms_code_ttl_seconds", 300)

    from ..core.security import hash_password
    record = SmsVerificationCode(
        phone=phone,
        code_hash=hash_password(code),
        purpose=purpose,
        user_id=user_id or None,
        username=username or "",
        client_ip=client_ip or "",
        expires_at=datetime.utcnow() + timedelta(seconds=ttl),
    )
    db.add(record)
    db.flush()  # 拿 id 作为 out_id（幂等）

    try:
        send_sms_code(db, phone, code, out_id=record.id)
    except SmsError:
        # 发送失败：删除记录，避免留下不可用的验证码行
        db.delete(record)
        db.flush()
        raise

    _purge_expired_codes(db)
    db.commit()
    return {
        "ok": True,
        "masked_phone": _mask_phone(phone),
        "cooldown_seconds": _setting_int(db, "sms_cooldown_seconds", 60),
    }


def verify_code(db, phone: str, code: str, purpose: str,
                user_id: str = "", consume: bool = True) -> bool:
    """校验验证码。通过返回 True；失败返回 False。

    - 查该 phone+purpose 最新未消费未过期记录；
    - bcrypt 校验（与密码同等级）；
    - 错误累加 attempt_count，达上限标记 consumed；
    - 成功标记 consumed（一次性消费）。
    - 用户不存在 / 无有效码时走 dummy bcrypt，规避时序枚举。
    """
    phone = _normalize_phone(phone)
    max_attempts = _setting_int(db, "sms_max_attempts", 5)

    with _code_lock:
        record = db.query(SmsVerificationCode).filter(
            SmsVerificationCode.phone == phone,
            SmsVerificationCode.purpose == purpose,
            SmsVerificationCode.consumed_at.is_(None),
            SmsVerificationCode.expires_at > datetime.utcnow(),
        ).order_by(SmsVerificationCode.created_at.desc()).first()

        if not record:
            # 时序对齐：补一次 dummy bcrypt
            from ..core.security import verify_password
            verify_password(code, _dummy_code_hash())
            return False

        if not verify_password(code, record.code_hash):
            record.attempt_count = (record.attempt_count or 0) + 1
            if record.attempt_count >= max_attempts:
                record.consumed_at = datetime.utcnow()  # 错误达上限，强制作废
            db.commit()
            return False

        if consume:
            record.consumed_at = datetime.utcnow()
            db.commit()
        return True


def remaining_attempts(db, phone: str, purpose: str) -> int:
    """返回某 phone+purpose 当前剩余可错误次数（用于前端提示）。"""
    phone = _normalize_phone(phone)
    max_attempts = _setting_int(db, "sms_max_attempts", 5)
    record = db.query(SmsVerificationCode).filter(
        SmsVerificationCode.phone == phone,
        SmsVerificationCode.purpose == purpose,
        SmsVerificationCode.consumed_at.is_(None),
        SmsVerificationCode.expires_at > datetime.utcnow(),
    ).order_by(SmsVerificationCode.created_at.desc()).first()
    if not record:
        return max_attempts
    return max(0, max_attempts - (record.attempt_count or 0))


def _mask_phone(phone: str) -> str:
    """脱敏：138****8000（国内 11 位）/ +86 *** **** 8000（国际）。"""
    p = _normalize_phone(phone)
    if len(p) == 11:
        return f"{p[:3]}****{p[-4:]}"
    if len(p) > 4:
        return p[:2] + "*" * (len(p) - 6) + p[-4:]
    return "*" * len(p)
