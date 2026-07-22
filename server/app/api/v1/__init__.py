"""v1 API 聚合路由。

结构：
- 类型化新端点（uploads / trash …）：response_model + 统一错误契约 {code,message,detail}
- 兼容挂载：既有六个业务 router 原样挂到 /api/v1 前缀下（旧响应形态），
  随各域重构逐步替换为类型化端点；前端（S3）统一消费 /api/v1。
"""

from fastapi import APIRouter

from .uploads import router as uploads_router
from .trash import router as trash_router
from .chat import router as chat_router
from .placeholders import router as placeholders_router
from .. import auth, files, chat, sync, admin, transfer

router = APIRouter(prefix="/api/v1", tags=["v1"])

# 类型化端点优先注册（新路径，与兼容路径不冲突）
router.include_router(uploads_router)
router.include_router(trash_router)
router.include_router(chat_router)
router.include_router(placeholders_router)

# 兼容挂载：既有端点在 v1 前缀下同样可达
for _r in (auth.router, files.router, chat.router, sync.router, admin.router, transfer.router):
    router.include_router(_r)
