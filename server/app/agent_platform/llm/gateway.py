"""LLM 网关：多租户 provider 解析 + 统一超时/重试策略的唯一出口。

所有 agent 调用经此构造客户端——修复历史上 brain.py / tools.py 各自裸调
create() 继承 SDK 默认 ~600s 超时的问题。未来切换循环引擎（Pydantic AI 等）
只需替换 runtime/loop.py 内部实现，本网关接口不变。
"""

import logging

from openai import OpenAI

logger = logging.getLogger(__name__)

DEFAULT_TIMEOUT = 60.0   # 秒；上游挂起不得钉住连接
DEFAULT_RETRIES = 0      # 客户端层不重试；退避由上层循环/前端取消负责


def resolve_client(user_id: str) -> tuple[OpenAI, str]:
    """解析用户大模型配置 → (client, model)。单次调用只解析一次配置。"""
    from ...core.llm_service import get_llm_config
    cfg = get_llm_config(user_id)
    client = OpenAI(
        api_key=cfg.api_key, base_url=cfg.base_url,
        timeout=DEFAULT_TIMEOUT, max_retries=DEFAULT_RETRIES,
    )
    return client, cfg.model
