"""v1 展位路由：未来产品功能的接口预留（501 + 统一错误体）。

约定：所有展位端点返回 501 {"code": "NOT_IMPLEMENTED", ...}——
前端可提前接线（按 code 展示"即将上线"），实现上线时路由原地替换，契约不变。
唯一例外：GET /skills 已实现（内置技能列表，技能开关闭环的一部分）。
"""

from fastapi import APIRouter, Depends

from ...core.errors import AppError
from ...api.auth import get_current_user
from ...agent_platform.skills.registry import list_skills

router = APIRouter(tags=["v1-placeholders"])


def _placeholder(feature: str) -> AppError:
    return AppError(
        "NOT_IMPLEMENTED",
        f"{feature}尚未上线（接口展位，契约已冻结）",
        status=501,
        detail={"status": "planned"},
    )


# ---- 技能（已实现：内置技能列表） ----

@router.get("/skills")
def v1_skills_list(user=Depends(get_current_user)):
    return {"skills": [{
        "id": s.id, "name": s.name, "description": s.description,
        "version": s.version, "tools": list(s.tools) if s.tools else None,
    } for s in list_skills()]}


# ---- 知识库（展位） ----

@router.get("/kb/collections")
def v1_kb_list(user=Depends(get_current_user)):
    raise _placeholder("线上知识库")


@router.post("/kb/collections")
def v1_kb_create(user=Depends(get_current_user)):
    raise _placeholder("线上知识库")


@router.post("/kb/documents:ingest")
def v1_kb_ingest(user=Depends(get_current_user)):
    raise _placeholder("知识库文档摄入")


# ---- MCP（展位） ----

@router.get("/mcp/servers")
def v1_mcp_list(user=Depends(get_current_user)):
    raise _placeholder("MCP 服务器管理")


@router.post("/mcp/servers")
def v1_mcp_create(user=Depends(get_current_user)):
    raise _placeholder("MCP 服务器管理")


# ---- 智能客服（展位） ----

@router.get("/bots")
def v1_bots_list(user=Depends(get_current_user)):
    raise _placeholder("智能客服")


@router.post("/bots/{bot_id}/messages")
def v1_bot_message(bot_id: str, user=Depends(get_current_user)):
    raise _placeholder("智能客服")


# ---- 数据中心（展位：写入侧已随 agent_traces/events 落地，查询看板待实现） ----

@router.get("/analytics/overview")
def v1_analytics_overview(user=Depends(get_current_user)):
    raise _placeholder("数据中心看板")


@router.get("/analytics/cost")
def v1_analytics_cost(user=Depends(get_current_user)):
    raise _placeholder("成本分析")
