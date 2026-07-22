"""管理员独立服务入口 - 运行在独立端口上，与用户端隔离。"""

from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from .config import settings
from .version import __version__
from .db.models import init_db
from .core.storage import ensure_storage
from .core.sensitive_paths import is_sensitive_path
from .api import auth, admin


@asynccontextmanager
async def lifespan(app: FastAPI):
    Path(settings.DATABASE_PATH).parent.mkdir(parents=True, exist_ok=True)
    ensure_storage()
    init_db()
    print(f"[Suixingdang Admin] 管理后台启动")
    print(f"[Suixingdang Admin] 数据库: {settings.DATABASE_PATH}")
    yield


app = FastAPI(
    title="随行档 Admin", version=__version__, lifespan=lifespan,
    docs_url="/docs" if settings.ENABLE_API_DOCS else None,
    redoc_url="/redoc" if settings.ENABLE_API_DOCS else None,
    openapi_url="/openapi.json" if settings.ENABLE_API_DOCS else None,
)

# 浏览器会话令牌走 HttpOnly Cookie；但前端与 API 同源，CORS 不适用，无需 allow_credentials。
# 来源白名单从 CORS_ORIGINS 派生，避免通配源 + credentials 的非法组合。
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 只挂载认证和管理员路由
app.include_router(auth.router)
app.include_router(admin.router)


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "Suixingdang Admin"}


# 管理员前端
WEB_DIR = Path(__file__).parent / "web"
ADMIN_DIR = WEB_DIR / "admin"

if ADMIN_DIR.exists():
    app.mount("/assets", StaticFiles(directory=WEB_DIR / "assets"), name="assets")

    @app.get("/{full_path:path}")
    def serve_admin(full_path: str):
        if full_path.startswith("api/"):
            return {"detail": "Not Found"}
        if is_sensitive_path(full_path):
            raise HTTPException(status_code=404, detail="Not Found")
        index = ADMIN_DIR / "index.html"
        if index.exists():
            return FileResponse(str(index))
        return {"detail": "Admin frontend not built."}
else:
    @app.get("/")
    def root():
        return {"service": "随行档 Admin", "status": "running"}
