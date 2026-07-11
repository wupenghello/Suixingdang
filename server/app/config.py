"""应用配置 - 从环境变量读取所有配置项。"""

import os
from pydantic_settings import BaseSettings
from pathlib import Path


class Settings(BaseSettings):
    # 服务器
    DOMAIN: str = "localhost"
    SECRET_KEY: str = "dev-secret-change-me"

    # 管理员
    ADMIN_USERNAME: str = "admin"
    ADMIN_PASSWORD: str = "admin"
 
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


settings = Settings()
