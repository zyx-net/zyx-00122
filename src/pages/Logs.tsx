import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Filter, FileJson, History, X, CheckCircle, AlertCircle, Clock, FileText, Eye, ChevronDown, ChevronUp } from 'lucide-react'
import Layout from '@/components/Layout'
import EmptyState from '@/components/EmptyState'
import { useTaskStore } from '@/stores/useTaskStore'
import { useAppStore } from '@/stores/useAppStore'
import { useExportStore, normalizeExportRecord } from '@/stores/useExportStore'
import type { EventAction, ExportRecord } from '@/types'
import { cn } from '@/lib/utils'

function formatTime(ts: number) {
  return new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const actionConfig: Record<EventAction, { label: string; color: string; bg: string }> = {
  claim: { label: '领取任务', color: 'text-blue-700', bg: 'bg-blue-100' },
  save_draft: { label: '保存草稿', color: 'text-gray-700', bg: 'bg-gray-100' },
  draft_save: { label: '自动保存', color: 'text-indigo-700', bg: 'bg-indigo-100' },
  draft_load: { label: '恢复草稿', color: 'text-cyan-700', bg: 'bg-cyan-100' },
  submit: { label: '提交', color: 'text-accent', bg: 'bg-amber-100' },
  rework: { label: '退回返工', color: 'text-red-700', bg: 'bg-red-100' },
  approve: { label: '审核通过', color: 'text-green-700', bg: 'bg-green-100' },
  anomaly: { label: '异常上报', color: 'text-orange-700', bg: 'bg-orange-100' },
  reject: { label: '提交被拒', color: 'text-red-700', bg: 'bg-red-50' },
}

const actionOptions: { value: EventAction | 'all'; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'claim', label: '领取' },
  { value: 'save_draft', label: '草稿' },
  { value: 'draft_save', label: '自动保存' },
  { value: 'draft_load', label: '恢复草稿' },
  { value: 'submit', label: '提交' },
  { value: 'rework', label: '退回' },
  { value: 'approve', label: '通过' },
  { value: 'anomaly', label: '异常' },
  { value: 'reject', label: '拒绝' },
]

const statusConfig: Record<string, { label: string; color: string; icon: typeof CheckCircle }> = {
  pending: { label: '导出中', color: 'text-blue-600', icon: Clock },
  success: { label: '成功', color: 'text-green-600', icon: CheckCircle },
  failed: { label: '失败', color: 'text-red-600', icon: AlertCircle },
}

const dataTypeLabels: Record<string, string> = {
  templates: '模板数据',
  tasks: '任务数据',
  drafts: '草稿数据',
  submissions: '提交记录',
  anomalies: '异常记录',
  eventLogs: '事件日志',
}

function ExportRecordCard({ record, onView }: { record: ExportRecord; onView: (r: ExportRecord) => void }) {
  const status = statusConfig[record.status] || statusConfig.pending
  const StatusIcon = status.icon

  const getFilterDesc = () => {
    const parts: string[] = []
    if (record.filter.action) {
      parts.push(`操作类型: ${actionConfig[record.filter.action]?.label || record.filter.action}`)
    }
    if (record.filter.taskId) {
      parts.push(`任务ID: ${record.filter.taskId.slice(0, 12)}...`)
    }
    return parts.length > 0 ? parts.join('，') : '无筛选'
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 mb-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <StatusIcon className={cn('h-4 w-4 flex-shrink-0', status.color)} />
            <span className={cn('text-xs font-medium', status.color)}>{status.label}</span>
            <span className="text-xs text-gray-400 font-mono">
              {formatTime(record.triggeredAt)}
            </span>
          </div>
          <p className="text-xs text-gray-600 mb-1">
            <span className="text-gray-500">导出人：</span>{record.exportedBy}
          </p>
          <p className="text-xs text-gray-600 mb-1">
            <span className="text-gray-500">筛选条件：</span>{getFilterDesc()}
          </p>
          <p className="text-xs text-gray-600 mb-1">
            <span className="text-gray-500">数据类型：</span>
            {record.selectedTypes.map((t) => dataTypeLabels[t] || t).join('、')}
          </p>
          {record.fileSummary && (
            <div className="mt-2 rounded bg-gray-50 p-2">
              <div className="flex items-center gap-1 text-xs text-gray-600">
                <FileText className="h-3.5 w-3.5 text-gray-400" />
                <span className="font-medium">{record.fileSummary.fileName}</span>
              </div>
              <div className="mt-1 flex gap-4 text-[11px] text-gray-500">
                <span>大小：{formatFileSize(record.fileSummary.fileSize)}</span>
                <span>记录数：{record.fileSummary.recordCount}</span>
              </div>
            </div>
          )}
          {record.status === 'failed' && record.errorMessage && (
            <p className="mt-2 text-xs text-red-600 bg-red-50 rounded px-2 py-1">
              错误：{record.errorMessage}
            </p>
          )}
        </div>
        {(record.status === 'success' || record.logSnapshot || record.failureTrace || record.pageContext || record.keyFieldsSnapshot) && (
          <button
            onClick={() => onView(record)}
            className="flex-shrink-0 flex items-center gap-1 text-xs text-primary hover:text-primary/80"
          >
            <Eye className="h-3.5 w-3.5" />
            复核
          </button>
        )}
      </div>
    </div>
  )
}

function ReviewModal({ record, onClose }: { record: ExportRecord; onClose: () => void }) {
  const [expanded, setExpanded] = useState(true)
  const [failureExpanded, setFailureExpanded] = useState(true)
  const hasFailureTrace = record.failureTrace && record.failureTrace.length > 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg max-h-[85vh] overflow-y-auto bg-white rounded-xl shadow-xl">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">导出记录复核</h3>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-gray-100 text-gray-500"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-4 space-y-4">
          <div className="rounded-lg bg-gray-50 p-3">
            <p className="text-sm font-medium text-gray-900 mb-2">导出基本信息</p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-gray-500">导出时间：</span>
                <span className="text-gray-900">{formatTime(record.triggeredAt)}</span>
              </div>
              <div>
                <span className="text-gray-500">导出人：</span>
                <span className="text-gray-900">{record.exportedBy}</span>
              </div>
              <div>
                <span className="text-gray-500">状态：</span>
                <span className={cn(
                  'font-medium',
                  record.status === 'success' ? 'text-green-600' :
                  record.status === 'failed' ? 'text-red-600' : 'text-blue-600'
                )}>
                  {statusConfig[record.status]?.label || record.status}
                </span>
              </div>
              {record.fileSummary && (
                <div>
                  <span className="text-gray-500">文件大小：</span>
                  <span className="text-gray-900">{formatFileSize(record.fileSummary.fileSize)}</span>
                </div>
              )}
              {record.appVersion && (
                <div>
                  <span className="text-gray-500">应用版本：</span>
                  <span className="text-gray-900 font-mono">{record.appVersion}</span>
                </div>
              )}
              {record.completedAt && (
                <div>
                  <span className="text-gray-500">完成时间：</span>
                  <span className="text-gray-900">{formatTime(record.completedAt)}</span>
                </div>
              )}
            </div>
          </div>

          {record.pageContext && (
            <div className="rounded-lg bg-purple-50 border border-purple-100 p-3">
              <p className="text-sm font-medium text-purple-900 mb-2">页面上下文快照</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-purple-500">路由：</span>
                  <span className="text-purple-900 font-mono">{record.pageContext.route}</span>
                </div>
                <div>
                  <span className="text-purple-500">视图模式：</span>
                  <span className="text-purple-900">{record.pageContext.viewMode === 'all' ? '全部日志' : '单任务'}</span>
                </div>
                <div>
                  <span className="text-purple-500">屏幕尺寸：</span>
                  <span className="text-purple-900 font-mono">{record.pageContext.screenSize.width}×{record.pageContext.screenSize.height}</span>
                </div>
                {record.pageContext.currentTaskId && (
                  <div>
                    <span className="text-purple-500">任务ID：</span>
                    <span className="text-purple-900 font-mono">{record.pageContext.currentTaskId.slice(-8)}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {record.keyFieldsSnapshot && (
            <div className="rounded-lg bg-indigo-50 border border-indigo-100 p-3">
              <p className="text-sm font-medium text-indigo-900 mb-2">关键字段快照</p>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <span className="text-indigo-500">总任务数：</span>
                  <span className="text-indigo-900 font-medium">{record.keyFieldsSnapshot.totalTaskCount}</span>
                </div>
                <div>
                  <span className="text-indigo-500">进行中：</span>
                  <span className="text-indigo-900 font-medium">{record.keyFieldsSnapshot.inProgressCount}</span>
                </div>
                <div>
                  <span className="text-indigo-500">已完成：</span>
                  <span className="text-indigo-900 font-medium">{record.keyFieldsSnapshot.completedCount}</span>
                </div>
                <div>
                  <span className="text-indigo-500">日志总数：</span>
                  <span className="text-indigo-900 font-medium">{record.keyFieldsSnapshot.logCount}</span>
                </div>
                <div>
                  <span className="text-indigo-500">草稿数：</span>
                  <span className="text-indigo-900 font-medium">{record.keyFieldsSnapshot.draftCount}</span>
                </div>
                <div>
                  <span className="text-indigo-500">异常数：</span>
                  <span className="text-indigo-900 font-medium">{record.keyFieldsSnapshot.anomalyCount}</span>
                </div>
              </div>
            </div>
          )}

          {record.sortInfo && (
            <div className="rounded-lg bg-cyan-50 border border-cyan-100 p-3">
              <p className="text-sm font-medium text-cyan-900 mb-2">排序与范围快照</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-cyan-500">排序字段：</span>
                  <span className="text-cyan-900">
                    {record.sortInfo.sortBy === 'timestamp' ? '时间' :
                     record.sortInfo.sortBy === 'action' ? '操作类型' : '任务ID'}
                  </span>
                </div>
                <div>
                  <span className="text-cyan-500">排序方向：</span>
                  <span className="text-cyan-900">{record.sortInfo.sortOrder === 'desc' ? '倒序' : '正序'}</span>
                </div>
                <div>
                  <span className="text-cyan-500">可见范围：</span>
                  <span className="text-cyan-900 font-mono">
                    {record.sortInfo.visibleRange.start + 1}-{record.sortInfo.visibleRange.end}
                    /{record.sortInfo.visibleRange.total}
                  </span>
                </div>
              </div>
            </div>
          )}

          {record.taskSnapshot && (
            <div className="rounded-lg bg-blue-50 border border-blue-100 p-3">
              <p className="text-sm font-medium text-blue-900 mb-2">任务状态快照</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-blue-500">任务标题：</span>
                  <span className="text-blue-900">{record.taskSnapshot.title}</span>
                </div>
                <div>
                  <span className="text-blue-500">当前状态：</span>
                  <span className="text-blue-900 font-medium">{record.taskSnapshot.status}</span>
                </div>
                <div>
                  <span className="text-blue-500">指派人：</span>
                  <span className="text-blue-900">{record.taskSnapshot.assignee || '未分配'}</span>
                </div>
                <div>
                  <span className="text-blue-500">任务ID：</span>
                  <span className="text-blue-900 font-mono">{record.taskSnapshot.taskId.slice(-8)}</span>
                </div>
              </div>
            </div>
          )}

          {hasFailureTrace && (
            <div>
              <button
                onClick={() => setFailureExpanded(!failureExpanded)}
                className="w-full flex items-center justify-between rounded-lg bg-red-100 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-200"
              >
                <span>失败追踪日志（{record.failureTrace!.length} 条）</span>
                {failureExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
              {failureExpanded && (
                <div className="mt-2 rounded-lg border border-red-200 max-h-48 overflow-y-auto">
                  {record.failureTrace!.map((trace, idx) => (
                    <div
                      key={idx}
                      data-testid="failure-trace-item"
                      className={cn(
                        'flex items-start gap-2 px-3 py-2 border-b border-gray-100 last:border-0',
                        trace.severity === 'error' ? 'bg-red-50' :
                        trace.severity === 'warning' ? 'bg-amber-50' : 'bg-white'
                      )}
                    >
                      <span className="flex-shrink-0 text-[10px] font-mono text-gray-400 w-6">
                        {idx + 1}.
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={cn(
                            'text-[10px] font-medium px-1.5 py-0.5 rounded',
                            trace.severity === 'error' ? 'bg-red-100 text-red-700' :
                            trace.severity === 'warning' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-700'
                          )}>
                            {trace.step}
                          </span>
                          <span className="text-[10px] text-gray-400 font-mono">
                            {formatTime(trace.timestamp)}
                          </span>
                        </div>
                        <p className="text-xs text-gray-600 mt-0.5">{trace.message}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {record.logSnapshot && record.logSnapshot.length > 0 && (
            <div>
              <button
                onClick={() => setExpanded(!expanded)}
                className="w-full flex items-center justify-between rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
              >
                <span>日志顺序快照（{record.logSnapshot.length} 条）</span>
                {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
              {expanded && (
                <div className="mt-2 rounded-lg border border-gray-200 max-h-60 overflow-y-auto">
                  {record.logSnapshot.map((log, idx) => {
                    const cfg = actionConfig[log.action] || actionConfig.save_draft
                    return (
                      <div
                        key={idx}
                        data-testid="log-snapshot-item"
                        className="flex items-start gap-2 px-3 py-2 border-b border-gray-100 last:border-0"
                      >
                        <span className="flex-shrink-0 text-[10px] font-mono text-gray-400 w-6">
                          {idx + 1}.
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={cn('text-xs font-medium', cfg.color)}>
                              {cfg.label}
                            </span>
                            <span className="text-[10px] text-gray-400 font-mono">
                              {formatTime(log.timestamp)}
                            </span>
                          </div>
                          <p className="text-xs text-gray-600 truncate">{log.detail}</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {record.status === 'failed' && record.errorMessage && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-3">
              <p className="text-sm font-medium text-red-900 mb-1">错误信息</p>
              <p className="text-xs text-red-700">{record.errorMessage}</p>
            </div>
          )}

          {record.fileSummary && (
            <div className="rounded-lg bg-green-50 border border-green-100 p-3">
              <p className="text-sm font-medium text-green-900 mb-2">文件摘要</p>
              <div className="space-y-1 text-xs">
                <p>
                  <span className="text-green-600">文件名：</span>
                  <span className="text-green-900 font-mono">{record.fileSummary.fileName}</span>
                </p>
                <p>
                  <span className="text-green-600">文件大小：</span>
                  <span className="text-green-900">{formatFileSize(record.fileSummary.fileSize)}</span>
                </p>
                <p>
                  <span className="text-green-600">总记录数：</span>
                  <span className="text-green-900">{record.fileSummary.recordCount} 条</span>
                </p>
                <p>
                  <span className="text-green-600">包含数据：</span>
                  <span className="text-green-900">
                    {record.fileSummary.dataTypes.map((t) => dataTypeLabels[t] || t).join('、')}
                  </span>
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function Logs() {
  const navigate = useNavigate()
  const { taskId: paramTaskId } = useParams()
  const { eventLogs, fetchEventLogs, fetchTasks, tasks } = useTaskStore()
  const role = useAppStore((s) => s.role)
  const addToast = useAppStore((s) => s.addToast)

  const {
    exportRecords,
    exportError,
    showExportHistory,
    fetchExportRecords,
    createExportRecord,
    setExportError,
    setShowExportHistory,
    clearExportError,
    getLastSuccessfulExport,
    loadPersistedData,
    canTriggerExport,
  } = useExportStore()

  const [filter, setFilter] = useState<EventAction | 'all'>('all')
  const [showFilters, setShowFilters] = useState(false)
  const [exportButtonDisabled, setExportButtonDisabled] = useState(false)
  const [reviewRecord, setReviewRecord] = useState<ExportRecord | null>(null)
  const [isExporting, setIsExporting] = useState(false)

  useEffect(() => {
    fetchTasks()
    if (paramTaskId) {
      fetchEventLogs({ taskId: paramTaskId })
    } else {
      fetchEventLogs()
    }
    fetchExportRecords()
    loadPersistedData()

    const checkButtonState = () => {
      try {
        const el = document.querySelector('[data-export-button]')
        setExportButtonDisabled(!el || el.getAttribute('aria-disabled') === 'true' || (el as HTMLButtonElement).disabled)
      } catch {
        setExportButtonDisabled(false)
      }
    }
    checkButtonState()
    const interval = setInterval(checkButtonState, 800)
    return () => clearInterval(interval)
  }, [paramTaskId, fetchTasks, fetchEventLogs, fetchExportRecords, loadPersistedData])

  const filteredLogs = useMemo(() => {
    if (filter === 'all') return eventLogs
    return eventLogs.filter((l) => l.action === filter)
  }, [eventLogs, filter])

  const getTaskTitle = (taskId: string) => {
    return tasks.find((t) => t.id === taskId)?.title || '未知任务'
  }

  const getCurrentTaskSnapshot = () => {
    if (!paramTaskId) return null
    const task = tasks.find((t) => t.id === paramTaskId)
    if (!task) return null
    return {
      taskId: task.id,
      status: task.status,
      title: task.title,
      assignee: task.assignee,
    }
  }

  const getCurrentLogSnapshot = () => {
    const targetLogs = paramTaskId
      ? eventLogs.filter((l) => l.taskId === paramTaskId)
      : filteredLogs
    return targetLogs
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(0, 50)
      .map((l) => ({
        action: l.action,
        detail: l.detail,
        timestamp: l.timestamp,
      }))
  }

  const getPageContext = (): ExportRecord['pageContext'] => {
    return {
      route: window.location.pathname,
      viewMode: paramTaskId ? 'single-task' : 'all',
      currentTaskId: paramTaskId || undefined,
      timestamp: Date.now(),
      userAgent: navigator.userAgent,
      screenSize: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
    }
  }

  const getKeyFieldsSnapshot = (): ExportRecord['keyFieldsSnapshot'] => {
    return {
      totalTaskCount: tasks.length,
      inProgressCount: tasks.filter((t) => t.status === 'in_progress').length,
      completedCount: tasks.filter((t) => t.status === 'approved' || t.status === 'submitted').length,
      logCount: eventLogs.length,
      anomalyCount: 0,
      draftCount: 0,
    }
  }

  const getSortInfo = (): ExportRecord['sortInfo'] => {
    const sortedLogs = [...filteredLogs].sort((a, b) => b.timestamp - a.timestamp)
    return {
      sortBy: 'timestamp',
      sortOrder: 'desc',
      visibleRange: {
        start: 0,
        end: Math.min(sortedLogs.length, 50),
        total: sortedLogs.length,
      },
    }
  }

  const handleExportClick = async () => {
    if (isExporting) {
      addToast('正在导出中，请稍候...', 'warning')
      return
    }

    if (!canTriggerExport()) {
      addToast('操作过于频繁，请稍候再试', 'warning')
      return
    }

    try {
      const exportButton = document.querySelector('[data-export-button]')
      if (!exportButton) {
        setExportError('导出入口不存在，请刷新页面后重试')
        addToast('导出入口不存在', 'error')
        return
      }

      if (exportButton.getAttribute('aria-disabled') === 'true' ||
          (exportButton as HTMLButtonElement).disabled) {
        setExportError('导出按钮当前不可用，请检查是否有权限或数据是否加载完成')
        addToast('导出按钮当前不可用', 'error')
        return
      }

      setIsExporting(true)
      clearExportError()

      const exportFilter = {
        action: filter !== 'all' ? filter : undefined,
        taskId: paramTaskId || undefined,
      }

      const selectedTypes = ['templates', 'tasks', 'drafts', 'submissions', 'anomalies', 'eventLogs']

      const taskSnapshot = getCurrentTaskSnapshot()
      const logSnapshot = getCurrentLogSnapshot()
      const pageContext = getPageContext()
      const keyFieldsSnapshot = getKeyFieldsSnapshot()
      const sortInfo = getSortInfo()

      const exportId = await createExportRecord(
        exportFilter,
        selectedTypes,
        role === 'admin' ? '管理员' : '巡检员',
        taskSnapshot,
        logSnapshot,
        pageContext,
        keyFieldsSnapshot,
        sortInfo
      )

      if (!exportId) {
        throw new Error('创建导出记录失败')
      }

      navigate('/export', {
        state: {
          exportId,
          fromPage: 'logs',
          filter: exportFilter,
          selectedTypes,
          returnTo: paramTaskId ? `/inspector/logs/${paramTaskId}` : '/inspector/logs',
        },
      })
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : '导出初始化失败'
      setExportError(errorMsg)
      addToast(`导出失败：${errorMsg}`, 'error')
      setIsExporting(false)
    }
  }

  const handleViewReview = (record: ExportRecord) => {
    setReviewRecord(normalizeExportRecord(record))
  }

  const persistedLastExport = getLastSuccessfulExport()
  const normalizedLastExport = persistedLastExport ? normalizeExportRecord(persistedLastExport) : null

  return (
    <Layout
      title={paramTaskId ? '任务日志' : '事件日志'}
      onBack={paramTaskId ? () => navigate(-1) : undefined}
      showNav={!paramTaskId}
      navRole={role || 'inspector'}
      rightAction={
        !paramTaskId ? (
          <div className="flex items-center gap-1">
            <button
              data-export-button
              onClick={handleExportClick}
              disabled={isExporting}
              className={cn(
                'flex h-9 w-9 items-center justify-center rounded-lg transition-colors',
                isExporting
                  ? 'bg-white/20 cursor-not-allowed'
                  : 'hover:bg-white/10 active:bg-white/20'
              )}
              title={isExporting ? '正在导出...' : '导出数据'}
            >
              <FileJson className={cn('h-5 w-5', isExporting ? 'animate-pulse' : '')} />
            </button>
            <button
              onClick={() => setShowExportHistory(!showExportHistory)}
              className={cn(
                'flex h-9 w-9 items-center justify-center rounded-lg transition-colors',
                showExportHistory ? 'bg-white/20' : 'hover:bg-white/10'
              )}
              title="导出历史"
            >
              <History className="h-5 w-5" />
            </button>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={cn(
                'flex h-9 w-9 items-center justify-center rounded-lg transition-colors',
                showFilters ? 'bg-white/20' : 'hover:bg-white/10'
              )}
            >
              <Filter className="h-5 w-5" />
            </button>
          </div>
        ) : null
      }
    >
      {exportError && (
        <div className="sticky top-0 z-30 bg-red-50 border-b border-red-200 px-4 py-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-800">导出失败</p>
                <p className="text-xs text-red-600 mt-0.5">{exportError}</p>
              </div>
            </div>
            <button
              onClick={clearExportError}
              className="text-red-400 hover:text-red-600"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {exportButtonDisabled && !exportError && (
        <div className="sticky top-0 z-30 bg-amber-50 border-b border-amber-200 px-4 py-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-amber-500 flex-shrink-0" />
            <p className="text-sm text-amber-800">导出按钮当前不可用，请刷新页面或检查权限</p>
          </div>
        </div>
      )}

      {normalizedLastExport && (
        <div className="sticky top-0 z-20 bg-green-50 border-b border-green-200 px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-green-800 truncate">
                  最近成功导出：{normalizedLastExport.fileSummary?.fileName || '已完成'}
                </p>
                <p className="text-xs text-green-600">
                  {formatTime(normalizedLastExport.triggeredAt)} · {normalizedLastExport.fileSummary ? formatFileSize(normalizedLastExport.fileSummary.fileSize) : ''}
                </p>
              </div>
            </div>
            <button
              onClick={() => handleViewReview(normalizedLastExport)}
              className="flex-shrink-0 flex items-center gap-1 text-xs text-green-700 bg-green-100 px-2 py-1 rounded hover:bg-green-200"
            >
              <Eye className="h-3.5 w-3.5" />
              复核
            </button>
          </div>
        </div>
      )}

      {showFilters && (
        <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-4 py-3">
          <p className="mb-2 text-xs font-medium text-gray-500">按操作类型筛选</p>
          <div className="flex flex-wrap gap-2">
            {actionOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setFilter(opt.value)}
                className={cn(
                  'rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                  filter === opt.value
                    ? 'bg-primary text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {showExportHistory && (
        <div className="bg-gray-50 border-b border-gray-200 px-4 py-3">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-900">导出历史记录</h3>
            <button
              onClick={() => setShowExportHistory(false)}
              className="text-xs text-gray-500 hover:text-gray-700"
            >
              收起
            </button>
          </div>
          {exportRecords.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-gray-500">暂无导出记录</p>
            </div>
          ) : (
            <div className="max-h-80 overflow-y-auto">
              {exportRecords.map((record) => (
                <ExportRecordCard
                  key={record.id}
                  record={normalizeExportRecord(record)}
                  onView={handleViewReview}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <div className="p-4 space-y-0">
        {filteredLogs.length === 0 ? (
          <EmptyState message="暂无日志记录" />
        ) : (
          <div className="relative">
            <div className="absolute left-5 top-2 bottom-2 w-px bg-gray-200" />
            {filteredLogs.map((log) => {
              const cfg = actionConfig[log.action] || actionConfig.save_draft
              return (
                <div key={log.id} className="relative flex gap-3 pb-5">
                  <div
                    className={cn(
                      'relative z-10 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border-2 border-white',
                      cfg.bg
                    )}
                  >
                    <span className={cn('text-[10px] font-semibold', cfg.color)}>
                      {cfg.label.slice(0, 1)}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {cfg.label}
                      </p>
                      <span className="ml-2 flex-shrink-0 text-xs text-gray-400 font-mono">
                        {formatTime(log.timestamp)}
                      </span>
                    </div>
                    {paramTaskId ? null : (
                      <p className="mt-0.5 text-xs text-gray-500 truncate">
                        {getTaskTitle(log.taskId)}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-gray-600">{log.detail}</p>
                    <p className="mt-1 text-[11px] text-gray-400">
                      操作人：{log.actor}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {reviewRecord && (
        <ReviewModal
          record={reviewRecord}
          onClose={() => setReviewRecord(null)}
        />
      )}
    </Layout>
  )
}
