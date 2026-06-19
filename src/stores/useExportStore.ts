import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { db } from '@/db'
import type { ExportRecord, ExportFilter, ExportStatus } from '@/types'

const EXPORT_HISTORY_KEY = 'inspection-export-history'
const LAST_SUCCESSFUL_EXPORT_KEY = 'inspection-last-successful-export'
const MIN_EXPORT_INTERVAL = 2000

interface ExportState {
  exportRecords: ExportRecord[]
  lastSuccessfulExport: ExportRecord | null
  currentExportId: string | null
  exportError: string | null
  showExportHistory: boolean
  lastExportTriggeredAt: number

  fetchExportRecords: () => Promise<void>
  createExportRecord: (
    filter: ExportFilter,
    selectedTypes: string[],
    exportedBy: string,
    taskSnapshot?: ExportRecord['taskSnapshot'],
    logSnapshot?: ExportRecord['logSnapshot'],
    pageContext?: ExportRecord['pageContext'],
    keyFieldsSnapshot?: ExportRecord['keyFieldsSnapshot'],
    sortInfo?: ExportRecord['sortInfo']
  ) => Promise<string>
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

      fetchExportRecords: async () => {
        try {
          const records = await db.exportRecords
            .orderBy('triggeredAt')
            .reverse()
            .limit(20)
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

      createExportRecord: async (
        filter: ExportFilter,
        selectedTypes: string[],
        exportedBy: string,
        taskSnapshot?,
        logSnapshot?,
        pageContext?,
        keyFieldsSnapshot?,
        sortInfo?
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
          taskSnapshot: taskSnapshot || null,
          logSnapshot: logSnapshot || null,
          pageContext: pageContext || null,
          keyFieldsSnapshot: keyFieldsSnapshot || null,
          sortInfo: sortInfo || null,
          failureTrace: null,
          appVersion: '1.0.0',
        }

        try {
          await db.exportRecords.add(record)
          set((state) => ({
            exportRecords: [record, ...state.exportRecords].slice(0, 20),
            currentExportId: exportId,
            exportError: null,
            lastExportTriggeredAt: now,
          }))
          return exportId
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : '创建导出记录失败'
          set({ exportError: errorMsg })
          throw new Error(errorMsg)
        }
      },

      updateExportStatus: async (exportId, status, fileSummary?, errorMessage?, failureTrace?) => {
        try {
          const existing = await db.exportRecords.get(exportId)
          if (!existing) {
            throw new Error('导出记录不存在')
          }

          const now = Date.now()
          const updated: ExportRecord = {
            ...existing,
            status,
            fileSummary: fileSummary || existing.fileSummary,
            errorMessage: errorMessage || existing.errorMessage,
            failureTrace: failureTrace || existing.failureTrace,
            completedAt: status === 'success' || status === 'failed' ? now : existing.completedAt,
          }

          await db.exportRecords.put(updated)

          set((state) => ({
            exportRecords: state.exportRecords.map((r) =>
              r.id === exportId ? updated : r
            ),
            lastSuccessfulExport:
              status === 'success' ? updated : state.lastSuccessfulExport,
            currentExportId: status === 'pending' ? exportId : null,
            exportError: status === 'failed' ? errorMessage || '导出失败' : null,
          }))

          if (status === 'success') {
            try {
              localStorage.setItem(
                LAST_SUCCESSFUL_EXPORT_KEY,
                JSON.stringify(updated)
              )
            } catch {
              // localStorage 写入失败不影响主流程
            }
          }
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : '更新导出状态失败'
          set({ exportError: errorMsg })
        }
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
          // ignore
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
        } catch {
          // ignore
        }
      },
    }),
    {
      name: EXPORT_HISTORY_KEY,
      partialize: (state) => ({
        lastSuccessfulExport: state.lastSuccessfulExport,
        lastExportTriggeredAt: state.lastExportTriggeredAt,
      }),
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
  }
}

if (typeof window !== 'undefined') {
  ;(window as any).useExportStore = useExportStore
  ;(window as any).normalizeExportRecord = normalizeExportRecord
}
