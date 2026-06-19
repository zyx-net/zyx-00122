import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import Dexie from 'dexie'
import { db } from '@/db'
import { useAuthorizationStore } from '@/stores/useAuthorizationStore'
import type {
  ImportBatch,
  ImportBatchStatus,
  ImportConflictAction,
  ImportFieldMapping,
  ImportIssue,
  ImportPreviewRecord,
  ImportPreviewResult,
  ImportTargetEntity,
  Task,
  Template,
  UserRole,
} from '@/types'

const IMPORT_PERSIST_KEY = 'inspection-import-center'

const targetEntityConfig: Record<ImportTargetEntity, {
  label: string
  primaryKey: string
  requiredFields: string[]
  optionalFields: string[]
  fieldLabels: Record<string, string>
}> = {
  tasks: {
    label: '任务数据',
    primaryKey: 'id',
    requiredFields: ['id', 'templateId', 'title', 'status'],
    optionalFields: ['templateVersion', 'assignee', 'createdAt', 'updatedAt'],
    fieldLabels: {
      id: '任务ID',
      templateId: '模板ID',
      templateVersion: '模板版本',
      title: '任务标题',
      assignee: '指派人',
      status: '状态',
      createdAt: '创建时间',
      updatedAt: '更新时间',
    },
  },
  templates: {
    label: '模板数据',
    primaryKey: 'id',
    requiredFields: ['id', 'name', 'version', 'checkpoints'],
    optionalFields: ['createdAt', 'updatedAt'],
    fieldLabels: {
      id: '模板ID',
      name: '模板名称',
      version: '版本号',
      checkpoints: '检查点',
      createdAt: '创建时间',
      updatedAt: '更新时间',
    },
  },
  anomalies: {
    label: '异常记录',
    primaryKey: 'id',
    requiredFields: ['id', 'taskId', 'checkItemId', 'description'],
    optionalFields: ['checkItemLabel', 'attachmentPlaceholder', 'reportedAt'],
    fieldLabels: {
      id: '异常ID',
      taskId: '任务ID',
      checkItemId: '检查项ID',
      checkItemLabel: '检查项名称',
      description: '异常描述',
      attachmentPlaceholder: '附件说明',
      reportedAt: '上报时间',
    },
  },
  eventLogs: {
    label: '事件日志',
    primaryKey: 'id',
    requiredFields: ['id', 'taskId', 'action', 'actor', 'timestamp'],
    optionalFields: ['detail'],
    fieldLabels: {
      id: '日志ID',
      taskId: '任务ID',
      action: '操作类型',
      actor: '操作人',
      detail: '详情',
      timestamp: '时间戳',
    },
  },
  submissions: {
    label: '提交记录',
    primaryKey: 'id',
    requiredFields: ['id', 'taskId', 'version', 'answers', 'status'],
    optionalFields: ['reworkReason', 'submittedAt'],
    fieldLabels: {
      id: '提交ID',
      taskId: '任务ID',
      version: '版本号',
      answers: '回答内容',
      status: '状态',
      reworkReason: '返工原因',
      submittedAt: '提交时间',
    },
  },
  drafts: {
    label: '草稿数据',
    primaryKey: 'id',
    requiredFields: ['id', 'taskId', 'answers'],
    optionalFields: ['templateVersion', 'savedAt'],
    fieldLabels: {
      id: '草稿ID',
      taskId: '任务ID',
      templateVersion: '模板版本',
      answers: '回答内容',
      savedAt: '保存时间',
    },
  },
}

function parseCSV(text: string): Record<string, unknown>[] {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) return []

  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''))
  const records: Record<string, unknown>[] = []

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue

    const values: string[] = []
    let current = ''
    let inQuotes = false

    for (let j = 0; j < line.length; j++) {
      const char = line[j]
      if (char === '"') {
        inQuotes = !inQuotes
      } else if (char === ',' && !inQuotes) {
        values.push(current)
        current = ''
      } else {
        current += char
      }
    }
    values.push(current)

    const record: Record<string, unknown> = {}
    headers.forEach((header, idx) => {
      const val = values[idx]?.trim() ?? ''
      if (val === '' || val === 'null' || val === 'undefined') {
        record[header] = null
      } else if (!isNaN(Number(val)) && val !== '') {
        record[header] = Number(val)
      } else if (val === 'true' || val === 'false') {
        record[header] = val === 'true'
      } else {
        record[header] = val
      }
    })
    records.push(record)
  }

  return records
}

function calculateFieldSimilarity(a: string, b: string): number {
  const aLower = a.toLowerCase().replace(/[^a-z0-9]/g, '')
  const bLower = b.toLowerCase().replace(/[^a-z0-9]/g, '')

  if (aLower === bLower) return 1.0
  if (aLower.includes(bLower) || bLower.includes(aLower)) return 0.8

  let matches = 0
  const aChars = new Set(aLower)
  const bChars = new Set(bLower)
  for (const c of aChars) {
    if (bChars.has(c)) matches++
  }
  const total = new Set([...aChars, ...bChars]).size
  return total > 0 ? matches / total : 0
}

function autoMapFields(
  sourceFields: string[],
  targetFields: string[]
): ImportFieldMapping[] {
  const mappings: ImportFieldMapping[] = []
  const usedTargets = new Set<string>()

  for (const sourceField of sourceFields) {
    let bestMatch = ''
    let bestConfidence = 0

    for (const targetField of targetFields) {
      if (usedTargets.has(targetField)) continue
      const confidence = calculateFieldSimilarity(sourceField, targetField)
      if (confidence > bestConfidence && confidence >= 0.3) {
        bestConfidence = confidence
        bestMatch = targetField
      }
    }

    if (bestMatch && bestConfidence >= 0.65) {
      mappings.push({
        sourceField,
        targetField: bestMatch,
        confidence: bestConfidence,
        isAutoMapped: true,
      })
      usedTargets.add(bestMatch)
    }
  }

  return mappings
}

function validateRecord(
  record: Record<string, unknown>,
  targetEntity: ImportTargetEntity
): ImportIssue[] {
  const issues: ImportIssue[] = []
  const config = targetEntityConfig[targetEntity]

  for (const field of config.requiredFields) {
    if (record[field] === undefined || record[field] === null || record[field] === '') {
      issues.push({
        type: 'missing_required_field',
        field,
        message: `缺少必填字段：${config.fieldLabels[field] || field}`,
        severity: 'error',
      })
    }
  }

  if (targetEntity === 'tasks') {
    const status = record.status as string
    const validStatuses = ['available', 'in_progress', 'submitted', 'rework', 'approved']
    if (status && !validStatuses.includes(status)) {
      issues.push({
        type: 'invalid_type',
        field: 'status',
        message: `无效的任务状态：${status}`,
        severity: 'error',
        value: status,
      })
    }
  }

  if (targetEntity === 'eventLogs') {
    const ts = record.timestamp
    if (ts !== undefined && ts !== null) {
      const tsNum = typeof ts === 'string' ? Date.parse(ts) : Number(ts)
      if (isNaN(tsNum) || tsNum <= 0) {
        issues.push({
          type: 'invalid_type',
          field: 'timestamp',
          message: '时间戳格式无效',
          severity: 'warning',
          value: ts,
        })
      }
    }
  }

  return issues
}

async function getExistingRecords(
  targetEntity: ImportTargetEntity,
  ids: string[]
): Promise<Map<string, Record<string, unknown>>> {
  const result = new Map<string, Record<string, unknown>>()

  try {
    const table = db[targetEntity as keyof typeof db] as Dexie.Table<Record<string, unknown>, string>
    if (table && typeof table.bulkGet === 'function') {
      const records = await table.bulkGet(ids)
      records.forEach((r, idx) => {
        if (r) result.set(ids[idx], r)
      })
    }
  } catch {
    // ignore
  }

  return result
}

async function checkForConflicts(
  records: ImportPreviewRecord[],
  targetEntity: ImportTargetEntity,
  primaryKeyField: string
): Promise<ImportPreviewRecord[]> {
  const ids = records
    .map(r => String(r.mappedData[primaryKeyField] || ''))
    .filter(id => id)

  const existing = await getExistingRecords(targetEntity, ids)
  const seenIds = new Map<string, number>()

  return records.map((record, idx) => {
    const pk = String(record.mappedData[primaryKeyField] || '')
    const issues = [...record.issues]

    const isDuplicateInBatch = seenIds.has(pk)
    if (isDuplicateInBatch) {
      issues.push({
        type: 'duplicate_key',
        field: primaryKeyField,
        message: `主键重复：第 ${seenIds.get(pk)! + 1} 行已有相同的 ${pk}`,
        severity: 'error',
        value: pk,
      })
    } else {
      seenIds.set(pk, idx)
    }

    let conflictType: 'duplicate_key' | 'will_overwrite' | null = null
    let existingRecordId: string | undefined
    let existingRecordSnapshot: Record<string, unknown> | undefined

    if (isDuplicateInBatch) {
      conflictType = 'duplicate_key'
    } else if (existing.has(pk)) {
      conflictType = 'will_overwrite'
      existingRecordId = pk
      existingRecordSnapshot = existing.get(pk)
      issues.push({
        type: 'will_overwrite',
        field: primaryKeyField,
        message: `将覆盖已存在的记录：${pk}`,
        severity: 'warning',
        value: pk,
      })
    }

    const hasErrors = issues.some(i => i.severity === 'error')
    const hasWarnings = issues.some(i => i.severity === 'warning')

    return {
      ...record,
      issues,
      status: hasErrors ? 'error' : hasWarnings ? 'warning' : 'valid',
      conflictType,
      existingRecordId,
      existingRecordSnapshot,
    }
  })
}

function buildMappedData(
  sourceData: Record<string, unknown>,
  fieldMapping: ImportFieldMapping[]
): Record<string, unknown> {
  const mapped: Record<string, unknown> = {}
  for (const mapping of fieldMapping) {
    if (mapping.targetField && sourceData[mapping.sourceField] !== undefined) {
      mapped[mapping.targetField] = sourceData[mapping.sourceField]
    }
  }
  return mapped
}

function normalizeImportBatch(batch: ImportBatch): ImportBatch {
  return {
    ...batch,
    previewResult: batch.previewResult ?? null,
    importLog: batch.importLog ?? [],
    rollbackInfo: batch.rollbackInfo ?? null,
    rollbackLog: batch.rollbackLog ?? null,
    importedRecordIds: batch.importedRecordIds ?? [],
    overwrittenRecordSnapshots: batch.overwrittenRecordSnapshots ?? [],
    progress: batch.progress ?? 0,
    processedRecords: batch.processedRecords ?? 0,
    successRecords: batch.successRecords ?? 0,
    failedRecords: batch.failedRecords ?? 0,
    skippedRecords: batch.skippedRecords ?? 0,
    pendingRecords: batch.pendingRecords ?? 0,
  }
}

interface ImportState {
  batches: ImportBatch[]
  currentBatchId: string | null
  currentPreview: ImportPreviewResult | null
  importError: string | null
  pendingBatches: Set<string>
  rollingBackBatches: Set<string>

  fetchBatches: (role?: UserRole) => Promise<void>
  createBatch: (
    targetEntity: ImportTargetEntity,
    sourceFileName: string,
    sourceFileType: 'csv' | 'json',
    createdBy: string,
    permissionScope: 'admin' | 'inspector' | 'all'
  ) => Promise<string>
  runPreview: (
    batchId: string,
    fileContent: string,
    fieldMapping?: ImportFieldMapping[],
    primaryKeyField?: string
  ) => Promise<ImportPreviewResult>
  confirmImport: (
    batchId: string,
    conflictAction: ImportConflictAction,
    recordActions?: Record<number, ImportConflictAction>
  ) => Promise<void>
  executeImport: (batchId: string) => Promise<void>
  rollbackBatch: (batchId: string, rolledBackBy: string, reason?: string) => Promise<void>
  updateBatchStatus: (batchId: string, status: ImportBatchStatus, errorMessage?: string) => Promise<void>
  getBatchById: (batchId: string) => ImportBatch | null
  setCurrentBatchId: (id: string | null) => void
  setCurrentPreview: (preview: ImportPreviewResult | null) => void
  setImportError: (error: string | null) => void
  clearImportError: () => void
  loadPersistedData: () => void
  markInterruptedBatches: () => Promise<void>
  canViewBatch: (batch: ImportBatch, role: UserRole | null, username?: string) => boolean
  canRollbackBatch: (batch: ImportBatch, role: UserRole | null, username?: string) => boolean
  canExportBatch: (batch: ImportBatch, role: UserRole | null, username?: string) => boolean
}

export const useImportStore = create<ImportState>()(
  persist(
    (set, get) => ({
      batches: [],
      currentBatchId: null,
      currentPreview: null,
      importError: null,
      pendingBatches: new Set(),
      rollingBackBatches: new Set(),

      canViewBatch: (batch, role, username) => {
        const authStore = useAuthorizationStore.getState()
        return authStore.canViewBatch(batch, username || '', role)
      },

      canRollbackBatch: (batch, role, username) => {
        const authStore = useAuthorizationStore.getState()
        return authStore.canRollbackBatch(batch, username || '', role)
      },

      canExportBatch: (batch, role, username) => {
        const authStore = useAuthorizationStore.getState()
        return authStore.canExportBatch(batch, username || '', role)
      },

      fetchBatches: async (role) => {
        try {
          let allBatches = await db.importBatches
            .orderBy('createdAt')
            .reverse()
            .limit(50)
            .toArray()

          if (role && role === 'inspector') {
            allBatches = allBatches.filter(b => b.permissionScope !== 'admin')
          }

          const normalized = allBatches.map(normalizeImportBatch)
          set({ batches: normalized })
        } catch (err) {
          console.error('Failed to fetch import batches:', err)
        }
      },

      createBatch: async (targetEntity, sourceFileName, sourceFileType, createdBy, permissionScope) => {
        const now = Date.now()
        const batchId = `import-${now}-${Math.random().toString(36).slice(2, 7)}`
        const config = targetEntityConfig[targetEntity]

        const batch: ImportBatch = {
          id: batchId,
          batchName: `${config.label}-${new Date(now).toLocaleDateString('zh-CN')}`,
          sourceFileName,
          sourceFileType,
          targetEntity,
          status: 'previewing',
          totalRecords: 0,
          processedRecords: 0,
          successRecords: 0,
          failedRecords: 0,
          skippedRecords: 0,
          pendingRecords: 0,
          progress: 0,
          fieldMapping: [],
          conflictAction: 'skip',
          primaryKeyField: config.primaryKey,
          configSnapshot: {
            targetEntity,
            fieldMapping: [],
            conflictAction: 'skip',
            primaryKeyField: config.primaryKey,
            sourceFileName,
            sourceFileType,
            totalRecords: 0,
          },
          previewResult: null,
          createdBy,
          createdAt: now,
          permissionScope,
          importLog: [
            {
              timestamp: now,
              step: 'create',
              message: `创建导入批次：${sourceFileName}`,
              severity: 'info',
            },
          ],
        }

        try {
          await db.importBatches.add(batch)
          set((state) => ({
            batches: [batch, ...state.batches].slice(0, 50),
            currentBatchId: batchId,
          }))
          return batchId
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : '创建导入批次失败'
          set({ importError: errorMsg })
          throw new Error(errorMsg)
        }
      },

      runPreview: async (batchId, fileContent, fieldMapping, primaryKeyField) => {
        const batch = await db.importBatches.get(batchId)
        if (!batch) throw new Error('批次不存在')

        const config = targetEntityConfig[batch.targetEntity]
        const pkField = primaryKeyField || config.primaryKey

        let sourceRecords: Record<string, unknown>[] = []
        try {
          if (batch.sourceFileType === 'csv') {
            sourceRecords = parseCSV(fileContent)
          } else {
            const parsed = JSON.parse(fileContent)
            if (Array.isArray(parsed)) {
              sourceRecords = parsed
            } else if (parsed[batch.targetEntity] && Array.isArray(parsed[batch.targetEntity])) {
              sourceRecords = parsed[batch.targetEntity]
            } else {
              sourceRecords = [parsed]
            }
          }
        } catch (err) {
          throw new Error(`文件解析失败：${err instanceof Error ? err.message : '未知错误'}`)
        }

        if (sourceRecords.length === 0) {
          throw new Error('文件中没有有效数据')
        }

        const sourceFields = Object.keys(sourceRecords[0] || {})
        const targetFields = [...config.requiredFields, ...config.optionalFields]

        let mappings: ImportFieldMapping[]
        if (fieldMapping && fieldMapping.length > 0) {
          mappings = fieldMapping
        } else {
          mappings = autoMapFields(sourceFields, targetFields)
        }

        const mappedTargetFields = new Set(mappings.map(m => m.targetField))
        const missingRequired = config.requiredFields.filter(f => !mappedTargetFields.has(f))
        const unmappedSource = sourceFields.filter(
          sf => !mappings.some(m => m.sourceField === sf)
        )

        let previewRecords: ImportPreviewRecord[] = sourceRecords.map((sourceData, index) => {
          const mappedData = buildMappedData(sourceData, mappings)
          const issues = validateRecord(mappedData, batch.targetEntity)
          const hasErrors = issues.some(i => i.severity === 'error')
          const hasWarnings = issues.some(i => i.severity === 'warning')

          return {
            index,
            sourceData,
            mappedData,
            issues,
            status: hasErrors ? 'error' : hasWarnings ? 'warning' : 'valid',
            action: 'skip' as ImportConflictAction,
          }
        })

        previewRecords = await checkForConflicts(previewRecords, batch.targetEntity, pkField)

        previewRecords = previewRecords.map(r => {
          const hasDuplicateKeyIssue = r.issues.some(i => i.type === 'duplicate_key')
          let action: ImportConflictAction = 'overwrite'
          if (r.status === 'error' || hasDuplicateKeyIssue) {
            action = 'skip'
          } else if (r.conflictType === 'will_overwrite') {
            action = 'skip'
          }
          return { ...r, action }
        })

        const validRecords = previewRecords.filter(r => r.status === 'valid').length
        const warningRecords = previewRecords.filter(r => r.status === 'warning').length
        const errorRecords = previewRecords.filter(r => r.status === 'error').length
        const duplicateKeyCount = previewRecords.filter(r =>
          r.issues.some(i => i.type === 'duplicate_key')
        ).length
        const willOverwriteCount = previewRecords.filter(r => r.conflictType === 'will_overwrite').length

        const previewResult: ImportPreviewResult = {
          batchId,
          targetEntity: batch.targetEntity,
          totalRecords: sourceRecords.length,
          validRecords,
          warningRecords,
          errorRecords,
          fieldMapping: mappings,
          unmappedSourceFields: unmappedSource,
          missingRequiredFields: missingRequired,
          duplicateKeyCount,
          willOverwriteCount,
          records: previewRecords,
          primaryKeyField: pkField,
          createdAt: Date.now(),
        }

        const updatedBatch: ImportBatch = {
          ...batch,
          status: 'previewed',
          totalRecords: sourceRecords.length,
          fieldMapping: mappings,
          primaryKeyField: pkField,
          previewResult,
          configSnapshot: {
            ...batch.configSnapshot,
            fieldMapping: mappings,
            primaryKeyField: pkField,
            totalRecords: sourceRecords.length,
          },
          importLog: [
            ...(batch.importLog || []),
            {
              timestamp: Date.now(),
              step: 'preview',
              message: `预演完成：共 ${sourceRecords.length} 条记录，${validRecords} 条有效，${warningRecords} 条警告，${errorRecords} 条错误`,
              severity: errorRecords > 0 ? 'warning' : 'info',
            },
          ],
        }

        await db.importBatches.put(updatedBatch)
        set((state) => ({
          batches: state.batches.map(b => (b.id === batchId ? updatedBatch : b)),
          currentPreview: previewResult,
        }))

        return previewResult
      },

      confirmImport: async (batchId, conflictAction, recordActions) => {
        const batch = await db.importBatches.get(batchId)
        if (!batch) throw new Error('批次不存在')
        if (!batch.previewResult) throw new Error('请先执行预演')

        const updatedRecords = batch.previewResult.records.map(r => {
          const customAction = recordActions?.[r.index]
          if (customAction) {
            return { ...r, action: customAction }
          }
          const hasDuplicateKey = r.issues.some(i => i.type === 'duplicate_key')
          if (r.status === 'error' || hasDuplicateKey) {
            return { ...r, action: 'skip' as ImportConflictAction }
          }
          if (r.conflictType === 'will_overwrite') {
            return { ...r, action: conflictAction }
          }
          return { ...r, action: 'overwrite' as ImportConflictAction }
        })

        const pendingCount = updatedRecords.filter(r => r.action === 'pending').length
        const skipCount = updatedRecords.filter(
          r => r.action === 'skip' || r.status === 'error' || r.issues.some(i => i.type === 'duplicate_key')
        ).length
        const importCount = updatedRecords.filter(
          r => r.action !== 'skip' && r.action !== 'pending' && r.status !== 'error'
        ).length

        const updatedPreview: ImportPreviewResult = {
          ...batch.previewResult,
          records: updatedRecords,
        }

        const updatedBatch: ImportBatch = {
          ...batch,
          status: 'pending_confirmation',
          conflictAction,
          pendingRecords: pendingCount,
          skippedRecords: skipCount,
          previewResult: updatedPreview,
          configSnapshot: {
            ...batch.configSnapshot,
            conflictAction,
          },
          importLog: [
            ...(batch.importLog || []),
            {
              timestamp: Date.now(),
              step: 'confirm',
              message: `确认导入配置：将导入 ${importCount} 条，跳过 ${skipCount} 条，待处理 ${pendingCount} 条`,
              severity: 'info',
            },
          ],
        }

        await db.importBatches.put(updatedBatch)
        set((state) => ({
          batches: state.batches.map(b => (b.id === batchId ? updatedBatch : b)),
          currentPreview: updatedPreview,
        }))
      },

      executeImport: async (batchId) => {
        const batch = await db.importBatches.get(batchId)
        if (!batch) throw new Error('批次不存在')
        if (!batch.previewResult) throw new Error('请先执行预演')

        set((state) => ({
          pendingBatches: new Set([...state.pendingBatches, batchId]),
        }))

        const updatedBatch: ImportBatch = {
          ...batch,
          status: 'importing',
          startedAt: Date.now(),
          progress: 0,
          processedRecords: 0,
          successRecords: 0,
          failedRecords: 0,
          importLog: [
            ...(batch.importLog || []),
            {
              timestamp: Date.now(),
              step: 'import_start',
              message: '开始执行导入...',
              severity: 'info',
            },
          ],
        }
        await db.importBatches.put(updatedBatch)
        set((state) => ({
          batches: state.batches.map(b => (b.id === batchId ? updatedBatch : b)),
        }))

        try {
          const recordsToImport = batch.previewResult.records.filter(
            r => r.action !== 'skip' && r.action !== 'pending' && r.status !== 'error'
          )

          const importedRecordIds: string[] = []
          const overwrittenRecordSnapshots: Array<{
            recordId: string
            before: Record<string, unknown>
            after: Record<string, unknown>
          }> = []

          const table = db[batch.targetEntity as keyof typeof db] as Dexie.Table<Record<string, unknown>, string>
          if (!table) {
            throw new Error(`目标数据表不存在：${batch.targetEntity}`)
          }

          let successCount = 0
          let failCount = 0
          const importLog = [...(updatedBatch.importLog || [])]

          for (let i = 0; i < recordsToImport.length; i++) {
            const record = recordsToImport[i]
            const pk = String(record.mappedData[batch.primaryKeyField] || '')

            try {
              let existingRecord: Record<string, unknown> | undefined
              try {
                existingRecord = await table.get(pk)
              } catch {
                // ignore
              }

              if (existingRecord && record.action !== 'overwrite') {
                failCount++
                importLog.push({
                  timestamp: Date.now(),
                  step: `import_record_${i}`,
                  message: `记录 ${pk} 已存在且未选择覆盖，已跳过`,
                  severity: 'warning',
                })
              } else {
                const dataToWrite = { ...record.mappedData }

                if (batch.targetEntity === 'tasks') {
                  const now = Date.now()
                  dataToWrite.createdAt = dataToWrite.createdAt || now
                  dataToWrite.updatedAt = now
                }

                if (existingRecord) {
                  overwrittenRecordSnapshots.push({
                    recordId: pk,
                    before: existingRecord,
                    after: dataToWrite,
                  })
                }

                await table.put(dataToWrite)
                importedRecordIds.push(pk)
                successCount++
              }
            } catch (err) {
              failCount++
              importLog.push({
                timestamp: Date.now(),
                step: `import_record_${i}`,
                message: `记录 ${pk} 导入失败：${err instanceof Error ? err.message : '未知错误'}`,
                severity: 'error',
              })
            }

            const progress = Math.round(((i + 1) / recordsToImport.length) * 100)
            const progressBatch: ImportBatch = {
              ...(await db.importBatches.get(batchId))!,
              progress,
              processedRecords: i + 1,
              successRecords: successCount,
              failedRecords: failCount,
            }
            await db.importBatches.put(progressBatch)
            set((state) => ({
              batches: state.batches.map(b => (b.id === batchId ? progressBatch : b)),
            }))

            await new Promise(resolve => setTimeout(resolve, 10))
          }

          const finalStatus: ImportBatchStatus =
            failCount === 0 ? 'success' : successCount > 0 ? 'partial_success' : 'failed'

          importLog.push({
            timestamp: Date.now(),
            step: 'import_complete',
            message: `导入完成：成功 ${successCount} 条，失败 ${failCount} 条`,
            severity: failCount === 0 ? 'info' : successCount > 0 ? 'warning' : 'error',
          })

          const finalBatch: ImportBatch = {
            ...(await db.importBatches.get(batchId))!,
            status: finalStatus,
            completedAt: Date.now(),
            successRecords: successCount,
            failedRecords: failCount,
            importedRecordIds,
            overwrittenRecordSnapshots,
            importLog,
          }

          await db.importBatches.put(finalBatch)
          set((state) => ({
            batches: state.batches.map(b => (b.id === batchId ? finalBatch : b)),
            pendingBatches: (() => {
              const s = new Set(state.pendingBatches)
              s.delete(batchId)
              return s
            })(),
          }))
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : '导入失败'
          const errorBatch: ImportBatch = {
            ...(await db.importBatches.get(batchId))!,
            status: 'failed',
            completedAt: Date.now(),
            errorMessage: errorMsg,
            importLog: [
              ...(updatedBatch.importLog || []),
              {
                timestamp: Date.now(),
                step: 'import_error',
                message: errorMsg,
                severity: 'error',
              },
            ],
          }

          await db.importBatches.put(errorBatch)
          set((state) => ({
            batches: state.batches.map(b => (b.id === batchId ? errorBatch : b)),
            pendingBatches: (() => {
              const s = new Set(state.pendingBatches)
              s.delete(batchId)
              return s
            })(),
            importError: errorMsg,
          }))
        }
      },

      rollbackBatch: async (batchId, rolledBackBy, reason) => {
        const batch = await db.importBatches.get(batchId)
        if (!batch) throw new Error('批次不存在')

        if (batch.status !== 'success' && batch.status !== 'partial_success') {
          throw new Error('只有成功或部分成功的批次才能回滚')
        }

        set((state) => ({
          rollingBackBatches: new Set([...state.rollingBackBatches, batchId]),
        }))

        const rollbackLog: Array<{
          timestamp: number
          step: string
          message: string
          severity: 'info' | 'warning' | 'error'
        }> = [
          {
            timestamp: Date.now(),
            step: 'rollback_start',
            message: reason ? `开始回滚：${reason}` : '开始回滚',
            severity: 'info',
          },
        ]

        const rollingBackBatch: ImportBatch = {
          ...batch,
          status: 'rolling_back',
          rollbackLog,
        }
        await db.importBatches.put(rollingBackBatch)
        set((state) => ({
          batches: state.batches.map(b => (b.id === batchId ? rollingBackBatch : b)),
        }))

        try {
          const table = db[batch.targetEntity as keyof typeof db] as Dexie.Table<Record<string, unknown>, string>
          if (!table) throw new Error(`目标数据表不存在：${batch.targetEntity}`)

          let successCount = 0
          let failCount = 0

          if (batch.overwrittenRecordSnapshots && batch.overwrittenRecordSnapshots.length > 0) {
            for (const snapshot of batch.overwrittenRecordSnapshots) {
              try {
                await table.put(snapshot.before)
                successCount++
              } catch (err) {
                failCount++
                rollbackLog.push({
                  timestamp: Date.now(),
                  step: 'rollback_restore',
                  message: `恢复记录 ${snapshot.recordId} 失败：${err instanceof Error ? err.message : '未知错误'}`,
                  severity: 'error',
                })
              }
            }
          }

          if (batch.importedRecordIds && batch.importedRecordIds.length > 0) {
            const overwrittenIds = new Set(
              batch.overwrittenRecordSnapshots?.map(s => s.recordId) || []
            )
            const newRecordIds = batch.importedRecordIds.filter(id => !overwrittenIds.has(id))

            for (const recordId of newRecordIds) {
              try {
                await table.delete(recordId)
                successCount++
              } catch (err) {
                failCount++
                rollbackLog.push({
                  timestamp: Date.now(),
                  step: 'rollback_delete',
                  message: `删除记录 ${recordId} 失败：${err instanceof Error ? err.message : '未知错误'}`,
                  severity: 'error',
                })
              }
            }
          }

          rollbackLog.push({
            timestamp: Date.now(),
            step: 'rollback_complete',
            message: `回滚完成：成功 ${successCount} 条，失败 ${failCount} 条`,
            severity: failCount === 0 ? 'info' : 'warning',
          })

          const finalBatch: ImportBatch = {
            ...batch,
            status: 'rolled_back',
            rollbackInfo: {
              rolledBackAt: Date.now(),
              rolledBackBy,
              recordCount: batch.importedRecordIds?.length || 0,
              successCount,
              failedCount: failCount,
              reason,
            },
            rollbackLog,
          }

          await db.importBatches.put(finalBatch)
          set((state) => ({
            batches: state.batches.map(b => (b.id === batchId ? finalBatch : b)),
            rollingBackBatches: (() => {
              const s = new Set(state.rollingBackBatches)
              s.delete(batchId)
              return s
            })(),
          }))
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : '回滚失败'
          rollbackLog.push({
            timestamp: Date.now(),
            step: 'rollback_error',
            message: errorMsg,
            severity: 'error',
          })

          const errorBatch: ImportBatch = {
            ...batch,
            status: 'partial_success',
            errorMessage: errorMsg,
            rollbackLog,
          }

          await db.importBatches.put(errorBatch)
          set((state) => ({
            batches: state.batches.map(b => (b.id === batchId ? errorBatch : b)),
            rollingBackBatches: (() => {
              const s = new Set(state.rollingBackBatches)
              s.delete(batchId)
              return s
            })(),
            importError: errorMsg,
          }))

          throw new Error(errorMsg)
        }
      },

      updateBatchStatus: async (batchId, status, errorMessage) => {
        const batch = await db.importBatches.get(batchId)
        if (!batch) return

        const updated: ImportBatch = {
          ...batch,
          status,
          errorMessage: errorMessage || batch.errorMessage,
        }

        await db.importBatches.put(updated)
        set((state) => ({
          batches: state.batches.map(b => (b.id === batchId ? updated : b)),
        }))
      },

      getBatchById: (batchId) => {
        const state = get()
        const batch = state.batches.find(b => b.id === batchId)
        return batch ? normalizeImportBatch(batch) : null
      },

      setCurrentBatchId: (id) => set({ currentBatchId: id }),
      setCurrentPreview: (preview) => set({ currentPreview: preview }),
      setImportError: (error) => set({ importError: error }),
      clearImportError: () => set({ importError: null }),

      loadPersistedData: () => {
        get().markInterruptedBatches()
      },

      markInterruptedBatches: async () => {
        const state = get()
        const pending = state.pendingBatches
        const rollingBack = state.rollingBackBatches

        for (const batchId of pending) {
          try {
            const batch = await db.importBatches.get(batchId)
            if (batch && batch.status === 'importing') {
              const updated: ImportBatch = {
                ...batch,
                status: 'interrupted',
                completedAt: Date.now(),
                errorMessage: '导入被中断，可能是页面刷新或关闭导致',
                importLog: [
                  ...(batch.importLog || []),
                  {
                    timestamp: Date.now(),
                    step: 'interrupted',
                    message: '导入被中断，可能是页面刷新或关闭导致',
                    severity: 'warning',
                  },
                ],
              }
              await db.importBatches.put(updated)
            }
          } catch {
            // ignore
          }
        }

        for (const batchId of rollingBack) {
          try {
            const batch = await db.importBatches.get(batchId)
            if (batch && batch.status === 'rolling_back') {
              const updated: ImportBatch = {
                ...batch,
                status: 'partial_success',
                errorMessage: '回滚被中断，请检查数据一致性',
              }
              await db.importBatches.put(updated)
            }
          } catch {
            // ignore
          }
        }

        set({
          pendingBatches: new Set(),
          rollingBackBatches: new Set(),
        })
      },
    }),
    {
      name: IMPORT_PERSIST_KEY,
      partialize: (state) => ({
        pendingBatches: Array.from(state.pendingBatches),
        rollingBackBatches: Array.from(state.rollingBackBatches),
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          const pb = state.pendingBatches as unknown
          if (Array.isArray(pb)) {
            state.pendingBatches = new Set(pb)
          } else if (!(state.pendingBatches instanceof Set)) {
            state.pendingBatches = new Set()
          }

          const rb = state.rollingBackBatches as unknown
          if (Array.isArray(rb)) {
            state.rollingBackBatches = new Set(rb)
          } else if (!(state.rollingBackBatches instanceof Set)) {
            state.rollingBackBatches = new Set()
          }
        }
      },
    }
  )
)

export { targetEntityConfig, parseCSV, autoMapFields, validateRecord, normalizeImportBatch }
