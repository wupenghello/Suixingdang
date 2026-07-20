"""临时下载授权的安全增强测试。

覆盖密码验证、单次下载授权、多档窗口时长、下载审计等新增行为：
- download-grant 需验证密码，密码错误返回 403；
- download-grant-single 验证密码后仅允许下载指定文件一次；
- 窗口模式支持 5/15/30 分钟自定义时长；
- download-history 返回当前窗口内的下载记录；
- 错误密码记审计日志。
"""
import io

from auth_helpers import register as _reg, login as _login

PWD = "Test1234pass"


def _h(token):
    return {"Authorization": f"Bearer {token}"}


def _upload(client, token, name="a.txt", content=b"hello"):
    r = client.post("/api/files/upload", headers=_h(token),
                    files={"file": (name, io.BytesIO(content), "text/plain")})
    assert r.status_code == 200, r.text
    return _h(token)


def test_grant_wrong_password_rejected(client):
    """密码错误时 download-grant 返回 400（统一 stepup 验证），不开启窗口。"""
    access, _r, _ = _reg(client, password=PWD)
    h = _upload(client, access)
    r = client.post("/api/files/download-grant", headers=h, json={"password": "wrong-pwd", "minutes": 0})
    assert r.status_code == 400
    assert r.json()["detail"] == "密码错误"
    assert client.get("/api/files/download-status", headers=h).json()["granted"] is False


def test_grant_correct_password_opens_window(client):
    """密码正确时 download-grant 开启窗口，可下载文件。"""
    access, _r, _ = _reg(client, password=PWD)
    h = _upload(client, access)
    r = client.post("/api/files/download-grant", headers=h, json={"password": PWD, "minutes": 0})
    assert r.status_code == 200 and r.json()["granted"] is True
    d = client.get("/api/files/download", headers=h, params={"path": "a.txt"})
    assert d.status_code == 200 and d.content == b"hello"


def test_grant_extended_window_15_minutes(client):
    """指定 minutes=15 时返回 15 分钟窗口。"""
    access, _r, _ = _reg(client, password=PWD)
    h = _upload(client, access)
    r = client.post("/api/files/download-grant", headers=h, json={"password": PWD, "minutes": 15})
    assert r.status_code == 200
    assert r.json()["minutes"] == 15


def test_grant_extended_window_30_minutes(client):
    """指定 minutes=30 时返回 30 分钟窗口。"""
    access, _r, _ = _reg(client, password=PWD)
    h = _upload(client, access)
    r = client.post("/api/files/download-grant", headers=h, json={"password": PWD, "minutes": 30})
    assert r.status_code == 200
    assert r.json()["minutes"] == 30


def test_single_download_grant_success(client):
    """单次下载授权：验证密码后仅允许下载指定文件一次。"""
    access, _r, _ = _reg(client, password=PWD)
    h = _upload(client, access, "a.txt", b"file-a")
    _upload(client, access, "b.txt", b"file-b")
    # 授权单次下载 a.txt
    r = client.post("/api/files/download-grant-single", headers=h,
                    json={"password": PWD, "path": "a.txt"})
    assert r.status_code == 200 and r.json()["granted"] is True
    # a.txt 可下载
    d1 = client.get("/api/files/download", headers=h, params={"path": "a.txt"})
    assert d1.status_code == 200 and d1.content == b"file-a"
    # 第二次下载 a.txt 被 403（单次授权已消耗）
    d2 = client.get("/api/files/download", headers=h, params={"path": "a.txt"})
    assert d2.status_code == 403
    # b.txt 也不可下载（单次授权仅限 a.txt）
    d3 = client.get("/api/files/download", headers=h, params={"path": "b.txt"})
    assert d3.status_code == 403


def test_single_download_wrong_password_rejected(client):
    """单次下载密码错误返回 400（统一 stepup 验证）。"""
    access, _r, _ = _reg(client, password=PWD)
    h = _upload(client, access)
    r = client.post("/api/files/download-grant-single", headers=h,
                    json={"password": "wrong", "path": "a.txt"})
    assert r.status_code == 400
    assert r.json()["detail"] == "密码错误"


def test_single_download_nonexistent_file_404(client):
    """单次下载不存在的文件返回 404。"""
    access, _r, _ = _reg(client, password=PWD)
    h = _h(access)
    r = client.post("/api/files/download-grant-single", headers=h,
                    json={"password": PWD, "path": "no-such-file.txt"})
    assert r.status_code == 404


def test_download_history_returns_records(client):
    """download-history 返回当前窗口内的下载记录。"""
    access, _r, _ = _reg(client, password=PWD)
    h = _upload(client, access, "a.txt", b"content-a")
    _upload(client, access, "b.txt", b"content-b")
    # 开启窗口
    client.post("/api/files/download-grant", headers=h, json={"password": PWD, "minutes": 0})
    # 下载两个文件
    client.get("/api/files/download", headers=h, params={"path": "a.txt"})
    client.get("/api/files/download", headers=h, params={"path": "b.txt"})
    # 查询历史
    r = client.get("/api/files/download-history", headers=h)
    assert r.status_code == 200
    data = r.json()
    assert data["count"] == 2
    paths = [f["path"] for f in data["files"]]
    assert "a.txt" in paths
    assert "b.txt" in paths


def test_download_history_empty_without_grant(client):
    """未开启窗口时 download-history 返回空。"""
    access, _r, _ = _reg(client, password=PWD)
    h = _upload(client, access)
    r = client.get("/api/files/download-history", headers=h)
    assert r.status_code == 200
    assert r.json()["count"] == 0


def test_download_status_returns_single_path(client):
    """download-status 返回 single_path 字段。"""
    access, _r, _ = _reg(client, password=PWD)
    h = _upload(client, access)
    # 授权单次下载
    client.post("/api/files/download-grant-single", headers=h,
                json={"password": PWD, "path": "a.txt"})
    status = client.get("/api/files/download-status", headers=h).json()
    assert status["single_path"] == "a.txt"
    assert status["granted"] is False  # 窗口未开启


def test_revoke_clears_single_download(client):
    """revoke 清除单次下载授权。"""
    access, _r, _ = _reg(client, password=PWD)
    h = _upload(client, access)
    client.post("/api/files/download-grant-single", headers=h,
                json={"password": PWD, "path": "a.txt"})
    client.post("/api/files/download-revoke", headers=h)
    status = client.get("/api/files/download-status", headers=h).json()
    assert status["single_path"] == ""


def test_window_grant_clears_single_path(client):
    """开启窗口模式时清除残留的单次授权。"""
    access, _r, _ = _reg(client, password=PWD)
    h = _upload(client, access)
    # 先设置单次授权
    client.post("/api/files/download-grant-single", headers=h,
                json={"password": PWD, "path": "a.txt"})
    # 再开启窗口
    client.post("/api/files/download-grant", headers=h, json={"password": PWD, "minutes": 0})
    status = client.get("/api/files/download-status", headers=h).json()
    assert status["single_path"] == ""  # 单次授权被清除
    assert status["granted"] is True     # 窗口已开启
