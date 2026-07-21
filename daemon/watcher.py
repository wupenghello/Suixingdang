"""守护进程主程序 v2：watchdog 监听 + 单 asyncio 事件循环。

v1→v2 修复：
- 双事件循环（watchdog 循环 + 轮询线程各自 asyncio.run）→ 单循环，
  watchdog 线程事件经 call_soon_threadsafe 桥接进主循环，消除并发竞态
- 事件防抖 0.5s（同文件短时间多次变化合并）
- 轮询全量同步作为兜底（POLL_INTERVAL）
- import threading 移到模块顶部（原在 __main__ 内，被导入调用会 NameError）
"""

import asyncio
import sys
import time
from pathlib import Path

from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

from config import config
from sync import full_sync, sync_single_file, _is_excluded


class SyncHandler(FileSystemEventHandler):
    """watchdog 线程 → asyncio 主循环的事件桥（防抖在消费端做）。"""

    def __init__(self, loop: asyncio.AbstractEventLoop, queue: asyncio.Queue):
        self._loop = loop
        self._queue = queue

    def _push(self, rel: str, action: str):
        self._loop.call_soon_threadsafe(self._queue.put_nowait, (rel, action))

    def on_created(self, event):
        if event.is_directory:
            return
        rel = self._get_rel(event.src_path)
        if rel and not _is_excluded(Path(rel)):
            print(f"  [新增] {rel}")
            self._push(rel, "upload")

    def on_modified(self, event):
        if event.is_directory:
            return
        rel = self._get_rel(event.src_path)
        if rel and not _is_excluded(Path(rel)):
            self._push(rel, "upload")

    def on_deleted(self, event):
        if event.is_directory:
            return
        rel = self._get_rel(event.src_path)
        if rel and not _is_excluded(Path(rel)):
            print(f"  [删除] {rel}")
            self._push(rel, "delete")

    def on_moved(self, event):
        if event.is_directory:
            return
        old_rel = self._get_rel(event.src_path)
        new_rel = self._get_rel(event.dest_path)
        if old_rel:
            self._push(old_rel, "delete")
        if new_rel and not _is_excluded(Path(new_rel)):
            self._push(new_rel, "upload")

    def _get_rel(self, abs_path: str) -> str:
        try:
            return str(Path(abs_path).relative_to(config.WATCH_DIR))
        except ValueError:
            return ""


async def _consumer(queue: asyncio.Queue, debounce: float = 0.5):
    """防抖消费：0.5s 窗口内同文件多次事件合并为最后一次动作。"""
    pending: dict[str, tuple[float, str]] = {}
    while True:
        try:
            rel, action = await asyncio.wait_for(queue.get(), timeout=1.0)
            pending[rel] = (time.time(), action)
        except asyncio.TimeoutError:
            pass
        now = time.time()
        due = [r for r, (ts, _a) in pending.items() if now - ts >= debounce]
        for rel in due:
            _ts, action = pending.pop(rel)
            try:
                await sync_single_file(rel, action)
            except Exception as e:
                print(f"  [同步错误] {rel}: {e}")


async def _poll_loop():
    """定时全量同步兜底（含重试队列处理）。"""
    while True:
        await asyncio.sleep(config.POLL_INTERVAL)
        try:
            await full_sync()
        except Exception as e:
            print(f"  [全量同步错误] {e}")


async def _amain():
    print("=" * 50)
    print("随行档 - 家里守护进程 v2")
    print(f"  服务器: {config.SERVER_URL}")
    print(f"  监控目录: {config.WATCH_DIR}")
    print(f"  同步模式: {config.SYNC_MODE}")
    print(f"  轮询间隔: {config.POLL_INTERVAL}s")
    print(f"  状态库: {config.STATE_DB}")
    print("=" * 50)

    print("\n[启动] 执行初始全量同步...")
    try:
        await full_sync()
    except Exception as e:
        print(f"  初始同步失败（将稍后重试）: {e}")

    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()
    handler = SyncHandler(loop, queue)

    observer = Observer()
    observer.schedule(handler, config.WATCH_DIR, recursive=True)
    observer.start()
    print(f"\n[监听中] 正在监控 {config.WATCH_DIR}")

    try:
        await asyncio.gather(_consumer(queue), _poll_loop())
    except (KeyboardInterrupt, asyncio.CancelledError):
        print("\n[停止] 正在关闭...")
    finally:
        observer.stop()
        observer.join()
    print("[已停止]")


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

    try:
        asyncio.run(_amain())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
