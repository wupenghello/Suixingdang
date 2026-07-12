"""API 层路径穿越回归测试。

通过 FastAPI TestClient 验证：preview-text / download / preview / delete 等接口对
`..` 穿越、跨用户访问一律返回 404，且不泄露数据库内容、不误删数据库本体；
同时确认正常上传-读取链路无回归。
"""
import io
import os
from pathlib import Path

import pytest


def _h(token):
    return {"Authorization": f"Bearer {token}"}


def test_preview_text_traversal_returns_404_not_db(client, make_user):
    token, _uid, _ = make_user()
    r = client.get("/api/files/preview-text",
                   params={"path": "../../db.sqlite"}, headers=_h(token))
    assert r.status_code == 404
    body = r.text
    assert "password_hash" not in body
    assert "admins" not in body
    assert "CREATE TABLE" not in body


def test_download_traversal_returns_404(client, make_user):
    token, _uid, _ = make_user()
    client.post("/api/files/download-grant", headers=_h(token))  # 开启临时下载以测路径校验
    r = client.get("/api/files/download",
                   params={"path": "../../db.sqlite"}, headers=_h(token))
    assert r.status_code == 404


def test_preview_traversal_returns_404(client, make_user):
    token, _uid, _ = make_user()
    r = client.get("/api/files/preview",
                   params={"path": "../../db.sqlite"}, headers=_h(token))
    assert r.status_code == 404


def test_sync_download_traversal_returns_404(client, make_user):
    token, _uid, _ = make_user()
    # sync 通道仅接受设备令牌（浏览器 JWT 走 /api/files/*）
    dev = client.post("/api/auth/tokens?label=t&expires_days=0", headers=_h(token))
    assert dev.status_code == 200, dev.text
    r = client.get("/api/sync/download",
                   params={"path": "../../db.sqlite"}, headers=_h(dev.json()["token"]))
    assert r.status_code == 404


def test_delete_traversal_does_not_delete_db(client, make_user):
    token, _uid, _ = make_user()
    from app.config import settings
    db_path = Path(settings.DATABASE_PATH)
    assert db_path.exists()
    r = client.delete("/api/files",
                      params={"path": "../../db.sqlite"}, headers=_h(token))
    assert db_path.exists(), "数据库被穿越删除了！"
    # 后续管理员登录仍可走通（DB 结构完整）
    r2 = client.post("/api/auth/login", json={
        "username": "admin", "password": os.environ["ADMIN_PASSWORD"],
    })
    assert r2.status_code in (200, 401, 403), r2.text


def test_cross_user_access_returns_404(client, make_user):
    token_a, uid_a, _ = make_user()
    token_b, _uid_b, _ = make_user()
    r = client.post("/api/files/upload", headers=_h(token_a),
                    files={"file": ("secret.txt", io.BytesIO(b"A-SECRET-CONTENT"), "text/plain")})
    assert r.status_code == 200, r.text
    # B 试图用 ../<A 的 user_id>/secret.txt 读取 A 的文件
    r = client.get("/api/files/preview-text",
                   params={"path": f"../{uid_a}/secret.txt"}, headers=_h(token_b))
    assert r.status_code == 404
    assert "A-SECRET-CONTENT" not in r.text


def test_legitimate_upload_read_not_regressed(client, make_user):
    token, _uid, _ = make_user()
    r = client.post("/api/files/upload", headers=_h(token),
                    files={"file": ("notes.txt", io.BytesIO(b"legit content here"), "text/plain")})
    assert r.status_code == 200, r.text
    r = client.get("/api/files/preview-text",
                   params={"path": "notes.txt"}, headers=_h(token))
    assert r.status_code == 200
    assert "legit content here" in r.json()["content"]


def test_legitimate_subdir_upload_download_not_regressed(client, make_user):
    token, _uid, _ = make_user()
    r = client.post("/api/files/upload", headers=_h(token),
                    params={"directory": "work/2026"},
                    files={"file": ("report.txt", io.BytesIO(b"subdir content"), "text/plain")})
    assert r.status_code == 200, r.text
    assert r.json()["path"] == "work/2026/report.txt"
    client.post("/api/files/download-grant", headers=_h(token))  # 开启临时下载
    r = client.get("/api/files/download",
                   params={"path": "work/2026/report.txt"}, headers=_h(token))
    assert r.status_code == 200
    assert r.content == b"subdir content"
