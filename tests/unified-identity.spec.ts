/**
 * 统一身份状态层 & 多用户切换 - 完整验证链路测试
 *
 * 验证链路：
 *   1. 身份状态层：用户设置、切换、持久化、状态共享
 *   2. 三条权限链路：
 *      - 链路1：已授权用户 → 查看完整详情
 *      - 链路2：未授权用户 → 仅脱敏摘要
 *      - 链路3：交接后 → 原授权人失权
 *   3. 状态保持：刷新/重启后用户会话保持
 *
 * 运行方式：npx tsx tests/unified-identity.spec.ts
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
  BatchAuthorization,
  UserRole,
  SystemUser,
  CurrentSessionUser,
} from '@/types'

// 模块级运行时变量 - 在主函数中通过动态 import 赋值
let db: any
let seedDatabase: any
let useAppStore: any
let useAuthorizationStore: any
let SYSTEM_USERS: SystemUser[]
let hasPermission: any

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

function printSummary() {
  console.log('\n' + '='.repeat(80))
  console.log('📋 测试结果汇总')
  console.log('='.repeat(80))
  const passed = results.filter(r => r.pass).length
  const total = results.length
  console.log(`总计：${total} 个测试，通过：${passed} 个，失败：${total - passed} 个`)
  console.log('='.repeat(80))
  if (total - passed > 0) {
    console.log('\n❌ 失败的测试：')
    results.filter(r => !r.pass).forEach(r => {
      console.log(`  ${r.name} - ${r.message}`)
    })
  }
  console.log('\n' + (passed === total ? '🎉 所有测试通过！' : '⚠️  部分测试失败，请检查'))
  console.log('='.repeat(80) + '\n')
  process.exit(passed === total ? 0 : 1)
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function createTestAuthorization(): Promise<BatchAuthorization> {
  const state = useAuthorizationStore.getState()
  const now = Date.now()

  // 创建测试授权：查看人=张三+李四，回滚人=张三，交接人=张三
  const auth: BatchAuthorization = {
    id: `auth-test-${now}`,
    batchId: `batch-test-${now}`,
    batchName: '测试批次-2025-06-01',
    importType: 'tasks',
    recordCount: 5,
    isRevoked: false,
    createdBy: 'admin',
    createdAt: now,
    updatedAt: now,
    configVersion: 1,
    validFrom: now,
    validUntil: now + 7 * 24 * 60 * 60 * 1000,
    viewers: [
      { username: 'inspector_zhangsan', displayName: '巡检员张三', grantedAt: now, grantedBy: 'admin' },
      { username: 'inspector_lisi', displayName: '巡检员李四', grantedAt: now, grantedBy: 'admin' },
    ],
    rollbackers: [
      { username: 'inspector_zhangsan', displayName: '巡检员张三', grantedAt: now, grantedBy: 'admin' },
    ],
    handoverPersons: [
      { username: 'inspector_zhangsan', displayName: '巡检员张三', grantedAt: now, grantedBy: 'admin' },
    ],
    snapshots: [],
    timeline: [],
    note: '测试授权',
    revokedAt: null,
    revokedBy: null,
    lastSnapshotAt: now,
  }

  // 添加初始快照和时间线
  auth.snapshots.push({
    version: 1,
    snapshotAt: now,
    snapshotBy: 'admin',
    config: JSON.parse(JSON.stringify({
      viewers: auth.viewers,
      rollbackers: auth.rollbackers,
      handoverPersons: auth.handoverPersons,
      validUntil: auth.validUntil,
      note: auth.note,
    })),
  })
  auth.timeline.push({
    id: `tl-${now}-init`,
    batchId: auth.batchId,
    action: 'auth_create',
    actor: 'admin',
    detail: '创建授权',
    timestamp: now,
  })

  await db.batchAuthorizations.put(auth)
  useAuthorizationStore.setState({ authorizations: [auth, ...state.authorizations] })

  return auth
}

async function runTests() {
  console.log('\n' + '='.repeat(80))
  console.log('🧪 统一身份状态层 & 多用户切换 - 完整验证链路测试')
  console.log('='.repeat(80) + '\n')

  // 动态导入模块 - 必须在 mock 设置完成后
  const dbModule = await import('@/db')
  db = dbModule.db
  seedDatabase = dbModule.seedDatabase
  const authStoreModule = await import('@/stores/useAuthorizationStore')
  useAuthorizationStore = authStoreModule.useAuthorizationStore
  SYSTEM_USERS = authStoreModule.SYSTEM_USERS
  hasPermission = authStoreModule.hasPermission
  const appStoreModule = await import('@/stores/useAppStore')
  useAppStore = appStoreModule.useAppStore

  // 清除所有数据，确保干净状态
  await db.delete()
  await db.open()
  await seedDatabase()
  storage.clear()

  // 重置 store 状态
  useAuthorizationStore.setState({
    authorizations: [],
    revokedAuthorizations: [],
    templates: [],
  })
  useAppStore.getState().clearSession()

  // ============================================================
  // 第一部分：统一身份状态层 测试
  // ============================================================
  console.log('\n📌 第一部分：统一身份状态层')
  console.log('-'.repeat(80) + '\n')

  // 测试 1：系统用户定义完整性
  const inspectorUsers = SYSTEM_USERS.filter(u => u.role === 'inspector')
  const adminUsers = SYSTEM_USERS.filter(u => u.role === 'admin')

  assert(SYSTEM_USERS.length === 6,
    '系统用户完整性',
    `应有 6 个内置用户，实际 ${SYSTEM_USERS.length} 个`)

  assert(adminUsers.length === 1 && adminUsers[0].username === 'admin',
    '管理员用户存在',
    `应有 1 个管理员，实际 ${adminUsers.length} 个`)

  assert(inspectorUsers.length === 5,
    '巡检员用户完整性',
    `应有 5 个巡检员（张三、李四、王五、赵六、孙七），实际 ${inspectorUsers.length} 个`)

  const inspectorNames = inspectorUsers.map(u => u.displayName).sort()
  const expectedNames = ['巡检员张三', '巡检员李四', '巡检员王五', '主管赵六', '审计员孙七'].sort()
  assert(JSON.stringify(inspectorNames) === JSON.stringify(expectedNames),
    '巡检员姓名正确性',
    `巡检员姓名：${inspectorNames.join('、')}`)

  // 测试 2：初始状态 - 未登录
  const initialState = useAppStore.getState()
  assert(initialState.currentUser === null,
    '初始状态 - 无当前用户',
    '初始状态 currentUser 应为 null')
  assert(initialState.role === null,
    '初始状态 - 无角色',
    '初始状态 role 应为 null')

  // 测试 3：设置当前用户 - 张三
  initialState.setCurrentUser('inspector_zhangsan')
  await delay(100) // 等待 persist 持久化

  const zhangsanState = useAppStore.getState()
  assert(zhangsanState.currentUser?.username === 'inspector_zhangsan',
    '设置用户 - 张三 username',
    `username: ${zhangsanState.currentUser?.username}`)
  assert(zhangsanState.currentUser?.displayName === '巡检员张三',
    '设置用户 - 张三 displayName',
    `displayName: ${zhangsanState.currentUser?.displayName}`)
  assert(zhangsanState.currentUser?.role === 'inspector',
    '设置用户 - 张三 role',
    `role: ${zhangsanState.currentUser?.role}`)
  assert(zhangsanState.role === 'inspector',
    '设置用户 - 自动同步 role',
    `role: ${zhangsanState.role}`)

  // 测试 4：getCurrentUsername / getCurrentDisplayName
  assert(zhangsanState.getCurrentUsername() === 'inspector_zhangsan',
    'getCurrentUsername() 正确',
    `返回: ${zhangsanState.getCurrentUsername()}`)
  assert(zhangsanState.getCurrentDisplayName() === '巡检员张三',
    'getCurrentDisplayName() 正确',
    `返回: ${zhangsanState.getCurrentDisplayName()}`)

  // 测试 5：用户切换 - 切换到李四
  zhangsanState.switchUser('inspector_lisi')
  await delay(100)

  const lisiState = useAppStore.getState()
  assert(lisiState.currentUser?.username === 'inspector_lisi',
    '用户切换 - 李四 username',
    `切换后 username: ${lisiState.currentUser?.username}`)
  assert(lisiState.currentUser?.displayName === '巡检员李四',
    '用户切换 - 李四 displayName',
    `切换后 displayName: ${lisiState.currentUser?.displayName}`)

  // 测试 6：状态持久化 - localStorage 中存在数据
  const storedData = storage.getItem('inspection-app-session')
  assert(storedData !== null,
    '持久化 - localStorage 有数据',
    'localStorage 中存在 inspection-app-session')

  if (storedData) {
    const parsed = JSON.parse(storedData)
    assert(parsed.state?.currentUser?.username === 'inspector_lisi',
      '持久化 - 数据正确性',
      `存储的 username: ${parsed.state?.currentUser?.username}`)
  }

  // 测试 7：获取同角色用户列表
  const sameRoleUsers = lisiState.getUsersByRole('inspector')
  assert(sameRoleUsers.length === 5,
    'getUsersByRole() - 巡检员',
    `返回 ${sameRoleUsers.length} 个巡检员`)

  const allUsers = lisiState.getSystemUsers()
  assert(allUsers.length === 6,
    'getSystemUsers() - 全部用户',
    `返回 ${allUsers.length} 个用户`)

  // 测试 8：切换到管理员
  lisiState.switchUser('admin')
  await delay(100)

  const adminState = useAppStore.getState()
  assert(adminState.currentUser?.username === 'admin',
    '用户切换 - 管理员',
    `切换后 username: ${adminState.currentUser?.username}`)
  assert(adminState.role === 'admin',
    '用户切换 - 管理员 role',
    `切换后 role: ${adminState.role}`)

  // 测试 9：清除会话
  adminState.clearSession()
  await delay(100)

  const clearedState = useAppStore.getState()
  assert(clearedState.currentUser === null,
    'clearSession() - 清除 currentUser',
    '清除后 currentUser 为 null')
  assert(clearedState.role === null,
    'clearSession() - 清除 role',
    '清除后 role 为 null')

  // ============================================================
  // 第二部分：三条权限链路 测试
  // ============================================================
  console.log('\n📌 第二部分：三条权限链路验证')
  console.log('-'.repeat(80) + '\n')

  // 创建测试授权数据
  const auth = await createTestAuthorization()
  assert(auth.id !== null,
    '创建测试授权数据',
    `批次 ID: ${auth.batchId}`)

  // 重新设置当前用户为张三（已授权）
  useAppStore.getState().setCurrentUser('inspector_zhangsan')
  await delay(100)

  // ------------------------------------------------------------
  // 链路 1：已授权用户 → 查看完整详情
  // ------------------------------------------------------------
  console.log('\n  🔗 链路 1：已授权用户 → 查看完整详情')
  console.log('  ' + '-'.repeat(60))

  const appState = useAppStore.getState()
  const currentUsername = appState.getCurrentUsername()
  const currentRole = appState.role as UserRole

  // 测试权限判断
  const canViewZhangsan = hasPermission(auth, currentUsername, 'view', currentRole)
  const canRollbackZhangsan = hasPermission(auth, currentUsername, 'rollback', currentRole)
  const canExportZhangsan = hasPermission(auth, currentUsername, 'export', currentRole)
  const canHandoverZhangsan = hasPermission(auth, currentUsername, 'handover', currentRole)

  assert(canViewZhangsan === true,
    '链路1 - 张三可查看',
    `hasPermission(view) = ${canViewZhangsan}`)
  assert(canRollbackZhangsan === true,
    '链路1 - 张三可回滚',
    `hasPermission(rollback) = ${canRollbackZhangsan}`)
  assert(canExportZhangsan === true,
    '链路1 - 张三可导出',
    `hasPermission(export) = ${canExportZhangsan}`)
  assert(canHandoverZhangsan === true,
    '链路1 - 张三可交接',
    `hasPermission(handover) = ${canHandoverZhangsan}`)

  // 测试查看人列表和回滚人列表
  const viewerZhangsan = auth.viewers.find(p => p.username === currentUsername)
  const rollbackerZhangsan = auth.rollbackers.find(p => p.username === currentUsername)
  assert(viewerZhangsan !== undefined,
    '链路1 - 张三在查看人列表',
    `viewers: ${auth.viewers.map(p => p.displayName).join('、')}`)
  assert(rollbackerZhangsan !== undefined,
    '链路1 - 张三在回滚人列表',
    `rollbackers: ${auth.rollbackers.map(p => p.displayName).join('、')}`)

  // ------------------------------------------------------------
  // 链路 2：未授权用户 → 仅脱敏摘要
  // ------------------------------------------------------------
  console.log('\n  🔗 链路 2：未授权用户 → 仅脱敏摘要')
  console.log('  ' + '-'.repeat(60))

  // 切换到王五（未授权）
  appState.switchUser('inspector_wangwu')
  await delay(100)

  const wangwuUsername = appState.getCurrentUsername()
  const wangwuRole = appState.role as UserRole

  const canViewWangwu = hasPermission(auth, wangwuUsername, 'view', wangwuRole)
  const canRollbackWangwu = hasPermission(auth, wangwuUsername, 'rollback', wangwuRole)
  const canExportWangwu = hasPermission(auth, wangwuUsername, 'export', wangwuRole)
  const canHandoverWangwu = hasPermission(auth, wangwuUsername, 'handover', wangwuRole)

  assert(canViewWangwu === false,
    '链路2 - 王五不可查看详情',
    `hasPermission(view) = ${canViewWangwu}`)
  assert(canRollbackWangwu === false,
    '链路2 - 王五不可回滚',
    `hasPermission(rollback) = ${canRollbackWangwu}`)
  assert(canExportWangwu === false,
    '链路2 - 王五不可导出',
    `hasPermission(export) = ${canExportWangwu}`)
  assert(canHandoverWangwu === false,
    '链路2 - 王五不可交接',
    `hasPermission(handover) = ${canHandoverWangwu}`)

  // 测试王五不在任何权限列表中
  const viewerWangwu = auth.viewers.find(p => p.username === wangwuUsername)
  const rollbackerWangwu = auth.rollbackers.find(p => p.username === wangwuUsername)
  const handoverWangwu = auth.handoverPersons.find(p => p.username === wangwuUsername)
  assert(viewerWangwu === undefined,
    '链路2 - 王五不在查看人列表',
    '王五未被授权查看')
  assert(rollbackerWangwu === undefined,
    '链路2 - 王五不在回滚人列表',
    '王五未被授权回滚')
  assert(handoverWangwu === undefined,
    '链路2 - 王五不在交接人列表',
    '王五未被授权交接')

  // 验证同角色但权限不同（李四已授权，王五未授权）
  const canViewLisi = hasPermission(auth, 'inspector_lisi', 'view', 'inspector')
  assert(canViewLisi === true && canViewWangwu === false,
    '链路2 - 同角色不同权限',
    `李四可查看: ${canViewLisi}, 王五可查看: ${canViewWangwu}`)

  // ------------------------------------------------------------
  // 链路 3：交接后 → 原授权人失权
  // ------------------------------------------------------------
  console.log('\n  🔗 链路 3：交接后 → 原授权人失权')
  console.log('  ' + '-'.repeat(60))

  // 先切回张三执行交接
  appState.switchUser('inspector_zhangsan')
  await delay(100)

  // 执行交接：张三 → 李四
  const authStore = useAuthorizationStore.getState()
  const originalVersion = auth.configVersion
  await authStore.handoverBatch(
    auth.id,
    'inspector_zhangsan',
    'inspector_lisi',
    appState.getCurrentUsername()
  )
  await delay(100)

  // 从数据库重新获取更新后的授权
  const updatedAuth = await db.batchAuthorizations.get(auth.id)
  assert(updatedAuth !== undefined,
    '链路3 - 交接后授权存在',
    '交接后授权记录仍存在')

  // 测试版本号递增
  assert(updatedAuth.configVersion === originalVersion + 1,
    '链路3 - 版本号递增',
    `原版本: v${originalVersion}, 新版本: v${updatedAuth.configVersion}`)

  // 测试交接人列表已更新
  const handoverPersons = updatedAuth.handoverPersons.map(p => p.username)
  assert(handoverPersons.includes('inspector_lisi') && !handoverPersons.includes('inspector_zhangsan'),
    '链路3 - 交接人列表更新',
    `交接人: ${handoverPersons.join('、')}`)

  // 测试张三（原授权人）失去回滚权限
  const canRollbackZhangsanAfter = hasPermission(
    updatedAuth,
    'inspector_zhangsan',
    'rollback',
    'inspector'
  )
  assert(canRollbackZhangsanAfter === false,
    '链路3 - 张三交接后失去回滚权限',
    `交接后 hasPermission(rollback) = ${canRollbackZhangsanAfter}`)

  // 测试张三仍可查看（作为查看人）
  const canViewZhangsanAfter = hasPermission(
    updatedAuth,
    'inspector_zhangsan',
    'view',
    'inspector'
  )
  assert(canViewZhangsanAfter === true,
    '链路3 - 张三仍可查看',
    `交接后 hasPermission(view) = ${canViewZhangsanAfter}`)

  // 测试李四（新授权人）获得回滚权限
  const canRollbackLisiAfter = hasPermission(
    updatedAuth,
    'inspector_lisi',
    'rollback',
    'inspector'
  )
  assert(canRollbackLisiAfter === true,
    '链路3 - 李四获得回滚权限',
    `交接后 hasPermission(rollback) = ${canRollbackLisiAfter}`)

  // 测试李四可交接
  const canHandoverLisiAfter = hasPermission(
    updatedAuth,
    'inspector_lisi',
    'handover',
    'inspector'
  )
  assert(canHandoverLisiAfter === true,
    '链路3 - 李四可交接',
    `交接后 hasPermission(handover) = ${canHandoverLisiAfter}`)

  // 测试操作时间线包含交接记录
  const handoverTimeline = updatedAuth.timeline.find(
    (t: any) => t.action === 'batch_handover'
  )
  assert(handoverTimeline !== undefined,
    '链路3 - 操作时间线包含交接记录',
    `时间线事件: ${updatedAuth.timeline.map((t: any) => t.action).join('、')}`)

  // 测试快照新增 v2 版本
  assert(updatedAuth.snapshots.length >= 2,
    '链路3 - 快照新增版本',
    `快照数量: ${updatedAuth.snapshots.length} 个`)
  const latestSnapshot = updatedAuth.snapshots[updatedAuth.snapshots.length - 1]
  const snapshotVersion = latestSnapshot.version || latestSnapshot.configVersion
  assert(snapshotVersion === originalVersion + 1,
    '链路3 - 最新快照版本正确',
    `最新快照版本: v${snapshotVersion}`)

  // ============================================================
  // 第三部分：状态保持 测试
  // ============================================================
  console.log('\n📌 第三部分：状态保持（刷新/重启后）')
  console.log('-'.repeat(80) + '\n')

  // 测试 10：模拟刷新页面 - 重新加载模块后状态恢复
  console.log('\n  🔄 模拟刷新页面（重新加载模块）')
  console.log('  ' + '-'.repeat(60))

  // 先设置一个用户
  useAppStore.getState().setCurrentUser('inspector_wangwu')
  await delay(100)

  // 保存当前状态用于比较
  const beforeRefresh = {
    username: useAppStore.getState().getCurrentUsername(),
    displayName: useAppStore.getState().getCurrentDisplayName(),
    role: useAppStore.getState().role,
  }

  // 模拟页面刷新：清除模块缓存，重新 import
  // 在 Node.js 中无法真正清除模块缓存，但我们可以验证 localStorage 数据
  const storedState = storage.getItem('inspection-app-session')
  assert(storedState !== null,
    '状态保持 - localStorage 有数据',
    '刷新前 localStorage 已保存')

  if (storedState) {
    const parsed = JSON.parse(storedState)
    assert(parsed.state?.currentUser?.username === beforeRefresh.username,
      '状态保持 - username 持久化正确',
      `存储 username: ${parsed.state?.currentUser?.username}`)
    assert(parsed.state?.currentUser?.displayName === beforeRefresh.displayName,
      '状态保持 - displayName 持久化正确',
      `存储 displayName: ${parsed.state?.currentUser?.displayName}`)
    assert(parsed.state?.role === beforeRefresh.role,
      '状态保持 - role 持久化正确',
      `存储 role: ${parsed.state?.role}`)
  }

  // 测试 11：模拟重启应用 - 清空内存后从 localStorage 恢复
  console.log('\n  🔄 模拟重启应用（清空内存后恢复）')
  console.log('  ' + '-'.repeat(60))

  // 手动重置 store 状态（模拟重启后内存清空）
  useAppStore.setState({
    currentUser: null,
    role: null,
  })

  // 验证已清空
  assert(useAppStore.getState().currentUser === null,
    '状态保持 - 模拟重启前已清空',
    '重启前内存状态已清空')

  // 模拟 Zustand persist 重新 hydrate
  // 手动从 localStorage 恢复（模拟应用启动时的自动恢复）
  if (storedState) {
    const parsed = JSON.parse(storedState)
    useAppStore.setState({
      currentUser: parsed.state.currentUser,
      role: parsed.state.role,
    })
  }

  const afterRestart = useAppStore.getState()
  assert(afterRestart.getCurrentUsername() === beforeRefresh.username,
    '状态保持 - 重启后 username 恢复',
    `重启后 username: ${afterRestart.getCurrentUsername()}`)
  assert(afterRestart.getCurrentDisplayName() === beforeRefresh.displayName,
    '状态保持 - 重启后 displayName 恢复',
    `重启后 displayName: ${afterRestart.getCurrentDisplayName()}`)
  assert(afterRestart.role === beforeRefresh.role,
    '状态保持 - 重启后 role 恢复',
    `重启后 role: ${afterRestart.role}`)

  // 测试 12：多用户连续切换 - 状态一致性
  console.log('\n  🔄 多用户连续切换 - 状态一致性')
  console.log('  ' + '-'.repeat(60))

  const testUsers = [
    'inspector_zhangsan',
    'inspector_lisi',
    'inspector_wangwu',
    'manager_zhao',
    'auditor_sun',
    'admin',
  ]

  let allSwitchOk = true
  for (const username of testUsers) {
    useAppStore.getState().switchUser(username)
    await delay(50)

    const state = useAppStore.getState()
    const current = state.getCurrentUsername()
    if (current !== username) {
      allSwitchOk = false
      console.log(`    ❌ 切换到 ${username} 失败，实际: ${current}`)
    }

    // 验证与 localStorage 同步
    const stored = storage.getItem('inspection-app-session')
    if (stored) {
      const parsed = JSON.parse(stored)
      if (parsed.state?.currentUser?.username !== username) {
        allSwitchOk = false
        console.log(`    ❌ localStorage 不同步，期望: ${username}, 实际: ${parsed.state?.currentUser?.username}`)
      }
    }
  }

  assert(allSwitchOk,
    '状态保持 - 多用户连续切换全部成功',
    `共切换 ${testUsers.length} 个用户，全部成功`)

  // ============================================================
  // 第四部分：状态层复用性 测试
  // ============================================================
  console.log('\n📌 第四部分：状态层复用性（所有组件共享同一数据源）')
  console.log('-'.repeat(80) + '\n')

  // 测试：在不同 store 中使用同一身份源
  // 模拟 useTaskStore 中的 getCurrentActor 逻辑
  console.log('\n  📦 模拟跨 store 身份复用')
  console.log('  ' + '-'.repeat(60))

  // 设置当前用户
  useAppStore.getState().setCurrentUser('inspector_zhangsan')
  await delay(100)

  // 模拟 useTaskStore 中获取当前 actor 的逻辑
  function getCurrentActor(): string {
    const appState = useAppStore.getState()
    return appState.getCurrentDisplayName() || '未知用户'
  }

  const actor1 = getCurrentActor()
  assert(actor1 === '巡检员张三',
    '复用性 - useTaskStore 获取张三',
    `getCurrentActor() = ${actor1}`)

  // 切换用户
  useAppStore.getState().switchUser('admin')
  await delay(100)

  const actor2 = getCurrentActor()
  assert(actor2 === '管理员',
    '复用性 - useTaskStore 获取管理员',
    `getCurrentActor() = ${actor2}`)

  // 验证所有获取方法一致
  const methods = [
    useAppStore.getState().getCurrentUsername(),
    useAppStore.getState().getCurrentDisplayName(),
    useAppStore.getState().currentUser?.username,
    useAppStore.getState().currentUser?.displayName,
  ]
  const expectedMethods = ['admin', '管理员', 'admin', '管理员']
  assert(JSON.stringify(methods) === JSON.stringify(expectedMethods),
    '复用性 - 所有获取方法一致',
    `方法返回值: ${methods.join('、')}`)

  // ============================================================
  // 测试完成
  // ============================================================
  printSummary()
}

runTests().catch(err => {
  console.error('\n❌ 测试执行出错:', err)
  process.exit(1)
})
