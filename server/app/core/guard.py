"""Guard 敏感文件检测层。

在文件被同步/上传之前，扫描文件名和内容，
识别可能的敏感文件（凭据、隐私、机密），
返回风险等级和原因，提醒而非硬拦。
"""

import re
from pathlib import Path
from typing import Literal

from . import storage

GuardStatus = Literal["safe", "warning", "blocked"]

# --- 规则定义 ---

# 凭据文件名模式
CREDENTIAL_FILENAMES = {
    ".env", "id_rsa", "id_dsa", "id_ecdsa", "id_ed25519",
    ".npmrc", ".pypirc", ".netrc", ".htpasswd",
    "credentials", "credentials.json",
}
CREDENTIAL_EXTENSIONS = {".pem", ".key", ".p12", ".keystore", ".jks"}

# 正则：常见密钥/凭据
SECRET_PATTERNS = [
    (r"AKIA[0-9A-Z]{16}", "AWS Access Key"),
    (r"sk-[a-zA-Z0-9]{20,}", "API Key (sk- format)"),
    (r"-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----", "Private Key"),
    (r"ghp_[a-zA-Z0-9]{36}", "GitHub Personal Access Token"),
    (r"gho_[a-zA-Z0-9]{36}", "GitHub OAuth Token"),
    (r"glpat-[a-zA-Z0-9_-]{20}", "GitLab Personal Access Token"),
    (r"mysql://[^\s]+:[^\s]+@", "Database connection string (MySQL)"),
    (r"postgres://[^\s]+:[^\s]+@", "Database connection string (PostgreSQL)"),
    (r"mongodb(?:\+srv)?://[^\s]+:[^\s]+@", "Database connection string (MongoDB)"),
    (r"redis://[^\s]+:[^\s]+@", "Database connection string (Redis)"),
]

# 中文敏感关键词（个人隐私方向）
PERSONAL_PRIVACY_KEYWORDS = [
    "身份证", "护照", "银行流水", "银行卡号", "工资条", "工资单",
    "体检报告", "病历", "社保", "公积金", "纳税记录", "征信",
    "resume", "简历",
]

# 中文敏感关键词（公司机密方向）
COMPANY_CONFIDENTIAL_KEYWORDS = [
    "内部机密", "商业秘密", "客户名单", "客户信息", "合同金额",
    "薪酬", "薪资", "保密协议", "竞业协议", "源代码",
    "internal confidential", "proprietary",
]

# 中国身份证号
ID_CARD_RE = re.compile(r"\b\d{17}[\dXx]\b")
# 银行卡号（16-19位连续数字）
BANK_CARD_RE = re.compile(r"\b\d{16,19}\b")
# 手机号
PHONE_RE = re.compile(r"\b1[3-9]\d{9}\b")

MAX_SCAN_BYTES = 500_000  # 只扫前 500KB
MAX_SCAN_CHARS = 500_000  # 办公文档提取后的文本扫描上限

# 办公/文档扩展名：需提取文本后扫描（复用 indexer 的提取逻辑）
OFFICE_EXTENSIONS = {".pdf", ".docx", ".doc", ".xlsx", ".xls", ".pptx", ".ppt"}

TEXT_EXTENSIONS = {
    ".txt", ".md", ".rst", ".csv", ".json", ".yaml", ".yml",
    ".xml", ".html", ".htm", ".js", ".ts", ".py", ".java",
    ".go", ".rs", ".c", ".cpp", ".h", ".sh", ".sql", ".env",
    ".ini", ".cfg", ".conf", ".toml", ".properties",
    ".log", ".tex", ".tsv",
}


def check_filename(rel_path: str) -> tuple[GuardStatus, str]:
    """检查文件名是否匹配敏感模式。"""
    p = Path(rel_path)
    name = p.name.lower()
    suffix = p.suffix.lower()

    if name in CREDENTIAL_FILENAMES:
        return "blocked", f"文件名匹配凭据文件: {name}"

    if suffix in CREDENTIAL_EXTENSIONS:
        return "blocked", f"文件扩展名可能是密钥文件: {suffix}"

    # .env.local, .env.production 等
    if name.startswith(".env"):
        return "blocked", "环境变量文件，可能包含敏感配置"

    return "safe", ""


def check_content(user_id: str, rel_path: str, direction: str = "") -> tuple[GuardStatus, str]:
    """扫描文件内容，识别密钥、隐私信息等。

    direction 方向感知：
      - "home_to_server" / "upload"：往服务器带，重点查公司机密外泄
      - "server_to_home"：往家里带，重点查公司机密
      - "server_to_company"：往公司带，重点查个人隐私（身份证、简历等）
      - ""（未知方向）：两类关键词都查
    """
    p = Path(rel_path)
    suffix = p.suffix.lower()

    full_path = storage._user_dir(user_id) / rel_path
    if not full_path.exists():
        return "safe", ""

    # 取文本：纯文本类读原始字节；办公文档提取后取文本；其余类型不扫
    if suffix in TEXT_EXTENSIONS:
        try:
            data = full_path.read_bytes()[:MAX_SCAN_BYTES]
            text = data.decode("utf-8", errors="ignore")
        except Exception:
            return "safe", ""
    elif suffix in OFFICE_EXTENSIONS:
        try:
            from . import indexer
            text = indexer._extract_text(user_id, rel_path, max_chars=MAX_SCAN_CHARS)
        except Exception:
            return "safe", ""
        if not text:
            return "safe", ""
    else:
        return "safe", ""

    reasons = []

    # 密钥/凭据（任何方向都检查）
    for pattern, desc in SECRET_PATTERNS:
        if re.search(pattern, text):
            reasons.append(f"检测到{desc}")

    # 身份证号
    if ID_CARD_RE.search(text):
        reasons.append("疑似身份证号")

    # 手机号
    if PHONE_RE.search(text):
        reasons.append("疑似手机号")

    # 方向感知：根据同步方向决定查哪类关键词
    # - home_to_server / upload / server_to_home：往服务器或家里带，重点查公司机密外泄
    # - server_to_company：往公司带，重点查个人隐私
    to_home = direction in ("home_to_server", "server_to_home", "upload")
    to_company = direction in ("server_to_company",)
    check_privacy = not to_home          # 往家/服务器带不查个人隐私
    check_company = not to_company       # 往公司带不查公司机密

    if check_privacy:
        for kw in PERSONAL_PRIVACY_KEYWORDS:
            if kw in text:
                reasons.append(f"包含隐私关键词: {kw}")
                break
    if check_company:
        for kw in COMPANY_CONFIDENTIAL_KEYWORDS:
            if kw in text:
                reasons.append(f"包含机密关键词: {kw}")
                break

    if reasons:
        # 只有凭据类才 blocked，其他都 warning
        is_credential = any("Key" in r or "凭据" in r or "密钥" in r or "PRIVATE KEY" in r for r in reasons)
        status = "blocked" if is_credential else "warning"
        return status, "; ".join(reasons)

    return "safe", ""


def guard_file(user_id: str, rel_path: str, direction: str = "") -> tuple[GuardStatus, str]:
    """对文件执行完整 Guard 检查（带方向感知），返回 (status, reason)。"""
    status, reason = check_filename(rel_path)
    if status == "blocked":
        return status, reason

    c_status, c_reason = check_content(user_id, rel_path, direction=direction)
    if c_status == "blocked":
        return c_status, c_reason
    if c_status == "warning" and status == "safe":
        return c_status, c_reason

    return status, reason
