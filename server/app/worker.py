"""后台 worker 进程：领取 jobs 表任务并执行。

用法：python -m app.worker
compose 中以独立服务运行（与 web 同镜像，不同 CMD）。

注册 handler：HANDLERS[kind] = fn(payload: dict) -> dict（可抛异常触发重试）。
"""

import logging
import os
import signal
import time

from .task_queue import TaskQueue
from .db.models import SessionLocal

logger = logging.getLogger(__name__)

_running = True


def _stop(*_):
    global _running
    _running = False


def handle_purge_trash(payload: dict) -> dict:
    """全局/单用户回收站过期清理（payload: {user_id?}）。"""
    from .services import trash as trash_service
    db = SessionLocal()
    try:
        purged = trash_service.purge_expired(db, user_id=payload.get("user_id") or None,
                                             write_access_log=False)
        return {"purged": purged}
    finally:
        db.close()


def handle_reindex_file(payload: dict) -> dict:
    """重建单文件索引（payload: {user_id, file_id, path}）。"""
    from .core import indexer
    indexer.index_file(payload["user_id"], payload["file_id"], payload["path"])
    return {"indexed": payload["path"]}


def handle_noop(payload: dict) -> dict:
    return {"ok": True, "echo": payload}


HANDLERS = {
    "purge_trash": handle_purge_trash,
    "reindex_file": handle_reindex_file,
    "noop": handle_noop,
}


def run(poll_interval: float = 2.0, once: bool = False):
    """主循环。once=True 时处理完当前队列即返回（测试/单次任务用）。"""
    from .core.logging import setup_logging
    setup_logging()

    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)
    worker_id = f"worker-{os.getpid()}"
    queue = TaskQueue()
    logger.info("worker 启动: %s", worker_id)

    idle = 0
    while _running:
        job = queue.claim(worker_id)
        if job is None:
            if once:
                break
            time.sleep(poll_interval)
            continue
        handler = HANDLERS.get(job.kind)
        if handler is None:
            queue.fail(job.id, f"未知任务类型: {job.kind}", permanent=True)
            continue
        try:
            result = handler(job.payload or {})
            queue.complete(job.id, result)
            logger.info("任务完成: id=%s kind=%s", job.id, job.kind)
        except Exception as e:
            logger.exception("任务执行异常: id=%s kind=%s", job.id, job.kind)
            queue.fail(job.id, f"{type(e).__name__}: {e}")


if __name__ == "__main__":
    run()
