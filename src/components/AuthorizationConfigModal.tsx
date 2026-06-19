import { useEffect, useState } from 'react'
import {
  X,
  Users,
  Shield,
  Handshake,
  Clock,
  FileText,
  Check,
  AlertTriangle,
  Upload,
  Download,
  Trash2,
  RotateCcw,
  UserPlus,
} from 'lucide-react'
import {
  useAuthorizationStore,
  type CreateAuthorizationParams,
  type UpdateAuthorizationParams,
} from '@/stores/useAuthorizationStore'
import type { AuthorizationTemplate, BatchAuthorization } from '@/types'
import { cn } from '@/lib/utils'

export interface AuthorizationConfigResult {
  viewerUsernames: string[]
  rollbackerUsernames: string[]
  handoverUsernames: string[]
  expiresAt: number | null
  notes: string
  appliedTemplateId?: string
}

interface Props {
  open: boolean
  onClose: () => void
  onConfirm: (result: AuthorizationConfigResult) => void
  batchId?: string
  mode: 'create' | 'edit'
  existingAuth?: BatchAuthorization | null
  createdBy: string
}

export default function AuthorizationConfigModal({
  open,
  onClose,
  onConfirm,
  batchId,
  mode,
  existingAuth,
  createdBy,
}: Props) {
  const {
    templates,
    fetchTemplates,
    createTemplate,
    importTemplate,
    exportTemplate,
    applyTemplate,
    getSystemUsers,
  } = useAuthorizationStore()

  const systemUsers = getSystemUsers()

  const [viewers, setViewers] = useState<string[]>([])
  const [rollbackers, setRollbackers] = useState<string[]>([])
  const [handoverPersons, setHandoverPersons] = useState<string[]>([])
  const [expiryOption, setExpiryOption] = useState<'never' | 'hours' | 'days' | 'custom'>('never')
  const [expiryHours, setExpiryHours] = useState<number>(24)
  const [expiryDays, setExpiryDays] = useState<number>(7)
  const [customExpiry, setCustomExpiry] = useState<string>('')
  const [notes, setNotes] = useState('')
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('')
  const [showTemplateManager, setShowTemplateManager] = useState(false)
  const [newTemplateName, setNewTemplateName] = useState('')
  const [newTemplateDesc, setNewTemplateDesc] = useState('')
  const [importJson, setImportJson] = useState('')
  const [importResult, setImportResult] = useState<{ success: boolean; message: string; conflicts?: string[] } | null>(null)
  const [conflicts, setConflicts] = useState<string[]>([])

  useEffect(() => {
    if (open) {
      fetchTemplates()
      if (existingAuth) {
        setViewers(existingAuth.viewers.map(p => p.username))
        setRollbackers(existingAuth.rollbackers.map(p => p.username))
        setHandoverPersons(existingAuth.handoverPersons.map(p => p.username))
        setNotes(existingAuth.notes)
        if (existingAuth.expiresAt) {
          setExpiryOption('custom')
          setCustomExpiry(new Date(existingAuth.expiresAt).toISOString().slice(0, 16))
        } else {
          setExpiryOption('never')
        }
      } else {
        setViewers([])
        setRollbackers([])
        setHandoverPersons([])
        setNotes('')
        setExpiryOption('never')
        setExpiryHours(24)
        setExpiryDays(7)
      }
      setSelectedTemplateId('')
      setImportResult(null)
      setConflicts([])
    }
  }, [open, existingAuth, fetchTemplates])

  const toggleUser = (list: string[], setter: (v: string[]) => void, username: string) => {
    if (list.includes(username)) {
      setter(list.filter(u => u !== username))
    } else {
      setter([...list, username])
    }
  }

  const computeExpiresAt = (): number | null => {
    const now = Date.now()
    switch (expiryOption) {
      case 'never':
        return null
      case 'hours':
        return now + expiryHours * 3600 * 1000
      case 'days':
        return now + expiryDays * 24 * 3600 * 1000
      case 'custom':
        return customExpiry ? new Date(customExpiry).getTime() : null
      default:
        return null
    }
  }

  const detectConflicts = (): string[] => {
    const issues: string[] = []
    if (viewers.length === 0 && rollbackers.length === 0 && handoverPersons.length === 0) {
      issues.push('至少需要指定一个授权人员')
    }
    const allAssigned = [...viewers, ...rollbackers, ...handoverPersons]
    if (new Set(allAssigned).size !== allAssigned.length) {
      issues.push('存在重复授权的人员')
    }
    if (expiryOption === 'custom' && customExpiry) {
      const ts = new Date(customExpiry).getTime()
      if (ts < Date.now()) {
        issues.push('失效时间不能早于当前时间')
      }
    }
    return issues
  }

  const handleConfirm = () => {
    const found = detectConflicts()
    setConflicts(found)
    if (found.length > 0) return

    onConfirm({
      viewerUsernames: viewers,
      rollbackerUsernames: rollbackers,
      handoverUsernames: handoverPersons,
      expiresAt: computeExpiresAt(),
      notes,
      appliedTemplateId: selectedTemplateId || undefined,
    })
  }

  const handleApplyTemplate = async (templateId: string) => {
    const tpl = templates.find(t => t.id === templateId)
    if (!tpl) return
    setViewers(tpl.viewers)
    setRollbackers(tpl.rollbackers)
    setHandoverPersons(tpl.handoverPersons)
    if (tpl.defaultExpiryHours) {
      setExpiryOption('hours')
      setExpiryHours(tpl.defaultExpiryHours)
    }
    if (tpl.defaultNotes) {
      setNotes(tpl.defaultNotes)
    }
    setSelectedTemplateId(templateId)
  }

  const handleSaveAsTemplate = async () => {
    if (!newTemplateName.trim()) return
    try {
      await createTemplate({
        name: newTemplateName.trim(),
        description: newTemplateDesc.trim() || undefined,
        viewers,
        rollbackers,
        handoverPersons,
        defaultExpiryHours: expiryOption === 'hours' ? expiryHours : undefined,
        defaultNotes: notes || undefined,
        createdBy,
      })
      setNewTemplateName('')
      setNewTemplateDesc('')
      setImportResult({ success: true, message: '模板创建成功' })
    } catch (err) {
      setImportResult({ success: false, message: err instanceof Error ? err.message : '创建失败' })
    }
  }

  const handleImportTemplate = async () => {
    if (!importJson.trim()) return
    try {
      const result = await importTemplate(importJson, createdBy)
      if (result.success) {
        setImportResult({
          success: true,
          message: `导入成功${result.conflicts.length > 0 ? `，存在 ${result.conflicts.length} 项冲突提示` : ''}`,
          conflicts: result.conflicts.map(c => c.message),
        })
        setImportJson('')
      } else {
        setImportResult({
          success: false,
          message: '导入失败',
          conflicts: result.conflicts.map(c => c.message),
        })
      }
    } catch (err) {
      setImportResult({ success: false, message: err instanceof Error ? err.message : '导入失败' })
    }
  }

  const handleExportTemplate = async (templateId: string) => {
    try {
      const json = await exportTemplate(templateId)
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `auth-template-${Date.now()}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setImportResult({ success: false, message: err instanceof Error ? err.message : '导出失败' })
    }
  }

  if (!open) return null

  const UserPicker = ({
    title,
    icon: Icon,
    color,
    selected,
    onToggle,
    description,
  }: {
    title: string
    icon: any
    color: string
    selected: string[]
    onToggle: (u: string) => void
    description: string
  }) => (
    <div className="rounded-lg border border-gray-200 p-3">
      <div className="flex items-center gap-2 mb-2">
        <Icon className={cn('h-4 w-4', color)} />
        <p className="text-sm font-medium text-gray-900">{title}</p>
        <span className="text-xs text-gray-500">({selected.length}人)</span>
      </div>
      <p className="text-xs text-gray-500 mb-2">{description}</p>
      <div className="flex flex-wrap gap-1.5">
        {systemUsers.map(user => (
          <button
            key={user.username}
            onClick={() => onToggle(user.username)}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors',
              selected.includes(user.username)
                ? 'bg-primary text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            )}
          >
            {selected.includes(user.username) && <Check className="h-3 w-3" />}
            <UserPlus className="h-3 w-3" />
            {user.displayName}
          </button>
        ))}
      </div>
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-white rounded-xl shadow-xl">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between z-10">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <h3 className="text-base font-semibold text-gray-900">
              {mode === 'create' ? '配置批次授权' : '编辑批次授权'}
            </h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 text-gray-500">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {conflicts.length > 0 && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-3">
              <div className="flex items-center gap-2 mb-1">
                <AlertTriangle className="h-4 w-4 text-red-500" />
                <p className="text-sm font-medium text-red-800">需要修正以下问题</p>
              </div>
              <ul className="text-xs text-red-700 list-disc list-inside space-y-0.5">
                {conflicts.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            </div>
          )}

          {templates.length > 0 && (
            <div className="rounded-lg bg-blue-50 border border-blue-200 p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-blue-900">快速应用授权模板</p>
                <button
                  onClick={() => setShowTemplateManager(!showTemplateManager)}
                  className="text-xs text-blue-600 hover:text-blue-800"
                >
                  {showTemplateManager ? '收起模板管理' : '展开模板管理'}
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {templates.map(tpl => (
                  <button
                    key={tpl.id}
                    onClick={() => handleApplyTemplate(tpl.id)}
                    className={cn(
                      'px-2.5 py-1 rounded text-xs transition-colors',
                      selectedTemplateId === tpl.id
                        ? 'bg-primary text-white'
                        : 'bg-white text-blue-700 hover:bg-blue-100 border border-blue-300'
                    )}
                  >
                    {tpl.name} (v{tpl.version})
                  </button>
                ))}
              </div>

              {showTemplateManager && (
                <div className="mt-3 pt-3 border-t border-blue-200 space-y-3">
                  <div>
                    <p className="text-xs font-medium text-blue-800 mb-1">保存当前配置为模板</p>
                    <div className="flex gap-2 mb-2">
                      <input
                        type="text"
                        value={newTemplateName}
                        onChange={e => setNewTemplateName(e.target.value)}
                        placeholder="模板名称"
                        className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded"
                      />
                      <input
                        type="text"
                        value={newTemplateDesc}
                        onChange={e => setNewTemplateDesc(e.target.value)}
                        placeholder="描述（可选）"
                        className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded"
                      />
                      <button
                        onClick={handleSaveAsTemplate}
                        className="px-3 py-1 text-xs bg-primary text-white rounded hover:bg-primary/90"
                      >
                        保存
                      </button>
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-medium text-blue-800 mb-1">导入模板 JSON</p>
                    <div className="flex gap-2">
                      <textarea
                        value={importJson}
                        onChange={e => setImportJson(e.target.value)}
                        placeholder="粘贴模板 JSON 内容..."
                        rows={2}
                        className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded font-mono"
                      />
                      <button
                        onClick={handleImportTemplate}
                        className="px-3 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 flex items-center gap-1"
                      >
                        <Upload className="h-3 w-3" />
                        导入
                      </button>
                    </div>
                  </div>

                  {templates.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-blue-800 mb-1">导出现有模板</p>
                      <div className="flex flex-wrap gap-1.5">
                        {templates.map(tpl => (
                          <button
                            key={tpl.id}
                            onClick={() => handleExportTemplate(tpl.id)}
                            className="flex items-center gap-1 px-2 py-1 text-xs bg-white border border-blue-300 text-blue-700 rounded hover:bg-blue-50"
                          >
                            <Download className="h-3 w-3" />
                            {tpl.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {importResult && (
                    <div className={cn(
                      'rounded p-2 text-xs',
                      importResult.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                    )}>
                      {importResult.message}
                      {importResult.conflicts && importResult.conflicts.length > 0 && (
                        <ul className="mt-1 list-disc list-inside">
                          {importResult.conflicts.map((c, i) => <li key={i}>{c}</li>)}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <UserPicker
            title="查看人"
            icon={Users}
            color="text-blue-600"
            selected={viewers}
            onToggle={(u) => toggleUser(viewers, setViewers, u)}
            description="可以查看批次详情、预览记录，但不能执行回滚"
          />

          <UserPicker
            title="回滚人"
            icon={RotateCcw}
            color="text-amber-600"
            selected={rollbackers}
            onToggle={(u) => toggleUser(rollbackers, setRollbackers, u)}
            description="可以执行回滚操作，同时自动拥有查看权限"
          />

          <UserPicker
            title="接手人"
            icon={Handshake}
            color="text-green-600"
            selected={handoverPersons}
            onToggle={(u) => toggleUser(handoverPersons, setHandoverPersons, u)}
            description="可以将批次交接给他人，同时拥有查看和回滚权限"
          />

          <div className="rounded-lg border border-gray-200 p-3">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="h-4 w-4 text-purple-600" />
              <p className="text-sm font-medium text-gray-900">失效时间</p>
            </div>
            <div className="flex flex-wrap gap-2 mb-2">
              {(['never', 'hours', 'days', 'custom'] as const).map(opt => (
                <button
                  key={opt}
                  onClick={() => setExpiryOption(opt)}
                  className={cn(
                    'px-3 py-1.5 rounded text-xs',
                    expiryOption === opt
                      ? 'bg-purple-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  )}
                >
                  {opt === 'never' && '永不失效'}
                  {opt === 'hours' && `${expiryHours} 小时后`}
                  {opt === 'days' && `${expiryDays} 天后`}
                  {opt === 'custom' && '自定义时间'}
                </button>
              ))}
            </div>
            {expiryOption === 'hours' && (
              <input
                type="number"
                min={1}
                max={720}
                value={expiryHours}
                onChange={e => setExpiryHours(Number(e.target.value))}
                className="w-32 px-2 py-1 text-xs border border-gray-300 rounded"
              />
            )}
            {expiryOption === 'days' && (
              <input
                type="number"
                min={1}
                max={365}
                value={expiryDays}
                onChange={e => setExpiryDays(Number(e.target.value))}
                className="w-32 px-2 py-1 text-xs border border-gray-300 rounded"
              />
            )}
            {expiryOption === 'custom' && (
              <input
                type="datetime-local"
                value={customExpiry}
                onChange={e => setCustomExpiry(e.target.value)}
                className="px-2 py-1 text-xs border border-gray-300 rounded"
              />
            )}
          </div>

          <div className="rounded-lg border border-gray-200 p-3">
            <div className="flex items-center gap-2 mb-2">
              <FileText className="h-4 w-4 text-gray-600" />
              <p className="text-sm font-medium text-gray-900">授权备注</p>
            </div>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="填写授权说明、审批单号等信息（可选）..."
              rows={2}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>

          {batchId && (
            <div className="text-xs text-gray-500 bg-gray-50 rounded p-2">
              批次 ID：<span className="font-mono">{batchId}</span>
            </div>
          )}
        </div>

        <div className="sticky bottom-0 bg-white border-t border-gray-200 px-4 py-3 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 h-10 rounded-lg text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200"
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            className="flex-1 h-10 rounded-lg text-sm font-medium bg-primary text-white hover:bg-primary/90 flex items-center justify-center gap-1.5"
          >
            <Check className="h-4 w-4" />
            {mode === 'create' ? '创建授权' : '保存修改'}
          </button>
        </div>
      </div>
    </div>
  )
}
