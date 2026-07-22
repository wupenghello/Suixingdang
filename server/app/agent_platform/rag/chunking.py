"""RAG 文本分块：把长文本切成适合嵌入检索的重叠小块（纯函数，无外部依赖）。

切分策略：
1. 先按空行与 markdown 标题行切成语义段落；
2. 贪心合并相邻段落直到接近 max_chars；
3. 单段落超长时按句号/换行降级再切，仍超则按字符硬切；
4. 相邻块之间从前一块尾部取 overlap 字符拼到下一块头部，避免边界处上下文割裂；
5. 确定性：相同输入必产生完全相同的输出。
"""

import re

# 返回块数上限：防超大文件产生过多向量（超出直接截断，不加任何标记）
MAX_CHUNKS = 200

# 空行（段落边界）
_BLANK_LINE_RE = re.compile(r"\n\s*\n")
# markdown 标题行（^#{1,6}\s）：作为新语义段的起点
_HEADING_RE = re.compile(r"^#{1,6}\s")
# 句末标点/换行：超长段落降级再切的边界
_SENTENCE_END_RE = re.compile(r"(?<=[。．.！!？?；;\n])")


def chunk_text(text: str, max_chars: int = 600, overlap: int = 80) -> list[str]:
    """把文本切成每块 ≤ max_chars 的检索块（规则见模块 docstring）。

    - 空/纯空白输入返回 []；
    - 实际重叠取 min(overlap, max_chars // 2)，且合并时为头部重叠预留空间，
      保证拼上 overlap 后块长仍 ≤ max_chars；
    - 最多返回 MAX_CHUNKS（200）块，超出直接截断。
    """
    if not text or not text.strip():
        return []
    if max_chars < 1:
        max_chars = 1
    eff_overlap = max(0, min(overlap, max_chars // 2))
    # 合并预算：为头部 overlap 预留空间，拼上重叠后总长仍 ≤ max_chars
    limit = max_chars - eff_overlap

    chunks = _greedy_merge(_split_pieces(text, limit), limit)
    return _apply_overlap(chunks, eff_overlap)[:MAX_CHUNKS]


def _split_at_headings(para: str) -> list[str]:
    """在标题行（^#{1,6}\\s）之前切开段落，标题行归属其引领的新段。"""
    segs: list[str] = []
    buf: list[str] = []
    for line in para.split("\n"):
        if _HEADING_RE.match(line) and buf:
            segs.append("\n".join(buf))
            buf = []
        buf.append(line)
    if buf:
        segs.append("\n".join(buf))
    return segs


def _split_pieces(text: str, limit: int) -> list[str]:
    """按空行/标题切语义段；超长段按句号/换行降级再切，仍超则硬切。"""
    pieces: list[str] = []
    for para in _BLANK_LINE_RE.split(text):
        for seg in _split_at_headings(para):
            seg = seg.strip()
            if not seg:
                continue
            if len(seg) <= limit:
                pieces.append(seg)
                continue
            # 超长段：按句末标点/换行再切
            for part in _SENTENCE_END_RE.split(seg):
                part = part.strip()
                if not part:
                    continue
                if len(part) <= limit:
                    pieces.append(part)
                else:
                    # 仍超（如超长无标点句）：按字符硬切
                    pieces.extend(part[i:i + limit] for i in range(0, len(part), limit))
    return pieces


def _greedy_merge(pieces: list[str], limit: int) -> list[str]:
    """贪心合并相邻片段，以换行连接，总长不超过 limit。"""
    chunks: list[str] = []
    buf = ""
    for piece in pieces:
        if not buf:
            buf = piece
        elif len(buf) + 1 + len(piece) <= limit:
            buf = buf + "\n" + piece
        else:
            chunks.append(buf)
            buf = piece
    if buf:
        chunks.append(buf)
    return chunks


def _apply_overlap(chunks: list[str], eff_overlap: int) -> list[str]:
    """从前一块尾部取 eff_overlap 字符拼到下一块头部；下一块头部已含该重叠则跳过。"""
    if eff_overlap <= 0 or len(chunks) <= 1:
        return chunks
    result = [chunks[0]]
    for cur in chunks[1:]:
        tail = result[-1][-eff_overlap:]
        if not cur.startswith(tail):
            cur = tail + cur
        result.append(cur)
    return result
