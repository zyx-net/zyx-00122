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

export type EventAction = 'claim' | 'save_draft' | 'submit' | 'rework' | 'approve' | 'anomaly' | 'reject'

export interface EventLog {
  id: string
  taskId: string
  action: EventAction
  actor: string
  detail: string
  timestamp: number
}

export type UserRole = 'inspector' | 'admin'
