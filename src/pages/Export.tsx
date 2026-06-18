import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileJson, CheckCircle2, Download, FileText } from 'lucide-react'
import Layout from '@/components/Layout'
import { db } from '@/db'
import { useAppStore } from '@/stores/useAppStore'
import { cn } from '@/lib/utils'

export default function Export() {
  const navigate = useNavigate()
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
  const addToast = useAppStore((s) => s.addToast)
  const role = useAppStore((s) => s.role)

  const exportOptions = [
    { key: 'templates', label: '模板数据', desc: '包含点位和检查项配置' },
    { key: 'tasks', label: '任务数据', desc: '包含任务状态和分配信息' },
    { key: 'drafts', label: '草稿数据', desc: '未提交的巡检填写内容' },
    { key: 'submissions', label: '提交记录', desc: '所有历史提交和审批记录' },
    { key: 'anomalies', label: '异常记录', desc: '所有上报的异常信息' },
    { key: 'eventLogs', label: '事件日志', desc: '所有操作的完整审计记录' },
  ]

  const handleExport = async () => {
    const keys = Object.keys(selected).filter((k) => selected[k])
    if (keys.length === 0) {
      addToast('请至少选择一项数据类型', 'warning')
      return
    }

    setExporting(true)
    try {
      const exportData: Record<string, unknown> = {
        exportedAt: Date.now(),
        exportedBy: role === 'admin' ? '管理员' : '巡检员',
        appVersion: '1.0.0',
      }

      for (const key of keys) {
        if (key === 'templates') exportData[key] = await db.templates.toArray()
        else if (key === 'tasks') exportData[key] = await db.tasks.toArray()
        else if (key === 'drafts') exportData[key] = await db.drafts.toArray()
        else if (key === 'submissions') exportData[key] = await db.submissions.toArray()
        else if (key === 'anomalies') exportData[key] = await db.anomalies.toArray()
        else if (key === 'eventLogs') exportData[key] = await db.eventLogs.toArray()
      }

      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `inspection-export-${new Date().toISOString().slice(0, 10)}-${Date.now()}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      setLastExportTime(Date.now())
      addToast('导出成功', 'success')
    } catch {
      addToast('导出失败', 'error')
    } finally {
      setExporting(false)
    }
  }

  const toggleAll = () => {
    const allSelected = Object.values(selected).every(Boolean)
    const next = Object.fromEntries(Object.keys(selected).map((k) => [k, !allSelected]))
    setSelected(next)
  }

  return (
    <Layout
      title="数据导出"
      onBack={() => navigate(-1)}
      showNav
      navRole={role || 'admin'}
    >
      <div className="p-4 space-y-4">
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
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-green-600" />
              <div>
                <p className="text-sm font-medium text-green-800">上次导出</p>
                <p className="text-xs text-green-600">
                  {new Date(lastExportTime).toLocaleString('zh-CN')}
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="sticky bottom-0 pt-4">
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
