"""daemon 同步引擎安全回归测试（S0 止血）。

覆盖：
- .conflict 副本排除（F10）
- 远端路径穿越/逃逸防护（F9）
- state 原子写（F5）
- full_sync 保留 hash/remote_mtime（F1：冲突检测失效修复）
- 服务器→本地更新检测（"modified"/"mtime" 键错位修复）
- 空/骤减 manifest 熔断（F4）
- 墓碑机制：离线删除不被撤销（F3）
- manifest 非法路径过滤
"""

import asyncio
import json
import os
import sys
from pathlib import Path

import pytest

DAEMON_DIR = Path(__file__).resolve().parents[2] / "daemon"


@pytest.fixture(scope="module")
def denv(tmp_path_factory):
    """隔离环境导入 daemon 模块（config 在 import 时读 env 并建目录）。"""
    tmp = tmp_path_factory.mktemp("sxd-daemon-test")
    watch = tmp / "watch"
    watch.mkdir()
    outside = tmp / "outside"
    outside.mkdir()
    state = tmp / "state.json"

    os.environ["WATCH_DIR"] = str(watch)
    os.environ["STATE_DB"] = str(state)
    os.environ["SERVER_URL"] = "https://daemon-test.invalid"
    os.environ["DAEMON_TOKEN"] = "test-token"
    os.environ["SYNC_MODE"] = "two_way"
    os.environ.pop("FORCE_SYNC", None)

    if str(DAEMON_DIR) not in sys.path:
        sys.path.insert(0, str(DAEMON_DIR))
    import config as dconfig  # noqa: E402
    import sync as dsync  # noqa: E402

    return {"watch": watch, "outside": outside, "state": state,
            "config": dconfig.config, "sync": dsync}


# ---------- 排除清单（F10） ----------

def test_conflict_copies_excluded(denv):
    sync = denv["sync"]
    assert sync._is_excluded(Path("a.txt.conflict")) is True
    assert sync._is_excluded(Path("sub/b.pdf.conflict")) is True
    assert sync._is_excluded(Path("a.txt")) is False
    assert sync._is_excluded(Path(".DS_Store")) is True


# ---------- 路径安全（F9） ----------

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
    if link.exists() or link.is_symlink():
        link.unlink()
    link.symlink_to(victim)
    assert sync._safe_rel("escape-link") is None
    link.unlink()


# ---------- 状态原子写（F5） ----------

def test_state_save_atomic_roundtrip(denv):
    sync = denv["sync"]
    data = {"x/y.txt": {"mtime": 1.5, "size": 10, "hash": "abc"}}
    sync._state_save(data)
    assert sync._state_load() == data
    # 无 .tmp 残留
    assert not Path(f"{denv['config'].STATE_DB}.tmp").exists()


# ---------- full_sync 行为 ----------

def _run_sync(denv, monkeypatch, state, local, remote):
    """装填 state/本地扫描/远端清单，跑一轮 full_sync，返回各操作计数与新 state。"""
    sync = denv["sync"]
    sync._state_save(state)
    counts = {"up": 0, "down": 0, "del": 0}

    async def fake_scan():
        return local
    async def fake_manifest():
        return remote
    async def fake_upload(rel):
        counts["up"] += 1
        return True
    async def fake_download(rel):
        counts["down"] += 1
        (denv["watch"] / rel).parent.mkdir(parents=True, exist_ok=True)
        (denv["watch"] / rel).write_text("downloaded")
        return True
    async def fake_delete(rel):
        counts["del"] += 1
        return True

    monkeypatch.setattr(sync, "_scan_local", lambda: local)
    monkeypatch.setattr(sync, "_get_remote_manifest", fake_manifest)
    monkeypatch.setattr(sync, "upload_file", fake_upload)
    monkeypatch.setattr(sync, "download_file", fake_download)
    monkeypatch.setattr(sync, "delete_remote", fake_delete)

    asyncio.run(sync.full_sync())
    return counts, sync._state_load()


def test_full_sync_preserves_hash(denv, monkeypatch):
    """F1：full_sync 重建 state 必须保留 hash，否则 base_hash 冲突检测失效。"""
    state = {"a.txt": {"mtime": 100.0, "size": 5, "hash": "abc123", "remote_mtime": 50.0}}
    local = {"a.txt": {"mtime": 100.0, "size": 5}}
    remote = {"a.txt": {"mtime": 50.0, "size": 5}}
    counts, new_state = _run_sync(denv, monkeypatch, state, local, remote)
    assert new_state["a.txt"]["hash"] == "abc123"
    assert new_state["a.txt"]["remote_mtime"] == 50.0
    assert counts["up"] == 0 and counts["down"] == 0


def test_server_to_local_update_detected(denv, monkeypatch):
    """键错位修复：远端 mtime 变新时必须触发下载（原读 'modified' 键永远为 0）。"""
    state = {"b.txt": {"mtime": 100.0, "size": 5, "hash": "h", "remote_mtime": 50.0}}
    local = {"b.txt": {"mtime": 100.0, "size": 5}}
    remote = {"b.txt": {"mtime": 200.0, "size": 6}}  # 服务器端被其他设备修改
    (denv["watch"] / "b.txt").write_text("local")
    counts, new_state = _run_sync(denv, monkeypatch, state, local, remote)
    assert counts["down"] == 1, "远端更新未被检测到（键错位回归）"
    assert new_state["b.txt"]["remote_mtime"] == 200.0


def test_empty_manifest_breaker(denv, monkeypatch):
    """F4：远端清单异常清空时中止同步，不得删除任何本地文件。"""
    watch = denv["watch"]
    f = watch / "precious.txt"
    f.write_text("do not delete")
    state = {
        "precious.txt": {"mtime": 1.0, "size": 13, "remote_mtime": 5.0},
        "other.txt": {"mtime": 1.0, "size": 3, "remote_mtime": 6.0},
    }
    local = {"precious.txt": {"mtime": 1.0, "size": 13}}
    counts, new_state = _run_sync(denv, monkeypatch, state, local, remote={})
    assert f.exists(), "熔断失败：本地文件被空 manifest 删除"
    assert counts["del"] == 0 and counts["down"] == 0
    # state 保持原样（含 remote_mtime），等下一轮或人工 FORCE_SYNC
    assert new_state["precious.txt"].get("remote_mtime") == 5.0


def test_partial_manifest_over_threshold_aborts(denv, monkeypatch):
    """消失比例超阈值（默认 50%）同样熔断。"""
    watch = denv["watch"]
    for name in ("f1.txt", "f2.txt", "f3.txt"):
        (watch / name).write_text("x")
    state = {
        name: {"mtime": 1.0, "size": 1, "remote_mtime": float(i)}
        for i, name in enumerate(["f1.txt", "f2.txt", "f3.txt"], start=1)
    }
    local = {name: {"mtime": 1.0, "size": 1} for name in state}
    remote = {"f1.txt": {"mtime": 1.0, "size": 1}}  # 3 个里消失 2 个 = 66%
    counts, _ = _run_sync(denv, monkeypatch, state, local, remote)
    assert counts["del"] == 0, "超阈值骤减未熔断"
    assert all((watch / n).exists() for n in state)


def test_tombstone_blocks_redownload_and_redeletes(denv, monkeypatch):
    """F3：本地已删（墓碑）而远端还在 → 补发删除，绝不重新下载。"""
    state = {"c.txt": {"tombstone": True, "mtime": 0, "size": 0, "deleted_at": 1.0}}
    remote = {"c.txt": {"mtime": 9.0, "size": 4}}
    counts, new_state = _run_sync(denv, monkeypatch, state, local={}, remote=remote)
    assert counts["down"] == 0, "墓碑文件被重新下载（离线删除被撤销回归）"
    assert counts["del"] == 1, "未补发远端删除"
    assert "c.txt" not in new_state, "删除成功后墓碑应被清除"


def test_tombstone_kept_when_remote_delete_fails(denv, monkeypatch):
    """远端删除失败时保留墓碑，下轮重试。"""
    sync = denv["sync"]
    sync._state_save({"c.txt": {"tombstone": True, "mtime": 0, "size": 0}})
    monkeypatch.setattr(sync, "_scan_local", lambda: {})
    monkeypatch.setattr(sync, "_get_remote_manifest",
                        lambda: _async_value({"c.txt": {"mtime": 9.0, "size": 4}}))

    async def fail_delete(rel):
        return False
    monkeypatch.setattr(sync, "delete_remote", fail_delete)
    monkeypatch.setattr(sync, "download_file", _must_not_call("download"))

    asyncio.run(sync.full_sync())
    assert sync._state_load()["c.txt"].get("tombstone") is True


def _async_value(v):
    async def _f():
        return v
    return _f()


def _must_not_call(name):
    async def _f(*a, **k):
        raise AssertionError(f"{name} 不应被调用")
    return _f


def test_sync_single_delete_writes_tombstone(denv, monkeypatch):
    """watchdog 触发的删除写墓碑（无论远端删除成败）。"""
    sync = denv["sync"]

    async def ok_delete(rel):
        return True
    monkeypatch.setattr(sync, "delete_remote", ok_delete)
    asyncio.run(sync.sync_single_file("d.txt", "delete"))
    entry = sync._state_load().get("d.txt")
    assert entry and entry.get("tombstone") is True


# ---------- manifest 非法路径过滤 ----------

def test_manifest_skips_illegal_paths(denv, monkeypatch):
    sync = denv["sync"]

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

    monkeypatch.setattr(sync.httpx, "AsyncClient", FakeClient)
    result = asyncio.run(sync._get_remote_manifest())
    assert list(result.keys()) == ["ok.txt"]
