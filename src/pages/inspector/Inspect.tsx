import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AlertTriangle, Clock, CheckCircle } from 'lucide-react'
import Layout from '@/components/Layout'
import CheckItemInput from '@/components/CheckItemInput'
import AnomalyModal from '@/components/AnomalyModal'
import { useTaskStore } from '@/stores/useTaskStore'
import { useTemplateStore } from '@/stores/useTemplateStore'
import { useAppStore } from '@/stores/useAppStore'
import type { CheckItem, Template } from '@/types'
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

export default function Inspect() {
  const { taskId } = useParams()
  const navigate = useNavigate()
  const { fetchTasks, loadDraft, saveDraft, submitTask, reportAnomaly, fetchSubmissions, submissions } = useTaskStore()
  const { fetchTemplates, getTemplate } = useTemplateStore()
  const addToast = useAppStore((s) => s.addToast)

  const [template, setTemplate] = useState<Template | null>(null)
  const [currentCpIdx, setCurrentCpIdx] = useState(0)
  const [answers, setAnswers] = useState<Record<string, unknown>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [anomalyModal, setAnomalyModal] = useState<{ open: boolean; checkItem: CheckItem | null }>({ open: false, checkItem: null })
  const [versionMismatch, setVersionMismatch] = useState<string | null>(null)
  const [reworkReason, setReworkReason] = useState<string | null>(null)

  const debounceTimer = useRef<number | null>(null)
  const task = useTaskStore((s) => s.tasks.find((t) => t.id === taskId))
  const isReadOnly = task?.status === 'submitted' || task?.status === 'approved'

  useEffect(() => {
    const init = async () => {
      await fetchTasks()
      await fetchTemplates()
      if (taskId) {
        const t = useTaskStore.getState().tasks.find((t) => t.id === taskId)
        if (!t) {
          addToast('任务不存在', 'error')
          navigate('/inspector/tasks')
          return
        }
        const tmpl = await getTemplate(t.templateId)
        if (tmpl) setTemplate(tmpl)
        await fetchSubmissions(taskId)

        const readOnly = t.status === 'submitted' || t.status === 'approved'
        if (readOnly) {
          const subs = useTaskStore.getState().submissions
          const latest = subs.length > 0
            ? subs.reduce((a, b) => (a.version > b.version ? a : b))
            : null
          if (latest) {
            setAnswers(latest.answers)
          }
          if (t.status === 'approved') {
            addToast('任务已审核通过，仅可查看', 'info')
          } else if (t.status === 'submitted') {
            addToast('任务已提交待审核，仅可查看', 'info')
          }
        } else {
          await loadDraft(taskId)
          const draft = useTaskStore.getState().currentDraft
          if (draft) {
            setAnswers(draft.answers)
            setDraftSavedAt(draft.savedAt)
            if (draft.templateVersion !== tmpl?.version) {
              setVersionMismatch(`当前模板已更新至 v${tmpl?.version}，您的草稿为 v${draft.templateVersion}，请联系管理员或重新填写`)
            }
          }
        }
      }
    }
    init()
    return () => {
      if (debounceTimer.current) window.clearTimeout(debounceTimer.current)
    }
  }, [taskId])

  useEffect(() => {
    const reworkSub = submissions.find((s) => s.status === 'rework')
    if (reworkSub?.reworkReason) {
      setReworkReason(reworkSub.reworkReason)
    }
  }, [submissions])

  const saveDraftDebounced = useMemo(() => {
    if (!taskId || !template) return () => {}
    if (isReadOnly) return () => {}
    return (newAnswers: Record<string, unknown>) => {
      if (debounceTimer.current) window.clearTimeout(debounceTimer.current)
      setIsSaving(true)
      debounceTimer.current = window.setTimeout(async () => {
        try {
          await saveDraft(taskId!, template!.version, newAnswers)
          setDraftSavedAt(Date.now())
          addToast('草稿已自动保存', 'success')
        } catch {
          addToast('草稿保存失败', 'error')
        } finally {
          setIsSaving(false)
        }
      }, 500)
    }
  }, [taskId, template, isReadOnly])

  const handleValueChange = (itemId: string, value: unknown) => {
    if (isReadOnly) return
    const newAnswers = { ...answers, [itemId]: value }
    setAnswers(newAnswers)
    setErrors((prev) => {
      const next = { ...prev }
      delete next[itemId]
      return next
    })
    saveDraftDebounced(newAnswers)
  }

  const handleAnomaly = (item: CheckItem) => {
    setAnomalyModal({ open: true, checkItem: item })
  }

  const handleConfirmAnomaly = async (description: string, attachment: string) => {
    if (!taskId || !anomalyModal.checkItem) return
    try {
      await reportAnomaly(
        taskId,
        anomalyModal.checkItem.id,
        anomalyModal.checkItem.label,
        description,
        attachment || `[附件: ${anomalyModal.checkItem.label}.jpg]`
      )
      addToast('异常已上报', 'success')
    } catch (e) {
      addToast((e as Error).message, 'error')
    }
    setAnomalyModal({ open: false, checkItem: null })
  }

  const handleSubmit = async () => {
    if (!taskId || !template) return
    if (versionMismatch) {
      addToast(versionMismatch, 'error')
      return
    }

    if (task?.status === 'submitted') {
      addToast('任务已提交，不可重复提交', 'error')
      return
    }
    if (task?.status === 'approved') {
      addToast('任务已审核通过，不可再提交', 'error')
      return
    }

    if (debounceTimer.current) {
      window.clearTimeout(debounceTimer.current)
      debounceTimer.current = null
    }

    setIsSubmitting(true)
    try {
      const result = await submitTask(taskId, answers)
      if (result.ok) {
        addToast('提交成功', 'success')
        setTimeout(() => navigate('/inspector/tasks'), 1000)
      } else {
        const errorMap: Record<string, string> = {}
        const allItems = template.checkpoints.flatMap((cp) => cp.items)
        for (const err of result.errors) {
          for (const item of allItems) {
            if (err.includes(item.label)) {
              errorMap[item.id] = err
              break
            }
          }
        }
        setErrors(errorMap)
        addToast(`提交失败：${result.errors[0]}`, 'error')

        const firstErrorItem = template.checkpoints.flatMap((cp, idx) =>
          cp.items.map((it) => ({ ...it, cpIdx: idx }))
        ).find((it) => errorMap[it.id])

        if (firstErrorItem) {
          setCurrentCpIdx(firstErrorItem.cpIdx)
        }
      }
    } catch (e) {
      addToast((e as Error).message, 'error')
    } finally {
      setIsSubmitting(false)
    }
  }

  const cp = template?.checkpoints[currentCpIdx]

  const getCpCompletedCount = (cpIdx: number) => {
    if (!template) return 0
    const items = template.checkpoints[cpIdx].items
    return items.filter((it) => answers[it.id] !== undefined && answers[it.id] !== '' && answers[it.id] !== null).length
  }

  return (
    <Layout
      title={task?.title || '巡检填写'}
      onBack={() => navigate('/inspector/tasks')}
      rightAction={
        isReadOnly ? (
          <span className="text-xs text-white/90">
            v{template?.version}
          </span>
        ) : isSaving ? (
          <span className="text-xs text-white/80">保存中...</span>
        ) : draftSavedAt ? (
          <span className="text-xs text-white/80">
            <Clock className="inline h-3 w-3 mr-0.5" />
            {formatTime(draftSavedAt).slice(-5)}
          </span>
        ) : null
      }
    >
      {isReadOnly && (
        <div className="mx-4 mt-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
          <div className="flex items-start gap-2">
            <CheckCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-500" />
            <div>
              <p className="text-sm font-medium text-blue-800">
                {task?.status === 'approved' ? '已审核通过' : '已提交待审核'}
              </p>
              <p className="text-xs text-blue-600 mt-0.5">
                该任务当前为只读模式，可查看填写内容，不可编辑
              </p>
            </div>
          </div>
        </div>
      )}

      {reworkReason && (
        <div className="mx-4 mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />
            <div>
              <p className="text-sm font-medium text-red-800">退回返工</p>
              <p className="text-xs text-red-600 mt-0.5">{reworkReason}</p>
            </div>
          </div>
        </div>
      )}

      {versionMismatch && (
        <div className="mx-4 mt-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
            <p className="text-sm text-amber-800">{versionMismatch}</p>
          </div>
        </div>
      )}

      {template && cp && (
        <>
          <div className="px-4 pt-4">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">
              点位 {currentCpIdx + 1} / {template.checkpoints.length}
            </h2>
            <p className="text-sm text-gray-600">{cp.name}</p>
          </div>

          <div className="px-4 py-4 space-y-4">
            {cp.items.map((item) => (
              <div key={item.id} className="rounded-xl bg-white p-4 shadow-sm">
                <CheckItemInput
                  item={item}
                  value={answers[item.id]}
                  onChange={(val) => handleValueChange(item.id, val)}
                  error={errors[item.id]}
                  disabled={isReadOnly}
                />
                <button
                  onClick={() => !isReadOnly && handleAnomaly(item)}
                  disabled={isReadOnly}
                  className={cn(
                    'mt-3 inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 transition-colors',
                    isReadOnly ? 'opacity-50 cursor-not-allowed' : 'hover:bg-red-100'
                  )}
                >
                  <AlertTriangle className="h-3.5 w-3.5" />
                  标记异常
                </button>
              </div>
            ))}
          </div>

          <div className="px-4 pb-32">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-400">
                已填 {getCpCompletedCount(currentCpIdx)} / {cp.items.length} 项
              </span>
            </div>

            <div className="w-full h-2 rounded-full bg-gray-200 overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${(getCpCompletedCount(currentCpIdx) / cp.items.length) * 100}%` }}
              />
            </div>
          </div>
        </>
      )}

      <AnomalyModal
        open={anomalyModal.open}
        onClose={() => setAnomalyModal({ open: false, checkItem: null })}
        onConfirm={handleConfirmAnomaly}
        checkItemLabel={anomalyModal.checkItem?.label || ''}
      />

      <div className="fixed bottom-16 left-0 right-0 z-20 bg-white border-t border-gray-200">
        <div className="flex items-center gap-2 overflow-x-auto px-3 py-3 scrollbar-hide">
          {template?.checkpoints.map((cp, idx) => {
            const completed = getCpCompletedCount(idx)
            const allDone = completed === cp.items.length && cp.items.length > 0
            return (
              <button
                key={cp.id}
                onClick={() => setCurrentCpIdx(idx)}
                className={cn(
                  'flex min-w-[44px] h-11 flex-col items-center justify-center rounded-lg text-xs font-medium transition-colors flex-shrink-0 px-2',
                  currentCpIdx === idx
                    ? 'bg-primary text-white'
                    : allDone
                    ? 'bg-green-100 text-green-700'
                    : 'bg-gray-100 text-gray-600'
                )}
              >
                <span className="flex items-center gap-1">
                  {allDone && <CheckCircle className="h-3 w-3" />}
                  {idx + 1}
                </span>
              </button>
            )
          })}
        </div>

        <div className="px-4 pb-4">
          <button
            onClick={handleSubmit}
            disabled={isSubmitting || task?.status === 'submitted' || task?.status === 'approved'}
            className={cn(
              'w-full rounded-lg h-12 text-sm font-semibold transition-colors',
              isSubmitting || task?.status === 'submitted' || task?.status === 'approved'
                ? 'bg-amber-200 text-amber-100 cursor-not-allowed'
                : 'bg-accent text-white hover:bg-amber-600 active:bg-amber-700'
            )}
          >
            {isSubmitting
              ? '提交中...'
              : task?.status === 'submitted'
              ? '已提交'
              : task?.status === 'approved'
              ? '已通过'
              : '提交巡检结果'}
          </button>
        </div>
      </div>
    </Layout>
  )
}
