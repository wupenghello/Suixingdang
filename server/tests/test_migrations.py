"""Alembic 迁移体系测试（S1：取代手写 ALTER TABLE）。

- 幂等升级：run_migrations 可重复执行
- 遗留库无缝迁移：有业务表无 alembic_version → 自动 stamp head 后升级
"""

import sqlite3

import pytest
from sqlalchemy import inspect

from app.db.models import engine, run_migrations, Base


def test_run_migrations_idempotent():
    run_migrations()
    run_migrations()  # 第二次必须是 no-op 而非报错
    tables = set(inspect(engine).get_table_names())
    assert {"users", "files", "jobs", "alembic_version"} <= tables


def test_jobs_table_schema():
    cols = {c["name"] for c in inspect(engine).get_columns("jobs")}
    assert {"id", "kind", "payload", "status", "attempts", "max_attempts",
            "run_after", "locked_at", "locked_by", "result", "error"} <= cols


def test_legacy_db_auto_stamp_and_upgrade(tmp_path, monkeypatch):
    """模拟存量部署：create_all 建库（无 alembic_version）→ run_migrations 自动接管。"""
    from sqlalchemy import create_engine
    from app.config import settings

    legacy_db = tmp_path / "legacy.sqlite"
    legacy_engine = create_engine(f"sqlite:///{legacy_db}")
    # 用"旧版"元数据子集建库：只有 users 表，无 jobs、无 alembic_version
    from sqlalchemy import Column, String, DateTime
    with legacy_engine.begin() as conn:
        conn.exec_driver_sql(
            "CREATE TABLE users (id VARCHAR PRIMARY KEY, username VARCHAR, "
            "password_hash VARCHAR, created_at DATETIME)"
        )
    legacy_engine.dispose()

    monkeypatch.setattr(settings, "DATABASE_PATH", str(legacy_db))
    monkeypatch.setattr(settings, "DATABASE_URL", "")

    run_migrations()  # 应自动 stamp head → 不试图重建 users

    conn = sqlite3.connect(legacy_db)
    version = conn.execute("SELECT version_num FROM alembic_version").fetchone()
    assert version is not None, "遗留库未被 stamp"
    tables = {r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'")}
    conn.close()
    assert "users" in tables
