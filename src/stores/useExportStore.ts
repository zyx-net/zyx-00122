import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { db } from '@/db'
import type { ExportRecord, ExportFilter, ExportStatus, TaskStateSnapshot, TriggerSource } from '@/types'

const EXPORT_HISTORY_KEY = 'inspection-export-history'
const LAST_SUCCESSFUL_EXPORT_KEY = 'inspection-last-successful-export'
const MIN_EXPORT_INTERVAL = 2000

async function computeContentHash(data: Record<string, unknown> | string): Promise<string> {
  const str = typeof data === 'string' ? data : JSON.stringify(data)
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  const strHash = Math.abs(hash).toString(36)
  const len = str.length
  return `${strHash}-${len.toString(36)}`
}

function diffTaskStates(before: TaskStateSnapshot[], after: TaskStateSnapshot[]) {
  const differences: Array<{ field: string; before: unknown; after: unknown; changed: boolean; taskId: string; taskTitle: string }> = []
  const beforeMap = new Map(before.map(t => [t.taskId, t]))
  const afterMap = new Map(after.map(t => [t.taskId, t]))

  const allIds = new Set([...beforeMap.keys(), ...afterMap.keys()])

  for (const taskId of allIds) {
    const b = beforeMap.get(taskId)
    const a = afterMap.get(taskId)
    const title = a?.title || b?.title || taskId

    if (!b && a) {
      differences.push({ field: 'existence', before: null, after: 'created', changed: true, taskId, taskTitle: title })
      differences.push({ field: 'status', before: null, after: a.status, changed: true, taskId, taskTitle: title })
      differences.push({ field: 'assignee', before: null, after: a.assignee, changed: !!a.assignee, taskId, taskTitle: title })
      continue
    }
    if (b && !a) {
      differences.push({ field: 'existence', before: 'existed', after: null, changed: true, taskId, taskTitle: title })
      continue
    }
    if (b && a) {
      if (b.status !== a.status) {
        differences.push({ field: 'status', before: b.status, after: a.status, changed: true, taskId, taskTitle: title })
      }
      if (b.assignee !== a.assignee) {
        differences.push({ field: 'assignee', before: b.assignee, after: a.assignee, changed: true, taskId, taskTitle: title })
      }
      if (b.updatedAt !== a.updatedAt) {
        differences.push({ field: 'updatedAt', before: b.updatedAt, after: a.updatedAt, changed: true, taskId, taskTitle: title })
      }
    }
  }
  return differences
}

interface ExportState {
  exportRecords: ExportRecord[]
  lastSuccessfulExport: ExportRecord | null
  currentExportId: string | null
  exportError: string | null
  showExportHistory: boolean
  lastExportTriggeredAt: number
  pendingExports: Set<string>

  fetchExportRecords: () => Promise<void>
  createExportRecord: (
    filter: ExportFilter,
    selectedTypes: string[],
    exportedBy: string,
    options?: {
      taskSnapshot?: ExportRecord['taskSnapshot']
      logSnapshot?: ExportRecord['logSnapshot']
      pageContext?: ExportRecord['pageContext']
      keyFieldsSnapshot?: ExportRecord['keyFieldsSnapshot']
      sortInfo?: ExportRecord['sortInfo']
      triggerSource?: TriggerSource
      tasksBeforeExport?: TaskStateSnapshot[]
    }
  ) => Promise<string>
  finalizeExport: (
    exportId: string,
    options: {
      status: ExportStatus
      fileSummary?: ExportRecord['fileSummary']
      errorMessage?: string
      failureTrace?: ExportRecord['failureTrace']
      exportedData?: Record<string, unknown>
      tasksAfterExport?: TaskStateSnapshot[]
    }
  ) => Promise<void>
  updateExportStatus: (
    exportId: string,
    status: ExportStatus,
    fileSummary?: ExportRecord['fileSummary'],
    errorMessage?: string,
    failureTrace?: ExportRecord['failureTrace']
  ) => Promise<void>
  appendFailureTrace: (
    exportId: string,
    trace: Exclude<ExportRecord['failureTrace'], null | undefined>[number]
  ) => Promise<void>
  markExportInterrupted: (exportId: string) => Promise<void>
  importExportRecord: (data: unknown, sourceFileName: string) => Promise<ExportRecord>
  findDuplicateExport: (contentHash: string) => ExportRecord | null
  setExportError: (error: string | null) => void
  setShowExportHistory: (show: boolean) => void
  setCurrentExportId: (id: string | null) => void
  clearExportError: () => void
  getLastSuccessfulExport: () => ExportRecord | null
  loadPersistedData: () => void
  canTriggerExport: () => boolean
}

export const useExportStore = create<ExportState>()(
  persist(
    (set, get) => ({
      exportRecords: [],
      lastSuccessfulExport: null,
      currentExportId: null,
      exportError: null,
      showExportHistory: false,
      lastExportTriggeredAt: 0,
      pendingExports: new Set(),

      fetchExportRecords: async () => {
        try {
          const records = await db.exportRecords
            .orderBy('triggeredAt')
            .reverse()
            .limit(50)
            .toArray()
          const normalized = records.map(normalizeExportRecord)
          set({ exportRecords: normalized })
        } catch (err) {
          console.error('Failed to fetch export records:', err)
        }
      },

      canTriggerExport: () => {
        const state = get()
        const now = Date.now()
        return now - state.lastExportTriggeredAt >= MIN_EXPORT_INTERVAL
      },

      findDuplicateExport: (contentHash: string) => {
        const state = get()
        return state.exportRecords.find(r => r.contentHash === contentHash && r.status === 'success') || null
      },

      createExportRecord: async (
        filter,
        selectedTypes,
        exportedBy,
        options?
      ) => {
        const now = Date.now()

        if (!get().canTriggerExport()) {
          throw new Error('操作过于频繁，请稍候再试')
        }

        const exportId = `export-${now}-${Math.random().toString(36).slice(2, 7)}`

        const record: ExportRecord = {
          id: exportId,
          triggeredAt: now,
          filter,
          selectedTypes,
          fileSummary: null,
          status: 'pending',
          exportedBy,
          taskSnapshot: options?.taskSnapshot || null,
          logSnapshot: options?.logSnapshot || null,
          pageContext: options?.pageContext || null,
          keyFieldsSnapshot: options?.keyFieldsSnapshot || null,
          sortInfo: options?.sortInfo || null,
          failureTrace: null,
          appVersion: '1.0.0',
          triggerSource: options?.triggerSource || 'logs-toolbar',
          tasksBeforeExport: options?.tasksBeforeExport || null,
          tasksAfterExport: null,
          fieldDifferences: null,
          contentHash: undefined,
          isDuplicateContent: false,
          duplicateOfExportId: undefined,
        }

        try {
          await db.exportRecords.add(record)
          set((state) => ({
            exportRecords: [record, ...state.exportRecords].slice(0, 50),
            currentExportId: exportId,
            exportError: null,
            lastExportTriggeredAt: now,
            pendingExports: new Set([...state.pendingExports, exportId]),
          }))
          return exportId
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : '创建导出记录失败'
          set({ exportError: errorMsg })
          throw new Error(errorMsg)
        }
      },

      finalizeExport: async (exportId, options) => {
        try {
          const existing = await db.exportRecords.get(exportId)
          if (!existing) {
            throw new Error('导出记录不存在')
          }

          const now = Date.now()
          let contentHash: string | undefined
          let isDuplicateContent = false
          let duplicateOfExportId: string | undefined
          let fieldDifferences: ExportRecord['fieldDifferences'] = null

          if (options.exportedData && options.status === 'success') {
            contentHash = await computeContentHash(options.exportedData)
            const duplicate = get().findDuplicateExport(contentHash)
            if (duplicate && duplicate.id !== exportId) {
              isDuplicateContent = true
              duplicateOfExportId = duplicate.id
            }
          }

          if (options.tasksAfterExport && existing.tasksBeforeExport) {
            const diffs = diffTaskStates(existing.tasksBeforeExport, options.tasksAfterExport)
            fieldDifferences = diffs.map(d => ({
              field: d.field,
              before: d.before,
              after: d.after,
              changed: d.changed,
            }))
          }

          const updated: ExportRecord = {
            ...existing,
            status: options.status,
            fileSummary: options.fileSummary
              ? { ...options.fileSummary, contentHash }
              : existing.fileSummary,
            errorMessage: options.errorMessage || existing.errorMessage,
            failureTrace: options.failureTrace || existing.failureTrace,
            completedAt: options.status === 'success' || options.status === 'failed' || options.status === 'interrupted'
              ? now
              : existing.completedAt,
            contentHash,
            isDuplicateContent,
            duplicateOfExportId,
            tasksAfterExport: options.tasksAfterExport || existing.tasksAfterExport,
            fieldDifferences,
          }

          await db.exportRecords.put(updated)

          set((state) => {
            const newPending = new Set(state.pendingExports)
            newPending.delete(exportId)
            return {
              exportRecords: state.exportRecords.map((r) =>
                r.id === exportId ? updated : r
              ),
              lastSuccessfulExport:
                options.status === 'success' ? updated : state.lastSuccessfulExport,
              currentExportId: options.status === 'pending' ? exportId : null,
              exportError: options.status === 'failed' ? options.errorMessage || '导出失败' : null,
              pendingExports: newPending,
            }
          })

          if (options.status === 'success') {
            try {
              localStorage.setItem(
                LAST_SUCCESSFUL_EXPORT_KEY,
                JSON.stringify(updated)
              )
            } catch {
            }
          }
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : '更新导出状态失败'
          set({ exportError: errorMsg })
        }
      },

      updateExportStatus: async (exportId, status, fileSummary?, errorMessage?, failureTrace?) => {
        await get().finalizeExport(exportId, {
          status,
          fileSummary,
          errorMessage,
          failureTrace,
        })
      },

      appendFailureTrace: async (exportId, trace) => {
        try {
          const existing = await db.exportRecords.get(exportId)
          if (!existing) {
            return
          }

          const existingTrace = existing.failureTrace || []
          const updated: ExportRecord = {
            ...existing,
            failureTrace: [...existingTrace, trace],
          }

          await db.exportRecords.put(updated)

          set((state) => ({
            exportRecords: state.exportRecords.map((r) =>
              r.id === exportId ? updated : r
            ),
          }))
        } catch (err) {
          console.error('Failed to append failure trace:', err)
        }
      },

      markExportInterrupted: async (exportId) => {
        try {
          const existing = await db.exportRecords.get(exportId)
          if (!existing) return

          const interruptTrace = {
            timestamp: Date.now(),
            step: 'interrupted',
            message: '导出被中断，可能是页面刷新、关闭或网络断开导致',
            severity: 'warning' as const,
          }

          const updated: ExportRecord = {
            ...existing,
            status: 'interrupted',
            failureTrace: [...(existing.failureTrace || []), interruptTrace],
            errorMessage: existing.errorMessage || '导出被中途打断',
            completedAt: Date.now(),
          }

          await db.exportRecords.put(updated)

          set((state) => {
            const newPending = new Set(state.pendingExports)
            newPending.delete(exportId)
            return {
              exportRecords: state.exportRecords.map((r) =>
                r.id === exportId ? updated : r
              ),
              pendingExports: newPending,
              currentExportId: state.currentExportId === exportId ? null : state.currentExportId,
            }
          })
        } catch (err) {
          console.error('Failed to mark export interrupted:', err)
        }
      },

      importExportRecord: async (data, sourceFileName) => {
        const now = Date.now()
        const compatibilityNotes: string[] = []

        let rawRecord: Partial<ExportRecord>
        if (typeof data === 'object' && data !== null && 'id' in (data as object)) {
          rawRecord = data as Partial<ExportRecord>
        } else if (
          typeof data === 'object' && data !== null &&
          'exportedAt' in (data as object) && 'exportedBy' in (data as object)
        ) {
          const payload = data as Record<string, unknown>
          rawRecord = {
            id: `import-${now}-${Math.random().toString(36).slice(2, 7)}`,
            triggeredAt: typeof payload.exportedAt === 'number' ? payload.exportedAt : now,
            filter: {},
            selectedTypes: Object.keys(payload).filter(k =>
              ['templates', 'tasks', 'drafts', 'submissions', 'anomalies', 'eventLogs'].includes(k)
            ),
            fileSummary: {
              fileName: sourceFileName,
              fileSize: new Blob([JSON.stringify(payload)]).size,
              recordCount: Object.values(payload).filter(v => Array.isArray(v)).reduce((acc, arr) => acc + (arr as unknown[]).length, 0),
              dataTypes: Object.keys(payload).filter(k => Array.isArray(payload[k])),
            },
            status: 'success',
            exportedBy: typeof payload.exportedBy === 'string' ? payload.exportedBy : '未知用户',
            appVersion: typeof payload.appVersion === 'string' ? payload.appVersion : undefined,
          }
          compatibilityNotes.push('此记录从导出的数据文件中导入，仅包含基础信息')
        } else {
          throw new Error('无法识别的导入格式')
        }

        const importedId = rawRecord.id || `import-${now}-${Math.random().toString(36).slice(2, 7)}`
        const newId = `imported-${now}-${Math.random().toString(36).slice(2, 7)}`

        if (!rawRecord.triggeredAt) {
          compatibilityNotes.push('缺少触发时间，使用导入时间代替')
        }
        if (!rawRecord.pageContext) {
          compatibilityNotes.push('缺少页面上下文快照')
        }
        if (!rawRecord.keyFieldsSnapshot) {
          compatibilityNotes.push('缺少关键字段快照')
        }
        if (!rawRecord.sortInfo) {
          compatibilityNotes.push('缺少排序信息快照')
        }
        if (!rawRecord.failureTrace && rawRecord.status !== 'success') {
          compatibilityNotes.push('缺少失败追踪日志')
        }

        const normalized: ExportRecord = normalizeExportRecord({
          ...rawRecord,
          id: newId,
          triggeredAt: rawRecord.triggeredAt || now,
          importInfo: {
            importedAt: now,
            sourceFileName,
            originalAppVersion: rawRecord.appVersion,
            compatibilityNotes: compatibilityNotes.length > 0 ? compatibilityNotes : undefined,
          },
        } as ExportRecord)

        try {
          await db.exportRecords.add(normalized)
        } catch (err) {
          if (err instanceof Error && err.message.includes('Key already exists')) {
            normalized.id = `imported-${now}-${Math.random().toString(36).slice(2, 7)}-dup`
            await db.exportRecords.add(normalized)
          } else {
            throw err
          }
        }

        set((state) => ({
          exportRecords: [normalized, ...state.exportRecords].slice(0, 50),
        }))

        return normalized
      },

      setExportError: (error) => set({ exportError: error }),
      setShowExportHistory: (show) => set({ showExportHistory: show }),
      setCurrentExportId: (id) => set({ currentExportId: id }),
      clearExportError: () => set({ exportError: null }),

      getLastSuccessfulExport: () => {
        const state = get()
        if (state.lastSuccessfulExport) {
          return normalizeExportRecord(state.lastSuccessfulExport)
        }
        try {
          const persisted = localStorage.getItem(LAST_SUCCESSFUL_EXPORT_KEY)
          if (persisted) {
            const parsed = JSON.parse(persisted) as ExportRecord
            const normalized = normalizeExportRecord(parsed)
            set({ lastSuccessfulExport: normalized })
            return normalized
          }
        } catch {
        }
        return null
      },

      loadPersistedData: () => {
        try {
          const persisted = localStorage.getItem(LAST_SUCCESSFUL_EXPORT_KEY)
          if (persisted) {
            const parsed = JSON.parse(persisted) as ExportRecord
            const normalized = normalizeExportRecord(parsed)
            set({ lastSuccessfulExport: normalized })
          }

          get().pendingExports.forEach((exportId) => {
            get().markExportInterrupted(exportId)
          })
        } catch {
        }
      },
    }),
    {
      name: EXPORT_HISTORY_KEY,
      partialize: (state) => ({
        lastSuccessfulExport: state.lastSuccessfulExport,
        lastExportTriggeredAt: state.lastExportTriggeredAt,
        pendingExports: Array.from(state.pendingExports),
      }),
      onRehydrateStorage: () => (state) => {
        if (state && state.pendingExports) {
          const arr = state.pendingExports as unknown
          if (Array.isArray(arr)) {
            state.pendingExports = new Set(arr)
          } else if (!(state.pendingExports instanceof Set)) {
            state.pendingExports = new Set()
          }
        }
      },
    }
  )
)

export function normalizeExportRecord(record: ExportRecord): ExportRecord {
  return {
    ...record,
    pageContext: record.pageContext ?? null,
    keyFieldsSnapshot: record.keyFieldsSnapshot ?? null,
    sortInfo: record.sortInfo ?? null,
    failureTrace: record.failureTrace ?? null,
    appVersion: record.appVersion ?? '1.0.0',
    completedAt: record.completedAt ?? null,
    taskSnapshot: record.taskSnapshot ?? null,
    logSnapshot: record.logSnapshot ?? null,
    fileSummary: record.fileSummary ?? null,
    errorMessage: record.errorMessage ?? undefined,
    triggerSource: record.triggerSource ?? 'unknown',
    tasksBeforeExport: record.tasksBeforeExport ?? null,
    tasksAfterExport: record.tasksAfterExport ?? null,
    fieldDifferences: record.fieldDifferences ?? null,
    contentHash: record.contentHash ?? undefined,
    isDuplicateContent: record.isDuplicateContent ?? false,
    duplicateOfExportId: record.duplicateOfExportId ?? undefined,
    importInfo: record.importInfo ?? null,
    status: (record.status as ExportStatus) || 'pending',
  }
}

if (typeof window !== 'undefined') {
  ;(window as any).useExportStore = useExportStore
  ;(window as any).normalizeExportRecord = normalizeExportRecord
  ;(window as any).computeContentHash = computeContentHash
}
