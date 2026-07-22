"""统一入库管道（收敛 4 份分叉实现）。

历史债务：upload（files.py）、note（files.py）、sync（sync.py）、transfer（transfer.py）
各自实现 guard→quota→save→dedup→content-guard→upsert→index→event 管道，且已分叉：
- sync/transfer 去重不排除回收站文件 → 软删文件阻塞同步/传输（修复：统一排除）
- sync/transfer upsert 不过滤软删行 → 可能更新到已删除记录（修复：统一活跃行优先）

语义统一后的唯一入口：ingest_file()。各路由只保留自身特有的前置/后置逻辑
（note 的文件名规范化、sync 的冲突事件记录、transfer 的时间线消息）。
"""

import logging
from dataclasses import dataclass, field

from sqlalchemy.orm import Session

from ..core import storage, indexer, guard
from ..core.errors import AppError
from ..db.models import File as FileModel, SyncEvent, AccessLog, User
from ..repositories.file_repo import FileRepo
from datetime import datetime

logger = logging.getLogger(__name__)


class IngestError(AppError):
    """入库失败（guard/quota/conflict/duplicate）。由路由层按前缀转换错误体。"""


@dataclass
class IngestOutcome:
    file: FileModel
    created: bool = False
    deduplicated: bool = False
    guard_status: str = "safe"
    guard_reason: str = ""


def check_quota(db: Session, user: User, file_size: int):
    """配额检查：回收站文件不计入已用空间（统一语义，原 transfer 版本计入了回收站）。"""
    if user.quota_mb <= 0:
        return
    used = FileRepo(db).used_bytes(user.id)
    if used + file_size > user.quota_mb * 1024 * 1024:
        raise IngestError(
            "QUOTA_EXCEEDED", f"存储空间不足（配额 {user.quota_mb}MB）", status=413,
        )


def ingest_file(
    db: Session,
    user: User,
    rel_path: str,
    *,
    data: bytes | None = None,        # 直接字节（笔记）
    fileobj=None,                     # 文件流（上传/同步/传输）
    source: str,
    direction: str = "upload",        # SyncEvent.direction（sync 用 home_to_server）
    group_id: str = "",
    base_hash: str = "",              # 冲突检测（daemon 提供编辑前 hash）
    skip_content_guard: bool = False, # upload 的 skip_guard 参数
    exclude_file_id: str = "",        # 去重排除（笔记编辑排除自身）
    update_file_id: str = "",         # 笔记编辑：原地更新该记录（含重命名清理）
    dedup: str = "reject",            # reject=重复报 409；skip=重复返回既有文件（sync）
    check_quota_flag: bool = True,
    do_index: bool = True,
    event_direction: str | None = None,  # 默认同 direction
    access_action: str = "",          # 非空则写 AccessLog
) -> IngestOutcome:
    assert data is not None or fileobj is not None, "ingest_file 需要 data 或 fileobj"
    repo = FileRepo(db)

    # 1. 分组归属校验
    if group_id:
        if not repo.group_owned(user.id, group_id):
            raise IngestError("GROUP_NOT_FOUND", "分组不存在", status=404)

    # 2. Guard - 文件名（落盘前）
    status, reason = guard.check_filename(rel_path)
    if status == "blocked":
        raise IngestError("GUARD_FILENAME_BLOCKED", f"Guard 拦截: {reason}", status=403)

    # 3. 冲突检测（daemon 同步专用）：base_hash 与服务器当前 hash 不一致 → 双端都改过
    if base_hash:
        pre = db.query(FileModel).filter_by(owner_id=user.id, path=rel_path).first()
        if pre and pre.content_hash and pre.content_hash != base_hash:
            raise IngestError(
                "SYNC_CONFLICT",
                f"同步冲突：服务器端的文件已被修改（server_hash={pre.content_hash[:16]}, base_hash={base_hash[:16]})",
                status=409,
                headers={"X-Server-Hash": pre.content_hash or ""},
            )

    # 4. 配额预检（字节数已知时按真实大小，未知放宽为 0）
    if check_quota_flag:
        check_quota(db, user, len(data) if data is not None else 0)

    # 5. 落盘（路径穿越由 storage._safe_path 兜底，转为契约错误而非 500）
    try:
        if data is not None:
            meta = storage.save_file(user.id, rel_path, data, source=source)
        else:
            meta = storage.save_fileobj(user.id, rel_path, fileobj, source=source)
    except FileNotFoundError:
        raise IngestError("PATH_INVALID", "非法路径", status=400)

    def _rollback():
        try:
            storage.delete_file(user.id, rel_path)
        except Exception:
            logger.warning("ingest 回滚删除失败: user=%s path=%s", user.id, rel_path)

    # 6. 配额精确检查（失败回滚已落盘文件）
    if check_quota_flag:
        try:
            check_quota(db, user, meta["size"])
        except IngestError:
            _rollback()
            raise

    # 7. 去重（统一语义：回收站文件不参与去重，修复软删文件阻塞同步/传输）
    dup = repo.find_duplicate(
        user.id, meta["content_hash"], meta["path"],
        exclude_file_id=exclude_file_id or (update_file_id or ""),
    )
    if dup:
        _rollback()
        if dedup == "skip":
            return IngestOutcome(file=dup, deduplicated=True,
                                 guard_status=status, guard_reason=reason)
        raise IngestError("FILE_DUPLICATE", f"文件内容已存在（重复）: {dup.path}", status=409)

    # 8. Guard - 内容（落盘后才能扫描）
    c_status, c_reason = guard.check_content(user.id, rel_path, direction=direction)
    if c_status == "blocked" and not skip_content_guard:
        _rollback()
        raise IngestError("GUARD_CONTENT_BLOCKED", f"Guard 拦截: {c_reason}", status=403)

    final_status = c_status if c_status != "safe" else status
    final_reason = c_reason if c_reason else reason

    # 9. Upsert（统一语义：活跃行优先，软删同名路径新建记录）
    created = False
    if update_file_id:
        # 笔记编辑：原地更新（重命名时清理旧物理文件与旧索引）
        f = repo.by_id_active(user.id, update_file_id)
        if not f:
            _rollback()
            raise IngestError("NOTE_NOT_FOUND", "笔记不存在或已被删除", status=404)
        old_path = f.path
        f.path, f.name = meta["path"], meta["name"]
        f.size, f.content_hash = meta["size"], meta["content_hash"]
        f.modified_at = datetime.utcnow()
        f.guard_status, f.guard_reason = final_status, final_reason
        f.group_id = group_id or None
        if old_path != meta["path"]:
            try:
                storage.delete_file(user.id, old_path)
            except Exception:
                pass
            try:
                indexer.remove_from_index(user.id, old_path)
            except Exception:
                logger.warning("移除旧索引失败: user=%s path=%s", user.id, old_path)
    else:
        existing = repo.by_path(user.id, meta["path"], active_only=True)
        if existing:
            existing.size = meta["size"]
            existing.content_hash = meta["content_hash"]
            existing.modified_at = datetime.utcnow()
            existing.source = source
            existing.guard_status = final_status
            existing.guard_reason = final_reason
            existing.group_id = group_id or None
            f = existing
        else:
            f = FileModel(
                owner_id=user.id, path=meta["path"], name=meta["name"], size=meta["size"],
                content_hash=meta["content_hash"], mime_type=meta["mime_type"],
                source=source, guard_status=final_status, guard_reason=final_reason,
                group_id=group_id or None,
            )
            db.add(f)
            created = True

    db.commit()
    db.refresh(f)

    # 10. 索引（best-effort：失败记录日志而非静默吞掉，可经 /index-all 补偿）
    if do_index:
        try:
            indexer.index_file(user.id, f.id, rel_path)
        except Exception:
            logger.warning("索引失败（可经 /index-all 补偿）: user=%s path=%s", user.id, rel_path)

    # 11. 同步事件 + 审计
    db.add(SyncEvent(user_id=user.id, file_id=f.id, file_name=rel_path,
                     direction=event_direction or direction, status="completed"))
    if access_action:
        db.add(AccessLog(user_id=user.id, action=access_action, detail=rel_path))
    db.commit()

    return IngestOutcome(file=f, created=created,
                         guard_status=final_status, guard_reason=final_reason)
