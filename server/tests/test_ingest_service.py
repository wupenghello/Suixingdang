"""统一入库服务测试（S1：收敛 4 份管道后的单一真源）。

覆盖四种调用语义与分叉修复：
- upload/note/transfer 语义（reject 重复）与 sync 语义（skip 重复）
- 分叉修复①：回收站文件不再阻塞去重（sync/transfer 历史 bug）
- 分叉修复②：upsert 统一活跃行优先
- 冲突检测（base_hash → 409 + X-Server-Hash）
- 配额（回收站不计入已用空间）
- 笔记编辑重命名清理旧物理文件
- Guard 拦截回滚（磁盘无残留）
"""

from datetime import datetime

import pytest

from app.db.models import SessionLocal, User, File as FileModel
from app.core.security import hash_password
from app.services.ingest import ingest_file, IngestError
from app.core import storage


@pytest.fixture()
def db():
    d = SessionLocal()
    yield d
    d.close()


@pytest.fixture()
def user(client, db):
    """client fixture 确保 init_db 已跑。每次重置配额，防跨测试污染。"""
    u = db.query(User).filter_by(username="ingest-user").first()
    if not u:
        u = User(username="ingest-user", password_hash=hash_password("Pw-12345678"))
        db.add(u)
    u.quota_mb = 0  # 无限配额基线；配额用例自行设置
    db.commit()
    db.refresh(u)
    return u


def _ingest(db, user, path, content, **kw):
    kw.setdefault("source", "manual")
    return ingest_file(db, user, path, data=content.encode("utf-8"), **kw)


def test_ingest_creates_file_and_row(db, user):
    out = _ingest(db, user, "a.txt", "hello-a", access_action="file_upload")
    assert out.created is True
    assert out.file.path == "a.txt"
    assert (storage._user_dir(user.id) / "a.txt").read_text() == "hello-a"


def test_duplicate_rejected_by_default(db, user):
    _ingest(db, user, "dup1.txt", "same-content")
    with pytest.raises(IngestError) as ei:
        _ingest(db, user, "dup2.txt", "same-content")
    assert ei.value.status == 409
    assert ei.value.code == "FILE_DUPLICATE"
    # 回滚：第二份不得落盘
    assert not (storage._user_dir(user.id) / "dup2.txt").exists()


def test_duplicate_skip_for_sync_semantics(db, user):
    first = _ingest(db, user, "s1.txt", "sync-content")
    out = _ingest(db, user, "s2.txt", "sync-content", dedup="skip", source="home")
    assert out.deduplicated is True
    assert out.file.id == first.file.id
    assert not (storage._user_dir(user.id) / "s2.txt").exists()


def test_trashed_file_does_not_block_dedup(db, user):
    """分叉修复回归：sync/transfer 旧实现去重包含软删文件，导致回收站文件阻塞入库。"""
    out = _ingest(db, user, "t1.txt", "trash-content")
    # 软删除 t1
    row = db.query(FileModel).filter_by(id=out.file.id).first()
    row.deleted_at = datetime.utcnow()
    db.commit()
    # 同内容新文件必须成功入库（而非报重复）
    out2 = _ingest(db, user, "t2.txt", "trash-content")
    assert out2.created is True
    assert out2.file.id != out.file.id


def test_conflict_detection_headers(db, user):
    out = _ingest(db, user, "c.txt", "v1")
    with pytest.raises(IngestError) as ei:
        ingest_file(db, user, "c.txt", data=b"v2", source="home",
                    base_hash="0" * 64, direction="home_to_server")
    assert ei.value.status == 409
    assert ei.value.code == "SYNC_CONFLICT"
    assert ei.value.headers.get("X-Server-Hash") == out.file.content_hash


def test_quota_excludes_trash(db, user):
    """分叉修复回归：transfer 旧配额把回收站计入已用空间。"""
    user.quota_mb = 0  # 先无限写入
    db.commit()
    big = "x" * (2 * 1024 * 1024)  # 2MB
    out = _ingest(db, user, "big.txt", big)
    # 软删 → 回收站
    row = db.query(FileModel).filter_by(id=out.file.id).first()
    row.deleted_at = datetime.utcnow()
    # 设 3MB 配额：若回收站计入则 2+2>3 失败；统一语义下 0+2<3 成功
    user.quota_mb = 3
    db.commit()
    out2 = _ingest(db, user, "big2.txt", big)
    assert out2.created is True


def test_quota_exceeded_rolls_back(db, user):
    user.quota_mb = 1  # 1MB
    db.commit()
    with pytest.raises(IngestError) as ei:
        _ingest(db, user, "over.bin", "y" * (2 * 1024 * 1024))
    assert ei.value.status == 413
    assert ei.value.code == "QUOTA_EXCEEDED"
    assert not (storage._user_dir(user.id) / "over.bin").exists()


def test_note_edit_rename_cleans_old_file(db, user):
    out = _ingest(db, user, "note-old.md", "note v1", source="note")
    out2 = ingest_file(db, user, "note-new.md", data=b"note v2", source="note",
                       update_file_id=out.file.id, exclude_file_id=out.file.id)
    assert out2.file.id == out.file.id          # 同一条记录原地更新
    assert out2.file.path == "note-new.md"
    assert not (storage._user_dir(user.id) / "note-old.md").exists()
    assert (storage._user_dir(user.id) / "note-new.md").read_text() == "note v2"


def test_guard_filename_blocked_no_disk_residue(db, user):
    """路径穿越由 storage._safe_path 兜底，服务层转为契约错误（非 500）。"""
    with pytest.raises(IngestError) as ei:
        _ingest(db, user, "../escape.txt", "evil")
    assert ei.value.status == 400
    assert ei.value.code == "PATH_INVALID"
    assert not (storage._user_dir(user.id).parent / "escape.txt").exists()


def test_group_ownership_validated(db, user):
    with pytest.raises(IngestError) as ei:
        _ingest(db, user, "g.txt", "x", group_id="nonexistent-group")
    assert ei.value.status == 404
    assert ei.value.code == "GROUP_NOT_FOUND"


def test_upsert_active_row_preferred(db, user):
    """同路径重复入库更新活跃行而非新建（统一语义）。"""
    out1 = _ingest(db, user, "u.txt", "upsert-v1-unique")
    out2 = _ingest(db, user, "u.txt", "upsert-v2-unique-different")
    assert out2.file.id == out1.file.id
    assert out2.created is False
    rows = db.query(FileModel).filter_by(owner_id=user.id, path="u.txt").all()
    assert len(rows) == 1
