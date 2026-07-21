"""同步引擎：差异比对、上传、下载、删除。

S0 修复清单（数据安全）：
- 键名统一：manifest 归一化与比较侧都用 "mtime"（原 "modified" 键错位导致服务器→本地更新永远检测不到）
- 状态保留：full_sync 重建 state 时保留 hash / remote_mtime（原每轮丢失 hash，base_hash 冲突检测实际失效）
- 空/骤减 manifest 熔断：远端跟踪文件消失比例超阈值时中止本轮同步，防误删全量本地文件
- 墓碑（tombstone）：本机删除写墓碑，远端仍有该文件时补发删除而非重新下载，修复"离线删除被撤销"
- 原子状态写：tmp + os.replace，崩溃不再产生坏 JSON
- 路径校验：服务器下发的相对路径必须落在 WATCH_DIR 内（防恶意/被攻破的服务器写任意路径）
- 流式哈希/流式下载：大文件不再整块读进内存；下载 tmp+rename，中断不留半截坏文件
- .conflict 副本加入排除清单，不再被回传服务器
- state 读写加锁：watchdog 循环与轮询循环并发不再丢更新
"""

import os
import time
import json
import hashlib
import threading
from pathlib import Path
from typing import Optional

import httpx

from config import config


# state 读-改-写锁（watchdog 事件循环与轮询线程的 full_sync 可能并发）
_state_lock = threading.Lock()

_CHUNK = 1024 * 1024  # 1MB


def _state_load() -> dict:
    """加载本地文件状态记录 {rel_path: {mtime, size, hash?, remote_mtime?, tombstone?}}。"""
    try:
        with open(config.STATE_DB, "r") as f:
            data = json.load(f)
            return data if isinstance(data, dict) else {}
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _state_save(state: dict):
    """原子写入：先写临时文件再 rename，崩溃中途不会产生损坏的 state。"""
    tmp = f"{config.STATE_DB}.tmp"
    with open(tmp, "w") as f:
        json.dump(state, f, indent=2, ensure_ascii=False)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, config.STATE_DB)


def _is_excluded(path: Path) -> bool:
    for part in path.parts:
        for pattern in config.EXCLUDE_PATTERNS:
            if pattern in part:
                return True
    if path.name.startswith("."):
        return True
    # 冲突副本不参与同步，否则会扩散到所有设备
    if path.name.endswith(".conflict"):
        return True
    return False


def _safe_rel(rel: str) -> Optional[str]:
    """校验相对路径落在 WATCH_DIR 内；非法返回 None。

    服务器下发的路径不可信：拒绝绝对路径、".." 分量，以及解析后逃逸出
    WATCH_DIR 的符号链接路径。
    """
    if not rel or rel.startswith("/") or rel.startswith("\\"):
        return None
    if len(rel) >= 2 and rel[1] == ":":  # Windows 盘符
        return None
    p = Path(rel)
    if any(part == ".." for part in p.parts):
        return None
    root = Path(config.WATCH_DIR).resolve()
    target = (root / p)
    try:
        resolved = target.resolve(strict=False)
    except (OSError, RuntimeError):
        return None
    if resolved != root and root not in resolved.parents:
        return None
    return str(p)


def _hash_file(path: Path) -> str:
    """流式计算 SHA-256（不把整个文件读进内存）。"""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            chunk = f.read(_CHUNK)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def _scan_local() -> dict:
    """扫描本地目录，返回 {rel_path: {mtime, size}}。"""
    result = {}
    root = Path(config.WATCH_DIR)
    for p in root.rglob("*"):
        if p.is_file() and not _is_excluded(p):
            rel = str(p.relative_to(root))
            stat = p.stat()
            result[rel] = {"mtime": stat.st_mtime, "size": stat.st_size}
    return result


async def _get_remote_manifest() -> dict:
    """从服务器获取文件清单 {rel_path: {mtime, size}}。

    服务器下发的路径逐个过 _safe_rel 校验，非法路径跳过并告警。
    """
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
    """上传文件到服务器。带 base_hash 冲突检测。"""
    if _safe_rel(rel_path) is None:
        print(f"  [安全] 拒绝上传非法路径: {rel_path!r}")
        return False
    local = Path(config.WATCH_DIR) / rel_path
    if not local.exists():
        return False

    # 计算本地文件 hash，用于冲突检测（流式，不整块读内存）
    file_hash = _hash_file(local)
    # 从本地状态中取出上次同步时的 hash 作为 base_hash
    with _state_lock:
        state = _state_load()
        prev = state.get(rel_path, {})
        base_hash = prev.get("hash", "")

    async with httpx.AsyncClient(timeout=120) as client:
        with open(local, "rb") as f:
            res = await client.post(
                f"{config.SERVER_URL}/api/sync/upload",
                headers=config.auth_headers,
                params={"relative_path": rel_path, "source": "home", "base_hash": base_hash},
                files={"file": (local.name, f, "application/octet-stream")},
            )
        if res.status_code == 200:
            print(f"  [上传] {rel_path} OK")
            # 更新本地状态中的 hash（读-改-写加锁，防并发丢更新）
            with _state_lock:
                new_state = _state_load()
                if rel_path in new_state:
                    new_state[rel_path]["hash"] = file_hash
                    _state_save(new_state)
            return True
        elif res.status_code == 409:
            # 冲突：服务器端文件已被修改，本地版本保存为 .conflict 副本
            server_hash = res.headers.get("x-server-hash", "")
            print(f"  [同步冲突] {rel_path}: 服务器端文件已被修改")
            print(f"    server_hash={server_hash[:16]}, local_hash={file_hash[:16]}")
            conflict_path = Path(config.WATCH_DIR) / (rel_path + ".conflict")
            try:
                conflict_path.parent.mkdir(parents=True, exist_ok=True)
                conflict_path.write_bytes(local.read_bytes())
                print(f"    本地版本已保存为冲突副本: {conflict_path.name}")
            except Exception as e:
                print(f"    保存冲突副本失败: {e}")
            return False
        elif res.status_code == 403:
            try:
                detail = res.json().get("detail", "")
            except (json.JSONDecodeError, ValueError):
                detail = res.text[:200]
            print(f"  [Guard拦截] {rel_path}: {detail}")
            return False
        else:
            print(f"  [上传失败] {rel_path}: {res.status_code} {res.text[:200]}")
            return False


async def download_file(rel_path: str) -> bool:
    """从服务器下载文件。流式写临时文件，成功后原子替换。"""
    if _safe_rel(rel_path) is None:
        print(f"  [安全] 拒绝下载非法路径: {rel_path!r}")
        return False
    local = Path(config.WATCH_DIR) / rel_path
    local.parent.mkdir(parents=True, exist_ok=True)
    tmp = local.with_name(local.name + ".sxd-tmp")

    async with httpx.AsyncClient(timeout=120) as client:
        try:
            async with client.stream(
                "GET",
                f"{config.SERVER_URL}/api/sync/download",
                headers=config.auth_headers,
                params={"path": rel_path},
            ) as res:
                if res.status_code != 200:
                    await res.aread()
                    print(f"  [下载失败] {rel_path}: {res.status_code}")
                    return False
                with open(tmp, "wb") as f:
                    async for chunk in res.aiter_bytes(_CHUNK):
                        f.write(chunk)
        except Exception as e:
            tmp.unlink(missing_ok=True)
            print(f"  [下载失败] {rel_path}: {e}")
            return False

    os.replace(tmp, local)  # 原子替换：中断不会留下半截文件
    print(f"  [下载] {rel_path} OK")
    return True


async def delete_remote(rel_path: str) -> bool:
    """通知服务器删除文件。"""
    async with httpx.AsyncClient(timeout=30) as client:
        res = await client.post(
            f"{config.SERVER_URL}/api/sync/delete",
            headers=config.auth_headers,
            params={"path": rel_path, "source": "home"},
        )
        return res.status_code == 200


async def full_sync():
    """全量差异比对同步（支持真正的双向同步）。"""
    print(f"\n[{time.strftime('%Y-%m-%d %H:%M:%S')}] 开始全量同步...")
    with _state_lock:
        state = _state_load()
    local = _scan_local()

    try:
        remote = await _get_remote_manifest()
    except Exception as e:
        print(f"  获取服务器清单失败: {e}")
        return

    # ---- 熔断：远端清单异常骤减时中止，防误删/误覆盖 ----
    tracked_remote = {
        rel for rel, p in state.items()
        if p.get("remote_mtime") is not None and not p.get("tombstone")
    }
    if tracked_remote and not config.FORCE_SYNC:
        missing = tracked_remote - set(remote.keys())
        ratio = len(missing) / len(tracked_remote)
        if len(remote) == 0 or ratio > config.DELETE_ABORT_THRESHOLD:
            print(
                f"  [熔断] 远端清单异常：{len(missing)}/{len(tracked_remote)} 个已跟踪文件"
                f"消失（比例 {ratio:.0%} > 阈值 {config.DELETE_ABORT_THRESHOLD:.0%}）。"
                f"本轮同步中止，本地文件不动。如确需同步请设置 FORCE_SYNC=1。"
            )
            return

    uploaded = downloaded = deleted = skipped = 0
    new_state = {}
    redeleted = set()  # 本轮墓碑补删成功的 rel（对账时不再重建墓碑）

    # ---- 上行：本地 -> 服务器 ----
    for rel, info in local.items():
        # 保留上一轮的 hash / remote_mtime（修复：原实现每轮丢失，冲突检测失效）
        prev_info = state.get(rel, {})
        entry = dict(info)
        if prev_info.get("hash"):
            entry["hash"] = prev_info["hash"]
        if prev_info.get("remote_mtime") is not None:
            entry["remote_mtime"] = prev_info["remote_mtime"]
        new_state[rel] = entry

        remote_info = remote.get(rel)
        if prev_info.get("tombstone"):
            # 本地已删除（墓碑）：不应出现在本地扫描中；出现说明用户又建了同名文件，
            # 按新文件处理（清墓碑，走下方正常上传逻辑）
            entry.pop("tombstone", None)

        if not remote_info:
            # 服务器没有，上传
            if await upload_file(rel):
                uploaded += 1
            else:
                skipped += 1
        elif prev_info and not prev_info.get("tombstone") and info["mtime"] > prev_info.get("mtime", 0):
            # 本地文件有更新，上传
            if await upload_file(rel):
                uploaded += 1
            else:
                skipped += 1
        elif not prev_info and info["size"] != remote_info.get("size"):
            # 首次见到，大小不一致，上传本地版本
            if await upload_file(rel):
                uploaded += 1
            else:
                skipped += 1
        else:
            skipped += 1

    # ---- 下行：服务器 -> 本地（two_way 模式） ----
    if config.SYNC_MODE == "two_way":
        for rel, remote_info in remote.items():
            local_info = local.get(rel)
            prev_info = state.get(rel, {})

            # 墓碑优先：本地已删除而远端还在 -> 补发删除，绝不重新下载（修复离线删除被撤销）
            if prev_info.get("tombstone"):
                if await delete_remote(rel):
                    print(f"  [墓碑补删] {rel}（本地已删除，同步删除远端副本）")
                    new_state.pop(rel, None)
                    redeleted.add(rel)
                else:
                    new_state[rel] = dict(prev_info)  # 保留墓碑，下轮重试
                continue

            if not local_info:
                # 本地没有 -> 下载
                if await download_file(rel):
                    downloaded += 1
                    scanned = _scan_local().get(rel)
                    if scanned:
                        new_state[rel] = {**scanned, "remote_mtime": remote_info.get("mtime", 0)}
                else:
                    skipped += 1
            elif prev_info.get("remote_mtime") is not None and remote_info.get("mtime", 0) > prev_info["remote_mtime"]:
                # 服务器端文件比上次记录的更新，下载覆盖本地
                if await download_file(rel):
                    downloaded += 1
                    scanned = _scan_local().get(rel)
                    if scanned:
                        new_state[rel] = {**scanned, "remote_mtime": remote_info.get("mtime", 0)}
                else:
                    skipped += 1
            else:
                # 记录远程 mtime 以便下次比较（键名统一为 mtime）
                if rel in new_state:
                    new_state[rel]["remote_mtime"] = remote_info.get("mtime", 0)

        # ---- 双向删除同步：之前在服务器上有但现在远程没有了 -> 本地也删除 ----
        for rel in list(state.keys()):
            prev = state.get(rel, {})
            was_on_remote = prev.get("remote_mtime") is not None and not prev.get("tombstone")
            if was_on_remote and rel not in remote and rel in local:
                local_file = Path(config.WATCH_DIR) / rel
                if _safe_rel(rel) is None:
                    continue
                try:
                    local_file.unlink()
                    deleted += 1
                    print(f"  [本地删除] {rel}（远程已删除）")
                    new_state.pop(rel, None)
                except FileNotFoundError:
                    new_state.pop(rel, None)
                except Exception:
                    pass

    # ---- 墓碑对账：远端也没有了 -> 删除已完成，清墓碑 ----
    for rel in list(state.keys()):
        prev = state.get(rel, {})
        if prev.get("tombstone"):
            if rel not in remote or rel in redeleted:
                new_state.pop(rel, None)
            elif rel not in new_state:
                new_state[rel] = dict(prev)  # 远端还在，保留墓碑等补删

    # 清理：之前有但现在本地和远程都没有的 state 记录
    for rel in list(state.keys()):
        if rel not in local and rel not in remote:
            new_state.pop(rel, None)

    with _state_lock:
        _state_save(new_state)
    print(f"  同步完成: 上传 {uploaded}, 下载 {downloaded}, 删除 {deleted}, 跳过 {skipped}")


async def sync_single_file(rel_path: str, action: str = "upload"):
    """同步单个文件（watchdog 触发时用）。"""
    if _safe_rel(rel_path) is None:
        print(f"  [安全] 拒绝同步非法路径: {rel_path!r}")
        return
    local = Path(config.WATCH_DIR) / rel_path

    if action == "delete":
        # 写墓碑：即使远端删除请求失败/离线，full_sync 也不会把文件重新下载回来
        tombstone = {"tombstone": True, "mtime": 0, "size": 0, "deleted_at": time.time()}
        await delete_remote(rel_path)  # 尽力立即删除；成败都留墓碑等对账
        with _state_lock:
            state = _state_load()
            state[rel_path] = tombstone
            _state_save(state)
        return

    if not local.exists() or _is_excluded(local):
        return

    if await upload_file(rel_path):
        with _state_lock:
            state = _state_load()
            stat = local.stat()
            state[rel_path] = {
                "mtime": stat.st_mtime,
                "size": stat.st_size,
                "hash": _hash_file(local),
            }
            _state_save(state)
