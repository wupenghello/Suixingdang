"""daemon v2 同步引擎测试：StateStore / 熔断 / 墓碑 / 重试队列 / 路径安全。"""

import asyncio
import os
import sys
from pathlib import Path

import pytest

DAEMON_DIR = Path(__file__).resolve().parents[2] / "daemon"


@pytest.fixture(scope="module")
def denv(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("sxd-daemon-v2")
    watch = tmp / "watch"
    watch.mkdir()
    outside = tmp / "outside"
    outside.mkdir()

    os.environ["WATCH_DIR"] = str(watch)
    os.environ["STATE_DB"] = str(tmp / "state.sqlite")
    os.environ["SERVER_URL"] = "https://daemon-test.invalid"
    os.environ["DAEMON_TOKEN"] = "test-token"
    os.environ["SYNC_MODE"] = "two_way"
    os.environ.pop("FORCE_SYNC", None)

    if str(DAEMON_DIR) not in sys.path:
        sys.path.insert(0, str(DAEMON_DIR))
    import config as dconfig  # noqa: E402
    import sync as dsync  # noqa: E402
    import state as dstate  # noqa: E402

    dsync._store = dstate.StateStore(os.environ["STATE_DB"])
    return {"watch": watch, "outside": outside, "config": dconfig.config,
            "sync": dsync, "state": dstate, "store": dsync._store}


@pytest.fixture(autouse=True)
def _clean(denv):
    """每用例清空状态库（网络函数由 _patch_sync 或 httpx 级 monkeypatch 处理）。"""
    store = denv["store"]
    with denv['state']._lock, store._conn:
        store._conn.execute("DELETE FROM files")
        store._conn.execute("DELETE FROM pending_ops")
    yield


def _run(coro):
    return asyncio.run(coro)


# ---------- StateStore ----------

def test_state_store_roundtrip(denv):
    store = denv["store"]
    store.upsert("a/b.txt", mtime=1.5, size=10, hash="h1", remote_mtime=2.0)
    row = store.get("a/b.txt")
    assert row["hash"] == "h1" and row["size"] == 10 and row["remote_mtime"] == 2.0
    assert "a/b.txt" in store.all()
    store.remove("a/b.txt")
    assert store.get("a/b.txt") is None


def test_state_store_tombstone_semantics(denv):
    store = denv["store"]
    store.upsert("x.txt", mtime=1, size=2, hash="h")
    store.set_tombstone("x.txt")
    assert store.get("x.txt")["tombstone"] == 1
    # 重新上传（upsert）应清除墓碑
    store.upsert("x.txt", mtime=3, size=4, hash="h2")
    row = store.get("x.txt")
    assert row["tombstone"] == 0 and row["hash"] == "h2"


def test_ops_queue_backoff_and_expiry(denv):
    store = denv["store"]
    store.enqueue_op("upload", "f.txt")
    ops = store.due_ops()
    assert len(ops) == 1
    # 失败 → 退避：不再立即到期
    store.op_failed(ops[0]["id"], "boom")
    assert store.due_ops() == []
    with denv['state']._lock:
        row = store._conn.execute("SELECT attempts FROM pending_ops").fetchone()
    assert row["attempts"] == 1
    # 超过最大重试次数 → 出队
    for _ in range(6):
        with denv['state']._lock, store._conn:
            store._conn.execute("UPDATE pending_ops SET next_retry = 0")
        due = store.due_ops()
        if not due:
            break
        store.op_failed(due[0]["id"], "still failing")
    with denv['state']._lock:
        n = store._conn.execute("SELECT COUNT(*) c FROM pending_ops").fetchone()["c"]
    assert n == 0, "超过 max_attempts 后应出队"


def test_enqueue_dedupes(denv):
    store = denv["store"]
    store.enqueue_op("upload", "g.txt")
    store.enqueue_op("upload", "g.txt")
    assert len(store.due_ops()) == 1


# ---------- 路径安全 ----------

def test_safe_rel_rejects_traversal(denv):
    sync = denv["sync"]
    assert sync._safe_rel("../evil.txt") is None
    assert sync._safe_rel("sub/../../evil.txt") is None
    assert sync._safe_rel("/etc/passwd") is None
    assert sync._safe_rel("c:/windows") is None
    assert sync._safe_rel("") is None
    assert sync._safe_rel("sub/ok.txt") == str(Path("sub/ok.txt"))


def test_safe_rel_rejects_symlink_escape(denv):
    sync = denv["sync"]
    watch, outside = denv["watch"], denv["outside"]
    victim = outside / "secret.txt"
    victim.write_text("secret")
    link = watch / "escape-link"
    if link.is_symlink() or link.exists():
        link.unlink()
    link.symlink_to(victim)
    assert sync._safe_rel("escape-link") is None
    link.unlink()


def test_conflict_copies_excluded(denv):
    sync = denv["sync"]
    assert sync._is_excluded(Path("a.txt.conflict")) is True
    assert sync._is_excluded(Path("a.txt")) is False


def test_manifest_skips_illegal_paths(denv, monkeypatch):
    sync = denv["sync"]
    import httpx

    class FakeResp:
        status_code = 200

        def json(self):
            return {"files": [
                {"path": "../../evil.txt", "modified": 1.0, "size": 1},
                {"path": "/etc/passwd", "modified": 1.0, "size": 1},
                {"path": "ok.txt", "modified": 2.0, "size": 2},
            ]}

    class FakeClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, *a, **k):
            return FakeResp()

    monkeypatch.setattr(httpx, "AsyncClient", FakeClient)
    result = _run(sync._get_remote_manifest())
    assert list(result.keys()) == ["ok.txt"]


# ---------- full_sync 行为 ----------

def _patch_sync(denv, monkeypatch, local, remote, counters):
    sync = denv["sync"]
    monkeypatch.setattr(sync, "_scan_local", lambda: local)

    async def fake_manifest():
        return remote
    monkeypatch.setattr(sync, "_get_remote_manifest", fake_manifest)

    async def fake_upload(rel):
        counters["up"] += 1
        return counters.get("upload_ok", True)
    async def fake_download(rel):
        counters["down"] += 1
        return counters.get("download_ok", True)
    async def fake_delete(rel):
        counters["del"] += 1
        return counters.get("delete_ok", True)

    monkeypatch.setattr(sync, "upload_file", fake_upload)
    monkeypatch.setattr(sync, "download_file", fake_download)
    monkeypatch.setattr(sync, "delete_remote", fake_delete)


def test_full_sync_breaker_on_empty_manifest(denv, monkeypatch):
    """远端清单清空（异常）时不得删除任何本地文件。"""
    store = denv["store"]
    watch = denv["watch"]
    (watch / "p1.txt").write_text("x")
    (watch / "p2.txt").write_text("y")
    store.upsert("p1.txt", mtime=1, size=1, hash="h1", remote_mtime=5.0)
    store.upsert("p2.txt", mtime=1, size=1, hash="h2", remote_mtime=6.0)

    counters = {"up": 0, "down": 0, "del": 0}
    _patch_sync(denv, monkeypatch,
                local={"p1.txt": {"mtime": 1, "size": 1}, "p2.txt": {"mtime": 1, "size": 1}},
                remote={}, counters=counters)
    _run(denv["sync"].full_sync())

    assert counters["del"] == 0 and counters["down"] == 0, "熔断失败：空 manifest 触发删除/下载"
    assert (watch / "p1.txt").exists() and (watch / "p2.txt").exists()
    assert store.get("p1.txt") is not None  # 状态未被清空


def test_full_sync_preserves_hash(denv, monkeypatch):
    """无变化的文件：hash/remote_mtime 保留（修复冲突检测失效）。"""
    store = denv["store"]
    store.upsert("a.txt", mtime=100.0, size=5, hash="abc123", remote_mtime=50.0)
    counters = {"up": 0, "down": 0, "del": 0}
    _patch_sync(denv, monkeypatch,
                local={"a.txt": {"mtime": 100.0, "size": 5}},
                remote={"a.txt": {"mtime": 50.0, "size": 5}},
                counters=counters)
    _run(denv["sync"].full_sync())
    row = store.get("a.txt")
    assert row["hash"] == "abc123", "full_sync 不得丢失 hash"
    assert row["remote_mtime"] == 50.0
    assert counters["up"] == 0 and counters["down"] == 0


def test_full_sync_server_to_local_update(denv, monkeypatch):
    """远端 mtime 变新 → 触发下载（修复 modified/mtime 键错位）。"""
    store = denv["store"]
    (denv["watch"] / "b.txt").write_text("local")
    store.upsert("b.txt", mtime=100.0, size=5, hash="h", remote_mtime=50.0)
    counters = {"up": 0, "down": 0, "del": 0}
    _patch_sync(denv, monkeypatch,
                local={"b.txt": {"mtime": 100.0, "size": 5}},
                remote={"b.txt": {"mtime": 200.0, "size": 6}},
                counters=counters)
    _run(denv["sync"].full_sync())
    assert counters["down"] == 1, "远端更新未被检测到"


def test_full_sync_tombstone_redeletes_not_download(denv, monkeypatch):
    """本地已删（墓碑）而远端还在 → 补删远端，绝不重新下载（修复离线删除被撤销）。"""
    store = denv["store"]
    store.set_tombstone("c.txt")
    counters = {"up": 0, "down": 0, "del": 0}
    _patch_sync(denv, monkeypatch, local={},
                remote={"c.txt": {"mtime": 9.0, "size": 4}}, counters=counters)
    _run(denv["sync"].full_sync())
    assert counters["down"] == 0, "墓碑文件被重新下载"
    assert counters["del"] == 1, "未补发远端删除"
    assert store.get("c.txt") is None, "补删成功后墓碑应清除"


def test_full_sync_tombstone_cleared_when_remote_gone(denv, monkeypatch):
    """远端已无该文件 → 墓碑对账清除。"""
    store = denv["store"]
    store.set_tombstone("d.txt")
    counters = {"up": 0, "down": 0, "del": 0}
    _patch_sync(denv, monkeypatch, local={}, remote={}, counters=counters)
    _run(denv["sync"].full_sync())
    assert store.get("d.txt") is None


def test_full_sync_upload_failure_enqueued(denv, monkeypatch):
    """上传失败进退避队列（修复失败静默丢失）。"""
    store = denv["store"]
    (denv["watch"] / "new.txt").write_text("n")
    counters = {"up": 0, "down": 0, "del": 0, "upload_ok": False,
                "download_ok": True, "delete_ok": True}
    _patch_sync(denv, monkeypatch,
                local={"new.txt": {"mtime": 1.0, "size": 1}},
                remote={}, counters=counters)
    _run(denv["sync"].full_sync())
    # 初次失败 + 队列重试再失败 → attempts=2，仍在队列（退避未到 max）
    with denv['state']._lock:
        row = store._conn.execute(
            "SELECT attempts, op, rel FROM pending_ops").fetchone()
    assert row is not None and row["op"] == "upload" and row["rel"] == "new.txt"
    assert row["attempts"] >= 1


def test_full_sync_remote_delete_propagates_local(denv, monkeypatch):
    """曾跟踪但远端已无 + 本地还在 → 本地删除。"""
    store = denv["store"]
    watch = denv["watch"]
    (watch / "gone.txt").write_text("z")
    store.upsert("gone.txt", mtime=1.0, size=1, hash="h", remote_mtime=5.0)
    counters = {"up": 0, "down": 0, "del": 0}
    _patch_sync(denv, monkeypatch,
                local={"gone.txt": {"mtime": 1.0, "size": 1}},
                remote={}, counters=counters)
    # 注意：此用例需要绕过熔断（单个跟踪文件消失=100%）
    monkeypatch.setattr(denv["config"], "FORCE_SYNC", True, raising=False)
    try:
        _run(denv["sync"].full_sync())
    finally:
        monkeypatch.setattr(denv["config"], "FORCE_SYNC", False, raising=False)
    assert not (watch / "gone.txt").exists(), "远端删除未传播到本地"
    assert store.get("gone.txt") is None


def test_sync_single_delete_tombstone_on_failure(denv, monkeypatch):
    """单文件删除：远端删除失败也先落墓碑（防复活）。"""
    store = denv["store"]
    counters = {"up": 0, "down": 0, "del": 0, "delete_ok": False}
    _patch_sync(denv, monkeypatch, local={}, remote={}, counters=counters)
    _run(denv["sync"].sync_single_file("e.txt", "delete"))
    row = store.get("e.txt")
    assert row is not None and row["tombstone"] == 1
    # 删除失败应进重试队列
    with denv['state']._lock:
        n = store._conn.execute(
            "SELECT COUNT(*) c FROM pending_ops WHERE op='delete'").fetchone()["c"]
    assert n == 1


def test_sync_single_delete_success_clears(denv, monkeypatch):
    store = denv["store"]
    counters = {"up": 0, "down": 0, "del": 0, "delete_ok": True}
    _patch_sync(denv, monkeypatch, local={}, remote={}, counters=counters)
    _run(denv["sync"].sync_single_file("f.txt", "delete"))
    assert store.get("f.txt") is None
