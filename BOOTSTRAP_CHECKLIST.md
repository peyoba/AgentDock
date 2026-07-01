# Bootstrap Checklist

主 Agent 启动工作流前必须完成本清单。

## 1. 工作流文件

- [ ] 存在 `AGENTS.md` 或 `Agent.md`
- [ ] 存在 `.agent-workflow/WORKFLOW.md`
- [ ] 存在 `.agent-workflow/SKILLS.md`
- [ ] 存在 `.agent-workflow/state.md`
- [ ] 存在 `.agent-workflow/agents/`
- [ ] 存在 `.agent-workflow/templates/`

## 2. Superpowers

- [ ] 已检查 `superpowers:*` 是否可用
- [ ] 已读取 `superpowers:using-superpowers` 或等价入口 skill
- [ ] 如不可用，已尝试安装或启用 Superpowers
- [ ] 安装后已重新检查
- [ ] 如安装失败，已进入 `BLOCKED` 或获得用户允许降级

## 3. 项目信息

- [ ] 已识别语言和框架
- [ ] 已识别包管理器
- [ ] 已识别测试命令
- [ ] 已识别 lint/typecheck/build 命令
- [ ] 已识别环境变量来源
- [ ] 已识别运行入口
- [ ] 已检查是否已有 README 或项目约定

## 4. 风险初判

- [ ] 是否涉及登录/认证/授权
- [ ] 是否涉及支付/订单/交易
- [ ] 是否涉及数据库 schema 或迁移
- [ ] 是否涉及环境变量或密钥
- [ ] 是否涉及 AI API、外部 API、Webhook
- [ ] 是否涉及部署、CI/CD、Docker

## 5. 启动结论

```text
READY / BLOCKED
```

## 6. BLOCKED 原因

```text
[如无则写“无”]
```

## 7. 下一步

```text
[进入 intake_hook / 请求用户补充 / 安装 Superpowers / 降级执行]
```

