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

export type ImportTargetEntity = 'tasks' | 'templates' | 'anomalies' | 'eventLogs' | 'submissions' | 'drafts'

export type ImportBatchStatus =
  | 'previewing'
  | 'previewed'
  | 'pending_confirmation'
  | 'importing'
  | 'success'
  | 'failed'
  | 'partial_success'
  | 'rolled_back'
  | 'rolling_back'
  | 'interrupted'

export type ImportConflictAction = 'skip' | 'overwrite' | 'pending'

export type ImportIssueType =
  | 'missing_required_field'
  | 'invalid_type'
  | 'duplicate_key'
  | 'will_overwrite'
  | 'dirty_data'
  | 'unknown_field'
  | 'value_out_of_range'
  | 'reference_not_found'

export type ImportIssueSeverity = 'error' | 'warning' | 'info'

export interface ImportIssue {
  type: ImportIssueType
  field: string
  message: string
  severity: ImportIssueSeverity
  value?: unknown
}

export interface ImportFieldMapping {
  sourceField: string
  targetField: string
  confidence: number
  isAutoMapped: boolean
}

export interface ImportPreviewRecord {
  index: number
  sourceData: Record<string, unknown>
  mappedData: Record<string, unknown>
  issues: ImportIssue[]
  status: 'valid' | 'warning' | 'error'
  action: ImportConflictAction
  conflictType?: 'duplicate_key' | 'will_overwrite' | null
  existingRecordId?: string
  existingRecordSnapshot?: Record<string, unknown>
}

export interface ImportPreviewResult {
  batchId: string
  targetEntity: ImportTargetEntity
  totalRecords: number
  validRecords: number
  warningRecords: number
  errorRecords: number
  fieldMapping: ImportFieldMapping[]
  unmappedSourceFields: string[]
  missingRequiredFields: string[]
  duplicateKeyCount: number
  willOverwriteCount: number
  records: ImportPreviewRecord[]
  primaryKeyField: string
  createdAt: number
}

export interface ImportConfigSnapshot {
  targetEntity: ImportTargetEntity
  fieldMapping: ImportFieldMapping[]
  conflictAction: ImportConflictAction
  primaryKeyField: string
  sourceFileName: string
  sourceFileType: 'csv' | 'json'
  totalRecords: number
}

export interface ImportBatch {
  id: string
  batchName: string
  sourceFileName: string
  sourceFileType: 'csv' | 'json'
  targetEntity: ImportTargetEntity
  status: ImportBatchStatus
  totalRecords: number
  processedRecords: number
  successRecords: number
  failedRecords: number
  skippedRecords: number
  pendingRecords: number
  progress: number
  fieldMapping: ImportFieldMapping[]
  conflictAction: ImportConflictAction
  primaryKeyField: string
  configSnapshot: ImportConfigSnapshot
  previewResult?: ImportPreviewResult | null
  createdBy: string
  createdAt: number
  startedAt?: number
  completedAt?: number
  errorMessage?: string
  importLog?: Array<{
    timestamp: number
    step: string
    message: string
    severity: 'info' | 'warning' | 'error'
  }>
  rollbackInfo?: {
    rolledBackAt: number
    rolledBackBy: string
    recordCount: number
    successCount: number
    failedCount: number
    reason?: string
  } | null
  rollbackLog?: Array<{
    timestamp: number
    step: string
    message: string
    severity: 'info' | 'warning' | 'error'
  }> | null
  importedRecordIds?: string[]
  overwrittenRecordSnapshots?: Array<{
    recordId: string
    before: Record<string, unknown>
    after: Record<string, unknown>
  }>
  permissionScope: 'admin' | 'inspector' | 'all'
  authorizationId?: string
}

export type AuthorizationPermission = 'view' | 'rollback' | 'handover' | 'export'

export interface AuthorizationPerson {
  username: string
  displayName?: string
  grantedAt: number
  grantedBy: string
}

export interface AuthorizationSnapshot {
  id: string
  batchId: string
  viewers: AuthorizationPerson[]
  rollbackers: AuthorizationPerson[]
  handoverPersons: AuthorizationPerson[]
  expiresAt: number | null
  notes: string
  configVersion: number
  createdAt: number
  createdBy: string
  immutable: true
}

export type OperationTimelineAction =
  | 'auth_create'
  | 'auth_update'
  | 'auth_expire'
  | 'auth_revoke'
  | 'auth_restore'
  | 'batch_handover'
  | 'template_import'
  | 'template_export'
  | 'access_granted'
  | 'access_denied'

export interface OperationTimelineEntry {
  id: string
  batchId?: string
  templateId?: string
  action: OperationTimelineAction
  actor: string
  detail: string
  timestamp: number
  metadata?: Record<string, unknown>
}

export interface AuthorizationConflictInfo {
  type: 'user_exists' | 'expired' | 'template_version_mismatch' | 'batch_not_found'
  message: string
  affectedFields?: string[]
}

export interface AuthorizationTemplate {
  id: string
  name: string
  description?: string
  viewers: string[]
  rollbackers: string[]
  handoverPersons: string[]
  defaultExpiryHours?: number
  defaultNotes?: string
  version: number
  createdAt: number
  updatedAt: number
  createdBy: string
  contentHash?: string
}

export interface BatchAuthorization {
  id: string
  batchId: string
  viewers: AuthorizationPerson[]
  rollbackers: AuthorizationPerson[]
  handoverPersons: AuthorizationPerson[]
  expiresAt: number | null
  notes: string
  configVersion: number
  snapshots: AuthorizationSnapshot[]
  timeline: OperationTimelineEntry[]
  isRevoked: boolean
  revokedAt?: number
  revokedBy?: string
  revokeReason?: string
  createdAt: number
  createdBy: string
  updatedAt: number
  lastSnapshotAt?: number
}

export interface DesensitizedBatchSummary {
  batchId: string
  batchName: string
  targetEntity: string
  status: ImportBatchStatus
  createdAt: number
  createdBy: string
  totalRecords: number
  isAuthorized: false
  authHint: string
}

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
