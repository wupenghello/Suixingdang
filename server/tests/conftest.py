"""测试公共夹具：隔离存储/数据库、mock 重型依赖。

设计要点：
- chromadb / unstructured / fitz 等重型依赖用 mock 替代，避免下载嵌入模型与拉取大包；
- 在导入任何 app 模块前注入测试用环境变量（密钥 + 临时数据目录），保证 settings 单例
  指向隔离的 tmp 目录，绝不触碰真实 /data；
- 所有测试用例通过这层夹具获得干净的 FastAPI TestClient 与唯一 user_id。
"""
import os
import sys
import tempfile
import uuid
from pathlib import Path
from unittest.mock import MagicMock

# ---- 1. mock 重型/可选依赖（必须在 import app 之前）----
_chromadb = MagicMock()
_collection = MagicMock()
# semantic_search 会解包 query() 返回结构，给一个安全的空结果
_collection.query.return_value = {
    "ids": [[]], "metadatas": [[]], "distances": [[]], "documents": [[]],
}
_chromadb.PersistentClient.return_value.get_or_create_collection.return_value = _collection
for _mod in ("chromadb", "chromadb.utils", "chromadb.utils.embedding_functions"):
    sys.modules.setdefault(_mod, _chromadb if _mod == "chromadb" else MagicMock())

# ---- 2. 隔离的临时数据目录 + 测试用密钥（必须在 import config 之前）----
_TMP = Path(tempfile.mkdtemp(prefix="sxd-test-"))
os.environ["STORAGE_DIR"] = str(_TMP / "files")
os.environ["DATABASE_PATH"] = str(_TMP / "db.sqlite")
os.environ["SECRET_KEY"] = "test-secret-key-for-tests-only-padding-to-32b"
os.environ["JWT_SECRET"] = "test-jwt-secret-for-tests-only-padding-to-32b"
os.environ["DATA_ENCRYPTION_KEY"] = "test-data-encryption-key-for-tests"
os.environ["ADMIN_USERNAME"] = "admin"
os.environ["ADMIN_PASSWORD"] = "test-admin-pw-12345"
os.environ["ALLOW_REGISTER"] = "true"
os.environ["DOMAIN"] = "localhost"

# ---- 3. 让 server/app 可被 import ----
_SERVER_DIR = Path(__file__).resolve().parent.parent
if str(_SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(_SERVER_DIR))

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(scope="session")
def app():
    """用户端 app（lifespan 会建表、播种管理员）。"""
    from app.main import app as _app
    return _app


@pytest.fixture(scope="session")
def client(app):
    """带生命周期的 TestClient：进入时建表，退出时清理。"""
    with TestClient(app) as c:
        yield c


@pytest.fixture
def user():
    """storage 层测试用的唯一用户 id（每个用例独立目录，互不干扰）。"""
    return f"u-{uuid.uuid4().hex[:12]}"


@pytest.fixture
def make_user(client):
    """注册一个新用户，返回 (token, user_id, username)。"""
    from auth_helpers import register
    def _make(username: str | None = None, password: str = "Test1234pass"):
        token, _refresh, username = register(client, username, password)
        me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert me.status_code == 200, me.text
        return token, me.json()["id"], username
    return _make
