import { create } from 'zustand'
import type { UserRole } from '@/types'

interface AppState {
  role: UserRole | null
  setRole: (role: UserRole) => void
  clearRole: () => void
  toasts: Array<{ id: string; message: string; type: 'success' | 'error' | 'warning' }>
  addToast: (message: string, type?: 'success' | 'error' | 'warning') => void
  removeToast: (id: string) => void
}

export const useAppStore = create<AppState>((set) => ({
  role: null,
  setRole: (role) => set({ role }),
  clearRole: () => set({ role: null }),
  toasts: [],
  addToast: (message, type = 'success') => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    set((s) => ({ toasts: [...s.toasts, { id, message, type }] }))
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
    }, 3500)
  },
  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))
