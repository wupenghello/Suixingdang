"""同步引擎：差异比对、上传、下载、删除。"""

import os
import time
import json
import hashlib
from pathlib import Path
from typing import Optional

import httpx

from config import config


def _state_load() -> dict:
    """加载本地文件状态记录 {rel_path: {mtime, size}}。"""
    try:
        with open(config.STATE_DB, "r") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _state_save(state: dict):
    with open(config.STATE_DB, "w") as f:
        json.dump(state, f, indent=2, ensure_ascii=False)


def _is_excluded(path: Path) -> bool:
    for part in path.parts:
        for pattern in config.EXCLUDE_PATTERNS:
            if pattern in part:
                return True
    if path.name.startswith("."):
        return True
    return False


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
    """从服务器获取文件清单 {rel_path: {size, modified}}。"""
    async with httpx.AsyncClient(timeout=60) as client:
        res = await client.get(
            f"{config.SERVER_URL}/api/sync/manifest",
            headers=config.auth_headers,
        )
        if res.status_code != 200:
            raise Exception(f"获取清单失败: {res.status_code} {res.text}")
        data = res.json()
        return {f["path"]: {"mtime": f["modified"], "size": f["size"]} for f in data.get("files", [])}


async def upload_file(rel_path: str) -> bool:
    """上传文件到服务器。带 base_hash 冲突检测。"""
    local = Path(config.WATCH_DIR) / rel_path
    if not local.exists():
        return False

    # 计算本地文件 hash，用于冲突检测
    file_hash = hashlib.sha256(local.read_bytes()).hexdigest()
    # 从本地状态中取出上次同步时的 hash 作为 base_hash
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
            # 更新本地状态中的 hash
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
                conflict_path.write_bytes(local.read_bytes())
                print(f"    本地版本已保存为冲突副本: {conflict_path.name}")
            except Exception as e:
                print(f"    保存冲突副本失败: {e}")
            return False
        elif res.status_code == 403:
            print(f"  [Guard拦截] {rel_path}: {res.json().get('detail', '')}")
            return False
        else:
            print(f"  [上传失败] {rel_path}: {res.status_code} {res.text[:200]}")
            return False


async def download_file(rel_path: str) -> bool:
    """从服务器下载文件。"""
    local = Path(config.WATCH_DIR) / rel_path
    local.parent.mkdir(parents=True, exist_ok=True)

    async with httpx.AsyncClient(timeout=120) as client:
        res = await client.get(
            f"{config.SERVER_URL}/api/sync/download",
            headers=config.auth_headers,
            params={"path": rel_path},
        )
        if res.status_code == 200:
            local.write_bytes(res.content)
            print(f"  [下载] {rel_path} OK")
            return True
        else:
            print(f"  [下载失败] {rel_path}: {res.status_code}")
            return False


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
    state = _state_load()
    local = _scan_local()

    try:
        remote = await _get_remote_manifest()
    except Exception as e:
        print(f"  获取服务器清单失败: {e}")
        return

    uploaded = downloaded = deleted = skipped = 0
    new_state = {}

    # ---- 上行：本地 -> 服务器 ----
    for rel, info in local.items():
        new_state[rel] = info
        remote_info = remote.get(rel)
        prev_info = state.get(rel)

        if not remote_info:
            # 服务器没有，上传
            if await upload_file(rel):
                uploaded += 1
            else:
                skipped += 1
        elif prev_info and info["mtime"] > prev_info.get("mtime", 0):
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
            prev_info = state.get(rel)

            if not local_info:
                # 本地没有 -> 下载
                if await download_file(rel):
                    downloaded += 1
                    scanned = _scan_local().get(rel)
                    if scanned:
                        new_state[rel] = scanned
                else:
                    skipped += 1
            elif prev_info and remote_info.get("modified", 0) > prev_info.get("remote_mtime", 0):
                # 服务器端文件比上次记录的更新，下载覆盖本地
                if await download_file(rel):
                    downloaded += 1
                    scanned = _scan_local().get(rel)
                    if scanned:
                        new_state[rel] = scanned
                    new_state.setdefault(rel, {})["remote_mtime"] = remote_info.get("modified", 0)
                else:
                    skipped += 1
            else:
                # 记录远程 mtime 以便下次比较
                if rel in new_state:
                    new_state[rel]["remote_mtime"] = remote_info.get("modified", 0)

        # ---- 双向删除同步：之前在服务器上有但现在远程没有了 -> 本地也删除 ----
        for rel in list(state.keys()):
            prev = state.get(rel, {})
            was_on_remote = prev.get("remote_mtime") is not None
            if was_on_remote and rel not in remote and rel in local:
                local_file = Path(config.WATCH_DIR) / rel
                try:
                    local_file.unlink()
                    deleted += 1
                    print(f"  [本地删除] {rel}（远程已删除）")
                    new_state.pop(rel, None)
                except Exception:
                    pass

    # 清理：之前有但现在本地和远程都没有的 state 记录
    for rel in list(state.keys()):
        if rel not in local and rel not in remote:
            new_state.pop(rel, None)

    _state_save(new_state)
    print(f"  同步完成: 上传 {uploaded}, 下载 {downloaded}, 删除 {deleted}, 跳过 {skipped}")


async def sync_single_file(rel_path: str, action: str = "upload"):
    """同步单个文件（watchdog 触发时用）。"""
    local = Path(config.WATCH_DIR) / rel_path

    if action == "delete":
        if await delete_remote(rel_path):
            state = _state_load()
            state.pop(rel_path, None)
            _state_save(state)
        return

    if not local.exists() or _is_excluded(local):
        return

    if await upload_file(rel_path):
        state = _state_load()
        stat = local.stat()
        state[rel_path] = {"mtime": stat.st_mtime, "size": stat.st_size, "hash": hashlib.sha256(local.read_bytes()).hexdigest()}
        _state_save(state)
