"""守护进程主程序：watchdog 监听文件夹 + 定时全量同步。"""

import asyncio
import threading
import time
import signal
import sys
from pathlib import Path

from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

from config import config
from sync import full_sync, sync_single_file, _is_excluded


class SyncHandler(FileSystemEventHandler):
    """文件变化事件处理器。"""

    def __init__(self):
        self.debounce = {}  # 防抖：同一文件短时间内多次变化只处理一次
        self.loop = asyncio.new_event_loop()

    def _schedule(self, rel_path: str, action: str):
        """防抖调度：500ms 后执行。"""
        now = time.time()
        self.debounce[rel_path] = (now, action)
        # 在独立的线程中运行异步同步
        asyncio.run_coroutine_threadsafe(
            self._debounced_sync(rel_path), self.loop
        )

    async def _debounced_sync(self, rel_path: str):
        await asyncio.sleep(0.5)
        entry = self.debounce.get(rel_path)
        if entry:
            _, action = entry
            del self.debounce[rel_path]
            try:
                await sync_single_file(rel_path, action)
            except Exception as e:
                print(f"  [同步错误] {rel_path}: {e}")

    def on_created(self, event):
        if event.is_directory:
            return
        rel = self._get_rel(event.src_path)
        if rel and not _is_excluded(Path(rel)):
            print(f"  [新增] {rel}")
            self._schedule(rel, "upload")

    def on_modified(self, event):
        if event.is_directory:
            return
        rel = self._get_rel(event.src_path)
        if rel and not _is_excluded(Path(rel)):
            self._schedule(rel, "upload")

    def on_deleted(self, event):
        if event.is_directory:
            return
        rel = self._get_rel(event.src_path)
        if rel and not _is_excluded(Path(rel)):
            print(f"  [删除] {rel}")
            self._schedule(rel, "delete")

    def on_moved(self, event):
        if event.is_directory:
            return
        old_rel = self._get_rel(event.src_path)
        new_rel = self._get_rel(event.dest_path)
        if old_rel:
            self._schedule(old_rel, "delete")
        if new_rel and not _is_excluded(Path(new_rel)):
            self._schedule(new_rel, "upload")

    def _get_rel(self, abs_path: str) -> str:
        try:
            return str(Path(abs_path).relative_to(config.WATCH_DIR))
        except ValueError:
            return ""


async def poll_loop():
    """定时全量同步，作为 watchdog 的补充。"""
    while True:
        await asyncio.sleep(config.POLL_INTERVAL)
        try:
            await full_sync()
        except Exception as e:
            print(f"  [全量同步错误] {e}")


def main():
    if not config.TOKEN:
        print("=" * 50)
        print("错误: 未设置 DAEMON_TOKEN")
        print("请在 Web 设置页面创建设备令牌，")
        print("然后设置环境变量 DAEMON_TOKEN 或写入 .env")
        print("=" * 50)
        sys.exit(1)

    if config.SERVER_URL.startswith("http://") and not config.ALLOW_HTTP:
        print("=" * 50)
        print("错误: SERVER_URL 使用明文 http，设备令牌将明文传输。")
        print("请改用 https；如确需在可信内网使用 http，显式设置 ALLOW_HTTP=1。")
        print("=" * 50)
        sys.exit(1)

    print("=" * 50)
    print("随行档 - 家里守护进程")
    print(f"  服务器: {config.SERVER_URL}")
    print(f"  监控目录: {config.WATCH_DIR}")
    print(f"  同步模式: {config.SYNC_MODE}")
    print(f"  轮询间隔: {config.POLL_INTERVAL}s")
    print("=" * 50)

    # 启动时先做一次全量同步
    print("\n[启动] 执行初始全量同步...")
    asyncio.run(full_sync())

    # 启动 watchdog 监听
    observer = Observer()
    handler = SyncHandler()
    observer.schedule(handler, config.WATCH_DIR, recursive=True)
    observer.start()
    print(f"\n[监听中] 正在监控 {config.WATCH_DIR}")

    # 启动定时全量同步
    poll_thread = threading.Thread(
        target=lambda: asyncio.run(poll_loop()), daemon=True
    )
    poll_thread.start()

    # 运行 asyncio 事件循环（处理 watchdog 触发的同步）
    try:
        handler.loop.run_forever()
    except KeyboardInterrupt:
        print("\n[停止] 正在关闭...")
        observer.stop()
    observer.join()
    print("[已停止]")


if __name__ == "__main__":
    main()
