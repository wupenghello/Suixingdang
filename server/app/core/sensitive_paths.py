"""敏感路径拦截:扫描器常探的隐藏文件 / 敏感文件名返回 404,而非 SPA index.html。

后端 SPA 的 catch-all 路由对任何未知路径都返回 index.html(200),会让公网扫描器
对 /.env /.git/HEAD /wp-config.php 等收到 200、误以为命中。这里把这些路径单独拦成 404。
"""

# 非点号开头的敏感文件名(点号开头的由「段以 . 开头」规则统一覆盖)
_SENSITIVE_BASENAMES = {
    # 凭据 / 密钥
    "id_rsa", "id_dsa", "id_ecdsa", "id_ed25519",
    "server.key", "private.key", "client.key",
    "credentials", "credentials.json",
    "secrets.json", "secrets.yml", "user_secrets.yml",
    # 配置 / 备份
    "docker-compose.yml", "docker-compose.yaml", "docker-compose.override.yml",
    "web.config", "appsettings.json",
    "backup.sql", "dump.sql", "database.sql", "database_backup.sql",
    "backup.zip", "backup.tar", "backup.tar.gz", "backup.tgz",
    # PHP / WordPress 等常见靶子
    "wp-config.php", "wp-login.php", "xmlrpc.php", "config.php",
    "phpinfo.php", "info.php",
}


def is_sensitive_path(full_path: str) -> bool:
    """判断 SPA catch-all 收到的路径是否为敏感探测路径。

    规则:任一路径段以 ``.`` 开头(覆盖 .env/.git/.ssh/.aws/.DS_Store/.vscode/.svn ...),
    或某段 basename 命中敏感文件名集合(大小写不敏感)。

    注:.well-known 也以 . 开头会被拦,但 Caddy 在自身层处理 ACME HTTP-01 挑战
    (.well-known/acme-challenge),不会代理到后端,故不影响证书续期。
    """
    if not full_path:
        return False
    for seg in full_path.split("/"):
        if not seg:
            continue
        if seg.startswith("."):
            return True
        if seg.lower() in _SENSITIVE_BASENAMES:
            return True
    return False
