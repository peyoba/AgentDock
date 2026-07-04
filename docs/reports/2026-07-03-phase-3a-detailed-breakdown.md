# AgentDock Phase 3a 高优先级任务详解

**阶段**: Phase 3a（2-3 周）
**目标**: 完善 MVP 功能，为生产环境做准备
**预期产出**: 更完整的配置管理和更好的用户体验

---

## 📌 Task 1: Profile 删除功能

### 当前状态
- ✅ 可以新增 Profile
- ✅ 可以编辑 Profile
- ❌ **无法删除 Profile**

### 问题描述
用户创建了错误的配置或不需要的配置，但无法删除。只能通过手动编辑 `profiles.json` 来删除。

### 实现方案

#### 1.1 UI 层 (ApiConfigPanel.tsx)
```typescript
// 在配置卡片上添加删除按钮
<button className="delete-button" onClick={() => handleDeleteProfile(profile.id)}>
  删除
</button>

// 删除前弹出确认对话框
if (window.confirm(`确定要删除 "${profile.name}" 这个配置吗？`)) {
  await window.agentDock.deleteProfile(profileId);
}
```

#### 1.2 Preload 层 (preload.cts)
```typescript
// 添加 deleteProfile IPC 调用
deleteProfile: (profileId: string) =>
  ipcRenderer.invoke('profiles:delete', { profileId })
```

#### 1.3 Main 层 (main.ts)
```typescript
// 注册 IPC handler
ipcMain.handle('profiles:delete', async (event, { profileId }) => {
  return profileStore.deleteProfile(profileId);
});
```

#### 1.4 Store 层 (profileStore.ts)
```typescript
deleteProfile(profileId: string): void {
  const profiles = this.list().filter(p => p.id !== profileId);
  this.saveProfiles(profiles);

  // 如果删除的是当前选中的配置，需要清除 renderer 的选择
  sendUpdateToRenderer({ type: 'profileDeleted', profileId });
}
```

#### 1.5 测试 (App.test.tsx)
```typescript
it('can delete a profile after confirmation', async () => {
  // 创建两个 Profile
  // 删除其中一个
  // 验证配置列表更新
  // 验证当前选中配置被清除（如果是删除的那个）
});
```

### 技术细节
- **默认保护**: 不能删除最后一个配置（至少保留一个）
- **级联处理**: 如果删除的配置当前被选中，自动切换到第一个可用的
- **软删除 vs 硬删除**: 采用硬删除（直接从 JSON 中移除）
- **撤销**: 暂不实现撤销功能（可后续考虑）

### 工作量估计
- UI: 1 hour
- IPC/Main/Store: 1 hour
- 测试: 1 hour
- **总计**: ~3 hours

---

## 📌 Task 2: 启动命令权限参数可配置化

### 当前状态
- ✅ Claude 使用 `--dangerously-skip-permissions`
- ✅ Codex 使用 `--dangerously-bypass-approvals-and-sandbox`
- ❌ **用户无法修改这些参数**

### 问题描述
用户可能想要在某些情况下启用权限检查，但当前默认配置无法改变。

### 实现方案

#### 2.1 数据模型扩展 (agentdockTypes.ts)
```typescript
interface ApiProfile {
  // ... 现有字段 ...

  // 新增字段
  skipPermissions?: boolean;  // 是否跳过权限检查
  bypassApprovals?: boolean;  // 是否跳过批准和沙箱（Codex）
}
```

#### 2.2 UI 层 (ApiConfigPanel.tsx)
```typescript
// 在"高级设置"中新增开关
<div className="advanced-setting">
  <label>
    <input
      type="checkbox"
      checked={draft.skipPermissions ?? true}
      onChange={(e) => updateDraft('skipPermissions', e.target.checked)}
      disabled={profile.toolType !== 'claude'}
    />
    <span>启动时跳过权限检查</span>
  </label>
  <small>
    仅 Claude 可用。启用后在启动命令中添加 --dangerously-skip-permissions
  </small>
</div>

<div className="advanced-setting">
  <label>
    <input
      type="checkbox"
      checked={draft.bypassApprovals ?? true}
      onChange={(e) => updateDraft('bypassApprovals', e.target.checked)}
      disabled={profile.toolType !== 'codex'}
    />
    <span>启动时跳过批准和沙箱</span>
  </label>
  <small>
    仅 Codex 可用。启用后在启动命令中添加 --dangerously-bypass-approvals-and-sandbox
  </small>
</div>
```

#### 2.3 命令生成逻辑 (App.tsx)
```typescript
function defaultCommandFor(profile: ApiProfile, skipPermissions?: boolean): string {
  if (profile.toolType === 'claude') {
    const perms = skipPermissions ?? profile.skipPermissions ?? true;
    return perms ? 'claude --dangerously-skip-permissions' : 'claude';
  }

  if (profile.toolType === 'codex') {
    const bypass = skipPermissions ?? profile.bypassApprovals ?? true;
    return bypass ? 'codex --dangerously-bypass-approvals-and-sandbox' : 'codex';
  }

  return `${profile.toolType}`;
}
```

#### 2.4 测试
```typescript
it('allows user to disable permission skipping for Claude', async () => {
  // 编辑 Claude 配置
  // 取消勾选"跳过权限检查"
  // 启动会话
  // 验证启动命令不包含 --dangerously-skip-permissions
});
```

### 设计考量
- **默认值**: 保持现有行为（默认启用跳过）
- **只读**: 针对不支持该选项的工具（如 Gemini）禁用
- **说明文本**: 清晰解释每个选项的含义
- **后期调整**: 支持在会话启动前临时改写命令

### 工作量估计
- 数据模型: 0.5 hour
- UI: 1 hour
- 命令逻辑: 0.5 hour
- 测试: 1 hour
- **总计**: ~3 hours

---

## 📌 Task 3: 配置迁移机制和 Schema Versioning

### 当前状态
- ✅ profiles.json、workspaces.json、secrets.vault.json 都能存储
- ❌ **无版本管理，无迁移机制**

### 问题描述
当前使用的是简单的 JSON 存储。如果将来需要修改数据结构（比如新增字段、删除字段、字段重命名），旧数据格式会导致：
- 数据读取失败
- 类型检查错误
- 用户数据丢失

### 实现方案

#### 3.1 版本化数据结构
```typescript
// profileStore.ts

interface ProfileStoreFormat {
  version: 1;  // 当前版本
  profiles: ApiProfile[];
}

interface WorkspaceStoreFormat {
  version: 1;
  workspaces: Workspace[];
}

interface VaultStoreFormat {
  version: 1;
  encryptedEntries: {
    [key: string]: { salt: string; iv: string; ciphertext: string };
  };
}
```

#### 3.2 迁移函数
```typescript
// 迁移规则
const migrations: { [version: number]: (data: any) => any } = {
  0: (data) => {
    // 从无版本的数据格式迁移到 v1
    // 比如添加新的默认字段
    return {
      version: 1,
      profiles: data.map((p: any) => ({
        ...p,
        skipPermissions: p.skipPermissions ?? true,  // 新字段默认值
      })),
    };
  },

  // 如果将来有 v2，就在这里添加从 v1 -> v2 的迁移
};

// 读取时自动迁移
load(): ProfileStoreFormat {
  const rawData = fs.readFileSync(this.filePath, 'utf-8');
  const data = JSON.parse(rawData);

  const currentVersion = data.version ?? 0;
  let migratedData = data;

  // 顺序执行迁移
  for (let v = currentVersion; v < CURRENT_VERSION; v++) {
    if (migrations[v]) {
      migratedData = migrations[v](migratedData);
    }
  }

  // 如果有变化，写回文件
  if (migratedData.version !== currentVersion) {
    fs.writeFileSync(this.filePath, JSON.stringify(migratedData, null, 2));
  }

  return migratedData;
}
```

#### 3.3 测试
```typescript
it('migrates from v0 to v1 automatically', () => {
  // 创建一个 v0 格式的 profiles.json
  // 读取它
  // 验证自动迁移到 v1
  // 验证新字段有默认值
});
```

### 设计原则
- **向后兼容**: 旧版数据能自动迁移到新版
- **向前不兼容**: 不尝试加载比当前版本更新的数据格式
- **自动备份**: 迁移前备份原始文件
- **故障恢复**: 迁移失败时恢复备份并报错

### 工作量估计
- 架构设计: 1 hour
- 实现迁移框架: 1.5 hours
- 编写迁移规则: 0.5 hour
- 测试: 1 hour
- **总计**: ~4 hours

---

## 📌 Task 4: 错误消息完全中文化

### 当前状态
- ✅ 主要错误路径已中文化（如 API Key 解密失败）
- ⚠️ 某些边界情况仍是英文
- ❌ **底层错误（如网络错误）可能是英文**

### 问题描述
用户看到英文错误信息，无法理解发生了什么。比如：
- `ENOENT: no such file or directory`
- `Network timeout`
- `Invalid JSON`

### 实现方案

#### 4.1 错误映射表 (errorMessages.ts)
```typescript
const errorMessageMap: { [key: string]: string } = {
  // 文件系统错误
  'ENOENT': '文件或目录不存在',
  'EACCES': '没有权限访问文件',
  'EISDIR': '这是一个目录，不是文件',

  // 网络错误
  'ECONNREFUSED': '连接被拒绝，请检查服务器是否在运行',
  'ETIMEDOUT': '连接超时，请检查网络连接',
  'ECONNRESET': '连接被重置，请稍后重试',

  // API 错误
  '401': '认证失败，请检查 API Key 是否正确',
  '403': '访问被拒绝，可能权限不足',
  '404': '资源未找到',
  '500': '服务器内部错误，请稍后重试',

  // JSON 解析错误
  'SyntaxError': '返回的数据格式无效',
};

export function humanizeError(error: Error | string): string {
  if (typeof error === 'string') {
    return errorMessageMap[error] || error;
  }

  // 尝试匹配错误类型和代码
  const message = error.message;

  // 首先尝试直接匹配错误代码（如 "ENOENT"）
  for (const [code, chinese] of Object.entries(errorMessageMap)) {
    if (message.includes(code)) {
      return chinese;
    }
  }

  // 如果找不到，返回原始错误信息的前半部分
  return message.split('\n')[0].substring(0, 100);
}
```

#### 4.2 使用位置
```typescript
// 在所有 catch 块中使用
try {
  const models = await fetchModels(profile);
  setModelOptions(models);
} catch (error) {
  const humanError = humanizeError(error);
  setError(humanError);  // 显示中文错误
}
```

#### 4.3 测试
```typescript
it('converts file system errors to Chinese', () => {
  const error = new Error('ENOENT: no such file or directory, open /path/to/file');
  expect(humanizeError(error)).toBe('文件或目录不存在');
});

it('converts network errors to Chinese', () => {
  const error = new Error('ETIMEDOUT: connection timeout');
  expect(humanizeError(error)).toBe('连接超时，请检查网络连接');
});
```

### 工作量估计
- 构建错误映射表: 1 hour
- 集成到错误处理: 1 hour
- 测试覆盖: 1 hour
- **总计**: ~3 hours

---

## 📌 Task 5: Git 推送前自动安全检查脚本

### 当前状态
- ✅ 能手动运行 `npm test`、`npm run typecheck`
- ❌ **无自动化的推送前检查**

### 问题描述
开发者容易忘记在推送前做安全检查，可能会：
- 上传真实 API Key
- 上传 `.env` 文件
- 上传 `secrets.vault.json`
- 上传 `dist/`、`release/` 等构建产物

### 实现方案

#### 5.1 创建 Git Pre-push Hook (scripts/pre-push.sh)
```bash
#!/bin/bash

set -e

echo "🔍 Running pre-push security checks..."
echo ""

# 1. 检查 staged 文件中的敏感内容
echo "1️⃣ Scanning for secrets..."
files=$(git diff --cached --name-only)

forbidden_patterns=(
  "sk-"                          # OpenAI keys
  "gsk_"                         # Anthropic keys
  "---BEGIN PRIVATE KEY---"      # Private keys
  "\"ANTHROPIC_API_KEY\""       # Env vars with real keys
  "OPENAI_API_KEY="
  "CODEX_API_KEY="
)

found_secrets=0
for pattern in "${forbidden_patterns[@]}"; do
  if git diff --cached | grep -E "$pattern" | grep -v "test" | grep -v "mock"; then
    echo "❌ Potential secret found: $pattern"
    found_secrets=1
  fi
done

# 2. 检查禁止上传的文件
echo ""
echo "2️⃣ Checking for forbidden files..."
forbidden_files=(
  "secrets.vault.json"
  ".env"
  ".env.local"
  ".env.*.local"
)

for file in "${forbidden_files[@]}"; do
  if git diff --cached --name-only | grep -E "$file"; then
    echo "❌ Forbidden file detected: $file"
    found_secrets=1
  fi
done

# 3. 检查 node_modules 等构建产物
echo ""
echo "3️⃣ Checking for build artifacts..."
build_artifacts=(
  "node_modules/"
  "dist/"
  "release/"
  "out/"
  "*.asar"
)

for artifact in "${build_artifacts[@]}"; do
  if git diff --cached --name-only | grep -E "$artifact"; then
    echo "❌ Build artifact detected: $artifact"
    found_secrets=1
  fi
done

# 4. 运行测试
echo ""
echo "4️⃣ Running tests..."
npm test || {
  echo "❌ Tests failed!"
  exit 1
}

# 5. 运行类型检查
echo ""
echo "5️⃣ Running typecheck..."
npm run typecheck || {
  echo "❌ Typecheck failed!"
  exit 1
}

# 6. 构建验证
echo ""
echo "6️⃣ Verifying build..."
npm run build || {
  echo "❌ Build failed!"
  exit 1
}

# 最终结果
echo ""
if [ $found_secrets -eq 1 ]; then
  echo "❌ Pre-push check FAILED"
  exit 1
fi

echo "✅ All pre-push checks passed!"
echo "Ready to push 🚀"
exit 0
```

#### 5.2 安装 Hook (package.json)
```json
{
  "scripts": {
    "prepare": "node scripts/setup-git-hooks.js"
  }
}
```

#### 5.3 Hook 设置脚本 (scripts/setup-git-hooks.js)
```javascript
const fs = require('fs');
const path = require('path');

const hookDir = path.join(__dirname, '..', '.git', 'hooks');
const prePushHook = path.join(hookDir, 'pre-push');

// 复制脚本到 .git/hooks/
fs.copyFileSync(
  path.join(__dirname, 'pre-push.sh'),
  prePushHook
);

// 添加执行权限
fs.chmodSync(prePushHook, '755');

console.log('✅ Git hooks installed');
```

#### 5.4 使用方式
```bash
# 首次安装（npm install 会自动运行）
npm install

# 第一次推送时会自动运行检查
git push origin main

# 如果检查失败，修复后重新推送
# 如果想绕过检查（不推荐），使用：
git push --no-verify
```

### 工作量估计
- 编写脚本: 1.5 hours
- 测试脚本: 0.5 hour
- 文档: 0.5 hour
- **总计**: ~2.5 hours

---

## 📊 Phase 3a 总体规划

| Task | 描述 | 工作量 | 优先级 | 依赖 |
|------|------|--------|--------|------|
| 1 | Profile 删除功能 | 3h | 🔴 高 | 无 |
| 2 | 启动命令可配置化 | 3h | 🔴 高 | 无 |
| 3 | Schema Versioning | 4h | 🟡 中 | 无 |
| 4 | 错误消息中文化 | 3h | 🟡 中 | 无 |
| 5 | Git 安全检查脚本 | 2.5h | 🟢 低 | 无 |
| | **总计** | **15.5h** | | |

### 建议执行顺序
1. Task 1 - Profile 删除（独立，即时价值高）
2. Task 2 - 启动命令可配置（用户需求）
3. Task 3 - Schema Versioning（为未来做准备）
4. Task 4 - 错误消息中文化（用户体验）
5. Task 5 - Git 安全脚本（流程优化）

### 预期产出
- ✅ 完整的 Profile 生命周期管理（新建、编辑、删除）
- ✅ 用户可配置的启动参数
- ✅ 完善的数据迁移机制
- ✅ 友好的中文错误提示
- ✅ 自动化安全检查流程

---

## 🎯 下一步

1. **确认方向**: 你是否同意从这 5 个任务开始？
2. **调整优先级**: 是否需要改变执行顺序？
3. **新增需求**: 是否有其他想要优先处理的功能？
4. **时间规划**: 预期 2-3 周内完成全部，可以吗？

**等你的反馈！** 💬
