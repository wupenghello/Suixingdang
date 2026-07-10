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
    p = _user_dir(user_id) / rel_path
    if not p.exists():
        raise FileNotFoundError(rel_path)
    return p


def delete_file(user_id: str, rel_path: str):
    p = _user_dir(user_id) / rel_path
    if p.exists():
        if p.is_dir():
            shutil.rmtree(p)
        else:
            p.unlink()


def list_directory(user_id: str, rel_dir: str = "") -> list:
    base = _user_dir(user_id)
    root = base / rel_dir if rel_dir else base
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
    base = _user_dir(user_id)
    root = base / rel_dir if rel_dir else base
    files = []
    for p in root.rglob("*"):
        if p.is_file() and not p.name.startswith("."):
            files.append(str(p.relative_to(base)))
    return files


def get_file_size(user_id: str, rel_path: str) -> int:
    p = _user_dir(user_id) / rel_path
    return p.stat().st_size if p.exists() else 0


def delete_user_storage(user_id: str):
    """删除用户的所有文件（管理员删除用户时调用）。"""
    d = _user_dir(user_id)
    if d.exists():
        shutil.rmtree(d)


def ensure_storage():
    _storage_root().mkdir(parents=True, exist_ok=True)
