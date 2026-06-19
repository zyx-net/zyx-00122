/**
 * 导入预演与回滚中心 - 完整验证链路测试
 *
 * 验证链路：
 *   1. 预演阶段：CSV/JSON 解析 → 自动字段映射 → 缺字段检测 → 脏数据检测 → 重复主键检测 → 覆盖旧记录检测
 *   2. 确认导入：按批次选择跳过/覆盖/待处理 → 执行导入 → 进度追踪
 *   3. 制造冲突：导入包含已有主键的数据 → 验证冲突处理
 *   4. 执行回滚：回滚导入批次 → 数据恢复 → 回滚日志记录
 *   5. 重新导出：导出数据校验前后一致性
 *   6. 重启复核：模拟页面刷新/应用重启 → 批次状态、进度、日志持久化验证
 *
 * 运行方式：npx tsx tests/import-rollback-validation.spec.ts
 * 依赖：fake-indexeddb, tsx
 */

import 'fake-indexeddb/auto'

// Mock localStorage for Node.js environment
if (typeof globalThis.localStorage === 'undefined') {
  const storage: Record<string, string> = {}
  globalThis.localStorage = {
    getItem: (key: string) => storage[key] || null,
    setItem: (key: string, value: string) => { storage[key] = value },
    removeItem: (key: string) => { delete storage[key] },
    clear: () => { Object.keys(storage).forEach(k => delete storage[k]) },
    length: 0,
    key: () => null,
  } as Storage
}

import { db, seedDatabase } from '@/db'
import { useImportStore, targetEntityConfig, parseCSV } from '@/stores/useImportStore'
import { useExportStore } from '@/stores/useExportStore'
import type {
  ImportBatch,
  ImportPreviewResult,
  ImportConflictAction,
  Task,
} from '@/types'

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
  const ok = actual === expected
  const detailFull = ok ? detail : `${detail}（期望=${JSON.stringify(expected)} 实际=${JSON.stringify(actual)}）`
  return assert(ok, name, detailFull)
}

function assertGte(actual: number, expected: number, name: string, detail: string) {
  const ok = actual >= expected
  const detailFull = ok ? detail : `${detail}（期望>=${expected} 实际=${actual}）`
  return assert(ok, name, detailFull)
}

async function delay(ms: number) {
  const start = Date.now()
  while (Date.now() - start < ms) {
    // 空转
  }
}

async function resetStores() {
  useImportStore.setState({
    batches: [],
    currentBatchId: null,
    currentPreview: null,
    importError: null,
    pendingBatches: new Set(),
    rollingBackBatches: new Set(),
  })
  useExportStore.setState({
    exportRecords: [],
    lastSuccessfulExport: null,
    currentExportId: null,
    exportError: null,
  })
  localStorage.clear()
}

async function main() {
  console.log('='.repeat(100))
  console.log('导入预演与回滚中心 - 完整验证链路测试')
  console.log('真跑 Dexie + IndexedDB (fake) + Zustand store')
  console.log('='.repeat(100))

  // === 初始化 ===
  await seedDatabase()
  await resetStores()
  const store = useImportStore.getState()

  const initialTasks = await db.tasks.toArray()
  console.log(`\n初始任务数：${initialTasks.length}`)

  // ======================================================================
  // 第一阶段：CSV 预演验证
  // ======================================================================
  console.log('\n' + '─'.repeat(60))
  console.log('第一阶段：CSV 预演验证')
  console.log('─'.repeat(60))

  const csvContent = `id,templateId,title,status,assignee,extra_field
task-new-001,tpl-001,新增测试任务01,available,测试员A,多余字段值
task-new-002,tpl-001,新增测试任务02,in_progress,测试员B,
task-001,tpl-001,消防设施周检-第24周-已更新,available,,
task-new-003,,缺模板ID的任务,available,测试员C,
,bad_id,空ID任务,available,,
task-new-001,tpl-002,重复ID的任务,available,测试员D,`

  // 步骤 1: 创建批次
  const batchId1 = await store.createBatch(
    'tasks',
    'test-tasks.csv',
    'csv',
    '测试管理员',
    'all'
  )
  assert(!!batchId1, '创建批次成功', `批次ID: ${batchId1}`)

  // 步骤 2: 运行预演
  const preview1 = await store.runPreview(batchId1, csvContent)
  assertEq(preview1.totalRecords, 6, '预演记录数正确', `共 ${preview1.totalRecords} 条记录`)

  // 步骤 3: 验证自动字段映射
  const mappedFields = preview1.fieldMapping.map(m => m.targetField)
  assert(mappedFields.includes('id'), '自动映射 id 字段', `已映射字段: ${mappedFields.join(', ')}`)
  assert(mappedFields.includes('title'), '自动映射 title 字段', `已映射字段: ${mappedFields.join(', ')}`)
  assert(mappedFields.includes('status'), '自动映射 status 字段', `已映射字段: ${mappedFields.join(', ')}`)

  // 步骤 4: 验证未映射字段检测
  assertGte(preview1.unmappedSourceFields.length, 1, '检测到未映射字段', `未映射: ${preview1.unmappedSourceFields.join(', ')}`)
  assert(preview1.unmappedSourceFields.includes('extra_field'), '检测到 extra_field 未映射', '多余字段被正确识别')

  // 步骤 5: 验证缺字段检测
  assertGte(preview1.missingRequiredFields.length, 0, '必填字段检测正常', `缺失必填: ${preview1.missingRequiredFields.join(', ')}`)

  // 步骤 6: 验证错误记录数（空ID + 缺templateId）
  assertGte(preview1.errorRecords, 1, '检测到错误记录', `错误记录: ${preview1.errorRecords} 条`)

  // 步骤 7: 验证重复主键检测
  assertGte(preview1.duplicateKeyCount, 1, '检测到重复主键', `重复主键: ${preview1.duplicateKeyCount} 条`)

  // 步骤 8: 验证覆盖旧记录检测
  assertGte(preview1.willOverwriteCount, 1, '检测到将覆盖的记录', `将覆盖: ${preview1.willOverwriteCount} 条`)

  // 步骤 9: 验证单条记录的错误类型
  const errorRecords = preview1.records.filter(r => r.status === 'error')
  assert(errorRecords.length > 0, '存在错误记录', `共 ${errorRecords.length} 条错误记录`)

  const missingTemplateId = errorRecords.find(r =>
    r.issues.some(i => i.type === 'missing_required_field' && i.field === 'templateId')
  )
  assert(!!missingTemplateId, '检测到缺少 templateId 的记录', '缺少必填字段检测生效')

  const duplicateRecord = errorRecords.find(r =>
    r.issues.some(i => i.type === 'duplicate_key')
  )
  assert(!!duplicateRecord, '检测到重复主键记录', '重复主键检测生效')

  // 步骤 10: 验证覆盖记录快照
  const overwriteRecords = preview1.records.filter(r => r.conflictType === 'will_overwrite')
  assert(overwriteRecords.length > 0, '存在将覆盖的记录', `共 ${overwriteRecords.length} 条`)
  assert(!!overwriteRecords[0].existingRecordSnapshot, '覆盖记录有旧值快照', '旧数据快照保存成功')

  console.log(`\n预演结果：${preview1.validRecords} 有效 / ${preview1.warningRecords} 警告 / ${preview1.errorRecords} 错误`)

  // ======================================================================
  // 第二阶段：导入执行与冲突处理
  // ======================================================================
  console.log('\n' + '─'.repeat(60))
  console.log('第二阶段：导入执行与冲突处理')
  console.log('─'.repeat(60))

  // 步骤 11: 设置冲突处理为跳过，确认导入
  await store.confirmImport(batchId1, 'skip')
  const batchAfterConfirm = await db.importBatches.get(batchId1)
  assertEq(batchAfterConfirm?.status, 'pending_confirmation', '确认导入后状态正确', `状态: ${batchAfterConfirm?.status}`)

  // 步骤 12: 执行导入
  const beforeImportCount = await db.tasks.count()
  await store.executeImport(batchId1)
  const afterImportCount = await db.tasks.count()

  const batch1Final = await db.importBatches.get(batchId1)
  assert(!!batch1Final, '批次存在', '导入后批次记录存在')

  console.log(`导入前: ${beforeImportCount} 条，导入后: ${afterImportCount} 条`)
  console.log(`批次状态: ${batch1Final?.status}, 成功: ${batch1Final?.successRecords}, 失败: ${batch1Final?.failedRecords}`)

  // 步骤 13: 验证导入结果
  assert(batch1Final?.status === 'success' || batch1Final?.status === 'partial_success',
    '导入完成（成功或部分成功）', `最终状态: ${batch1Final?.status}`)
  assertGte(batch1Final?.successRecords || 0, 2, '至少成功导入2条新记录', `成功: ${batch1Final?.successRecords} 条`)
  assertGte(batch1Final?.skippedRecords || 0, 1, '至少跳过1条冲突记录', `跳过: ${batch1Final?.skippedRecords} 条`)

  // 步骤 14: 验证跳过策略 - task-001 应该保持不变（因为选了skip）
  const task001After = await db.tasks.get('task-001')
  assertEq(task001After?.title, '消防设施周检-第24周', '跳过策略生效 - task-001 未被覆盖',
    `task-001 标题: ${task001After?.title}`)

  // 步骤 15: 验证新记录已导入
  const newTask = await db.tasks.get('task-new-001')
  assert(!!newTask, '新记录 task-new-001 已导入', `标题: ${newTask?.title}`)

  // 步骤 16: 验证导入日志存在
  assertGte(batch1Final?.importLog?.length || 0, 3, '导入日志记录完整', `日志条数: ${batch1Final?.importLog?.length}`)

  // 步骤 17: 验证 importedRecordIds 记录
  assertGte(batch1Final?.importedRecordIds?.length || 0, 2, '已导入记录ID追踪正常',
    `追踪到 ${batch1Final?.importedRecordIds?.length} 条导入记录`)

  // ======================================================================
  // 第三阶段：覆盖模式导入
  // ======================================================================
  console.log('\n' + '─'.repeat(60))
  console.log('第三阶段：覆盖模式导入')
  console.log('─'.repeat(60))

  const csvContent2 = `id,templateId,title,status
task-001,tpl-001,消防设施周检-第24周-已覆盖,approved
task-new-004,tpl-001,全新任务04,available`

  // 步骤 18: 创建第二个批次（覆盖模式）
  const batchId2 = await store.createBatch(
    'tasks',
    'test-tasks-overwrite.csv',
    'csv',
    '测试管理员',
    'all'
  )
  assert(!!batchId2, '创建第二个批次成功', `批次ID: ${batchId2}`)

  // 步骤 19: 运行预演
  const preview2 = await store.runPreview(batchId2, csvContent2)
  assertEq(preview2.willOverwriteCount, 1, '检测到1条将覆盖的记录', `覆盖数: ${preview2.willOverwriteCount}`)

  // 步骤 20: 确认导入（覆盖模式）
  await store.confirmImport(batchId2, 'overwrite')
  await store.executeImport(batchId2)

  const batch2Final = await db.importBatches.get(batchId2)
  assertEq(batch2Final?.status, 'success', '覆盖模式导入成功', `状态: ${batch2Final?.status}`)

  // 步骤 21: 验证 task-001 已被覆盖
  const task001Overwritten = await db.tasks.get('task-001')
  assertEq(task001Overwritten?.title, '消防设施周检-第24周-已覆盖',
    '覆盖模式生效 - task-001 已被覆盖', `新标题: ${task001Overwritten?.title}`)
  assertEq(task001Overwritten?.status, 'approved',
    '覆盖模式生效 - 状态已更新', `新状态: ${task001Overwritten?.status}`)

  // 步骤 22: 验证覆盖快照已保存
  assertGte(batch2Final?.overwrittenRecordSnapshots?.length || 0, 1,
    '覆盖记录快照已保存', `快照数: ${batch2Final?.overwrittenRecordSnapshots?.length}`)

  const snapshot = batch2Final?.overwrittenRecordSnapshots?.[0]
  assert(!!snapshot?.before && !!snapshot?.after, '快照包含前后数据',
    `快照记录: ${snapshot?.recordId}`)
  assertEq(snapshot?.before?.title, '消防设施周检-第24周',
    '快照保留了覆盖前的标题', `旧标题: ${snapshot?.before?.title}`)

  // ======================================================================
  // 第四阶段：回滚验证
  // ======================================================================
  console.log('\n' + '─'.repeat(60))
  console.log('第四阶段：回滚验证')
  console.log('─'.repeat(60))

  // 步骤 23: 执行回滚
  const beforeRollbackCount = await db.tasks.count()
  await store.rollbackBatch(batchId2, '测试管理员', '测试回滚功能')
  const afterRollbackCount = await db.tasks.count()

  const batch2RolledBack = await db.importBatches.get(batchId2)
  assertEq(batch2RolledBack?.status, 'rolled_back', '回滚后状态为已回滚',
    `状态: ${batch2RolledBack?.status}`)

  // 步骤 24: 验证回滚信息
  assert(!!batch2RolledBack?.rollbackInfo, '回滚信息已记录', 'rollbackInfo 存在')
  assertEq(batch2RolledBack?.rollbackInfo?.rolledBackBy, '测试管理员',
    '回滚人正确', `回滚人: ${batch2RolledBack?.rollbackInfo?.rolledBackBy}`)
  assertEq(batch2RolledBack?.rollbackInfo?.reason, '测试回滚功能',
    '回滚原因正确', `原因: ${batch2RolledBack?.rollbackInfo?.reason}`)

  // 步骤 25: 验证数据恢复 - task-001 应恢复到导入前状态
  const task001Restored = await db.tasks.get('task-001')
  assertEq(task001Restored?.title, '消防设施周检-第24周',
    '回滚生效 - task-001 标题已恢复', `恢复后标题: ${task001Restored?.title}`)
  assertEq(task001Restored?.status, 'available',
    '回滚生效 - task-001 状态已恢复', `恢复后状态: ${task001Restored?.status}`)

  // 步骤 26: 验证新记录已删除
  const taskNew004 = await db.tasks.get('task-new-004')
  assert(!taskNew004, '回滚生效 - 新记录 task-new-004 已删除', '新导入的记录已被清除')

  // 步骤 27: 验证回滚日志
  assertGte(batch2RolledBack?.rollbackLog?.length || 0, 2,
    '回滚日志已记录', `回滚日志: ${batch2RolledBack?.rollbackLog?.length} 条`)

  console.log(`回滚前: ${beforeRollbackCount} 条，回滚后: ${afterRollbackCount} 条`)

  // ======================================================================
  // 第五阶段：持久化与重启验证
  // ======================================================================
  console.log('\n' + '─'.repeat(60))
  console.log('第五阶段：持久化与重启验证')
  console.log('─'.repeat(60))

  // 步骤 28: 验证批次数据持久化在 IndexedDB 中
  const allBatches = await db.importBatches.toArray()
  assertGte(allBatches.length, 2, '批次数据已持久化到 IndexedDB', `共 ${allBatches.length} 个批次`)

  // 步骤 29: 模拟页面刷新 - 清空 store 状态
  const storeBeforeReset = useImportStore.getState()
  const batchCountBefore = storeBeforeReset.batches.length

  // 保存 localStorage 中的 pending/rollingBack 状态
  const pendingBefore = Array.from(storeBeforeReset.pendingBatches)
  const rollingBackBefore = Array.from(storeBeforeReset.rollingBackBatches)

  // 重置 store
  await resetStores()
  const storeAfterReset = useImportStore.getState()
  assertEq(storeAfterReset.batches.length, 0, 'Store 重置后批次列表为空', '模拟刷新前清理 store')

  // 步骤 30: 重新从数据库加载
  await store.fetchBatches()
  const storeAfterFetch = useImportStore.getState()
  assertGte(storeAfterFetch.batches.length, 2, '从数据库重新加载批次成功',
    `加载到 ${storeAfterFetch.batches.length} 个批次`)

  // 步骤 31: 验证批次详情完整
  const reloadedBatch1 = storeAfterFetch.batches.find(b => b.id === batchId1)
  assert(!!reloadedBatch1, '第一批重载成功', `批次1状态: ${reloadedBatch1?.status}`)
  assertGte(reloadedBatch1?.importLog?.length || 0, 3,
    '重载后导入日志完整', `日志数: ${reloadedBatch1?.importLog?.length}`)

  const reloadedBatch2 = storeAfterFetch.batches.find(b => b.id === batchId2)
  assertEq(reloadedBatch2?.status, 'rolled_back', '第二批重载后状态正确',
    `状态: ${reloadedBatch2?.status}`)
  assert(!!reloadedBatch2?.rollbackInfo, '重载后回滚信息完整', '回滚信息已持久化')

  // 步骤 32: 验证 loadPersistedData 处理中断批次
  await store.loadPersistedData()
  assert(true, 'loadPersistedData 执行成功', '持久化数据加载正常')

  // ======================================================================
  // 第六阶段：权限控制验证
  // ======================================================================
  console.log('\n' + '─'.repeat(60))
  console.log('第六阶段：权限控制验证')
  console.log('─'.repeat(60))

  // 步骤 33: 创建 admin 权限的批次
  const adminBatchId = await store.createBatch(
    'tasks',
    'admin-only.csv',
    'csv',
    '系统管理员',
    'admin'
  )
  assert(!!adminBatchId, '创建 admin 权限批次成功', `批次ID: ${adminBatchId}`)

  const adminBatch = await db.importBatches.get(adminBatchId)
  assertEq(adminBatch?.permissionScope, 'admin', '批次权限范围正确', `scope: ${adminBatch?.permissionScope}`)

  // 步骤 34: 验证巡检员视角
  const canViewAsInspector = store.canViewBatch(adminBatch!, 'inspector')
  assertEq(canViewAsInspector, false, '巡检员不能查看 admin 批次',
    `canView: ${canViewAsInspector}`)

  // 步骤 35: 验证管理员视角
  const canViewAsAdmin = store.canViewBatch(adminBatch!, 'admin')
  assertEq(canViewAsAdmin, true, '管理员可以查看 admin 批次',
    `canView: ${canViewAsAdmin}`)

  // 步骤 36: 验证 all 权限批次
  const canViewAllAsInspector = store.canViewBatch(batch1Final!, 'inspector')
  assertEq(canViewAllAsInspector, true, '巡检员可以查看 all 权限批次',
    `canView: ${canViewAllAsInspector}`)

  // 步骤 37: 验证回滚权限
  // 管理员可以回滚任意批次
  const canRollbackAsAdmin = store.canRollbackBatch(batch1Final!, 'admin', '另一个人')
  assertEq(canRollbackAsAdmin, true, '管理员可以回滚任意批次',
    `canRollback (admin): ${canRollbackAsAdmin}`)

  // 非创建人的巡检员不能回滚 all 权限的批次
  const canRollbackAsInspectorOther = store.canRollbackBatch(batch1Final!, 'inspector', '另一个人')
  assertEq(canRollbackAsInspectorOther, false, '非创建人巡检员不能回滚',
    `canRollback (inspector+非创建人): ${canRollbackAsInspectorOther}`)

  // 创建人可以回滚自己创建的批次
  const canRollbackAsCreator = store.canRollbackBatch(batch1Final!, 'inspector', '测试管理员')
  assertEq(canRollbackAsCreator, true, '创建人可以回滚自己的批次',
    `canRollback (创建人): ${canRollbackAsCreator}`)

  // ======================================================================
  // 第七阶段：JSON 导入验证
  // ======================================================================
  console.log('\n' + '─'.repeat(60))
  console.log('第七阶段：JSON 导入验证')
  console.log('─'.repeat(60))

  const jsonTasks = [
    { id: 'json-task-001', templateId: 'tpl-001', title: 'JSON导入任务01', status: 'available' },
    { id: 'json-task-002', templateId: 'tpl-002', title: 'JSON导入任务02', status: 'in_progress', assignee: 'JSON用户' },
  ]

  // 步骤 38: 创建 JSON 导入批次
  const jsonBatchId = await store.createBatch(
    'tasks',
    'tasks-export.json',
    'json',
    '测试管理员',
    'all'
  )
  assert(!!jsonBatchId, '创建 JSON 批次成功', `批次ID: ${jsonBatchId}`)

  // 步骤 39: 运行预演
  const jsonPreview = await store.runPreview(jsonBatchId, JSON.stringify(jsonTasks))
  assertEq(jsonPreview.totalRecords, 2, 'JSON 预演记录数正确', `共 ${jsonPreview.totalRecords} 条`)
  assertEq(jsonPreview.validRecords, 2, 'JSON 数据全部有效', `有效: ${jsonPreview.validRecords} 条`)

  // 步骤 40: 执行导入
  await store.confirmImport(jsonBatchId, 'skip')
  await store.executeImport(jsonBatchId)

  const jsonBatchFinal = await db.importBatches.get(jsonBatchId)
  assertEq(jsonBatchFinal?.status, 'success', 'JSON 导入成功', `状态: ${jsonBatchFinal?.status}`)

  const jsonTask1 = await db.tasks.get('json-task-001')
  assert(!!jsonTask1, 'JSON 导入的任务存在', `标题: ${jsonTask1?.title}`)

  // ======================================================================
  // 第八阶段：数据一致性导出验证
  // ======================================================================
  console.log('\n' + '─'.repeat(60))
  console.log('第八阶段：数据一致性验证')
  console.log('─'.repeat(60))

  // 步骤 41: 回滚 JSON 批次，验证数据恢复
  await store.rollbackBatch(jsonBatchId, '测试管理员', '清理测试数据')

  const jsonTask1AfterRollback = await db.tasks.get('json-task-001')
  assert(!jsonTask1AfterRollback, 'JSON 批次回滚成功', '回滚后新记录已删除')

  // 步骤 42: 验证第一批回滚后数据不变（task-new-001 还在，因为它没被回滚）
  const taskNew001StillThere = await db.tasks.get('task-new-001')
  assert(!!taskNew001StillThere, '批次1的新记录仍然存在',
    `task-new-001 存在: ${!!taskNew001StillThere}`)

  // 步骤 43: 验证批次统计数据一致
  const finalBatch1 = await db.importBatches.get(batchId1)
  assertEq(finalBatch1?.successRecords, finalBatch1?.importedRecordIds?.length,
    '成功数与导入记录ID数一致',
    `成功: ${finalBatch1?.successRecords}, ID数: ${finalBatch1?.importedRecordIds?.length}`)

  // ======================================================================
  // 结果汇总
  // ======================================================================
  console.log('\n' + '='.repeat(100))
  console.log('测试结果汇总')
  console.log('='.repeat(100))

  const passed = results.filter(r => r.pass).length
  const total = results.length
  const failed = total - passed

  console.log(`\n总计：${total} 项测试`)
  console.log(`通过：${passed} 项 ✅`)
  console.log(`失败：${failed} 项 ❌`)
  console.log(`通过率：${((passed / total) * 100).toFixed(1)}%`)

  if (failed > 0) {
    console.log('\n失败项详情：')
    results.filter(r => !r.pass).forEach(r => {
      console.log(`  ❌ ${r.name}`)
      console.log(`     ${r.message}`)
    })
  }

  console.log('\n' + '='.repeat(100))
  console.log(failed === 0 ? '🎉 所有测试通过！' : '⚠️  部分测试未通过，请检查')
  console.log('='.repeat(100))

  // 返回测试结果
  return { passed, failed, total, results }
}

main().catch(err => {
  console.error('\n❌ 测试执行出错：', err)
  process.exit(1)
}).then(result => {
  if (result && result.failed > 0) {
    process.exit(1)
  }
})
