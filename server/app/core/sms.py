"""短信服务层：抽象接口 + 阿里云 RPC 签名实现（零外部 SDK 依赖）。

设计要点：
- 不引入 alibabacloud-dysmsapi SDK，用 urllib + hmac 直接调阿里云 RPC 接口，
  保持项目「零依赖引入」传统（见 docs/DESIGN.md §5.1）。
- 凭据从 SystemSetting 运行时读取（Fernet 解密），代码层零硬编码。
- 所有异常收敛为 SmsError，调用方按 retryable 决定是否重试。
"""

import hashlib
import hmac
import json
import secrets
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta
from typing import Optional


class SmsError(Exception):
    """短信发送失败。retryable=True 表示可重试（网络/服务端瞬时错误）。"""

    def __init__(self, message: str, retryable: bool = False):
        super().__init__(message)
        self.retryable = retryable


class AliyunSmsConfig:
    """阿里云短信配置（从 SystemSetting 读取，带缓存）。"""

    def __init__(self, access_key_id: str, access_key_secret: str,
                 sign_name: str, template_code: str,
                 endpoint: str = "dysmsapi.aliyuncs.com"):
        self.access_key_id = access_key_id
        self.access_key_secret = access_key_secret
        self.sign_name = sign_name
        self.template_code = template_code
        self.endpoint = endpoint

    @property
    def configured(self) -> bool:
        return bool(self.access_key_id and self.access_key_secret
                    and self.sign_name and self.template_code)


# ---- 配置读取（带进程内短缓存，set_setting 写入即失效由调用方处理）----

_sms_config_cache: Optional[AliyunSmsConfig] = None
_sms_config_cached_at: float = 0
_SMS_CONFIG_TTL = 30  # 秒；与 settings_store 的 30s TTL 对齐


def _get_sms_config(db) -> Optional[AliyunSmsConfig]:
    """读 SystemSetting 构造配置；未配置返回 None。带 30s 缓存。"""
    from ..core.settings_store import get_cached_setting
    from ..core.security import decrypt_api_key
    global _sms_config_cache, _sms_config_cached_at
    now = time.time()
    if _sms_config_cache is not None and now - _sms_config_cached_at < _SMS_CONFIG_TTL:
        return _sms_config_cache
    raw_id = get_cached_setting(db, "sms_aliyun_access_key_id", "")
    raw_secret_enc = get_cached_setting(db, "sms_aliyun_access_key_secret", "")
    sign = get_cached_setting(db, "sms_aliyun_sign_name", "")
    tpl = get_cached_setting(db, "sms_aliyun_template_code", "")
    endpoint = get_cached_setting(db, "sms_aliyun_endpoint", "dysmsapi.aliyuncs.com")
    secret = decrypt_api_key(raw_secret_enc) if raw_secret_enc else ""
    cfg = AliyunSmsConfig(raw_id, secret, sign, tpl, endpoint) if raw_id else None
    _sms_config_cache = cfg
    _sms_config_cached_at = now
    return cfg


def invalidate_sms_config_cache():
    """set_setting 写入 sms_* 时调用，使下次读取拿到新值。"""
    global _sms_config_cache, _sms_config_cached_at
    _sms_config_cache = None
    _sms_config_cached_at = 0
    # 同时清理 settings_store 的缓存，避免 get_cached_setting 返回旧值
    from .settings_store import _setting_cache
    for k in list(_setting_cache.keys()):
        if k.startswith("sms_"):
            _setting_cache.pop(k, None)


def _percent_encode(s: str) -> str:
    """阿里云规范 percent-encode：大写、空格→%20（非 +）。"""
    return urllib.parse.quote(s, safe="").replace("+", "%22").replace("*", "%2A").replace("%7E", "~")


def _sign(params: dict, access_key_secret: str) -> str:
    """阿里云 RPC HMAC-SHA1 签名。"""
    sorted_qs = "&".join(f"{_percent_encode(k)}={_percent_encode(str(v))}"
                         for k, v in sorted(params.items()))
    str_to_sign = "GET&%2F&" + _percent_encode(sorted_qs)
    key = (access_key_secret + "&").encode()
    sig = hmac.new(key, str_to_sign.encode(), hashlib.sha1).digest()
    import base64
    return base64.b64encode(sig).decode()


def _build_request_params(cfg: AliyunSmsConfig, phone: str, code: str, out_id: str) -> dict:
    """构造阿里云 SendSms 接口的全部查询参数（不含 Signature）。"""
    params = {
        "Action": "SendSms",
        "Version": "2017-05-25",
        "Format": "JSON",
        "Timestamp": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "SignatureMethod": "HMAC-SHA1",
        "SignatureVersion": "1.0",
        "SignatureNonce": secrets.token_urlsafe(16),
        "AccessKeyId": cfg.access_key_id,
        "PhoneNumbers": phone,
        "SignName": cfg.sign_name,
        "TemplateCode": cfg.template_code,
        "TemplateParam": json.dumps({"code": code}, ensure_ascii=False),
        "OutId": out_id,
    }
    params["Signature"] = _sign(params, cfg.access_key_secret)
    return params


def send_sms_code(db, phone: str, code: str, out_id: str = "") -> dict:
    """发送短信验证码。返回 {"ok": True} 或抛 SmsError。

    out_id 为业务幂等 ID（取验证码记录 id），阿里云侧用于去重。
    """
    cfg = _get_sms_config(db)
    if not cfg or not cfg.configured:
        raise SmsError("短信服务未配置", retryable=False)
    params = _build_request_params(cfg, phone, code, out_id or secrets.token_urlsafe(8))
    url = f"https://{cfg.endpoint}/?{urllib.parse.urlencode(params)}"
    try:
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = resp.read().decode()
            data = json.loads(body)
        if data.get("Code") == "OK":
            return {"ok": True, "biz_id": data.get("BizId")}
        # 限流 / 服务端错误可重试；参数/签名错误不可重试
        retryable = data.get("Code") in ("isp.SYSTEM_ERROR", "isv.BUSINESS_LIMIT_CONTROL")
        raise SmsError(f"阿里云返回 {data.get('Code')}: {data.get('Message')}", retryable=retryable)
    except urllib.error.URLError as e:
        raise SmsError(f"网络错误: {e.reason}", retryable=True)
    except json.JSONDecodeError:
        raise SmsError("阿里云响应解析失败", retryable=True)


def is_sms_enabled(db) -> bool:
    """短信总开关：sms_enabled=true 且配置完整。"""
    from ..core.settings_store import get_cached_setting
    flag = get_cached_setting(db, "sms_enabled", "false")
    if flag.lower() != "true":
        return False
    cfg = _get_sms_config(db)
    return bool(cfg and cfg.configured)


def is_sms_required_for(db, purpose: str) -> bool:
    """某用途是否强制短信：总开关 + 用途开关。purpose = login / register。"""
    if not is_sms_enabled(db):
        return False
    from ..core.settings_store import get_cached_setting
    return get_cached_setting(db, f"sms_required_for_{purpose}", "true").lower() == "true"
