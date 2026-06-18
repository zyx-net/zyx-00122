import { create } from 'zustand'
import { db } from '@/db'
import type { Template, CheckPoint, CheckItem } from '@/types'

interface TemplateState {
  templates: Template[]
  loading: boolean
  fetchTemplates: () => Promise<void>
  getTemplate: (id: string) => Promise<Template | undefined>
  createTemplate: (template: Omit<Template, 'id' | 'createdAt' | 'updatedAt'>) => Promise<string>
  updateTemplate: (id: string, updates: Partial<Template>) => Promise<void>
  addCheckPoint: (templateId: string, checkpoint: Omit<CheckPoint, 'id'>) => Promise<void>
  updateCheckPoint: (templateId: string, checkpointId: string, updates: Partial<CheckPoint>) => Promise<void>
  removeCheckPoint: (templateId: string, checkpointId: string) => Promise<void>
  addCheckItem: (templateId: string, checkpointId: string, item: Omit<CheckItem, 'id'>) => Promise<void>
  updateCheckItem: (templateId: string, checkpointId: string, itemId: string, updates: Partial<CheckItem>) => Promise<void>
  removeCheckItem: (templateId: string, checkpointId: string, itemId: string) => Promise<void>
}

export const useTemplateStore = create<TemplateState>((set) => ({
  templates: [],
  loading: false,

  fetchTemplates: async () => {
    set({ loading: true })
    const templates = await db.templates.toArray()
    set({ templates, loading: false })
  },

  getTemplate: async (id) => {
    return db.templates.get(id)
  },

  createTemplate: async (data) => {
    const now = Date.now()
    const id = `tpl-${now}-${Math.random().toString(36).slice(2, 7)}`
    const template: Template = { ...data, id, createdAt: now, updatedAt: now }
    await db.templates.add(template)
    set((s) => ({ templates: [...s.templates, template] }))
    return id
  },

  updateTemplate: async (id, updates) => {
    const now = Date.now()
    const existing = await db.templates.get(id)
    if (!existing) throw new Error('模板不存在')
    const updated = { ...existing, ...updates, updatedAt: now }
    await db.templates.put(updated)
    set((s) => ({ templates: s.templates.map((t) => (t.id === id ? updated : t)) }))
  },

  addCheckPoint: async (templateId, checkpoint) => {
    const template = await db.templates.get(templateId)
    if (!template) throw new Error('模板不存在')
    const now = Date.now()
    const cp: CheckPoint = { ...checkpoint, id: `cp-${now}-${Math.random().toString(36).slice(2, 7)}` }
    const updated = { ...template, checkpoints: [...template.checkpoints, cp], updatedAt: now }
    await db.templates.put(updated)
    set((s) => ({ templates: s.templates.map((t) => (t.id === templateId ? updated : t)) }))
  },

  updateCheckPoint: async (templateId, checkpointId, updates) => {
    const template = await db.templates.get(templateId)
    if (!template) throw new Error('模板不存在')
    const now = Date.now()
    const checkpoints = template.checkpoints.map((cp) => (cp.id === checkpointId ? { ...cp, ...updates } : cp))
    const updated = { ...template, checkpoints, updatedAt: now }
    await db.templates.put(updated)
    set((s) => ({ templates: s.templates.map((t) => (t.id === templateId ? updated : t)) }))
  },

  removeCheckPoint: async (templateId, checkpointId) => {
    const template = await db.templates.get(templateId)
    if (!template) throw new Error('模板不存在')
    const now = Date.now()
    const checkpoints = template.checkpoints.filter((cp) => cp.id !== checkpointId)
    const updated = { ...template, checkpoints, updatedAt: now }
    await db.templates.put(updated)
    set((s) => ({ templates: s.templates.map((t) => (t.id === templateId ? updated : t)) }))
  },

  addCheckItem: async (templateId, checkpointId, item) => {
    const template = await db.templates.get(templateId)
    if (!template) throw new Error('模板不存在')
    const now = Date.now()
    const ci: CheckItem = { ...item, id: `ci-${now}-${Math.random().toString(36).slice(2, 7)}` }
    const checkpoints = template.checkpoints.map((cp) =>
      cp.id === checkpointId ? { ...cp, items: [...cp.items, ci] } : cp
    )
    const updated = { ...template, checkpoints, updatedAt: now }
    await db.templates.put(updated)
    set((s) => ({ templates: s.templates.map((t) => (t.id === templateId ? updated : t)) }))
  },

  updateCheckItem: async (templateId, checkpointId, itemId, updates) => {
    const template = await db.templates.get(templateId)
    if (!template) throw new Error('模板不存在')
    const now = Date.now()
    const checkpoints = template.checkpoints.map((cp) =>
      cp.id === checkpointId
        ? { ...cp, items: cp.items.map((ci) => (ci.id === itemId ? { ...ci, ...updates } : ci)) }
        : cp
    )
    const updated = { ...template, checkpoints, updatedAt: now }
    await db.templates.put(updated)
    set((s) => ({ templates: s.templates.map((t) => (t.id === templateId ? updated : t)) }))
  },

  removeCheckItem: async (templateId, checkpointId, itemId) => {
    const template = await db.templates.get(templateId)
    if (!template) throw new Error('模板不存在')
    const now = Date.now()
    const checkpoints = template.checkpoints.map((cp) =>
      cp.id === checkpointId ? { ...cp, items: cp.items.filter((ci) => ci.id !== itemId) } : cp
    )
    const updated = { ...template, checkpoints, updatedAt: now }
    await db.templates.put(updated)
    set((s) => ({ templates: s.templates.map((t) => (t.id === templateId ? updated : t)) }))
  },
}))
