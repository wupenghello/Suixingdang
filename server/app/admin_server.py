"""管理员独立服务入口 - 运行在独立端口上，与用户端隔离。"""

from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from .config import settings
from .db.models import init_db
from .core.storage import ensure_storage
from .api import auth, admin


@asynccontextmanager
async def lifespan(app: FastAPI):
    Path(settings.DATABASE_PATH).parent.mkdir(parents=True, exist_ok=True)
    ensure_storage()
    init_db()
    print(f"[Suixingdang Admin] 管理后台启动")
    print(f"[Suixingdang Admin] 数据库: {settings.DATABASE_PATH}")
    yield


app = FastAPI(title="随行档 Admin", version="2.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"],
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
        index = ADMIN_DIR / "index.html"
        if index.exists():
            return FileResponse(str(index))
        return {"detail": "Admin frontend not built."}
else:
    @app.get("/")
    def root():
        return {"service": "随行档 Admin", "status": "running"}
