"""安全与认证工具：JWT 签发/验证、密码哈希、TOTP。"""

from datetime import datetime, timedelta, timezone
from typing import Optional
import hashlib
import secrets

import jwt
import pyotp
import bcrypt as _bcrypt

from ..config import settings


def hash_password(plain: str) -> str:
    return _bcrypt.hashpw(plain.encode(), _bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return _bcrypt.checkpw(plain.encode(), hashed.encode())
    except Exception:
        return False


def _hkdf_fernet_key(master: str) -> bytes:
    """HKDF-SHA256 派生 Fernet 密钥（URL-safe base64, 32 bytes）。"""
    import base64
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.kdf.hkdf import HKDF
    derived = HKDF(
        algorithm=hashes.SHA256(), length=32, salt=None,
        info=b"suixingdang/fernet/v2",
    ).derive(master.encode())
    return base64.urlsafe_b64encode(derived)


def _sha256_fernet_key(master: str) -> bytes:
    """裸 SHA256 派生（仅用于解密最早版本的遗留密文）。"""
    import base64
    import hashlib
    return base64.urlsafe_b64encode(hashlib.sha256(master.encode()).digest())


def _fernet_key() -> bytes:
    """当前加密密钥：HKDF(DATA_ENCRYPTION_KEY)。"""
    return _hkdf_fernet_key(settings.data_encryption_key)


def _legacy_fernet_keys() -> list:
    """历史解密密钥（按可能命中顺序），用于透明迁移。

    覆盖两段历史：
      1. 首次启动时 DATA_ENCRYPTION_KEY 为空，回退用 HKDF(SECRET_KEY) 加密；
      2. 最早版本用裸 SHA256(SECRET_KEY) 加密。
    这样即使运维在首次启动后才设置或更换 DATA_ENCRYPTION_KEY，旧密文仍可解，
    并由 _migrate_fernet_keys 在每次启动时透明重加密为当前密钥。
    """
    cur = _fernet_key()
    keys = []
    for k in (_hkdf_fernet_key(settings.SECRET_KEY), _sha256_fernet_key(settings.SECRET_KEY)):
        if k != cur and k not in keys:
            keys.append(k)
    return keys


def encrypt_api_key(plaintext: str) -> str:
    """加密 API Key，返回 base64 字符串。空值返回空字符串。"""
    if not plaintext:
        return ""
    from cryptography.fernet import Fernet
    return Fernet(_fernet_key()).encrypt(plaintext.encode()).decode()


def decrypt_api_key(ciphertext: str) -> str:
    """解密 API Key，返回明文。空值或解密失败返回空字符串。

    依次尝试当前密钥与全部历史密钥，保证迁移窗口与密钥轮换后旧密文仍可解。
    """
    if not ciphertext:
        return ""
    from cryptography.fernet import Fernet
    for key in [_fernet_key()] + _legacy_fernet_keys():
        try:
            return Fernet(key).decrypt(ciphertext.encode()).decode()
        except Exception:
            continue
    return ""


def create_access_token(data: dict, expires_minutes: Optional[int] = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=expires_minutes or settings.ACCESS_TOKEN_EXPIRE_MINUTES
    )
    to_encode["exp"] = expire
    to_encode["type"] = "access"
    to_encode["jti"] = secrets.token_urlsafe(8)
    return jwt.encode(to_encode, settings.jwt_secret, algorithm=settings.JWT_ALGORITHM)


def create_refresh_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode["exp"] = expire
    to_encode["type"] = "refresh"
    to_encode["jti"] = secrets.token_urlsafe(8)
    return jwt.encode(to_encode, settings.jwt_secret, algorithm=settings.JWT_ALGORITHM)


def decode_token(token: str) -> Optional[dict]:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.JWT_ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None


def generate_token_hash():
    raw = secrets.token_urlsafe(32)
    h = hashlib.sha256(raw.encode()).hexdigest()
    return raw, h


def verify_token_hash(raw: str, h: str) -> bool:
    return hashlib.sha256(raw.encode()).hexdigest() == h


def generate_totp_secret() -> str:
    return pyotp.random_base32()


def get_totp_uri(secret: str, label: str = "Suixingdang") -> str:
    totp = pyotp.TOTP(secret)
    return totp.provisioning_uri(name=label, issuer_name="Suixingdang")


def verify_totp(secret: str, code: str) -> bool:
    totp = pyotp.TOTP(secret)
    return totp.verify(code, valid_window=1)


# ---- 密码强度校验 ----

WEAK_PASSWORDS = {
    "password", "12345678", "123456789", "1234567890",
    "admin", "demo", "qwerty123", "abc12345", "iloveyou",
}


def validate_password(password: str, username: str = "") -> Optional[str]:
    """校验密码强度。通过返回 None，否则返回错误提示。"""
    if not password or len(password) < 8:
        return "密码至少 8 个字符"
    if password.lower() in WEAK_PASSWORDS:
        return "密码过于简单，请更换"
    if username and password.lower() == username.lower():
        return "密码不能与用户名相同"
    return None
