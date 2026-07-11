"""storage 层路径穿越回归测试。

直接针对 storage 模块的读/删/列函数，验证：
- `..` 穿越、绝对路径、逃逸符号链接一律被拒（FileNotFoundError / 空结果 / 0）；
- 合法的子目录路径不受影响，无回归。
"""
import io
from pathlib import Path

import pytest

from app.core import storage


def _write_outside(user_id: str, name: str, content: bytes = b"OUTSIDE-SECRET") -> Path:
    """在用户目录同级放一个敏感文件（模拟 db.sqlite / 邻居用户文件）。"""
    base = storage._user_dir(user_id).resolve()
    outside = base.parent / name
    outside.write_bytes(content)
    return outside


# ==================== read_file ====================

def test_read_file_rejects_parent_traversal(user):
    outside = _write_outside(user, "db.sqlite", b"DB-SECRET password_hash admin")
    with pytest.raises(FileNotFoundError):
        storage.read_file(user, "../db.sqlite")
    assert outside.exists()  # 路径校验不应有副作用


def test_read_file_rejects_deep_traversal(user):
    _write_outside(user, "victim.txt")
    with pytest.raises(FileNotFoundError):
        storage.read_file(user, "../../../../../etc/passwd")


def test_read_file_rejects_absolute_path(user):
    _write_outside(user, "db.sqlite")
    with pytest.raises(FileNotFoundError):
        storage.read_file(user, "/etc/passwd")
    # 即便绝对路径落在用户目录内也拒绝（仅允许相对路径）
    inside = storage._user_dir(user) / "inside.txt"
    inside.write_text("hello")
    with pytest.raises(FileNotFoundError):
        storage.read_file(user, str(inside))


def test_read_file_rejects_symlink_escape(user):
    outside = _write_outside(user, "secret.txt", b"SYMLINK-TARGET-SECRET")
    link = storage._user_dir(user) / "escape.link"
    link.symlink_to(outside)
    with pytest.raises(FileNotFoundError):
        storage.read_file(user, "escape.link")


def test_read_file_allows_legitimate_subpath(user):
    storage.save_fileobj(user, "docs/notes.txt", io.BytesIO(b"hello world"))
    p = storage.read_file(user, "docs/notes.txt")
    assert p.read_bytes() == b"hello world"


# ==================== delete_file ====================

def test_delete_file_noop_on_traversal(user):
    outside = _write_outside(user, "victim.txt", b"do-not-delete")
    storage.delete_file(user, "../victim.txt")
    assert outside.exists()
    assert outside.read_bytes() == b"do-not-delete"


def test_delete_file_noop_on_db_path(user):
    base = storage._user_dir(user).resolve()
    db = base.parent / "db.sqlite"
    db.write_bytes(b"DB-CONTENT")
    storage.delete_file(user, "../../db.sqlite")
    assert db.exists()
    assert db.read_bytes() == b"DB-CONTENT"


def test_delete_file_removes_legitimate(user):
    storage.save_fileobj(user, "to_delete.txt", io.BytesIO(b"x"))
    storage.delete_file(user, "to_delete.txt")
    assert not (storage._user_dir(user) / "to_delete.txt").exists()


# ==================== list_directory / list_all_files / get_file_size ====================

def test_list_directory_traversal_returns_empty(user):
    _write_outside(user, "neighbor.txt")
    assert storage.list_directory(user, "../") == []
    assert storage.list_directory(user, "../../") == []


def test_list_all_files_traversal_returns_empty(user):
    _write_outside(user, "neighbor.txt")
    assert storage.list_all_files(user, "../") == []


def test_get_file_size_traversal_returns_zero(user):
    _write_outside(user, "big.bin", b"x" * 100)
    assert storage.get_file_size(user, "../big.bin") == 0


def test_list_directory_normal(user):
    storage.save_fileobj(user, "a.txt", io.BytesIO(b"a"))
    storage.save_fileobj(user, "sub/b.txt", io.BytesIO(b"b"))
    names = {it["name"] for it in storage.list_directory(user, "")}
    assert "a.txt" in names
    assert "sub" in names
    # 子目录列举
    sub_names = {it["name"] for it in storage.list_directory(user, "sub")}
    assert sub_names == {"b.txt"}


# ==================== 根目录 / 符号链接 / 断链（回归） ====================

def test_delete_file_dot_does_not_wipe(user):
    """_safe_path 对 '.' 必须拒绝，delete_file('.') 不能 rmtree 整个用户目录。"""
    storage.save_fileobj(user, "a.txt", io.BytesIO(b"A"))
    storage.save_fileobj(user, "sub/b.txt", io.BytesIO(b"B"))
    storage.delete_file(user, ".")
    storage.delete_file(user, "")  # 空路径同理
    assert len(storage.list_all_files(user)) == 2, "用户文件被误删"


def test_read_file_rejects_root_path(user):
    storage.save_fileobj(user, "a.txt", io.BytesIO(b"A"))
    with pytest.raises(FileNotFoundError):
        storage.read_file(user, ".")
    with pytest.raises(FileNotFoundError):
        storage.read_file(user, "")


def test_delete_symlink_removes_link_not_target(user):
    """删除用户目录内的符号链接，应只删链接本身，保留其目标。"""
    storage.save_fileobj(user, "real.txt", io.BytesIO(b"REAL"))
    base = storage._user_dir(user).resolve()
    link = base / "link.txt"
    link.symlink_to(base / "real.txt")
    storage.delete_file(user, "link.txt")
    assert not link.is_symlink(), "符号链接未被删除"
    assert (base / "real.txt").exists(), "目标被误删"
    assert (base / "real.txt").read_bytes() == b"REAL"


def test_save_rejects_symlink_escape(user):
    """写入穿过指向外部的符号链接目录时必须拒绝（写逃逸）。"""
    base = storage._user_dir(user).resolve()
    outside = base.parent / f"outside-{user}"
    outside.mkdir(exist_ok=True)
    try:
        (base / "escape").symlink_to(outside)
        with pytest.raises(FileNotFoundError):
            storage.save_fileobj(user, "escape/x.txt", io.BytesIO(b"LEAK"))
        assert not (outside / "x.txt").exists(), "文件被写到用户目录外"
    finally:
        import shutil as _sh
        _sh.rmtree(outside, ignore_errors=True)


def test_list_directory_skips_broken_symlink(user):
    """断链符号链接不应让 list_directory 崩溃 500。"""
    base = storage._user_dir(user).resolve()
    storage.save_fileobj(user, "good.txt", io.BytesIO(b"ok"))
    (base / "dangling.link").symlink_to(base / "nope.txt")  # target 不存在
    items = storage.list_directory(user, "")  # 不应抛异常
    names = {it["name"] for it in items}
    assert "good.txt" in names
