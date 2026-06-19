import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Upload,
  FileJson,
  FileSpreadsheet,
  Play,
  RotateCcw,
  Eye,
  CheckCircle,
  AlertCircle,
  Clock,
  X,
  ChevronDown,
  ChevronUp,
  ArrowLeft,
  Settings,
  SkipForward,
  AlertTriangle,
  CheckSquare,
  History,
  RefreshCcw,
  Download,
  Shield,
  User,
  Zap,
  Filter,
  Search,
  Lock,
  Unlock,
} from 'lucide-react'
import Layout from '@/components/Layout'
import EmptyState from '@/components/EmptyState'
import AuthorizationConfigModal, { type AuthorizationConfigResult } from '@/components/AuthorizationConfigModal'
import { useAppStore } from '@/stores/useAppStore'
import {
  useImportStore,
  targetEntityConfig,
} from '@/stores/useImportStore'
import { useAuthorizationStore } from '@/stores/useAuthorizationStore'
import type {
  ImportBatch,
  ImportBatchStatus,
  ImportConflictAction,
  ImportPreviewRecord,
  ImportTargetEntity,
  DesensitizedBatchSummary,
} from '@/types'
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

const statusConfig: Record<ImportBatchStatus, { label: string; color: string; icon: typeof Clock; bg: string }> = {
  previewing: { label: '预演中', color: 'text-blue-600', icon: Clock, bg: 'bg-blue-50' },
  previewed: { label: '待确认', color: 'text-amber-600', icon: AlertCircle, bg: 'bg-amber-50' },
  pending_confirmation: { label: '待导入', color: 'text-amber-600', icon: Clock, bg: 'bg-amber-50' },
  importing: { label: '导入中', color: 'text-blue-600', icon: Play, bg: 'bg-blue-50' },
  success: { label: '成功', color: 'text-green-600', icon: CheckCircle, bg: 'bg-green-50' },
  failed: { label: '失败', color: 'text-red-600', icon: AlertCircle, bg: 'bg-red-50' },
  partial_success: { label: '部分成功', color: 'text-amber-600', icon: AlertTriangle, bg: 'bg-amber-50' },
  rolled_back: { label: '已回滚', color: 'text-gray-600', icon: RotateCcw, bg: 'bg-gray-50' },
  rolling_back: { label: '回滚中', color: 'text-purple-600', icon: RefreshCcw, bg: 'bg-purple-50' },
  interrupted: { label: '已中断', color: 'text-amber-600', icon: AlertTriangle, bg: 'bg-amber-50' },
}

const issueTypeLabels: Record<string, string> = {
  missing_required_field: '缺少必填字段',
  invalid_type: '类型错误',
  duplicate_key: '主键重复',
  will_overwrite: '将覆盖旧记录',
  dirty_data: '脏数据',
  unknown_field: '未知字段',
  value_out_of_range: '值超出范围',
  reference_not_found: '引用不存在',
}

const actionLabels: Record<ImportConflictAction, string> = {
  skip: '跳过',
  overwrite: '覆盖',
  pending: '待处理',
}

const actionColors: Record<ImportConflictAction, string> = {
  skip: 'bg-gray-100 text-gray-700',
  overwrite: 'bg-green-100 text-green-700',
  pending: 'bg-amber-100 text-amber-700',
}

function DesensitizedBatchCard({
  summary,
}: {
  summary: DesensitizedBatchSummary
}) {
  const status = statusConfig[summary.status as ImportBatchStatus] || statusConfig.previewing
  const StatusIcon = status.icon

  return (
    <div
      data-testid="desensitized-batch-card"
      className="rounded-lg border border-gray-200 p-3 mb-2 bg-gray-50"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <StatusIcon className={cn('h-4 w-4 flex-shrink-0 opacity-60', status.color)} />
            <span className={cn('text-xs font-medium opacity-60', status.color)}>{status.label}</span>
            <span className="text-xs text-gray-400 font-mono">
              {formatTime(summary.createdAt)}
            </span>
            <Lock className="h-3 w-3 text-gray-400" />
          </div>
          <p className="text-sm font-medium text-gray-500 mb-1 truncate font-mono">
            {summary.batchName}
          </p>
          <p className="text-xs text-gray-400 mb-1">
            <span className="text-gray-400">操作人：</span>
            {summary.createdBy}
          </p>
          <p className="text-xs text-gray-400 mb-1">
            <span className="text-gray-400">目标：</span>
            {targetEntityConfig[summary.targetEntity as ImportTargetEntity]?.label || summary.targetEntity}
          </p>
          {summary.totalRecords > 0 && (
            <div className="mt-2 flex gap-4 text-[11px] text-gray-400">
              <span>共 {summary.totalRecords} 条</span>
            </div>
          )}
          <div className="mt-2 text-[11px] text-amber-600 bg-amber-50 rounded px-2 py-1 flex items-center gap-1">
            <Shield className="h-3 w-3" />
            {summary.authHint}
          </div>
        </div>
        <div className="flex flex-col gap-1 flex-shrink-0">
          <span className="flex items-center gap-1 text-xs text-gray-400 cursor-not-allowed">
            <Lock className="h-3.5 w-3.5" />
            无权限
          </span>
        </div>
      </div>
    </div>
  )
}

function BatchCard({
  batch,
  onView,
  onRollback,
  onExport,
  canRollback,
  canExport,
}: {
  batch: ImportBatch
  onView: (b: ImportBatch) => void
  onRollback: (b: ImportBatch) => void
  onExport?: (b: ImportBatch) => void
  canRollback: boolean
  canExport: boolean
}) {
  const status = statusConfig[batch.status] || statusConfig.previewing
  const StatusIcon = status.icon
  const authStore = useAuthorizationStore.getState()
  const auth = authStore.getAuthorizationByBatchId(batch.id)
  const hasAuth = !!auth && !auth.isRevoked

  return (
    <div
      data-testid="import-batch-card"
      className={cn(
        'rounded-lg border border-gray-200 p-3 mb-2',
        batch.status === 'importing' && 'bg-blue-50',
        batch.status === 'success' && 'bg-white',
        batch.status === 'failed' && 'bg-white',
        batch.status === 'rolling_back' && 'bg-purple-50'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <StatusIcon className={cn('h-4 w-4 flex-shrink-0', status.color)} />
            <span className={cn('text-xs font-medium', status.color)}>{status.label}</span>
            <span className="text-xs text-gray-400 font-mono">
              {formatTime(batch.createdAt)}
            </span>
            {hasAuth ? (
              <span className="flex items-center gap-0.5 text-[10px] text-green-600 bg-green-50 px-1.5 py-0.5 rounded">
                <Unlock className="h-2.5 w-2.5" />
                已授权 v{auth?.configVersion}
              </span>
            ) : (
              <span className="flex items-center gap-0.5 text-[10px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                <Lock className="h-2.5 w-2.5" />
                角色级
              </span>
            )}
          </div>
          <p className="text-sm font-medium text-gray-900 mb-1 truncate">
            {batch.batchName}
          </p>
          <p className="text-xs text-gray-600 mb-1">
            <span className="text-gray-500">源文件：</span>
            {batch.sourceFileName}
          </p>
          <p className="text-xs text-gray-600 mb-1">
            <span className="text-gray-500">操作人：</span>
            {batch.createdBy}
          </p>
          <p className="text-xs text-gray-600 mb-1">
            <span className="text-gray-500">目标：</span>
            {targetEntityConfig[batch.targetEntity]?.label || batch.targetEntity}
          </p>

          {batch.totalRecords > 0 && (
            <div className="mt-2 flex gap-4 text-[11px] text-gray-500">
              <span>共 {batch.totalRecords} 条</span>
              <span className="text-green-600">成功 {batch.successRecords}</span>
              <span className="text-red-600">失败 {batch.failedRecords}</span>
              <span className="text-gray-500">跳过 {batch.skippedRecords}</span>
            </div>
          )}

          {(batch.status === 'importing' || batch.status === 'rolling_back') && (
            <div className="mt-2">
              <div className="flex items-center justify-between text-[11px] text-gray-500 mb-1">
                <span>{batch.status === 'importing' ? '导入进度' : '回滚进度'}</span>
                <span>{batch.progress}%</span>
              </div>
              <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className={cn(
                    'h-full rounded-full transition-all duration-300',
                    batch.status === 'importing' ? 'bg-blue-500' : 'bg-purple-500'
                  )}
                  style={{ width: `${batch.progress}%` }}
                />
              </div>
            </div>
          )}

          {batch.errorMessage && (batch.status === 'failed' || batch.status === 'interrupted') && (
            <p className="mt-2 text-xs text-red-600 bg-red-50 rounded px-2 py-1">
              {batch.errorMessage}
            </p>
          )}

          {batch.rollbackInfo && (
            <div className="mt-2 text-[11px] text-gray-500 bg-gray-50 rounded px-2 py-1">
              <span className="flex items-center gap-1">
                <RotateCcw className="h-3 w-3" />
                已于 {formatTime(batch.rollbackInfo.rolledBackAt)} 由 {batch.rollbackInfo.rolledBackBy} 回滚
                （{batch.rollbackInfo.successCount} 条成功）
              </span>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1 flex-shrink-0">
          <button
            onClick={() => onView(batch)}
            className="flex items-center gap-1 text-xs text-primary hover:text-primary/80"
            data-testid="view-batch-button"
          >
            <Eye className="h-3.5 w-3.5" />
            详情
          </button>
          {canExport && onExport && (
            <button
              onClick={() => onExport(batch)}
              className="flex items-center gap-1 text-xs text-green-600 hover:text-green-700"
              data-testid="export-batch-button"
            >
              <Download className="h-3.5 w-3.5" />
              导出
            </button>
          )}
          {(batch.status === 'success' || batch.status === 'partial_success') && canRollback && (
            <button
              onClick={() => onRollback(batch)}
              className="flex items-center gap-1 text-xs text-amber-600 hover:text-amber-700"
              data-testid="rollback-button"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              回滚
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function PreviewTable({
  records,
  fieldMapping,
  primaryKeyField,
  recordActions,
  onActionChange,
  filter,
}: {
  records: ImportPreviewRecord[]
  fieldMapping: { sourceField: string; targetField: string }[]
  primaryKeyField: string
  recordActions: Record<number, ImportConflictAction>
  onActionChange: (index: number, action: ImportConflictAction) => void
  filter: 'all' | 'error' | 'warning' | 'conflict'
}) {
  const [page, setPage] = useState(0)
  const pageSize = 20

  const filteredRecords = useMemo(() => {
    switch (filter) {
      case 'error':
        return records.filter(r => r.status === 'error')
      case 'warning':
        return records.filter(r => r.status === 'warning' || r.status === 'error')
      case 'conflict':
        return records.filter(r => r.conflictType !== null && r.conflictType !== undefined)
      default:
        return records
    }
  }, [records, filter])

  const totalPages = Math.ceil(filteredRecords.length / pageSize)
  const pageRecords = filteredRecords.slice(page * pageSize, (page + 1) * pageSize)

  const displayFields = fieldMapping.slice(0, 6)

  return (
    <div>
      <div className="text-xs text-gray-500 mb-2">
        共 {filteredRecords.length} 条记录，当前显示第 {page * pageSize + 1}-{Math.min((page + 1) * pageSize, filteredRecords.length)} 条
      </div>
      <div className="overflow-x-auto border border-gray-200 rounded-lg">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              <th className="px-2 py-2 text-left text-gray-600 font-medium w-12">行号</th>
              <th className="px-2 py-2 text-left text-gray-600 font-medium w-20">状态</th>
              {displayFields.map(f => (
                <th key={f.targetField} className="px-2 py-2 text-left text-gray-600 font-medium truncate max-w-[120px]">
                  {f.targetField}
                  {f.targetField === primaryKeyField && (
                    <span className="ml-1 text-[10px] text-primary">*</span>
                  )}
                </th>
              ))}
              <th className="px-2 py-2 text-left text-gray-600 font-medium w-28">操作</th>
            </tr>
          </thead>
          <tbody>
            {pageRecords.map((record) => (
              <tr
                key={record.index}
                className={cn(
                  'border-t border-gray-100',
                  record.status === 'error' && 'bg-red-50',
                  record.status === 'warning' && 'bg-amber-50',
                  record.conflictType && 'bg-amber-50/50'
                )}
              >
                <td className="px-2 py-2 text-gray-400 font-mono">{record.index + 1}</td>
                <td className="px-2 py-2">
                  {record.status === 'error' && <AlertCircle className="h-4 w-4 text-red-500" />}
                  {record.status === 'warning' && <AlertTriangle className="h-4 w-4 text-amber-500" />}
                  {record.status === 'valid' && <CheckCircle className="h-4 w-4 text-green-500" />}
                </td>
                {displayFields.map(f => (
                  <td key={f.targetField} className="px-2 py-2 text-gray-700 truncate max-w-[120px]">
                    {String(record.mappedData[f.targetField] ?? '—')}
                  </td>
                ))}
                <td className="px-2 py-2">
                  <select
                    value={recordActions[record.index] || record.action}
                    onChange={(e) => onActionChange(record.index, e.target.value as ImportConflictAction)}
                    disabled={record.status === 'error'}
                    className={cn(
                      'text-xs px-1.5 py-0.5 rounded border',
                      record.status === 'error' && 'opacity-50 cursor-not-allowed',
                      actionColors[recordActions[record.index] || record.action]
                    )}
                    data-testid={`record-action-${record.index}`}
                  >
                    <option value="skip">跳过</option>
                    <option value="overwrite">覆盖</option>
                    <option value="pending">待处理</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-3">
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-2 py-1 text-xs bg-gray-100 rounded disabled:opacity-50"
          >
            上一页
          </button>
          <span className="text-xs text-gray-500">
            {page + 1} / {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="px-2 py-1 text-xs bg-gray-100 rounded disabled:opacity-50"
          >
            下一页
          </button>
        </div>
      )}
    </div>
  )
}

function BatchDetailModal({
  batch,
  onClose,
  onRollback,
  canRollback,
}: {
  batch: ImportBatch
  onClose: () => void
  onRollback: () => void
  canRollback: boolean
}) {
  const [logExpanded, setLogExpanded] = useState(false)
  const [rollbackLogExpanded, setRollbackLogExpanded] = useState(false)
  const [snapshotExpanded, setSnapshotExpanded] = useState(false)

  const status = statusConfig[batch.status] || statusConfig.previewing

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog">
      <div className="w-full max-w-lg max-h-[85vh] overflow-y-auto bg-white rounded-xl shadow-xl">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between z-10">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-gray-900">导入批次详情</h3>
            <span className={cn(
              'text-xs px-2 py-0.5 rounded-full',
              status.bg,
              status.color
            )}>
              {status.label}
            </span>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 text-gray-500">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="rounded-lg bg-gray-50 p-3">
            <p className="text-sm font-medium text-gray-900 mb-2">基本信息</p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-gray-500">批次名称：</span>
                <span className="text-gray-900">{batch.batchName}</span>
              </div>
              <div>
                <span className="text-gray-500">创建时间：</span>
                <span className="text-gray-900">{formatTime(batch.createdAt)}</span>
              </div>
              <div>
                <span className="text-gray-500">操作人：</span>
                <span className="text-gray-900">{batch.createdBy}</span>
              </div>
              <div>
                <span className="text-gray-500">目标表：</span>
                <span className="text-gray-900">
                  {targetEntityConfig[batch.targetEntity]?.label || batch.targetEntity}
                </span>
              </div>
              <div>
                <span className="text-gray-500">源文件：</span>
                <span className="text-gray-900 font-mono truncate">{batch.sourceFileName}</span>
              </div>
              <div>
                <span className="text-gray-500">文件类型：</span>
                <span className="text-gray-900">{batch.sourceFileType.toUpperCase()}</span>
              </div>
              {batch.startedAt && (
                <div>
                  <span className="text-gray-500">开始时间：</span>
                  <span className="text-gray-900">{formatTime(batch.startedAt)}</span>
                </div>
              )}
              {batch.completedAt && (
                <div>
                  <span className="text-gray-500">完成时间：</span>
                  <span className="text-gray-900">{formatTime(batch.completedAt)}</span>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-lg bg-blue-50 border border-blue-200 p-3">
            <p className="text-sm font-medium text-blue-900 mb-2">统计信息</p>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="text-center">
                <p className="text-lg font-semibold text-gray-900">{batch.totalRecords}</p>
                <p className="text-gray-500">总记录</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-semibold text-green-600">{batch.successRecords}</p>
                <p className="text-gray-500">成功</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-semibold text-red-600">{batch.failedRecords}</p>
                <p className="text-gray-500">失败</p>
              </div>
            </div>
          </div>

          {batch.rollbackInfo && (
            <div className="rounded-lg bg-gray-50 border border-gray-200 p-3">
              <p className="text-sm font-medium text-gray-900 mb-2 flex items-center gap-1.5">
                <RotateCcw className="h-4 w-4" />
                回滚信息
              </p>
              <div className="space-y-1 text-xs">
                <div>
                  <span className="text-gray-500">回滚时间：</span>
                  <span className="text-gray-900">{formatTime(batch.rollbackInfo.rolledBackAt)}</span>
                </div>
                <div>
                  <span className="text-gray-500">回滚人：</span>
                  <span className="text-gray-900">{batch.rollbackInfo.rolledBackBy}</span>
                </div>
                <div>
                  <span className="text-gray-500">回滚记录数：</span>
                  <span className="text-gray-900">{batch.rollbackInfo.recordCount} 条</span>
                </div>
                <div>
                  <span className="text-gray-500">回滚成功：</span>
                  <span className="text-green-600">{batch.rollbackInfo.successCount} 条</span>
                </div>
                {batch.rollbackInfo.reason && (
                  <div>
                    <span className="text-gray-500">回滚原因：</span>
                    <span className="text-gray-900">{batch.rollbackInfo.reason}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {batch.previewResult && (
            <div>
              <button
                onClick={() => setSnapshotExpanded(!snapshotExpanded)}
                className="w-full flex items-center justify-between rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
              >
                <span className="flex items-center gap-1.5">
                  <Settings className="h-4 w-4" />
                  字段映射与配置
                </span>
                {snapshotExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
              {snapshotExpanded && (
                <div className="mt-2 rounded-lg border border-gray-200 p-3 max-h-48 overflow-y-auto">
                  <p className="text-xs font-medium text-gray-700 mb-2">字段映射：</p>
                  <div className="space-y-1">
                    {batch.previewResult.fieldMapping.map((m, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <span className="bg-gray-100 px-1.5 py-0.5 rounded text-gray-600 font-mono">
                          {m.sourceField}
                        </span>
                        <span className="text-gray-400">→</span>
                        <span className="bg-blue-100 px-1.5 py-0.5 rounded text-blue-700 font-mono">
                          {m.targetField}
                        </span>
                        {m.isAutoMapped && (
                          <span className="text-[10px] text-green-600">自动</span>
                        )}
                      </div>
                    ))}
                  </div>
                  {batch.previewResult.unmappedSourceFields.length > 0 && (
                    <div className="mt-3">
                      <p className="text-xs font-medium text-amber-700 mb-1">
                        未映射的源字段（{batch.previewResult.unmappedSourceFields.length}）：
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {batch.previewResult.unmappedSourceFields.map((f, i) => (
                          <span key={i} className="text-[10px] bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded">
                            {f}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {batch.previewResult.missingRequiredFields.length > 0 && (
                    <div className="mt-3">
                      <p className="text-xs font-medium text-red-700 mb-1">
                        缺失的必填字段（{batch.previewResult.missingRequiredFields.length}）：
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {batch.previewResult.missingRequiredFields.map((f, i) => (
                          <span key={i} className="text-[10px] bg-red-50 text-red-700 px-1.5 py-0.5 rounded">
                            {targetEntityConfig[batch.targetEntity]?.fieldLabels[f] || f}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {batch.importLog && batch.importLog.length > 0 && (
            <div>
              <button
                onClick={() => setLogExpanded(!logExpanded)}
                className="w-full flex items-center justify-between rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
              >
                <span className="flex items-center gap-1.5">
                  <History className="h-4 w-4" />
                  导入日志（{batch.importLog.length} 条）
                </span>
                {logExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
              {logExpanded && (
                <div className="mt-2 rounded-lg border border-gray-200 max-h-48 overflow-y-auto">
                  {batch.importLog.map((log, idx) => (
                    <div
                      key={idx}
                      className={cn(
                        'flex items-start gap-2 px-3 py-2 border-b border-gray-100 last:border-0',
                        log.severity === 'error' && 'bg-red-50',
                        log.severity === 'warning' && 'bg-amber-50'
                      )}
                    >
                      <span className="flex-shrink-0 text-[10px] font-mono text-gray-400 w-6">
                        {idx + 1}.
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={cn(
                            'text-[10px] font-medium px-1.5 py-0.5 rounded',
                            log.severity === 'error' ? 'bg-red-100 text-red-700' :
                            log.severity === 'warning' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-700'
                          )}>
                            {log.step}
                          </span>
                          <span className="text-[10px] text-gray-400 font-mono">
                            {formatTime(log.timestamp)}
                          </span>
                        </div>
                        <p className="text-xs text-gray-600 mt-0.5">{log.message}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {batch.rollbackLog && batch.rollbackLog.length > 0 && (
            <div>
              <button
                onClick={() => setRollbackLogExpanded(!rollbackLogExpanded)}
                className="w-full flex items-center justify-between rounded-lg bg-purple-100 px-3 py-2 text-sm font-medium text-purple-700 hover:bg-purple-200"
              >
                <span className="flex items-center gap-1.5">
                  <RotateCcw className="h-4 w-4" />
                  回滚日志（{batch.rollbackLog.length} 条）
                </span>
                {rollbackLogExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
              {rollbackLogExpanded && (
                <div className="mt-2 rounded-lg border border-purple-200 max-h-48 overflow-y-auto">
                  {batch.rollbackLog.map((log, idx) => (
                    <div
                      key={idx}
                      className={cn(
                        'flex items-start gap-2 px-3 py-2 border-b border-purple-100 last:border-0',
                        log.severity === 'error' && 'bg-red-50',
                        log.severity === 'warning' && 'bg-amber-50'
                      )}
                    >
                      <span className="flex-shrink-0 text-[10px] font-mono text-gray-400 w-6">
                        {idx + 1}.
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={cn(
                            'text-[10px] font-medium px-1.5 py-0.5 rounded',
                            log.severity === 'error' ? 'bg-red-100 text-red-700' :
                            log.severity === 'warning' ? 'bg-amber-100 text-amber-700' : 'bg-purple-100 text-purple-700'
                          )}>
                            {log.step}
                          </span>
                          <span className="text-[10px] text-gray-400 font-mono">
                            {formatTime(log.timestamp)}
                          </span>
                        </div>
                        <p className="text-xs text-gray-600 mt-0.5">{log.message}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {batch.overwrittenRecordSnapshots && batch.overwrittenRecordSnapshots.length > 0 && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
              <p className="text-sm font-medium text-amber-900 mb-2 flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4" />
                覆盖记录数：{batch.overwrittenRecordSnapshots.length} 条
              </p>
              <p className="text-xs text-amber-700">
                这些记录在导入时已存在，被新数据覆盖。回滚时将恢复到导入前的状态。
              </p>
            </div>
          )}

          {(batch.status === 'success' || batch.status === 'partial_success') && canRollback && (
            <button
              onClick={onRollback}
              className="w-full flex items-center justify-center gap-2 rounded-lg h-10 text-sm font-medium bg-amber-500 text-white hover:bg-amber-600"
              data-testid="detail-rollback-button"
            >
              <RotateCcw className="h-4 w-4" />
              执行回滚
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function RollbackConfirmModal({
  batch,
  onConfirm,
  onCancel,
}: {
  batch: ImportBatch
  onConfirm: (reason: string) => void
  onCancel: () => void
}) {
  const [reason, setReason] = useState('')

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" role="dialog">
      <div className="w-full max-w-md bg-white rounded-xl shadow-xl">
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">确认回滚</h3>
          <button onClick={onCancel} className="p-1 rounded hover:bg-gray-100 text-gray-500">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-4 space-y-4">
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
            <p className="text-sm font-medium text-amber-900 mb-2 flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4" />
              回滚操作不可撤销
            </p>
            <p className="text-xs text-amber-700">
              将恢复 {batch.importedRecordIds?.length || 0} 条记录到导入前的状态，
              包括恢复被覆盖的记录和删除新导入的记录。
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              回滚原因（可选）
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="请输入回滚原因..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              rows={3}
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className="flex-1 h-10 rounded-lg text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200"
            >
              取消
            </button>
            <button
              onClick={() => onConfirm(reason)}
              className="flex-1 h-10 rounded-lg text-sm font-medium bg-amber-500 text-white hover:bg-amber-600"
              data-testid="confirm-rollback-button"
            >
              确认回滚
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function ImportCenter() {
  const navigate = useNavigate()
  const role = useAppStore((s) => s.role)
  const addToast = useAppStore((s) => s.addToast)

  const {
    batches,
    currentBatchId,
    currentPreview,
    importError,
    fetchBatches,
    createBatch,
    runPreview,
    confirmImport,
    executeImport,
    rollbackBatch,
    clearImportError,
    loadPersistedData,
    canViewBatch,
    canRollbackBatch,
    canExportBatch,
    setCurrentPreview,
  } = useImportStore()

  const {
    createAuthorization,
    fetchAuthorizations,
    getDesensitizedSummary,
    getAuthorizationByBatchId,
  } = useAuthorizationStore()

  const [view, setView] = useState<'list' | 'preview'>('list')
  const [targetEntity, setTargetEntity] = useState<ImportTargetEntity>('tasks')
  const [isUploading, setIsUploading] = useState(false)
  const [isPreviewing, setIsPreviewing] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [isRollingBack, setIsRollingBack] = useState(false)
  const [detailBatch, setDetailBatch] = useState<ImportBatch | null>(null)
  const [rollbackBatchId, setRollbackBatchId] = useState<string | null>(null)
  const [recordActions, setRecordActions] = useState<Record<number, ImportConflictAction>>({})
  const [conflictAction, setConflictAction] = useState<ImportConflictAction>('skip')
  const [previewFilter, setPreviewFilter] = useState<'all' | 'error' | 'warning' | 'conflict'>('all')
  const [statusFilter, setStatusFilter] = useState<ImportBatchStatus | 'all'>('all')

  const [authModalOpen, setAuthModalOpen] = useState(false)
  const [authModalBatchId, setAuthModalBatchId] = useState<string | null>(null)
  const [pendingAuthBatchId, setPendingAuthBatchId] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  const currentUsername = role === 'admin' ? 'admin' : 'inspector_zhangsan'
  const currentDisplayName = role === 'admin' ? '管理员' : '巡检员张三'

  useEffect(() => {
    fetchBatches(role || undefined)
    loadPersistedData()
    fetchAuthorizations()
  }, [fetchBatches, loadPersistedData, role, fetchAuthorizations])

  const { authorizedBatches, desensitizedBatches } = useMemo(() => {
    let filtered = batches
    if (statusFilter !== 'all') {
      filtered = filtered.filter(b => b.status === statusFilter)
    }
    const authorized: ImportBatch[] = []
    const desensitized: DesensitizedBatchSummary[] = []
    filtered.forEach(batch => {
      if (canViewBatch(batch, role, currentUsername)) {
        authorized.push(batch)
      } else {
        desensitized.push(getDesensitizedSummary(batch, currentUsername, role))
      }
    })
    return { authorizedBatches: authorized, desensitizedBatches: desensitized }
  }, [batches, statusFilter, role, canViewBatch, getDesensitizedSummary, currentUsername])

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const ext = file.name.split('.').pop()?.toLowerCase()
    if (ext !== 'csv' && ext !== 'json') {
      addToast('仅支持 CSV 和 JSON 文件', 'error')
      return
    }

    const fileType = ext as 'csv' | 'json'
    const permissionScope = role === 'admin' ? 'admin' : 'all'

    setIsUploading(true)
    try {
      const text = await file.text()
      const batchId = await createBatch(
        targetEntity,
        file.name,
        fileType,
        currentDisplayName,
        permissionScope
      )

      setIsPreviewing(true)
      const preview = await runPreview(batchId, text)

      const initialActions: Record<number, ImportConflictAction> = {}
      preview.records.forEach(r => {
        initialActions[r.index] = r.action
      })
      setRecordActions(initialActions)
      setConflictAction('skip')
      setView('preview')
      addToast('预演完成，请检查数据后确认导入', 'success')
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : '预演失败'
      addToast(`预演失败：${errorMsg}`, 'error')
    } finally {
      setIsUploading(false)
      setIsPreviewing(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const handleConfirmImport = async () => {
    if (!currentPreview) return

    try {
      await confirmImport(currentPreview.batchId, conflictAction, recordActions)
      setIsImporting(true)
      await executeImport(currentPreview.batchId)
      addToast('导入完成，请配置批次授权', 'success')
      setView('list')
      setCurrentPreview(null)
      setPendingAuthBatchId(currentPreview.batchId)
      setAuthModalBatchId(currentPreview.batchId)
      setAuthModalOpen(true)
      fetchBatches(role || undefined)
      fetchAuthorizations()
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : '导入失败'
      addToast(`导入失败：${errorMsg}`, 'error')
    } finally {
      setIsImporting(false)
    }
  }

  const handleAuthConfirm = async (result: AuthorizationConfigResult) => {
    if (!authModalBatchId) return
    try {
      const existingAuth = getAuthorizationByBatchId(authModalBatchId)
      if (existingAuth && !existingAuth.isRevoked) {
        addToast('该批次已配置授权', 'info')
      } else {
        await createAuthorization({
          batchId: authModalBatchId,
          viewerUsernames: result.viewerUsernames,
          rollbackerUsernames: result.rollbackerUsernames,
          handoverUsernames: result.handoverUsernames,
          expiresAt: result.expiresAt,
          notes: result.notes,
          createdBy: currentUsername,
        })
        addToast('授权配置已保存', 'success')
      }
      setAuthModalOpen(false)
      setAuthModalBatchId(null)
      setPendingAuthBatchId(null)
      fetchAuthorizations()
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : '授权配置失败'
      addToast(`授权配置失败：${errorMsg}`, 'error')
    }
  }

  const handleRollback = async (batch: ImportBatch) => {
    if (!canRollbackBatch(batch, role, currentUsername)) {
      addToast('您没有回滚该批次的权限', 'error')
      return
    }
    setRollbackBatchId(batch.id)
  }

  const handleConfirmRollback = async (reason: string) => {
    if (!rollbackBatchId) return

    setIsRollingBack(true)
    try {
      await rollbackBatch(rollbackBatchId, currentDisplayName, reason || undefined)
      addToast('回滚完成', 'success')
      setRollbackBatchId(null)
      setDetailBatch(null)
      fetchBatches(role || undefined)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : '回滚失败'
      addToast(`回滚失败：${errorMsg}`, 'error')
    } finally {
      setIsRollingBack(false)
    }
  }

  const handleRecordActionChange = (index: number, action: ImportConflictAction) => {
    setRecordActions(prev => ({ ...prev, [index]: action }))
  }

  const handleBulkAction = (action: ImportConflictAction) => {
    if (!currentPreview) return
    const updated: Record<number, ImportConflictAction> = {}
    currentPreview.records.forEach(r => {
      if (r.status !== 'error') {
        updated[r.index] = action
      }
    })
    setRecordActions(updated)
  }

  const handleViewDetail = (batch: ImportBatch) => {
    if (!canViewBatch(batch, role, currentUsername)) {
      addToast('您没有查看该批次详情的权限', 'error')
      return
    }
    setDetailBatch(batch)
  }

  const handleExportBatch = (batch: ImportBatch) => {
    if (!canExportBatch(batch, role, currentUsername)) {
      addToast('您没有导出该批次的权限', 'error')
      return
    }
    const exportData = {
      schemaVersion: 1,
      exportType: 'import_batch',
      exportedAt: Date.now(),
      exportedBy: currentUsername,
      batch,
    }
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `batch-${batch.id}-${Date.now()}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    addToast('批次数据已导出', 'success')
  }

  const handleBackToList = () => {
    setView('list')
    setCurrentPreview(null)
  }

  const currentBatch = currentPreview
    ? batches.find(b => b.id === currentPreview.batchId) || null
    : null

  const rollbackTargetBatch = rollbackBatchId
    ? batches.find(b => b.id === rollbackBatchId) || null
    : null

  return (
    <Layout
      title="导入预演与回滚中心"
      onBack={() => navigate(-1)}
      showNav
      navRole={role || 'admin'}
      rightAction={
        view === 'list' ? (
          <div className="flex items-center gap-1">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading || isPreviewing}
              className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-white/10 active:bg-white/20 transition-colors"
              title="新建导入"
              data-testid="new-import-button"
            >
              <Upload className={cn('h-5 w-5', isUploading && 'animate-pulse')} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.json,text/csv,application/json"
              className="hidden"
              onChange={handleFileSelect}
            />
          </div>
        ) : null
      }
    >
      {importError && (
        <div className="sticky top-0 z-30 bg-red-50 border-b border-red-200 px-4 py-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-800">操作出错</p>
                <p className="text-xs text-red-600 mt-0.5">{importError}</p>
              </div>
            </div>
            <button onClick={clearImportError} className="text-red-400 hover:text-red-600">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {view === 'list' && (
        <div className="p-4 space-y-4">
          <div className="rounded-xl bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <Upload className="h-5 w-5 text-primary" />
              <h3 className="text-base font-semibold text-gray-900">快速导入</h3>
            </div>
            <p className="text-xs text-gray-500 mb-4">
              上传 CSV 或 JSON 文件进行预演，确认无误后再正式导入
            </p>

            <div className="mb-3">
              <label className="block text-xs font-medium text-gray-600 mb-1.5">
                选择目标数据表
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(['tasks', 'templates', 'eventLogs', 'anomalies', 'submissions', 'drafts'] as ImportTargetEntity[]).map(entity => (
                  <button
                    key={entity}
                    onClick={() => setTargetEntity(entity)}
                    className={cn(
                      'rounded-lg border p-2 text-left transition-colors',
                      targetEntity === entity
                        ? 'border-primary bg-primary/5'
                        : 'border-gray-200 hover:border-gray-300'
                    )}
                  >
                    <p className={cn(
                      'text-xs font-medium',
                      targetEntity === entity ? 'text-primary' : 'text-gray-900'
                    )}>
                      {targetEntityConfig[entity]?.label || entity}
                    </p>
                    <p className="text-[10px] text-gray-500 mt-0.5">
                      主键: {targetEntityConfig[entity]?.primaryKey}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading || isPreviewing}
              className={cn(
                'w-full h-12 rounded-lg flex items-center justify-center gap-2 text-sm font-semibold transition-colors',
                isUploading || isPreviewing
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : 'bg-accent text-white hover:bg-amber-600 active:bg-amber-700'
              )}
              data-testid="upload-file-button"
            >
              {isPreviewing ? (
                <>
                  <Clock className="h-5 w-5 animate-pulse" />
                  预演中...
                </>
              ) : isUploading ? (
                <>
                  <Clock className="h-5 w-5 animate-pulse" />
                  上传中...
                </>
              ) : (
                <>
                  <Upload className="h-5 w-5" />
                  选择文件开始预演
                </>
              )}
            </button>
          </div>

          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">导入历史</h3>
            <div className="flex items-center gap-2">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as ImportBatchStatus | 'all')}
                className="text-xs px-2 py-1 border border-gray-200 rounded bg-white"
                data-testid="status-filter"
              >
                <option value="all">全部状态</option>
                <option value="success">成功</option>
                <option value="partial_success">部分成功</option>
                <option value="failed">失败</option>
                <option value="rolled_back">已回滚</option>
                <option value="importing">导入中</option>
                <option value="interrupted">已中断</option>
              </select>
              <button
                onClick={() => fetchBatches(role || undefined)}
                className="flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900"
              >
                <RefreshCcw className="h-3.5 w-3.5" />
                刷新
              </button>
            </div>
          </div>

          <div className="space-y-2" data-testid="batch-list">
            {authorizedBatches.length === 0 && desensitizedBatches.length === 0 ? (
              <EmptyState message="暂无导入批次记录" />
            ) : (
              <>
                {authorizedBatches.map(batch => (
                  <BatchCard
                    key={batch.id}
                    batch={batch}
                    onView={handleViewDetail}
                    onRollback={handleRollback}
                    onExport={handleExportBatch}
                    canRollback={canRollbackBatch(batch, role, currentUsername)}
                    canExport={canExportBatch(batch, role, currentUsername)}
                  />
                ))}
                {desensitizedBatches.length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs text-gray-500 mb-2 flex items-center gap-1">
                      <Shield className="h-3 w-3" />
                      以下 {desensitizedBatches.length} 个批次您无权限查看详情
                    </p>
                    {desensitizedBatches.map(summary => (
                      <DesensitizedBatchCard key={summary.batchId} summary={summary} />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {view === 'preview' && currentPreview && currentBatch && (
        <div className="p-4 space-y-4 pb-32">
          <div className="flex items-center gap-2">
            <button
              onClick={handleBackToList}
              className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
            >
              <ArrowLeft className="h-4 w-4" />
              返回列表
            </button>
          </div>

          <div className="rounded-xl bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-semibold text-gray-900">预演结果</h3>
              <span className={cn(
                'text-xs px-2 py-0.5 rounded-full',
                statusConfig[currentBatch.status]?.bg,
                statusConfig[currentBatch.status]?.color
              )}>
                {targetEntityConfig[currentBatch.targetEntity]?.label}
              </span>
            </div>

            <div className="grid grid-cols-4 gap-2 mb-4">
              <div className="text-center p-2 bg-gray-50 rounded-lg">
                <p className="text-lg font-semibold text-gray-900">{currentPreview.totalRecords}</p>
                <p className="text-xs text-gray-500">总记录</p>
              </div>
              <div className="text-center p-2 bg-green-50 rounded-lg">
                <p className="text-lg font-semibold text-green-600">{currentPreview.validRecords}</p>
                <p className="text-xs text-gray-500">有效</p>
              </div>
              <div className="text-center p-2 bg-amber-50 rounded-lg">
                <p className="text-lg font-semibold text-amber-600">{currentPreview.warningRecords}</p>
                <p className="text-xs text-gray-500">警告</p>
              </div>
              <div className="text-center p-2 bg-red-50 rounded-lg">
                <p className="text-lg font-semibold text-red-600">{currentPreview.errorRecords}</p>
                <p className="text-xs text-gray-500">错误</p>
              </div>
            </div>

            {currentPreview.willOverwriteCount > 0 && (
              <div className="mb-3 rounded-lg bg-amber-50 border border-amber-200 p-2">
                <p className="text-xs text-amber-700 flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  有 {currentPreview.willOverwriteCount} 条记录将覆盖已存在的数据
                </p>
              </div>
            )}

            {currentPreview.duplicateKeyCount > 0 && (
              <div className="mb-3 rounded-lg bg-red-50 border border-red-200 p-2">
                <p className="text-xs text-red-700 flex items-center gap-1.5">
                  <AlertCircle className="h-3.5 w-3.5" />
                  发现 {currentPreview.duplicateKeyCount} 条主键重复记录
                </p>
              </div>
            )}
          </div>

          <div className="rounded-xl bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-medium text-gray-900">冲突处理策略</h4>
            </div>
            <div className="flex gap-2 mb-3">
              <button
                onClick={() => setConflictAction('skip')}
                className={cn(
                  'flex-1 py-2 rounded-lg text-xs font-medium transition-colors',
                  conflictAction === 'skip'
                    ? 'bg-gray-200 text-gray-900'
                    : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                )}
              >
                <SkipForward className="h-4 w-4 mx-auto mb-1" />
                跳过冲突
              </button>
              <button
                onClick={() => setConflictAction('overwrite')}
                className={cn(
                  'flex-1 py-2 rounded-lg text-xs font-medium transition-colors',
                  conflictAction === 'overwrite'
                    ? 'bg-green-200 text-green-900'
                    : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                )}
              >
                <CheckSquare className="h-4 w-4 mx-auto mb-1" />
                覆盖旧数据
              </button>
              <button
                onClick={() => setConflictAction('pending')}
                className={cn(
                  'flex-1 py-2 rounded-lg text-xs font-medium transition-colors',
                  conflictAction === 'pending'
                    ? 'bg-amber-200 text-amber-900'
                    : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                )}
              >
                <Clock className="h-4 w-4 mx-auto mb-1" />
                转待处理
              </button>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => handleBulkAction('skip')}
                className="flex-1 text-xs text-gray-600 hover:text-gray-900 py-1"
              >
                全部跳过
              </button>
              <button
                onClick={() => handleBulkAction('overwrite')}
                className="flex-1 text-xs text-green-600 hover:text-green-700 py-1"
              >
                全部覆盖
              </button>
              <button
                onClick={() => handleBulkAction('pending')}
                className="flex-1 text-xs text-amber-600 hover:text-amber-700 py-1"
              >
                全部待处理
              </button>
            </div>
          </div>

          <div className="rounded-xl bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-medium text-gray-900">数据预览</h4>
              <div className="flex gap-1">
                <button
                  onClick={() => setPreviewFilter('all')}
                  className={cn(
                    'text-xs px-2 py-1 rounded',
                    previewFilter === 'all' ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600'
                  )}
                >
                  全部
                </button>
                <button
                  onClick={() => setPreviewFilter('error')}
                  className={cn(
                    'text-xs px-2 py-1 rounded',
                    previewFilter === 'error' ? 'bg-red-500 text-white' : 'bg-gray-100 text-gray-600'
                  )}
                >
                  错误
                </button>
                <button
                  onClick={() => setPreviewFilter('warning')}
                  className={cn(
                    'text-xs px-2 py-1 rounded',
                    previewFilter === 'warning' ? 'bg-amber-500 text-white' : 'bg-gray-100 text-gray-600'
                  )}
                >
                  警告
                </button>
                <button
                  onClick={() => setPreviewFilter('conflict')}
                  className={cn(
                    'text-xs px-2 py-1 rounded',
                    previewFilter === 'conflict' ? 'bg-purple-500 text-white' : 'bg-gray-100 text-gray-600'
                  )}
                >
                  冲突
                </button>
              </div>
            </div>
            <PreviewTable
              records={currentPreview.records}
              fieldMapping={currentPreview.fieldMapping}
              primaryKeyField={currentPreview.primaryKeyField}
              recordActions={recordActions}
              onActionChange={handleRecordActionChange}
              filter={previewFilter}
            />
          </div>
        </div>
      )}

      {view === 'preview' && currentPreview && (
        <div className="fixed bottom-16 left-0 right-0 bg-white border-t border-gray-200 p-4 z-20">
          <button
            onClick={handleConfirmImport}
            disabled={isImporting || currentPreview.validRecords === 0}
            className={cn(
              'w-full h-12 rounded-lg flex items-center justify-center gap-2 text-sm font-semibold transition-colors',
              isImporting || currentPreview.validRecords === 0
                ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                : 'bg-accent text-white hover:bg-amber-600 active:bg-amber-700'
            )}
            data-testid="confirm-import-button"
          >
            {isImporting ? (
              <>
                <Clock className="h-5 w-5 animate-pulse" />
                导入中...
              </>
            ) : (
              <>
                <Play className="h-5 w-5" />
                确认导入
              </>
            )}
          </button>
        </div>
      )}

      {detailBatch && (
        <BatchDetailModal
          batch={detailBatch}
          onClose={() => setDetailBatch(null)}
          onRollback={() => handleRollback(detailBatch)}
          canRollback={canRollbackBatch(detailBatch, role, currentUsername)}
        />
      )}

      {rollbackTargetBatch && (
        <RollbackConfirmModal
          batch={rollbackTargetBatch}
          onConfirm={handleConfirmRollback}
          onCancel={() => setRollbackBatchId(null)}
        />
      )}

      {authModalOpen && authModalBatchId && (
        <AuthorizationConfigModal
          open={authModalOpen}
          onClose={() => {
            setAuthModalOpen(false)
            setAuthModalBatchId(null)
            setPendingAuthBatchId(null)
          }}
          onConfirm={handleAuthConfirm}
          batchId={authModalBatchId}
          mode="create"
          existingAuth={getAuthorizationByBatchId(authModalBatchId)}
          createdBy={currentUsername}
        />
      )}
    </Layout>
  )
}
