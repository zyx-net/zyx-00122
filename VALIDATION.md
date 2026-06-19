# 巡检端 & 日志链路 & 批次授权台账 验证脚本

覆盖场景：草稿保存链路、只读模式、状态串链、刷新不丢数据、导出链路、批次授权台账（预演确认、未授权拦截、交接后回滚、日志追溯、重新导出与重启后复核）

---

## 一 ~ 十、（原有验证流程保持不变，见上文）

---

## 十一、批次授权台账 - 预演确认流程（场景 A）

**验证目标**：管理员创建导入批次 → 预演 → 确认导入 → 自动弹出授权配置 → 配置后保存 → 授权生效

### 前置条件
1. 启动本地服务：`npm run dev`
2. 准备测试 CSV 文件（3 条记录以上的 tasks 数据）
3. 以管理员身份登录

### 步骤 A1：上传文件并预演
```
1. 进入管理员端 → 点击底部"导入"Tab
2. 选择目标数据表：任务 (tasks)
3. 点击"选择文件开始预演" → 选择测试 CSV 文件
4. 等待预演完成
```
**验证点**：
- ✅ 显示预演结果：总记录数、有效/警告/错误数量
- ✅ 数据预览表格正确显示记录内容
- ✅ 底部出现"确认导入"按钮

### 步骤 A2：确认导入并配置授权
```
1. 点击"确认导入"按钮
2. 等待导入完成
3. 自动弹出"批次授权配置"弹窗
```
**验证点**：
- ✅ 导入完成后 Toast 提示："导入完成，请配置批次授权"
- ✅ 自动弹出授权配置弹窗
- ✅ 弹窗标题显示为创建模式
- ✅ 显示三段用户选择器：查看人（蓝色）、回滚人（琥珀色）、接手人（绿色）
- ✅ 显示失效时间配置（永不失效/N小时/N天/自定义）
- ✅ 显示授权备注输入框
- ✅ 显示模板管理区块（可展开收起）

### 步骤 A3：配置授权参数并保存
```
1. 查看人：勾选"巡检员张三"、"巡检员李四"
2. 回滚人：勾选"巡检员张三"
3. 接手人：勾选"巡检员张三"
4. 失效时间：选择"7天后"
5. 授权备注：填写"6月批次任务导入授权"
6. 点击"保存授权"按钮
```
**验证点**：
- ✅ 保存成功 Toast 提示："授权配置已保存"
- ✅ 弹窗关闭，返回批次列表
- ✅ 批次卡片显示绿色"已授权 v1"标签
- ✅ 底部导航"授权"Tab 可点击进入台账页

---

## 十二、批次授权台账 - 未授权拦截流程（场景 B）

**验证目标**：同角色但未被授权的用户只能看到脱敏摘要，所有敏感操作被拦截

### 前置条件
1. 完成场景 A（已创建一个授权批次，查看人=张三+李四，回滚人=张三）
2. 以"巡检员王五"身份（未被授权）登录

### 步骤 B1：查看批次列表 - 脱敏显示
```
1. 进入巡检员端 → 点击底部"导入"Tab
2. 查看批次列表
```
**验证点**：
- ✅ 批次列表显示"以下 N 个批次您无权限查看详情"提示
- ✅ 未授权批次显示脱敏卡片（灰色背景）
- ✅ 脱敏卡片显示 🔒 Lock 图标
- ✅ 批次名显示为前半部分 `*` + `***`（如 `批次导入-202***`）
- ✅ 操作人显示为 `王**` 形式（仅保留首字）
- ✅ 卡片底部显示黄色授权提示：如"已授权给 巡检员张三、巡检员李四 等"
- ✅ 右侧显示"无权限"文字，而非详情/回滚按钮

### 步骤 B2：尝试各种操作 - 硬拦截
```
1. 直接在浏览器控制台调用：
   useImportStore.getState().canViewBatch(batch, 'inspector', 'inspector_wangwu')
   useImportStore.getState().canRollbackBatch(batch, 'inspector', 'inspector_wangwu')
   useImportStore.getState().canExportBatch(batch, 'inspector', 'inspector_wangwu')
```
**验证点**：
- ✅ canViewBatch 返回 `false`
- ✅ canRollbackBatch 返回 `false`
- ✅ canExportBatch 返回 `false`
- ✅ 脱敏卡片无任何可点击操作按钮

---

## 十三、批次授权台账 - 交接后回滚流程（场景 C）

**验证目标**：创建者将批次交接给他人 → 接手人获得完整权限 → 执行回滚

### 前置条件
1. 完成场景 A（已创建授权批次，接手人=张三）
2. 以管理员身份登录

### 步骤 C1：执行批次交接
```
1. 进入"授权台账"页面
2. 找到刚才创建的授权批次卡片
3. 点击卡片展开详情
4. 点击"交接"按钮
5. 当前负责人选择：管理员（admin）
6. 交接给选择：主管赵六（manager_zhao）
7. 点击"确认交接"
```
**验证点**：
- ✅ 交接成功 Toast 提示
- ✅ 配置版本号从 v1 变为 v2
- ✅ 操作时间线新增 `batch_handover` 记录："批次从 管理员 交接给 主管赵六"
- ✅ 快照列表新增 v2 版本快照
- ✅ 接手人列表更新为"主管赵六"

### 步骤 C2：赵六登录并执行回滚
```
1. 以"主管赵六"身份进入系统（或切换用户视角）
2. 进入"导入"Tab
3. 找到该批次 → 点击"详情"按钮验证可查看
4. 点击"导出"按钮验证可导出
5. 点击"回滚"按钮 → 填写回滚原因 → 确认回滚
```
**验证点**：
- ✅ 赵六可以查看批次详情（canViewBatch=true）
- ✅ 赵六可以导出批次数据（canExportBatch=true）
- ✅ 赵六可以执行回滚（canRollbackBatch=true）
- ✅ 回滚成功，批次状态变为"已回滚"
- ✅ 批次卡片显示回滚信息："已于 XXX 由 主管赵六 回滚"

---

## 十四、批次授权台账 - 日志追溯流程（场景 D）

**验证目标**：所有授权相关操作都有完整的时间线记录，可追溯

### 前置条件
1. 完成场景 A + C（已创建授权 + 执行交接 + 执行回滚）

### 步骤 D1：查看批次详情时间线
```
1. 进入"授权台账"页面
2. 找到目标批次 → 点击进入详情
3. 向下滚动到"操作时间线"区域
```
**验证点**（按时间倒序）：
- ✅ `batch_handover`：批次从 管理员 交接给 主管赵六
- ✅ `auth_create`：创建批次授权：查看人2人、回滚人1人、接手人1人
- ✅ 每条记录包含：操作图标、动作标签、操作人、时间戳
- ✅ 时间线左侧有圆点和连接线

### 步骤 D2：查看全局操作时间线
```
1. 进入"授权台账"页面
2. 点击顶部"操作时间线"Tab
```
**验证点**：
- ✅ 显示全局所有操作（auth_create/auth_update/auth_revoke/auth_restore/batch_handover/template_import/template_export）
- ✅ 按时间倒序排列
- ✅ 支持按批次筛选（如果实现）
- ✅ 每条记录有详细描述

### 步骤 D3：查看配置历史快照
```
1. 进入批次详情
2. 找到"配置历史快照"区域
3. 展开 v1 和 v2 快照
```
**验证点**：
- ✅ v1 快照：查看人=张三+李四，回滚人=张三，接手人=张三，创建时间
- ✅ v2 快照：接手人=主管赵六，其余与 v1 一致，更新时间
- ✅ 快照显示 `immutable: true` 标记（不可变）
- ✅ 旧快照内容不随后续授权变更而改变

---

## 十五、批次授权台账 - 授权模板导入导出与冲突检测（场景 E）

**验证目标**：授权模板可 JSON 导入导出，冲突检测正常工作

### 步骤 E1：创建授权模板
```
1. 进入"授权台账" → "授权模板"Tab
2. 在任意批次的授权配置弹窗中 → 展开"模板管理"
3. 配置：查看人=张三+李四，回滚人=张三，失效=7天，备注="常规任务导入"
4. 模板名称填写："常规导入授权模板"
5. 点击"保存为模板"
```
**验证点**：
- ✅ 模板创建成功
- ✅ 模板列表显示新增模板卡片
- ✅ 显示：模板名、版本 v1、创建时间

### 步骤 E2：导出模板为 JSON
```
1. 在模板卡片上点击"导出"按钮
2. 浏览器下载 JSON 文件
```
**验证点**：
- ✅ 下载文件：`authorization-template-*.json`
- ✅ JSON 结构包含：
  ```json
  {
    "schemaVersion": 1,
    "exportType": "authorization_template",
    "exportedAt": <timestamp>,
    "template": {
      "name": "常规导入授权模板",
      "viewers": ["inspector_zhangsan", "inspector_lisi"],
      "rollbackers": ["inspector_zhangsan"],
      "handoverPersons": [],
      "defaultExpiryHours": 168,
      "defaultNotes": "常规任务导入",
      "version": 1,
      "contentHash": "xxxxxxxx"
    }
  }
  ```

### 步骤 E3：修改 JSON 制造冲突并导入
```
1. 复制导出的 JSON 文件内容
2. 修改 template.name 为"常规导入授权模板"（同名）
3. 修改 template.viewers 添加 "unknown_user_xxx"（未知用户）
4. 修改 template.contentHash 为 "00000000"（哈希不匹配）
5. 在模板管理区粘贴修改后的 JSON → 点击"导入"
```
**验证点**：
- ✅ 显示冲突提示列表（红色警示框）：
  - 🔴 `duplicate_name`：已存在同名模板，将自动添加后缀
  - 🔴 `unknown_user`：存在未知用户 unknown_user_xxx，已跳过
  - 🔴 `template_version_mismatch`：模板内容哈希不匹配，可能已被篡改
- ✅ 模板被成功导入，名称自动变为"常规导入授权模板（导入）"
- ✅ 未知用户被过滤掉，viewers 中只有张三和李四
- ✅ 操作时间线新增 `template_import` 记录

---

## 十六、批次授权台账 - 撤销恢复流程（场景 F）

**验证目标**：授权可撤销（软删除），撤销后可恢复

### 前置条件
1. 存在一个已配置授权的批次

### 步骤 F1：撤销授权
```
1. 进入批次授权详情
2. 点击"撤销授权"按钮
3. 填写撤销原因："该批次任务已完成"
4. 点击"确认撤销（不可恢复？）"
```
**验证点**：
- ✅ 批次卡片状态变为"已撤销"（灰色标签）
- ✅ 操作时间线新增 `auth_revoke` 记录："撤销授权：该批次任务已完成"
- ✅ 配置版本号不变（撤销不生成新版本快照）
- ✅ 撤销后，非 admin 用户对该批次所有权限判断返回 false

### 步骤 F2：验证撤销后权限
```
以巡检员张三身份（原查看人）：
1. 查看批次列表 → 该批次显示脱敏摘要
2. 尝试查看详情 → Toast 提示"您没有查看该批次详情的权限"
```
**验证点**：
- ✅ 张三看到脱敏摘要而非完整卡片
- ✅ 详情查看被拦截
- ✅ 导出被拦截
- ✅ 回滚被拦截

### 步骤 F3：恢复授权
```
1. 管理员进入授权台账 → 找到已撤销批次
2. 点击"恢复授权"按钮
3. 确认恢复
```
**验证点**：
- ✅ 批次恢复为"已授权 vN"状态
- ✅ 操作时间线新增 `auth_restore` 记录
- ✅ 张三重新获得查看/导出权限

---

## 十七、批次授权台账 - 持久化验证：刷新与重启后复核（场景 G）

**验证目标**：所有授权状态、模板、时间线在刷新页面和重启应用后完整保留

### 步骤 G1：准备测试数据
```
确保系统中存在：
1. 至少 2 个已授权批次（一个正常、一个已撤销）
2. 至少 2 个授权模板（一个原始、一个导入的）
3. 至少 5 条操作时间线记录
```

### 步骤 G2：刷新页面验证
```
1. 在授权台账页面按 F5 刷新
2. 等待页面加载完成
```
**验证点**：
- ✅ 授权台账 Tab：所有授权批次完整显示（正常/已撤销/已过期）
- ✅ 每个批次的配置版本号、人员列表、备注完整保留
- ✅ 授权模板 Tab：所有模板完整显示
- ✅ 操作时间线 Tab：所有时间线记录完整保留
- ✅ Zustand persist 数据已从 localStorage 恢复

### 步骤 G3：重启应用验证
```
1. 完全关闭浏览器标签页
2. 停止开发服务器（Ctrl+C）
3. 重新启动：`npm run dev`
4. 重新打开 http://localhost:5173
5. 进入授权台账页面
```
**验证点**：
- ✅ IndexedDB 中所有数据完整保留：
  - `batchAuthorizations` 表：所有授权记录 + 快照 + 时间线
  - `authorizationTemplates` 表：所有模板
  - `operationTimeline` 表：所有操作记录
- ✅ 页面渲染与重启前完全一致
- ✅ 权限判断结果与重启前完全一致
- ✅ 导出的模板 JSON 哈希值与重启前一致

---

## 十八、批次授权台账 - 改动文件清单

| 文件 | 改动内容 |
|------|---------|
| [src/types/index.ts](file:///d:/workSpace/AI__SPACE/zyx-00122/src/types/index.ts) | 新增 AuthorizationPerson/Snapshot/Template/BatchAuthorization/DesensitizedBatchSummary/OperationTimelineEntry 等 10+ 类型；ImportBatch 新增 authorizationId |
| [src/db/index.ts](file:///d:/workSpace/AI__SPACE/zyx-00122/src/db/index.ts) | Dexie v3 → v4，新增 batchAuthorizations/authorizationTemplates/operationTimeline 三张表，importBatches 增加 authorizationId 索引 |
| [src/stores/useAuthorizationStore.ts](file:///d:/workSpace/AI__SPACE/zyx-00122/src/stores/useAuthorizationStore.ts) | 新建：批次授权核心状态管理，含权限判断、快照生成、模板导入导出、冲突检测、撤销恢复、Zustand persist 持久化 |
| [src/stores/useImportStore.ts](file:///d:/workSpace/AI__SPACE/zyx-00122/src/stores/useImportStore.ts) | 改造：canViewBatch/canRollbackBatch/canExportBatch 内部委托 useAuthorizationStore |
| [src/components/AuthorizationConfigModal.tsx](file:///d:/workSpace/AI__SPACE/zyx-00122/src/components/AuthorizationConfigModal.tsx) | 新建：授权配置弹窗，支持 create/edit 模式，三段用户选择器、时效配置、模板管理、冲突提示 |
| [src/pages/AuthorizationLedger.tsx](file:///d:/workSpace/AI__SPACE/zyx-00122/src/pages/AuthorizationLedger.tsx) | 新建：授权台账主页面，三个 Tab（授权台账/授权模板/操作时间线），含详情、交接、撤销恢复弹窗 |
| [src/pages/ImportCenter.tsx](file:///d:/workSpace/AI__SPACE/zyx-00122/src/pages/ImportCenter.tsx) | 改造：新增 DesensitizedBatchCard 脱敏卡片、批次创建后自动弹出授权配置、导出按钮权限判断、所有操作增加权限拦截 |
| [src/components/Layout.tsx](file:///d:/workSpace/AI__SPACE/zyx-00122/src/components/Layout.tsx) | 改造：底部导航新增"导入"和"授权"两个 Tab |
| [src/App.tsx](file:///d:/workSpace/AI__SPACE/zyx-00122/src/App.tsx) | 改造：新增 /authorization-ledger、/admin/authorization-ledger、/inspector/authorization-ledger 三条路由 |
| [README.md](file:///d:/workSpace/AI__SPACE/zyx-00122/README.md) | 新增批次授权台账章节：权限模型、核心特性、系统内置用户、数据库 Schema、验收流程建议、项目结构更新 |
| [VALIDATION.md](file:///d:/workSpace/AI__SPACE/zyx-00122/VALIDATION.md) | 新增 7 个验证场景（A~G）：预演确认、未授权拦截、交接后回滚、日志追溯、模板导入导出冲突、撤销恢复、刷新重启持久化 |
| [tests/authorization-ledger.spec.ts](file:///d:/workSpace/AI__SPACE/zyx-00122/tests/authorization-ledger.spec.ts) | 新建：Playwright 端到端测试脚本，覆盖上述所有场景 |

---

## 十九、运行命令

```bash
# TypeScript 类型检查（必须通过）
npm run check

# ESLint 检查（必须通过，pre-existing 警告除外）
npm run lint

# 启动开发服务器
npm run dev

# 运行授权台账端到端测试
npx playwright test tests/authorization-ledger.spec.ts --headed

# 运行所有测试
npx playwright test
```

---

## 二十、最终验收标准

所有以上场景全部验证通过，且：
- ✅ TypeScript 编译：0 错误
- ✅ ESLint：0 错误（pre-existing `react-hooks/exhaustive-deps` 警告除外）
- ✅ 批次权限：admin 全放行 → 创建者全放行 → 已撤销/过期拒绝 → 具体名单匹配
- ✅ 未授权用户：只看到脱敏摘要（批次名 `***`、创建人 `王**`、授权提示），详情/导出/回滚全被拦截
- ✅ 授权快照：每次变更生成新快照，旧快照 immutable 不可篡改，版本号递增
- ✅ 操作时间线：auth_create/auth_update/auth_revoke/auth_restore/batch_handover/template_import/template_export 全记录
- ✅ 模板导入导出：contentHash 校验、同名冲突自动改名、未知用户跳过，冲突提示完整显示
- ✅ 持久化：刷新页面、停止并重启开发服务器后，所有授权/模板/时间线数据完整保留
- ✅ Playwright 测试：authorization-ledger.spec.ts 全部通过

---

## 一、草稿链路全流程验证（场景 A）

**验证目标**：`编辑 → 自动保存 → 日志记录 → 刷新 → 恢复草稿 → 日志记录 → 提交 → 草稿删除无回写`

### 前置条件
1. 启动本地服务：`npm run dev`
2. 清空数据库（可选，避免历史数据干扰）
3. 管理员端创建一个可领取任务（如"电梯月度安全检查-6月"）

---

### 步骤 A1：领取任务 & 编辑内容触发自动保存
```
1. 进入巡检员端 → 点击"可领取"标签
2. 找到"电梯月度安全检查-6月" → 点击"领取任务"
3. 进入任务详情页 → 依次填写所有必填项：
   - 点位1（A栋电梯）：
     ✅ 电梯运行是否有异响 = 正常
     ✅ 紧急呼叫按钮是否可用 = 可用
     ✅ 载重标识是否清晰 = 清晰
     ✅ 年检证有效期 = 2026-12-31
   - 点位2（B栋电梯）：
     ✅ 电梯运行是否有异响 = 正常
     ✅ 紧急呼叫按钮是否可用 = 可用
     ✅ 层门是否完好 = 完好
     ✅ 现场照片 = 点击上传附件
4. 等待 1 秒（自动保存防抖 500ms）
```

**验证点**：
- ✅ 右上角显示"草稿已保存 X 分钟前"
- ✅ 进入日志页 → 看到 `领取任务` 日志（蓝色标签）
- ✅ 看到 **8 条 `自动保存` 日志**（靛蓝色标签），从"1 项答案"到"8 项答案"
- ✅ 每条自动保存日志详情包含：`模板 v1.0`、`共 N 项答案`、`（新建）`/`（更新）`

---

### 步骤 A2：刷新页面，验证草稿恢复
```
1. 在任务详情页按 F5 刷新
2. 等待页面加载完成
```

**验证点**：
- ✅ 所有答案自动恢复（正常、可用、清晰、2026-12-31 等）
- ✅ 右上角显示"草稿已保存 X 分钟前"
- ✅ 进入日志页 → 顶部看到 **`恢复草稿` 日志**（青色标签）
- ✅ 恢复草稿日志详情包含：`模板 v1.0`、`保存于 YYYY/MM/DD HH:MM:SS`、`共 8 项答案`
- ✅ 日志顺序：`恢复草稿` → `自动保存(×8)` → `领取任务`（时间倒序）

---

### 步骤 A3：修改内容后立刻提交，验证草稿无回写
```
1. 回到任务详情页
2. 修改某个答案（如"电梯运行是否有异响"从"正常"→"异响"）
3. **立刻（< 500ms 内）** 点击"提交巡检结果"按钮
4. 页面跳回任务列表
```

**验证点**：
- ✅ 任务列表中该任务状态变为"待审核"
- ✅ 进入日志页 → 顶部看到 `提交` 日志（琥珀色标签）
- ✅ **提交日志之后，没有任何新的 `自动保存` 日志**（关键！证明草稿回写 bug 已修复）
- ✅ 提交日志详情：`提交巡检结果（版本 1）`

---

## 二、submitted 只读模式验证（场景 C）

**验证目标**：已提交待审核任务进入详情页，所有控件禁用但可浏览

```
1. 在任务列表点击刚提交的任务（状态：submitted）
2. 进入详情页
```

**验证点**：
- ✅ 顶部显示蓝色提示条：`已提交待审核` + `该任务当前为只读模式，可查看填写内容，不可编辑`
- ✅ 右上角显示模板版本号 `v1.0`（而非草稿保存时间）
- ✅ 所有单选按钮：`opacity-50 cursor-not-allowed`，点击无反应
- ✅ 所有输入框：`disabled + readonly`，无法输入
- ✅ 所有"标记异常"按钮：`disabled`，点击无反应
- ✅ 底部按钮：文案为"已提交"，`disabled`
- ✅ 分页器（点位 1/2）：**可点击**，可切换浏览不同点位内容
- ✅ 刚修改的答案"异响"正确显示

---

## 三、approved 只读模式验证（场景 B）

**验证目标**：已审核通过任务进入详情页，所有控件禁用但可浏览

```
1. 切换到管理员端 → 审核标签
2. 找到刚才提交的任务 → 点击"通过"
3. 切换回巡检员端 → 我的任务列表
4. 点击该任务（状态：approved）
```

**验证点**：
- ✅ 顶部显示蓝色提示条：`已审核通过` + `该任务当前为只读模式，可查看填写内容，不可编辑`
- ✅ 右上角显示模板版本号 `v1.0`
- ✅ 所有单选按钮/输入框/标记异常按钮：全部 `disabled`
- ✅ 底部按钮：文案为"已通过"，`disabled`
- ✅ 分页器（点位 1/2）：**可点击**，可切换浏览
- ✅ 所有答案完整保留（异响、2026-12-31 等）

---

## 四、刷新不丢数据验证（场景 H）

**验证目标**：刷新页面或重开应用后，所有状态和日志保留

```
1. 在 approved 任务详情页按 F5 刷新
2. 等待页面加载完成
3. 再刷新一次
4. 完全关闭浏览器标签页 → 重新打开 http://localhost:5173
5. 选择巡检员 → 进入该任务详情页
```

**验证点**：
- ✅ 只读模式提示条：保留
- ✅ 所有控件 disabled：保留
- ✅ 按钮"已通过" disabled：保留
- ✅ 所有答案：保留
- ✅ 进入日志页 → 所有历史日志（领取、自动保存、恢复、提交、审核通过）：全部保留

---

## 五、rework 正常可编辑验证（场景 D）

**验证目标**：退回返工的任务可正常编辑、自动保存、提交，不被只读逻辑误伤

```
1. 管理员端：从模板创建新任务"消防设施周检-第25周"
2. 巡检员端：领取 → 填写 → 提交
3. 管理员端：审核 → 填写返工原因 → 点击"退回"
4. 巡检员端：进入该任务详情页（状态：rework）
```

**验证点**（代码层面已验证，可按需走浏览器流程）：
- ✅ **无** 只读模式提示条
- ✅ 所有控件：正常可点击/输入
- ✅ 右上角：显示草稿保存时间（而非版本号）
- ✅ 修改答案后等待 500ms → 日志页出现 `自动保存` 日志
- ✅ 底部按钮：文案为"提交巡检结果"，可点击
- ✅ 填写完整后点击提交 → 成功提交，状态变为 submitted
- ✅ 日志页出现 `退回返工` + `自动保存` + `提交` 日志，顺序正确

---

## 六、导出链路验证（场景 G）

**验证目标**：导出的 JSON 文件包含草稿保存/恢复日志

```
1. 进入日志页 → 点击右上角"导出数据"按钮
2. 勾选"全选" → 点击"导出 JSON 文件"
3. 下载完成后打开 inspection-data-*.json
```

**验证点**：
- ✅ JSON 包含 `eventLogs` 数组
- ✅ `eventLogs` 中包含 `action: "draft_save"` 的记录
  ```json
  {
    "id": "log-xxx",
    "taskId": "task-002",
    "action": "draft_save",
    "actor": "巡检员张三",
    "detail": "草稿已保存（模板 v1.0，共 8 项答案）（更新）",
    "timestamp": 1234567890
  }
  ```
- ✅ `eventLogs` 中包含 `action: "draft_load"` 的记录
  ```json
  {
    "id": "log-xxx",
    "taskId": "task-002",
    "action": "draft_load",
    "actor": "巡检员张三",
    "detail": "草稿已恢复（模板 v1.0，保存于 2026/6/19 03:20:46，共 8 项答案）",
    "timestamp": 1234567890
  }
  ```
- ✅ 日志时间戳顺序与实际操作顺序一致
- ✅ 任务状态、版本号与日志中的描述一致

---

## 七、状态硬拦截验证（第一轮修复）

**验证目标**：数据层硬拦截，而非仅 UI 层

### 已通过任务重复提交拦截
```
1. 直接调用 store.submitTask(task-002)（task-002 为 approved 状态）
2. 或在浏览器调试控制台执行
```
**验证点**：
- ✅ 返回 `{ ok: false, errors: ['任务已审核通过，不可再提交'] }`
- ✅ 日志页出现 `提交被拒` 日志，详情包含被拒原因
- ✅ task.status 仍为 `approved`，未被写回 `submitted`
- ✅ 未追加新版本号

### 乐观锁二次校验
```
1. 打开两个浏览器标签页，同一任务（in_progress）
2. 标签页 A：修改答案后提交
3. 标签页 B：修改答案后提交（A 提交完成后）
```
**验证点**：
- ✅ 标签页 B 提交失败，返回错误：`任务已提交，不可重复提交`
- ✅ 日志页出现 `提交被拒` 日志
- ✅ 任务状态仍为 `submitted`，未被覆盖

---

## 八、所有改动文件清单

| 文件 | 改动内容 |
|------|---------|
| [src/types/index.ts](file:///d:/workSpace/AI__SPACE/zyx-00122/src/types/index.ts) | EventAction 新增 `draft_save` / `draft_load` |
| [src/stores/useAppStore.ts](file:///d:/workSpace/AI__SPACE/zyx-00122/src/stores/useAppStore.ts) | Toast 类型扩展 `info` |
| [src/stores/useTaskStore.ts](file:///d:/workSpace/AI__SPACE/zyx-00122/src/stores/useTaskStore.ts) | saveDraft/loadDraft 加事件日志，状态硬拦截，乐观锁 |
| [src/components/CheckItemInput.tsx](file:///d:/workSpace/AI__SPACE/zyx-00122/src/components/CheckItemInput.tsx) | 新增 `disabled` props，全控件禁用 |
| [src/components/Toast.tsx](file:///d:/workSpace/AI__SPACE/zyx-00122/src/components/Toast.tsx) | 新增 `info` 类型样式（蓝色 + Info 图标） |
| [src/pages/Logs.tsx](file:///d:/workSpace/AI__SPACE/zyx-00122/src/pages/Logs.tsx) | actionConfig 补充新动作，修复 tasks 未加载问题 |
| [src/pages/inspector/Inspect.tsx](file:///d:/workSpace/AI__SPACE/zyx-00122/src/pages/inspector/Inspect.tsx) | 完整只读模式重构，草稿回写根因修复 |

---

## 九、运行命令

```bash
# TypeScript 类型检查（必须通过）
npm run check

# ESLint 检查（必须通过，pre-existing 警告除外）
npm run lint

# 启动开发服务器
npm run dev
```

---

## 十、验收标准

所有以上场景全部验证通过，且：
- ✅ TypeScript 编译：0 错误
- ✅ ESLint：0 错误（pre-existing `react-hooks/exhaustive-deps` 警告除外）
- ✅ 刷新页面后：所有状态、日志、答案完全保留
- ✅ 不同状态（in_progress / submitted / approved / rework）互不干扰
- ✅ 草稿链路完整可追溯：每一次编辑、自动保存、恢复、提交都有日志记录
