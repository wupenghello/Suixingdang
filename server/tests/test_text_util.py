"""plain_excerpt 单测 —— 用 importlib 按文件路径加载，绕开 app 包 __init__ 的重型依赖，
故可用系统 python 直接跑：python -m pytest --noconftest -q server/tests/test_text_util.py"""
import importlib.util
import pathlib

import pytest

_SRC = pathlib.Path(__file__).resolve().parents[1] / "app" / "core" / "text_util.py"
_spec = importlib.util.spec_from_file_location("text_util", _SRC)
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
plain_excerpt = _mod.plain_excerpt


def test_empty():
    assert plain_excerpt("") == ""
    assert plain_excerpt(None) == ""


def test_plain_text_passthrough():
    assert plain_excerpt("今天调研了 FastAPI，发现异步路由很合适。") == "今天调研了 FastAPI，发现异步路由很合适。"


def test_strips_headings_and_lists():
    md = "# 标题\n\n- 第一项\n- 第二项\n\n正文段落在这里。"
    assert plain_excerpt(md) == "标题 第一项 第二项 正文段落在这里。"


def test_strips_inline_emphasis_keeps_words():
    assert plain_excerpt("这是 **加粗** 与 *斜体* 文字") == "这是 加粗 与 斜体 文字"


def test_keeps_link_text_drops_url():
    assert plain_excerpt("参见 [文档](https://example.com/x) 即可") == "参见 文档 即可"


def test_keeps_wikilink_text():
    assert plain_excerpt("见 [[双向链接]] 的说明") == "见 双向链接 的说明"


def test_code_block_removed():
    md = "前文\n```python\nprint('hi')\n```\n后文"
    assert plain_excerpt(md) == "前文 后文"


def test_unclosed_fence_stripped():
    out = plain_excerpt("```python\n" + "x = 1\n" * 2000)
    assert not out.startswith("```")
    assert "```" not in out


def test_collapses_whitespace():
    assert plain_excerpt("  多   空格\n\n和换行  " ) == "多 空格 和换行"


def test_truncates_with_ellipsis():
    long = "字" * 200
    out = plain_excerpt(long, limit=20)
    assert out.endswith("…")
    assert len(out) == 21  # 20 字 + 省略号


def test_limit_respected_short():
    assert plain_excerpt("短", limit=160) == "短"
