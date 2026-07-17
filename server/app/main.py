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
from .api import auth, files, chat, sync, admin, transfer


@asynccontextmanager
async def lifespan(app: FastAPI):
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
    """启动时清理过期的回收站文件（一次性兜底，避免长期未触发清理导致磁盘堆积）。"""
    try:
        from .db.models import SessionLocal, get_trash_retention_days, File as FileModel
        from .core import storage, indexer
        from datetime import datetime, timedelta
        db = SessionLocal()
        try:
            retention_days = get_trash_retention_days(db)
            cutoff = datetime.utcnow() - timedelta(days=retention_days)
            expired = db.query(FileModel).filter(
                FileModel.deleted_at.isnot(None), FileModel.deleted_at <= cutoff,
                FileModel.locked_at.is_(None),
            ).all()
            purged = 0
            for f in expired:
                storage.delete_file(f.owner_id, f.path)
                try:
                    indexer.remove_from_index(f.owner_id, f.path)
                except Exception:
                    pass
                db.delete(f)
                purged += 1
            if purged:
                db.commit()
                print(f"[Suixingdang] 启动清理回收站过期文件 {purged} 个（保留期 {retention_days} 天）")
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

app.include_router(auth.router)
app.include_router(files.router)
app.include_router(chat.router)
app.include_router(sync.router)
# admin 路由与前端（/admin）也挂载于此实例，生产环境统一入口
app.include_router(admin.router)
app.include_router(transfer.router)


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "Suixingdang", "version": "2.0.0"}


# 用户端前端
WEB_DIR = Path(__file__).parent / "web"

if WEB_DIR.exists():
    app.mount("/assets", StaticFiles(directory=WEB_DIR / "assets"), name="assets")

    @app.get("/{full_path:path}")
    def serve_spa(full_path: str):
        if full_path.startswith("api/"):
            return {"detail": "Not Found"}
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
