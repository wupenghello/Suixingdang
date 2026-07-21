"""技能（Skill）规格：上下文 + 工具子集的组合单元。

Skill = 指令（版本化 prompt）+ 工具子集 +（可选）知识绑定。
智能客服等未来产品形态 = 客服 Skill + 知识库绑定 + 渠道适配器，
同一 runtime 不同配置即可组合，无需多代理框架。
"""

from dataclasses import dataclass, field


@dataclass(frozen=True)
class SkillSpec:
    id: str
    name: str
    description: str
    prompt_name: str                     # llm/prompts/ 下的版本化提示词名
    tools: tuple[str, ...] | None = None  # 工具白名单；None=注册表全部工具
    knowledge: str | None = None          # 绑定的知识库 id（展位，后续接入）
    version: str = "v1"
