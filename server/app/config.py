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

    # LLM
    LLM_PROVIDER: str = "deepseek"
    DEEPSEEK_API_KEY: str = ""
    DEEPSEEK_BASE_URL: str = "https://api.deepseek.com"
    DEEPSEEK_MODEL: str = "deepseek-chat"
    OPENAI_API_KEY: str = ""
    OPENAI_BASE_URL: str = "https://api.openai.com/v1"
    OPENAI_MODEL: str = "gpt-4o-mini"

    # 嵌入
    EMBEDDING_PROVIDER: str = "deepseek"
    OPENAI_EMBEDDING_MODEL: str = "text-embedding-3-small"

    # JWT
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30

    class Config:
        env_file = ".env"
        extra = "ignore"

    @property
    def llm_api_key(self) -> str:
        if self.LLM_PROVIDER == "deepseek":
            return self.DEEPSEEK_API_KEY
        return self.OPENAI_API_KEY

    @property
    def llm_base_url(self) -> str:
        if self.LLM_PROVIDER == "deepseek":
            return self.DEEPSEEK_BASE_URL
        return self.OPENAI_BASE_URL

    @property
    def llm_model(self) -> str:
        if self.LLM_PROVIDER == "deepseek":
            return self.DEEPSEEK_MODEL
        return self.OPENAI_MODEL

    @property
    def storage_path(self) -> Path:
        p = Path(self.STORAGE_DIR)
        p.mkdir(parents=True, exist_ok=True)
        return p

    @property
    def database_url(self) -> str:
        return f"sqlite+aiosqlite:///{self.DATABASE_PATH}"


settings = Settings()
