# 子 Agent 任务卡

## 角色
②开发工程师

## 任务等级
L3

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
- SPEC：`.agent-workflow/examples/high-risk-ai-api/01-spec.md`
- 测试 handoff：`.agent-workflow/examples/high-risk-ai-api/03-handoff-test.md`
- 测试文件：`tests/test_ai_summary_api.py`

## 允许触碰文件
- `src/api/ai_summary.py`
- `src/server.py`

## 禁止事项
- 禁止修改测试文件。
- 禁止把 `AI_API_KEY` 暴露到前端。
- 禁止记录完整 API Key。
- 禁止返回假成功兜底摘要。
- 禁止无超时调用外部 AI 服务。

## 预期产出
- 新增 `POST /api/ai/summary`。
- 测试通过。

## 验证命令
```bash
pytest tests/test_ai_summary_api.py -v
```

## 完成标准
- 测试通过。
- 错误路径返回正确状态码。
- API Key 仅从后端环境变量读取。

