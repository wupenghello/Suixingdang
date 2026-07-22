"""系统设置存储与策略缓存（从 db/models.py 迁出）。

- get_setting / set_setting：SystemSetting 键值读写
- get_cached_setting：带 30s TTL 的读缓存（set_setting 写入即失效）
- 回收站保留策略：DEFAULT_TRASH_RETENTION_DAYS / get_trash_retention_days（钳制 1..90）
"""

import time

from ..db.models import SystemSetting

# ---- 策略缓存（带 TTL，避免每请求查 SystemSetting）----
_setting_cache = {}
_SETTING_CACHE_TTL = 30


def get_setting(db, key, default=""):
    s = db.query(SystemSetting).filter_by(key=key).first()
    return s.value if s else default


def set_setting(db, key, value):
    from datetime import datetime
    s = db.query(SystemSetting).filter_by(key=key).first()
    if s:
        s.value = str(value)
        s.updated_at = datetime.utcnow()
    else:
        db.add(SystemSetting(key=key, value=str(value)))
    db.commit()
    _setting_cache.pop(key, None)  # 使缓存失效，使运行时调整立即生效


def get_cached_setting(db, key, default=""):
    """读 SystemSetting（带 30s 缓存）；set_setting 写入时自动失效。"""
    now = time.time()
    hit = _setting_cache.get(key)
    if hit and now - hit[1] < _SETTING_CACHE_TTL:
        return hit[0]
    val = get_setting(db, key, default)
    _setting_cache[key] = (val, now)
    return val


# ---- 回收站保留策略 ----
DEFAULT_TRASH_RETENTION_DAYS = 7
DEFAULT_TRASH_LOCK_LIMIT = 200     # 单用户锁存文件数量上限（防借锁存规避自动清理）


def get_trash_retention_days(db) -> int:
    """回收站保留天数：从 system_settings 读，默认 7，钳制 1..90。"""
    raw = get_cached_setting(db, "trash_retention_days", str(DEFAULT_TRASH_RETENTION_DAYS))
    try:
        v = int(raw)
    except (ValueError, TypeError):
        return DEFAULT_TRASH_RETENTION_DAYS
    return max(1, min(90, v))
