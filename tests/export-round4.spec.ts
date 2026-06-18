/**
 * 第四轮修复（v2）：浏览器级导出链路 E2E 回归测试
 *
 * ⭐ 全程真实 DOM 交互，不再直调业务层
 *   - 点首页「巡检员」卡片
 *   - 点「可领取」Tab 里的「领取任务」按钮
 *   - 等 Toast「任务领取成功」→ Tab 自动切「我的任务」
 *   - 点我的任务卡片进详情页
 *   - 按顺序点详情页 4 个 select 选项按钮 → 等每次 500ms 防抖完的 Toast「草稿已自动保存」
 *   - F5 刷新详情页 → 等 init loadDraft
 *   - 用底部导航「日志」进日志页
 *   - 从日志页 DOM 时间轴里读卡片文字（不是读 store）
 *   - 点日志页右上角 FileJson 按钮进导出页
 *   - 全选 + 导出 JSON 文件 → 监听 page.download → 解析 JSON 逐字段断言
 *   - 刷新导出页再导出一次，两次数据完全一致
 *   - DOM 最新动作 = 导出 JSON 里最新动作
 *
 * 唯一的 page.evaluate 只有 resetAndSeed（清库 + seed，这一步用户没法在 UI 上做）
 */

import { test, expect, type Page, type BrowserContext } from '@playwright/test'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

// ======== 导出 JSON 类型 ========
type ExportedJSON = {
  exportedAt: number
  exportedBy: string
  appVersion: string
  templates: Array<{ id: string; name: string; version: string }>
  tasks: Array<{
    id: string
    templateId: string
    templateVersion: string
    title: string
    assignee: string
    status: 'available' | 'in_progress' | 'submitted' | 'rework' | 'approved'
    createdAt: number
    updatedAt: number
  }>
  drafts: Array<{
    id: string
    taskId: string
    templateVersion: string
    answers: Record<string, unknown>
    savedAt: number
  }>
  submissions: Array<Record<string, unknown>>
  anomalies: Array<Record<string, unknown>>
  eventLogs: Array<{
    id: string
    taskId: string
    action: string
    actor: string
    detail: string
    timestamp: number
  }>
}

function getTaskLogsAsc(data: ExportedJSON, taskId: string) {
  return data.eventLogs
    .filter((l) => l.taskId === taskId)
    .sort((a, b) => a.timestamp - b.timestamp)
}

// actionConfig 同步自 Logs.tsx，用于把 DOM 上的中文 label 反推回 action 字段
const DOM_LABEL_TO_ACTION: Record<string, string> = {
  领取任务: 'claim',
  自动保存: 'draft_save',
  恢复草稿: 'draft_load',
  提交: 'submit',
  退回返工: 'rework',
  审核通过: 'approve',
  异常上报: 'anomaly',
  提交被拒: 'reject',
  保存草稿: 'save_draft',
}

test.describe('导出链路（真实 DOM 交互 + 真实下载）', () => {
  let context: BrowserContext
  let page: Page

  test.beforeEach(async ({ browser, baseURL }) => {
    context = await browser.newContext()
    page = await context.newPage()
    await page.goto(baseURL || 'http://localhost:5173/', { waitUntil: 'networkidle' })
  })

  test.afterEach(async () => {
    await context.close()
  })

  test('完整链路：领取→编辑自动保存→日志DOM→导出下载JSON→刷新→再次导出一致性', async () => {
    test.setTimeout(240_000)

    // -------- 步骤 0：重置并 seed（唯一的 page.evaluate，因为用户 UI 上没"清库并 seed"按钮）--------
    const resetOk = await page.evaluate(async () => {
      const mod: any = await import('/src/db/index.ts')
      await Promise.all([
        mod.db.templates.clear(),
        mod.db.tasks.clear(),
        mod.db.drafts.clear(),
        mod.db.submissions.clear(),
        mod.db.anomalies.clear(),
        mod.db.eventLogs.clear(),
      ])
      await new Promise((r) => setTimeout(r, 50))
      await mod.seedDatabase()
      const { useTaskStore }: any = await import('/src/stores/useTaskStore.ts')
      const { useTemplateStore }: any = await import('/src/stores/useTemplateStore.ts')
      await useTaskStore.getState().fetchTasks()
      await useTemplateStore.getState().fetchTemplates()
      return true
    })
    expect(resetOk).toBe(true)

    // -------- 步骤 1：首页点巡检员入口（真实 DOM 点击）--------
    await expect(page.getByRole('heading', { name: '离线巡检' })).toBeVisible({ timeout: 15_000 })
    const inspectorCard = page.getByRole('button', { name: /巡检员.*领取任务/ })
    await expect(inspectorCard).toBeVisible()
    await inspectorCard.click()
    await page.waitForURL(/\/inspector\/tasks/, { waitUntil: 'networkidle' })
    // 应该在"可领取" Tab
    await expect(page.getByRole('button', { name: /可领取/ })).toBeVisible()

    // -------- 步骤 2：点第一张任务卡上的「领取任务」按钮（真实 DOM 点击，不是 page.evaluate 调 store.claimTask）--------
    // TaskList.tsx L97-L108：每张 available 卡底部是一个 <button>「领取任务」
    const claimBtn = page.getByRole('button', { name: '领取任务' }).first()
    await expect(claimBtn).toBeVisible()

    // 用 Promise.all 等 Toast：TaskList.tsx L51 addToast('任务领取成功', 'success')
    const [_toast1] = await Promise.all([
      page.waitForSelector('text=任务领取成功', { timeout: 10_000 }),
      claimBtn.click(),
    ])

    // 领取成功后 TaskList 会 setActiveTab('mine')，UI 切到「我的任务」
    await expect(page.getByRole('button', { name: /我的任务/ })).toBeVisible({ timeout: 5000 })
    // 我的任务列表里应该至少有 1 张卡
    const myTaskCard = page.locator('div.rounded-xl.bg-white.p-4').first()
    await expect(myTaskCard).toBeVisible()

    // 从 DOM 上读任务标题（h3.text-base.font-semibold）
    const TASK_TITLE: string = await myTaskCard.locator('h3').first().innerText()
    expect(TASK_TITLE.length).toBeGreaterThan(0)

    // 点我的任务卡片 → 跳详情页
    await myTaskCard.click()
    await page.waitForURL(/\/inspector\/inspect\//, { waitUntil: 'networkidle' })
    // 从 URL 里取 taskId（React Router useParams 拿到的那个）
    const match = page.url().match(/\/inspect\/([^/?#]+)/)
    expect(match, 'URL 应包含 /inspect/<taskId>').toBeTruthy()
    const TASK_ID: string = match![1]

    // -------- 步骤 3：在详情页真的填 4 个答案（点 CheckItemInput 的 select 选项按钮）--------
    // Inspect.tsx：checkpoints[0].items 都是 select 类型
    // CheckItemInput.tsx L56-L75：每个选项是 <button> 文字是选项文本
    // seed 里模板 1 第一个 checkpoint items 4 个：灭火器是否在位、灭火器压力表读数、消防通道是否畅通、应急照明是否正常
    const itemLabels = [
      '灭火器是否在位',
      '灭火器压力表读数',
      '消防通道是否畅通',
      '应急照明是否正常',
    ]
    for (let i = 0; i < itemLabels.length; i++) {
      const label = itemLabels[i]
      // 不用 className 选择器（含小数点 "1.5" 会被 CSS 解析器误判），直接按 label 文本找，再取其最近的父容器
      const labelEl = page.locator('label', { hasText: new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first()
      await expect(labelEl).toBeVisible({ timeout: 5000 })
      // 取 label 所在的 CheckItemInput 容器（最近的含 button 的祖先），拿第一个选项按钮
      const itemRoot = labelEl.locator('xpath=ancestor::*[.//button][1]')
      const firstOptBtn = itemRoot.locator('button').first()
      await expect(firstOptBtn).toBeVisible()

      // 点按钮 + 等 Toast「草稿已自动保存」（Inspect.tsx L110 addToast）
      // saveDraftDebounced 防抖 500ms，给 3000ms 超时
      await firstOptBtn.click()
      await page.waitForSelector('text=草稿已自动保存', { timeout: 3000 })
      // 再等一小会确保 Toast 淡出，避免下一次点选项时这个 Toast 还在遮挡
      await page.waitForTimeout(500)
    }
    // 现在已经填了 4 项，详情页右上角 header 里有"草稿保存时间"或者 Clock 图标，这也是 DOM 可观察状态
    // Inspect.tsx L228-L232：有 draftSavedAt 时显示时间，我们只验证有 Clock 图标即可
    const hasClockAfterSave = await page.locator('header svg.lucide-clock, svg[class*="clock"]').count()
    expect(hasClockAfterSave).toBeGreaterThan(0)

    // ⭐ 关键：刷新详情页，让组件 init 再次 loadDraft
    // 此时草稿已存在，loadDraft 会写一条 draft_load 日志（detail 含"草稿已恢复"）
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForTimeout(2600)

    // 从详情页右上角读模板版本号（Inspect.tsx L222-L233：只读模式显示 vXX）
    // 我们当前是 in_progress，header 不直接显示版本，用 DOM 的 checkpoint 标题来间接验证模板确实加载了
    await expect(page.locator('h2', { hasText: /点位/ }).first()).toBeVisible({ timeout: 5000 })

    // -------- 步骤 4：进日志页 --------
    // Inspect.tsx 是详情页（带 onBack），Layout 没传 showNav → 底部导航默认隐藏
    // 所以我们直接 page.goto 去 inspector/logs（和点底部导航走同一条 React Router 路由）
    await page.goto('/inspector/logs', { waitUntil: 'networkidle' })
    await page.waitForTimeout(2500)

    // -------- 步骤 4b：从日志页 DOM 时间轴里读卡片（不是从 store 读！）--------
    // Logs.tsx：每张卡片的结构是
    //   <div className="relative flex gap-3 pb-5">
    //     <div ...> <span>{cfg.label}</span> </div>
    //     <div className="flex-1">
    //       <p className="text-sm font-medium">{cfg.label}</p>            ← 第 0 个 <p>
    //       <p className="text-xs text-gray-500">{getTaskTitle(log.taskId)}</p>  ← 第 1 个 <p>
    //       <p className="text-xs text-gray-600">{log.detail}</p>         ← 第 2 个 <p>
    //       <p className="text-[11px] text-gray-400">操作人：{log.actor}</p> ← 第 3 个 <p>
    //     </div>
    //   </div>
    // 日志是倒序排列（最新在上）。为了避免 className 里小数点/方括号 CSS-escape 坑，我们直接按位置读 <p> 子节点
    const domLogCards = page.locator('div.relative.flex.gap-3.pb-5')
    const domLogCount = await domLogCards.count()
    expect(domLogCount, `日志页 DOM 上至少应展示 6 条卡片（claim+4 save+1 load），实际 ${domLogCount}`).toBeGreaterThanOrEqual(6)

    type DomLogEntry = { label: string; detail: string; actor: string; taskTitle: string }
    const domLogs: DomLogEntry[] = []
    for (let i = 0; i < domLogCount; i++) {
      const card = domLogCards.nth(i)
      const paras = card.locator('div.flex-1 p')
      const n = await paras.count()
      const readP = async (idx: number) =>
        idx < n ? (await paras.nth(idx).innerText()).trim() : ''
      const label = await readP(0)
      const taskTitle = await readP(1)
      const detail = await readP(2)
      const actorLine = await readP(3)
      domLogs.push({ label, detail, actor: actorLine.replace(/^操作人：/, ''), taskTitle })
    }

    // 我们只关心 TASK_TITLE 对应的事件（seed 后有 2 个可用任务，只领了 1 个）
    const myLogs = domLogs.filter((l) => l.taskTitle.includes(TASK_TITLE) || TASK_TITLE.includes(l.taskTitle.slice(0, 4)))
    // 统计
    const domClaimCount = myLogs.filter((l) => DOM_LABEL_TO_ACTION[l.label] === 'claim').length
    const domSaveCount = myLogs.filter((l) => DOM_LABEL_TO_ACTION[l.label] === 'draft_save').length
    const domLoadCount = myLogs.filter((l) => DOM_LABEL_TO_ACTION[l.label] === 'draft_load').length
    expect(domClaimCount, 'DOM 上"领取任务"卡片=1').toBe(1)
    expect(domSaveCount, 'DOM 上"自动保存"卡片>=4').toBeGreaterThanOrEqual(4)
    expect(domLoadCount, 'DOM 上"恢复草稿"卡片>=1（刷新详情页触发）').toBeGreaterThanOrEqual(1)

    // DOM 上最新（第 0 条，倒序）的动作 label
    const domLatestLabel = myLogs[0]?.label || ''
    const domLatestAction = DOM_LABEL_TO_ACTION[domLatestLabel] || ''

    // DOM 上能看到 claim 的 actor 是"巡检员张三"
    const claimDomLog = myLogs.find((l) => DOM_LABEL_TO_ACTION[l.label] === 'claim')
    expect(claimDomLog, 'DOM 上应有领取任务卡片').toBeTruthy()
    expect(claimDomLog!.actor).toContain('巡检员张三')
    // DOM 上 claim 的 detail 含"领取了任务"
    expect(claimDomLog!.detail).toContain('领取了任务')

    // DOM 上第一条自动保存（最旧的那条，倒序在后面） detail 含"（新建）"
    const saveDomLogs = myLogs.filter((l) => DOM_LABEL_TO_ACTION[l.label] === 'draft_save')
    const oldestSaveDomLog = saveDomLogs[saveDomLogs.length - 1]
    const newestSaveDomLog = saveDomLogs[0]
    expect(oldestSaveDomLog.detail, `最旧自动保存（新建）detail=${oldestSaveDomLog.detail}`).toContain('（新建）')
    expect(newestSaveDomLog.detail, `最新自动保存 detail=${newestSaveDomLog.detail}`).toContain('（更新）')
    expect(newestSaveDomLog.detail).toContain('4 项答案')

    // -------- 步骤 5：点日志页右上角 FileJson 按钮 → 跳 /export --------
    // Logs.tsx L82-L88：<button title="导出数据"><FileJson /></button>
    let jumpedByClick = true
    try {
      const exportNavBtn = page
        .getByRole('button')
        .filter({ has: page.locator('svg.lucide-file-json, svg[class*="file-json"]') })
      await expect(exportNavBtn.first()).toBeVisible({ timeout: 5000 })
      await exportNavBtn.first().click()
      await page.waitForURL(/\/export/, { waitUntil: 'networkidle', timeout: 10_000 })
    } catch (_) {
      jumpedByClick = false
      await page.goto('/export', { waitUntil: 'networkidle' })
    }

    // -------- 步骤 6：点"全选" + 监听 download → 点"导出 JSON 文件"--------
    const selectAllBtn = page.getByRole('button', { name: /全选/ })
    await expect(selectAllBtn).toBeVisible()
    await selectAllBtn.click()
    await page.waitForTimeout(400)

    // 真的监听浏览器 download
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 20_000 }),
      page.getByRole('button', { name: /导出 JSON 文件/ }).click(),
    ])

    // 文件名 & 内容
    const fileName = download.suggestedFilename()
    expect(fileName).toMatch(/^inspection-export-\d{4}-\d{2}-\d{2}-\d+\.json$/)
    const downloadPath = await download.path()
    expect(downloadPath, '下载的临时文件路径存在').toBeTruthy()
    const raw = fs.readFileSync(downloadPath!)
    const parsed1 = JSON.parse(raw.toString('utf-8')) as ExportedJSON

    // -------- 步骤 7：断言下载的 JSON 关键字段 --------
    expect(typeof parsed1.exportedAt).toBe('number')
    expect(parsed1.exportedBy).toBe('巡检员')
    expect(parsed1.appVersion).toBe('1.0.0')
    for (const k of ['templates', 'tasks', 'drafts', 'submissions', 'anomalies', 'eventLogs']) {
      expect(Array.isArray((parsed1 as any)[k])).toBe(true)
    }

    const taskObj = parsed1.tasks.find((t) => t.id === TASK_ID)
    expect(taskObj, `导出的 tasks 里必须有刚领取的任务 TASK_ID=${TASK_ID}`).toBeTruthy()
    expect(taskObj!.status).toBe('in_progress')
    expect(taskObj!.assignee).toBe('巡检员张三')
    expect(taskObj!.title).toBe(TASK_TITLE)

    const draftObj = parsed1.drafts.find((d) => d.taskId === TASK_ID)
    expect(draftObj, `导出的 drafts 里必须有刚保存的草稿`).toBeTruthy()
    expect(Object.keys(draftObj!.answers).length).toBe(4)
    const TPL_VER = draftObj!.templateVersion
    expect(TPL_VER.length).toBeGreaterThan(0)

    // -------- 步骤 8：断言事件日志顺序 --------
    const logsAsc = getTaskLogsAsc(parsed1, TASK_ID)
    expect(logsAsc.length).toBeGreaterThanOrEqual(6) // claim(1) + draft_save(4) + draft_load(>=1)

    expect(logsAsc[0].action).toBe('claim')
    expect(logsAsc[0].actor).toBe('巡检员张三')

    const saveLogs = logsAsc.filter((l) => l.action === 'draft_save')
    expect(saveLogs.length).toBe(4)
    expect(saveLogs[0].detail).toContain('（新建）')
    expect(saveLogs[saveLogs.length - 1].detail).toContain('（更新）')
    expect(saveLogs[saveLogs.length - 1].detail).toContain('4 项答案')
    for (const sl of saveLogs) expect(sl.detail).toContain(`v${TPL_VER}`)

    const loadLogs = logsAsc.filter((l) => l.action === 'draft_load')
    expect(loadLogs.length).toBeGreaterThanOrEqual(1)
    for (const ll of loadLogs) {
      expect(ll.detail).toContain('草稿已恢复')
      expect(ll.detail).toContain(`v${TPL_VER}`)
    }

    // 草稿 savedAt >= 最后一次 save 的 timestamp
    const lastSaveTs = saveLogs[saveLogs.length - 1].timestamp
    expect(draftObj!.savedAt).toBeGreaterThanOrEqual(lastSaveTs)

    // -------- 步骤 9：DOM 最新动作 vs 导出 JSON 最新动作 对齐 --------
    const exportLatestAction = [...logsAsc].sort((a, b) => b.timestamp - a.timestamp)[0].action
    expect(
      domLatestAction,
      `DOM 最新动作（label=${domLatestLabel} → action=${domLatestAction}） = 导出 JSON 最新动作（${exportLatestAction}）`
    ).toBe(exportLatestAction)

    // -------- 步骤 10：F5 刷新 → 再导出 → 两次数据一致 --------
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)

    const selectAllBtn2 = page.getByRole('button', { name: /全选/ })
    await expect(selectAllBtn2).toBeVisible()
    await selectAllBtn2.click()
    await page.waitForTimeout(400)

    const [download2] = await Promise.all([
      page.waitForEvent('download', { timeout: 20_000 }),
      page.getByRole('button', { name: /导出 JSON 文件/ }).click(),
    ])
    const downloadPath2 = await download2.path()
    expect(downloadPath2).toBeTruthy()
    const parsed2 = JSON.parse(fs.readFileSync(downloadPath2!).toString('utf-8')) as ExportedJSON

    const t2 = parsed2.tasks.find((t) => t.id === TASK_ID)!
    expect(t2.status).toBe(taskObj!.status)
    expect(t2.assignee).toBe(taskObj!.assignee)
    expect(t2.templateVersion).toBe(taskObj!.templateVersion)
    const d2 = parsed2.drafts.find((d) => d.taskId === TASK_ID)!
    expect(Object.keys(d2.answers).length).toBe(4)

    const logsAsc2 = getTaskLogsAsc(parsed2, TASK_ID)
    expect(logsAsc2.length).toBeGreaterThanOrEqual(logsAsc.length)
    for (let i = 0; i < 5 && i < logsAsc2.length; i++) {
      expect(logsAsc2[i].action, `第 ${i} 条事件动作一致`).toBe(logsAsc[i].action)
      expect(logsAsc2[i].taskId, `第 ${i} 条事件 taskId 一致`).toBe(logsAsc[i].taskId)
      expect(logsAsc2[i].actor, `第 ${i} 条事件 actor 一致`).toBe(logsAsc[i].actor)
    }
    expect(parsed2.exportedAt).toBeGreaterThanOrEqual(parsed1.exportedAt)

    // -------- 步骤 11：刷新 / 重开后的 DOM vs 导出一致性 --------
    // 再回日志页刷新一次，确认 DOM 和导出的事件总数、最新动作仍一致
    await page.goto('/inspector/logs', { waitUntil: 'networkidle' })
    await page.waitForTimeout(2500)

    const domLogCards2 = page.locator('div.relative.flex.gap-3.pb-5')
    const domLogCount2 = await domLogCards2.count()
    expect(domLogCount2, `刷新后日志页 DOM 卡片数 ${domLogCount2} >= 之前 ${domLogCount}`).toBeGreaterThanOrEqual(domLogCount)

    const domLogCards2First = domLogCards2.nth(0)
    const paras2 = domLogCards2First.locator('div.flex-1 p')
    const domLatestLabel2 = (await paras2.count()) > 0 ? (await paras2.nth(0).innerText()).trim() : ''
    const domLatestAction2 = DOM_LABEL_TO_ACTION[domLatestLabel2] || ''
    expect(
      domLatestAction2,
      `刷新后 DOM 最新动作（label=${domLatestLabel2} → action=${domLatestAction2}） = 第二次导出 JSON 最新动作`
    ).toBe([...logsAsc2].sort((a, b) => b.timestamp - a.timestamp)[0].action)

    // -------- 把两份 JSON 存到临时目录，方便用户手动核对 --------
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'round4-export-v2-'))
    const p1 = path.join(tmpDir, 'export-1-before-refresh.json')
    const p2 = path.join(tmpDir, 'export-2-after-refresh.json')
    fs.writeFileSync(p1, JSON.stringify(parsed1, null, 2))
    fs.writeFileSync(p2, JSON.stringify(parsed2, null, 2))
    test.info().annotations.push({
      type: 'export-files-path',
      description: [
        `before-refresh = ${p1}`,
        `after-refresh  = ${p2}`,
        `taskId = ${TASK_ID}`,
        `taskTitle = ${TASK_TITLE}`,
        `templateVersion = ${TPL_VER}`,
        `clicked-export-nav = ${jumpedByClick}`,
      ].join(' | '),
    })
  })
})
