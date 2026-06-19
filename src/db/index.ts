import Dexie, { type Table } from 'dexie'
import type {
  Template, Task, Draft, Submission, Anomaly, EventLog, ExportRecord, ImportBatch,
  BatchAuthorization, AuthorizationTemplate, OperationTimelineEntry
} from '@/types'

class InspectionDB extends Dexie {
  templates!: Table<Template>
  tasks!: Table<Task>
  drafts!: Table<Draft>
  submissions!: Table<Submission>
  anomalies!: Table<Anomaly>
  eventLogs!: Table<EventLog>
  exportRecords!: Table<ExportRecord>
  importBatches!: Table<ImportBatch>
  batchAuthorizations!: Table<BatchAuthorization>
  authorizationTemplates!: Table<AuthorizationTemplate>
  operationTimeline!: Table<OperationTimelineEntry>

  constructor() {
    super('InspectionDB')
    this.version(3).stores({
      templates: 'id, name, version',
      tasks: 'id, templateId, assignee, status',
      drafts: 'id, taskId',
      submissions: 'id, taskId, version',
      anomalies: 'id, taskId, checkItemId',
      eventLogs: 'id, taskId, action, timestamp',
      exportRecords: 'id, triggeredAt, status',
      importBatches: 'id, targetEntity, status, createdAt, createdBy, permissionScope, authorizationId',
    })
    this.version(4).stores({
      templates: 'id, name, version',
      tasks: 'id, templateId, assignee, status',
      drafts: 'id, taskId',
      submissions: 'id, taskId, version',
      anomalies: 'id, taskId, checkItemId',
      eventLogs: 'id, taskId, action, timestamp',
      exportRecords: 'id, triggeredAt, status',
      importBatches: 'id, targetEntity, status, createdAt, createdBy, permissionScope, authorizationId',
      batchAuthorizations: 'id, batchId, isRevoked, expiresAt, createdBy, createdAt, updatedAt',
      authorizationTemplates: 'id, name, version, createdBy, createdAt, updatedAt',
      operationTimeline: 'id, batchId, templateId, action, actor, timestamp',
    })
  }
}

export const db = new InspectionDB()

export async function seedDatabase() {
  const count = await db.templates.count()
  if (count > 0) return

  const now = Date.now()

  const template1Id = 'tpl-001'
  const template2Id = 'tpl-002'

  const template1: Template = {
    id: template1Id,
    name: '消防设施日常巡检',
    version: '1.0',
    checkpoints: [
      {
        id: 'cp-001-01',
        name: '1号楼大厅',
        order: 1,
        items: [
          { id: 'ci-001-01-01', label: '灭火器是否在位', type: 'select', required: true, options: ['是', '否'] },
          { id: 'ci-001-01-02', label: '灭火器压力表读数', type: 'select', required: true, options: ['绿区(正常)', '黄区(偏高)', '红区(偏低)'] },
          { id: 'ci-001-01-03', label: '消防通道是否畅通', type: 'select', required: true, options: ['是', '否'] },
          { id: 'ci-001-01-04', label: '应急照明是否正常', type: 'select', required: false, options: ['正常', '故障', '未安装'] },
          { id: 'ci-001-01-05', label: '现场照片', type: 'attachment', required: false, placeholder: '请拍摄1号楼大厅全景' },
        ],
      },
      {
        id: 'cp-001-02',
        name: '1号楼地下车库',
        order: 2,
        items: [
          { id: 'ci-001-02-01', label: '喷淋头是否完好', type: 'select', required: true, options: ['完好', '损坏', '缺失'] },
          { id: 'ci-001-02-02', label: '烟感报警器数量', type: 'number', required: true, min: 0, max: 100 },
          { id: 'ci-001-02-03', label: '排烟风机运行状态', type: 'select', required: true, options: ['正常', '异常', '停机'] },
          { id: 'ci-001-02-04', label: '备注', type: 'text', required: false },
        ],
      },
      {
        id: 'cp-001-03',
        name: '2号楼配电室',
        order: 3,
        items: [
          { id: 'ci-001-03-01', label: '配电柜温度(℃)', type: 'number', required: true, min: -10, max: 80 },
          { id: 'ci-001-03-02', label: '电缆是否有破损', type: 'select', required: true, options: ['无破损', '轻微破损', '严重破损'] },
          { id: 'ci-001-03-03', label: '灭火器类型', type: 'select', required: true, options: ['干粉', 'CO2', '泡沫'] },
          { id: 'ci-001-03-04', label: '现场照片', type: 'attachment', required: false, placeholder: '请拍摄配电室全景' },
        ],
      },
    ],
    createdAt: now,
    updatedAt: now,
  }

  const template2: Template = {
    id: template2Id,
    name: '电梯安全巡检',
    version: '1.0',
    checkpoints: [
      {
        id: 'cp-002-01',
        name: 'A栋电梯',
        order: 1,
        items: [
          { id: 'ci-002-01-01', label: '电梯运行是否有异响', type: 'select', required: true, options: ['正常', '异响', '停运'] },
          { id: 'ci-002-01-02', label: '紧急呼叫按钮是否可用', type: 'select', required: true, options: ['可用', '不可用'] },
          { id: 'ci-002-01-03', label: '载重标识是否清晰', type: 'select', required: false, options: ['清晰', '模糊', '缺失'] },
          { id: 'ci-002-01-04', label: '年检证有效期', type: 'text', required: true, placeholder: '如：2026-12-31' },
        ],
      },
      {
        id: 'cp-002-02',
        name: 'B栋电梯',
        order: 2,
        items: [
          { id: 'ci-002-02-01', label: '电梯运行是否有异响', type: 'select', required: true, options: ['正常', '异响', '停运'] },
          { id: 'ci-002-02-02', label: '紧急呼叫按钮是否可用', type: 'select', required: true, options: ['可用', '不可用'] },
          { id: 'ci-002-02-03', label: '层门是否完好', type: 'select', required: true, options: ['完好', '变形', '损坏'] },
          { id: 'ci-002-02-04', label: '现场照片', type: 'attachment', required: false, placeholder: '请拍摄电梯轿厢内部' },
        ],
      },
    ],
    createdAt: now,
    updatedAt: now,
  }

  const tasks: Task[] = [
    {
      id: 'task-001',
      templateId: template1Id,
      templateVersion: '1.0',
      title: '消防设施周检-第24周',
      assignee: '',
      status: 'available',
      createdAt: now - 86400000,
      updatedAt: now - 86400000,
    },
    {
      id: 'task-002',
      templateId: template2Id,
      templateVersion: '1.0',
      title: '电梯月度安全检查-6月',
      assignee: '',
      status: 'available',
      createdAt: now - 43200000,
      updatedAt: now - 43200000,
    },
    {
      id: 'task-003',
      templateId: template1Id,
      templateVersion: '1.0',
      title: '消防设施周检-第23周',
      assignee: '巡检员张三',
      status: 'in_progress',
      createdAt: now - 172800000,
      updatedAt: now - 86400000,
    },
  ]

  await db.templates.bulkAdd([template1, template2])
  await db.tasks.bulkAdd(tasks)
}
