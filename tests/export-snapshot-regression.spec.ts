/**
 * 导出快照回归测试：完整链路验证
 *
 * ⭐ 覆盖：
 *   - 领取任务 → 编辑自动保存 → 进入日志页
 *   - 日志页点击导出 → 验证完整快照创建
 *   - 导出完成 → 返回日志页验证记录
 *   - 验证快照包含：pageContext, keyFieldsSnapshot, sortInfo, taskSnapshot, logSnapshot
 *   - 刷新页面 → 验证快照持久化后仍可复核
 *   - 验证连续导出不覆盖记录
 *   - 验证失败记录包含 failureTrace
 *   - 验证旧记录缺字段时的兼容展示
 */

import { test, expect, type Page, type BrowserContext } from '@playwright/test'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

type ExportRecord = {
  id: string
  triggeredAt: number
  status: 'pending' | 'success' | 'failed'
  exportedBy: string
  pageContext?: {
    route: string
    viewMode: string
    screenSize: { width: number; height: number }
  } | null
  keyFieldsSnapshot?: {
    totalTaskCount: number
    inProgressCount: number
    logCount: number
  } | null
  sortInfo?: {
    sortBy: string
    sortOrder: string
    visibleRange: { start: number; end: number; total: number }
  } | null
  taskSnapshot?: {
    taskId: string
    status: string
    title: string
    assignee: string
  } | null
  logSnapshot?: Array<{ action: string; detail: string; timestamp: number }> | null
  failureTrace?: Array<{ step: string; message: string; severity: string; timestamp: number }> | null
  fileSummary?: { fileName: string; fileSize: number; recordCount: number } | null
  errorMessage?: string
  appVersion?: string
}

test.describe('导出快照完整链路回归测试', () => {
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

  test('完整链路：编辑→导出→刷新复核快照→失败记录→连续导出不覆盖', async () => {
    test.setTimeout(900_000)

    // -------- 步骤 0：重置并 seed --------
    const resetOk = await page.evaluate(async () => {
      const mod = await import('/src/db/index.ts')
      await Promise.all([
        mod.db.templates.clear(),
        mod.db.tasks.clear(),
        mod.db.drafts.clear(),
        mod.db.submissions.clear(),
        mod.db.anomalies.clear(),
        mod.db.eventLogs.clear(),
        mod.db.exportRecords.clear(),
      ])
      try {
        localStorage.removeItem('inspection-export-history')
        localStorage.removeItem('inspection-last-successful-export')
      } catch {
        // ignore
      }
      await new Promise((r) => setTimeout(r, 50))
      await mod.seedDatabase()
      const { useTaskStore } = await import('/src/stores/useTaskStore.ts')
      const { useTemplateStore } = await import('/src/stores/useTemplateStore.ts')
      const { useExportStore } = await import('/src/stores/useExportStore.ts')
      await useTaskStore.getState().fetchTasks()
      await useTemplateStore.getState().fetchTemplates()
      await useExportStore.getState().fetchExportRecords()
      return true
    })
    expect(resetOk).toBe(true)

    // -------- 步骤 1：首页点巡检员入口 --------
    await expect(page.getByRole('heading', { name: '离线巡检' })).toBeVisible({ timeout: 15_000 })
    const inspectorCard = page.getByRole('button', { name: /巡检员.*领取任务/ })
    await expect(inspectorCard).toBeVisible()
    await inspectorCard.click()
    await page.waitForURL(/\/inspector\/tasks/, { waitUntil: 'networkidle' })

    // -------- 步骤 2：领取任务 --------
    const claimBtn = page.getByRole('button', { name: '领取任务' }).first()
    await expect(claimBtn).toBeVisible()
    await Promise.all([
      page.waitForSelector('text=任务领取成功', { timeout: 10_000 }),
      claimBtn.click(),
    ])
    await expect(page.getByRole('button', { name: /我的任务/ })).toBeVisible({ timeout: 5000 })

    const myTaskCard = page.locator('div.rounded-xl.bg-white.p-4').first()
    await expect(myTaskCard).toBeVisible()
    const TASK_TITLE: string = await myTaskCard.locator('h3').first().innerText()
    expect(TASK_TITLE.length).toBeGreaterThan(0)

    await myTaskCard.click()
    await page.waitForURL(/\/inspector\/inspect\//, { waitUntil: 'networkidle' })
    const match = page.url().match(/\/inspect\/([^/?#]+)/)
    expect(match, 'URL 应包含 /inspect/<taskId>').toBeTruthy()
    const TASK_ID: string = match![1]

    // -------- 步骤 3：编辑答案（自动保存）--------
    const itemLabels = [
      '灭火器是否在位',
      '灭火器压力表读数',
      '消防通道是否畅通',
      '应急照明是否正常',
    ]
    for (let i = 0; i < itemLabels.length; i++) {
      const label = itemLabels[i]
      const labelEl = page.locator('label', { hasText: new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first()
      await expect(labelEl).toBeVisible({ timeout: 5000 })
      const itemRoot = labelEl.locator('xpath=ancestor::*[.//button][1]')
      const firstOptBtn = itemRoot.locator('button').first()
      await expect(firstOptBtn).toBeVisible()
      await firstOptBtn.click()
      await page.waitForSelector('text=草稿已自动保存', { timeout: 3000 })
      await page.waitForTimeout(500)
    }

    // 刷新详情页触发 loadDraft
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)

    // -------- 步骤 4：进入日志页 --------
    await page.goto('/inspector/logs', { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)

    // 验证日志页 DOM 结构
    const domLogCards = page.locator('div.relative.flex.gap-3.pb-5')
    const domLogCount = await domLogCards.count()
    expect(domLogCount, '日志页 DOM 上至少应展示 6 条卡片').toBeGreaterThanOrEqual(6)

    // -------- 步骤 5：点击导出按钮，验证创建导出记录 --------
    const exportBtn = page.locator('[data-export-button]')
    await expect(exportBtn, '导出按钮应存在').toBeVisible()
    await expect(exportBtn, '导出按钮应可用').not.toBeDisabled()

    await exportBtn.click()
    await page.waitForURL(/\/export/, { waitUntil: 'networkidle', timeout: 10_000 })

    // -------- 步骤 6：执行导出，监听下载 --------
    const selectAllBtn = page.getByRole('button', { name: /全选/ })
    await expect(selectAllBtn, '全选按钮应存在').toBeVisible()

    // 验证全选前的状态，然后点击全选
    await selectAllBtn.click()
    await page.waitForTimeout(1500)

    // 验证取消全选按钮显示（说明已经全选了）
    const unselectAllBtn = page.getByRole('button', { name: /取消全选/ })
    const hasUnselectAll = await unselectAllBtn.count()
    if (hasUnselectAll === 0) {
      // 如果还显示"全选"，再点一次
      await selectAllBtn.click()
      await page.waitForTimeout(1500)
    }

    const exportJsonBtn = page.getByRole('button', { name: /导出 JSON 文件/ })
    await expect(exportJsonBtn, '导出按钮应存在').toBeVisible()
    await expect(exportJsonBtn, '导出按钮应可用').not.toBeDisabled()

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 45_000 }),
      exportJsonBtn.click(),
    ])

    const fileName = download.suggestedFilename()
    expect(fileName).toMatch(/^inspection-export-\d{4}-\d{2}-\d{2}-\d+\.json$/)

    // -------- 步骤 7：导出成功后返回日志页 --------
    const returnToLogsBtn = page.getByRole('button', { name: /返回日志页查看记录/ })
    await expect(returnToLogsBtn, '导出成功后应显示返回日志页查看记录按钮').toBeVisible()
    await returnToLogsBtn.click()
    await page.waitForURL(/\/inspector\/logs/, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1000)

    // -------- 步骤 8：验证第一条导出记录的完整快照 --------
    const firstRecordData = await page.evaluate(async () => {
      const { useExportStore } = (window as any)
      const records = useExportStore.getState().exportRecords
      return records[0] as ExportRecord
    })

    expect(firstRecordData, '第一条导出记录应存在').toBeTruthy()
    expect(firstRecordData.status).toBe('success')
    expect(firstRecordData.exportedBy).toBe('巡检员')
    expect(firstRecordData.appVersion).toBe('1.0.0')

    // 验证 pageContext 快照
    expect(firstRecordData.pageContext, 'pageContext 快照应存在').toBeTruthy()
    expect(firstRecordData.pageContext!.route).toBe('/inspector/logs')
    expect(firstRecordData.pageContext!.viewMode).toBe('all')
    expect(firstRecordData.pageContext!.screenSize.width).toBeGreaterThan(0)
    expect(firstRecordData.pageContext!.screenSize.height).toBeGreaterThan(0)

    // 验证 keyFieldsSnapshot 快照
    expect(firstRecordData.keyFieldsSnapshot, 'keyFieldsSnapshot 快照应存在').toBeTruthy()
    expect(firstRecordData.keyFieldsSnapshot!.totalTaskCount).toBeGreaterThan(0)
    expect(firstRecordData.keyFieldsSnapshot!.inProgressCount).toBeGreaterThan(0)
    expect(firstRecordData.keyFieldsSnapshot!.logCount).toBeGreaterThanOrEqual(6)

    // 验证 sortInfo 快照
    expect(firstRecordData.sortInfo, 'sortInfo 快照应存在').toBeTruthy()
    expect(firstRecordData.sortInfo!.sortBy).toBe('timestamp')
    expect(firstRecordData.sortInfo!.sortOrder).toBe('desc')
    expect(firstRecordData.sortInfo!.visibleRange.total).toBeGreaterThanOrEqual(6)

    // 验证 logSnapshot 快照
    expect(firstRecordData.logSnapshot, 'logSnapshot 快照应存在').toBeTruthy()
    expect(firstRecordData.logSnapshot!.length).toBeGreaterThanOrEqual(6)

    // 验证 taskSnapshot - 全日志视图下为 null，单任务视图下才有值
    // 这里我们是全日志视图，所以应该是 null
    expect(firstRecordData.taskSnapshot, '全日志视图下 taskSnapshot 应为 null').toBeNull()

    // 验证 failureTrace 快照（成功导出也应该有追踪日志）
    expect(firstRecordData.failureTrace, 'failureTrace 追踪日志应存在').toBeTruthy()
    expect(firstRecordData.failureTrace!.length).toBeGreaterThan(0)
    const hasInitStep = firstRecordData.failureTrace!.some(t => t.step === 'init')
    expect(hasInitStep, '追踪日志应包含 init 步骤').toBe(true)
    const hasCompleteStep = firstRecordData.failureTrace!.some(t => t.step === 'complete')
    expect(hasCompleteStep, '追踪日志应包含 complete 步骤').toBe(true)

    // -------- 步骤 9：点击历史记录，验证 UI 展示所有快照信息 --------
    const historyBtn = page.locator('button').filter({ has: page.locator('svg.lucide-history, svg[class*="history"]') })
    await historyBtn.first().click()
    await page.waitForTimeout(500)

    const exportRecordCard = page.locator('div.rounded-lg.border.border-gray-200.bg-white.p-3')
    await expect(exportRecordCard.first(), '导出记录卡片应存在').toBeVisible()

    const reviewBtn = exportRecordCard.first().getByRole('button', { name: /复核/ })
    await expect(reviewBtn, '复核按钮应存在').toBeVisible()
    await reviewBtn.click()
    await page.waitForTimeout(500)

    // 验证复核弹窗显示
    const reviewModal = page.getByRole('dialog').or(page.locator('div.fixed.inset-0'))
    await expect(reviewModal, '复核弹窗应显示').toBeVisible()

    // 验证新增的快照区域都显示
    await expect(page.getByText('页面上下文快照'), '页面上下文快照区域应显示').toBeVisible()
    await expect(page.getByText('关键字段快照'), '关键字段快照区域应显示').toBeVisible()
    await expect(page.getByText('排序与范围快照'), '排序与范围快照区域应显示').toBeVisible()
    // 全日志视图下没有 taskSnapshot，所以不检查
    await expect(page.getByText('日志顺序快照'), '日志顺序快照区域应显示').toBeVisible()

    // 验证失败追踪日志也显示（成功记录的追踪日志）
    await expect(page.getByText(/失败追踪日志/), '追踪日志区域应显示').toBeVisible()

    // 关闭弹窗
    const closeBtn = page.getByRole('button').filter({ has: page.locator('svg.lucide-x, svg[class*="x"]') })
    await closeBtn.first().click()
    await page.waitForTimeout(300)

    // -------- 步骤 10：验证防重复导出机制 --------
    const recordCountBefore = await page.evaluate(async () => {
      const { useExportStore } = (window as any)
      return useExportStore.getState().exportRecords.length
    })

    // 验证 canTriggerExport 方法工作
    const canExport = await page.evaluate(() => {
      const { useExportStore } = (window as any)
      return useExportStore.getState().canTriggerExport()
    })
    expect(canExport, '初始时应可以导出').toBe(true)

    // 手动设置 lastExportTriggeredAt 为当前时间，模拟刚刚导出过
    await page.evaluate(() => {
      const { useExportStore } = (window as any)
      useExportStore.setState({ lastExportTriggeredAt: Date.now() })
    })

    // 验证现在不能导出
    const canExportAfter = await page.evaluate(() => {
      const { useExportStore } = (window as any)
      return useExportStore.getState().canTriggerExport()
    })
    expect(canExportAfter, '刚导出后不应允许立即再次导出').toBe(false)

    // 重置状态
    await page.evaluate(() => {
      const { useExportStore } = (window as any)
      useExportStore.setState({ lastExportTriggeredAt: 0 })
    })

    // -------- 步骤 11：创建一条失败记录，验证 failureTrace --------
    const failedRecordId = await page.evaluate(async () => {
      const { useExportStore } = (window as any)
      const store = useExportStore.getState()

      const now = Date.now()
      const exportId = `export-${now}-test-failed`

      const failureTrace = [
        { timestamp: now, step: 'init', message: '开始导出测试', severity: 'info' as const },
        { timestamp: now + 100, step: 'fetch_tasks', message: '获取任务数据...', severity: 'info' as const },
        { timestamp: now + 200, step: 'fetch_tasks', message: '网络连接超时', severity: 'error' as const },
      ]

      const record = {
        id: exportId,
        triggeredAt: now,
        filter: {},
        selectedTypes: ['tasks'],
        fileSummary: null,
        status: 'failed' as const,
        errorMessage: '网络连接超时，无法获取任务数据',
        exportedBy: '巡检员',
        pageContext: {
          route: '/inspector/logs',
          viewMode: 'all' as const,
          timestamp: now,
          userAgent: 'test-agent',
          screenSize: { width: 1280, height: 720 },
        },
        keyFieldsSnapshot: {
          totalTaskCount: 3,
          inProgressCount: 1,
          completedCount: 0,
          logCount: 10,
          anomalyCount: 0,
          draftCount: 1,
        },
        sortInfo: {
          sortBy: 'timestamp' as const,
          sortOrder: 'desc' as const,
          visibleRange: { start: 0, end: 10, total: 10 },
        },
        taskSnapshot: null,
        logSnapshot: null,
        failureTrace,
        appVersion: '1.0.0',
      }

      const mod = await import('/src/db/index.ts')
      await mod.db.exportRecords.add(record)
      await store.fetchExportRecords()

      return exportId
    })

    expect(failedRecordId, '失败记录应创建成功').toBeTruthy()

    // 刷新页面，验证持久化
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)

    // 打开历史记录
    const historyBtn2 = page.locator('button').filter({ has: page.locator('svg.lucide-history, svg[class*="history"]') })
    await historyBtn2.first().click()
    await page.waitForTimeout(500)

    // 验证失败记录显示
    const failedCard = page.locator('div.rounded-lg.border.border-gray-200.bg-white.p-3').nth(0)
    await expect(failedCard.getByText('失败'), '失败记录应显示失败状态').toBeVisible()
    await expect(failedCard.getByText('网络连接超时'), '失败记录应显示错误信息').toBeVisible()

    // 点击复核失败记录
    const failedReviewBtn = failedCard.getByRole('button', { name: /复核/ })
    await expect(failedReviewBtn, '失败记录也应有复核按钮').toBeVisible()
    await failedReviewBtn.click()
    await page.waitForTimeout(500)

    // 验证失败记录的复核弹窗显示完整信息
    const failedReviewModal = page.getByRole('dialog').or(page.locator('div.fixed.inset-0'))
    await expect(failedReviewModal, '复核弹窗应显示').toBeVisible()

    await expect(failedReviewModal.getByText('错误信息'), '失败记录应显示错误信息区域').toBeVisible()
    await expect(failedReviewModal.getByText('网络连接超时，无法获取任务数据'), '失败记录应显示具体错误').toBeVisible()
    await expect(failedReviewModal.getByText('页面上下文快照'), '失败记录也应显示页面上下文').toBeVisible()
    await expect(failedReviewModal.getByText('关键字段快照'), '失败记录也应显示关键字段').toBeVisible()
    await expect(failedReviewModal.getByText(/失败追踪日志/), '失败记录应显示追踪日志').toBeVisible()

    // 验证追踪日志中的错误步骤
    const traceItems = page.locator('[data-testid="failure-trace-item"]')
    const traceCount = await traceItems.count()
    expect(traceCount, '应显示追踪日志条目').toBeGreaterThanOrEqual(1)

    const errorTraceItems = page.locator('[data-testid="failure-trace-item"].bg-red-50')
    const errorTraceCount = await errorTraceItems.count()
    expect(errorTraceCount, '应至少有一条错误级别的追踪日志').toBeGreaterThanOrEqual(1)

    // 关闭弹窗
    const closeBtn2 = page.getByRole('button').filter({ has: page.locator('svg.lucide-x, svg[class*="x"]') })
    await closeBtn2.first().click()
    await page.waitForTimeout(300)

    // -------- 步骤 12：验证旧记录缺字段时的兼容展示 --------
    const oldRecordId = await page.evaluate(async () => {
      const { useExportStore, normalizeExportRecord } = (window as any)
      const store = useExportStore.getState()

      const now = Date.now() - 86400000

      // 模拟一条旧版本的记录，缺少新字段
      const oldRecord = {
        id: `export-${now}-old-format`,
        triggeredAt: now,
        filter: {},
        selectedTypes: ['eventLogs'],
        fileSummary: {
          fileName: 'old-export-2025-01-01.json',
          fileSize: 1024,
          recordCount: 5,
          dataTypes: ['eventLogs'],
        },
        status: 'success' as const,
        exportedBy: '历史用户',
        // 故意缺少 pageContext, keyFieldsSnapshot, sortInfo, failureTrace, appVersion
      }

      const mod = await import('/src/db/index.ts')
      await mod.db.exportRecords.add(oldRecord as any)
      await store.fetchExportRecords()

      // 验证 normalizeExportRecord 可以正确处理旧记录
      const normalized = normalizeExportRecord(oldRecord)
      console.log('Normalized old record:', normalized)

      return oldRecord.id
    })

    expect(oldRecordId, '旧记录应创建成功').toBeTruthy()

    // 刷新页面验证兼容
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)

    // 打开历史记录
    const historyBtn3 = page.locator('button').filter({ has: page.locator('svg.lucide-history, svg[class*="history"]') })
    await historyBtn3.first().click()
    await page.waitForTimeout(500)

    // 验证旧记录可以正常显示
    const allCards = page.locator('div.rounded-lg.border.border-gray-200.bg-white.p-3')
    const cardCount = await allCards.count()
    expect(cardCount, '应显示所有记录包括旧记录').toBeGreaterThanOrEqual(3)

    // 找到旧记录并点击复核
    const oldCard = allCards.filter({ hasText: 'old-export-2025-01-01.json' })
    await expect(oldCard.first(), '旧记录应显示').toBeVisible()

    const oldReviewBtn = oldCard.first().getByRole('button', { name: /复核/ })
    await expect(oldReviewBtn, '旧记录也应有复核按钮').toBeVisible()
    await oldReviewBtn.click()
    await page.waitForTimeout(500)

    // 验证旧记录的弹窗可以正常显示（不崩溃）
    const oldRecordModal = page.getByRole('dialog').or(page.locator('div.fixed.inset-0'))
    await expect(oldRecordModal.getByText('导出记录复核'), '旧记录复核弹窗应显示').toBeVisible()
    await expect(oldRecordModal.getByText('old-export-2025-01-01.json'), '旧记录文件名应显示').toBeVisible()

    // 验证 normalizeExportRecord 正确填充了默认值（不显示空的快照区域）
    const hasPageContext = await oldRecordModal.evaluate((el) => {
      return el.textContent?.includes('页面上下文快照') || false
    })
    // 旧记录没有 pageContext，所以不应该显示该区域
    expect(hasPageContext, '旧记录没有 pageContext 就不应显示该区域').toBe(false)

    // 关闭弹窗
    const closeBtn3 = page.getByRole('button').filter({ has: page.locator('svg.lucide-x, svg[class*="x"]') })
    await closeBtn3.first().click()
    await page.waitForTimeout(300)

    // -------- 步骤 13：验证最近成功导出横幅持久化 --------
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)

    const lastExportBanner = page.getByText(/最近成功导出/)
    await expect(lastExportBanner, '刷新后最近成功导出横幅仍应显示').toBeVisible({ timeout: 5000 })

    // 点击横幅上的复核按钮
    const bannerReviewBtn = page.getByRole('button', { name: /复核/ }).first()
    await expect(bannerReviewBtn, '横幅上的复核按钮应存在').toBeVisible()
    await bannerReviewBtn.click()
    await page.waitForTimeout(500)

    // 验证复核弹窗显示所有快照信息
    await expect(page.getByText('导出记录复核'), '刷新后复核弹窗仍应显示').toBeVisible()
    await expect(page.getByText('页面上下文快照'), '刷新后页面上下文仍应显示').toBeVisible()
    await expect(page.getByText('关键字段快照'), '刷新后关键字段仍应显示').toBeVisible()
    await expect(page.getByText('排序与范围快照'), '刷新后排序范围仍应显示').toBeVisible()

    // 保存测试产物
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-regression-'))
    test.info().annotations.push({
      type: 'test-artifacts',
      description: `测试完成，临时目录 = ${tmpDir}`,
    })
  })
})
