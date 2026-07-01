# .agent-workflow

把本目录复制到项目根目录，并在项目根目录保留配套的 `AGENTS.md` 或 `Agent.md`。

推荐结构：

```text
your-project/
  AGENTS.md
  Agent.md
  QUICKSTART.md
  BOOTSTRAP_CHECKLIST.md
  INSTALL_SUPERPOWERS.md
  PROJECT_PROFILE.md
  EMERGENCY_FIX.md
  VERSION.md
  DECISIONS.md
  .agent-workflow/
    WORKFLOW.md
    SKILLS.md
    STATE_RULES.md
    state.md
    agents/
    examples/
    specs/
    task-cards/
    handoffs/
    reviews/
    verification/
    delivery/
    templates/
```

启动项目开发时，对主 Agent 说：

```text
请读取 AGENTS.md，并按 .agent-workflow/WORKFLOW.md 启动开发。
```

运行过程中，所有 SPEC、任务卡、交接报告、审查报告、验证记录和交付报告都应放在对应目录中。

`agents/` 目录是每个角色的独立说明文档。主 Agent 派发子 Agent 前必须读取对应文件，并在任务卡中引用。

`SKILLS.md` 定义 skill 从哪里加载、找不到时怎么降级、什么时候必须阻塞。主 Agent 派发子 Agent 前必须按该文件填写任务卡里的 Skill 加载说明。

`STATE_RULES.md` 定义 state 文件的更新时机、状态枚举、打回计数和 BLOCKED 处理规则。

根目录补充文档：

- `QUICKSTART.md`：复制到新项目后的启动方法。
- `BOOTSTRAP_CHECKLIST.md`：主 Agent 启动前自检清单。
- `INSTALL_SUPERPOWERS.md`：Superpowers 检查、安装、启用和阻塞规则。
- `PROJECT_PROFILE.md`：项目技术栈、命令、环境变量和部署信息。
- `EMERGENCY_FIX.md`：紧急修复流程。
- `VERSION.md`：模板版本和升级规则。
- `DECISIONS.md`：用户决策和已拒绝建议记录。

示例：

- `.agent-workflow/examples/simple-feature/`：展示一个 L2 小功能从 SPEC 到交付报告的完整样例。
- `.agent-workflow/examples/high-risk-ai-api/`：展示一个 L3 AI API 任务如何触发安全、风险、真实验证和交付。
