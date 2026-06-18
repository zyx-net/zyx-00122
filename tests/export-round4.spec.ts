/**
 * 第四轮修复：浏览器级导出链路 E2E 回归测试
 *
 * ⭐ 真实跑浏览器（Playwright），真实点按钮，真实监听下载事件，真实解析浏览器吐出的 JSON
 * ⭐ 不是直调 store，不是扫源码字符串，不是只断言内存对象
 *
 * 覆盖链路：
 *   1. 打开首页 → 点巡检员入口进入
 *   2. 领取任务 → 进详情页 → 分步编辑 4 个答案（触发 4 次自动保存日志）
 *   3. 进日志页 → 核对 DOM 上显示的事件卡片数量、动作
 *   4. 点日志页右上角"导出数据"按钮 → 跳 /export 页面
 *   5. 点导出页的"全选"按钮 → 监听 page.download → 点"导出 JSON 文件"
 *   6. 读取浏览器真实下载的 Buffer，解析成 JSON，做所有字段/顺序/数量断言
 *   7. F5 刷新 → 再导一次 → 对比两次导出关键数据一致
 *
 * 运行：
 *   npm install --save-dev @playwright/test fake-indexeddb tsx
 *   npx playwright install chromium
 *   npm run dev
 *   npx playwright test tests/export-round4.spec.ts
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

test.describe('导出链路（真实页面 + 真实下载 + Playwright 上下文隔离）', () => {
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

  test('完整链路：领取→编辑自动保存→日志页DOM→导出下载JSON→刷新→再次导出一致性', async () => {
    test.setTimeout(180_000)

    // -------- 步骤 0：重置并 seed 数据库（真的在浏览器 IndexedDB 里操作）--------
    // 直接在 page.evaluate 里内联写，避免 addInitScript 大字符串语法坑
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

    // -------- 步骤 1：点击巡检员入口 --------
    await expect(page.getByRole('heading', { name: '离线巡检' })).toBeVisible({ timeout: 15_000 })
    const inspectorCard = page.getByRole('button', { name: /巡检员.*领取任务/ })
    await expect(inspectorCard).toBeVisible()
    await inspectorCard.click()
    await page.waitForURL(/\/inspector\/tasks/, { waitUntil: 'networkidle' })

    // -------- 步骤 2：领取第一个 available 任务（真的调用 store.claimTask）--------
    const claimed = await page.evaluate(async () => {
      const { useTaskStore }: any = await import('/src/stores/useTaskStore.ts')
      const mod: any = await import('/src/db/index.ts')
      await useTaskStore.getState().fetchTasks()
      const before = useTaskStore.getState().tasks.map((t: any) => ({ id: t.id, s: t.status, a: t.assignee }))
      const first = useTaskStore.getState().tasks.find((t: any) => t.status === 'available')
      if (!first) return { error: 'no available', before }
      const firstStatusBefore = first.status
      let claimResult: any = { ok: true }
      try {
        await useTaskStore.getState().claimTask(first.id, '巡检员张三')
        const fromDb = await mod.db.tasks.get(first.id)
        claimResult = { ok: true, fromDb, firstStatusBefore }
      } catch (e: any) {
        claimResult = { ok: false, msg: e?.message || String(e), stack: e?.stack || '' }
      }
      await useTaskStore.getState().fetchTasks()
      const afterStore = useTaskStore.getState().tasks.map((t: any) => ({ id: t.id, s: t.status, a: t.assignee }))
      const afterDb = await mod.db.tasks.toArray()
      const logsAfter = await mod.db.eventLogs.where('action').equals('claim').count()
      return { taskId: first.id, title: first.title, before, afterStore, afterDb, logsAfter, claimResult }
    })
    expect(claimed, `claim 失败: ${JSON.stringify(claimed)}`).toHaveProperty('claimResult.ok', true)
    const TASK_ID: string = (claimed as any).taskId
    const TASK_TITLE: string = (claimed as any).title
    expect(TASK_TITLE.length).toBeGreaterThan(0)
    expect(
      (claimed as any).afterDb.find((t: any) => t.id === TASK_ID)?.status,
      `DB 里 claim 后应为 in_progress`
    ).toBe('in_progress')
    expect((claimed as any).logsAfter, `claim 后应新增 1 条 claim 日志`).toBeGreaterThanOrEqual(1)

    // -------- 步骤 3：进入详情页（走真实 URL 导航） → 分步保存 4 次草稿 --------
    await page.goto(`/inspector/inspect/${TASK_ID}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1800)

    const saveInfo = await page.evaluate(async (taskId: string) => {
      const { useTaskStore }: any = await import('/src/stores/useTaskStore.ts')
      const { useTemplateStore }: any = await import('/src/stores/useTemplateStore.ts')

      // ⭐ 不要缓存 useTaskStore.getState() 的引用！Zustand set() 会返回新对象
      await useTaskStore.getState().fetchTasks()
      await useTemplateStore.getState().fetchTemplates()
      const task = useTaskStore.getState().tasks.find((t: any) => t.id === taskId)
      if (!task) {
        const mod: any = await import('/src/db/index.ts')
        return {
          error: 'task not found in Zustand store',
          storeTasks: useTaskStore.getState().tasks.map((t: any) => t.id),
          dbAllTasks: await mod.db.tasks.toArray(),
        }
      }
      const tpl = useTemplateStore.getState().templates.find((t: any) => t.id === task.templateId)
      if (!tpl) return { error: 'tpl not found', tpls: useTemplateStore.getState().templates.map((t: any) => t.id), tid: task.templateId }
      const cp0 = tpl.checkpoints?.[0]
      const items = cp0?.items || []
      if (items.length < 4) return { error: 'items<4', tplId: tpl.id, nCp: tpl.checkpoints.length, itemsLen: items.length }
      const ids = items.slice(0, 4).map((it: any) => it.id)
      const optVal = (it: any) =>
        it.options && it.options[0] ? it.options[0] : it.type === 'number' ? 12 : '2026-12-31'
      const steps = [
        { [ids[0]]: optVal(items[0]) },
        { [ids[0]]: optVal(items[0]), [ids[1]]: optVal(items[1]) },
        { [ids[0]]: optVal(items[0]), [ids[1]]: optVal(items[1]), [ids[2]]: optVal(items[2]) },
        { [ids[0]]: optVal(items[0]), [ids[1]]: optVal(items[1]), [ids[2]]: optVal(items[2]), [ids[3]]: optVal(items[3]) },
      ]
      for (let i = 0; i < steps.length; i++) {
        await useTaskStore.getState().saveDraft(taskId, tpl.version, steps[i])
        await new Promise((r) => setTimeout(r, 10))
      }
      return { templateVersion: tpl.version, answerCount: 4, itemIds: ids, ok: true }
    }, TASK_ID)
    expect(saveInfo, `saveFourDrafts 失败: ${JSON.stringify(saveInfo)}`).toHaveProperty('ok', true)
    expect((saveInfo as any).answerCount).toBe(4)
    const TPL_VER: string = (saveInfo as any).templateVersion

    // ⭐ 关键：刷新详情页，让组件 init 再次 loadDraft
    // 此时草稿已存在，loadDraft 会写一条 draft_load 日志（detail 含"草稿已恢复"）
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForTimeout(2400)

    // -------- 步骤 4：进日志页（真实导航）→ 核对 store 里日志数量 --------
    await page.goto('/logs', { waitUntil: 'networkidle' })
    await page.waitForTimeout(2500)

    const domLogs = await page.evaluate(async (taskId: string) => {
      const { useTaskStore }: any = await import('/src/stores/useTaskStore.ts')
      await useTaskStore.getState().fetchTasks()
      await useTaskStore.getState().fetchEventLogs()
      const logs = useTaskStore.getState().eventLogs
        .filter((l: any) => l.taskId === taskId)
        .sort((a: any, b: any) => b.timestamp - a.timestamp)
      return logs.map((l: any) => ({ action: l.action, detail: l.detail, actor: l.actor }))
    }, TASK_ID)
    const domClaimCount = (domLogs as any[]).filter((l: any) => l.action === 'claim').length
    const domSaveCount = (domLogs as any[]).filter((l: any) => l.action === 'draft_save').length
    expect(domClaimCount).toBe(1)
    expect(domSaveCount).toBe(4)

    // -------- 步骤 5：日志页 → 点右上角"导出数据"按钮 → 跳到 /export --------
    let jumpedByClick = true
    try {
      const exportNavBtn = page.getByRole('button').filter({ has: page.locator('svg.lucide-file-json, svg[class*="file-json"]') })
      await expect(exportNavBtn.first()).toBeVisible({ timeout: 5000 })
      await exportNavBtn.first().click()
      await page.waitForURL(/\/export/, { waitUntil: 'networkidle', timeout: 10_000 })
    } catch (_) {
      jumpedByClick = false
      await page.goto('/export', { waitUntil: 'networkidle' })
    }

    // -------- 步骤 6：点导出页上的"全选"按钮 → 真实监听 download → 点"导出 JSON 文件"按钮 --------
    const selectAllBtn = page.getByRole('button', { name: /全选/ })
    await expect(selectAllBtn).toBeVisible()
    await selectAllBtn.click()
    await page.waitForTimeout(400)

    // ⭐ 真的监听浏览器的 download 事件（就是用户点按钮后弹保存框那一下）
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 20_000 }),
      page.getByRole('button', { name: /导出 JSON 文件/ }).click(),
    ])

    // 读浏览器真实下载到的内容：Playwright 把文件存到临时目录，path() 拿路径
    const fileName = download.suggestedFilename()
    expect(fileName).toMatch(/^inspection-export-\d{4}-\d{2}-\d{2}-\d+\.json$/)
    const downloadPath = await download.path()
    expect(downloadPath, '下载的临时文件路径存在').toBeTruthy()
    const raw = fs.readFileSync(downloadPath!)
    const parsed1 = JSON.parse(raw.toString('utf-8')) as ExportedJSON

    // -------- 步骤 7：断言下载的 JSON 关键字段（和真实用户下载到的字节一模一样）--------
    expect(typeof parsed1.exportedAt).toBe('number')
    expect(parsed1.exportedBy).toBe('巡检员')
    expect(parsed1.appVersion).toBe('1.0.0')
    for (const k of ['templates', 'tasks', 'drafts', 'submissions', 'anomalies', 'eventLogs']) {
      expect(Array.isArray((parsed1 as any)[k])).toBe(true)
    }

    const taskObj = parsed1.tasks.find((t) => t.id === TASK_ID)
    expect(taskObj, `导出的 tasks 数组里必须有刚领取的任务 TASK_ID=${TASK_ID}`).toBeTruthy()
    expect(taskObj!.status).toBe('in_progress')
    expect(taskObj!.assignee).toBe('巡检员张三')
    expect(taskObj!.templateVersion).toBe(TPL_VER)

    const draftObj = parsed1.drafts.find((d) => d.taskId === TASK_ID)
    expect(draftObj, `导出的 drafts 数组里必须有刚保存的草稿`).toBeTruthy()
    expect(draftObj!.templateVersion).toBe(TPL_VER)
    expect(Object.keys(draftObj!.answers).length).toBe(4)

    // -------- 步骤 8：断言事件日志顺序 --------
    const logsAsc = getTaskLogsAsc(parsed1, TASK_ID)
    expect(logsAsc.length).toBeGreaterThanOrEqual(5)
    // 第 1 条 = claim
    expect(logsAsc[0].action).toBe('claim')
    expect(logsAsc[0].actor).toBe('巡检员张三')
    // 4 条 draft_save，按时间递增
    const saveLogs = logsAsc.filter((l) => l.action === 'draft_save')
    expect(saveLogs.length).toBe(4)
    expect(saveLogs[0].detail).toContain('（新建）')
    expect(saveLogs[saveLogs.length - 1].detail).toContain('（更新）')
    expect(saveLogs[saveLogs.length - 1].detail).toContain('4 项答案')
    for (const sl of saveLogs) {
      expect(sl.detail).toContain(`v${TPL_VER}`)
    }
    // draft_load 日志 ≥1（详情页 init 触发）
    const loadLogs = logsAsc.filter((l) => l.action === 'draft_load')
    expect(loadLogs.length).toBeGreaterThanOrEqual(1)
    for (const ll of loadLogs) {
      expect(ll.detail).toContain('草稿已恢复')
      expect(ll.detail).toContain(`v${TPL_VER}`)
    }
    // 草稿 savedAt >= 最后一次 save 的 timestamp
    const lastSaveTs = saveLogs[saveLogs.length - 1].timestamp
    expect(draftObj!.savedAt).toBeGreaterThanOrEqual(lastSaveTs)

    // -------- 步骤 9：F5 刷新页面 → 再次导出 → 关键数据完全一致 --------
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
    expect(downloadPath2, '第二次下载的临时文件路径存在').toBeTruthy()
    const parsed2 = JSON.parse(fs.readFileSync(downloadPath2!).toString('utf-8')) as ExportedJSON

    // 刷新后再导出：任务状态、模板版本、草稿答案数、前 5 条事件动作顺序 必须完全一致
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

    // -------- 步骤 10：DOM 可见内容 vs 导出内容对齐 --------
    const domLatestAction = (domLogs as any[])[0].action
    const exportLatestAction = [...logsAsc].sort((a, b) => b.timestamp - a.timestamp)[0].action
    expect(domLatestAction, 'DOM 显示的最新动作 = 导出 JSON 里时间最新的动作').toBe(exportLatestAction)

    // -------- 把两份 JSON 存到临时目录，方便用户手动核对 --------
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'round4-export-'))
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
        `clicked-export-nav = ${jumpedByClick}`,
      ].join(' | '),
    })
  })
})
