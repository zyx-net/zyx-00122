import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { FileJson, CheckCircle2, Download, FileText, ArrowLeft, AlertCircle, X } from 'lucide-react'
import Layout from '@/components/Layout'
import { db } from '@/db'
import { useAppStore } from '@/stores/useAppStore'
import { useExportStore } from '@/stores/useExportStore'
import type { ExportRecord } from '@/types'
import { cn } from '@/lib/utils'

interface LocationState {
  exportId?: string
  fromPage?: string
  filter?: Record<string, unknown>
  selectedTypes?: string[]
  returnTo?: string
}

export default function Export() {
  const navigate = useNavigate()
  const location = useLocation()
  const state = location.state as LocationState | null

  const addToast = useAppStore((s) => s.addToast)
  const role = useAppStore((s) => s.role)

  const {
    updateExportStatus,
    appendFailureTrace,
    setExportError,
    clearExportError,
    exportError,
    currentExportId,
  } = useExportStore()

  const [selected, setSelected] = useState<Record<string, boolean>>({
    templates: false,
    tasks: false,
    drafts: false,
    submissions: false,
    anomalies: false,
    eventLogs: true,
  })
  const [exporting, setExporting] = useState(false)
  const [lastExportTime, setLastExportTime] = useState<number | null>(null)
  const [exportCompleted, setExportCompleted] = useState(false)
  const [pageError, setPageError] = useState<string | null>(null)

  const activeExportId = useMemo(() => {
    return state?.exportId || currentExportId
  }, [state?.exportId, currentExportId])

  const fromLogsPage = state?.fromPage === 'logs'
  const returnTo = state?.returnTo || '/inspector/logs'

  useEffect(() => {
    if (state?.selectedTypes && state.selectedTypes.length > 0) {
      setSelected((prev) => {
        const newSelected = { ...prev }
        state.selectedTypes!.forEach((key) => {
          newSelected[key] = true
        })
        return newSelected
      })
    }
    clearExportError()
  }, [state?.selectedTypes, clearExportError])

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (exporting) {
        e.preventDefault()
        e.returnValue = ''
      }
    }

    const handlePopState = () => {
      if (exporting) {
        const msg = '导出正在进行中，离开页面将导致导出中断。确定要离开吗？'
        if (!window.confirm(msg)) {
          window.history.pushState(null, '', location.pathname)
        }
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    window.addEventListener('popstate', handlePopState)

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      window.removeEventListener('popstate', handlePopState)
    }
  }, [exporting, location.pathname])

  const exportOptions = [
    { key: 'templates', label: '模板数据', desc: '包含点位和检查项配置' },
    { key: 'tasks', label: '任务数据', desc: '包含任务状态和分配信息' },
    { key: 'drafts', label: '草稿数据', desc: '未提交的巡检填写内容' },
    { key: 'submissions', label: '提交记录', desc: '所有历史提交和审批记录' },
    { key: 'anomalies', label: '异常记录', desc: '所有上报的异常信息' },
    { key: 'eventLogs', label: '事件日志', desc: '所有操作的完整审计记录' },
  ]

  const handleBack = () => {
    if (exporting) {
      const confirm = window.confirm('导出正在进行中，离开将导致导出中断。确定要返回吗？')
      if (!confirm) return
    }
    navigate(-1)
  }

  const addTrace = async (step: string, message: string, severity: 'info' | 'warning' | 'error' = 'info') => {
    if (activeExportId) {
      await appendFailureTrace(activeExportId, {
        timestamp: Date.now(),
        step,
        message,
        severity,
      })
    }
  }

  const handleExport = async () => {
    const keys = Object.keys(selected).filter((k) => selected[k])
    if (keys.length === 0) {
      addToast('请至少选择一项数据类型', 'warning')
      return
    }

    if (!activeExportId && fromLogsPage) {
      const errorMsg = '导出记录不存在，无法继续导出。请返回日志页重新发起导出。'
      setPageError(errorMsg)
      setExportError(errorMsg)
      addToast(errorMsg, 'error')
      return
    }

    setExporting(true)
    setPageError(null)
    clearExportError()

    const failureTrace: Exclude<ExportRecord['failureTrace'], null | undefined> = []

    try {
      failureTrace.push({
        timestamp: Date.now(),
        step: 'init',
        message: `开始导出，选择了 ${keys.length} 种数据类型`,
        severity: 'info',
      })
      await addTrace('init', `开始导出，选择了 ${keys.length} 种数据类型`)

      const exportData: Record<string, unknown> = {
        exportedAt: Date.now(),
        exportedBy: role === 'admin' ? '管理员' : '巡检员',
        appVersion: '1.0.0',
      }

      let recordCount = 0

      for (const key of keys) {
        failureTrace.push({
          timestamp: Date.now(),
          step: `fetch_${key}`,
          message: `正在获取 ${key} 数据...`,
          severity: 'info',
        })
        await addTrace(`fetch_${key}`, `正在获取 ${key} 数据...`)

        let data: unknown[] = []
        if (key === 'templates') {
          data = await db.templates.toArray()
          exportData[key] = data
        } else if (key === 'tasks') {
          data = await db.tasks.toArray()
          exportData[key] = data
        } else if (key === 'drafts') {
          data = await db.drafts.toArray()
          exportData[key] = data
        } else if (key === 'submissions') {
          data = await db.submissions.toArray()
          exportData[key] = data
        } else if (key === 'anomalies') {
          data = await db.anomalies.toArray()
          exportData[key] = data
        } else if (key === 'eventLogs') {
          data = await db.eventLogs.toArray()
          exportData[key] = data
        }
        recordCount += data.length

        failureTrace.push({
          timestamp: Date.now(),
          step: `fetch_${key}`,
          message: `获取 ${key} 数据完成，共 ${data.length} 条`,
          severity: 'info',
        })
        await addTrace(`fetch_${key}`, `获取 ${key} 数据完成，共 ${data.length} 条`)
      }

      failureTrace.push({
        timestamp: Date.now(),
        step: 'serialize',
        message: '正在序列化 JSON 数据...',
        severity: 'info',
      })
      await addTrace('serialize', '正在序列化 JSON 数据...')

      const jsonStr = JSON.stringify(exportData, null, 2)
      const blob = new Blob([jsonStr], { type: 'application/json' })
      const fileSize = blob.size
      const url = URL.createObjectURL(blob)
      const fileName = `inspection-export-${new Date().toISOString().slice(0, 10)}-${Date.now()}.json`

      failureTrace.push({
        timestamp: Date.now(),
        step: 'download',
        message: `准备下载文件 ${fileName} (${fileSize} bytes)`,
        severity: 'info',
      })
      await addTrace('download', `准备下载文件 ${fileName} (${fileSize} bytes)`)

      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      if (activeExportId) {
        const fileSummary = {
          fileName,
          fileSize,
          recordCount,
          dataTypes: keys,
        }
        failureTrace.push({
          timestamp: Date.now(),
          step: 'complete',
          message: `导出成功，共 ${recordCount} 条记录`,
          severity: 'info',
        })
        await addTrace('complete', `导出成功，共 ${recordCount} 条记录`)
        await updateExportStatus(activeExportId, 'success', fileSummary, undefined, failureTrace)
      }

      setLastExportTime(Date.now())
      setExportCompleted(true)
      addToast('导出成功', 'success')
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : '导出过程中发生未知错误'

      failureTrace.push({
        timestamp: Date.now(),
        step: 'error',
        message: errorMsg,
        severity: 'error',
      })

      if (activeExportId) {
        await addTrace('error', errorMsg, 'error')
        await updateExportStatus(activeExportId, 'failed', undefined, errorMsg, failureTrace)
      }

      setPageError(errorMsg)
      setExportError(errorMsg)
      addToast(`导出失败：${errorMsg}`, 'error')
    } finally {
      setExporting(false)
    }
  }

  const handleReturnToLogs = () => {
    if (exporting) {
      const confirm = window.confirm('导出正在进行中，离开将导致导出中断。确定要返回吗？')
      if (!confirm) return
    }
    navigate(returnTo, { replace: true })
  }

  const toggleAll = () => {
    const allSelected = Object.values(selected).every(Boolean)
    const next = Object.fromEntries(Object.keys(selected).map((k) => [k, !allSelected]))
    setSelected(next)
  }

  return (
    <Layout
      title="数据导出"
      onBack={handleBack}
      showNav
      navRole={role || 'admin'}
    >
      <div className="p-4 space-y-4">
        {exportError && !pageError && (
          <div className="rounded-xl bg-red-50 border border-red-200 p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-red-800">导出出错</p>
                  <p className="text-xs text-red-600 mt-0.5">{exportError}</p>
                </div>
              </div>
              <button
                onClick={() => {
                  clearExportError()
                }}
                className="text-red-400 hover:text-red-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {fromLogsPage && (
              <button
                onClick={handleReturnToLogs}
                className="mt-3 flex items-center gap-1 text-xs text-red-700 bg-red-100 px-3 py-1.5 rounded hover:bg-red-200"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                返回日志页重新发起
              </button>
            )}
          </div>
        )}

        {pageError && (
          <div className="rounded-xl bg-red-50 border border-red-200 p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-red-800">导出出错</p>
                  <p className="text-xs text-red-600 mt-0.5">{pageError}</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setPageError(null)
                  clearExportError()
                }}
                className="text-red-400 hover:text-red-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {fromLogsPage && (
              <button
                onClick={handleReturnToLogs}
                className="mt-3 flex items-center gap-1 text-xs text-red-700 bg-red-100 px-3 py-1.5 rounded hover:bg-red-200"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                返回日志页重新发起
              </button>
            )}
          </div>
        )}

        {fromLogsPage && activeExportId && (
          <div className="rounded-xl bg-blue-50 border border-blue-200 p-4">
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-blue-500" />
              <div className="flex-1">
                <p className="text-sm font-medium text-blue-800">
                  从日志页发起的导出
                </p>
                <p className="text-xs text-blue-600">
                  完成后将自动记录导出历史，可返回日志页查看和复核
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="rounded-xl bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <FileJson className="h-5 w-5 text-primary" />
            <h3 className="text-base font-semibold text-gray-900">选择导出内容</h3>
          </div>
          <p className="text-xs text-gray-500 mb-4">
            导出的 JSON 文件可用于备份或数据分析，包含所选范围内的全部数据
          </p>

          <div className="space-y-2">
            <button
              onClick={toggleAll}
              className="mb-2 flex items-center gap-2 text-sm text-primary"
            >
              {Object.values(selected).every(Boolean) ? (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  取消全选
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4 opacity-50" />
                  全选
                </>
              )}
            </button>

            {exportOptions.map((opt) => (
              <button
                key={opt.key}
                onClick={() => setSelected((s) => ({ ...s, [opt.key]: !s[opt.key] }))}
                className="flex w-full items-center gap-3 rounded-lg border border-gray-200 p-3 text-left transition-colors hover:bg-gray-50"
              >
                <div
                  className={cn(
                    'flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border-2',
                    selected[opt.key]
                      ? 'border-primary bg-primary text-white'
                      : 'border-gray-300 bg-white'
                  )}
                >
                  {selected[opt.key] && <CheckCircle2 className="h-3.5 w-3.5" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900">{opt.label}</p>
                  <p className="text-xs text-gray-500">{opt.desc}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {lastExportTime && (
          <div className="rounded-xl bg-green-50 border border-green-200 p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-green-600" />
                <div>
                  <p className="text-sm font-medium text-green-800">上次导出</p>
                  <p className="text-xs text-green-600">
                    {new Date(lastExportTime).toLocaleString('zh-CN')}
                  </p>
                </div>
              </div>
              {fromLogsPage && exportCompleted && (
                <button
                  onClick={handleReturnToLogs}
                  className="flex items-center gap-1 text-xs text-green-700 bg-green-100 px-3 py-1.5 rounded hover:bg-green-200"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  返回日志页查看记录
                </button>
              )}
            </div>
          </div>
        )}

        <div className="sticky bottom-0 pt-4 space-y-2">
          {fromLogsPage && (
            <button
              onClick={handleReturnToLogs}
              disabled={exporting}
              className={cn(
                'flex w-full items-center justify-center gap-2 rounded-lg h-10 text-sm font-medium transition-colors',
                exporting
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              )}
            >
              <ArrowLeft className="h-4 w-4" />
              返回日志页
            </button>
          )}
          <button
            onClick={handleExport}
            disabled={exporting || !Object.values(selected).some(Boolean)}
            className={cn(
              'flex w-full items-center justify-center gap-2 rounded-lg h-12 text-sm font-semibold transition-colors',
              exporting || !Object.values(selected).some(Boolean)
                ? 'bg-amber-200 text-amber-100 cursor-not-allowed'
                : 'bg-accent text-white hover:bg-amber-600 active:bg-amber-700'
            )}
          >
            <Download className="h-5 w-5" />
            {exporting ? '导出中...' : '导出 JSON 文件'}
          </button>
        </div>
      </div>
    </Layout>
  )
}
