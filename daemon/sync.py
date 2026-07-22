"""同步引擎 v2：StateStore(SQLite) 状态库 + 墓碑 + 熔断 + 失败重试队列。

v1→v2 修复清单：
- 状态库 JSON → SQLite（原子事务，崩溃不坏库，并发不丢更新）
- 失败操作进 pending_ops 退避重试（原：失败即丢，靠下轮全量"补救"，
  导致失败的远端删除被下轮同步复活）
- 本地删除写墓碑（原：离线删除被重新下载撤销）
- 空/骤减 manifest 熔断（原：远端清单异常时全量误删本地文件）
- full_sync 保留 hash（原：每轮丢失，base_hash 冲突检测实际失效）
- 键名统一 mtime（原：下载侧读 "modified" 恒为 0，服务器→本地更新永远检测不到）
- 流式哈希/流式下载/原子替换（原：大文件整块进内存，中断留半截坏文件）
- 远端路径校验（原：恶意服务器可写 WATCH_DIR 外任意路径）
"""

import time
import hashlib
from pathlib import Path

import httpx

from config import config
from state import StateStore

_store: StateStore | None = None


def get_store() -> StateStore:
    global _store
    if _store is None:
        _store = StateStore(config.STATE_DB)
    return _store


def _is_excluded(path: Path) -> bool:
    for part in path.parts:
        for pattern in config.EXCLUDE_PATTERNS:
            if pattern in part:
                return True
    if path.name.startswith("."):
        return True
    if path.name.endswith(".conflict"):  # 冲突副本不回传，避免扩散到所有设备
        return True
    return False


def _safe_rel(rel: str) -> str | None:
    """校验相对路径落在 WATCH_DIR 内；非法返回 None（防远端路径穿越）。"""
    if not rel or rel.startswith("/") or rel.startswith("\\"):
        return None
    if len(rel) >= 2 and rel[1] == ":":
        return None
    p = Path(rel)
    if any(part == ".." for part in p.parts):
        return None
    root = Path(config.WATCH_DIR).resolve()
    try:
        resolved = (root / p).resolve(strict=False)
    except (OSError, RuntimeError):
        return None
    if resolved != root and root not in resolved.parents:
        return None
    return str(p)


def _hash_file(path: Path) -> str:
    """流式 SHA-256（大文件不整块进内存）。"""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _scan_local() -> dict:
    result = {}
    root = Path(config.WATCH_DIR)
    for p in root.rglob("*"):
        if p.is_file() and not _is_excluded(p):
            rel = str(p.relative_to(root))
            stat = p.stat()
            result[rel] = {"mtime": stat.st_mtime, "size": stat.st_size}
    return result


async def _get_remote_manifest() -> dict:
    """远端清单 {rel: {mtime, size}}；非法路径过滤。"""
    async with httpx.AsyncClient(timeout=60) as client:
        res = await client.get(
            f"{config.SERVER_URL}/api/sync/manifest",
            headers=config.auth_headers,
        )
        if res.status_code != 200:
            raise Exception(f"获取清单失败: {res.status_code} {res.text[:200]}")
        data = res.json()
        result = {}
        for f in data.get("files", []):
            rel = _safe_rel(f.get("path", ""))
            if rel is None:
                print(f"  [安全] 跳过非法远端路径: {f.get('path', '')!r}")
                continue
            result[rel] = {"mtime": f["modified"], "size": f["size"]}
        return result


async def upload_file(rel_path: str) -> bool:
    """上传（base_hash 冲突检测；冲突存 .conflict 副本不覆盖服务器）。"""
    if _safe_rel(rel_path) is None:
        print(f"  [安全] 拒绝上传非法路径: {rel_path!r}")
        return False
    local = Path(config.WATCH_DIR) / rel_path
    if not local.exists():
        return False

    file_hash = _hash_file(local)
    prev = get_store().get(rel_path) or {}
    base_hash = prev.get("hash", "")

    async with httpx.AsyncClient(timeout=120) as client:
        with open(local, "rb") as f:  # httpx 从文件对象流式读取，不整块进内存
            res = await client.post(
                f"{config.SERVER_URL}/api/sync/upload",
                headers=config.auth_headers,
                params={"relative_path": rel_path, "source": "home", "base_hash": base_hash},
                files={"file": (local.name, f, "application/octet-stream")},
            )
        if res.status_code == 200:
            print(f"  [上传] {rel_path} OK")
            stat = local.stat()
            get_store().upsert(rel_path, mtime=stat.st_mtime, size=stat.st_size,
                               hash=file_hash, synced_at=time.time())
            return True
        if res.status_code == 409:
            server_hash = res.headers.get("x-server-hash", "")
            print(f"  [同步冲突] {rel_path}: server={server_hash[:16]} local={file_hash[:16]}")
            conflict = Path(config.WATCH_DIR) / (rel_path + ".conflict")
            try:
                conflict.parent.mkdir(parents=True, exist_ok=True)
                conflict.write_bytes(local.read_bytes())
                print(f"    本地版本已保存为冲突副本: {conflict.name}")
            except Exception as e:
                print(f"    保存冲突副本失败: {e}")
            return True  # 冲突已妥善落地，不进重试队列
        if res.status_code == 403:
            try:
                detail = res.json().get("detail", "")
            except Exception:
                detail = res.text[:200]
            print(f"  [Guard拦截] {rel_path}: {detail}")
            return True  # Guard 拦截是策略结果，重试无意义
        print(f"  [上传失败] {rel_path}: {res.status_code} {res.text[:200]}")
        return False


async def download_file(rel_path: str) -> bool:
    """流式下载 → 临时文件 → 原子替换（中断不留半截坏文件）。"""
    if _safe_rel(rel_path) is None:
        print(f"  [安全] 拒绝下载非法路径: {rel_path!r}")
        return False
    local = Path(config.WATCH_DIR) / rel_path
    local.parent.mkdir(parents=True, exist_ok=True)
    tmp = local.with_name(local.name + ".sxd-tmp")

    async with httpx.AsyncClient(timeout=120) as client:
        try:
            async with client.stream(
                "GET", f"{config.SERVER_URL}/api/sync/download",
                headers=config.auth_headers, params={"path": rel_path},
            ) as res:
                if res.status_code != 200:
                    await res.aread()
                    print(f"  [下载失败] {rel_path}: {res.status_code}")
                    return False
                with open(tmp, "wb") as f:
                    async for chunk in res.aiter_bytes(1024 * 1024):
                        f.write(chunk)
        except Exception as e:
            tmp.unlink(missing_ok=True)
            print(f"  [下载失败] {rel_path}: {e}")
            return False

    import os
    os.replace(tmp, local)
    print(f"  [下载] {rel_path} OK")
    stat = local.stat()
    get_store().upsert(rel_path, mtime=stat.st_mtime, size=stat.st_size,
                       hash=_hash_file(local), synced_at=time.time())
    return True


async def delete_remote(rel_path: str) -> bool:
    async with httpx.AsyncClient(timeout=30) as client:
        res = await client.post(
            f"{config.SERVER_URL}/api/sync/delete",
            headers=config.auth_headers,
            params={"path": rel_path, "source": "home"},
        )
        return res.status_code == 200


async def full_sync():
    """全量差异同步（双向）。"""
    print(f"\n[{time.strftime('%Y-%m-%d %H:%M:%S')}] 开始全量同步...")
    store = get_store()
    state = store.all()
    local = _scan_local()

    try:
        remote = await _get_remote_manifest()
    except Exception as e:
        print(f"  获取服务器清单失败: {e}")
        return

    # ---- 熔断：远端清单骤减时中止，防全量误删 ----
    tracked = {rel for rel, p in state.items()
               if p.get("remote_mtime") is not None and not p.get("tombstone")}
    if tracked and not config.FORCE_SYNC:
        missing = tracked - set(remote.keys())
        ratio = len(missing) / len(tracked)
        if len(remote) == 0 or ratio > config.DELETE_ABORT_THRESHOLD:
            print(f"  [熔断] 远端清单异常：{len(missing)}/{len(tracked)} 个已跟踪文件消失"
                  f"（{ratio:.0%} > {config.DELETE_ABORT_THRESHOLD:.0%}）。本轮中止，本地不动。"
                  f"确认远端确实清空可设 FORCE_SYNC=1。")
            return

    uploaded = downloaded = deleted = skipped = 0

    # ---- 上行：本地 → 服务器 ----
    for rel, info in local.items():
        prev = state.get(rel) or {}
        if prev.get("tombstone"):
            skipped += 1  # 本地已删，下行逻辑负责补删远端
            continue
        remote_info = remote.get(rel)
        need_upload = (
            not remote_info
            or (prev and info["mtime"] > (prev.get("mtime") or 0))
            or (not prev and info["size"] != remote_info.get("size"))
        )
        if not need_upload:
            # 无变化：补记远端 mtime
            if remote_info:
                store.set_remote_mtime(rel, remote_info["mtime"])
            skipped += 1
            continue
        if await upload_file(rel):  # 成功时 upsert 已在 upload_file 内完成
            uploaded += 1
            if remote_info:
                store.set_remote_mtime(rel, remote_info["mtime"])
        else:
            store.enqueue_op("upload", rel)  # 失败进退避队列，不再静默丢失
            skipped += 1

    # ---- 下行：服务器 → 本地 ----
    if config.SYNC_MODE == "two_way":
        for rel, remote_info in remote.items():
            prev = state.get(rel) or {}
            local_info = local.get(rel)

            if prev.get("tombstone"):
                # 本地已删而远端还在 → 补删远端（绝不重新下载）
                if await delete_remote(rel):
                    store.remove(rel)
                    deleted += 1
                    print(f"  [墓碑补删] {rel}")
                else:
                    store.enqueue_op("delete", rel)
                continue

            if not local_info:
                if await download_file(rel):
                    downloaded += 1
                    store.set_remote_mtime(rel, remote_info["mtime"])
                else:
                    store.enqueue_op("download", rel)
                    skipped += 1
            elif prev.get("remote_mtime") is not None and remote_info["mtime"] > prev["remote_mtime"]:
                if await download_file(rel):
                    downloaded += 1
                    store.set_remote_mtime(rel, remote_info["mtime"])
                else:
                    store.enqueue_op("download", rel)
                    skipped += 1
            else:
                store.set_remote_mtime(rel, remote_info["mtime"])

        # ---- 远端删除传播：曾跟踪但远端已无 → 本地也删 ----
        for rel, prev in list(state.items()):
            if prev.get("remote_mtime") is not None and not prev.get("tombstone") \
                    and rel not in remote and rel in local:
                if _safe_rel(rel) is None:
                    continue
                try:
                    (Path(config.WATCH_DIR) / rel).unlink()
                    store.remove(rel)
                    deleted += 1
                    print(f"  [本地删除] {rel}（远程已删除）")
                except FileNotFoundError:
                    store.remove(rel)
                except Exception:
                    pass

    # ---- 墓碑对账：远端也没有了 → 删除已完成，清墓碑 ----
    for rel, prev in list(state.items()):
        if prev.get("tombstone") and rel not in remote:
            store.remove(rel)

    # ---- 重试队列：处理到期的失败操作 ----
    retried = await _process_retry_queue()

    print(f"  同步完成: 上传 {uploaded}, 下载 {downloaded}, 删除 {deleted}, "
          f"跳过 {skipped}, 重试 {retried}")


async def _process_retry_queue() -> int:
    """处理到期待办操作（上传/下载/删除），失败继续退避。"""
    store = get_store()
    done = 0
    for op in store.due_ops():
        rel, kind = op["rel"], op["op"]
        ok = False
        try:
            if kind == "upload":
                ok = (Path(config.WATCH_DIR) / rel).exists() and await upload_file(rel)
            elif kind == "download":
                ok = await download_file(rel)
            elif kind == "delete":
                ok = await delete_remote(rel)
                if ok:
                    store.remove(rel)
        except Exception as e:
            ok = False
            print(f"  [重试异常] {kind} {rel}: {e}")
        if ok:
            store.op_done(op["id"])
            done += 1
        else:
            store.op_failed(op["id"], f"{kind} 失败")
    return done


async def sync_single_file(rel_path: str, action: str = "upload"):
    """watchdog 触发的单文件同步。"""
    if _safe_rel(rel_path) is None:
        print(f"  [安全] 拒绝同步非法路径: {rel_path!r}")
        return
    store = get_store()
    local = Path(config.WATCH_DIR) / rel_path

    if action == "delete":
        store.set_tombstone(rel_path)       # 先落墓碑：离线/失败都不怕
        if await delete_remote(rel_path):
            store.remove(rel_path)
        else:
            store.enqueue_op("delete", rel_path)
        return

    if not local.exists() or _is_excluded(local):
        return
    if await upload_file(rel_path):
        pass  # upsert 已在 upload_file 内完成
    else:
        store.enqueue_op("upload", rel_path)
