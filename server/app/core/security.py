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


def _fernet_key() -> bytes:
    """从 SECRET_KEY 派生固定的 Fernet 密钥（URL-safe base64, 32 bytes）。"""
    import base64
    import hashlib
    digest = hashlib.sha256(settings.SECRET_KEY.encode()).digest()
    return base64.urlsafe_b64encode(digest)


def encrypt_api_key(plaintext: str) -> str:
    """加密 API Key，返回 base64 字符串。空值返回空字符串。"""
    if not plaintext:
        return ""
    from cryptography.fernet import Fernet
    f = Fernet(_fernet_key())
    return f.encrypt(plaintext.encode()).decode()


def decrypt_api_key(ciphertext: str) -> str:
    """解密 API Key，返回明文。空值或解密失败返回空字符串。"""
    if not ciphertext:
        return ""
    from cryptography.fernet import Fernet
    f = Fernet(_fernet_key())
    try:
        return f.decrypt(ciphertext.encode()).decode()
    except Exception:
        return ""


def create_access_token(data: dict, expires_minutes: Optional[int] = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=expires_minutes or settings.ACCESS_TOKEN_EXPIRE_MINUTES
    )
    to_encode["exp"] = expire
    to_encode["type"] = "access"
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def create_refresh_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode["exp"] = expire
    to_encode["type"] = "refresh"
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_token(token: str) -> Optional[dict]:
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
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
