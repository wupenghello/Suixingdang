"""敏感路径拦截:扫描器常探的隐藏文件/敏感文件名应返回 404,而非 SPA index.html。"""
import pytest

SENSITIVE_PATHS = [
    # 点号开头的隐藏文件 / 目录
    "/.env", "/.env.production", "/.env.local", "/.env.bak", "/.env.example",
    "/.git/HEAD", "/.git/config", "/.ssh/id_rsa", "/.aws/credentials",
    "/.DS_Store", "/.vscode/sftp.json", "/.svn/wc.db", "/.npmrc",
    "/.bash_history", "/.htpasswd",
    # 常见敏感文件名
    "/wp-config.php", "/wp-login.php", "/xmlrpc.php", "/config.php", "/phpinfo.php",
    "/backup.sql", "/dump.sql", "/database.sql", "/backup.zip", "/backup.tar.gz",
    "/server.key", "/id_rsa", "/secrets.json", "/credentials",
    "/docker-compose.yml",
    # 嵌套形式
    "/app/.env", "/backend/.env", "/config/.env",
]


@pytest.mark.parametrize("path", SENSITIVE_PATHS)
def test_sensitive_paths_return_404(client, path):
    r = client.get(path)
    assert r.status_code == 404, f"{path} 应返回 404,实际 {r.status_code}"


def test_normal_paths_still_served(client):
    # 正常 SPA 入口与静态资源不应被误拦
    for path in ["/", "/admin"]:
        r = client.get(path)
        assert r.status_code == 200, f"{path} 应可访问,实际 {r.status_code}"
    # 管理后台静态资源（随仓库存在，不依赖 web/dist 构建）
    r = client.get("/admin/assets/admin.js")
    assert r.status_code == 200, f"/admin/assets/admin.js 应可访问,实际 {r.status_code}"
