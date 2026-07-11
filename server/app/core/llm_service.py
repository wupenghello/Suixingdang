"""大模型配置服务：按 user_id 解析用户可用的大模型配置。

所有 LLM 调用入口（brain.py / tools.py）都通过本模块获取解密后的
api_key / base_url / model，不再依赖 config.py 中的环境变量。
"""

from dataclasses import dataclass
from typing import Optional

from ..db.models import LlmProvider, User, SessionLocal
from .security import decrypt_api_key


@dataclass
class LlmConfig:
    api_key: str
    base_url: str
    model: str
    provider_name: str = ""


class NoLlmConfigured(Exception):
    """没有可用的大模型配置。"""


class AiDisabled(Exception):
    """用户未获准使用 AI 助手。"""


def _resolve_provider(user, db) -> Optional[LlmProvider]:
    """解析用户分配的大模型：优先用户专属分配，其次默认模型。

    接收已查询到的 user 对象，避免在 get_llm_config / check_ai_access 中重复查询。
    """
    if not user or not user.ai_enabled:
        return None
    # 1. 用户专属分配
    if user.llm_provider_id:
        p = db.query(LlmProvider).filter_by(id=user.llm_provider_id, enabled=True).first()
        if p:
            return p
    # 2. 默认模型
    return db.query(LlmProvider).filter_by(enabled=True, is_default=True).first()


def get_llm_config(user_id: str) -> LlmConfig:
    """按 user_id 获取解密后的大模型配置。

    Raises:
        AiDisabled: 用户 AI 权限未开启
        NoLlmConfigured: 没有可用的大模型，或模型 API Key 缺失/失效
    """
    db = SessionLocal()
    try:
        user = db.query(User).filter_by(id=user_id).first()
        if not user or not user.ai_enabled:
            raise AiDisabled("管理员未为您开通 AI 助手功能")
        provider = _resolve_provider(user, db)
        if not provider:
            raise NoLlmConfigured("尚未配置可用的大模型，请联系管理员")
        api_key = decrypt_api_key(provider.api_key_enc)
        if not api_key:
            # API Key 为空或解密失败（如 SECRET_KEY 被更换导致历史密文无法解密），
            # 此时不应放行——否则会在真正调用 LLM 时才以 500 报错，误导排查。
            raise NoLlmConfigured("大模型 API Key 未配置或已失效，请联系管理员")
        return LlmConfig(
            api_key=api_key,
            base_url=provider.base_url,
            model=provider.model,
            provider_name=provider.name,
        )
    finally:
        db.close()


def check_ai_access(user_id: str) -> tuple:
    """轻量检查：返回 (是否可用, 提示消息)。"""
    db = SessionLocal()
    try:
        user = db.query(User).filter_by(id=user_id).first()
        if not user or not user.ai_enabled:
            return False, "管理员未为您开通 AI 助手功能"
        provider = _resolve_provider(user, db)
        if not provider:
            return False, "尚未配置可用的大模型，请联系管理员"
        if not decrypt_api_key(provider.api_key_enc):
            return False, "大模型 API Key 未配置或已失效，请联系管理员"
        return True, ""
    finally:
        db.close()


def get_default_embedding_config():
    """为 indexer 提供 embedding 用的 API Key / base_url。

    当 EMBEDDING_PROVIDER=openai 时，复用默认大模型的凭据，
    避免 env 中重复维护 API Key。
    """
    db = SessionLocal()
    try:
        p = db.query(LlmProvider).filter_by(enabled=True, is_default=True).first()
        if not p:
            return "", ""
        return decrypt_api_key(p.api_key_enc), p.base_url
    finally:
        db.close()
