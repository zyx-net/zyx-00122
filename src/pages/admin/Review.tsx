import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ClipboardCheck } from 'lucide-react'
import Layout from '@/components/Layout'
import StatusBadge from '@/components/StatusBadge'
import EmptyState from '@/components/EmptyState'
import { useTaskStore } from '@/stores/useTaskStore'
import type { TaskStatus } from '@/types'

export default function Review() {
  const navigate = useNavigate()
  const { tasks, fetchTasks } = useTaskStore()

  useEffect(() => {
    fetchTasks()
  }, [fetchTasks])

  const reviewTasks = tasks.filter((t) => t.status === 'submitted' || t.status === 'rework')

  return (
    <Layout title="审核列表" showNav navRole="admin">
      <div className="p-4 space-y-3">
        {reviewTasks.length === 0 ? (
          <EmptyState
            icon={<ClipboardCheck size={48} />}
            message="暂无待审核任务"
          />
        ) : (
          reviewTasks.map((task) => (
            <div
              key={task.id}
              onClick={() => navigate(`/admin/review/${task.id}`)}
              className="bg-white rounded-xl p-4 shadow-sm active:bg-gray-50 transition-colors cursor-pointer"
            >
              <div className="flex items-start justify-between mb-2">
                <h3 className="text-sm font-semibold text-[#1E3A5F] truncate flex-1">{task.title}</h3>
                <StatusBadge status={task.status as TaskStatus} />
              </div>
              <div className="flex items-center justify-between text-xs text-gray-400">
                <span>{task.assignee || '未分配'}</span>
                <span>{new Date(task.updatedAt).toLocaleString('zh-CN')}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </Layout>
  )
}
