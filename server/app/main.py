"""FastAPI 用户端应用入口（多账户版）。"""

from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from .config import settings
from .db.models import init_db
from .core.storage import ensure_storage
from .core.sensitive_paths import is_sensitive_path
from .core.errors import install_exception_handlers
from .core.logging import setup_logging
from .api import auth, files, chat, sync, admin, transfer
from .api import v1 as v1_api


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()
    Path(settings.DATABASE_PATH).parent.mkdir(parents=True, exist_ok=True)
    ensure_storage()
    init_db()
    _trash_purge_on_startup()
    print(f"[Suixingdang] 用户端启动")
    print(f"[Suixingdang] 存储目录: {settings.storage_path}")
    print(f"[Suixingdang] 数据库: {settings.DATABASE_PATH}")
    print(f"[Suixingdang] LLM 配置已迁移到管理后台（数据库管理）")
    print(f"[Suixingdang] 注册开关: {'开放' if settings.ALLOW_REGISTER else '关闭'}")
    yield


def _trash_purge_on_startup():
    """启动时清理过期的回收站文件（一次性兜底，避免长期未触发清理导致磁盘堆积）。

    实现收敛至 services/trash.py（原此处与 files.py/admin.py 各有一份拷贝）。
    """
    try:
        from .db.models import SessionLocal
        from .services import trash as trash_service
        db = SessionLocal()
        try:
            trash_service.purge_expired(db, user_id=None, write_access_log=False)
        finally:
            db.close()
    except Exception as e:
        print(f"[Suixingdang] ⚠️ 启动清理回收站失败: {e}")


app = FastAPI(
    title="随行档 Suixingdang", version="2.0.0", lifespan=lifespan,
    # 默认关闭自动文档：生产环境不暴露 API 结构。本地开发置 ENABLE_API_DOCS=true 开启。
    docs_url="/docs" if settings.ENABLE_API_DOCS else None,
    redoc_url="/redoc" if settings.ENABLE_API_DOCS else None,
    openapi_url="/openapi.json" if settings.ENABLE_API_DOCS else None,
)

# 浏览器会话令牌走 HttpOnly Cookie；但前端与 API 同源，CORS 不适用，无需 allow_credentials。
# 来源白名单从 CORS_ORIGINS 派生，缺省按 DOMAIN 推导，避免通配源 + credentials 的非法组合。
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api")
app.include_router(files.router, prefix="/api")
app.include_router(chat.router, prefix="/api")
app.include_router(sync.router, prefix="/api")
# admin 路由与前端（/admin）也挂载于此实例，生产环境统一入口
app.include_router(admin.router, prefix="/api")
app.include_router(transfer.router, prefix="/api")
# v1 契约层：类型化新端点 + 既有路由兼容挂载（前端 S3 统一消费 /api/v1）
app.include_router(v1_api.router)
# 统一错误体：AppError → {code,message,detail}；/api/v1 下的 HTTPException 同构
install_exception_handlers(app)


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "Suixingdang", "version": "2.0.0"}


# 用户端前端
WEB_DIR = Path(__file__).parent / "web"

# 新前端（S3：React+TS 构建产物）灰度入口 /next/*（绞杀者迁移：旧 SPA 保持默认，
# 验证完毕后切换默认入口并下线旧前端）
NEW_WEB_DIST = Path(__file__).parents[2] / "web" / "dist"

if NEW_WEB_DIST.exists():
    app.mount("/next/assets", StaticFiles(directory=NEW_WEB_DIST / "assets"), name="next-assets")

    @app.get("/next/{rest:path}")
    def serve_next_spa(rest: str):
        return FileResponse(str(NEW_WEB_DIST / "index.html"))

if WEB_DIR.exists():
    app.mount("/assets", StaticFiles(directory=WEB_DIR / "assets"), name="assets")
    # 落地页样式独立于 app.css，避免缓存耦合
    _landing_css = WEB_DIR / "landing.css"
    if _landing_css.exists():
        @app.get("/landing.css")
        def landing_css():
            return FileResponse(str(_landing_css), media_type="text/css")

    # 独立落地页：未登录用户的产品介绍页，与应用壳解耦
    _landing_html = WEB_DIR / "landing.html"

    @app.get("/welcome")
    def welcome():
        if _landing_html.exists():
            return FileResponse(str(_landing_html))
        return {"detail": "Landing page not built."}

    @app.get("/{full_path:path}")
    def serve_spa(full_path: str):
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not Found")
        # 落地页独立访问入口
        if full_path == "welcome":
            if _landing_html.exists():
                return FileResponse(str(_landing_html))
            return {"detail": "Landing page not built."}
        # 扫描器常探的敏感路径直接 404,不返回 SPA index.html(否则会被当 200 命中)
        if is_sensitive_path(full_path):
            raise HTTPException(status_code=404, detail="Not Found")
        # 管理后台前端入口：/admin 及其子路径返回 admin/index.html
        admin_index = WEB_DIR / "admin" / "index.html"
        if full_path == "admin" or full_path.startswith("admin/"):
            if admin_index.exists():
                return FileResponse(str(admin_index))
            return {"detail": "Admin frontend not built."}
        index = WEB_DIR / "index.html"
        if index.exists():
            return FileResponse(str(index))
        return {"detail": "Frontend not built."}
else:
    @app.get("/")
    def root():
        return {"service": "随行档", "status": "running", "api_docs": "/docs"}
