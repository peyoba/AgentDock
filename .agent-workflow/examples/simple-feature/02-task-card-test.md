# 子 Agent 任务卡

## 角色
①测试工程师

## 任务等级
L2

## 当前 Hook
red_hook

## 必加载 Skill
- `test-driven-development`
- `testing-anti-patterns`

## Skill 加载说明
| Skill | 状态 | 来源 | 说明 |
|-------|------|------|------|
| `test-driven-development` | LOADED | `superpowers:test-driven-development` | 已读取 SKILL.md |
| `testing-anti-patterns` | UNAVAILABLE_FALLBACK_USED | `.agent-workflow/agents/01-test-engineer.md` | 使用角色文档检查清单 |

## 角色说明文档
`.agent-workflow/agents/01-test-engineer.md`

## 输入
- SPEC：`.agent-workflow/examples/simple-feature/01-spec.md`
- 相关文件：现有 CLI 测试目录
- 前置产出：无

## 允许触碰文件
- `tests/test_cli_version.py`

## 禁止事项
- 禁止修改生产代码。
- 禁止读取待实现代码内部逻辑。
- 禁止写只验证 mock 的测试。

## 预期产出
- 新增失败测试：`tool --version` 输出 `tool 1.0.0`。

## 验证命令
```bash
pytest tests/test_cli_version.py -v
```

## 完成标准
- 测试失败。
- 失败原因是 `--version` 行为未实现，而不是语法错误或测试收集错误。

