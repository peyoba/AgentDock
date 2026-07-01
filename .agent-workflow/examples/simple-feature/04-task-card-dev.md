# 子 Agent 任务卡

## 角色
②开发工程师

## 任务等级
L2

## 当前 Hook
green_hook

## 必加载 Skill
- `test-driven-development`
- `systematic-debugging`

## Skill 加载说明
| Skill | 状态 | 来源 | 说明 |
|-------|------|------|------|
| `test-driven-development` | LOADED | `superpowers:test-driven-development` | 已读取 SKILL.md |
| `systematic-debugging` | LOADED | `superpowers:systematic-debugging` | 已读取 SKILL.md |

## 角色说明文档
`.agent-workflow/agents/02-developer.md`

## 输入
- SPEC：`.agent-workflow/examples/simple-feature/01-spec.md`
- 相关文件：CLI 入口文件
- 前置产出：`.agent-workflow/examples/simple-feature/03-handoff-test.md`

## 允许触碰文件
- `src/cli.py`

## 禁止事项
- 禁止修改测试文件。
- 禁止改变其他 CLI 参数行为。
- 禁止引入新依赖。

## 预期产出
- `tool --version` 输出 `tool 1.0.0`。
- 相关测试通过。

## 验证命令
```bash
pytest tests/test_cli_version.py -v
```

## 完成标准
- `tests/test_cli_version.py` PASS。
- 实现保持最小改动。

