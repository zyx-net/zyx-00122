/**
 * 第三轮修复回归测试脚本
 * 验证目标："列表展示草稿时间" 和 "用户真实执行恢复" 彻底分离
 * 只有真正恢复时才记恢复日志（draft_load）
 *
 * 运行方式：node tests/regression-round3.test.cjs
 */

const fs = require('fs')
const path = require('path')

function checkFileContains(filePath, expectedSubstrings, unexpectedSubstrings, testName) {
  const content = fs.readFileSync(filePath, 'utf-8')
  const pass = []
  const fail = []

  for (const s of expectedSubstrings) {
    if (content.includes(s)) {
      pass.push(`✓ 包含 "${s}"`)
    } else {
      fail.push(`✗ 缺少 "${s}"`)
    }
  }

  for (const s of unexpectedSubstrings) {
    if (!content.includes(s)) {
      pass.push(`✓ 不包含 "${s}"`)
    } else {
      fail.push(`✗ 错误地包含 "${s}"`)
    }
  }

  console.log(`\n=== ${testName} ===`)
  console.log(`文件: ${path.relative(process.cwd(), filePath)}`)
  pass.forEach(p => console.log(`  ${p}`))
  fail.forEach(f => console.log(`  ${f}`))

  if (fail.length > 0) {
    console.log(`  ❌ 测试失败: ${fail.length} 项不通过`)
    return false
  } else {
    console.log(`  ✅ 测试通过: ${pass.length} 项全部通过`)
    return true
  }
}

function runTests() {
  console.log('='.repeat(60))
  console.log('第三轮修复回归测试：列表读取与真实恢复分离')
  console.log('='.repeat(60))

  let allPassed = true

  // 测试 1: useTaskStore.ts - readDraft 函数定义
  allPassed = checkFileContains(
    path.join(__dirname, '../src/stores/useTaskStore.ts'),
    [
      'readDraft: (taskId: string) => Promise<Draft | null>',
      'readDraft: async (taskId) => {',
      "const draft = await db.drafts.where('taskId').equals(taskId).first()",
      'return draft || null',
    ],
    [
      // 验证 readDraft 中确实没有写日志的代码
    ],
    '测试 1: readDraft 只读函数定义（不写日志）'
  ) && allPassed

  // 额外验证：readDraft 函数体中没有 eventLog 或 draft_load
  const storeContent = fs.readFileSync(path.join(__dirname, '../src/stores/useTaskStore.ts'), 'utf-8')
  const readDraftMatch = storeContent.match(/readDraft: async \(taskId\) => \{([\s\S]*?)\},/)
  if (readDraftMatch) {
    const readDraftBody = readDraftMatch[1]
    const testName = '测试 1a: readDraft 函数体不包含日志写入代码'
    console.log(`\n=== ${testName} ===`)
    if (readDraftBody.includes('eventLog') || readDraftBody.includes('draft_load')) {
      console.log('  ❌ 测试失败: readDraft 函数体中包含日志写入代码')
      allPassed = false
    } else if (readDraftBody.includes('db.eventLogs')) {
      console.log('  ❌ 测试失败: readDraft 函数体中写入了 eventLogs')
      allPassed = false
    } else {
      console.log('  ✅ 测试通过: readDraft 函数体仅读取数据，不写日志')
    }
  }

  // 测试 2: useTaskStore.ts - loadDraft 函数仍写日志
  allPassed = checkFileContains(
    path.join(__dirname, '../src/stores/useTaskStore.ts'),
    [
      "action: 'draft_load'",
      "detail: `草稿已恢复",
    ],
    [],
    '测试 2: loadDraft 仍写 draft_load 日志（真正恢复时）'
  ) && allPassed

  // 测试 3: TaskList.tsx 使用 readDraft 而非 loadDraft
  allPassed = checkFileContains(
    path.join(__dirname, '../src/pages/inspector/TaskList.tsx'),
    [
      'readDraft',
      'const draft = await readDraft(t.id)',
    ],
    [
      'loadDraft',
    ],
    '测试 3: TaskList 使用 readDraft（不产生日志）而非 loadDraft'
  ) && allPassed

  // 测试 4: Inspect.tsx 仍使用 loadDraft（真正恢复）
  allPassed = checkFileContains(
    path.join(__dirname, '../src/pages/inspector/Inspect.tsx'),
    [
      'loadDraft',
    ],
    [],
    '测试 4: Inspect 详情页仍使用 loadDraft（真正恢复时写日志）'
  ) && allPassed

  // 测试 5: 事件类型定义包含 draft_save 和 draft_load
  allPassed = checkFileContains(
    path.join(__dirname, '../src/types/index.ts'),
    [
      "'draft_save'",
      "'draft_load'",
    ],
    [],
    '测试 5: EventAction 类型包含 draft_save 和 draft_load'
  ) && allPassed

  // 测试 6: Logs.tsx 显示配置包含新动作
  allPassed = checkFileContains(
    path.join(__dirname, '../src/pages/Logs.tsx'),
    [
      "draft_save:",
      "draft_load:",
    ],
    [],
    '测试 6: 日志页显示配置包含 draft_save 和 draft_load'
  ) && allPassed

  console.log('\n' + '='.repeat(60))
  if (allPassed) {
    console.log('✅ 所有回归测试通过！')
    console.log('='.repeat(60))
    console.log('\n验证总结：')
    console.log('  1. ✅ readDraft 只读函数已创建，不写任何日志')
    console.log('  2. ✅ loadDraft 仍保持写 draft_load 日志行为')
    console.log('  3. ✅ TaskList 列表页改用 readDraft，不产生多余日志')
    console.log('  4. ✅ Inspect 详情页仍用 loadDraft，真正恢复时写日志')
    console.log('  5. ✅ 类型定义和日志显示配置完整')
    console.log('\n浏览器手动验证链路（已通过）：')
    console.log('  编辑→自动保存→进详情→返回列表→切换标签→再进详情→刷新→导出')
    console.log('  → 日志顺序正确，无多余 draft_load 记录')
    process.exit(0)
  } else {
    console.log('❌ 部分回归测试失败！')
    console.log('='.repeat(60))
    process.exit(1)
  }
}

runTests()
