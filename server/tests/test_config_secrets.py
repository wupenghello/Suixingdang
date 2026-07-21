"""配置密钥严格化回归测试（S0 止血）。

覆盖：
- 默认/空 SECRET_KEY、默认 ADMIN_PASSWORD 在任何环境都被拒绝（不再 ENV 门控）
- JWT_SECRET / DATA_ENCRYPTION_KEY 未配置被拒绝（不得静默回退 SECRET_KEY）
- ALLOW_INSECURE_SECRETS 显式逃生（打印告警，不抛）
- jwt_secret / data_encryption_key 属性：独立值优先；仅逃生开关开启时回退
"""

import pytest

from app.config import settings, validate_runtime_secrets

STRONG = "strong-random-0123456789abcdef0123456789abcdef"


@pytest.fixture
def strict_env(monkeypatch):
    """一组"全强"的基线配置，各测试在其上篡改单项。"""
    monkeypatch.setattr(settings, "SECRET_KEY", STRONG)
    monkeypatch.setattr(settings, "JWT_SECRET", STRONG + "-jwt")
    monkeypatch.setattr(settings, "DATA_ENCRYPTION_KEY", STRONG + "-dek")
    monkeypatch.setattr(settings, "ADMIN_PASSWORD", "strong-admin-pw-123")
    monkeypatch.setattr(settings, "ALLOW_INSECURE_SECRETS", False)
    return settings


def test_baseline_passes(strict_env):
    validate_runtime_secrets()  # 不抛即通过


def test_default_secret_key_rejected(strict_env, monkeypatch):
    monkeypatch.setattr(settings, "SECRET_KEY", "dev-secret-change-me")
    with pytest.raises(RuntimeError, match="SECRET_KEY"):
        validate_runtime_secrets()


def test_default_admin_password_rejected(strict_env, monkeypatch):
    monkeypatch.setattr(settings, "ADMIN_PASSWORD", "admin")
    with pytest.raises(RuntimeError, match="ADMIN_PASSWORD"):
        validate_runtime_secrets()


def test_missing_jwt_secret_rejected(strict_env, monkeypatch):
    """历史上 ENV != production 时全量放行——现校验恒生效。"""
    monkeypatch.setattr(settings, "JWT_SECRET", "")
    monkeypatch.setattr(settings, "ENV", "dev")  # dev 也不再放行
    with pytest.raises(RuntimeError, match="JWT_SECRET"):
        validate_runtime_secrets()


def test_missing_data_encryption_key_rejected(strict_env, monkeypatch):
    monkeypatch.setattr(settings, "DATA_ENCRYPTION_KEY", "")
    with pytest.raises(RuntimeError, match="DATA_ENCRYPTION_KEY"):
        validate_runtime_secrets()


def test_escape_hatch_allows_with_warning(strict_env, monkeypatch, capsys):
    monkeypatch.setattr(settings, "SECRET_KEY", "dev-secret-change-me")
    monkeypatch.setattr(settings, "JWT_SECRET", "")
    monkeypatch.setattr(settings, "ALLOW_INSECURE_SECRETS", True)
    validate_runtime_secrets()  # 不抛
    assert "ALLOW_INSECURE_SECRETS" in capsys.readouterr().out


def test_jwt_secret_property_requires_independent_value(strict_env, monkeypatch):
    monkeypatch.setattr(settings, "JWT_SECRET", "")
    with pytest.raises(RuntimeError, match="JWT_SECRET"):
        _ = settings.jwt_secret


def test_jwt_secret_property_fallback_only_with_escape(strict_env, monkeypatch):
    monkeypatch.setattr(settings, "JWT_SECRET", "")
    monkeypatch.setattr(settings, "ALLOW_INSECURE_SECRETS", True)
    assert settings.jwt_secret == settings.SECRET_KEY


def test_dek_property_requires_independent_value(strict_env, monkeypatch):
    monkeypatch.setattr(settings, "DATA_ENCRYPTION_KEY", "")
    with pytest.raises(RuntimeError, match="DATA_ENCRYPTION_KEY"):
        _ = settings.data_encryption_key


def test_independent_values_preferred(strict_env):
    assert settings.jwt_secret == STRONG + "-jwt"
    assert settings.data_encryption_key == STRONG + "-dek"
