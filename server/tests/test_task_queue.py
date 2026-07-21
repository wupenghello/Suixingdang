"""任务队列测试（S1：jobs 表 + 方言自适应领取）。"""

from datetime import datetime, timedelta

import pytest

from app.db.models import SessionLocal, Job
from app.task_queue import TaskQueue


@pytest.fixture(autouse=True)
def _init_db(client):
    """client fixture 触发 lifespan → init_db（Alembic 建表）。"""
    pass


@pytest.fixture()
def q():
    return TaskQueue()


def _purge_jobs():
    db = SessionLocal()
    db.query(Job).delete()
    db.commit()
    db.close()


def test_enqueue_claim_complete_roundtrip(q):
    _purge_jobs()
    job_id = q.enqueue("noop", {"k": "v"})
    job = q.claim("w1")
    assert job is not None and job.id == job_id
    assert job.status == "running" and job.locked_by == "w1"
    assert job.payload == {"k": "v"}
    q.complete(job_id, {"ok": 1})
    db = SessionLocal()
    row = db.get(Job, job_id)
    assert row.status == "done" and row.result == {"ok": 1}
    db.close()


def test_claim_respects_run_after(q):
    _purge_jobs()
    q.enqueue("noop", run_after=datetime.utcnow() + timedelta(hours=1))
    assert q.claim("w1") is None, "未到 run_after 的任务不得被领取"


def test_claim_empty_queue(q):
    _purge_jobs()
    assert q.claim("w1") is None


def test_fail_retries_with_backoff(q):
    _purge_jobs()
    job_id = q.enqueue("noop", max_attempts=3)
    job = q.claim("w1")
    q.fail(job.id, "boom")
    db = SessionLocal()
    row = db.get(Job, job_id)
    assert row.status == "pending", "未达上限应重排而非失败"
    assert row.attempts == 1
    assert row.run_after > datetime.utcnow(), "退避应推迟 run_after"
    assert "boom" in row.error
    db.close()


def test_fail_exhausts_to_failed(q):
    _purge_jobs()
    job_id = q.enqueue("noop", max_attempts=1)
    job = q.claim("w1")
    q.fail(job.id, "fatal")
    db = SessionLocal()
    row = db.get(Job, job_id)
    assert row.status == "failed"
    db.close()


def test_worker_executes_noop(client):
    """worker.run(once=True) 端到端消费 noop 任务。"""
    _purge_jobs()
    q = TaskQueue()
    job_id = q.enqueue("noop", {"echo": "hi"})
    from app.worker import run
    run(once=True)
    db = SessionLocal()
    row = db.get(Job, job_id)
    assert row.status == "done"
    assert row.result == {"ok": True, "echo": {"echo": "hi"}}
    db.close()


def test_worker_unknown_kind_fails_job(client):
    _purge_jobs()
    q = TaskQueue()
    job_id = q.enqueue("definitely-not-a-kind")
    from app.worker import run
    run(once=True)
    db = SessionLocal()
    row = db.get(Job, job_id)
    assert row.status == "failed"
    assert "未知任务类型" in (row.error or "")
    db.close()


def test_worker_purge_trash_handler(client, tmp_path):
    """purge_trash handler 走 trash 服务。"""
    _purge_jobs()
    q = TaskQueue()
    q.enqueue("purge_trash", {})
    from app.worker import run
    run(once=True)
    db = SessionLocal()
    rows = db.query(Job).filter_by(kind="purge_trash").all()
    assert rows and rows[0].status == "done"
    assert "purged" in (rows[0].result or {})
    db.close()
