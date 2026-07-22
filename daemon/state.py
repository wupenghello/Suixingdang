"""daemon 本地状态库（v2：SQLite，替代 JSON state）。

修复 JSON 方案的两个结构性缺陷：
- 非原子写（崩溃产生坏 JSON → 全量重传且冲突检测失效）
- 双事件循环并发读改写丢更新

SQLite 单文件事务天然原子；并发访问走 WAL + 短事务。
同时内置待办操作队列（pending_ops）：失败操作退避重试，离线删除写墓碑，
解决「失败删除被下轮同步复活」「离线删除被撤销」两类数据问题。
"""

import sqlite3
import threading
import time
from pathlib import Path

_lock = threading.Lock()

SCHEMA = """
CREATE TABLE IF NOT EXISTS files (
    rel          TEXT PRIMARY KEY,
    mtime        REAL NOT NULL DEFAULT 0,
    size         INTEGER NOT NULL DEFAULT 0,
    hash         TEXT NOT NULL DEFAULT '',
    remote_mtime REAL,
    synced_at    REAL,
    tombstone    INTEGER NOT NULL DEFAULT 0,
    deleted_at   REAL
);
CREATE TABLE IF NOT EXISTS pending_ops (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    op         TEXT NOT NULL,              -- upload / delete
    rel        TEXT NOT NULL,
    attempts   INTEGER NOT NULL DEFAULT 0,
    next_retry REAL NOT NULL DEFAULT 0,
    last_error TEXT NOT NULL DEFAULT '',
    created_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pending_retry ON pending_ops (next_retry);
"""


class StateStore:
    def __init__(self, db_path: str):
        self.db_path = db_path
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        with _lock, self._conn:
            self._conn.executescript(SCHEMA)
            self._conn.execute("PRAGMA journal_mode=WAL")

    def close(self):
        self._conn.close()

    # ---- 文件状态 ----

    def get(self, rel: str) -> dict | None:
        with _lock:
            row = self._conn.execute("SELECT * FROM files WHERE rel = ?", (rel,)).fetchone()
        return dict(row) if row else None

    def all(self) -> dict[str, dict]:
        with _lock:
            rows = self._conn.execute("SELECT * FROM files").fetchall()
        return {r["rel"]: dict(r) for r in rows}

    def upsert(self, rel: str, *, mtime: float, size: int, hash: str = "",
               remote_mtime: float | None = None, synced_at: float | None = None):
        with _lock, self._conn:
            prev = self._conn.execute(
                "SELECT hash, remote_mtime FROM files WHERE rel = ?", (rel,)).fetchone()
            self._conn.execute(
                """INSERT INTO files (rel, mtime, size, hash, remote_mtime, synced_at, tombstone)
                   VALUES (?, ?, ?, ?, ?, ?, 0)
                   ON CONFLICT(rel) DO UPDATE SET
                     mtime = excluded.mtime,
                     size = excluded.size,
                     hash = CASE WHEN excluded.hash != '' THEN excluded.hash ELSE files.hash END,
                     remote_mtime = COALESCE(excluded.remote_mtime, files.remote_mtime),
                     synced_at = COALESCE(excluded.synced_at, files.synced_at),
                     tombstone = 0,
                     deleted_at = NULL
                """,
                (rel, mtime, size, hash,
                 remote_mtime if remote_mtime is not None else (prev["remote_mtime"] if prev else None),
                 synced_at),
            )

    def set_hash(self, rel: str, hash: str):
        with _lock, self._conn:
            self._conn.execute("UPDATE files SET hash = ? WHERE rel = ?", (hash, rel))

    def set_remote_mtime(self, rel: str, remote_mtime: float):
        with _lock, self._conn:
            self._conn.execute(
                "UPDATE files SET remote_mtime = ? WHERE rel = ?", (remote_mtime, rel))

    def set_tombstone(self, rel: str):
        """本地删除：写墓碑（同步引擎据此补删远端，而非重新下载）。"""
        with _lock, self._conn:
            self._conn.execute(
                """INSERT INTO files (rel, mtime, size, tombstone, deleted_at)
                   VALUES (?, 0, 0, 1, ?)
                   ON CONFLICT(rel) DO UPDATE SET tombstone = 1, deleted_at = excluded.deleted_at
                """,
                (rel, time.time()),
            )

    def remove(self, rel: str):
        with _lock, self._conn:
            self._conn.execute("DELETE FROM files WHERE rel = ?", (rel,))

    # ---- 待办操作队列（失败退避重试） ----

    def enqueue_op(self, op: str, rel: str):
        with _lock, self._conn:
            exists = self._conn.execute(
                "SELECT id FROM pending_ops WHERE op = ? AND rel = ?", (op, rel)).fetchone()
            if not exists:
                self._conn.execute(
                    "INSERT INTO pending_ops (op, rel, attempts, next_retry, created_at) VALUES (?, ?, 0, 0, ?)",
                    (op, rel, time.time()),
                )

    def due_ops(self, limit: int = 50) -> list[dict]:
        with _lock:
            rows = self._conn.execute(
                "SELECT * FROM pending_ops WHERE next_retry <= ? ORDER BY next_retry LIMIT ?",
                (time.time(), limit),
            ).fetchall()
        return [dict(r) for r in rows]

    def op_failed(self, op_id: int, error: str, max_attempts: int = 5):
        with _lock, self._conn:
            row = self._conn.execute(
                "SELECT attempts FROM pending_ops WHERE id = ?", (op_id,)).fetchone()
            if not row:
                return
            attempts = row["attempts"] + 1
            if attempts >= max_attempts:
                self._conn.execute("DELETE FROM pending_ops WHERE id = ?", (op_id,))
            else:
                backoff = min(300, 5 * (2 ** attempts))  # 5s → 10s → … 上限 5 分钟
                self._conn.execute(
                    "UPDATE pending_ops SET attempts = ?, next_retry = ?, last_error = ? WHERE id = ?",
                    (attempts, time.time() + backoff, error[:200], op_id),
                )

    def op_done(self, op_id: int):
        with _lock, self._conn:
            self._conn.execute("DELETE FROM pending_ops WHERE id = ?", (op_id,))
