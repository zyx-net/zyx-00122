import { useEffect } from 'react'
import { Clock, FileImage, AlertTriangle } from 'lucide-react'
import Layout from '@/components/Layout'
import EmptyState from '@/components/EmptyState'
import { useTaskStore } from '@/stores/useTaskStore'

function formatTime(ts: number) {
  return new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function Anomalies() {
  const { anomalies, fetchAnomalies, tasks } = useTaskStore()

  useEffect(() => {
    fetchAnomalies()
  }, [])

  const getTaskTitle = (taskId: string) => {
    return tasks.find((t) => t.id === taskId)?.title || '未知任务'
  }

  return (
    <Layout title="异常列表" showNav navRole="inspector">
      <div className="p-4 space-y-3">
        {anomalies.length === 0 ? (
          <EmptyState
            icon={<AlertTriangle className="h-12 w-12 text-gray-300" />}
            message="暂无异常记录"
          />
        ) : (
          anomalies
            .slice()
            .sort((a, b) => b.reportedAt - a.reportedAt)
            .map((anomaly) => (
              <div
                key={anomaly.id}
                className="rounded-xl bg-white p-4 shadow-sm"
              >
                <div className="mb-2 flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-red-100">
                      <AlertTriangle className="h-4 w-4 text-red-500" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900">{anomaly.checkItemLabel}</h3>
                      <p className="text-xs text-gray-500">{getTaskTitle(anomaly.taskId)}</p>
                    </div>
                  </div>
                </div>

                <p className="mb-3 text-sm text-gray-700">{anomaly.description}</p>

                {anomaly.attachmentPlaceholder && (
                  <div className="mb-3 flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2">
                    <FileImage className="h-4 w-4 text-gray-400" />
                    <span className="text-xs text-gray-500">{anomaly.attachmentPlaceholder}</span>
                  </div>
                )}

                <div className="flex items-center gap-1 text-xs text-gray-400">
                  <Clock className="h-3.5 w-3.5" />
                  {formatTime(anomaly.reportedAt)}
                </div>
              </div>
            ))
        )}
      </div>
    </Layout>
  )
}
