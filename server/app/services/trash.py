"""回收站服务（收敛 3 份 purge 实现）。

历史债务：物理清理逻辑存在三份拷贝——
- main.py:31-60（启动兜底，全局）
- files.py:_purge_expired（用户级，带 AccessLog）
- admin.py:admin_trash_purge（全局，带 admin 审计）
统一为 purge_file() / purge_expired()，三处调用同一实现。
"""

import logging
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from ..core import storage, indexer
from ..core.settings_store import get_trash_retention_days
from ..db.models import File as FileModel, AccessLog

logger = logging.getLogger(__name__)


def purge_file(db: Session, user_id: str, f: FileModel) -> None:
    """物理清除单个回收站文件（磁盘 + 索引 + DB 行）。不提交事务，由调用方提交。"""
    try:
        storage.delete_file(user_id, f.path)
    except FileNotFoundError:
        pass  # 磁盘文件已不在（历史孤儿行），继续清 DB
    except Exception:
        logger.warning("回收站物理删除失败: user=%s path=%s", user_id, f.path)
    try:
        indexer.remove_from_index(user_id, f.path)
    except Exception:
        logger.warning("回收站索引移除失败: user=%s path=%s", user_id, f.path)
    db.delete(f)


def purge_expired(db: Session, user_id: str | None = None,
                  retention_days: int | None = None,
                  write_access_log: bool = True) -> int:
    """物理清除超过保留期的回收站文件。返回清除条数。

    user_id=None 时为全局清理（启动兜底 / 管理端手动触发）。
    已锁存（locked_at 非空）的文件一律跳过——用户主动保护的文件不受自动清理影响。
    """
    if retention_days is None:
        retention_days = get_trash_retention_days(db)
    cutoff = datetime.utcnow() - timedelta(days=retention_days)

    q = db.query(FileModel).filter(
        FileModel.deleted_at.isnot(None),
        FileModel.deleted_at <= cutoff,
        FileModel.locked_at.is_(None),
    )
    if user_id is not None:
        q = q.filter(FileModel.owner_id == user_id)

    purged = 0
    for f in q.all():
        purge_file(db, f.owner_id, f)
        purged += 1

    if purged:
        if write_access_log and user_id is not None:
            db.add(AccessLog(user_id=user_id, action="file_purge",
                             detail=f"回收站过期清理 {purged} 个文件"))
        db.commit()
        logger.info("回收站过期清理: %s 个文件（user=%s, 保留期=%s天）",
                    purged, user_id or "全局", retention_days)
    return purged
