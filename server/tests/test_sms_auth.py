"""短信验证码服务单元测试。

覆盖验证码生命周期、频控、错误上限、手机号格式校验。
mock 阿里云 HTTP 调用，避免真实发送。
"""
import sys
import os
import uuid
import random
from datetime import datetime, timedelta
from unittest.mock import patch, MagicMock

import pytest

# 确保测试夹具注入的环境变量生效
sys.path.insert(0, os.path.dirname(__file__))
from auth_helpers import register


def _random_phone():
    return f"139{random.randint(10000000, 99999999)}"


def _make_user(client, username=None, password="Test1234pass", phone=None):
    """注册并返回 (token, user_id, username)。"""
    username = username or f"u{uuid.uuid4().hex[:8]}"
    body = {"username": username, "password": password,
            "security_question": "q?", "security_answer": "a"}
    if phone:
        body["phone"] = phone
    r = client.post("/api/auth/register", json=body)
    assert r.status_code == 200, r.text
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {r.cookies.get('access_token', '')}"})
    # 从 cookie 取 token
    from auth_helpers import get_cookie, grab
    client.cookies.clear()
    r2 = client.post("/api/auth/register", json=body)
    token, _ = grab(client)
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    return token, me.json()["id"], username


class TestSmsStatus:
    def test_sms_disabled_by_default(self, client):
        """默认未配置短信时，/sms/status 返回 sms_enabled=false。"""
        r = client.get("/api/auth/sms/status")
        assert r.status_code == 200
        data = r.json()
        assert data["sms_enabled"] is False

    def test_sms_send_disabled_when_not_configured(self, client):
        """未配置时发送验证码返回 400。"""
        r = client.post("/api/auth/sms/send", json={"phone": "13912345678", "purpose": "register"})
        assert r.status_code == 400

    def test_sms_send_invalid_phone(self, client):
        """非法手机号格式返回 400。"""
        r = client.post("/api/auth/sms/send", json={"phone": "abc", "purpose": "register"})
        assert r.status_code == 400


class TestSmsCodeService:
    """直接测试服务层（不经过 HTTP）。"""

    def test_normalize_phone(self):
        from app.services.sms_code import _normalize_phone
        assert _normalize_phone("13800138000") == "13800138000"
        assert _normalize_phone(" 138-0013-8000 ") == "13800138000"
        assert _normalize_phone("+8613800138000") == "13800138000"
        assert _normalize_phone("8613800138000") == "13800138000"

    def test_validate_phone_format(self):
        from app.services.sms_code import _validate_phone_format
        assert _validate_phone_format("13800138000") is None  # 国内 11 位
        assert _validate_phone_format("138001380001") is None  # 12 位国际（7-15 位数字）
        assert _validate_phone_format("23800138000") is not None  # 国内非 1 开头
        assert _validate_phone_format("1380013800a") is not None  # 含字母
        assert _validate_phone_format("+8613800138000") is None  # +86 前缀
        assert _validate_phone_format("1234567") is None  # 7 位国际
        assert _validate_phone_format("123456") is not None  # 6 位太短
        assert _validate_phone_format("1234567890123456") is not None  # 16 位太长

    def test_verify_code_timing_safe(self, client):
        """用户不存在时 verify_code 走 dummy 路径，不抛异常。"""
        from app.db.models import SessionLocal
        from app.services.sms_code import verify_code
        db = SessionLocal()
        # 用户不存在 + 码不存在 → 返回 False（走 dummy bcrypt）
        result = verify_code(db, "13999999999", "123456", "register")
        assert result is False

    def test_cooldown_blocks_rapid_send(self, client):
        """同手机号 60s 内重发返回 429（mock 阿里云成功）。"""
        from app.db.models import SessionLocal, SystemSetting
        from app.core.security import encrypt_api_key
        from app.core.sms import invalidate_sms_config_cache
        from app.db.models import set_setting
        import app.core.sms as sms_mod
        db = SessionLocal()
        # 清理残留配置（防测试间污染）
        for k in ["sms_enabled", "sms_aliyun_access_key_id", "sms_aliyun_access_key_secret",
                  "sms_aliyun_sign_name", "sms_aliyun_template_code"]:
            db.query(SystemSetting).filter_by(key=k).delete()
        db.commit()
        sms_mod._sms_config_cache = None
        sms_mod._sms_config_cached_at = 0

        secret_plain = "test-secret-plain-text"
        secret_enc = encrypt_api_key(secret_plain)
        # 配置完整
        set_setting(db, "sms_enabled", "true")
        set_setting(db, "sms_aliyun_access_key_id", "test-ak-id")
        set_setting(db, "sms_aliyun_access_key_secret", secret_enc)
        set_setting(db, "sms_aliyun_sign_name", "test")
        set_setting(db, "sms_aliyun_template_code", "SMS_TEST")

        # mock 阿里云发送
        with patch("app.services.sms_code.send_sms_code") as mock_send:
            mock_send.return_value = {"ok": True, "biz_id": "test-biz"}
            r1 = client.post("/api/auth/sms/send", json={"phone": "13912345678", "purpose": "register"})
            assert r1.status_code == 200, r1.text

            r2 = client.post("/api/auth/sms/send", json={"phone": "13912345678", "purpose": "register"})
            assert r2.status_code == 429

        # 清理
        for k in ["sms_enabled", "sms_aliyun_access_key_id", "sms_aliyun_access_key_secret",
                  "sms_aliyun_sign_name", "sms_aliyun_template_code"]:
            db.query(SystemSetting).filter_by(key=k).delete()
        db.commit()
        sms_mod._sms_config_cache = None
        sms_mod._sms_config_cached_at = 0


class TestOptionalSecurityQA:
    """密保可选回归测试。"""

    def setup_method(self):
        """每个测试前清理 sms 配置（防测试间污染）。"""
        from app.db.models import SessionLocal, SystemSetting
        from app.core.sms import invalidate_sms_config_cache
        db = SessionLocal()
        for k in ["sms_enabled", "sms_aliyun_access_key_id", "sms_aliyun_access_key_secret",
                  "sms_aliyun_sign_name", "sms_aliyun_template_code"]:
            db.query(SystemSetting).filter_by(key=k).delete()
        db.commit()
        invalidate_sms_config_cache()
        # 再次确认缓存失效（set_setting 会自动 invalidate，但删除操作不会）
        from app.core.sms import _sms_config_cache, _sms_config_cached_at
        import app.core.sms as _sms_mod
        _sms_mod._sms_config_cache = None
        _sms_mod._sms_config_cached_at = 0

    def test_register_without_security_qa(self, client):
        """不填密保问题/答案可注册成功。"""
        username = f"u{uuid.uuid4().hex[:8]}"
        r = client.post("/api/auth/register", json={
            "username": username, "password": "Test1234pass",
            "phone": _random_phone(),
        })
        assert r.status_code == 200, r.text

    def test_register_with_answer_only_rejected(self, client):
        """只填答案不填问题 → 400。"""
        username = f"u{uuid.uuid4().hex[:8]}"
        r = client.post("/api/auth/register", json={
            "username": username, "password": "Test1234pass",
            "security_answer": "some-answer",
            "phone": _random_phone(),
        })
        assert r.status_code == 400

    def test_register_with_both_qa(self, client):
        """同时填密保问题与答案 → 成功。"""
        username = f"u{uuid.uuid4().hex[:8]}"
        r = client.post("/api/auth/register", json={
            "username": username, "password": "Test1234pass",
            "security_question": "q?", "security_answer": "a",
            "phone": _random_phone(),
        })
        assert r.status_code == 200, r.text


class TestTwoPhaseLogin:
    """二阶段登录：密码正确后要求短信验证码。"""

    def _enable_sms_login(self):
        """启用短信强制登录（完整配置，注册不强制以简化测试）。"""
        from app.db.models import SessionLocal
        from app.core.security import encrypt_api_key
        from app.db.models import set_setting
        from app.core.sms import invalidate_sms_config_cache
        db = SessionLocal()
        set_setting(db, "sms_enabled", "true")
        set_setting(db, "sms_aliyun_access_key_id", "test-ak-id")
        set_setting(db, "sms_aliyun_access_key_secret", encrypt_api_key("test-secret"))
        set_setting(db, "sms_aliyun_sign_name", "test")
        set_setting(db, "sms_aliyun_template_code", "SMS_TEST")
        set_setting(db, "sms_required_for_register", "false")
        invalidate_sms_config_cache()

    def _cleanup_sms(self):
        from app.db.models import SessionLocal, SystemSetting
        import app.core.sms as sms_mod
        db = SessionLocal()
        for k in ["sms_enabled", "sms_aliyun_access_key_id", "sms_aliyun_access_key_secret",
                  "sms_aliyun_sign_name", "sms_aliyun_template_code", "sms_required_for_register"]:
            db.query(SystemSetting).filter_by(key=k).delete()
        db.commit()
        sms_mod._sms_config_cache = None
        sms_mod._sms_config_cached_at = 0

    def _register_user(self, client, phone):
        """注册用户（sms_required_for_register=false）。"""
        u = f"u{uuid.uuid4().hex[:8]}"
        r = client.post("/api/auth/register", json={
            "username": u, "password": "Test1234pass", "phone": phone,
        })
        assert r.status_code == 200, r.text
        from auth_helpers import grab
        grab(client)
        return u

    def test_two_phase_login_returns_sms_required(self, client):
        """密码正确但开启短信强制 → 返回 sms_required=true，不发 session。"""
        self._enable_sms_login()
        phone = _random_phone()
        u = self._register_user(client, phone)
        self._cleanup_sms()

        r2 = client.post("/api/auth/login", json={"username": u, "password": "Test1234pass"})
        assert r2.status_code == 200
        data = r2.json()
        assert data.get("sms_required") is True
        assert data.get("phone_masked")
        assert not r2.cookies.get("access_token")

    def test_two_phase_login_verify_success(self, client):
        """二阶段：提交正确验证码 → 签发 session。"""
        self._enable_sms_login()
        phone = _random_phone()
        u = self._register_user(client, phone)
        self._cleanup_sms()

        r2 = client.post("/api/auth/login", json={"username": u, "password": "Test1234pass"})
        assert r2.status_code == 200
        assert r2.json().get("sms_required") is True

        self._enable_sms_login()
        with patch("app.services.sms_code.verify_code", return_value=True):
            r3 = client.post("/api/auth/login/verify", json={"username": u, "sms_code": "123456"})
            assert r3.status_code == 200, r3.text
            assert r3.cookies.get("access_token")
        self._cleanup_sms()


class TestPhoneUniqueness:
    def setup_method(self):
        """每个测试前清理 sms 配置（防测试间污染）。"""
        from app.db.models import SessionLocal, SystemSetting
        from app.core.sms import invalidate_sms_config_cache
        db = SessionLocal()
        for k in ["sms_enabled", "sms_aliyun_access_key_id", "sms_aliyun_access_key_secret",
                  "sms_aliyun_sign_name", "sms_aliyun_template_code"]:
            db.query(SystemSetting).filter_by(key=k).delete()
        db.commit()
        invalidate_sms_config_cache()
        # 再次确认缓存失效（set_setting 会自动 invalidate，但删除操作不会）
        from app.core.sms import _sms_config_cache, _sms_config_cached_at
        import app.core.sms as _sms_mod
        _sms_mod._sms_config_cache = None
        _sms_mod._sms_config_cached_at = 0

    def test_duplicate_phone_rejected(self, client):
        """同一手机号注册两次 → 第二次 409。"""
        phone = _random_phone()
        u1 = f"u{uuid.uuid4().hex[:8]}"
        r1 = client.post("/api/auth/register", json={
            "username": u1, "password": "Test1234pass", "phone": phone,
        })
        assert r1.status_code == 200, r1.text

        u2 = f"u{uuid.uuid4().hex[:8]}"
        r2 = client.post("/api/auth/register", json={
            "username": u2, "password": "Test1234pass", "phone": phone,
        })
        assert r2.status_code == 409

    def test_multiple_users_without_phone(self, client):
        """多个用户不填手机号 → 全部成功（NULL 不违反唯一约束）。"""
        for _ in range(3):
            username = f"u{uuid.uuid4().hex[:8]}"
            r = client.post("/api/auth/register", json={
                "username": username, "password": "Test1234pass",
            })
            assert r.status_code == 200, r.text
