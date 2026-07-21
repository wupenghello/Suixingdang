"""文本摘录纯函数（无框架依赖，便于 --noconftest 单测）。

笔记卡片摘要回退链：AI 摘要 → 正文节选(本函数) → 不显示。
本函数把 Markdown 正文压成一段纯文本摘录，剥离格式符号但保留链接/维基链接的文字，
避免卡片「开天窗」（没做过 AI 整理的笔记摘要空白）。仅做展示用截断，不改原文。
"""
from __future__ import annotations

import re

# 代码块 / 行内代码：整段替换为空格（代码不该进自然语言摘录）
_MD_FENCE = re.compile(r"```[\s\S]*?```|`[^`\n]*`")
# 未闭合代码围栏：成对围栏已被上面整段移除，此处只兜底孤立的 ```lang 起始行/散落 ``` 标记
_MD_LEFTOVER_FENCE = re.compile(r"```[^\n]*")
# 块级标记：标题 #、引用 >、列表 -/*/+/1.、任务 [ ]、表格行、水平线
_MD_BLOCK = re.compile(
    r"(?m)^\s{0,3}(?:#{1,6}\s|>\s?|\|.+\||-{3,}|\*{3,}|_{3,})"
    r"|^\s*[-*+]\s+(?:\[[ xX]\]\s+)?"
    r"|^\s*\d+\.\s+"
)
# 行内标记：链接/图片(保留文字)、强调 * _ ~~、维基链接 [[ ]]
_MD_INLINE = re.compile(r"(!?\[)([^\]]*)(\]\([^)]*\))|(\*{1,3}|_{1,3}|~~)|(\[\[)|(\]\])")
_WS = re.compile(r"\s+")


def plain_excerpt(text: str, limit: int = 160) -> str:
    """把 Markdown 文本压成 ≤ limit 字的纯文本摘录；空输入返回空串。"""
    if not text:
        return ""
    s = _MD_FENCE.sub(" ", text)
    s = _MD_LEFTOVER_FENCE.sub(" ", s)
    s = _MD_BLOCK.sub(" ", s)
    s = _MD_INLINE.sub(lambda m: (m.group(2) if m.group(2) is not None else " "), s)
    s = s.replace(" ", " ")  # nbsp
    s = _WS.sub(" ", s).strip()
    if len(s) > limit:
        s = s[:limit].rstrip() + "…"
    return s
