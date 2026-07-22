"""v1 契约层测试（S1）：类型化端点 + 统一错误体 + 兼容挂载。"""

import io

import pytest

from tests import auth_helpers


@pytest.fixture()
def auth(client):
    access, _, username = auth_helpers.register(client)
    return {"Authorization": f"Bearer {access}"}, username


def test_v1_upload_typed_response(client, auth):
    headers, _ = auth
    r = client.post(
        "/api/v1/uploads?directory=docs",
        headers=headers,
        files={"file": ("hello.txt", io.BytesIO(b"hello v1"), "text/plain")},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["message"] == "上传成功"
    f = body["file"]
    assert f["path"] == "docs/hello.txt"
    assert f["size"] == 8
    assert "id" in f and "mime_type" in f  # response_model 字段齐全


def test_v1_note_create(client, auth):
    headers, _ = auth
    r = client.post("/api/v1/notes", headers=headers,
                    json={"name": "我的笔记", "content": "# 标题\n内容"})
    assert r.status_code == 201, r.text
    assert r.json()["file"]["name"] == "我的笔记.md"


def test_v1_note_empty_rejected_with_code(client, auth):
    headers, _ = auth
    r = client.post("/api/v1/notes", headers=headers, json={"name": "x", "content": "  "})
    assert r.status_code == 400
    body = r.json()
    assert body["code"] == "NOTE_EMPTY"
    assert "message" in body and "detail" in body  # 统一错误体


def test_v1_trash_flow_and_error_shape(client, auth):
    headers, _ = auth
    # 上传 → 删除进回收站（旧端点）→ v1 列表可见 → v1 恢复
    client.post("/api/v1/uploads", headers=headers,
                files={"file": ("tr.txt", io.BytesIO(b"trash me"), "text/plain")})
    fid = client.post("/api/v1/uploads", headers=headers,
                      files={"file": ("tr2.txt", io.BytesIO(b"trash me 2"), "text/plain")}).json()["file"]["id"]
    r = client.delete("/api/v1/trash/nonexistent-id", headers=headers)
    assert r.status_code == 404
    body = r.json()
    assert body["code"] == "TRASH_NOT_FOUND"
    assert isinstance(body["detail"], dict)

    # 彻底删除一个真实文件
    client.request("DELETE", "/api/files", headers=headers, params={"path": "tr.txt"})
    items = client.get("/api/v1/trash/items", headers=headers).json()
    assert any(i["path"] == "tr.txt" for i in items)
    target = next(i for i in items if i["path"] == "tr.txt")
    r = client.delete(f"/api/v1/trash/{target['id']}", headers=headers)
    assert r.status_code == 200 and r.json()["message"] == "已彻底删除"
    assert client.get("/api/v1/trash/items", headers=headers).json() == []


def test_v1_compat_mount_legacy_endpoints(client, auth):
    """既有端点在 /api/v1 前缀下同样可达（兼容挂载）。"""
    headers, _ = auth
    r = client.get("/api/v1/files/list", headers=headers, params={"directory": ""})
    assert r.status_code == 200
    r = client.get("/api/v1/transfer/messages", headers=headers)
    assert r.status_code == 200


def test_legacy_prefix_unchanged(client, auth):
    """旧 /api/* 路径与旧错误形态（{"detail": ...}）保持不变。"""
    headers, _ = auth
    r = client.get("/api/files/list", headers=headers, params={"directory": ""})
    assert r.status_code == 200
    # 未认证访问旧前缀 → 401 {"detail": ...}，不是 v1 错误体
    r = client.get("/api/files/list")
    assert r.status_code == 401
    assert "detail" in r.json()


def test_v1_auth_required(client):
    r = client.post("/api/v1/notes", json={"name": "x", "content": "y"})
    assert r.status_code == 401
