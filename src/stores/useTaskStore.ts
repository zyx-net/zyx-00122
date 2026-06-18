import { create } from 'zustand'
import { db } from '@/db'
import type { Task, TaskStatus, Draft, Submission, Anomaly, EventLog, EventAction } from '@/types'

interface TaskState {
  tasks: Task[]
  currentDraft: Draft | null
  submissions: Submission[]
  anomalies: Anomaly[]
  eventLogs: EventLog[]
  loading: boolean

  fetchTasks: () => Promise<void>
  fetchSubmissions: (taskId: string) => Promise<void>
  fetchAnomalies: (taskId?: string) => Promise<void>
  fetchEventLogs: (filters?: { taskId?: string; action?: EventAction; from?: number; to?: number }) => Promise<void>

  claimTask: (taskId: string, assignee: string) => Promise<void>
  readDraft: (taskId: string) => Promise<Draft | null>
  loadDraft: (taskId: string) => Promise<void>
  saveDraft: (taskId: string, templateVersion: string, answers: Record<string, unknown>) => Promise<void>
  submitTask: (taskId: string, answers: Record<string, unknown>) => Promise<{ ok: boolean; errors: string[] }>
  reworkTask: (taskId: string, reason: string) => Promise<void>
  approveTask: (taskId: string) => Promise<void>
  createTask: (task: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>) => Promise<string>

  reportAnomaly: (taskId: string, checkItemId: string, checkItemLabel: string, description: string, attachmentPlaceholder: string) => Promise<void>

  createTaskFromTemplate: (templateId: string, title: string) => Promise<string>
}

export const useTaskStore = create<TaskState>((set) => ({
  tasks: [],
  currentDraft: null,
  submissions: [],
  anomalies: [],
  eventLogs: [],
  loading: false,

  fetchTasks: async () => {
    set({ loading: true })
    const tasks = await db.tasks.toArray()
    set({ tasks, loading: false })
  },

  fetchSubmissions: async (taskId) => {
    const submissions = await db.submissions.where('taskId').equals(taskId).toArray()
    set({ submissions })
  },

  fetchAnomalies: async (taskId) => {
    if (taskId) {
      const anomalies = await db.anomalies.where('taskId').equals(taskId).toArray()
      set({ anomalies })
    } else {
      const anomalies = await db.anomalies.toArray()
      set({ anomalies })
    }
  },

  fetchEventLogs: async (filters) => {
    const collection = db.eventLogs.orderBy('timestamp').reverse()
    let logs = await collection.toArray()
    if (filters) {
      if (filters.taskId) logs = logs.filter((l) => l.taskId === filters.taskId)
      if (filters.action) logs = logs.filter((l) => l.action === filters.action)
      if (filters.from) logs = logs.filter((l) => l.timestamp >= filters.from!)
      if (filters.to) logs = logs.filter((l) => l.timestamp <= filters.to!)
    }
    set({ eventLogs: logs })
  },

  claimTask: async (taskId, assignee) => {
    const task = await db.tasks.get(taskId)
    if (!task) throw new Error('任务不存在')
    if (task.status !== 'available') throw new Error('任务已被领取')
    const now = Date.now()
    const updated: Task = { ...task, assignee, status: 'in_progress' as TaskStatus, updatedAt: now }
    await db.tasks.put(updated)
    const eventLog: EventLog = {
      id: `log-${now}-${Math.random().toString(36).slice(2, 7)}`,
      taskId,
      action: 'claim',
      actor: assignee,
      detail: `${assignee} 领取了任务`,
      timestamp: now,
    }
    await db.eventLogs.add(eventLog)
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === taskId ? updated : t)),
      eventLogs: [eventLog, ...s.eventLogs],
    }))
  },

  readDraft: async (taskId) => {
    const draft = await db.drafts.where('taskId').equals(taskId).first()
    return draft || null
  },

  loadDraft: async (taskId) => {
    const draft = await db.drafts.where('taskId').equals(taskId).first()
    if (draft) {
      const now = Date.now()
      const task = await db.tasks.get(taskId)
      const eventLog: EventLog = {
        id: `log-${now}-${Math.random().toString(36).slice(2, 7)}`,
        taskId,
        action: 'draft_load',
        actor: task?.assignee || '巡检员',
        detail: `草稿已恢复（模板 v${draft.templateVersion}，保存于 ${new Date(draft.savedAt).toLocaleString('zh-CN')}，共 ${Object.keys(draft.answers).length} 项答案）`,
        timestamp: now,
      }
      await db.eventLogs.add(eventLog)
      set((s) => ({
        currentDraft: draft,
        eventLogs: [eventLog, ...s.eventLogs],
      }))
    } else {
      set({ currentDraft: null })
    }
  },

  saveDraft: async (taskId, templateVersion, answers) => {
    const task = await db.tasks.get(taskId)
    if (!task) return
    if (task.status === 'submitted' || task.status === 'approved') return
    const now = Date.now()
    const existing = await db.drafts.where('taskId').equals(taskId).first()
    const draft: Draft = existing
      ? { ...existing, answers, templateVersion, savedAt: now }
      : { id: `draft-${now}-${Math.random().toString(36).slice(2, 7)}`, taskId, templateVersion, answers, savedAt: now }
    await db.drafts.put(draft)

    const eventLog: EventLog = {
      id: `log-${now}-${Math.random().toString(36).slice(2, 7)}`,
      taskId,
      action: 'draft_save',
      actor: task.assignee || '巡检员',
      detail: `草稿已保存（模板 v${templateVersion}，共 ${Object.keys(answers).length} 项答案）${existing ? '（更新）' : '（新建）'}`,
      timestamp: now,
    }
    await db.eventLogs.add(eventLog)

    set((s) => ({
      currentDraft: draft,
      eventLogs: [eventLog, ...s.eventLogs],
    }))
  },

  submitTask: async (taskId, answers) => {
    const errors: string[] = []
    const task = await db.tasks.get(taskId)
    if (!task) { errors.push('任务不存在'); return { ok: false, errors } }

    if (task.status === 'submitted') {
      errors.push('任务已提交，不可重复提交')
      return { ok: false, errors }
    }
    if (task.status === 'approved') {
      errors.push('任务已审核通过，不可再提交')
      return { ok: false, errors }
    }

    const template = await db.templates.get(task.templateId)
    if (!template) { errors.push('模板不存在'); return { ok: false, errors } }

    const draft = await db.drafts.where('taskId').equals(taskId).first()
    if (draft && draft.templateVersion !== template.version) {
      errors.push(`模板已更新至 v${template.version}，当前草稿为 v${draft.templateVersion}，请重新填写`)
      return { ok: false, errors }
    }

    for (const cp of template.checkpoints) {
      for (const item of cp.items) {
        const val = answers[item.id]
        if (item.required && (val === undefined || val === null || val === '')) {
          errors.push(`"${item.label}" 为必填项`)
        }
        if (item.type === 'number' && val !== undefined && val !== null && val !== '') {
          const num = Number(val)
          if (isNaN(num)) {
            errors.push(`"${item.label}" 必须为数字`)
          } else {
            if (item.min !== undefined && num < item.min) {
              errors.push(`"${item.label}" 值 ${num} 小于最小值 ${item.min}`)
            }
            if (item.max !== undefined && num > item.max) {
              errors.push(`"${item.label}" 值 ${num} 大于最大值 ${item.max}`)
            }
          }
        }
      }
    }

    if (errors.length > 0) {
      const now = Date.now()
      const eventLog: EventLog = {
        id: `log-${now}-${Math.random().toString(36).slice(2, 7)}`,
        taskId,
        action: 'reject',
        actor: task.assignee,
        detail: `提交被拒绝：${errors.join('；')}`,
        timestamp: now,
      }
      await db.eventLogs.add(eventLog)
      set((s) => ({ eventLogs: [eventLog, ...s.eventLogs] }))
      return { ok: false, errors }
    }

    const now = Date.now()
    const latestTask = await db.tasks.get(taskId)
    if (!latestTask) { errors.push('任务不存在'); return { ok: false, errors } }
    if (latestTask.status === 'submitted' || latestTask.status === 'approved') {
      errors.push(latestTask.status === 'approved' ? '任务已审核通过，不可再提交' : '任务已提交，不可重复提交')
      const rejectLog: EventLog = {
        id: `log-${now}-${Math.random().toString(36).slice(2, 7)}`,
        taskId,
        action: 'reject',
        actor: latestTask.assignee,
        detail: `提交被拒绝：${errors.join('；')}`,
        timestamp: now,
      }
      await db.eventLogs.add(rejectLog)
      set((s) => ({ eventLogs: [rejectLog, ...s.eventLogs] }))
      return { ok: false, errors }
    }
    const existingSubmissions = await db.submissions.where('taskId').equals(taskId).toArray()
    const maxVersion = existingSubmissions.reduce((max, s) => Math.max(max, s.version), 0)
    const submission: Submission = {
      id: `sub-${now}-${Math.random().toString(36).slice(2, 7)}`,
      taskId,
      version: maxVersion + 1,
      answers: { ...answers },
      status: 'pending',
      submittedAt: now,
    }
    await db.submissions.add(submission)

    const updatedTask: Task = { ...latestTask, status: 'submitted' as TaskStatus, updatedAt: now }
    await db.tasks.put(updatedTask)

    await db.drafts.where('taskId').equals(taskId).delete()

    const eventLog: EventLog = {
      id: `log-${now}-sub`,
      taskId,
      action: 'submit',
      actor: task.assignee,
      detail: `提交巡检结果（版本 ${submission.version}）`,
      timestamp: now,
    }
    await db.eventLogs.add(eventLog)

    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === taskId ? updatedTask : t)),
      currentDraft: null,
      submissions: [...s.submissions, submission],
      eventLogs: [eventLog, ...s.eventLogs],
    }))

    return { ok: true, errors: [] }
  },

  reworkTask: async (taskId, reason) => {
    const task = await db.tasks.get(taskId)
    if (!task) throw new Error('任务不存在')
    if (task.status !== 'submitted') throw new Error('只能退回已提交的任务')

    const now = Date.now()
    const lastSubmission = await db.submissions.where('taskId').equals(taskId).reverse().first()
    if (lastSubmission) {
      const reworkSub: Submission = { ...lastSubmission, id: `sub-${now}-rw`, status: 'rework', reworkReason: reason }
      await db.submissions.add(reworkSub)
    }

    const updatedTask: Task = { ...task, status: 'rework' as TaskStatus, updatedAt: now }
    await db.tasks.put(updatedTask)

    const eventLog: EventLog = {
      id: `log-${now}-rw`,
      taskId,
      action: 'rework',
      actor: '管理员',
      detail: `退回任务，原因：${reason}`,
      timestamp: now,
    }
    await db.eventLogs.add(eventLog)

    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === taskId ? updatedTask : t)),
      eventLogs: [eventLog, ...s.eventLogs],
    }))
  },

  approveTask: async (taskId) => {
    const task = await db.tasks.get(taskId)
    if (!task) throw new Error('任务不存在')
    if (task.status === 'approved') throw new Error('任务已审核通过')
    if (task.status !== 'submitted') throw new Error('当前状态不可审核')

    const now = Date.now()
    const lastSubmission = await db.submissions.where('taskId').equals(taskId).reverse().first()
    if (lastSubmission) {
      const approvedSub: Submission = { ...lastSubmission, id: `sub-${now}-ap`, status: 'approved' }
      await db.submissions.add(approvedSub)
    }

    const updatedTask: Task = { ...task, status: 'approved' as TaskStatus, updatedAt: now }
    await db.tasks.put(updatedTask)

    const eventLog: EventLog = {
      id: `log-${now}-ap`,
      taskId,
      action: 'approve',
      actor: '管理员',
      detail: '审核通过',
      timestamp: now,
    }
    await db.eventLogs.add(eventLog)

    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === taskId ? updatedTask : t)),
      eventLogs: [eventLog, ...s.eventLogs],
    }))
  },

  createTask: async (data) => {
    const now = Date.now()
    const id = `task-${now}-${Math.random().toString(36).slice(2, 7)}`
    const task: Task = { ...data, id, createdAt: now, updatedAt: now }
    await db.tasks.add(task)
    set((s) => ({ tasks: [...s.tasks, task] }))
    return id
  },

  reportAnomaly: async (taskId, checkItemId, checkItemLabel, description, attachmentPlaceholder) => {
    const now = Date.now()
    const anomaly: Anomaly = {
      id: `anom-${now}-${Math.random().toString(36).slice(2, 7)}`,
      taskId,
      checkItemId,
      checkItemLabel,
      description,
      attachmentPlaceholder,
      reportedAt: now,
    }
    await db.anomalies.add(anomaly)
    const eventLog: EventLog = {
      id: `log-${now}-anom`,
      taskId,
      action: 'anomaly',
      actor: '巡检员',
      detail: `上报异常：${checkItemLabel} - ${description}`,
      timestamp: now,
    }
    await db.eventLogs.add(eventLog)
    set((s) => ({
      anomalies: [...s.anomalies, anomaly],
      eventLogs: [eventLog, ...s.eventLogs],
    }))
  },

  createTaskFromTemplate: async (templateId, title) => {
    const template = await db.templates.get(templateId)
    if (!template) throw new Error('模板不存在')
    const now = Date.now()
    const id = `task-${now}-${Math.random().toString(36).slice(2, 7)}`
    const task: Task = {
      id,
      templateId,
      templateVersion: template.version,
      title,
      assignee: '',
      status: 'available',
      createdAt: now,
      updatedAt: now,
    }
    await db.tasks.add(task)
    set((s) => ({ tasks: [...s.tasks, task] }))
    return id
  },
}))
