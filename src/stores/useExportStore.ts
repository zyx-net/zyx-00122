import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { db } from '@/db'
import type { ExportRecord, ExportFilter, ExportStatus } from '@/types'

const EXPORT_HISTORY_KEY = 'inspection-export-history'
const LAST_SUCCESSFUL_EXPORT_KEY = 'inspection-last-successful-export'

interface ExportState {
  exportRecords: ExportRecord[]
  lastSuccessfulExport: ExportRecord | null
  currentExportId: string | null
  exportError: string | null
  showExportHistory: boolean

  fetchExportRecords: () => Promise<void>
  createExportRecord: (
    filter: ExportFilter,
    selectedTypes: string[],
    exportedBy: string,
    taskSnapshot?: ExportRecord['taskSnapshot'],
    logSnapshot?: ExportRecord['logSnapshot']
  ) => Promise<string>
  updateExportStatus: (
    exportId: string,
    status: ExportStatus,
    fileSummary?: ExportRecord['fileSummary'],
    errorMessage?: string
  ) => Promise<void>
  setExportError: (error: string | null) => void
  setShowExportHistory: (show: boolean) => void
  setCurrentExportId: (id: string | null) => void
  clearExportError: () => void
  getLastSuccessfulExport: () => ExportRecord | null
  loadPersistedData: () => void
}

export const useExportStore = create<ExportState>()(
  persist(
    (set, get) => ({
      exportRecords: [],
      lastSuccessfulExport: null,
      currentExportId: null,
      exportError: null,
      showExportHistory: false,

      fetchExportRecords: async () => {
        try {
          const records = await db.exportRecords
            .orderBy('triggeredAt')
            .reverse()
            .limit(20)
            .toArray()
          set({ exportRecords: records })
        } catch (err) {
          console.error('Failed to fetch export records:', err)
        }
      },

      createExportRecord: async (
        filter: ExportFilter,
        selectedTypes: string[],
        exportedBy: string,
        taskSnapshot?,
        logSnapshot?
      ) => {
        const now = Date.now()
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
        }

        try {
          await db.exportRecords.add(record)
          set((state) => ({
            exportRecords: [record, ...state.exportRecords].slice(0, 20),
            currentExportId: exportId,
            exportError: null,
          }))
          return exportId
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : '创建导出记录失败'
          set({ exportError: errorMsg })
          throw new Error(errorMsg)
        }
      },

      updateExportStatus: async (exportId, status, fileSummary?, errorMessage?) => {
        try {
          const existing = await db.exportRecords.get(exportId)
          if (!existing) {
            throw new Error('导出记录不存在')
          }

          const updated: ExportRecord = {
            ...existing,
            status,
            fileSummary: fileSummary || existing.fileSummary,
            errorMessage,
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

      setExportError: (error) => set({ exportError: error }),
      setShowExportHistory: (show) => set({ showExportHistory: show }),
      setCurrentExportId: (id) => set({ currentExportId: id }),
      clearExportError: () => set({ exportError: null }),

      getLastSuccessfulExport: () => {
        const state = get()
        if (state.lastSuccessfulExport) {
          return state.lastSuccessfulExport
        }
        try {
          const persisted = localStorage.getItem(LAST_SUCCESSFUL_EXPORT_KEY)
          if (persisted) {
            const parsed = JSON.parse(persisted) as ExportRecord
            set({ lastSuccessfulExport: parsed })
            return parsed
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
            set({ lastSuccessfulExport: parsed })
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
      }),
    }
  )
)

if (typeof window !== 'undefined') {
  ;(window as any).useExportStore = useExportStore
}
