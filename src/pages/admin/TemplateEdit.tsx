import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ChevronDown, ChevronUp, Trash2, Plus, GripVertical } from 'lucide-react'
import Layout from '@/components/Layout'
import { useTemplateStore } from '@/stores/useTemplateStore'
import type { CheckItemType, CheckItem } from '@/types'

const itemTypes: { value: CheckItemType; label: string }[] = [
  { value: 'text', label: '文本' },
  { value: 'number', label: '数字' },
  { value: 'select', label: '选择' },
  { value: 'attachment', label: '附件' },
]

export default function TemplateEdit() {
  const { id: templateId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { templates, fetchTemplates, updateTemplate, addCheckPoint, removeCheckPoint, updateCheckPoint, addCheckItem, updateCheckItem, removeCheckItem } = useTemplateStore()
  const [expandedCp, setExpandedCp] = useState<Set<string>>(new Set())
  const [optionEditor, setOptionEditor] = useState<string | null>(null)
  const [optionText, setOptionText] = useState('')

  const template = templates.find((t) => t.id === templateId)

  useEffect(() => {
    fetchTemplates()
  }, [fetchTemplates])

  const toggleCp = (cpId: string) => {
    setExpandedCp((prev) => {
      const next = new Set(prev)
      if (next.has(cpId)) next.delete(cpId)
      else next.add(cpId)
      return next
    })
  }

  const handleNameChange = useCallback(async (val: string) => {
    if (!templateId) return
    await updateTemplate(templateId, { name: val })
  }, [templateId, updateTemplate])

  const handleVersionChange = useCallback(async (val: string) => {
    if (!templateId) return
    await updateTemplate(templateId, { version: val })
  }, [templateId, updateTemplate])

  const handleAddCheckpoint = async () => {
    if (!templateId) return
    const order = template ? template.checkpoints.length : 0
    await addCheckPoint(templateId, { name: `点位 ${order + 1}`, order, items: [] })
    const updated = useTemplateStore.getState().templates.find((t) => t.id === templateId)
    if (updated) {
      const lastCp = updated.checkpoints[updated.checkpoints.length - 1]
      if (lastCp) setExpandedCp((prev) => new Set(prev).add(lastCp.id))
    }
  }

  const handleCpNameChange = async (cpId: string, name: string) => {
    if (!templateId) return
    await updateCheckPoint(templateId, cpId, { name })
  }

  const handleDeleteCp = async (cpId: string) => {
    if (!templateId) return
    await removeCheckPoint(templateId, cpId)
    setExpandedCp((prev) => { const n = new Set(prev); n.delete(cpId); return n })
  }

  const handleAddItem = async (cpId: string) => {
    if (!templateId) return
    await addCheckItem(templateId, cpId, { label: '新检查项', type: 'text', required: false })
  }

  const handleItemUpdate = async (cpId: string, itemId: string, updates: Partial<CheckItem>) => {
    if (!templateId) return
    await updateCheckItem(templateId, cpId, itemId, updates)
  }

  const handleDeleteItem = async (cpId: string, itemId: string) => {
    if (!templateId) return
    await removeCheckItem(templateId, cpId, itemId)
  }

  const openOptionEditor = (cpId: string, itemId: string, current?: string[]) => {
    setOptionEditor(`${cpId}:${itemId}`)
    setOptionText((current || []).join('\n'))
  }

  const saveOptions = async (cpId: string, itemId: string) => {
    const options = optionText.split('\n').map((s) => s.trim()).filter(Boolean)
    await handleItemUpdate(cpId, itemId, { options })
    setOptionEditor(null)
    setOptionText('')
  }

  if (!template) {
    return (
      <Layout title="编辑模板" onBack={() => navigate('/admin/templates')}>
        <div className="p-4 text-center text-sm text-gray-400">加载中...</div>
      </Layout>
    )
  }

  return (
    <Layout title="编辑模板" onBack={() => navigate('/admin/templates')}>
      <div className="p-4 space-y-4">
        <div className="bg-white rounded-xl p-4 shadow-sm space-y-3">
          <div>
            <label className="text-xs text-gray-400 mb-1 block">模板名称</label>
            <input
              value={template.name}
              onChange={(e) => handleNameChange(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#1E3A5F]"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">版本号</label>
            <input
              value={template.version}
              onChange={(e) => handleVersionChange(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#1E3A5F]"
            />
          </div>
        </div>

        {template.checkpoints.map((cp) => {
          const isExpanded = expandedCp.has(cp.id)
          return (
            <div key={cp.id} className="bg-white rounded-xl shadow-sm overflow-hidden">
              <button
                onClick={() => toggleCp(cp.id)}
                className="w-full flex items-center gap-2 p-4 active:bg-gray-50"
              >
                <GripVertical size={14} className="text-gray-300 shrink-0" />
                <span className="flex-1 text-left text-sm font-semibold text-[#1E3A5F] truncate">{cp.name}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDeleteCp(cp.id) }}
                  className="p-1 text-red-400 active:text-red-600 shrink-0"
                >
                  <Trash2 size={16} />
                </button>
                {isExpanded ? <ChevronUp size={18} className="text-gray-400 shrink-0" /> : <ChevronDown size={18} className="text-gray-400 shrink-0" />}
              </button>

              {isExpanded && (
                <div className="px-4 pb-4 space-y-3">
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">点位名称</label>
                    <input
                      value={cp.name}
                      onChange={(e) => handleCpNameChange(cp.id, e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#1E3A5F]"
                    />
                  </div>

                  {cp.items.length > 0 && (
                    <div className="space-y-2">
                      {cp.items.map((item) => (
                        <div key={item.id} className="border border-gray-100 rounded-lg p-3 space-y-2">
                          <div className="flex items-center gap-2">
                            <input
                              value={item.label}
                              onChange={(e) => handleItemUpdate(cp.id, item.id, { label: e.target.value })}
                              placeholder="检查项名称"
                              className="flex-1 px-2 py-1.5 border border-gray-200 rounded text-xs focus:outline-none focus:border-[#1E3A5F]"
                            />
                            <button
                              onClick={() => handleDeleteItem(cp.id, item.id)}
                              className="p-1 text-red-400 active:text-red-600 shrink-0"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>

                          <div className="flex items-center gap-2">
                            <select
                              value={item.type}
                              onChange={(e) => handleItemUpdate(cp.id, item.id, { type: e.target.value as CheckItemType })}
                              className="flex-1 px-2 py-1.5 border border-gray-200 rounded text-xs focus:outline-none focus:border-[#1E3A5F] bg-white"
                            >
                              {itemTypes.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                            </select>

                            <label className="flex items-center gap-1 text-xs text-gray-500 shrink-0 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={item.required}
                                onChange={(e) => handleItemUpdate(cp.id, item.id, { required: e.target.checked })}
                                className="w-3.5 h-3.5 rounded accent-[#F59E0B]"
                              />
                              必填
                            </label>
                          </div>

                          {item.type === 'number' && (
                            <div className="flex gap-2">
                              <input
                                type="number"
                                value={item.min ?? ''}
                                onChange={(e) => handleItemUpdate(cp.id, item.id, { min: e.target.value ? Number(e.target.value) : undefined })}
                                placeholder="最小值"
                                className="flex-1 px-2 py-1.5 border border-gray-200 rounded text-xs focus:outline-none focus:border-[#1E3A5F]"
                              />
                              <input
                                type="number"
                                value={item.max ?? ''}
                                onChange={(e) => handleItemUpdate(cp.id, item.id, { max: e.target.value ? Number(e.target.value) : undefined })}
                                placeholder="最大值"
                                className="flex-1 px-2 py-1.5 border border-gray-200 rounded text-xs focus:outline-none focus:border-[#1E3A5F]"
                              />
                            </div>
                          )}

                          {item.type === 'select' && (
                            <div>
                              <button
                                onClick={() => openOptionEditor(cp.id, item.id, item.options)}
                                className="w-full px-2 py-1.5 border border-dashed border-gray-200 rounded text-xs text-gray-400 active:bg-gray-50"
                              >
                                {item.options && item.options.length > 0
                                  ? `选项：${item.options.join('、')}`
                                  : '点击设置选项'}
                              </button>
                              {optionEditor === `${cp.id}:${item.id}` && (
                                <div className="mt-2 space-y-2">
                                  <textarea
                                    value={optionText}
                                    onChange={(e) => setOptionText(e.target.value)}
                                    placeholder="每行一个选项"
                                    rows={3}
                                    className="w-full px-2 py-1.5 border border-gray-200 rounded text-xs focus:outline-none focus:border-[#1E3A5F] resize-none"
                                  />
                                  <div className="flex gap-2">
                                    <button onClick={() => setOptionEditor(null)} className="flex-1 py-1.5 text-xs text-gray-500 bg-gray-100 rounded">取消</button>
                                    <button onClick={() => saveOptions(cp.id, item.id)} className="flex-1 py-1.5 text-xs text-white bg-[#1E3A5F] rounded">保存</button>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  <button
                    onClick={() => handleAddItem(cp.id)}
                    className="w-full py-2 text-xs font-medium text-[#1E3A5F] bg-[#1E3A5F]/5 rounded-lg active:bg-[#1E3A5F]/10 flex items-center justify-center gap-1"
                  >
                    <Plus size={14} /> 添加检查项
                  </button>
                </div>
              )}
            </div>
          )
        })}

        <button
          onClick={handleAddCheckpoint}
          className="w-full py-3 text-sm font-medium text-white bg-[#1E3A5F] rounded-xl active:opacity-80 flex items-center justify-center gap-1"
        >
          <Plus size={16} /> 添加点位
        </button>
      </div>
    </Layout>
  )
}
