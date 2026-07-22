"""守护进程配置。"""

import os
from pathlib import Path


class Config:
    # 服务器地址（强制 https；明文 http 需显式 ALLOW_HTTP=1，避免令牌明文传输）
    SERVER_URL = os.getenv("SERVER_URL", "https://your-domain.com")
    ALLOW_HTTP = os.getenv("ALLOW_HTTP", "") == "1"
    # 设备访问令牌（在 Web 设置页或管理后台创建，可吊销）
    TOKEN = os.getenv("DAEMON_TOKEN", "")
    # 要同步的本地目录。
    # 规范化为真实路径：macOS 上 /tmp → /private/tmp 等符号链接场景下，
    # watchdog(FSEvents) 回传解析后路径，若此处保留链接路径，relative_to 会
    # 全部失败 → 事件静默丢弃、删除不传播。expanduser 兼容 ~ 写法。
    WATCH_DIR = str(
        Path(os.getenv("WATCH_DIR", str(Path.home() / "suixingdang-sync")))
        .expanduser().resolve()
    )
    # 排除的文件名/目录模式
    EXCLUDE_PATTERNS = [
        ".DS_Store", ".git", "__pycache__", "node_modules",
        ".venv", "venv", ".idea", ".vscode", "dist", "build",
    ]
    # 同步方向: two_way | upload_only
    SYNC_MODE = os.getenv("SYNC_MODE", "two_way")
    # 轮询间隔（秒），用于全量比对
    POLL_INTERVAL = int(os.getenv("POLL_INTERVAL", "300"))
    # 索引数据库（v2：SQLite 状态库，记录本地文件状态与待办重试操作）
    STATE_DB = os.getenv("STATE_DB", str(Path.home() / ".suixingdang" / "state.sqlite"))
    # 熔断：远端已跟踪文件消失比例超过该阈值时中止本轮同步（防 manifest 异常导致全量误删）
    DELETE_ABORT_THRESHOLD = float(os.getenv("DELETE_ABORT_THRESHOLD", "0.5"))
    # FORCE_SYNC=1 时绕过熔断（确认远端确实清空时使用）
    FORCE_SYNC = os.getenv("FORCE_SYNC", "") == "1"

    @property
    def auth_headers(self):
        return {"Authorization": f"Bearer {self.TOKEN}"}


config = Config()

# 确保监控目录存在
Path(config.WATCH_DIR).mkdir(parents=True, exist_ok=True)
Path(config.STATE_DB).parent.mkdir(parents=True, exist_ok=True)
