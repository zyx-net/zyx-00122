import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { CurrentSessionUser, SystemUser, UserRole } from '@/types'
import { SYSTEM_USERS, getUserByUsername, getUsersByRole } from '@/stores/useAuthorizationStore'

const APP_PERSIST_KEY = 'inspection-app-session'

interface AppState {
  currentUser: CurrentSessionUser | null
  role: UserRole | null
  toasts: Array<{ id: string; message: string; type: 'success' | 'error' | 'warning' | 'info' }>

  setCurrentUser: (username: string) => void
  setRole: (role: UserRole) => void
  clearSession: () => void
  switchUser: (username: string) => void

  getSystemUsers: () => SystemUser[]
  getUsersByRole: (role: UserRole) => SystemUser[]
  getCurrentUsername: () => string
  getCurrentDisplayName: () => string

  addToast: (message: string, type?: 'success' | 'error' | 'warning' | 'info') => void
  removeToast: (id: string) => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      currentUser: null,
      role: null,
      toasts: [],

      setCurrentUser: (username) => {
        const user = getUserByUsername(username)
        if (!user) throw new Error(`未知用户: ${username}`)
        const sessionUser: CurrentSessionUser = {
          username: user.username,
          displayName: user.displayName,
          role: user.role,
          loginAt: Date.now(),
        }
        set({ currentUser: sessionUser, role: user.role })
      },

      setRole: (role) => set({ role }),

      clearSession: () => set({ currentUser: null, role: null }),

      switchUser: (username) => {
        const user = getUserByUsername(username)
        if (!user) throw new Error(`未知用户: ${username}`)
        const sessionUser: CurrentSessionUser = {
          username: user.username,
          displayName: user.displayName,
          role: user.role,
          loginAt: Date.now(),
        }
        set({ currentUser: sessionUser, role: user.role })
      },

      getSystemUsers: () => SYSTEM_USERS,

      getUsersByRole: (role) => getUsersByRole(role),

      getCurrentUsername: () => {
        const state = get()
        return state.currentUser?.username || (state.role === 'admin' ? 'admin' : '')
      },

      getCurrentDisplayName: () => {
        const state = get()
        return state.currentUser?.displayName || (state.role === 'admin' ? '管理员' : '')
      },

      addToast: (message, type = 'success') => {
        const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
        set((s) => ({ toasts: [...s.toasts, { id, message, type }] }))
        setTimeout(() => {
          set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
        }, 3500)
      },

      removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
    }),
    {
      name: APP_PERSIST_KEY,
      partialize: (state) => ({
        currentUser: state.currentUser,
        role: state.role,
      }),
      onRehydrateStorage: () => (state) => {
        if (state && state.currentUser) {
          state.role = state.currentUser.role
        }
      },
    }
  )
)

export { SYSTEM_USERS }
