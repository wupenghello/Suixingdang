"""流式脱敏器：token 级流式输出与 PII 脱敏的兼容层。

PII 模式（身份证/手机号/密钥）可能跨多个 token，逐 token 脱敏会漏。
策略：保留尾部 holdback 窗口（默认 48 字符）不吐出，新文本到达时对
"已确认安全的前缀"脱敏后释放；流结束时对剩余部分整体脱敏释放。
"""

from ...core import mask as M


class MaskingStream:
    def __init__(self, user_id: str, holdback: int = 48):
        self._ms = M.MaskSession(user_id)
        self._buf = ""
        self._holdback = holdback

    def feed(self, text: str) -> str:
        """喂入增量文本，返回可安全展示的脱敏前缀（可能为空）。"""
        if not text:
            return ""
        self._buf += text
        if len(self._buf) <= self._holdback:
            return ""
        safe, self._buf = self._buf[:-self._holdback], self._buf[-self._holdback:]
        return self._ms.mask_text(safe)

    def finish(self) -> str:
        """流结束：对缓冲区整体脱敏后释放。"""
        out = self._ms.mask_text(self._buf) if self._buf else ""
        self._buf = ""
        self._ms.flush()
        return out

    def mask_full(self, text: str) -> str:
        """对完整文本脱敏（done 事件的规范文本）。"""
        return self._ms.mask_text(text)
