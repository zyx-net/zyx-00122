import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Clock, User } from 'lucide-react'
import Layout from '@/components/Layout'
import StatusBadge from '@/components/StatusBadge'
import EmptyState from '@/components/EmptyState'
import { useTaskStore } from '@/stores/useTaskStore'
import { useAppStore } from '@/stores/useAppStore'
import { cn } from '@/lib/utils'

function formatTime(ts: number) {
  return new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function TaskList() {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<'available' | 'mine'>('available')
  const { tasks, fetchTasks, claimTask, readDraft } = useTaskStore()
  const addToast = useAppStore((s) => s.addToast)
  const [claimingId, setClaimingId] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, number>>({})

  useEffect(() => {
    fetchTasks()
  }, [])

  useEffect(() => {
    const readDraftTimes = async () => {
      const map: Record<string, number> = {}
      for (const t of tasks.filter((t) => t.status !== 'available')) {
        const draft = await readDraft(t.id)
        if (draft) map[t.id] = draft.savedAt
      }
      setDrafts(map)
    }
    readDraftTimes()
  }, [tasks, readDraft])

  const availableTasks = tasks.filter((t) => t.status === 'available')
  const myTasks = tasks.filter((t) => t.status !== 'available' && t.assignee)

  const handleClaim = async (taskId: string) => {
    try {
      setClaimingId(taskId)
      await claimTask(taskId, '巡检员张三')
      addToast('任务领取成功', 'success')
      setActiveTab('mine')
    } catch (e) {
      addToast((e as Error).message, 'error')
    } finally {
      setClaimingId(null)
    }
  }

  return (
    <Layout title="任务列表" showNav navRole="inspector">
      <div className="sticky top-0 z-20 flex bg-surface/95 backdrop-blur">
        {(['available', 'mine'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'flex-1 py-3 text-sm font-medium transition-colors border-b-2',
              activeTab === tab
                ? 'text-primary border-primary'
                : 'text-gray-500 border-transparent'
            )}
          >
            {tab === 'available' ? `可领取 (${availableTasks.length})` : `我的任务 (${myTasks.length})`}
          </button>
        ))}
      </div>

      <div className="p-4 space-y-3">
        {activeTab === 'available' && availableTasks.length === 0 && (
          <EmptyState message="暂无可领取任务" />
        )}

        {activeTab === 'available' && availableTasks.map((task) => (
          <div key={task.id} className="rounded-xl bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-start justify-between">
              <h3 className="text-base font-semibold text-gray-900">{task.title}</h3>
              <StatusBadge status={task.status} />
            </div>
            <p className="mb-3 text-xs text-gray-500">模板版本：v{task.templateVersion}</p>
            <div className="mb-3 flex items-center gap-4 text-xs text-gray-400">
              <span className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                {formatTime(task.createdAt)}
              </span>
            </div>
            <button
              onClick={() => handleClaim(task.id)}
              disabled={claimingId === task.id}
              className={cn(
                'w-full rounded-lg h-11 text-sm font-medium transition-colors',
                claimingId === task.id
                  ? 'bg-amber-200 text-amber-100 cursor-not-allowed'
                  : 'bg-accent text-white hover:bg-amber-600 active:bg-amber-700'
              )}
            >
              {claimingId === task.id ? '领取中...' : '领取任务'}
            </button>
          </div>
        ))}

        {activeTab === 'mine' && myTasks.length === 0 && (
          <EmptyState message="暂无任务，去领取一个吧" />
        )}

        {activeTab === 'mine' && myTasks.map((task) => (
          <div
            key={task.id}
            onClick={() => navigate(`/inspector/inspect/${task.id}`)}
            className="rounded-xl bg-white p-4 shadow-sm active:bg-gray-50 transition-colors"
          >
            <div className="mb-2 flex items-start justify-between">
              <h3 className="text-base font-semibold text-gray-900">{task.title}</h3>
              <StatusBadge status={task.status} />
            </div>
            <div className="mb-3 flex items-center gap-4 text-xs text-gray-500">
              <span className="flex items-center gap-1">
                <User className="h-3.5 w-3.5" />
                {task.assignee}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                {formatTime(task.updatedAt)}
              </span>
            </div>
            {drafts[task.id] && (
              <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                草稿保存时间：{formatTime(drafts[task.id])}
              </div>
            )}
          </div>
        ))}
      </div>
    </Layout>
  )
}
