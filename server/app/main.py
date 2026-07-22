"""FastAPI 用户端应用入口（多账户版）。"""

from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse

from .config import settings
from .version import __version__
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
    title="随行档 Suixingdang", version=__version__, lifespan=lifespan,
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
    return {"status": "ok", "service": "Suixingdang", "version": __version__}


# 用户端前端：React + TS 构建产物（web/ 源码，CI 构建后打进镜像 /web/dist）。
# v2.1.x 起直接服务根路径 /（唯一正式版，旧 SPA 与 /next 灰度已下线）。
WEB_DIR = Path(__file__).parent / "web"                # 管理后台 / 落地页等随包静态资源
WEB_DIST = Path(__file__).parents[2] / "web" / "dist"  # 容器内 /web/dist；本地仓库 web/dist
ADMIN_DIR = WEB_DIR / "admin"

# 管理后台静态资源（独立目录，与用户端 /assets 互不干扰）
if (ADMIN_DIR / "assets").is_dir():
    app.mount("/admin/assets", StaticFiles(directory=ADMIN_DIR / "assets"), name="admin-assets")

# 落地页（/welcome）与样式：与用户端应用壳解耦，独立保留
_landing_html = WEB_DIR / "landing.html"
_landing_css = WEB_DIR / "landing.css"

if _landing_css.exists():
    @app.get("/landing.css")
    def landing_css():
        return FileResponse(str(_landing_css), media_type="text/css")

@app.get("/welcome")
def welcome():
    if _landing_html.exists():
        return FileResponse(str(_landing_html))
    return {"detail": "Landing page not built."}

# 管理后台 SPA 入口：/admin 及子路径返回 admin/index.html
# （/admin/assets/* 已由上方 StaticFiles 挂载承接）
_admin_index = ADMIN_DIR / "index.html"

@app.get("/admin")
@app.get("/admin/{rest:path}")
def serve_admin(rest: str = ""):
    if _admin_index.exists():
        return FileResponse(str(_admin_index))
    return {"detail": "Admin frontend not built."}

# 用户端 SPA：构建产物完整才挂载。空目录 / 缺 assets 时强行 mount，StaticFiles
# 会因目录不存在抛 RuntimeError 导致启动失败（源码部署未跑 web 构建的场景）。
if (WEB_DIST / "index.html").exists() and (WEB_DIST / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=WEB_DIST / "assets"), name="assets")

    # 灰度旧地址过渡：/next/* 301 到 /*（hash 片段由浏览器自动保留）
    @app.get("/next/{rest:path}")
    def next_legacy_redirect(rest: str):
        return RedirectResponse(url=f"/{rest}", status_code=301)

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
        return FileResponse(str(WEB_DIST / "index.html"))
else:
    # 构建产物缺失（源码部署未构建 web/dist）：仅 admin / welcome / API 可用
    @app.get("/{full_path:path}")
    def serve_spa_fallback(full_path: str):
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not Found")
        if full_path == "welcome":
            if _landing_html.exists():
                return FileResponse(str(_landing_html))
            return {"detail": "Landing page not built."}
        if is_sensitive_path(full_path):
            raise HTTPException(status_code=404, detail="Not Found")
        return {"service": "随行档", "status": "running",
                "detail": "Frontend not built. Run scripts/build_web.sh first."}
