import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { db } from '@/db'
import type {
  AuthorizationPerson,
  AuthorizationSnapshot,
  AuthorizationTemplate,
  BatchAuthorization,
  DesensitizedBatchSummary,
  ImportBatch,
  OperationTimelineAction,
  OperationTimelineEntry,
  SystemUser,
  UserRole,
} from '@/types'

const AUTH_PERSIST_KEY = 'inspection-authorization-ledger'

export const SYSTEM_USERS: SystemUser[] = [
  { username: 'admin', displayName: '管理员', role: 'admin' },
  { username: 'inspector_zhangsan', displayName: '巡检员张三', role: 'inspector' },
  { username: 'inspector_lisi', displayName: '巡检员李四', role: 'inspector' },
  { username: 'inspector_wangwu', displayName: '巡检员王五', role: 'inspector' },
  { username: 'manager_zhao', displayName: '主管赵六', role: 'inspector' },
  { username: 'auditor_sun', displayName: '审计员孙七', role: 'inspector' },
]

export function getUserByUsername(username: string): SystemUser | undefined {
  return SYSTEM_USERS.find(u => u.username === username)
}

export function getUsersByRole(role: UserRole): SystemUser[] {
  return SYSTEM_USERS.filter(u => u.role === role)
}

function hashContent(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return Math.abs(hash).toString(16).padStart(8, '0')
}

function genId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function createPerson(username: string, grantedBy: string): AuthorizationPerson {
  const user = SYSTEM_USERS.find(u => u.username === username)
  return {
    username,
    displayName: user?.displayName || username,
    grantedAt: Date.now(),
    grantedBy,
  }
}

function createSnapshot(
  auth: BatchAuthorization,
  createdBy: string
): AuthorizationSnapshot {
  return {
    id: genId('snap'),
    batchId: auth.batchId,
    viewers: JSON.parse(JSON.stringify(auth.viewers)),
    rollbackers: JSON.parse(JSON.stringify(auth.rollbackers)),
    handoverPersons: JSON.parse(JSON.stringify(auth.handoverPersons)),
    expiresAt: auth.expiresAt,
    notes: auth.notes,
    configVersion: auth.configVersion,
    createdAt: Date.now(),
    createdBy,
    immutable: true,
  }
}

function createTimelineEntry(params: {
  batchId?: string
  templateId?: string
  action: OperationTimelineAction
  actor: string
  detail: string
  metadata?: Record<string, unknown>
}): OperationTimelineEntry {
  return {
    id: genId('tl'),
    batchId: params.batchId,
    templateId: params.templateId,
    action: params.action,
    actor: params.actor,
    detail: params.detail,
    timestamp: Date.now(),
    metadata: params.metadata,
  }
}

function isExpired(auth: BatchAuthorization): boolean {
  if (auth.isRevoked) return true
  if (!auth.expiresAt) return false
  return Date.now() > auth.expiresAt
}

function hasPermission(
  auth: BatchAuthorization | null | undefined,
  username: string,
  permission: 'view' | 'rollback' | 'handover' | 'export',
  role: UserRole | null
): boolean {
  if (role === 'admin') return true
  if (!auth) return false
  if (isExpired(auth)) return false
  if (auth.createdBy === username) return true

  switch (permission) {
    case 'view':
    case 'export':
      return auth.viewers.some(p => p.username === username)
        || auth.rollbackers.some(p => p.username === username)
        || auth.handoverPersons.some(p => p.username === username)
    case 'rollback':
      return auth.rollbackers.some(p => p.username === username)
    case 'handover':
      return auth.handoverPersons.some(p => p.username === username)
    default:
      return false
  }
}

export interface CreateAuthorizationParams {
  batchId: string
  viewerUsernames: string[]
  rollbackerUsernames: string[]
  handoverUsernames: string[]
  expiresAt?: number | null
  notes?: string
  createdBy: string
}

export interface UpdateAuthorizationParams {
  viewerUsernames?: string[]
  rollbackerUsernames?: string[]
  handoverUsernames?: string[]
  expiresAt?: number | null
  notes?: string
  updatedBy: string
}

export interface ImportTemplateResult {
  success: boolean
  template?: AuthorizationTemplate
  conflicts: Array<{
    type: string
    field: string
    existingValue?: unknown
    importedValue?: unknown
    message: string
  }>
}

interface AuthorizationState {
  authorizations: BatchAuthorization[]
  templates: AuthorizationTemplate[]
  timeline: OperationTimelineEntry[]
  revokedAuthorizations: BatchAuthorization[]
  loading: boolean
  error: string | null

  fetchAuthorizations: () => Promise<void>
  fetchTemplates: () => Promise<void>
  fetchTimeline: (batchId?: string, templateId?: string) => Promise<void>

  createAuthorization: (params: CreateAuthorizationParams) => Promise<BatchAuthorization>
  getAuthorizationByBatchId: (batchId: string) => BatchAuthorization | undefined
  updateAuthorization: (authId: string, params: UpdateAuthorizationParams) => Promise<void>
  revokeAuthorization: (authId: string, revokedBy: string, reason?: string) => Promise<void>
  restoreAuthorization: (authId: string, restoredBy: string) => Promise<void>
  handoverBatch: (authId: string, fromUser: string, toUser: string, actor: string) => Promise<void>

  canViewBatch: (batch: ImportBatch, username: string, role: UserRole | null) => boolean
  canRollbackBatch: (batch: ImportBatch, username: string, role: UserRole | null) => boolean
  canExportBatch: (batch: ImportBatch, username: string, role: UserRole | null) => boolean
  canHandoverBatch: (batch: ImportBatch, username: string, role: UserRole | null) => boolean

  getDesensitizedSummary: (batch: ImportBatch, username: string, role: UserRole | null) => DesensitizedBatchSummary
  checkPermission: (batchId: string, username: string, permission: 'view' | 'rollback' | 'handover' | 'export', role: UserRole | null) => boolean

  createTemplate: (params: {
    name: string
    description?: string
    viewers: string[]
    rollbackers: string[]
    handoverPersons: string[]
    defaultExpiryHours?: number
    defaultNotes?: string
    createdBy: string
  }) => Promise<AuthorizationTemplate>
  updateTemplate: (templateId: string, params: Partial<Omit<AuthorizationTemplate, 'id' | 'createdAt' | 'createdBy'>> & { updatedBy: string }) => Promise<void>
  deleteTemplate: (templateId: string) => Promise<void>
  exportTemplate: (templateId: string) => Promise<string>
  importTemplate: (jsonString: string, actor: string) => Promise<ImportTemplateResult>
  applyTemplate: (templateId: string, batchId: string, actor: string) => Promise<void>

  getSystemUsers: () => typeof SYSTEM_USERS

  addTimelineEntry: (entry: OperationTimelineEntry) => Promise<void>
  clearError: () => void
}

export const useAuthorizationStore = create<AuthorizationState>()(
  persist(
    (set, get) => ({
      authorizations: [],
      templates: [],
      timeline: [],
      revokedAuthorizations: [],
      loading: false,
      error: null,

      fetchAuthorizations: async () => {
        try {
          const all = await db.batchAuthorizations
            .orderBy('createdAt')
            .reverse()
            .toArray()
          set({
            authorizations: all.filter(a => !a.isRevoked),
            revokedAuthorizations: all.filter(a => a.isRevoked),
          })
        } catch (err) {
          set({ error: err instanceof Error ? err.message : '获取授权列表失败' })
        }
      },

      fetchTemplates: async () => {
        try {
          const templates = await db.authorizationTemplates
            .orderBy('createdAt')
            .reverse()
            .toArray()
          set({ templates })
        } catch (err) {
          set({ error: err instanceof Error ? err.message : '获取模板列表失败' })
        }
      },

      fetchTimeline: async (batchId, templateId) => {
        try {
          let query = db.operationTimeline.orderBy('timestamp').reverse()
          if (batchId) {
            query = db.operationTimeline.where('batchId').equals(batchId).reverse()
          } else if (templateId) {
            query = db.operationTimeline.where('templateId').equals(templateId).reverse()
          }
          const timeline = await query.limit(200).toArray()
          set({ timeline })
        } catch (err) {
          set({ error: err instanceof Error ? err.message : '获取操作时间线失败' })
        }
      },

      createAuthorization: async (params) => {
        const now = Date.now()
        const authId = genId('auth')

        const createdBy = params.createdBy
        const viewers = params.viewerUsernames.map(u => createPerson(u, createdBy))
        const rollbackers = params.rollbackerUsernames.map(u => createPerson(u, createdBy))
        const handoverPersons = params.handoverUsernames.map(u => createPerson(u, createdBy))

        const initialTimeline = createTimelineEntry({
          batchId: params.batchId,
          action: 'auth_create',
          actor: createdBy,
          detail: `创建批次授权：查看人${viewers.length}人、回滚人${rollbackers.length}人、接手人${handoverPersons.length}人`,
          metadata: {
            viewerCount: viewers.length,
            rollbackerCount: rollbackers.length,
            handoverCount: handoverPersons.length,
            expiresAt: params.expiresAt || null,
          },
        })

        const auth: BatchAuthorization = {
          id: authId,
          batchId: params.batchId,
          viewers,
          rollbackers,
          handoverPersons,
          expiresAt: params.expiresAt ?? null,
          notes: params.notes ?? '',
          configVersion: 1,
          snapshots: [],
          timeline: [initialTimeline],
          isRevoked: false,
          createdAt: now,
          createdBy,
          updatedAt: now,
          lastSnapshotAt: now,
        }

        auth.snapshots = [createSnapshot(auth, createdBy)]

        await db.batchAuthorizations.add(auth)
        await db.operationTimeline.add(initialTimeline)

        await db.importBatches.update(params.batchId, { authorizationId: authId })

        set(state => ({
          authorizations: [auth, ...state.authorizations],
        }))

        return auth
      },

      getAuthorizationByBatchId: (batchId) => {
        const state = get()
        const fromState = state.authorizations.find(a => a.batchId === batchId)
          || state.revokedAuthorizations.find(a => a.batchId === batchId)
        if (fromState) return fromState
        return undefined
      },

      updateAuthorization: async (authId, params) => {
        const auth = await db.batchAuthorizations.get(authId)
        if (!auth) throw new Error('授权记录不存在')
        if (auth.isRevoked) throw new Error('已撤销的授权不能修改')

        const now = Date.now()
        const { updatedBy, ...rest } = params
        const changes: Partial<BatchAuthorization> = { updatedAt: now }

        if (rest.viewerUsernames !== undefined) {
          changes.viewers = rest.viewerUsernames.map(u => createPerson(u, updatedBy))
        }
        if (rest.rollbackerUsernames !== undefined) {
          changes.rollbackers = rest.rollbackerUsernames.map(u => createPerson(u, updatedBy))
        }
        if (rest.handoverUsernames !== undefined) {
          changes.handoverPersons = rest.handoverUsernames.map(u => createPerson(u, updatedBy))
        }
        if (rest.expiresAt !== undefined) {
          changes.expiresAt = rest.expiresAt
        }
        if (rest.notes !== undefined) {
          changes.notes = rest.notes
        }

        const newVersion = auth.configVersion + 1
        changes.configVersion = newVersion

        const updatedAuth: BatchAuthorization = { ...auth, ...changes }
        const snapshot = createSnapshot(updatedAuth, updatedBy)
        updatedAuth.snapshots = [...auth.snapshots, snapshot]
        updatedAuth.lastSnapshotAt = now

        const timelineEntry = createTimelineEntry({
          batchId: auth.batchId,
          action: 'auth_update',
          actor: updatedBy,
          detail: `更新授权配置（版本 v${newVersion}）`,
          metadata: {
            oldVersion: auth.configVersion,
            newVersion,
            changedFields: Object.keys(rest).filter(k => k !== 'updatedBy'),
          },
        })
        updatedAuth.timeline = [...auth.timeline, timelineEntry]

        await db.batchAuthorizations.put(updatedAuth)
        await db.operationTimeline.add(timelineEntry)

        set(state => ({
          authorizations: state.authorizations.map(a => a.id === authId ? updatedAuth : a),
        }))
      },

      revokeAuthorization: async (authId, revokedBy, reason) => {
        const auth = await db.batchAuthorizations.get(authId)
        if (!auth) throw new Error('授权记录不存在')
        if (auth.isRevoked) throw new Error('授权已撤销')

        const now = Date.now()
        const revoked: BatchAuthorization = {
          ...auth,
          isRevoked: true,
          revokedAt: now,
          revokedBy,
          revokeReason: reason,
          updatedAt: now,
        }

        const timelineEntry = createTimelineEntry({
          batchId: auth.batchId,
          action: 'auth_revoke',
          actor: revokedBy,
          detail: reason ? `撤销授权：${reason}` : '撤销授权',
          metadata: { reason: reason || null },
        })
        revoked.timeline = [...auth.timeline, timelineEntry]

        await db.batchAuthorizations.put(revoked)
        await db.operationTimeline.add(timelineEntry)

        set(state => ({
          authorizations: state.authorizations.filter(a => a.id !== authId),
          revokedAuthorizations: [revoked, ...state.revokedAuthorizations],
        }))
      },

      restoreAuthorization: async (authId, restoredBy) => {
        const auth = await db.batchAuthorizations.get(authId)
        if (!auth) throw new Error('授权记录不存在')
        if (!auth.isRevoked) throw new Error('授权未被撤销')

        const now = Date.now()
        const restored: BatchAuthorization = {
          ...auth,
          isRevoked: false,
          revokedAt: undefined,
          revokedBy: undefined,
          revokeReason: undefined,
          updatedAt: now,
        }

        const timelineEntry = createTimelineEntry({
          batchId: auth.batchId,
          action: 'auth_restore',
          actor: restoredBy,
          detail: '恢复已撤销的授权',
        })
        restored.timeline = [...auth.timeline, timelineEntry]

        await db.batchAuthorizations.put(restored)
        await db.operationTimeline.add(timelineEntry)

        set(state => ({
          authorizations: [restored, ...state.authorizations],
          revokedAuthorizations: state.revokedAuthorizations.filter(a => a.id !== authId),
        }))
      },

      handoverBatch: async (authId, fromUser, toUser, actor) => {
        const auth = await db.batchAuthorizations.get(authId)
        if (!auth) throw new Error('授权记录不存在')
        if (auth.isRevoked) throw new Error('已撤销的授权不能交接')

        const now = Date.now()
        const newVersion = auth.configVersion + 1

        const fromPerson = auth.handoverPersons.find(p => p.username === fromUser)
          || auth.rollbackers.find(p => p.username === fromUser)
          || auth.viewers.find(p => p.username === fromUser)

        if (!fromPerson && actor !== auth.createdBy && fromUser !== auth.createdBy) {
          throw new Error('交接发起方没有权限')
        }

        const toPerson = createPerson(toUser, actor)

        const updated: BatchAuthorization = {
          ...auth,
          viewers: auth.viewers.some(p => p.username === toUser)
            ? auth.viewers
            : [...auth.viewers, toPerson],
          rollbackers: auth.rollbackers.some(p => p.username === toUser)
            ? auth.rollbackers.filter(p => p.username !== fromUser)
            : [...auth.rollbackers.filter(p => p.username !== fromUser), toPerson],
          handoverPersons: auth.handoverPersons.map(p =>
            p.username === fromUser ? toPerson : p
          ).filter(p => p.username !== fromUser).concat(
            !auth.handoverPersons.some(p => p.username === toUser) ? [toPerson] : []
          ),
          configVersion: newVersion,
          updatedAt: now,
        }

        updated.snapshots = [...auth.snapshots, createSnapshot(updated, actor)]
        updated.lastSnapshotAt = now

        const fromDisplay = SYSTEM_USERS.find(u => u.username === fromUser)?.displayName || fromUser
        const toDisplay = SYSTEM_USERS.find(u => u.username === toUser)?.displayName || toUser

        const timelineEntry = createTimelineEntry({
          batchId: auth.batchId,
          action: 'batch_handover',
          actor,
          detail: `批次从 ${fromDisplay} 交接给 ${toDisplay}`,
          metadata: { fromUser, toUser },
        })
        updated.timeline = [...auth.timeline, timelineEntry]

        await db.batchAuthorizations.put(updated)
        await db.operationTimeline.add(timelineEntry)

        set(state => ({
          authorizations: state.authorizations.map(a => a.id === authId ? updated : a),
        }))
      },

      canViewBatch: (batch, username, role) => {
        const auth = get().getAuthorizationByBatchId(batch.id)
        if (!auth) {
          if (role === 'admin') return true
          return batch.permissionScope !== 'admin'
        }
        return hasPermission(auth, username, 'view', role)
      },

      canRollbackBatch: (batch, username, role) => {
        const auth = get().getAuthorizationByBatchId(batch.id)
        if (!auth) {
          if (role === 'admin') return true
          if (batch.permissionScope === 'admin') return false
          return batch.createdBy === username
        }
        return hasPermission(auth, username, 'rollback', role)
      },

      canExportBatch: (batch, username, role) => {
        const auth = get().getAuthorizationByBatchId(batch.id)
        if (!auth) {
          if (role === 'admin') return true
          return batch.permissionScope !== 'admin'
        }
        return hasPermission(auth, username, 'export', role)
      },

      canHandoverBatch: (batch, username, role) => {
        const auth = get().getAuthorizationByBatchId(batch.id)
        if (!auth) {
          return role === 'admin' || batch.createdBy === username
        }
        return hasPermission(auth, username, 'handover', role)
      },

      getDesensitizedSummary: (batch, username, role) => {
        const auth = get().getAuthorizationByBatchId(batch.id)
        let authHint = '需要申请权限后查看详情'

        if (auth) {
          if (auth.isRevoked) {
            authHint = `授权已撤销（${auth.revokedBy || '系统'}，原因：${auth.revokeReason || '未说明'}）`
          } else if (isExpired(auth)) {
            authHint = `授权已过期（过期时间：${auth.expiresAt ? new Date(auth.expiresAt).toLocaleString('zh-CN') : '-'})`
          } else {
            const names = [...auth.viewers, ...auth.rollbackers, ...auth.handoverPersons]
              .map(p => p.displayName || p.username)
            const uniqueNames = [...new Set(names)]
            authHint = `已授权给 ${uniqueNames.slice(0, 3).join('、')}${uniqueNames.length > 3 ? ' 等' : ''}`
          }
        } else {
          authHint = batch.permissionScope === 'admin'
            ? '仅管理员可见'
            : '尚未配置按人授权，按角色规则可见'
        }

        return {
          batchId: batch.id,
          batchName: batch.batchName.replace(/./g, '*').slice(0, Math.max(4, Math.floor(batch.batchName.length / 2))) + '***',
          targetEntity: batch.targetEntity,
          status: batch.status,
          createdAt: batch.createdAt,
          createdBy: batch.createdBy ? batch.createdBy.slice(0, 1) + '**' : '***',
          totalRecords: batch.totalRecords,
          isAuthorized: false,
          authHint,
        }
      },

      checkPermission: (batchId, username, permission, role) => {
        const auth = get().getAuthorizationByBatchId(batchId)
        if (!auth) return role === 'admin'
        return hasPermission(auth, username, permission, role)
      },

      createTemplate: async (params) => {
        const now = Date.now()
        const id = genId('tpl-auth')
        const content = JSON.stringify({
          viewers: params.viewers,
          rollbackers: params.rollbackers,
          handoverPersons: params.handoverPersons,
          defaultExpiryHours: params.defaultExpiryHours,
          defaultNotes: params.defaultNotes,
        })

        const template: AuthorizationTemplate = {
          id,
          name: params.name,
          description: params.description,
          viewers: params.viewers,
          rollbackers: params.rollbackers,
          handoverPersons: params.handoverPersons,
          defaultExpiryHours: params.defaultExpiryHours,
          defaultNotes: params.defaultNotes,
          version: 1,
          createdAt: now,
          updatedAt: now,
          createdBy: params.createdBy,
          contentHash: hashContent(content),
        }

        const tlEntry = createTimelineEntry({
          templateId: id,
          action: 'template_export',
          actor: params.createdBy,
          detail: `创建授权模板：${params.name}`,
        })

        await db.authorizationTemplates.add(template)
        await db.operationTimeline.add(tlEntry)

        set(state => ({ templates: [template, ...state.templates] }))
        return template
      },

      updateTemplate: async (templateId, params) => {
        const template = await db.authorizationTemplates.get(templateId)
        if (!template) throw new Error('模板不存在')

        const now = Date.now()
        const { updatedBy, ...rest } = params
        const updated: AuthorizationTemplate = {
          ...template,
          ...rest,
          version: template.version + 1,
          updatedAt: now,
        }

        const newContent = JSON.stringify({
          viewers: updated.viewers,
          rollbackers: updated.rollbackers,
          handoverPersons: updated.handoverPersons,
          defaultExpiryHours: updated.defaultExpiryHours,
          defaultNotes: updated.defaultNotes,
        })
        updated.contentHash = hashContent(newContent)

        const tlEntry = createTimelineEntry({
          templateId,
          action: 'template_export',
          actor: updatedBy,
          detail: `更新授权模板：${template.name}（v${template.version} → v${updated.version}）`,
        })

        await db.authorizationTemplates.put(updated)
        await db.operationTimeline.add(tlEntry)

        set(state => ({
          templates: state.templates.map(t => t.id === templateId ? updated : t),
        }))
      },

      deleteTemplate: async (templateId) => {
        await db.authorizationTemplates.delete(templateId)
        set(state => ({
          templates: state.templates.filter(t => t.id !== templateId),
        }))
      },

      exportTemplate: async (templateId) => {
        const template = await db.authorizationTemplates.get(templateId)
        if (!template) throw new Error('模板不存在')

        const exportData = {
          schemaVersion: 1,
          exportType: 'authorization_template',
          exportedAt: Date.now(),
          template: {
            name: template.name,
            description: template.description,
            viewers: template.viewers,
            rollbackers: template.rollbackers,
            handoverPersons: template.handoverPersons,
            defaultExpiryHours: template.defaultExpiryHours,
            defaultNotes: template.defaultNotes,
            version: template.version,
            contentHash: template.contentHash,
          },
        }

        return JSON.stringify(exportData, null, 2)
      },

      importTemplate: async (jsonString, actor) => {
        const result: ImportTemplateResult = {
          success: false,
          conflicts: [],
        }

        let parsed: any
        try {
          parsed = JSON.parse(jsonString)
        } catch {
          result.conflicts.push({
            type: 'parse_error',
            field: '__root__',
            message: 'JSON 格式错误',
          })
          return result
        }

        if (parsed.exportType !== 'authorization_template') {
          result.conflicts.push({
            type: 'wrong_type',
            field: 'exportType',
            importedValue: parsed.exportType,
            message: '不是授权模板文件',
          })
          return result
        }

        const tplData = parsed.template
        if (!tplData || !tplData.name) {
          result.conflicts.push({
            type: 'missing_required',
            field: 'template.name',
            message: '缺少模板名称',
          })
          return result
        }

        const existingByName = await db.authorizationTemplates
          .where('name')
          .equals(tplData.name)
          .first()

        if (existingByName) {
          result.conflicts.push({
            type: 'duplicate_name',
            field: 'name',
            existingValue: existingByName.name,
            importedValue: tplData.name,
            message: `已存在同名模板：${tplData.name}，将自动添加后缀`,
          })
        }

        const now = Date.now()
        const newContent = JSON.stringify({
          viewers: tplData.viewers || [],
          rollbackers: tplData.rollbackers || [],
          handoverPersons: tplData.handoverPersons || [],
          defaultExpiryHours: tplData.defaultExpiryHours,
          defaultNotes: tplData.defaultNotes,
        })
        const importedHash = hashContent(newContent)

        if (tplData.contentHash && tplData.contentHash !== importedHash) {
          result.conflicts.push({
            type: 'template_version_mismatch',
            field: 'contentHash',
            existingValue: importedHash,
            importedValue: tplData.contentHash,
            message: '模板内容哈希不匹配，可能已被篡改',
          })
        }

        const invalidUsers: string[] = []
        const allUsernames = SYSTEM_USERS.map(u => u.username)
        const checkUsers = (users: string[], label: string) => {
          users.forEach(u => {
            if (!allUsernames.includes(u)) {
              invalidUsers.push(`${label}:${u}`)
            }
          })
        }
        checkUsers(tplData.viewers || [], 'viewer')
        checkUsers(tplData.rollbackers || [], 'rollbacker')
        checkUsers(tplData.handoverPersons || [], 'handover')

        if (invalidUsers.length > 0) {
          result.conflicts.push({
            type: 'unknown_user',
            field: 'users',
            importedValue: invalidUsers,
            message: `存在未知用户：${invalidUsers.join('、')}，已跳过`,
          })
        }

        const validUsers = (users: string[]) => users.filter(u => allUsernames.includes(u))

        const now2 = Date.now()
        const id = genId('tpl-auth')
        const finalName = existingByName ? `${tplData.name}（导入）` : tplData.name

        const template: AuthorizationTemplate = {
          id,
          name: finalName,
          description: tplData.description,
          viewers: validUsers(tplData.viewers || []),
          rollbackers: validUsers(tplData.rollbackers || []),
          handoverPersons: validUsers(tplData.handoverPersons || []),
          defaultExpiryHours: tplData.defaultExpiryHours,
          defaultNotes: tplData.defaultNotes,
          version: 1,
          createdAt: now2,
          updatedAt: now2,
          createdBy: actor,
          contentHash: importedHash,
        }

        const tlEntry = createTimelineEntry({
          templateId: id,
          action: 'template_import',
          actor,
          detail: `导入授权模板：${finalName}（冲突 ${result.conflicts.length} 项）`,
          metadata: { conflicts: result.conflicts.length },
        })

        await db.authorizationTemplates.add(template)
        await db.operationTimeline.add(tlEntry)

        result.success = true
        result.template = template

        set(state => ({ templates: [template, ...state.templates] }))
        return result
      },

      applyTemplate: async (templateId, batchId, actor) => {
        const template = await db.authorizationTemplates.get(templateId)
        if (!template) throw new Error('模板不存在')

        const existingAuth = await db.batchAuthorizations
          .where('batchId')
          .equals(batchId)
          .first()

        const expiresAt = template.defaultExpiryHours
          ? Date.now() + template.defaultExpiryHours * 3600 * 1000
          : null

        if (existingAuth && !existingAuth.isRevoked) {
          await get().updateAuthorization(existingAuth.id, {
            viewerUsernames: template.viewers,
            rollbackerUsernames: template.rollbackers,
            handoverUsernames: template.handoverPersons,
            expiresAt,
            notes: template.defaultNotes || existingAuth.notes,
            updatedBy: actor,
          })
        } else {
          await get().createAuthorization({
            batchId,
            viewerUsernames: template.viewers,
            rollbackerUsernames: template.rollbackers,
            handoverUsernames: template.handoverPersons,
            expiresAt,
            notes: template.defaultNotes,
            createdBy: actor,
          })
        }
      },

      getSystemUsers: () => SYSTEM_USERS,

      addTimelineEntry: async (entry) => {
        await db.operationTimeline.add(entry)
        set(state => ({ timeline: [entry, ...state.timeline].slice(0, 200) }))
      },

      clearError: () => set({ error: null }),
    }),
    {
      name: AUTH_PERSIST_KEY,
      partialize: (state) => ({
        authorizations: state.authorizations,
        templates: state.templates,
        revokedAuthorizations: state.revokedAuthorizations,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          if (!Array.isArray(state.authorizations)) state.authorizations = []
          if (!Array.isArray(state.templates)) state.templates = []
          if (!Array.isArray(state.revokedAuthorizations)) state.revokedAuthorizations = []
        }
      },
    }
  )
)

export { isExpired, hasPermission }
