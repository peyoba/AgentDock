#!/usr/bin/env python3
"""Small CLI helpers for the reusable agent workflow template."""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from datetime import date
from pathlib import Path


EXPECTED_ROLE_DOCS = [
    "00-main-agent.md",
    "01-test-engineer.md",
    "02-developer.md",
    "03-acceptance-engineer.md",
    "04-quality-engineer.md",
    "05-security-engineer.md",
    "06-performance-engineer.md",
    "07-docs-engineer.md",
    "08-integration-engineer.md",
    "09-deploy-engineer.md",
    "10-risk-reviewer.md",
]

EXPECTED_TEMPLATE_DOCS = [
    "spec.md",
    "task-card.md",
    "handoff.md",
    "review.md",
    "verification.md",
    "delivery-report.md",
]

EXPECTED_WORK_DIRS = [
    ".agent-workflow/specs",
    ".agent-workflow/task-cards",
    ".agent-workflow/handoffs",
    ".agent-workflow/reviews",
    ".agent-workflow/verification",
    ".agent-workflow/delivery",
]

IGNORED_MARKDOWN_DIRS = {
    ".agentdock",
    ".claude",
    ".git",
    ".pytest_cache",
    "__pycache__",
    "coverage",
    "dist",
    "node_modules",
    "out",
}

STATE_HEADINGS = [
    "## 当前任务",
    "## 风险等级",
    "## 当前 Hook",
    "## 当前阶段",
    "## 已派发角色",
    "## 阻塞点",
    "## 用户待确认",
    "## 下一步",
    "## 决策记录",
]

ROLE_SETS = {
    "L1": ["②开发工程师", "③验收工程师"],
    "L2": ["①测试工程师", "②开发工程师", "③验收工程师", "④质量工程师"],
    "L3": [
        "①测试工程师",
        "②开发工程师",
        "③验收工程师",
        "④质量工程师",
        "⑤安全工程师",
        "⑩风险审查官",
        "⑥性能工程师",
        "⑦文档工程师",
        "⑧集成工程师",
        "⑨部署工程师",
    ],
}

ROLE_SKILLS = {
    "①测试工程师": "superpowers:test-driven-development",
    "②开发工程师": "superpowers:test-driven-development",
    "③验收工程师": "superpowers:verification-before-completion",
    "④质量工程师": "superpowers:requesting-code-review",
    "⑤安全工程师": "security review skill 或项目安全规范",
    "⑩风险审查官": "superpowers:brainstorming",
    "⑥性能工程师": "项目性能测试工具",
    "⑦文档工程师": "项目文档规范",
    "⑧集成工程师": "superpowers:using-git-worktrees",
    "⑨部署工程师": "部署平台或 CI/CD 规范",
}

DEFAULT_REASON = "由主 Agent 在 intake_hook 中补充。"


@dataclass(frozen=True)
class RiskAssessment:
    level: str
    reasons: list[str]


RISK_RULES = [
    (
        "L3",
        "security",
        ["security", "auth", "login", "permission", "role", "oauth", "jwt", "session", "安全", "登录", "权限", "会话", "认证"],
    ),
    (
        "L3",
        "payment",
        ["payment", "checkout", "billing", "invoice", "subscription", "stripe", "refund", "支付", "结账", "账单", "订阅", "退款"],
    ),
    (
        "L3",
        "api key",
        ["api key", "apikey", "secret", "token", "credential", "password", ".env", "密钥", "令牌", "凭证", "密码"],
    ),
    (
        "L3",
        "database",
        ["database", "migration", "schema", "sql", "delete", "write", "db", "数据库", "迁移", "数据表", "删除", "写入", "保存"],
    ),
    (
        "L3",
        "deployment",
        ["deploy", "deployment", "production", "ci/cd", "release", "rollback", "部署", "生产", "发布", "回滚"],
    ),
    (
        "L3",
        "external api",
        ["webhook", "external api", "llm", "openai", "anthropic", "ark", "third-party", "外部 api", "第三方", "大模型"],
    ),
    (
        "L2",
        "core behavior",
        ["feature", "workflow", "refactor", "api", "cli", "integration", "state", "功能", "工作流", "重构", "集成", "状态"],
    ),
    (
        "L2",
        "data handling",
        ["cache", "file", "upload", "download", "import", "export", "report", "缓存", "文件", "上传", "下载", "导入", "导出", "报告"],
    ),
    (
        "L2",
        "test impact",
        ["bug", "fix", "test", "validation", "parser", "error handling", "修复", "测试", "校验", "解析", "错误处理"],
    ),
]


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="workflow",
        description="Agent workflow helper commands.",
    )
    subcommands = parser.add_subparsers(dest="command", required=True)

    doctor = subcommands.add_parser("doctor", help="Check workflow template wiring.")
    doctor.add_argument("--project-root", default=".", help="Project root to inspect.")

    new_task = subcommands.add_parser("new-task", help="Create task workflow artifacts.")
    new_task.add_argument("title", help="Task title.")
    new_task.add_argument("--level", choices=["auto", "L1", "L2", "L3"], default="L2")
    new_task.add_argument("--reason", default=DEFAULT_REASON)
    new_task.add_argument("--summary", default="由主 Agent 在 intake_hook 中补充。")
    new_task.add_argument("--date", default=date.today().isoformat())
    new_task.add_argument("--project-root", default=".", help="Project root to modify.")
    new_task.add_argument("--force", action="store_true", help="Overwrite existing generated files.")

    assess_risk = subcommands.add_parser("assess-risk", help="Recommend L1/L2/L3 from task text.")
    assess_risk.add_argument("text", help="Task description to assess.")
    assess_risk.add_argument("--project-root", default=".", help="Project root, accepted for CLI consistency.")

    return parser.parse_args(argv)


def relative(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix()


def has_agent_entrypoint(root: Path) -> bool:
    return (root / "Agent.md").exists() or (root / "AGENTS.md").exists()


def has_superpowers() -> bool:
    home = Path.home()
    candidates = [
        home / ".codex" / "superpowers" / "skills",
        home / ".agents" / "skills",
        home / ".codex" / "plugins" / "cache" / "openai-api-curated" / "superpowers",
    ]
    return any(path.exists() for path in candidates)


def markdown_fences_are_balanced(root: Path) -> tuple[bool, list[str]]:
    broken: list[str] = []
    for path in root.rglob("*.md"):
        if any(part in IGNORED_MARKDOWN_DIRS for part in path.relative_to(root).parts):
            continue
        text = path.read_text(encoding="utf-8")
        if text.count("```") % 2 != 0:
            broken.append(relative(path, root))
    return not broken, broken


def run_doctor(root: Path) -> int:
    failed = False

    if has_agent_entrypoint(root):
        entry_missing = False
    else:
        entry_missing = True
        failed = True
        print("FAIL missing Agent.md or AGENTS.md")

    required_files = [
        ".agent-workflow/WORKFLOW.md",
        ".agent-workflow/SKILLS.md",
        ".agent-workflow/STATE_RULES.md",
        ".agent-workflow/state.md",
        "PROJECT_PROFILE.md",
    ]
    for item in required_files:
        if not (root / item).exists():
            failed = True
            print(f"FAIL missing {item}")

    if not failed or not entry_missing:
        if all((root / item).exists() for item in required_files) and not entry_missing:
            print("PASS required files present")

    missing_roles = [
        name for name in EXPECTED_ROLE_DOCS if not (root / ".agent-workflow" / "agents" / name).exists()
    ]
    if missing_roles:
        failed = True
        for name in missing_roles:
            print(f"FAIL missing .agent-workflow/agents/{name}")
    else:
        print("PASS role documents present")

    for name in EXPECTED_TEMPLATE_DOCS:
        path = root / ".agent-workflow" / "templates" / name
        if not path.exists():
            failed = True
            print(f"FAIL missing .agent-workflow/templates/{name}")

    for name in EXPECTED_WORK_DIRS:
        if not (root / name).is_dir():
            failed = True
            print(f"FAIL missing directory {name}")

    state_path = root / ".agent-workflow" / "state.md"
    if state_path.exists():
        state_text = state_path.read_text(encoding="utf-8")
        for heading in STATE_HEADINGS:
            if heading not in state_text:
                failed = True
                print(f"FAIL state.md missing heading {heading}")

    profile_path = root / "PROJECT_PROFILE.md"
    if profile_path.exists():
        profile_text = profile_path.read_text(encoding="utf-8")
        if "[填写" in profile_text or "[命令" in profile_text or "[说明" in profile_text:
            print("WARN PROJECT_PROFILE.md still has placeholders")
        else:
            print("PASS PROJECT_PROFILE.md appears filled")

    if has_superpowers():
        print("PASS Superpowers skills found")
    else:
        print("WARN Superpowers skills not found in common local paths")

    balanced, broken = markdown_fences_are_balanced(root)
    if balanced:
        print("PASS markdown code fences balanced")
    else:
        failed = True
        for path in broken:
            print(f"FAIL unbalanced markdown code fence in {path}")

    return 1 if failed else 0


def slugify(title: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", title.strip().lower()).strip("-")
    return slug or "task"


def ensure_workflow_dirs(root: Path) -> None:
    for item in EXPECTED_WORK_DIRS:
        (root / item).mkdir(parents=True, exist_ok=True)


def assess_risk(text: str) -> RiskAssessment:
    normalized = text.lower()
    matched_levels: list[str] = []
    reasons: list[str] = []

    for level, reason, keywords in RISK_RULES:
        if any(keyword in normalized for keyword in keywords):
            matched_levels.append(level)
            reasons.append(reason)

    if "L3" in matched_levels:
        return RiskAssessment("L3", sorted(set(reasons)))
    if "L2" in matched_levels:
        return RiskAssessment("L2", sorted(set(reasons)))
    return RiskAssessment("L1", ["small scoped change"])


def format_assessment_reason(assessment: RiskAssessment) -> str:
    return "自动风险评分：{}。".format(", ".join(assessment.reasons))


def run_assess_risk(args: argparse.Namespace) -> int:
    assessment = assess_risk(args.text)
    print(f"Recommended level: {assessment.level}")
    print("Reasons:")
    for reason in assessment.reasons:
        print(f"- {reason}")
    return 0


def render_spec(title: str, level: str, reason: str, summary: str) -> str:
    return f"""# {title} SPEC

## 背景
{summary}

## 目标
由主 Agent 在 intake_hook 中补充可验证目标。

## 非目标
由主 Agent 在 intake_hook 中补充明确不做的内容。

## 用户路径 / 调用路径
由主 Agent 在 intake_hook 中补充用户操作路径或系统调用路径。

## 功能要求
- 由主 Agent 在 intake_hook 中拆解需求。

## 边界情况
- 空输入：由主 Agent 补充。
- 非法输入：由主 Agent 补充。
- 重复输入：由主 Agent 补充。
- 外部服务失败：由主 Agent 补充。

## 技术选择
- 语言/框架：读取 PROJECT_PROFILE.md 后确认。
- 测试：读取 PROJECT_PROFILE.md 后确认。
- 包管理：读取 PROJECT_PROFILE.md 后确认。
- 数据库：读取 PROJECT_PROFILE.md 后确认。
- 部署：读取 PROJECT_PROFILE.md 后确认。

## 文件边界
- 允许修改：由主 Agent 在实施计划中列出具体路径。
- 禁止修改：由主 Agent 在实施计划中列出配置、密钥、迁移或用户文件边界。
- 需要先读取：PROJECT_PROFILE.md、相关源码、相关测试、当前状态文件。

## 依赖关系
- 前置任务：无，或由主 Agent 补充。
- 依赖模块：由主 Agent 根据代码结构补充。
- 可并行任务：由主 Agent 判断，只有互不共享文件的任务才可并行。

## 任务拆分判断
- 是否需要拆分：由主 Agent 判断。
- 拆分理由：如果跨多个子系统、跨前后端、跨数据模型和部署，应拆成多个 SPEC。

## 风险等级
{level}

## 触发原因
{reason}

## 验收标准
- SPEC 经用户确认。
- 任务卡已派发给 {level} 对应角色。
- 完成前写入真实验证记录和交付报告。

## 验收证据
- 必须记录实际运行的测试、构建、lint 或人工验证命令。
- 必须记录命令结果摘要。
- 未验证项必须明确列出，不得用“应该可以”代替证据。
"""


def render_task_card(title: str, level: str, reason: str, spec_path: str) -> str:
    roles = ROLE_SETS[level]
    role_lines = "\n".join(f"- {role}" for role in roles)
    skill_lines = "\n".join(f"- {ROLE_SKILLS[role]}" for role in roles)
    skill_table = "\n".join(
        f"| `{ROLE_SKILLS[role]}` | AVAILABLE_NOT_READ | Superpowers 或项目环境 | {role} 启动前必须确认 |"
        for role in roles
    )

    return f"""# {title} 任务卡

## 角色
{role_lines}

## 任务等级
{level}

## 当前 Hook
intake_hook

## 必加载 Skill
{skill_lines}

## Skill 加载说明
| Skill | 状态 | 来源 | 说明 |
|-------|------|------|------|
{skill_table}

## 角色说明文档
`.agent-workflow/agents/`

## 输入
- SPEC：`{spec_path}`
- 相关文件：由主 Agent 在 intake_hook 中补充。
- 前置产出：无。

## 允许触碰文件
- 由主 Agent 在实施计划中补充。

## 禁止事项
- 未确认 SPEC 前不得进入实现。
- 未更新 `.agent-workflow/state.md` 前不得进入下一个 hook。
- 不得跳过当前等级要求的质量门。

## 预期产出
- SPEC 确认记录。
- 对应角色交接记录。
- 验证记录。
- 交付报告。

## 验证命令
```bash
读取 PROJECT_PROFILE.md 后补充
```

## 完成标准
- {reason}
- 所有启用角色给出 PASS，或明确 BLOCKED 并等待用户决策。
"""


def render_handoff(title: str, level: str, spec_path: str, task_card_path: str) -> str:
    return f"""# {title} 初始交接

## 本轮角色
主 Agent

## 当前 Hook
intake_hook

## 结论
RUNNING

## 完成内容
- 创建初始 SPEC：`{spec_path}`
- 创建任务卡：`{task_card_path}`
- 更新工作流状态。

## 修改文件
- `{spec_path}`
- `{task_card_path}`
- `.agent-workflow/state.md`

## 验证结果
- 命令：待补充
- 结果：待补充

## 风险或遗留问题
- 当前任务等级为 {level}，需要先完成 SPEC 澄清。

## 建议下一步
主 Agent 读取 PROJECT_PROFILE.md，补全 SPEC 并请求用户确认。
"""


def render_state(title: str, level: str, reason: str) -> str:
    rows = ["| 主 Agent | RUNNING | intake_hook |"]
    rows.extend(f"| {role} | READY | 待派发 |" for role in ROLE_SETS[level])
    role_table = "\n".join(rows)

    return f"""# Agent Workflow State

## 当前任务
{title}

## 风险等级
{level}

## 当前 Hook
intake_hook

## 当前阶段
spec

## 已派发角色
| 角色 | 状态 | 产出 |
|------|------|------|
{role_table}

状态只能使用：`READY / RUNNING / PASS / FAIL / BLOCKED / SKIPPED`

## 阻塞点
无

## 用户待确认
SPEC、任务范围、验收标准

## 下一步
主 Agent 补全 SPEC，说明风险等级触发原因：{reason}

## 决策记录
| 时间 | 决策 | 理由 |
|------|------|------|
"""


def run_new_task(args: argparse.Namespace) -> int:
    root = Path(args.project_root).resolve()
    workflow_root = root / ".agent-workflow"
    if not workflow_root.exists():
        print("FAIL missing .agent-workflow directory")
        return 1

    ensure_workflow_dirs(root)
    level = args.level
    reason = args.reason
    if level == "auto":
        assessment = assess_risk(f"{args.title}\n{args.summary}\n{args.reason}")
        level = assessment.level
        if reason == DEFAULT_REASON:
            reason = format_assessment_reason(assessment)

    stem = f"{args.date}-{slugify(args.title)}"
    spec_path = root / ".agent-workflow" / "specs" / f"{stem}.md"
    task_card_path = root / ".agent-workflow" / "task-cards" / f"{stem}.md"
    handoff_path = root / ".agent-workflow" / "handoffs" / f"{stem}.md"
    state_path = root / ".agent-workflow" / "state.md"

    generated = [spec_path, task_card_path, handoff_path]
    existing = [path for path in generated if path.exists()]
    if existing and not args.force:
        for path in existing:
            print(f"FAIL {relative(path, root)} already exists")
        return 1

    spec_rel = relative(spec_path, root)
    task_card_rel = relative(task_card_path, root)
    handoff_rel = relative(handoff_path, root)

    spec_path.write_text(render_spec(args.title, level, reason, args.summary), encoding="utf-8")
    task_card_path.write_text(
        render_task_card(args.title, level, reason, spec_rel),
        encoding="utf-8",
    )
    handoff_path.write_text(
        render_handoff(args.title, level, spec_rel, task_card_rel),
        encoding="utf-8",
    )
    state_path.write_text(render_state(args.title, level, reason), encoding="utf-8")

    print(f"CREATED {spec_rel}")
    print(f"CREATED {task_card_rel}")
    print(f"CREATED {handoff_rel}")
    print("UPDATED .agent-workflow/state.md")
    return 0


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    if args.command == "doctor":
        return run_doctor(Path(args.project_root).resolve())
    if args.command == "assess-risk":
        return run_assess_risk(args)
    if args.command == "new-task":
        return run_new_task(args)
    raise ValueError(f"Unsupported command: {args.command}")


if __name__ == "__main__":
    raise SystemExit(main())
