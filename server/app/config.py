"""应用配置 - 从环境变量读取所有配置项。"""

import os
from pydantic_settings import BaseSettings
from pathlib import Path


class Settings(BaseSettings):
    # 服务器
    DOMAIN: str = "localhost"
    # 兼容字段：未单独配置 JWT_SECRET / DATA_ENCRYPTION_KEY 时回退到此值。
    # 生产部署应分别设置 JWT_SECRET 与 DATA_ENCRYPTION_KEY，使签名密钥与
    # 加密密钥相互独立，避免一钥泄露同时击穿认证与静态数据加密。
    SECRET_KEY: str = "dev-secret-change-me"

    # 独立密钥：JWT 签名 / 静态数据加密（Fernet 派生）。为空则回退 SECRET_KEY。
    JWT_SECRET: str = ""
    DATA_ENCRYPTION_KEY: str = ""

    # CORS 白名单（逗号分隔）。为空时按 DOMAIN 派生 https://<DOMAIN>。
    CORS_ORIGINS: str = ""

    # 受信任的反向代理地址（逗号分隔的 IP/CIDR）。仅当直连对端在此集合内时，
    # 才信任 X-Forwarded-For / X-Real-IP；否则用 TCP 对端 IP，防 XFF 伪造绕过限流。
    TRUSTED_PROXIES: str = ""

    # 管理员
    ADMIN_USERNAME: str = "admin"
    ADMIN_PASSWORD: str = "admin"
    # 首次部署若 ADMIN_PASSWORD 弱（<8 位），需显式置 ALLOW_WEAK_ADMIN_PASSWORD=true 才允许播种
    ALLOW_WEAK_ADMIN_PASSWORD: bool = False

    # 多账户
    ALLOW_REGISTER: bool = True       # 是否开放用户注册
    DEFAULT_QUOTA_MB: int = 0          # 新用户默认配额，0=无限

    # 存储
    STORAGE_DIR: str = "/data/files"
    DATABASE_PATH: str = "/data/suixingdang.db"

    # 嵌入：default=ChromaDB 内置 all-MiniLM-L6-v2（零配置）/ openai=OpenAI Embedding API
    # 注意：LLM 配置已迁移到数据库（管理后台「大模型配置」页面维护），不再从环境变量读取。
    EMBEDDING_PROVIDER: str = "default"
    OPENAI_EMBEDDING_MODEL: str = "text-embedding-3-small"

    # JWT
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30

    class Config:
        env_file = ".env"
        extra = "ignore"

    @property
    def storage_path(self) -> Path:
        p = Path(self.STORAGE_DIR)
        p.mkdir(parents=True, exist_ok=True)
        return p

    @property
    def database_url(self) -> str:
        return f"sqlite+aiosqlite:///{self.DATABASE_PATH}"

    @property
    def jwt_secret(self) -> str:
        """JWT 签名密钥；未单独配置则回退 SECRET_KEY。"""
        return self.JWT_SECRET or self.SECRET_KEY

    @property
    def data_encryption_key(self) -> str:
        """静态数据加密主密钥（Fernet 派生用）；未单独配置则回退 SECRET_KEY。"""
        return self.DATA_ENCRYPTION_KEY or self.SECRET_KEY

    @property
    def cors_origins_list(self) -> list:
        """CORS 允许来源列表。显式配置优先；否则按 DOMAIN 派生。"""
        raw = (self.CORS_ORIGINS or "").strip()
        if raw:
            return [o.strip().rstrip("/") for o in raw.split(",") if o.strip()]
        scheme = "http" if self.DOMAIN in ("localhost", "127.0.0.1") else "https"
        return [f"{scheme}://{self.DOMAIN}"]

    @property
    def trusted_proxies_set(self) -> set:
        """受信任代理 IP 集合（仅按精确 IP 匹配；CIDR 解析留待后续）。"""
        raw = (self.TRUSTED_PROXIES or "").strip()
        if not raw:
            return set()
        return {p.strip() for p in raw.split(",") if p.strip()}


settings = Settings()
