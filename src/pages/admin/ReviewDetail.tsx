import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Layout from '@/components/Layout'
import StatusBadge from '@/components/StatusBadge'
import ReworkHistory from '@/components/ReworkHistory'
import { useTaskStore } from '@/stores/useTaskStore'
import { useTemplateStore } from '@/stores/useTemplateStore'
import { useAppStore } from '@/stores/useAppStore'
import type { Template } from '@/types'

export default function ReviewDetail() {
  const { taskId } = useParams<{ taskId: string }>()
  const navigate = useNavigate()
  const { tasks, submissions, fetchTasks, fetchSubmissions, approveTask, reworkTask } = useTaskStore()
  const { getTemplate } = useTemplateStore()
  const { addToast } = useAppStore()
  const [template, setTemplate] = useState<Template | null>(null)
  const [showRework, setShowRework] = useState(false)
  const [reworkReason, setReworkReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const task = tasks.find((t) => t.id === taskId)

  useEffect(() => {
    fetchTasks()
  }, [fetchTasks])

  useEffect(() => {
    if (taskId) fetchSubmissions(taskId)
  }, [taskId, fetchSubmissions])

  useEffect(() => {
    if (task?.templateId) {
      getTemplate(task.templateId).then((t) => { if (t) setTemplate(t) })
    }
  }, [task?.templateId, getTemplate])

  const latestSubmission = submissions.length > 0
    ? submissions.reduce((a, b) => (a.version > b.version ? a : b))
    : null

  const handleApprove = async () => {
    if (!taskId || submitting) return
    setSubmitting(true)
    try {
      await approveTask(taskId)
      addToast('审核通过')
      navigate('/admin/review')
    } catch {
      addToast('操作失败', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const handleRework = async () => {
    if (!taskId || !reworkReason.trim() || submitting) return
    setSubmitting(true)
    try {
      await reworkTask(taskId, reworkReason.trim())
      addToast('已退回任务')
      setShowRework(false)
      setReworkReason('')
      navigate('/admin/review')
    } catch {
      addToast('操作失败', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const renderAnswer = (value: unknown) => {
    if (value === undefined || value === null || value === '') return <span className="text-gray-300">未填写</span>
    if (Array.isArray(value)) return <span>{value.join('、')}</span>
    return <span>{String(value)}</span>
  }

  return (
    <Layout title="审核详情" onBack={() => navigate('/admin/review')}>
      <div className="p-4 space-y-4">
        {task && (
          <div className="bg-white rounded-xl p-4 shadow-sm space-y-2">
            <div className="flex items-start justify-between">
              <h2 className="text-base font-semibold text-[#1E3A5F] flex-1 truncate">{task.title}</h2>
              <StatusBadge status={task.status} />
            </div>
            <div className="flex items-center justify-between text-xs text-gray-400">
              <span>{task.assignee || '未分配'}</span>
              <span>{new Date(task.updatedAt).toLocaleString('zh-CN')}</span>
            </div>
          </div>
        )}

        {template && latestSubmission && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-[#1E3A5F] px-1">检查结果</h3>
            {template.checkpoints.map((cp) => (
              <div key={cp.id} className="bg-white rounded-xl p-4 shadow-sm space-y-3">
                <h4 className="text-sm font-medium text-[#1E3A5F]">{cp.name}</h4>
                {cp.items.map((item) => (
                  <div key={item.id} className="border-t border-gray-50 pt-2 first:border-0 first:pt-0">
                    <div className="text-xs text-gray-400 mb-1">{item.label}</div>
                    <div className="text-sm text-gray-700">
                      {renderAnswer(latestSubmission.answers[item.id])}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        <ReworkHistory submissions={submissions} />

        {task && task.status === 'submitted' && (
          <div className="flex gap-3 pt-2">
            <button
              onClick={() => setShowRework(true)}
              className="flex-1 py-3 text-sm font-medium text-white bg-red-500 rounded-xl active:opacity-80"
            >
              退回
            </button>
            <button
              onClick={handleApprove}
              disabled={submitting}
              className="flex-1 py-3 text-sm font-medium text-white bg-green-500 rounded-xl active:opacity-80 disabled:opacity-50"
            >
              通过
            </button>
          </div>
        )}

        {task && task.status === 'rework' && (
          <div className="bg-orange-50 rounded-xl p-4 text-sm text-orange-700">
            该任务已被退回，等待巡检员重新提交
          </div>
        )}
      </div>

      {showRework && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={() => setShowRework(false)}>
          <div className="w-full max-w-[375px] bg-white rounded-t-2xl p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-[#1E3A5F]">退回原因</h3>
            <textarea
              value={reworkReason}
              onChange={(e) => setReworkReason(e.target.value)}
              placeholder="请输入退回原因..."
              rows={4}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#1E3A5F] resize-none"
              autoFocus
            />
            <div className="flex gap-3">
              <button onClick={() => setShowRework(false)} className="flex-1 py-2.5 text-sm text-gray-500 bg-gray-100 rounded-lg">取消</button>
              <button
                onClick={handleRework}
                disabled={!reworkReason.trim() || submitting}
                className="flex-1 py-2.5 text-sm text-white bg-red-500 rounded-lg active:opacity-80 disabled:opacity-50"
              >
                确认退回
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}
