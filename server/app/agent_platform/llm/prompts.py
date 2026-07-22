"""提示词版本化注册表（消灭内联字符串 + eval 人肉同步）。

提示词文件存于 llm/prompts/，命名 <name>.v<N>.md；eval 与运行时引用同一份文件，
promptfoo 数据集直接读取同一路径（见 promptfooconfig.yaml），杜绝漂移。
"""

import logging
from pathlib import Path

logger = logging.getLogger(__name__)

_PROMPTS_DIR = Path(__file__).parent / "prompts"
_cache: dict[str, tuple[str, str]] = {}  # name -> (version, text)


def get_prompt(name: str, version: int | None = None) -> tuple[str, str]:
    """返回 (text, version)。未指定版本时取最高版本。"""
    key = f"{name}@{version or 'latest'}"
    if key in _cache:
        return _cache[key]

    candidates = sorted(_PROMPTS_DIR.glob(f"{name}.v*.md"))
    if not candidates:
        raise FileNotFoundError(f"提示词不存在: {name}（目录 {_PROMPTS_DIR}）")
    if version is not None:
        candidates = [p for p in candidates if p.stem.endswith(f".v{version}")]
        if not candidates:
            raise FileNotFoundError(f"提示词版本不存在: {name}.v{version}")
    path = candidates[-1]
    v = int(path.stem.rsplit(".v", 1)[-1])
    text = path.read_text(encoding="utf-8").strip()
    _cache[key] = (text, f"v{v}")
    return text, f"v{v}"


def clear_cache():
    _cache.clear()
