# Quick Start

本文件说明如何把本模板复制到任意开发项目，并启动 9+1 工程角色工作流。

## 1. 复制模板

把以下内容复制到目标项目根目录：

```text
AGENTS.md
Agent.md
.agent-workflow/
scripts/
tests/
```

如果你的 Agent 工具默认读取 `AGENTS.md`，保留 `AGENTS.md` 即可。  
如果你的工具或个人习惯使用 `Agent.md`，保留 `Agent.md` 即可。  
两个文件可以同时存在。

## 2. 检查接入状态

复制完成后，在目标项目根目录运行：

```bash
python3 scripts/workflow.py doctor
```

`doctor` 只读取文件，不会修改项目。它会检查：

- `Agent.md` 或 `AGENTS.md` 是否存在。
- `.agent-workflow/` 核心文件是否齐全。
- 子 Agent 文档和模板是否齐全。
- `.agent-workflow/state.md` 是否包含必要字段。
- `PROJECT_PROFILE.md` 是否还存在明显占位符。
- 本机是否能找到 Superpowers skills。
- Markdown 代码块是否闭合。

缺少关键文件时返回失败；`PROJECT_PROFILE.md` 未填写、Superpowers 未找到这类问题会给出警告。

## 3. 初始化一个新任务

开始新功能、bugfix 或重构前，先生成标准任务入口：

先评估任务等级：

```bash
python3 scripts/workflow.py assess-risk "Add user login with session storage"
```

如果你已经知道等级，可以直接指定：

```bash
python3 scripts/workflow.py new-task "Add user login" \
  --level L2 \
  --reason "Touches authentication and user sessions."
```

如果希望 CLI 根据标题、摘要和原因自动建议等级：

```bash
python3 scripts/workflow.py new-task "Add user login" \
  --level auto \
  --summary "Add user login with session storage."
```

任务等级选择：

- `L1`：小改动，启用开发工程师 + 验收工程师。
- `L2`：常规功能，启用测试、开发、验收、质量工程师。
- `L3`：高风险任务，启用 L2 角色，并加入安全、风险、性能、文档、集成、部署角色。

命令会生成：

```text
.agent-workflow/specs/YYYY-MM-DD-task-name.md
.agent-workflow/task-cards/YYYY-MM-DD-task-name.md
.agent-workflow/handoffs/YYYY-MM-DD-task-name.md
```

同时更新：

```text
.agent-workflow/state.md
```

默认不会覆盖已存在的任务文件。如果确认要覆盖，显式加 `--force`。

## 4. 让 Agent 安装本模板

如果你不想手动复制文件，可以在目标项目根目录打开 Agent，直接说：

```text
请把 https://github.com/peyoba/agent-workflow-template 安装到当前项目。

要求：
1. 复制 AGENTS.md、Agent.md、PROJECT_PROFILE.md、QUICKSTART.md、INSTALL_SUPERPOWERS.md、.agent-workflow/、scripts/ 和 tests/。
2. 如果目标项目已经有 AGENTS.md、Agent.md 或 .agent-workflow/，不要覆盖，先展示差异并等待确认。
3. 安装后运行 python3 scripts/workflow.py doctor。
4. 如果 PROJECT_PROFILE.md 仍有占位符，先根据项目文件补全；无法确认的再问我。
```

## 5. 启动开发

在项目根目录打开 Agent，对主 Agent 说：

```text
请读取 AGENTS.md，并按 .agent-workflow/WORKFLOW.md 启动开发。

项目/功能目标：
[填写目标]

技术约束：
[填写语言、框架、数据库、部署要求；没有就写“由你建议”]

优先级：
[MVP / 完整版 / 修 bug / 重构]

风险要求：
[是否涉及登录、支付、数据库、AI API、环境变量、部署]

请先执行 superpowers_bootstrap_hook，再从 intake_hook 开始。
在我确认 SPEC 和任务清单前，不要进入开发。
```

如果已经运行过 `new-task`，可以补充一句：

```text
当前任务入口已经生成，请先读取 .agent-workflow/state.md，再补全最新 spec 和任务卡。
```

## 6. 用户需要确认什么

用户只需要在关键决策点介入：

1. 确认需求、范围和验收标准。
2. 确认 SPEC 和任务清单。
3. 遇到 `BLOCKED`、超过 2 次打回、范围扩大或技术方案变化时做决策。

## 7. 主 Agent 必须先做什么

主 Agent 必须按顺序执行：

1. 读取 `AGENTS.md` 或 `Agent.md`。
2. 读取 `.agent-workflow/WORKFLOW.md`。
3. 读取 `.agent-workflow/SKILLS.md`。
4. 读取 `.agent-workflow/agents/00-main-agent.md`。
5. 执行 `superpowers_bootstrap_hook`。
6. Superpowers 可用后进入 `intake_hook`。

## 8. 开发过程产物放哪里

```text
.agent-workflow/specs/          SPEC
.agent-workflow/task-cards/     子 Agent 任务卡
.agent-workflow/handoffs/       角色交接
.agent-workflow/reviews/        审查报告
.agent-workflow/verification/   真实验证记录
.agent-workflow/delivery/       交付报告
```

## 9. 最小成功标准

一次开发交付至少要有：

- SPEC 或明确验收标准。
- 对应等级的角色执行记录。
- 测试或验证结果。
- 必要时的真实验证记录。
- 最终交付报告。
