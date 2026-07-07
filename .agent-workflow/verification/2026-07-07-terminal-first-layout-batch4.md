# Batch 4 终端优先布局验证

## 结论

PASS。

## 实现范围

- 右侧项目面板默认收起为窄 rail，点击后展开并可收起。
- `workbench-layout` 增加终端列数约束变量：`--terminal-min-columns: 100` 与 `--terminal-min-width`。
- 右侧展开时使用三栏 grid；中窄屏下右侧面板转为 overlay，避免优先挤压终端。
- 中间终端区保持主工作区，`CommandBar` 仍作为唯一启动入口。

## 验证命令

- `npx vitest run tests/app/layoutPolish.test.ts -t "project panel collapsed"`：PASS。
- `npx vitest run tests/app/App.test.tsx -t "right project panel"`：PASS。
- `npx vitest run tests/app/layoutPolish.test.ts`：PASS，6 tests。
- `npx vitest run tests/app/App.test.tsx`：PASS，68 tests。
- `npm run typecheck`：PASS。
- `npm test`：PASS，44 files / 287 tests。
- `npm run workflow:doctor`：PASS。
- `npm run test:workflow`：PASS，8 passed。
- `npm run build`：PASS，仅 Vite chunk size warning。
- `git diff --check`：PASS。
- secret-like scan：PASS，无命中。

## 未验证项

- 本批次未做 Playwright/真机像素级列宽测量；终端列宽硬约束以 CSS 变量和布局规则测试覆盖。右侧真实文件树属于 Batch 5。
