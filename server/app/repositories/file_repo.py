"""文件仓库：files 表的隔离查询与入库辅助。"""

from datetime import datetime

from sqlalchemy import func

from ..db.models import File as FileModel, FileGroup
from .base import Repository


class FileRepo(Repository):
    model = FileModel
    owner_column = "owner_id"

    # ---- 查询 ----

    def active(self, user_id: str):
        """活跃文件（非回收站）。"""
        return self.for_user(user_id).filter(FileModel.deleted_at.is_(None))

    def trashed(self, user_id: str):
        """回收站内文件。"""
        return self.for_user(user_id).filter(FileModel.deleted_at.isnot(None))

    def by_id_active(self, user_id: str, file_id: str):
        return self.active(user_id).filter(FileModel.id == file_id).first()

    def by_id_trashed(self, user_id: str, file_id: str):
        return self.trashed(user_id).filter(FileModel.id == file_id).first()

    def by_path(self, user_id: str, path: str, active_only: bool = True):
        q = self.for_user(user_id).filter(FileModel.path == path)
        if active_only:
            q = q.filter(FileModel.deleted_at.is_(None))
        return q.first()

    def find_duplicate(self, user_id: str, content_hash: str, exclude_path: str,
                       exclude_file_id: str = "", include_trashed: bool = False):
        """按 content_hash 查重。默认排除回收站文件（统一语义：软删文件不阻塞新入库）。"""
        q = self.for_user(user_id).filter(
            FileModel.content_hash == content_hash,
            FileModel.path != exclude_path,
        )
        if not include_trashed:
            q = q.filter(FileModel.deleted_at.is_(None))
        if exclude_file_id:
            q = q.filter(FileModel.id != exclude_file_id)
        return q.first()

    def used_bytes(self, user_id: str) -> int:
        """已用空间（仅活跃文件，回收站不计入配额）。"""
        return self.active(user_id).with_entities(
            func.sum(FileModel.size)
        ).scalar() or 0

    def group_owned(self, user_id: str, group_id: str):
        return self.db.query(FileGroup).filter_by(id=group_id, owner_id=user_id).first()
