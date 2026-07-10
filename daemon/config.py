"""守护进程配置。"""

import os
from pathlib import Path


class Config:
    # 服务器地址
    SERVER_URL = os.getenv("SERVER_URL", "https://your-domain.com")
    # JWT 令牌（从 Web 设置页创建）
    TOKEN = os.getenv("DAEMON_TOKEN", "")
    # 要同步的本地目录
    WATCH_DIR = os.getenv("WATCH_DIR", str(Path.home() / "suixingdang-sync"))
    # 排除的文件名/目录模式
    EXCLUDE_PATTERNS = [
        ".DS_Store", ".git", "__pycache__", "node_modules",
        ".venv", "venv", ".idea", ".vscode", "dist", "build",
    ]
    # 同步方向: two_way | upload_only
    SYNC_MODE = os.getenv("SYNC_MODE", "two_way")
    # 轮询间隔（秒），用于全量比对
    POLL_INTERVAL = int(os.getenv("POLL_INTERVAL", "300"))
    # 索引数据库（记录本地文件状态）
    STATE_DB = os.getenv("STATE_DB", str(Path.home() / ".suixingdang" / "state.json"))

    @property
    def auth_headers(self):
        return {"Authorization": f"Bearer {self.TOKEN}"}


config = Config()

# 确保监控目录存在
Path(config.WATCH_DIR).mkdir(parents=True, exist_ok=True)
Path(config.STATE_DB).parent.mkdir(parents=True, exist_ok=True)
