import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Filter, FileJson } from 'lucide-react'
import Layout from '@/components/Layout'
import EmptyState from '@/components/EmptyState'
import { useTaskStore } from '@/stores/useTaskStore'
import { useAppStore } from '@/stores/useAppStore'
import type { EventAction } from '@/types'
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

const actionConfig: Record<EventAction, { label: string; color: string; bg: string }> = {
  claim: { label: '领取任务', color: 'text-blue-700', bg: 'bg-blue-100' },
  save_draft: { label: '保存草稿', color: 'text-gray-700', bg: 'bg-gray-100' },
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
  { value: 'submit', label: '提交' },
  { value: 'rework', label: '退回' },
  { value: 'approve', label: '通过' },
  { value: 'anomaly', label: '异常' },
  { value: 'reject', label: '拒绝' },
]

export default function Logs() {
  const navigate = useNavigate()
  const { taskId: paramTaskId } = useParams()
  const { eventLogs, fetchEventLogs, tasks } = useTaskStore()
  const role = useAppStore((s) => s.role)

  const [filter, setFilter] = useState<EventAction | 'all'>('all')
  const [showFilters, setShowFilters] = useState(false)

  useEffect(() => {
    if (paramTaskId) {
      fetchEventLogs({ taskId: paramTaskId })
    } else {
      fetchEventLogs()
    }
  }, [paramTaskId])

  const filteredLogs = useMemo(() => {
    if (filter === 'all') return eventLogs
    return eventLogs.filter((l) => l.action === filter)
  }, [eventLogs, filter])

  const getTaskTitle = (taskId: string) => {
    return tasks.find((t) => t.id === taskId)?.title || '未知任务'
  }

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
              onClick={() => navigate('/export')}
              className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-white/10"
              title="导出数据"
            >
              <FileJson className="h-5 w-5" />
            </button>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-white/10"
            >
              <Filter className="h-5 w-5" />
            </button>
          </div>
        ) : null
      }
    >
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
    </Layout>
  )
}
