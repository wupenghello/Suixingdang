"""应用配置 - 从环境变量读取所有配置项。"""

import os
from pydantic_settings import BaseSettings
from pathlib import Path


class Settings(BaseSettings):
    # 运行环境：dev（默认，放行弱密钥校验）/ production（强制强密钥，禁用文档）
    ENV: str = "dev"
    # 服务器
    DOMAIN: str = "localhost"
    # 兼容字段：未单独配置 JWT_SECRET / DATA_ENCRYPTION_KEY 时回退到此值。
    # 生产部署应分别设置 JWT_SECRET 与 DATA_ENCRYPTION_KEY，使签名密钥与
    # 加密密钥相互独立，避免一钥泄露同时击穿认证与静态数据加密。
    SECRET_KEY: str = "dev-secret-change-me"

    # 独立密钥：JWT 签名 / 静态数据加密（Fernet 派生）。为空则回退 SECRET_KEY。
    JWT_SECRET: str = ""
    DATA_ENCRYPTION_KEY: str = ""

    # 是否暴露 /docs /redoc /openapi.json（默认关闭，调试/本地开发置 true）
    ENABLE_API_DOCS: bool = False

    # 调试逃生开关：production 环境下强制放行弱密钥校验。切勿在生产长期开启。
    ALLOW_INSECURE_SECRETS: bool = False

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
    DATABASE_PATH: str = "/data/db.sqlite"

    # 嵌入：default=ChromaDB 内置 all-MiniLM-L6-v2（零配置）/ openai=OpenAI Embedding API
    # 注意：LLM 配置已迁移到数据库（管理后台「大模型配置」页面维护），不再从环境变量读取。
    EMBEDDING_PROVIDER: str = "default"
    OPENAI_EMBEDDING_MODEL: str = "text-embedding-3-small"

    # JWT
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    REFRESH_TOKEN_EXPIRE_DAYS: int = 1  # 浏览器会话刷新令牌有效期：1 天
    DOWNLOAD_GRANT_MINUTES: int = 5     # 浏览器临时下载授权窗口（分钟），默认 5
    SESSION_REUSE_HOURS: int = 5        # 同一设备(IP+UA)会话复用窗口（小时）：窗口内重复登录复用既有会话，不新增会话行

    MAX_CONCURRENT_SESSIONS: int = 5       # 单用户活跃浏览器会话上限；超出自动吊销最早的。0=不限制
    SESSION_IDLE_TIMEOUT_MINUTES: int = 0  # 会话空闲超时（分钟）；超过无活动自动失效。0=不限制
    GEOIP_DB_PATH: str = ""                # MaxMind GeoLite2-City.mmdb 路径；留空则不做地域解析

    # Cookie（浏览器会话令牌）：HttpOnly + Secure + SameSite=Lax，前端 JS 不可读，防 XSS 偷令牌。
    # 设备令牌（守护进程）仍走 Authorization 头，不受影响。
    COOKIE_SAMESITE: str = "lax"        # lax / strict / none（none 须配合 Secure=True）
    # COOKIE_SECURE 由 cookie_secure 属性按 DOMAIN 派生：localhost/127.0.0.1 开发环境 False，生产 True

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
    def cookie_secure(self) -> bool:
        """Cookie Secure 标志：非 localhost 域名（生产 HTTPS）置 True；本地 HTTP 开发置 False。"""
        return self.DOMAIN not in ("localhost", "127.0.0.1")

    @property
    def trusted_proxies_networks(self) -> list:
        """受信任代理网络列表（支持精确 IP 与 CIDR，如 172.18.0.0/16）。"""
        import ipaddress
        raw = (self.TRUSTED_PROXIES or "").strip()
        if not raw:
            return []
        nets = []
        for p in raw.split(","):
            p = p.strip()
            if not p:
                continue
            try:
                nets.append(ipaddress.ip_network(p, strict=False))
            except ValueError:
                continue
        return nets

    def is_trusted_proxy(self, ip: str) -> bool:
        """判断 IP 是否落在受信任代理网络内（支持 CIDR）。"""
        if not ip:
            return False
        import ipaddress
        try:
            addr = ipaddress.ip_address(ip)
        except ValueError:
            return False
        return any(
            addr.version == n.version and addr in n
            for n in self.trusted_proxies_networks
        )


settings = Settings()


def validate_runtime_secrets():
    """启动时校验密钥：production 环境拒绝默认/空密钥，避免 JWT 可伪造。

    dev 环境（默认）直接放行，不影响本地开发与测试。
    """
    if settings.ENV != "production":
        return
    problems = []
    if settings.SECRET_KEY in ("", "dev-secret-change-me"):
        problems.append("SECRET_KEY 仍为默认值或为空")
    if settings.ADMIN_PASSWORD in ("", "admin"):
        problems.append("ADMIN_PASSWORD 为默认值")
    if problems and not settings.ALLOW_INSECURE_SECRETS:
        raise RuntimeError(
            "[Suixingdang] 生产环境密钥校验失败：\n  - "
            + "\n  - ".join(problems)
            + "\n请在 .env 中用 openssl rand -hex 32 设置强随机值；"
            "调试时可显式置 ALLOW_INSECURE_SECRETS=true 临时放行。"
        )
    if problems:
        print(f"[Suixingdang] ⚠️ 跳过密钥校验（ALLOW_INSECURE_SECRETS=true）：{problems}")
