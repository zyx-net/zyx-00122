export type CheckItemType = 'text' | 'number' | 'select' | 'attachment'

export interface CheckItem {
  id: string
  label: string
  type: CheckItemType
  required: boolean
  min?: number
  max?: number
  options?: string[]
  placeholder?: string
}

export interface CheckPoint {
  id: string
  name: string
  order: number
  items: CheckItem[]
}

export interface Template {
  id: string
  name: string
  version: string
  checkpoints: CheckPoint[]
  createdAt: number
  updatedAt: number
}

export type TaskStatus = 'available' | 'in_progress' | 'submitted' | 'rework' | 'approved'

export interface Task {
  id: string
  templateId: string
  templateVersion: string
  title: string
  assignee: string
  status: TaskStatus
  createdAt: number
  updatedAt: number
}

export interface Draft {
  id: string
  taskId: string
  templateVersion: string
  answers: Record<string, unknown>
  savedAt: number
}

export type SubmissionStatus = 'pending' | 'approved' | 'rework'

export interface Submission {
  id: string
  taskId: string
  version: number
  answers: Record<string, unknown>
  status: SubmissionStatus
  reworkReason?: string
  submittedAt: number
}

export interface Anomaly {
  id: string
  taskId: string
  checkItemId: string
  checkItemLabel: string
  description: string
  attachmentPlaceholder: string
  reportedAt: number
}

export type EventAction = 'claim' | 'save_draft' | 'draft_save' | 'draft_load' | 'submit' | 'rework' | 'approve' | 'anomaly' | 'reject'

export interface EventLog {
  id: string
  taskId: string
  action: EventAction
  actor: string
  detail: string
  timestamp: number
}

export type UserRole = 'inspector' | 'admin'

export type ExportStatus = 'pending' | 'success' | 'failed' | 'interrupted'

export type TriggerSource = 'logs-toolbar' | 'task-detail' | 'admin-review' | 'batch-action' | 'unknown'

export interface ExportFilter {
  action?: EventAction
  taskId?: string
  from?: number
  to?: number
}

export interface TaskStateSnapshot {
  taskId: string
  title: string
  status: TaskStatus
  assignee: string
  updatedAt: number
}

export interface FieldDifference {
  field: string
  before: unknown
  after: unknown
  changed: boolean
}

export interface ExportRecord {
  id: string
  triggeredAt: number
  filter: ExportFilter
  selectedTypes: string[]
  fileSummary: {
    fileName: string
    fileSize: number
    recordCount: number
    dataTypes: string[]
    contentHash?: string
  } | null
  status: ExportStatus
  errorMessage?: string
  exportedBy: string
  triggerSource?: TriggerSource
  contentHash?: string
  isDuplicateContent?: boolean
  duplicateOfExportId?: string
  taskSnapshot?: {
    taskId: string
    status: TaskStatus
    title: string
    assignee: string
  } | null
  tasksBeforeExport?: TaskStateSnapshot[] | null
  tasksAfterExport?: TaskStateSnapshot[] | null
  fieldDifferences?: FieldDifference[] | null
  logSnapshot?: Array<{
    action: EventAction
    detail: string
    timestamp: number
  }> | null
  pageContext?: {
    route: string
    viewMode: 'all' | 'single-task'
    currentTaskId?: string
    timestamp: number
    userAgent: string
    screenSize: {
      width: number
      height: number
    }
    scrollPosition?: {
      x: number
      y: number
    }
    urlParams?: Record<string, string>
  } | null
  keyFieldsSnapshot?: {
    totalTaskCount: number
    inProgressCount: number
    completedCount: number
    logCount: number
    anomalyCount: number
    draftCount: number
  } | null
  sortInfo?: {
    sortBy: 'timestamp' | 'action' | 'taskId'
    sortOrder: 'asc' | 'desc'
    visibleRange: {
      start: number
      end: number
      total: number
    }
  } | null
  failureTrace?: Array<{
    timestamp: number
    step: string
    message: string
    severity: 'info' | 'warning' | 'error'
  }> | null
  importInfo?: {
    importedAt: number
    sourceFileName: string
    originalAppVersion?: string
    compatibilityNotes?: string[]
  } | null
  appVersion?: string
  completedAt?: number
}
