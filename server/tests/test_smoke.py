"""核心命脉冒烟测试：注册 -> 登录 -> 上传 -> 下载 -> 删除 -> 再下载 404。

与 test_api_path_traversal.py 中的零散回归用例互补：这里把用户最常走的主路径
串成一条端到端用例，任何一环断裂都会立刻红，作为「系统还能喘气吗」的快速指示器。
"""
import io


def _h(token):
    return {"Authorization": f"Bearer {token}"}


def test_upload_download_delete_roundtrip(client, make_user):
    # 1. 注册（make_user 内部已断言注册成功，并取回 token / username）
    _token, _uid, username = make_user(
        username="smoke-user", password="Smoke12345pass")

    # 2. 登录端点单独验证（make_user 走的是 register，不经过 login）
    r = client.post("/api/auth/login", json={
        "username": username, "password": "Smoke12345pass"})
    assert r.status_code == 200, r.text
    headers = _h(r.json()["access_token"])

    # 3. 上传一个文件
    up = client.post("/api/files/upload", headers=headers,
                     files={"file": ("hello.txt", io.BytesIO(b"hello world"), "text/plain")})
    assert up.status_code == 200, up.text

    # 4. 下载回来，内容必须一致
    down = client.get("/api/files/download", headers=headers,
                      params={"path": "hello.txt"})
    assert down.status_code == 200, down.text
    assert down.content == b"hello world"

    # 5. 删除
    dele = client.delete("/api/files", headers=headers, params={"path": "hello.txt"})
    assert dele.status_code == 200, dele.text

    # 6. 再下载应 404
    again = client.get("/api/files/download", headers=headers,
                       params={"path": "hello.txt"})
    assert again.status_code == 404
