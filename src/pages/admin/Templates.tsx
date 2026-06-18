import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, FileText, MapPin, ListChecks } from 'lucide-react'
import Layout from '@/components/Layout'
import EmptyState from '@/components/EmptyState'
import { useTemplateStore } from '@/stores/useTemplateStore'
import { useTaskStore } from '@/stores/useTaskStore'
import { useAppStore } from '@/stores/useAppStore'

export default function Templates() {
  const navigate = useNavigate()
  const { templates, fetchTemplates } = useTemplateStore()
  const { createTaskFromTemplate } = useTaskStore()
  const { addToast } = useAppStore()
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [newVersion, setNewVersion] = useState('1.0')
  const [taskModal, setTaskModal] = useState<string | null>(null)
  const [taskTitle, setTaskTitle] = useState('')

  useEffect(() => {
    fetchTemplates()
  }, [fetchTemplates])

  const handleCreate = async () => {
    if (!newName.trim()) return
    const { createTemplate } = useTemplateStore.getState()
    const id = await createTemplate({ name: newName.trim(), version: newVersion.trim() || '1.0', checkpoints: [] })
    addToast('模板创建成功')
    setShowCreate(false)
    setNewName('')
    setNewVersion('1.0')
    navigate(`/admin/templates/${id}`)
  }

  const handleCreateTask = async () => {
    if (!taskModal || !taskTitle.trim()) return
    await createTaskFromTemplate(taskModal, taskTitle.trim())
    addToast('任务创建成功')
    setTaskModal(null)
    setTaskTitle('')
  }

  return (
    <Layout title="模板管理" showNav navRole="admin" rightAction={
      <button onClick={() => setShowCreate(true)} className="p-1 rounded active:bg-white/10">
        <Plus size={22} />
      </button>
    }>
      <div className="p-4 space-y-3">
        {templates.length === 0 ? (
          <EmptyState
            icon={<FileText size={48} />}
            message="暂无模板，点击右上角创建"
            actionLabel="创建模板"
            onAction={() => setShowCreate(true)}
          />
        ) : (
          templates.map((tpl) => {
            const cpCount = tpl.checkpoints.length
            const ciCount = tpl.checkpoints.reduce((s, cp) => s + cp.items.length, 0)
            return (
              <div
                key={tpl.id}
                onClick={() => navigate(`/admin/templates/${tpl.id}`)}
                className="bg-white rounded-xl p-4 shadow-sm active:bg-gray-50 transition-colors cursor-pointer"
              >
                <div className="flex items-start justify-between mb-2">
                  <h3 className="text-sm font-semibold text-[#1E3A5F] truncate flex-1">{tpl.name}</h3>
                  <span className="text-xs text-gray-400 ml-2 shrink-0">v{tpl.version}</span>
                </div>
                <div className="flex items-center gap-4 text-xs text-gray-400 mb-3">
                  <span className="flex items-center gap-1"><MapPin size={12} />{cpCount} 个点位</span>
                  <span className="flex items-center gap-1"><ListChecks size={12} />{ciCount} 个检查项</span>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); setTaskModal(tpl.id); setTaskTitle(tpl.name) }}
                  className="w-full py-2 text-xs font-medium text-[#1E3A5F] bg-[#1E3A5F]/5 rounded-lg active:bg-[#1E3A5F]/10"
                >
                  创建任务
                </button>
              </div>
            )
          })
        )}
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={() => setShowCreate(false)}>
          <div className="w-full max-w-[375px] bg-white rounded-t-2xl p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-[#1E3A5F]">新建模板</h3>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="模板名称"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#1E3A5F]"
              autoFocus
            />
            <input
              value={newVersion}
              onChange={(e) => setNewVersion(e.target.value)}
              placeholder="版本号"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#1E3A5F]"
            />
            <div className="flex gap-3">
              <button onClick={() => setShowCreate(false)} className="flex-1 py-2.5 text-sm text-gray-500 bg-gray-100 rounded-lg">取消</button>
              <button onClick={handleCreate} className="flex-1 py-2.5 text-sm text-white bg-[#1E3A5F] rounded-lg active:opacity-80">创建</button>
            </div>
          </div>
        </div>
      )}

      {taskModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={() => { setTaskModal(null); setTaskTitle('') }}>
          <div className="w-full max-w-[375px] bg-white rounded-t-2xl p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-[#1E3A5F]">创建任务</h3>
            <input
              value={taskTitle}
              onChange={(e) => setTaskTitle(e.target.value)}
              placeholder="任务标题"
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#1E3A5F]"
              autoFocus
            />
            <div className="flex gap-3">
              <button onClick={() => { setTaskModal(null); setTaskTitle('') }} className="flex-1 py-2.5 text-sm text-gray-500 bg-gray-100 rounded-lg">取消</button>
              <button onClick={handleCreateTask} className="flex-1 py-2.5 text-sm text-white bg-[#F59E0B] rounded-lg active:opacity-80">确认创建</button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}
