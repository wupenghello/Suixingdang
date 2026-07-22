"""S5 展位与技能测试：501 契约、技能注册、工具白名单过滤。"""

import pytest

from app.agent_platform.skills.registry import (
    list_skills, get_skill, get_active_skill, schemas_for,
)
from app.agent_platform.tools.registry import default_registry
from tests import auth_helpers


# ---------- 技能注册表 ----------

def test_builtin_skills_registered():
    skills = {s.id for s in list_skills()}
    assert {"file-assistant", "note-organizer", "customer-service"} <= skills


def test_get_active_skill_fallback():
    assert get_active_skill("u", "file-assistant").id == "file-assistant"
    # 未知技能回退默认
    assert get_active_skill("u", "no-such-skill").id == "file-assistant"


def test_schemas_for_filters_by_skill_tools():
    reg = default_registry()
    full = schemas_for(get_skill("file-assistant"), reg)
    assert len(full) == 16

    limited = schemas_for(get_skill("note-organizer"), reg)
    names = {s["function"]["name"] for s in limited}
    assert names == {"search_files", "list_files", "get_file_info", "summarize_file", "qa"}
    assert "delete_file" not in names, "笔记整理师不得含删除工具"


# ---------- v1 展位端点 ----------

@pytest.fixture()
def headers(client):
    access, _, _ = auth_helpers.register(client)
    return {"Authorization": f"Bearer {access}"}


def test_skills_endpoint_live(client, headers):
    r = client.get("/api/v1/skills", headers=headers)
    assert r.status_code == 200
    ids = {s["id"] for s in r.json()["skills"]}
    assert "file-assistant" in ids


@pytest.mark.parametrize("method,path", [
    ("GET", "/api/v1/kb/collections"),
    ("POST", "/api/v1/kb/collections"),
    ("POST", "/api/v1/kb/documents:ingest"),
    ("GET", "/api/v1/mcp/servers"),
    ("POST", "/api/v1/mcp/servers"),
    ("GET", "/api/v1/bots"),
    ("POST", "/api/v1/bots/x/messages"),
    ("GET", "/api/v1/analytics/overview"),
    ("GET", "/api/v1/analytics/cost"),
])
def test_placeholders_return_501_contract(client, headers, method, path):
    r = client.request(method, path, headers=headers)
    assert r.status_code == 501, f"{method} {path} → {r.status_code}"
    body = r.json()
    assert body["code"] == "NOT_IMPLEMENTED"
    assert body["detail"]["status"] == "planned"
    assert body["message"]


def test_placeholders_require_auth(client):
    r = client.get("/api/v1/kb/collections")
    assert r.status_code == 401


# ---------- 展位模型表已建（迁移 0003） ----------

def test_placeholder_tables_exist(client):
    from sqlalchemy import inspect
    from app.db.models import engine
    tables = set(inspect(engine).get_table_names())
    assert {"kb_collections", "kb_documents", "mcp_servers", "skills_config", "bots"} <= tables
