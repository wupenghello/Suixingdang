"""结构化日志（structlog）。

- 开发/默认：控制台可读渲染
- LOG_FORMAT=json：JSON 行输出（生产容器日志采集友好）
- 标准库 logging 统一路由进 structlog 处理器链
"""

import logging
import os

import structlog

_configured = False


def setup_logging(json: bool | None = None):
    global _configured
    if _configured:
        return
    use_json = json if json is not None else os.getenv("LOG_FORMAT", "") == "json"

    shared_processors = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
    ]
    if use_json:
        renderer = structlog.processors.JSONRenderer(ensure_ascii=False)
    else:
        renderer = structlog.dev.ConsoleRenderer(colors=False)

    structlog.configure(
        processors=shared_processors + [structlog.stdlib.ProcessorFormatter.wrap_for_formatter],
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )
    formatter = structlog.stdlib.ProcessorFormatter(
        processors=[
            structlog.stdlib.ProcessorFormatter.remove_processors_meta,
            renderer,
        ],
    )
    handler = logging.StreamHandler()
    handler.setFormatter(formatter)
    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(os.getenv("LOG_LEVEL", "INFO").upper())
    # 降低噪声库日志
    for noisy in ("uvicorn.access", "watchdog", "httpx"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    _configured = True


def get_logger(name: str | None = None):
    setup_logging()
    return structlog.get_logger(name)
