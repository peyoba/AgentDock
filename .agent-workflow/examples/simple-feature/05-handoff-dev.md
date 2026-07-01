# 工程角色交接

## 本轮角色
②开发工程师

## 当前 Hook
green_hook

## 结论
PASS

## 完成内容
- 在 CLI 参数解析中新增 `--version` 分支。
- 输出 `tool 1.0.0` 后以状态码 0 退出。
- 未修改其他参数行为。

## 修改文件
- `src/cli.py`

## 验证结果
- 命令：`pytest tests/test_cli_version.py -v`
- 结果：PASS

## 风险或遗留问题
- 版本号当前为常量 `1.0.0`，后续可接入包版本来源。

## 建议下一步
交给 ③验收工程师进入 `acceptance_hook`。

