# 子 Agent 任务卡

## 角色
①测试工程师

## 任务等级
L3

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
- SPEC：`.agent-workflow/examples/high-risk-ai-api/01-spec.md`
- 相关文件：现有 API 测试目录
- 前置产出：无

## 允许触碰文件
- `tests/test_ai_summary_api.py`

## 禁止事项
- 禁止调用真实 AI 服务。
- 禁止写入生产代码。
- 禁止把 API Key 写进测试。

## 预期产出
- API 失败测试，覆盖正常路径和关键异常路径。

## 验证命令
```bash
pytest tests/test_ai_summary_api.py -v
```

## 完成标准
- 测试失败，且失败原因是接口未实现或行为未实现。
- 失败不是语法错误、导入错误或测试收集错误。

