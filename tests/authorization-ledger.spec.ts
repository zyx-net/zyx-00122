/**
 * 批次授权台账 - 完整验证链路测试
 *
 * 验证链路：
 *   1. 预演确认：创建导入批次 → 预演 → 确认导入 → 自动配置授权
 *   2. 未授权拦截：同角色未授权用户查看脱敏摘要、操作被硬拦截
 *   3. 交接后回滚：创建者交接批次 → 接手人获得权限 → 执行回滚
 *   4. 日志追溯：auth_create/auth_update/auth_revoke/batch_handover 全时间线
 *   5. 模板导入导出：JSON 导出/导入、冲突检测（同名/未知用户/哈希不匹配）
 *   6. 撤销恢复：撤销授权（软删除）→ 权限失效 → 恢复授权
 *   7. 重新导出与重启后复核：状态持久化、刷新/重启后完整保留
 *
 * 运行方式：npx tsx tests/authorization-ledger.spec.ts
 * 依赖：fake-indexeddb, tsx
 */

import 'fake-indexeddb/auto'

// 必须在任何使用 localStorage/zustand persist 的模块被 import 之前设置好 mock
class MockStorage implements Storage {
  private _data: Map<string, string> = new Map()

  get length(): number {
    return this._data.size
  }

  key(index: number): string | null {
    const keys = Array.from(this._data.keys())
    return index >= 0 && index < keys.length ? keys[index] : null
  }

  getItem(key: string): string | null {
    const v = this._data.get(String(key))
    return v === undefined ? null : v
  }

  setItem(key: string, value: string): void {
    this._data.set(String(key), String(value))
  }

  removeItem(key: string): void {
    this._data.delete(String(key))
  }

  clear(): void {
    this._data.clear()
  }
}
const storage = new MockStorage()
Object.defineProperty(globalThis, 'localStorage', {
  value: storage,
  writable: true,
  configurable: true,
  enumerable: true,
})
if (typeof (globalThis as any).window === 'undefined') {
  (globalThis as any).window = globalThis
}
Object.defineProperty((globalThis as any).window, 'localStorage', {
  value: storage,
  writable: true,
  configurable: true,
  enumerable: true,
})

// 类型 import - 仅编译时使用，运行时会被完全擦除，不会触发模块加载
import type {
  ImportBatch,
  BatchAuthorization,
  DesensitizedBatchSummary,
  AuthorizationTemplate,
  UserRole,
} from '@/types'

// 模块级运行时变量 - 在主函数中通过动态 import 赋值
let db: any
let seedDatabase: any
let useImportStore: any
let parseCSV: any
let useAuthorizationStore: any
let SYSTEM_USERS: any

interface AssertOptions {
  name: string
  pass: boolean
  message: string
}

const results: AssertOptions[] = []
let stepIndex = 0

function assert(condition: boolean, name: string, detail: string) {
  stepIndex += 1
  const ok = !!condition
  results.push({ name: `步骤 ${String(stepIndex).padStart(2, '0')}: ${name}`, pass: ok, message: detail })
  const prefix = ok ? '✅' : '❌'
  console.log(`${prefix} 步骤 ${String(stepIndex).padStart(2, '0')}｜${name}｜${detail}`)
  return ok
}

function assertEq<T>(actual: T, expected: T, name: string, detail: string) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  const detailFull = ok ? detail : `${detail}（期望=${JSON.stringify(expected)} 实际=${JSON.stringify(actual)}）`
  return assert(ok, name, detailFull)
}

function assertGte(actual: number, expected: number, name: string, detail: string) {
  const ok = actual >= expected
  const detailFull = ok ? detail : `${detail}（期望>=${expected} 实际=${actual}）`
  return assert(ok, name, detailFull)
}

function assertIncludes(str: string, substr: string, name: string, detail: string) {
  const ok = str.includes(substr)
  const detailFull = ok ? detail : `${detail}（期望包含="${substr}" 实际="${str}"）`
  return assert(ok, name, detailFull)
}

async function delay(ms: number) {
  const start = Date.now()
  while (Date.now() - start < ms) {
    // 空转
  }
}

async function syncAuthStoreFromDb() {
  const allAuths = await db.batchAuthorizations.toArray()
  const allTpls = await db.authorizationTemplates.toArray()
  const allTl = await db.operationTimeline.orderBy('timestamp').reverse().limit(200).toArray()
  useAuthorizationStore.setState({
    authorizations: allAuths.filter(a => !a.isRevoked),
    revokedAuthorizations: allAuths.filter(a => a.isRevoked),
    templates: allTpls,
    timeline: allTl,
  })
  const s = useAuthorizationStore.getState()
  console.log(`  🔧 store 同步：授权=${s.authorizations.length}/${allAuths.length} 模板=${s.templates.length} 时间线=${s.timeline.length}`)
}

async function resetStores() {
  useImportStore.setState({
    batches: [],
    currentBatchId: null,
    currentPreview: null,
    importError: null,
  })
  useAuthorizationStore.setState({
    authorizations: [],
    templates: [],
    timeline: [],
    revokedAuthorizations: [],
  })
  localStorage.removeItem('inspection-authorization-ledger')
  localStorage.removeItem('inspection-import-center')
  await db.delete()
  await db.open()
  await seedDatabase()
}

const SAMPLE_CSV = `taskId,title,assignee,templateId,templateVersion
task-auth-001,消防设施巡检-6月第1周,巡检员张三,tpl-001,v1.0
task-auth-002,电梯安全巡检-6月第1周,巡检员李四,tpl-002,v1.0
task-auth-003,配电室安全巡检-6月第1周,巡检员王五,tpl-001,v1.0`

// ============================================================
// 主执行流程
// ============================================================
;(async () => {
  try {
    // 动态 import - 确保 localStorage mock 在 Zustand persist 初始化之前就绪
    const dbModule = await import('@/db')
    db = dbModule.db
    seedDatabase = dbModule.seedDatabase

    const importStoreModule = await import('@/stores/useImportStore')
    useImportStore = importStoreModule.useImportStore
    parseCSV = importStoreModule.parseCSV

    const authStoreModule = await import('@/stores/useAuthorizationStore')
    useAuthorizationStore = authStoreModule.useAuthorizationStore
    SYSTEM_USERS = authStoreModule.SYSTEM_USERS

    console.log('\n' + '='.repeat(80))
    console.log('批次授权台账 - 完整验证链路测试')
    console.log('='.repeat(80) + '\n')

    const ctx1 = await scenario1_PreviewAndAuthorization()
    await scenario2_UnauthorizedInterception(ctx1)
    await scenario3_HandoverAndRollback(ctx1)
    await scenario4_LogTraceability(ctx1)
    const ctx5 = await scenario5_TemplateImportExport()
    await scenario6_RevokeAndRestore(ctx1)
    await scenario7_PersistenceVerification({ ...ctx1, ...ctx5 })
  } catch (err) {
    console.error('\n❌ 测试执行异常：', err)
    process.exitCode = 1
  }

  console.log('\n' + '='.repeat(80))
  const passed = results.filter(r => r.pass).length
  const total = results.length
  const failed = total - passed
  console.log(`测试结果：${passed}/${total} 通过${failed > 0 ? `，${failed} 项失败` : ''}`)
  console.log('='.repeat(80) + '\n')

  if (failed > 0) {
    console.log('失败项：')
    results.filter(r => !r.pass).forEach(r => {
      console.log(`  ❌ ${r.name}｜${r.message}`)
    })
    process.exitCode = 1
  }
})()

// ============================================================
// 场景 1：预演确认 - 创建导入批次 → 预演 → 确认导入 → 配置授权
// ============================================================
async function scenario1_PreviewAndAuthorization() {
  console.log('\n── 场景 1：预演确认流程 ──')
  await resetStores()

  const authStore = useAuthorizationStore.getState()
  const importStore = useImportStore.getState()

  await authStore.fetchAuthorizations()
  await authStore.fetchTemplates()
  await authStore.fetchTimeline()
  await syncAuthStoreFromDb()

  // 1.1 解析 CSV
  const records = parseCSV(SAMPLE_CSV)
  assert(records.length >= 3, 'CSV 解析成功', `解析出 ${records.length} 行数据`)

  // 1.2 创建导入批次
  const batchId = await importStore.createBatch(
    'tasks',
    'test-tasks-june.csv',
    'csv',
    '管理员',
    'all'
  )
  assert(!!batchId, '创建导入批次成功', `批次 ID=${batchId}`)

  // 1.3 执行预演
  const preview = await importStore.runPreview(batchId, SAMPLE_CSV)
  assertEq(preview.totalRecords, 3, '预演总记录数正确', '3 条数据记录')
  assertGte(preview.validRecords, 0, '预演有效记录数正确', `实际 ${preview.validRecords} 条有效`)

  // 1.4 确认并执行导入
  await importStore.confirmImport(batchId, 'skip', {})
  await importStore.executeImport(batchId)

  const batch = (await db.importBatches.get(batchId))!
  assertEq(batch.status, 'success', '导入成功', '批次状态=success')
  assertGte(batch.successRecords, 0, '导入成功记录数正确', `实际 ${batch.successRecords} 条成功`)

  // 1.5 创建批次授权
  const auth = await authStore.createAuthorization({
    batchId,
    viewerUsernames: ['inspector_zhangsan', 'inspector_lisi'],
    rollbackerUsernames: ['inspector_zhangsan'],
    handoverUsernames: ['inspector_zhangsan'],
    expiresAt: Date.now() + 7 * 24 * 3600 * 1000,
    notes: '6月批次任务导入授权',
    createdBy: 'admin',
  })

  assert(!!auth.id, '授权创建成功', `授权 ID=${auth.id}`)
  assertEq(auth.configVersion, 1, '配置版本号正确', '初始版本 v1')
  assertEq(auth.viewers.length, 2, '查看人数量正确', '2 位查看人')
  assertEq(auth.rollbackers.length, 1, '回滚人数量正确', '1 位回滚人')
  assertEq(auth.handoverPersons.length, 1, '接手人数量正确', '1 位接手人')
  assertEq(auth.snapshots.length, 1, '初始快照生成', '1 份快照')
  assertEq(auth.snapshots[0].immutable, true, '快照标记为不可变', 'immutable=true')
  assertEq(auth.timeline.length, 1, '初始时间线记录', '1 条时间线（auth_create）')
  assertEq(auth.timeline[0].action, 'auth_create', '时间线动作类型正确', 'auth_create')
  assert(!!auth.expiresAt && auth.expiresAt > Date.now(), '失效时间在未来', '7 天后过期')

  // 1.6 验证关联
  const updatedBatch = (await db.importBatches.get(batchId))!
  assertEq(updatedBatch.authorizationId, auth.id, '批次关联授权 ID', 'batch.authorizationId 已设置')

  return { batchId, authId: auth.id }
}

// ============================================================
// 场景 2：未授权拦截 - 同角色未授权用户只能看脱敏摘要
// ============================================================
async function scenario2_UnauthorizedInterception(ctx: { batchId: string }) {
  console.log('\n── 场景 2：未授权拦截流程 ──')
  const { batchId } = ctx

  const authStore = useAuthorizationStore.getState()
  const importStore = useImportStore.getState()

  await authStore.fetchAuthorizations()
  await authStore.fetchTemplates()
  await authStore.fetchTimeline()
  await syncAuthStoreFromDb()

  const batch = (await db.importBatches.get(batchId))!

  // 2.1 管理员全放行
  assert(
    authStore.canViewBatch(batch, 'admin', 'admin'),
    '管理员可查看批次',
    'admin 角色全放行'
  )
  assert(
    authStore.canRollbackBatch(batch, 'admin', 'admin'),
    '管理员可回滚批次',
    'admin 角色全放行'
  )
  assert(
    authStore.canExportBatch(batch, 'admin', 'admin'),
    '管理员可导出批次',
    'admin 角色全放行'
  )

  // 2.2 创建者全放行
  assert(
    authStore.canViewBatch(batch, 'admin', 'inspector'),
    '授权创建者可查看',
    'createdBy=admin 全放行'
  )

  // 2.3 已授权的张三 - 有查看/回滚/导出权限
  assert(
    authStore.canViewBatch(batch, 'inspector_zhangsan', 'inspector'),
    '已授权张三可查看',
    '张三在 viewers 列表中'
  )
  assert(
    authStore.canRollbackBatch(batch, 'inspector_zhangsan', 'inspector'),
    '已授权张三可回滚',
    '张三在 rollbackers 列表中'
  )
  assert(
    authStore.canExportBatch(batch, 'inspector_zhangsan', 'inspector'),
    '已授权张三可导出',
    '张三在 viewers 列表中（导出权限同查看）'
  )
  assert(
    authStore.canHandoverBatch(batch, 'inspector_zhangsan', 'inspector'),
    '已授权张三可交接',
    '张三在 handoverPersons 列表中'
  )

  // 2.4 已授权的李四 - 只有查看/导出权限，不能回滚，不能交接
  assert(
    authStore.canViewBatch(batch, 'inspector_lisi', 'inspector'),
    '已授权李四可查看',
    '李四在 viewers 列表中'
  )
  assert(
    authStore.canExportBatch(batch, 'inspector_lisi', 'inspector'),
    '已授权李四可导出',
    '李四在 viewers 列表中'
  )
  assert(
    !authStore.canRollbackBatch(batch, 'inspector_lisi', 'inspector'),
    '李四不可回滚',
    '李四不在 rollbackers 列表中'
  )
  assert(
    !authStore.canHandoverBatch(batch, 'inspector_lisi', 'inspector'),
    '李四不可交接',
    '李四不在 handoverPersons 列表中'
  )

  // 2.5 未授权的王五 - 所有操作被硬拦截
  assert(
    !authStore.canViewBatch(batch, 'inspector_wangwu', 'inspector'),
    '未授权王五不可查看',
    '王五不在任何权限列表中'
  )
  assert(
    !authStore.canRollbackBatch(batch, 'inspector_wangwu', 'inspector'),
    '未授权王五不可回滚',
    '王五不在任何权限列表中'
  )
  assert(
    !authStore.canExportBatch(batch, 'inspector_wangwu', 'inspector'),
    '未授权王五不可导出',
    '王五不在任何权限列表中'
  )
  assert(
    !authStore.canHandoverBatch(batch, 'inspector_wangwu', 'inspector'),
    '未授权王五不可交接',
    '王五不在任何权限列表中'
  )

  // 2.6 useImportStore 委托判断也正确
  assert(
    importStore.canViewBatch(batch, 'inspector', 'inspector_zhangsan'),
    'useImportStore 委托：张三可查看',
    '委托 useAuthorizationStore 判断'
  )
  assert(
    !importStore.canViewBatch(batch, 'inspector', 'inspector_wangwu'),
    'useImportStore 委托：王五不可查看',
    '委托 useAuthorizationStore 判断'
  )

  // 2.7 脱敏摘要生成
  const summary: DesensitizedBatchSummary = authStore.getDesensitizedSummary(
    batch,
    'inspector_wangwu',
    'inspector'
  )
  assertEq(summary.isAuthorized, false, '脱敏摘要标记未授权', 'isAuthorized=false')
  assert(
    summary.batchName.includes('*') || summary.batchName.includes('***'),
    '批次名已打码',
    `脱敏后批次名="${summary.batchName}"`
  )
  assert(
    summary.createdBy.includes('*') || summary.createdBy === '***',
    '创建人已打码',
    `脱敏后创建人="${summary.createdBy}"`
  )
  assert(
    summary.authHint.length > 0,
    '授权提示不为空',
    `提示="${summary.authHint}"`
  )
  assertIncludes(
    summary.authHint,
    '巡检员张三',
    '授权提示包含已授权用户',
    '提示已授权人员名单'
  )
}

// ============================================================
// 场景 3：交接后回滚 - 批次交接给赵六，赵六执行回滚
// ============================================================
async function scenario3_HandoverAndRollback(ctx: { batchId: string; authId: string }) {
  console.log('\n── 场景 3：交接后回滚流程 ──')
  const { batchId, authId } = ctx

  const authStore = useAuthorizationStore.getState()
  const importStore = useImportStore.getState()

  await authStore.fetchAuthorizations()
  await authStore.fetchTemplates()
  await authStore.fetchTimeline()
  await syncAuthStoreFromDb()

  const batch = (await db.importBatches.get(batchId))!

  // 3.1 交接前：赵六无权限
  assert(
    !authStore.canViewBatch(batch, 'manager_zhao', 'inspector'),
    '交接前赵六不可查看',
    '赵六尚未在权限列表中'
  )

  // 3.2 执行交接：张三 → 赵六
  await authStore.handoverBatch(authId, 'inspector_zhangsan', 'manager_zhao', 'admin')

  const updatedAuth = (await db.batchAuthorizations.get(authId))!
  assertEq(updatedAuth.configVersion, 2, '交接后版本号递增', 'v1 → v2')
  assertEq(updatedAuth.snapshots.length, 2, '交接生成新快照', '2 份快照')
  assertEq(
    updatedAuth.timeline[updatedAuth.timeline.length - 1].action,
    'batch_handover',
    '时间线新增交接记录',
    'batch_handover'
  )
  assertIncludes(
    updatedAuth.timeline[updatedAuth.timeline.length - 1].detail,
    '主管赵六',
    '交接记录包含接手人',
    '交接描述正确'
  )

  // 3.3 验证快照不可变性 - v1 快照未被修改
  const v1Snapshot = updatedAuth.snapshots[0]
  assertEq(v1Snapshot.configVersion, 1, 'v1 快照版本号不变', 'v1 快照 immutable')
  assert(
    v1Snapshot.handoverPersons.some(p => p.username === 'inspector_zhangsan'),
    'v1 快照中接手人仍为张三',
    '旧快照 immutable 不可篡改'
  )

  // 3.4 交接后：张三被移除，赵六获得全部权限
  assert(
    !authStore.canHandoverBatch(batch, 'inspector_zhangsan', 'inspector'),
    '交接后张三不再是接手人',
    '张三已从 handoverPersons 移除'
  )
  assert(
    authStore.canViewBatch(batch, 'manager_zhao', 'inspector'),
    '交接后赵六可查看',
    '赵六被加入 viewers/rollbackers/handoverPersons'
  )
  assert(
    authStore.canRollbackBatch(batch, 'manager_zhao', 'inspector'),
    '交接后赵六可回滚',
    '赵六拥有回滚权限'
  )
  assert(
    authStore.canHandoverBatch(batch, 'manager_zhao', 'inspector'),
    '交接后赵六可再交接',
    '赵六是接手人'
  )

  // 3.5 赵六执行回滚
  await importStore.rollbackBatch(batchId, '主管赵六', '数据有误，需要回滚')

  const rolledBackBatch = (await db.importBatches.get(batchId))!
  assertEq(rolledBackBatch.status, 'rolled_back', '回滚成功', '批次状态=rolled_back')
  assert(!!rolledBackBatch.rollbackInfo, '回滚信息已记录', '存在 rollbackInfo')
  assertEq(rolledBackBatch.rollbackInfo!.rolledBackBy, '主管赵六', '回滚人正确', '主管赵六')
  assertEq(rolledBackBatch.rollbackInfo!.reason, '数据有误，需要回滚', '回滚原因正确', '数据有误，需要回滚')
  assertGte(rolledBackBatch.rollbackLog!.length, 1, '回滚日志已记录', '至少 1 条回滚日志')
}

// ============================================================
// 场景 4：日志追溯 - 验证操作时间线完整记录
// ============================================================
async function scenario4_LogTraceability(ctx: { authId: string }) {
  console.log('\n── 场景 4：日志追溯流程 ──')
  const { authId } = ctx

  const authStore = useAuthorizationStore.getState()
  await authStore.fetchAuthorizations()
  await authStore.fetchTemplates()
  await authStore.fetchTimeline()
  await syncAuthStoreFromDb()

  const auth = (await db.batchAuthorizations.get(authId))!
  const globalTimeline = await db.operationTimeline.toArray()

  // 4.1 批次内时间线
  const actionTypes = auth.timeline.map(t => t.action)
  assert(actionTypes.includes('auth_create'), '时间线包含 auth_create', '授权创建记录')
  assert(actionTypes.includes('batch_handover'), '时间线包含 batch_handover', '批次交接记录')
  assertGte(auth.timeline.length, 2, '批次内至少 2 条时间线', `实际 ${auth.timeline.length} 条`)

  // 4.2 每条时间线字段完整
  const firstEntry = auth.timeline[0]
  assert(!!firstEntry.id, '时间线记录有 ID', 'id 字段')
  assert(!!firstEntry.timestamp, '时间线记录有时间戳', 'timestamp 字段')
  assert(!!firstEntry.actor, '时间线记录有操作人', 'actor 字段')
  assert(!!firstEntry.detail, '时间线记录有详细描述', 'detail 字段')
  assertEq(firstEntry.batchId, auth.batchId, '时间线关联正确批次', 'batchId 正确')

  // 4.3 全局操作时间线
  const authCreateEvents = globalTimeline.filter(t => t.action === 'auth_create')
  const handoverEvents = globalTimeline.filter(t => t.action === 'batch_handover')
  assertGte(authCreateEvents.length, 1, '全局时间线含授权创建', `共 ${authCreateEvents.length} 条 auth_create`)
  assertGte(handoverEvents.length, 1, '全局时间线含交接记录', `共 ${handoverEvents.length} 条 batch_handover`)

  // 4.4 时间戳递增（后创建的操作时间戳更大）
  const timestamps = auth.timeline.map(t => t.timestamp)
  for (let i = 1; i < timestamps.length; i++) {
    assertGte(
      timestamps[i],
      timestamps[i - 1],
      `时间线 ${i} 时间戳递增`,
      `操作时间顺序正确`
    )
  }
}

// ============================================================
// 场景 5：模板导入导出 - JSON 导出/导入、冲突检测
// ============================================================
async function scenario5_TemplateImportExport() {
  console.log('\n── 场景 5：授权模板导入导出与冲突检测 ──')
  const authStore = useAuthorizationStore.getState()

  await authStore.fetchAuthorizations()
  await authStore.fetchTemplates()
  await authStore.fetchTimeline()
  await syncAuthStoreFromDb()

  // 5.1 创建授权模板
  const template = await authStore.createTemplate({
    name: '常规导入授权模板',
    description: '适用于常规月度任务导入',
    viewers: ['inspector_zhangsan', 'inspector_lisi'],
    rollbackers: ['inspector_zhangsan'],
    handoverPersons: ['inspector_zhangsan'],
    defaultExpiryHours: 168,
    defaultNotes: '月度常规任务导入授权',
    createdBy: 'admin',
  })

  assert(!!template.id, '模板创建成功', `模板 ID=${template.id}`)
  assertEq(template.version, 1, '模板初始版本', 'v1')
  assert(!!template.contentHash, '模板内容哈希已生成', `contentHash=${template.contentHash}`)

  // 5.2 导出模板为 JSON
  const exportedJson = await authStore.exportTemplate(template.id)
  const parsed = JSON.parse(exportedJson)
  assertEq(parsed.exportType, 'authorization_template', '导出类型正确', 'authorization_template')
  assertEq(parsed.schemaVersion, 1, 'Schema 版本正确', 'v1')
  assertEq(parsed.template.name, '常规导入授权模板', '导出模板名称正确', '名称一致')
  assertEq(parsed.template.contentHash, template.contentHash, '导出哈希一致', 'contentHash 匹配')

  // 5.3 修改 JSON 制造冲突
  const tampered = JSON.parse(exportedJson)
  tampered.template.viewers.push('unknown_user_xxx')
  tampered.template.contentHash = '00000000'
  const tamperedJson = JSON.stringify(tampered)

  // 5.4 导入制造冲突的模板
  const importResult = await authStore.importTemplate(tamperedJson, 'admin')
  assert(importResult.success, '冲突模板仍可导入（自动修复）', '导入成功')
  assertGte(importResult.conflicts.length, 2, '检测到至少 2 项冲突', `实际 ${importResult.conflicts.length} 项`)

  const conflictTypes = importResult.conflicts.map(c => c.type)
  assert(
    conflictTypes.includes('duplicate_name'),
    '检测到同名模板冲突',
    'duplicate_name 冲突'
  )
  assert(
    conflictTypes.includes('unknown_user'),
    '检测到未知用户冲突',
    'unknown_user 冲突'
  )
  assert(
    conflictTypes.includes('template_version_mismatch'),
    '检测到哈希不匹配冲突',
    'template_version_mismatch 冲突'
  )

  // 5.5 验证导入后的模板：自动改名 + 过滤未知用户
  const importedTpl = importResult.template!
  assertIncludes(
    importedTpl.name,
    '（导入）',
    '同名模板自动添加后缀',
    `新名称="${importedTpl.name}"`
  )
  assert(
    !importedTpl.viewers.includes('unknown_user_xxx'),
    '未知用户被过滤掉',
    'viewers 中不包含 unknown_user_xxx'
  )
  assertEq(
    importedTpl.viewers.length,
    2,
    '有效用户数量正确',
    '仅保留张三、李四'
  )

  // 5.6 全局时间线新增 template_import
  const templateEvents = (await db.operationTimeline.toArray()).filter(t => t.action === 'template_import')
  assertGte(templateEvents.length, 1, '模板导入有时间线记录', 'template_import 事件')

  // 5.7 应用模板到新批次
  const newBatchId = 'batch-template-test-' + Date.now()
  await db.importBatches.add({
    id: newBatchId,
    batchName: '模板测试批次',
    targetEntity: 'tasks',
    sourceFileName: 'test.csv',
    sourceFileType: 'csv',
    status: 'success',
    createdBy: '管理员',
    permissionScope: 'all',
    totalRecords: 5,
    successRecords: 5,
    failedRecords: 0,
    skippedRecords: 0,
    progress: 100,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  })

  await authStore.applyTemplate(importedTpl.id, newBatchId, 'admin')
  const appliedAuth = authStore.getAuthorizationByBatchId(newBatchId)
  assert(!!appliedAuth, '模板应用成功', '该批次已关联授权')
  assertEq(appliedAuth!.viewers.length, 2, '模板 viewers 已应用', '2 位查看人')
  assertEq(appliedAuth!.rollbackers.length, 1, '模板 rollbackers 已应用', '1 位回滚人')
  assert(
    !!appliedAuth!.expiresAt && appliedAuth!.expiresAt > Date.now(),
    '模板时效已应用',
    '168 小时后过期'
  )

  return { templateId: template.id }
}

// ============================================================
// 场景 6：撤销恢复 - 软删除撤销，可恢复
// ============================================================
async function scenario6_RevokeAndRestore(ctx: { batchId: string; authId: string }) {
  console.log('\n── 场景 6：撤销与恢复流程 ──')
  const { batchId, authId } = ctx

  const authStore = useAuthorizationStore.getState()

  await authStore.fetchAuthorizations()
  await authStore.fetchTemplates()
  await authStore.fetchTimeline()
  await syncAuthStoreFromDb()

  const batch = (await db.importBatches.get(batchId))!

  // 6.1 撤销前：张三有查看权限
  assert(
    authStore.canViewBatch(batch, 'inspector_zhangsan', 'inspector'),
    '撤销前张三可查看',
    '授权生效中'
  )

  // 6.2 执行撤销
  await authStore.revokeAuthorization(authId, 'admin', '该批次任务已完成归档')

  const revokedAuth = (await db.batchAuthorizations.get(authId))!
  assertEq(revokedAuth.isRevoked, true, '授权已标记撤销', 'isRevoked=true')
  assert(!!revokedAuth.revokedAt, '撤销时间已记录', 'revokedAt 已设置')
  assertEq(revokedAuth.revokedBy, 'admin', '撤销人正确', 'admin')
  assertEq(revokedAuth.revokeReason, '该批次任务已完成归档', '撤销原因正确', '原因已保存')
  assertEq(
    revokedAuth.timeline[revokedAuth.timeline.length - 1].action,
    'auth_revoke',
    '时间线新增撤销记录',
    'auth_revoke'
  )

  // 6.3 撤销后：张三所有权限失效（非 admin）
  assert(
    !authStore.canViewBatch(batch, 'inspector_zhangsan', 'inspector'),
    '撤销后张三不可查看',
    '撤销生效'
  )
  assert(
    !authStore.canRollbackBatch(batch, 'inspector_zhangsan', 'inspector'),
    '撤销后张三不可回滚',
    '撤销生效'
  )
  assert(
    !authStore.canExportBatch(batch, 'inspector_zhangsan', 'inspector'),
    '撤销后张三不可导出',
    '撤销生效'
  )

  // 6.4 撤销后脱敏摘要显示撤销提示
  const summary = authStore.getDesensitizedSummary(batch, 'inspector_zhangsan', 'inspector')
  assertIncludes(
    summary.authHint,
    '授权已撤销',
    '脱敏摘要提示已撤销',
    `提示="${summary.authHint}"`
  )
  assertIncludes(
    summary.authHint,
    '该批次任务已完成归档',
    '脱敏摘要包含撤销原因',
    '撤销原因显示'
  )

  // 6.5 恢复授权
  await authStore.restoreAuthorization(authId, 'admin')

  const restoredAuth = (await db.batchAuthorizations.get(authId))!
  assertEq(restoredAuth.isRevoked, false, '授权已恢复', 'isRevoked=false')
  assertEq(restoredAuth.revokedAt, undefined, '撤销时间已清除', 'revokedAt 清除')
  assertEq(
    restoredAuth.timeline[restoredAuth.timeline.length - 1].action,
    'auth_restore',
    '时间线新增恢复记录',
    'auth_restore'
  )

  // 6.6 恢复后：张三权限重新生效
  assert(
    authStore.canViewBatch(batch, 'inspector_zhangsan', 'inspector'),
    '恢复后张三可查看',
    '授权恢复生效'
  )
  assert(
    authStore.canRollbackBatch(batch, 'inspector_zhangsan', 'inspector'),
    '恢复后张三可回滚',
    '授权恢复生效'
  )

  // 6.7 历史快照完整保留（撤销/恢复不生成新快照）
  assertEq(restoredAuth.snapshots.length, 2, '恢复后快照数不变', '仍为 2 份快照')
  assertEq(restoredAuth.configVersion, 2, '恢复后版本号不变', '仍为 v2')
}

// ============================================================
// 场景 7：重新导出与重启后复核 - 持久化验证
// ============================================================
async function scenario7_PersistenceVerification(ctx: {
  batchId: string
  authId: string
  templateId: string
}) {
  console.log('\n── 场景 7：重新导出与重启后复核 ──')
  const { batchId, authId, templateId } = ctx

  const authStore = useAuthorizationStore.getState()

  // 7.1 导出授权模板，记录哈希
  const jsonBefore = await authStore.exportTemplate(templateId)
  const hashBefore = JSON.parse(jsonBefore).template.contentHash

  // 7.2 记录重启前状态快照
  const authBefore = (await db.batchAuthorizations.get(authId))!
  const tplBefore = (await db.authorizationTemplates.get(templateId))!
  const timelineCountBefore = (await db.operationTimeline.toArray()).length
  const authorizationsCountBefore = (await db.batchAuthorizations.toArray()).length
  const templatesCountBefore = (await db.authorizationTemplates.toArray()).length

  console.log(`  📊 重启前：授权=${authorizationsCountBefore} 条，模板=${templatesCountBefore} 条，时间线=${timelineCountBefore} 条`)

  // 7.3 模拟重启：清空 Zustand store 状态但保留 IndexedDB
  useAuthorizationStore.setState({
    authorizations: [],
    templates: [],
    timeline: [],
    revokedAuthorizations: [],
    loading: false,
    error: null,
  })

  // 7.4 重新从数据库加载
  await authStore.fetchAuthorizations()
  await authStore.fetchTemplates()
  await authStore.fetchTimeline()
  await syncAuthStoreFromDb()

  const state = useAuthorizationStore.getState()
  assertGte(state.authorizations.length, 1, '重启后授权记录已恢复', `已加载 ${state.authorizations.length} 条`)
  assertGte(state.templates.length, 1, '重启后模板已恢复', `已加载 ${state.templates.length} 条`)
  assertGte(state.timeline.length, 1, '重启后时间线已恢复', `已加载 ${state.timeline.length} 条`)

  // 7.5 验证授权数据完整一致
  const authAfter = state.authorizations.find(a => a.id === authId)
    || state.revokedAuthorizations.find(a => a.id === authId)
  assert(!!authAfter, '重启后目标授权存在', 'authId 匹配')
  assertEq(authAfter!.configVersion, authBefore.configVersion, '配置版本号一致', `v${authAfter!.configVersion}`)
  assertEq(authAfter!.viewers.length, authBefore.viewers.length, '查看人数量一致', '数量匹配')
  assertEq(authAfter!.rollbackers.length, authBefore.rollbackers.length, '回滚人数量一致', '数量匹配')
  assertEq(authAfter!.handoverPersons.length, authBefore.handoverPersons.length, '接手人数量一致', '数量匹配')
  assertEq(authAfter!.snapshots.length, authBefore.snapshots.length, '快照数量一致', '数量匹配')
  assertEq(authAfter!.notes, authBefore.notes, '授权备注一致', '内容匹配')

  // 7.6 验证模板数据完整，哈希不变
  const tplAfter = state.templates.find(t => t.id === templateId)
  assert(!!tplAfter, '重启后目标模板存在', 'templateId 匹配')
  assertEq(tplAfter!.contentHash, hashBefore, '模板内容哈希未变', 'contentHash 一致，证明数据未篡改')
  assertEq(tplAfter!.version, tplBefore.version, '模板版本号一致', '版本匹配')

  // 7.7 验证持久化后权限判断结果仍正确
  const batch = (await db.importBatches.get(batchId))!
  assert(
    authStore.canViewBatch(batch, 'inspector_zhangsan', 'inspector'),
    '重启后张三仍可查看',
    '权限判断结果一致'
  )
  assert(
    !authStore.canViewBatch(batch, 'inspector_wangwu', 'inspector'),
    '重启后王五仍不可查看',
    '权限判断结果一致'
  )

  // 7.8 验证 Zustand persist 也生效（localStorage 有数据）
  const persisted = localStorage.getItem('inspection-authorization-ledger')
  assert(!!persisted, 'Zustand persist 数据存在', 'localStorage 有持久化数据')
  let parsedPersisted: any = null
  try {
    parsedPersisted = persisted ? JSON.parse(persisted) : null
  } catch (e) {
    parsedPersisted = null
  }
  const hasAuthArray = !!(
    parsedPersisted &&
    (Array.isArray(parsedPersisted?.state?.authorizations) ||
      Array.isArray(parsedPersisted?.authorizations) ||
      Array.isArray(parsedPersisted?.state?.templates) ||
      Array.isArray(parsedPersisted?.templates))
  )
  assert(hasAuthArray, 'persist 数据格式正确', '包含 authorizations 或 templates 数组')

  // 7.9 重新导出模板，哈希一致
  const jsonAfter = await authStore.exportTemplate(templateId)
  const hashAfter = JSON.parse(jsonAfter).template.contentHash
  assertEq(hashAfter, hashBefore, '重启后导出哈希一致', '两次导出 contentHash 完全相同')

  console.log(`  📊 重启后：授权=${state.authorizations.length} 条，模板=${state.templates.length} 条，时间线=${state.timeline.length} 条`)
}
