"""Server-side sensitive data masking engine.

Masks PII (ID cards, phone numbers, API keys, emails, bank cards) and
sensitive file names in AI assistant responses.  Real values never reach
the browser; the masked display embeds a deterministic token (mask_id)
that the frontend can use to request unmasking via an authenticated API call.

Token format embedded in text:  [[M:<16-hex>:<display>]]
The format survives markdown rendering and works inside code blocks because
it is plain text.  The frontend scans rendered DOM text nodes, replaces
tokens with interactive <span class="sx-mask"> elements, and calls
POST /api/chat/unmask to reveal the real value on demand.
"""

import hashlib
import json
import re
from typing import Any, Optional

from ..config import settings

# --------------------------------------------------------------------------- #
#  PII patterns (reused / extended from guard.py)
# --------------------------------------------------------------------------- #

_PII_PATTERNS: list[tuple[re.Pattern, str]] = [
    # Chinese ID card: 18 digits, last may be X.
    # Use lookbehind/lookahead instead of \b because Python 3 treats CJK
    # characters as word characters, so \b won't fire between a Chinese
    # character and a digit (e.g. "号是110101...").
    (re.compile(r"(?<!\d)\d{17}[\dXx](?!\d)"), "id_card"),
    # Chinese phone: 11 digits starting 1[3-9]
    (re.compile(r"(?<!\d)1[3-9]\d{9}(?!\d)"), "phone"),
    # Email
    (re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}"), "email"),
    # AWS Access Key
    (re.compile(r"AKIA[0-9A-Z]{16}"), "aws_key"),
    # API Key (sk- format)
    (re.compile(r"sk-[a-zA-Z0-9]{20,}"), "api_key"),
    # Private key block
    (re.compile(
        r"-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----"
        r"[\s\S]*?"
        r"-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----"
    ), "private_key"),
    # GitHub tokens
    (re.compile(r"gh[pousr]_[a-zA-Z0-9]{36}"), "github_token"),
    # GitLab token
    (re.compile(r"glpat-[a-zA-Z0-9_-]{20}"), "gitlab_token"),
    # Database connection strings with credentials
    (re.compile(
        r"(?:mysql|postgres|mongodb(?:\+srv)?|redis)://[^\s:]+:[^\s@]+@"
    ), "db_conn"),
    # Bank card: 16-19 digit sequence (checked after ID card to avoid overlap)
    (re.compile(r"(?<!\d)\d{16,19}(?!\d)"), "bank_card"),
]

# Sensitive filename keywords (from guard.py PERSONAL_PRIVACY + COMPANY_CONFIDENTIAL)
SENSITIVE_FILE_KEYWORDS = [
    "身份证", "护照", "银行流水", "银行卡号", "工资条", "工资单",
    "体检报告", "病历", "社保", "公积金", "纳税记录", "征信",
    "简历", "resume",
    "内部机密", "商业秘密", "客户名单", "客户信息", "合同金额",
    "薪酬", "薪资", "保密协议", "竞业协议", "源代码",
]

_FILE_EXT_RE = re.compile(r"(\.[a-zA-Z0-9]{1,5})$")

# Token regex (used by frontend; mirrored here for testing)
TOKEN_RE = re.compile(r"\[\[M:([a-f0-9]{16}):([^\]]*)\]\]")


# --------------------------------------------------------------------------- #
#  Mask-id generation (deterministic, keyed to user + server secret)
# --------------------------------------------------------------------------- #

def _mask_id_for(user_id: str, real_value: str) -> str:
    """Deterministic 16-hex mask_id from server secret + user_id + value."""
    secret = settings.jwt_secret
    raw = f"{secret}:{user_id}:{real_value}"
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


# --------------------------------------------------------------------------- #
#  Display helpers
# --------------------------------------------------------------------------- #

def _mask_display(value: str) -> str:
    """Show first <=5 chars, rest as asterisks (capped at 6)."""
    if not value:
        return "****"
    show = min(5, max(1, len(value) - 1))
    dots = min(len(value) - show, 6)
    return value[:show] + "*" * dots


def _mask_filename(filename: str) -> str:
    """Mask a filename or filepath, preserving the extension and directory."""
    # Split directory / filename
    if "/" in filename:
        dir_part, fname = filename.rsplit("/", 1)
        dir_part += "/"
    else:
        dir_part, fname = "", filename

    # Split name / extension
    m = _FILE_EXT_RE.search(fname)
    if m:
        ext = m.group(1)
        name = fname[: m.start()]
    else:
        ext, name = "", fname

    if len(name) <= 4:
        masked = "****"
    else:
        masked = name[:3] + "****"
    return dir_part + masked + ext


def is_sensitive_filename(filename: str) -> bool:
    """Check if a filename contains sensitive keywords."""
    lower = filename.lower()
    return any(kw.lower() in lower for kw in SENSITIVE_FILE_KEYWORDS)


def _has_pii(text: str) -> bool:
    """Quick check if text contains any PII pattern."""
    if not text:
        return False
    return any(p.search(text) for p, _ in _PII_PATTERNS)


# --------------------------------------------------------------------------- #
#  Token helpers
# --------------------------------------------------------------------------- #

def _make_token(mask_id: str, display: str) -> str:
    return f"[[M:{mask_id}:{display}]]"


# --------------------------------------------------------------------------- #
#  MaskSession - collects mappings during one masking pass
# --------------------------------------------------------------------------- #

class MaskSession:
    """Accumulates mask mappings during a single chat-response masking pass.

    Usage::

        ms = MaskSession(user_id)
        masked_tc = ms.mask_tool_calls(tool_call_log)
        masked_reply = ms.mask_text(reply, extra_values=ms.sensitive_names)
        ms.flush()               # persist to DB
    """

    def __init__(self, user_id: str):
        self.user_id = user_id
        self.mappings: dict[str, str] = {}          # mask_id -> real_value
        self.sensitive_names: set[str] = set()       # filenames collected from tool results

    # -- low-level --------------------------------------------------------

    def _mask_value(self, real_value: str, display: str) -> str:
        mid = _mask_id_for(self.user_id, real_value)
        self.mappings[mid] = real_value
        return _make_token(mid, display)

    def _mask_plain(self, real_value: str) -> str:
        return self._mask_value(real_value, _mask_display(real_value))

    def _mask_file(self, real_value: str) -> str:
        return self._mask_value(real_value, _mask_filename(real_value))

    # -- text masking -----------------------------------------------------

    def mask_text(self, text: str, extra_values: Optional[set] = None) -> str:
        """Mask PII patterns and extra values (sensitive filenames) in text."""
        if not text:
            return text

        replacements: list[tuple[int, int, str]] = []  # (start, end, token)

        # 1. PII regex patterns
        for pattern, _ptype in _PII_PATTERNS:
            for m in pattern.finditer(text):
                real_value = m.group()
                token = self._mask_plain(real_value)
                replacements.append((m.start(), m.end(), token))

        # 2. Extra values (sensitive filenames from tool results)
        if extra_values:
            for val in sorted(extra_values, key=len, reverse=True):
                if not val or len(val) < 3:
                    continue
                start = 0
                while True:
                    idx = text.find(val, start)
                    if idx == -1:
                        break
                    # skip if overlaps an existing replacement
                    overlap = any(
                        s <= idx < e or s < idx + len(val) <= e
                        for s, e, _ in replacements
                    )
                    if not overlap:
                        display = _mask_filename(val) if _FILE_EXT_RE.search(val) else _mask_display(val)
                        token = self._mask_value(val, display)
                        replacements.append((idx, idx + len(val), token))
                    start = idx + 1

        if not replacements:
            return text

        # Sort, de-overlap, build output
        replacements.sort(key=lambda x: x[0])
        filtered: list[tuple[int, int, str]] = []
        last_end = 0
        for start, end, token in replacements:
            if start >= last_end:
                filtered.append((start, end, token))
                last_end = end

        result = text
        for start, end, token in reversed(filtered):
            result = result[:start] + token + result[end:]
        return result

    # -- tool call masking ------------------------------------------------

    def mask_tool_calls(self, tool_calls: list[dict]) -> list[dict]:
        """Mask tool call log entries: strip user_id, mask args and results."""
        if not tool_calls:
            return tool_calls

        masked: list[dict] = []
        for tc in tool_calls:
            tc_copy = dict(tc)

            # --- args: strip user_id ---
            args = tc_copy.get("args", {})
            if isinstance(args, str):
                try:
                    args = json.loads(args)
                except Exception:
                    args = {}
            if isinstance(args, dict):
                args = {k: v for k, v in args.items() if k != "user_id"}
                # Mask sensitive file paths in args
                for key in ("file_path", "directory", "path"):
                    val = args.get(key)
                    if val and isinstance(val, str) and is_sensitive_filename(val):
                        self.sensitive_names.add(val)
                        args[key] = self._mask_file(val)
            tc_copy["args"] = args

            # --- result: structured masking ---
            result = tc_copy.get("result")
            if result:
                tc_copy["result"] = self._mask_result(
                    tc_copy.get("tool", ""), result
                )
            masked.append(tc_copy)
        return masked

    def _mask_result(self, tool_name: str, result: str) -> str:
        """Mask sensitive data in a tool result string (JSON or plain text)."""
        if not result:
            return result
        try:
            data = json.loads(result)
        except (json.JSONDecodeError, TypeError):
            # Not JSON - mask as plain text
            return self.mask_text(result)

        self._mask_json_structured(data)
        return json.dumps(data, ensure_ascii=False)

    def _mask_json_structured(self, data: Any) -> None:
        """Recursively mask sensitive fields and PII in a parsed JSON tree."""
        if isinstance(data, dict):
            for key in list(data.keys()):
                val = data[key]
                if isinstance(val, str):
                    self._mask_json_field(data, key, val)
                elif isinstance(val, (dict, list)):
                    self._mask_json_structured(val)
        elif isinstance(data, list):
            for i, item in enumerate(data):
                if isinstance(item, (dict, list)):
                    self._mask_json_structured(item)
                elif isinstance(item, str):
                    if is_sensitive_filename(item):
                        self.sensitive_names.add(item)
                        data[i] = self._mask_file(item)
                    elif _has_pii(item):
                        data[i] = self.mask_text(item)

    def _mask_json_field(self, data: dict, key: str, val: str) -> None:
        """Mask a single string field in a JSON dict based on key name and value."""
        if not val:
            return

        # File path / name fields: mask if sensitive
        if key in ("path", "file_path", "name", "file", "file_name", "sources"):
            if is_sensitive_filename(val):
                self.sensitive_names.add(val)
                data[key] = self._mask_file(val)
            elif _has_pii(val):
                data[key] = self.mask_text(val)
            return

        # Free-text content fields: PII scan + check for collected sensitive names
        if key in ("content", "snippet", "summary", "answer",
                    "reason", "detail", "guard_reason"):
            if _has_pii(val) or self._contains_extra(val):
                data[key] = self.mask_text(val, self.sensitive_names)
            return

        # Generic: PII scan on any other string
        if _has_pii(val):
            data[key] = self.mask_text(val)

    def _contains_extra(self, text: str) -> bool:
        """Check if text contains any collected sensitive filename."""
        return any(name and name in text for name in self.sensitive_names)

    # -- persistence ------------------------------------------------------

    def flush(self) -> None:
        """Persist all collected mappings to DB (idempotent upsert)."""
        if not self.mappings:
            return
        from ..db.models import SessionLocal, MaskMapping
        db = SessionLocal()
        try:
            for mid, real_value in self.mappings.items():
                existing = db.query(MaskMapping).filter_by(mask_id=mid).first()
                if not existing:
                    db.add(MaskMapping(
                        mask_id=mid,
                        user_id=self.user_id,
                        real_value=real_value,
                    ))
            db.commit()
        finally:
            db.close()


# --------------------------------------------------------------------------- #
#  Unmask
# --------------------------------------------------------------------------- #

def unmask(mask_id: str, user_id: str) -> Optional[str]:
    """Look up a real value by mask_id, verifying user ownership."""
    from ..db.models import SessionLocal, MaskMapping
    db = SessionLocal()
    try:
        row = db.query(MaskMapping).filter_by(
            mask_id=mask_id, user_id=user_id
        ).first()
        return row.real_value if row else None
    finally:
        db.close()


# --------------------------------------------------------------------------- #
#  Convenience: mask a complete chat result
# --------------------------------------------------------------------------- #

def mask_result(reply: str, tool_calls: list[dict], user_id: str) -> tuple[str, list[dict]]:
    """Mask a complete chat result (reply + tool_calls) in one pass.

    Returns (masked_reply, masked_tool_calls).  Mappings are persisted to DB.
    """
    ms = MaskSession(user_id)
    masked_tc = ms.mask_tool_calls(tool_calls)
    masked_reply = ms.mask_text(reply, extra_values=ms.sensitive_names)
    ms.flush()
    return masked_reply, masked_tc


def mask_history_messages(messages: list[dict], user_id: str) -> list[dict]:
    """Mask a list of history messages for frontend display.

    Both assistant and user messages are masked: user messages may contain
    pasted sensitive data that should not be visible when a colleague glances
    at the screen while browsing old conversations.
    """
    ms = MaskSession(user_id)
    result = []
    for msg in messages:
        msg_copy = dict(msg)
        role = msg_copy.get("role")
        if role == "assistant":
            tc = msg_copy.get("tool_calls", [])
            if tc:
                msg_copy["tool_calls"] = ms.mask_tool_calls(tc)
            content = msg_copy.get("content", "")
            msg_copy["content"] = ms.mask_text(content, extra_values=ms.sensitive_names)
        elif role == "user":
            content = msg_copy.get("content", "")
            msg_copy["content"] = ms.mask_text(content)
        result.append(msg_copy)
    ms.flush()
    return result
