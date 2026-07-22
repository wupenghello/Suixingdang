"""任务队列（jobs 表 + 方言自适应领取，零额外基建）。

- PostgreSQL：FOR UPDATE SKIP LOCKED 并发领取
- SQLite：单写锁串行化（自托管单机足够）

失败重试：指数退避（5s * 2^attempts），超过 max_attempts 置 failed。
worker 入口：app/worker.py。
"""

import logging
import uuid
from datetime import datetime, timedelta

from .db.models import SessionLocal, Job

logger = logging.getLogger(__name__)

BACKOFF_BASE_SECONDS = 5


class TaskQueue:
    def __init__(self, db_factory=SessionLocal):
        self.db_factory = db_factory

    def enqueue(self, kind: str, payload: dict | None = None,
                run_after: datetime | None = None, max_attempts: int = 3) -> str:
        job_id = str(uuid.uuid4())
        with self.db_factory() as db:
            db.add(Job(
                id=job_id, kind=kind, payload=payload or {},
                status="pending", max_attempts=max_attempts,
                run_after=run_after or datetime.utcnow(),
            ))
            db.commit()
        return job_id

    def claim(self, worker_id: str) -> Job | None:
        """领取一个到期任务置为 running；无任务返回 None。"""
        with self.db_factory() as db:
            q = (db.query(Job)
                 .filter(Job.status == "pending", Job.run_after <= datetime.utcnow())
                 .order_by(Job.run_after))
            if db.get_bind().dialect.name != "sqlite":
                q = q.with_for_update(skip_locked=True)
            with db.begin_nested():
                job = q.first()
                if not job:
                    return None
                job.status = "running"
                job.locked_at = datetime.utcnow()
                job.locked_by = worker_id
            db.commit()
            # commit 后属性被 expire，先 refresh 再 expunge，否则脱离会话访问属性报 DetachedInstanceError
            db.refresh(job)
            db.expunge(job)
            return job

    def complete(self, job_id: str, result: dict | None = None):
        with self.db_factory() as db:
            job = db.get(Job, job_id)
            if job:
                job.status = "done"
                job.result = result or {}
                job.locked_at = None
            db.commit()

    def fail(self, job_id: str, error: str, permanent: bool = False):
        """失败：未达 max_attempts 则退避重排，否则置 failed。permanent=True 立即失败。"""
        with self.db_factory() as db:
            job = db.get(Job, job_id)
            if not job:
                return
            job.attempts = (job.attempts or 0) + 1
            job.error = (error or "")[:2000]
            job.locked_at = None
            if permanent or job.attempts >= (job.max_attempts or 3):
                job.status = "failed"
                logger.error("任务最终失败: id=%s kind=%s error=%s", job_id, job.kind, error[:200])
            else:
                job.status = "pending"
                job.run_after = datetime.utcnow() + timedelta(
                    seconds=BACKOFF_BASE_SECONDS * (2 ** job.attempts))
                logger.warning("任务失败将重试: id=%s kind=%s attempt=%s",
                               job_id, job.kind, job.attempts)
            db.commit()
