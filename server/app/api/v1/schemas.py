"""v1 API 响应模型（契约层）。

全部 v1 端点必须声明 response_model；错误统一走 AppError → {code, message, detail}。
datetime 统一 ISO 8601（消灭历史三种格式并存）。
"""

from datetime import datetime
from pydantic import BaseModel, ConfigDict


class ApiModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class ErrorBody(ApiModel):
    code: str
    message: str
    detail: dict = {}


class FileOut(ApiModel):
    id: str
    path: str
    name: str
    size: int
    mime_type: str = ""
    source: str = ""
    guard_status: str = "safe"
    guard_reason: str = ""
    group_id: str | None = None
    indexed: bool = False
    pinned: bool = False
    uploaded_at: datetime | None = None
    modified_at: datetime | None = None


class IngestOut(ApiModel):
    file: FileOut
    message: str = ""
    deduplicated: bool = False


class TrashItemOut(ApiModel):
    id: str
    path: str
    name: str
    size: int
    deleted_at: datetime | None = None
    locked: bool = False
    remaining_days: float = 0.0


class RestoredOut(ApiModel):
    path: str
    file_id: str
    renamed: bool = False
    message: str = "已恢复"


class PurgedOut(ApiModel):
    purged: int
    retention_days: int


class MessageOut(ApiModel):
    message: str
    file_id: str = ""
