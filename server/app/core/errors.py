"""统一错误契约（/api/v1 使用）。

v1 端点抛 AppError（或子类），由全局 handler 渲染为统一错误体：
    {"code": "TRASH_FILE_NOT_FOUND", "message": "回收站中不存在该文件", "detail": {...}?}

旧 /api/* 端点继续使用 HTTPException（前端依赖 detail 字段），两者并存于过渡期，
handler 同时兼容两种异常，保证 v1 前缀下挂载的旧路由也有结构化错误体。
"""

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse


class AppError(Exception):
    """应用级错误：携带机器可读 code + HTTP 状态 + 人类可读 message。"""

    def __init__(self, code: str, message: str, status: int = 400,
                 detail: dict | None = None, headers: dict | None = None):
        self.code = code
        self.message = message
        self.status = status
        self.detail = detail or {}
        self.headers = headers or {}
        super().__init__(message)


# ---- 常用错误快捷构造（code 约定：域_对象_原因，全大写下划线） ----

def not_found(code: str, message: str, **detail) -> AppError:
    return AppError(code, message, status=404, detail=detail or None)


def conflict(code: str, message: str, headers: dict | None = None, **detail) -> AppError:
    return AppError(code, message, status=409, detail=detail or None, headers=headers)


def forbidden(code: str, message: str, **detail) -> AppError:
    return AppError(code, message, status=403, detail=detail or None)


def too_large(code: str, message: str, **detail) -> AppError:
    return AppError(code, message, status=413, detail=detail or None)


def install_exception_handlers(app: FastAPI):
    """注册全局异常处理：AppError 与 HTTPException 都渲染为统一错误体。"""

    @app.exception_handler(AppError)
    async def _app_error_handler(request: Request, exc: AppError):
        return JSONResponse(
            status_code=exc.status,
            content={"code": exc.code, "message": exc.message, "detail": exc.detail},
            headers=exc.headers,
        )

    @app.exception_handler(HTTPException)
    async def _http_exception_handler(request: Request, exc: HTTPException):
        # 仅对 /api/v1 前缀输出结构化错误体；旧前缀保持原 {"detail": ...} 兼容
        path = request.url.path
        if path.startswith("/api/v1/"):
            return JSONResponse(
                status_code=exc.status_code,
                content={
                    "code": f"HTTP_{exc.status_code}",
                    "message": exc.detail if isinstance(exc.detail, str) else "请求失败",
                    "detail": exc.detail if isinstance(exc.detail, dict) else {},
                },
                headers=getattr(exc, "headers", None) or {},
            )
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": exc.detail},
            headers=getattr(exc, "headers", None) or {},
        )
