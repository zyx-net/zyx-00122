import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Shield,
  Users,
  RotateCcw,
  Handshake,
  Clock,
  History,
  ChevronDown,
  ChevronUp,
  Search,
  Filter,
  Eye,
  Edit,
  Ban,
  RotateCcw as Undo,
  ArrowLeft,
  FileText,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Download,
  Upload,
  RefreshCcw,
  User,
  X,
} from 'lucide-react'
import Layout from '@/components/Layout'
import AuthorizationConfigModal from '@/components/AuthorizationConfigModal'
import { useAuthorizationStore, isExpired } from '@/stores/useAuthorizationStore'
import { useImportStore } from '@/stores/useImportStore'
import { useAppStore } from '@/stores/useAppStore'
import type { BatchAuthorization, ImportBatch, OperationTimelineEntry } from '@/types'
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

const actionLabels: Record<string, { label: string; color: string; bg: string }> = {
  auth_create: { label: '创建授权', color: 'text-green-700', bg: 'bg-green-100' },
  auth_update: { label: '更新授权', color: 'text-blue-700', bg: 'bg-blue-100' },
  auth_expire: { label: '授权过期', color: 'text-gray-700', bg: 'bg-gray-100' },
  auth_revoke: { label: '撤销授权', color: 'text-red-700', bg: 'bg-red-100' },
  auth_restore: { label: '恢复授权', color: 'text-emerald-700', bg: 'bg-emerald-100' },
  batch_handover: { label: '批次交接', color: 'text-purple-700', bg: 'bg-purple-100' },
  template_import: { label: '导入模板', color: 'text-teal-700', bg: 'bg-teal-100' },
  template_export: { label: '导出模板', color: 'text-indigo-700', bg: 'bg-indigo-100' },
  access_granted: { label: '访问通过', color: 'text-green-700', bg: 'bg-green-100' },
  access_denied: { label: '访问拒绝', color: 'text-red-700', bg: 'bg-red-100' },
}

export default function AuthorizationLedger() {
  const navigate = useNavigate()
  const role = useAppStore(s => s.role)
  const addToast = useAppStore(s => s.addToast)
  const {
    authorizations,
    revokedAuthorizations,
    templates,
    timeline,
    fetchAuthorizations,
    fetchTemplates,
    fetchTimeline,
    createAuthorization,
    updateAuthorization,
    revokeAuthorization,
    restoreAuthorization,
    getAuthorizationByBatchId,
    getSystemUsers,
    exportTemplate,
    importTemplate,
    clearError,
  } = useAuthorizationStore()
  const { batches, fetchBatches, canViewBatch, canRollbackBatch } = useImportStore()

  const [view, setView] = useState<'list' | 'detail'>('list')
  const [selectedAuthId, setSelectedAuthId] = useState<string | null>(null)
  const [showConfigModal, setShowConfigModal] = useState(false)
  const [configMode, setConfigMode] = useState<'create' | 'edit'>('create')
  const [configBatchId, setConfigBatchId] = useState<string | undefined>(undefined)
  const [expandedAuthId, setExpandedAuthId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'expired' | 'revoked'>('all')
  const [showHandoverModal, setShowHandoverModal] = useState(false)
  const [handoverFrom, setHandoverFrom] = useState('')
  const [handoverTo, setHandoverTo] = useState('')
  const [showRevokeModal, setShowRevokeModal] = useState(false)
  const [revokeReason, setRevokeReason] = useState('')
  const [activeTab, setActiveTab] = useState<'auths' | 'templates' | 'timeline'>('auths')
  const [showTemplateExport, setShowTemplateExport] = useState(false)
  const [templateImportJson, setTemplateImportJson] = useState('')
  const [importResultMsg, setImportResultMsg] = useState<string | null>(null)

  const currentUser = role === 'admin' ? 'admin' : 'inspector_zhangsan'

  useEffect(() => {
    fetchAuthorizations()
    fetchTemplates()
    fetchTimeline()
    fetchBatches(role || undefined)
  }, [fetchAuthorizations, fetchTemplates, fetchTimeline, fetchBatches, role])

  const selectedAuth = useMemo(() => {
    if (!selectedAuthId) return null
    return authorizations.find(a => a.id === selectedAuthId)
      || revokedAuthorizations.find(a => a.id === selectedAuthId)
  }, [selectedAuthId, authorizations, revokedAuthorizations])

  const selectedBatch = useMemo(() => {
    if (!selectedAuth) return null
    return batches.find(b => b.id === selectedAuth.batchId)
  }, [selectedAuth, batches])

  const filteredAuths = useMemo(() => {
    let result = [...authorizations, ...revokedAuthorizations]
    if (statusFilter === 'active') {
      result = result.filter(a => !a.isRevoked && !isExpired(a))
    } else if (statusFilter === 'expired') {
      result = result.filter(a => !a.isRevoked && isExpired(a))
    } else if (statusFilter === 'revoked') {
      result = result.filter(a => a.isRevoked)
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(a => {
        const allNames = [...a.viewers, ...a.rollbackers, ...a.handoverPersons]
          .map(p => (p.displayName || p.username).toLowerCase())
        return allNames.some(n => n.includes(q))
          || a.notes.toLowerCase().includes(q)
          || a.createdBy.toLowerCase().includes(q)
      })
    }
    return result.sort((a, b) => b.createdAt - a.createdAt)
  }, [authorizations, revokedAuthorizations, statusFilter, searchQuery])

  const getBatchForAuth = (auth: BatchAuthorization): ImportBatch | undefined => {
    return batches.find(b => b.id === auth.batchId)
  }

  const getAuthStatus = (auth: BatchAuthorization) => {
    if (auth.isRevoked) return { label: '已撤销', color: 'text-red-600', bg: 'bg-red-50', icon: XCircle }
    if (isExpired(auth)) return { label: '已过期', color: 'text-gray-600', bg: 'bg-gray-50', icon: Clock }
    return { label: '生效中', color: 'text-green-600', bg: 'bg-green-50', icon: CheckCircle }
  }

  const handleCreateAuthForBatch = (batchId?: string) => {
    setConfigMode('create')
    setConfigBatchId(batchId)
    setShowConfigModal(true)
  }

  const handleEditAuth = (auth: BatchAuthorization) => {
    setConfigMode('edit')
    setConfigBatchId(auth.batchId)
    setSelectedAuthId(auth.id)
    setShowConfigModal(true)
  }

  const handleConfigConfirm = async (result: any) => {
    try {
      if (configMode === 'create' && configBatchId) {
        await createAuthorization({
          batchId: configBatchId,
          viewerUsernames: result.viewerUsernames,
          rollbackerUsernames: result.rollbackerUsernames,
          handoverUsernames: result.handoverUsernames,
          expiresAt: result.expiresAt,
          notes: result.notes,
          createdBy: currentUser,
        })
        addToast('授权创建成功', 'success')
      } else if (configMode === 'edit' && selectedAuth) {
        await updateAuthorization(selectedAuth.id, {
          viewerUsernames: result.viewerUsernames,
          rollbackerUsernames: result.rollbackerUsernames,
          handoverUsernames: result.handoverUsernames,
          expiresAt: result.expiresAt,
          notes: result.notes,
          updatedBy: currentUser,
        })
        addToast('授权更新成功', 'success')
      }
      setShowConfigModal(false)
      fetchAuthorizations()
    } catch (err) {
      addToast(err instanceof Error ? err.message : '操作失败', 'error')
    }
  }

  const handleRevoke = async () => {
    if (!selectedAuthId) return
    try {
      await revokeAuthorization(selectedAuthId, currentUser, revokeReason || undefined)
      addToast('授权已撤销', 'success')
      setShowRevokeModal(false)
      setRevokeReason('')
      fetchAuthorizations()
    } catch (err) {
      addToast(err instanceof Error ? err.message : '撤销失败', 'error')
    }
  }

  const handleRestore = async (authId: string) => {
    try {
      await restoreAuthorization(authId, currentUser)
      addToast('授权已恢复', 'success')
      fetchAuthorizations()
    } catch (err) {
      addToast(err instanceof Error ? err.message : '恢复失败', 'error')
    }
  }

  const handleHandover = async () => {
    if (!selectedAuthId || !handoverFrom || !handoverTo) return
    try {
      await useAuthorizationStore.getState().handoverBatch(
        selectedAuthId, handoverFrom, handoverTo, currentUser
      )
      addToast('批次交接成功', 'success')
      setShowHandoverModal(false)
      setHandoverFrom('')
      setHandoverTo('')
      fetchAuthorizations()
    } catch (err) {
      addToast(err instanceof Error ? err.message : '交接失败', 'error')
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
      addToast('模板导出成功', 'success')
    } catch (err) {
      addToast(err instanceof Error ? err.message : '导出失败', 'error')
    }
  }

  const handleImportTemplate = async () => {
    if (!templateImportJson.trim()) return
    try {
      const result = await importTemplate(templateImportJson, currentUser)
      if (result.success) {
        setImportResultMsg(`导入成功${result.conflicts.length > 0 ? `，${result.conflicts.length} 项冲突提示` : ''}`)
        setTemplateImportJson('')
        fetchTemplates()
      } else {
        setImportResultMsg(`导入失败：${result.conflicts.map(c => c.message).join('；')}`)
      }
      setTimeout(() => setImportResultMsg(null), 4000)
    } catch (err) {
      setImportResultMsg(err instanceof Error ? err.message : '导入失败')
    }
  }

  const allAuthorizedBatches = useMemo(() => {
    const authBatchIds = new Set([...authorizations, ...revokedAuthorizations].map(a => a.batchId))
    return batches.filter(b => !authBatchIds.has(b.id) && b.status !== 'previewing')
  }, [batches, authorizations, revokedAuthorizations])

  if (view === 'detail' && selectedAuth) {
    const status = getAuthStatus(selectedAuth)
    const StatusIcon = status.icon
    return (
      <Layout
        title="授权详情"
        onBack={() => { setView('list'); setSelectedAuthId(null) }}
        showNav
        navRole={role || 'admin'}
      >
        <div className="p-4 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <button
              onClick={() => { setView('list'); setSelectedAuthId(null) }}
              className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
            >
              <ArrowLeft className="h-4 w-4" />
              返回列表
            </button>
          </div>

          <div className={cn('rounded-xl p-4 shadow-sm', status.bg)}>
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <StatusIcon className={cn('h-5 w-5', status.color)} />
                <div>
                  <h3 className="text-base font-semibold text-gray-900">
                    {selectedBatch?.batchName || '未知批次'}
                  </h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {status.label} · 创建于 {formatTime(selectedAuth.createdAt)}
                  </p>
                </div>
              </div>
              <span className={cn('text-xs px-2 py-1 rounded-full', status.bg, status.color)}>
                v{selectedAuth.configVersion}
              </span>
            </div>

            {selectedBatch && (
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-gray-500">批次 ID：</span>
                  <span className="font-mono text-gray-900">{selectedBatch.id}</span>
                </div>
                <div>
                  <span className="text-gray-500">目标：</span>
                  <span className="text-gray-900">{selectedBatch.targetEntity}</span>
                </div>
                <div>
                  <span className="text-gray-500">状态：</span>
                  <span className="text-gray-900">{selectedBatch.status}</span>
                </div>
                <div>
                  <span className="text-gray-500">创建人：</span>
                  <span className="text-gray-900">{selectedBatch.createdBy}</span>
                </div>
              </div>
            )}

            {selectedAuth.notes && (
              <div className="mt-3 p-2 bg-white/60 rounded">
                <p className="text-xs text-gray-500 mb-1">授权备注</p>
                <p className="text-sm text-gray-800">{selectedAuth.notes}</p>
              </div>
            )}

            {selectedAuth.expiresAt && (
              <div className="mt-2 text-xs">
                <span className="text-gray-500">失效时间：</span>
                <span className={cn(isExpired(selectedAuth) ? 'text-red-600' : 'text-gray-900')}>
                  {formatTime(selectedAuth.expiresAt)}
                </span>
              </div>
            )}

            {selectedAuth.isRevoked && (
              <div className="mt-2 text-xs text-red-700 bg-red-50 p-2 rounded">
                <span className="font-medium">已撤销：</span>
                {selectedAuth.revokeReason || '未说明原因'}
                （{selectedAuth.revokedBy} · {selectedAuth.revokedAt ? formatTime(selectedAuth.revokedAt) : ''}）
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl bg-white p-3 shadow-sm">
              <div className="flex items-center gap-1.5 mb-2">
                <Users className="h-4 w-4 text-blue-600" />
                <p className="text-sm font-medium text-gray-900">查看人</p>
              </div>
              <div className="space-y-1">
                {selectedAuth.viewers.length === 0 && <p className="text-xs text-gray-400">无</p>}
                {selectedAuth.viewers.map(p => (
                  <div key={p.username} className="text-xs">
                    <User className="h-3 w-3 inline mr-1 text-gray-400" />
                    {p.displayName || p.username}
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl bg-white p-3 shadow-sm">
              <div className="flex items-center gap-1.5 mb-2">
                <RotateCcw className="h-4 w-4 text-amber-600" />
                <p className="text-sm font-medium text-gray-900">回滚人</p>
              </div>
              <div className="space-y-1">
                {selectedAuth.rollbackers.length === 0 && <p className="text-xs text-gray-400">无</p>}
                {selectedAuth.rollbackers.map(p => (
                  <div key={p.username} className="text-xs">
                    <User className="h-3 w-3 inline mr-1 text-gray-400" />
                    {p.displayName || p.username}
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl bg-white p-3 shadow-sm">
              <div className="flex items-center gap-1.5 mb-2">
                <Handshake className="h-4 w-4 text-green-600" />
                <p className="text-sm font-medium text-gray-900">接手人</p>
              </div>
              <div className="space-y-1">
                {selectedAuth.handoverPersons.length === 0 && <p className="text-xs text-gray-400">无</p>}
                {selectedAuth.handoverPersons.map(p => (
                  <div key={p.username} className="text-xs">
                    <User className="h-3 w-3 inline mr-1 text-gray-400" />
                    {p.displayName || p.username}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-xl bg-white p-3 shadow-sm">
            <div className="flex items-center gap-1.5 mb-2">
              <FileText className="h-4 w-4 text-purple-600" />
              <p className="text-sm font-medium text-gray-900">
                配置历史快照（{selectedAuth.snapshots.length} 个版本）
              </p>
            </div>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {selectedAuth.snapshots.slice().reverse().map((snap, idx) => (
                <div key={snap.id} className="p-2 bg-gray-50 rounded border border-gray-100">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-gray-700">v{snap.configVersion}</span>
                    <span className="text-[10px] text-gray-400">{formatTime(snap.createdAt)}</span>
                  </div>
                  <p className="text-[11px] text-gray-500">
                    查看{snap.viewers.length}人 · 回滚{snap.rollbackers.length}人 · 接手{snap.handoverPersons.length}人
                    {snap.notes && ` · 有备注`}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl bg-white p-3 shadow-sm">
            <div className="flex items-center gap-1.5 mb-2">
              <History className="h-4 w-4 text-indigo-600" />
              <p className="text-sm font-medium text-gray-900">
                操作时间线（{selectedAuth.timeline.length} 条）
              </p>
            </div>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {selectedAuth.timeline.slice().reverse().map((entry) => {
                const cfg = actionLabels[entry.action] || { label: entry.action, color: 'text-gray-700', bg: 'bg-gray-100' }
                return (
                  <div key={entry.id} className="flex items-start gap-2 pb-2 border-b border-gray-100 last:border-0">
                    <span className={cn('text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 mt-0.5', cfg.bg, cfg.color)}>
                      {cfg.label}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-800">{entry.detail}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        {entry.actor} · {formatTime(entry.timestamp)}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="flex gap-2 pb-4">
            {!selectedAuth.isRevoked && !isExpired(selectedAuth) && role === 'admin' && (
              <>
                <button
                  onClick={() => handleEditAuth(selectedAuth)}
                  className="flex-1 h-10 rounded-lg text-sm font-medium bg-primary text-white hover:bg-primary/90 flex items-center justify-center gap-1.5"
                >
                  <Edit className="h-4 w-4" />
                  编辑授权
                </button>
                <button
                  onClick={() => { setShowHandoverModal(true); setSelectedAuthId(selectedAuth.id) }}
                  className="flex-1 h-10 rounded-lg text-sm font-medium bg-green-600 text-white hover:bg-green-700 flex items-center justify-center gap-1.5"
                >
                  <Handshake className="h-4 w-4" />
                  批次交接
                </button>
                <button
                  onClick={() => { setShowRevokeModal(true); setSelectedAuthId(selectedAuth.id) }}
                  className="flex-1 h-10 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700 flex items-center justify-center gap-1.5"
                >
                  <Ban className="h-4 w-4" />
                  撤销授权
                </button>
              </>
            )}
            {selectedAuth.isRevoked && role === 'admin' && (
              <button
                onClick={() => handleRestore(selectedAuth.id)}
                className="flex-1 h-10 rounded-lg text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 flex items-center justify-center gap-1.5"
              >
                <Undo className="h-4 w-4" />
                恢复授权
              </button>
            )}
          </div>
        </div>

        {showHandoverModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-md bg-white rounded-xl shadow-xl p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-semibold">批次交接</h3>
                <button onClick={() => setShowHandoverModal(false)} className="p-1 rounded hover:bg-gray-100">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">当前负责人</label>
                  <select
                    value={handoverFrom}
                    onChange={e => setHandoverFrom(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  >
                    <option value="">请选择</option>
                    {[...selectedAuth.viewers, ...selectedAuth.rollbackers, ...selectedAuth.handoverPersons]
                      .filter((p, i, arr) => arr.findIndex(x => x.username === p.username) === i)
                      .map(p => (
                        <option key={p.username} value={p.username}>
                          {p.displayName || p.username}
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">交接给</label>
                  <select
                    value={handoverTo}
                    onChange={e => setHandoverTo(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  >
                    <option value="">请选择</option>
                    {getSystemUsers().map(u => (
                      <option key={u.username} value={u.username}>{u.displayName}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => setShowHandoverModal(false)}
                  className="flex-1 h-10 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 text-sm"
                >
                  取消
                </button>
                <button
                  onClick={handleHandover}
                  disabled={!handoverFrom || !handoverTo}
                  className="flex-1 h-10 rounded-lg bg-green-600 text-white hover:bg-green-700 text-sm disabled:opacity-50"
                >
                  确认交接
                </button>
              </div>
            </div>
          </div>
        )}

        {showRevokeModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-md bg-white rounded-xl shadow-xl p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-semibold">撤销授权</h3>
                <button onClick={() => setShowRevokeModal(false)} className="p-1 rounded hover:bg-gray-100">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 mb-3">
                <div className="flex items-center gap-1.5 text-amber-800 text-sm font-medium mb-1">
                  <AlertTriangle className="h-4 w-4" />
                  撤销操作不可恢复
                </div>
                <p className="text-xs text-amber-700">
                  撤销后该批次所有授权立即失效，但历史快照和时间线仍保留供审计追溯。可通过"恢复授权"重新启用。
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">撤销原因</label>
                <textarea
                  value={revokeReason}
                  onChange={e => setRevokeReason(e.target.value)}
                  rows={3}
                  placeholder="请输入撤销原因（建议填写审批单号或说明）..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </div>
              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => setShowRevokeModal(false)}
                  className="flex-1 h-10 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 text-sm"
                >
                  取消
                </button>
                <button
                  onClick={handleRevoke}
                  className="flex-1 h-10 rounded-lg bg-red-600 text-white hover:bg-red-700 text-sm"
                >
                  确认撤销
                </button>
              </div>
            </div>
          </div>
        )}
      </Layout>
    )
  }

  return (
    <Layout
      title="批次授权台账"
      onBack={() => navigate(-1)}
      showNav
      navRole={role || 'admin'}
      rightAction={
        role === 'admin' ? (
          <button
            onClick={() => handleCreateAuthForBatch()}
            className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-white/10 active:bg-white/20 transition-colors"
            title="新建授权"
          >
            <Shield className="h-5 w-5" />
          </button>
        ) : null
      }
    >
      <div className="p-4 space-y-4">
        <div className="flex gap-1 p-1 bg-gray-100 rounded-lg">
          {([
            { key: 'auths', label: '授权台账', icon: Shield },
            { key: 'templates', label: '授权模板', icon: FileText },
            { key: 'timeline', label: '操作时间线', icon: History },
          ] as const).map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'flex-1 flex items-center justify-center gap-1 h-9 rounded-md text-xs font-medium transition-colors',
                activeTab === tab.key
                  ? 'bg-white text-primary shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              )}
            >
              <tab.icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'auths' && (
          <>
            <div className="flex items-center gap-2">
              <div className="flex-1 relative">
                <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="搜索授权人员或备注..."
                  className="w-full pl-9 pr-3 h-9 border border-gray-200 rounded-lg text-sm"
                />
              </div>
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value as any)}
                className="h-9 px-3 border border-gray-200 rounded-lg text-sm bg-white"
              >
                <option value="all">全部状态</option>
                <option value="active">生效中</option>
                <option value="expired">已过期</option>
                <option value="revoked">已撤销</option>
              </select>
            </div>

            {role === 'admin' && allAuthorizedBatches.length > 0 && (
              <div className="rounded-xl bg-amber-50 border border-amber-200 p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5 text-amber-800 text-sm font-medium">
                    <AlertTriangle className="h-4 w-4" />
                    以下批次尚未配置按人授权
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {allAuthorizedBatches.slice(0, 5).map(b => (
                    <button
                      key={b.id}
                      onClick={() => handleCreateAuthForBatch(b.id)}
                      className="px-2 py-1 text-xs bg-white border border-amber-300 text-amber-700 rounded hover:bg-amber-100"
                    >
                      {b.batchName.slice(0, 12)}...
                    </button>
                  ))}
                  {allAuthorizedBatches.length > 5 && (
                    <span className="px-2 py-1 text-xs text-amber-600">
                      等 {allAuthorizedBatches.length} 个
                    </span>
                  )}
                </div>
                <button
                  onClick={() => handleCreateAuthForBatch(allAuthorizedBatches[0]?.id)}
                  className="text-xs text-amber-700 hover:text-amber-900 underline"
                >
                  立即配置授权 →
                </button>
              </div>
            )}

            <div className="space-y-2" data-testid="auth-list">
              {filteredAuths.length === 0 ? (
                <div className="text-center py-12 text-gray-400 text-sm">
                  <Shield className="h-12 w-12 mx-auto mb-2 opacity-30" />
                  <p>暂无授权记录</p>
                  {role === 'admin' && (
                    <button
                      onClick={() => handleCreateAuthForBatch()}
                      className="mt-2 text-primary text-xs underline"
                    >
                      创建第一个授权
                    </button>
                  )}
                </div>
              ) : (
                filteredAuths.map(auth => {
                  const status = getAuthStatus(auth)
                  const StatusIcon = status.icon
                  const batch = getBatchForAuth(auth)
                  const isExpanded = expandedAuthId === auth.id
                  return (
                    <div key={auth.id} className="rounded-xl bg-white shadow-sm overflow-hidden">
                      <button
                        onClick={() => setExpandedAuthId(isExpanded ? null : auth.id)}
                        className="w-full p-3 text-left"
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <StatusIcon className={cn('h-4 w-4 flex-shrink-0', status.color)} />
                              <span className={cn('text-xs font-medium', status.color)}>{status.label}</span>
                              <span className="text-xs text-gray-400 font-mono">v{auth.configVersion}</span>
                              <span className="text-xs text-gray-400">{formatTime(auth.createdAt)}</span>
                            </div>
                            <p className="text-sm font-medium text-gray-900 mb-0.5 truncate">
                              {batch?.batchName || `批次 ${auth.batchId.slice(-8)}`}
                            </p>
                            <p className="text-xs text-gray-500">
                              创建人：{auth.createdBy} · 查看{auth.viewers.length} / 回滚{auth.rollbackers.length} / 接手{auth.handoverPersons.length}
                            </p>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                            <button
                              onClick={(e) => { e.stopPropagation(); setView('detail'); setSelectedAuthId(auth.id) }}
                              className="p-1.5 rounded hover:bg-gray-100 text-gray-600"
                              title="查看详情"
                            >
                              <Eye className="h-4 w-4" />
                            </button>
                            {role === 'admin' && !auth.isRevoked && (
                              <button
                                onClick={(e) => { e.stopPropagation(); handleEditAuth(auth) }}
                                className="p-1.5 rounded hover:bg-gray-100 text-gray-600"
                                title="编辑授权"
                              >
                                <Edit className="h-4 w-4" />
                              </button>
                            )}
                            {isExpanded ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
                          </div>
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="border-t border-gray-100 px-3 py-2 bg-gray-50 text-xs space-y-2">
                          {auth.viewers.length > 0 && (
                            <div>
                              <span className="text-gray-500">查看人：</span>
                              {auth.viewers.map(p => p.displayName || p.username).join('、')}
                            </div>
                          )}
                          {auth.rollbackers.length > 0 && (
                            <div>
                              <span className="text-gray-500">回滚人：</span>
                              {auth.rollbackers.map(p => p.displayName || p.username).join('、')}
                            </div>
                          )}
                          {auth.handoverPersons.length > 0 && (
                            <div>
                              <span className="text-gray-500">接手人：</span>
                              {auth.handoverPersons.map(p => p.displayName || p.username).join('、')}
                            </div>
                          )}
                          {auth.expiresAt && (
                            <div>
                              <span className="text-gray-500">失效时间：</span>
                              <span className={isExpired(auth) ? 'text-red-600' : ''}>
                                {formatTime(auth.expiresAt)}
                              </span>
                            </div>
                          )}
                          {auth.notes && (
                            <div>
                              <span className="text-gray-500">备注：</span>
                              {auth.notes}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </>
        )}

        {activeTab === 'templates' && (
          <div className="space-y-3">
            <div className="rounded-xl bg-blue-50 border border-blue-200 p-3">
              <p className="text-xs font-medium text-blue-900 mb-2">授权模板管理</p>
              <div className="flex gap-2 mb-2">
                <button
                  onClick={() => setShowTemplateExport(!showTemplateExport)}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-white border border-blue-300 text-blue-700 rounded hover:bg-blue-100"
                >
                  <Download className="h-3.5 w-3.5" />
                  {showTemplateExport ? '收起' : '导入/导出模板'}
                </button>
                <button
                  onClick={() => fetchTemplates()}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-white border border-blue-300 text-blue-700 rounded hover:bg-blue-100"
                >
                  <RefreshCcw className="h-3.5 w-3.5" />
                  刷新
                </button>
              </div>

              {showTemplateExport && (
                <div className="space-y-2 pt-2 border-t border-blue-200">
                  <div>
                    <p className="text-[11px] text-blue-800 mb-1">导入模板 JSON</p>
                    <div className="flex gap-2">
                      <textarea
                        value={templateImportJson}
                        onChange={e => setTemplateImportJson(e.target.value)}
                        placeholder="粘贴模板 JSON 内容..."
                        rows={2}
                        className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded font-mono bg-white"
                      />
                      <button
                        onClick={handleImportTemplate}
                        className="px-3 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 flex items-center gap-1"
                      >
                        <Upload className="h-3 w-3" />
                        导入
                      </button>
                    </div>
                    {importResultMsg && (
                      <p className={cn(
                        'text-[11px] mt-1',
                        importResultMsg.includes('成功') ? 'text-green-700' : 'text-red-700'
                      )}>
                        {importResultMsg}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>

            {templates.length === 0 ? (
              <div className="text-center py-12 text-gray-400 text-sm">
                <FileText className="h-12 w-12 mx-auto mb-2 opacity-30" />
                <p>暂无授权模板</p>
              </div>
            ) : (
              <div className="space-y-2">
                {templates.map(tpl => (
                  <div key={tpl.id} className="rounded-xl bg-white p-3 shadow-sm">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{tpl.name}</p>
                        <p className="text-[11px] text-gray-500 mt-0.5">
                          v{tpl.version} · 创建于 {formatTime(tpl.createdAt)} · {tpl.createdBy}
                        </p>
                      </div>
                      <button
                        onClick={() => handleExportTemplate(tpl.id)}
                        className="p-1.5 rounded hover:bg-gray-100 text-gray-600"
                      >
                        <Download className="h-4 w-4" />
                      </button>
                    </div>
                    {tpl.description && <p className="text-xs text-gray-600 mb-2">{tpl.description}</p>}
                    <div className="flex flex-wrap gap-1.5 text-[11px]">
                      {tpl.viewers.length > 0 && (
                        <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded">
                          查看{tpl.viewers.length}人
                        </span>
                      )}
                      {tpl.rollbackers.length > 0 && (
                        <span className="px-1.5 py-0.5 bg-amber-50 text-amber-700 rounded">
                          回滚{tpl.rollbackers.length}人
                        </span>
                      )}
                      {tpl.handoverPersons.length > 0 && (
                        <span className="px-1.5 py-0.5 bg-green-50 text-green-700 rounded">
                          接手{tpl.handoverPersons.length}人
                        </span>
                      )}
                      {tpl.defaultExpiryHours && (
                        <span className="px-1.5 py-0.5 bg-purple-50 text-purple-700 rounded">
                          {tpl.defaultExpiryHours}h后失效
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'timeline' && (
          <div className="rounded-xl bg-white shadow-sm p-3">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-medium text-gray-900">全局操作时间线</p>
              <button
                onClick={() => fetchTimeline()}
                className="p-1 rounded hover:bg-gray-100 text-gray-600"
              >
                <RefreshCcw className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-2 max-h-[60vh] overflow-y-auto">
              {timeline.length === 0 ? (
                <p className="text-center py-8 text-gray-400 text-sm">暂无操作记录</p>
              ) : (
                timeline.map((entry) => {
                  const cfg = actionLabels[entry.action] || { label: entry.action, color: 'text-gray-700', bg: 'bg-gray-100' }
                  return (
                    <div key={entry.id} className="flex items-start gap-2 pb-2 border-b border-gray-100 last:border-0">
                      <span className={cn('text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 mt-0.5', cfg.bg, cfg.color)}>
                        {cfg.label}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-gray-800">{entry.detail}</p>
                        <p className="text-[10px] text-gray-400 mt-0.5">
                          {entry.actor} · {formatTime(entry.timestamp)}
                          {entry.batchId && <span className="ml-2 font-mono">批次: ...{entry.batchId.slice(-6)}</span>}
                        </p>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        )}
      </div>

      {showConfigModal && (
        <AuthorizationConfigModal
          open={showConfigModal}
          onClose={() => setShowConfigModal(false)}
          onConfirm={handleConfigConfirm}
          batchId={configBatchId}
          mode={configMode}
          existingAuth={selectedAuthId ? (authorizations.find(a => a.id === selectedAuthId) || revokedAuthorizations.find(a => a.id === selectedAuthId)) : null}
          createdBy={currentUser}
        />
      )}
    </Layout>
  )
}
