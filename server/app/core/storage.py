"""文件存储抽象层（多账户版）：按 user_id 隔离。"""

import hashlib
import mimetypes
import shutil
from pathlib import Path

from ..config import settings


def _storage_root() -> Path:
    return settings.storage_path


def _user_dir(user_id: str) -> Path:
    """返回用户专属目录。"""
    d = _storage_root() / user_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def _safe_path(user_id: str, rel_path: str) -> Path:
    """解析 rel_path 并确保解析结果落在用户目录内。

    拒绝绝对路径、``..`` 穿越以及指向用户目录外的符号链接。任何越界输入都抛
    FileNotFoundError，使调用方与「文件不存在」不可区分，避免泄露路径校验的存在与边界。
    返回 resolve() 后的绝对路径（无论目标是否已存在）。
    """
    base = _user_dir(user_id).resolve()
    if rel_path is None or Path(rel_path).is_absolute():
        raise FileNotFoundError(rel_path or "")
    # resolve() 词法规范化 ``..`` 并解析符号链接；对不存在的路径做尽力解析
    target = (base / rel_path).resolve()
    if target != base and base not in target.parents:
        raise FileNotFoundError(rel_path)
    return target


def save_file(user_id: str, remote_path: str, data: bytes, source: str = "manual") -> dict:
    safe = Path(remote_path)
    parts = [p for p in safe.parts if p not in ("", "/", "..")]
    rel = Path(*parts) if parts else Path(safe.name)

    dest = _user_dir(user_id) / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)

    content_hash = hashlib.sha256(data).hexdigest()
    mime = mimetypes.guess_type(str(rel))[0] or "application/octet-stream"
    return {
        "path": str(rel), "name": dest.name, "size": len(data),
        "content_hash": content_hash, "mime_type": mime, "source": source,
    }


def save_fileobj(user_id: str, remote_path: str, fileobj, source: str = "manual") -> dict:
    safe = Path(remote_path)
    parts = [p for p in safe.parts if p not in ("", "/", "..")]
    rel = Path(*parts) if parts else Path(safe.name)

    dest = _user_dir(user_id) / rel
    dest.parent.mkdir(parents=True, exist_ok=True)

    hasher = hashlib.sha256()
    size = 0
    with open(dest, "wb") as f:
        while True:
            chunk = fileobj.read(1024 * 1024)
            if not chunk:
                break
            f.write(chunk)
            hasher.update(chunk)
            size += len(chunk)

    mime = mimetypes.guess_type(str(rel))[0] or "application/octet-stream"
    return {
        "path": str(rel), "name": dest.name, "size": size,
        "content_hash": hasher.hexdigest(), "mime_type": mime, "source": source,
    }


def read_file(user_id: str, rel_path: str) -> Path:
    p = _safe_path(user_id, rel_path)
    if not p.exists():
        raise FileNotFoundError(rel_path)
    return p


def delete_file(user_id: str, rel_path: str):
    try:
        p = _safe_path(user_id, rel_path)
    except FileNotFoundError:
        return  # 路径越界：视作不存在，无操作
    if p.exists():
        if p.is_dir():
            shutil.rmtree(p)
        else:
            p.unlink()


def list_directory(user_id: str, rel_dir: str = "") -> list:
    base = _user_dir(user_id).resolve()
    try:
        root = _safe_path(user_id, rel_dir) if rel_dir else base
    except FileNotFoundError:
        return []
    if not root.exists():
        return []
    result = []
    for entry in sorted(root.iterdir()):
        if entry.name.startswith("."):
            continue
        is_dir = entry.is_dir()
        try:
            rel = str(entry.relative_to(base))
        except ValueError:
            continue
        result.append({
            "name": entry.name, "path": rel, "is_dir": is_dir,
            "size": 0 if is_dir else entry.stat().st_size,
            "modified": entry.stat().st_mtime,
        })
    result.sort(key=lambda x: (not x["is_dir"], x["name"]))
    return result


def list_all_files(user_id: str, rel_dir: str = "") -> list:
    base = _user_dir(user_id).resolve()
    try:
        root = _safe_path(user_id, rel_dir) if rel_dir else base
    except FileNotFoundError:
        return []
    files = []
    for p in root.rglob("*"):
        if p.is_file() and not p.name.startswith("."):
            files.append(str(p.relative_to(base)))
    return files


def get_file_size(user_id: str, rel_path: str) -> int:
    try:
        p = _safe_path(user_id, rel_path)
    except FileNotFoundError:
        return 0
    return p.stat().st_size if p.exists() else 0


def delete_user_storage(user_id: str):
    """删除用户的所有文件（管理员删除用户时调用）。"""
    d = _user_dir(user_id)
    if d.exists():
        shutil.rmtree(d)


def ensure_storage():
    _storage_root().mkdir(parents=True, exist_ok=True)
