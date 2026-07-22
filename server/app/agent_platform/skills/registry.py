"""技能注册表：内置技能登记 + 每用户启用状态。

内置技能随代码发布；用户上传自定义技能为后续扩展（skills_config 表已就位）。
"""

from .base import SkillSpec

BUILTIN: dict[str, SkillSpec] = {
    "file-assistant": SkillSpec(
        id="file-assistant",
        name="文件助手",
        description="查找、问答、整理、同步你的文件（默认技能）",
        prompt_name="file-assistant",
        tools=None,  # 全部工具
    ),
    # ---- 展位技能（规格冻结，实现随对应产品波次接入） ----
    "note-organizer": SkillSpec(
        id="note-organizer",
        name="笔记整理师",
        description="笔记摘要、打标签、归档建议",
        prompt_name="file-assistant",
        tools=("search_files", "list_files", "get_file_info", "summarize_file", "qa"),
    ),
    "customer-service": SkillSpec(
        id="customer-service",
        name="智能客服",
        description="基于知识库回答用户问题（展位：知识库产品化后启用）",
        prompt_name="file-assistant",
        tools=("qa", "search_files"),
        knowledge=None,
    ),
}


def get_skill(skill_id: str) -> SkillSpec | None:
    return BUILTIN.get(skill_id)


def list_skills() -> list[SkillSpec]:
    return list(BUILTIN.values())


def get_active_skill(user_id: str, skill_id: str = "file-assistant") -> SkillSpec:
    """返回用户启用的技能（当前默认 file-assistant；skills_config 表的按用户
    覆盖逻辑随管理端技能开关接入）。"""
    return BUILTIN.get(skill_id) or BUILTIN["file-assistant"]


def schemas_for(skill: SkillSpec, registry) -> list[dict]:
    """按技能的工具白名单过滤注册表 schema（None=全部）。"""
    schemas = registry.openai_schemas()
    if skill.tools is None:
        return schemas
    allowed = set(skill.tools)
    return [s for s in schemas if s["function"]["name"] in allowed]
