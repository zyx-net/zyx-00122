import { useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, ClipboardList, AlertTriangle, FileText, LayoutTemplate,
  CheckSquare, Shield, Upload, User, X, LogOut, ChevronDown
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SystemUser, UserRole } from '@/types'
import { useAppStore } from '@/stores/useAppStore'

interface LayoutProps {
  title?: string
  onBack?: () => void
  rightAction?: React.ReactNode
  showNav?: boolean
  navRole?: UserRole
  children?: React.ReactNode
}

const inspectorTabs = [
  { path: '/inspector/tasks', label: '任务', icon: ClipboardList },
  { path: '/inspector/anomalies', label: '异常', icon: AlertTriangle },
  { path: '/inspector/import-center', label: '导入', icon: Upload },
  { path: '/inspector/authorization-ledger', label: '授权', icon: Shield },
  { path: '/inspector/logs', label: '日志', icon: FileText },
]

const adminTabs = [
  { path: '/admin/templates', label: '模板', icon: LayoutTemplate },
  { path: '/admin/review', label: '审核', icon: CheckSquare },
  { path: '/admin/import-center', label: '导入', icon: Upload },
  { path: '/admin/authorization-ledger', label: '授权', icon: Shield },
  { path: '/admin/logs', label: '日志', icon: FileText },
]

export default function Layout({ title = '离线巡检', onBack, rightAction, showNav = false, navRole = 'inspector', children }: LayoutProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const tabs = navRole === 'admin' ? adminTabs : inspectorTabs
  const currentUser = useAppStore((s) => s.currentUser)
  const switchUser = useAppStore((s) => s.switchUser)
  const clearSession = useAppStore((s) => s.clearSession)
  const getUsersByRole = useAppStore((s) => s.getUsersByRole)

  const [activeTab, setActiveTab] = useState(location.pathname)
  const [showUserMenu, setShowUserMenu] = useState(false)

  const roleUsers = currentUser ? getUsersByRole(currentUser.role) : []

  const handleTabClick = (path: string) => {
    setActiveTab(path)
    navigate(path)
  }

  const handleSwitchUser = (user: SystemUser) => {
    switchUser(user.username)
    setShowUserMenu(false)
    if (user.role === 'inspector') {
      navigate('/inspector/tasks')
    } else {
      navigate('/admin/templates')
    }
  }

  const handleLogout = () => {
    clearSession()
    setShowUserMenu(false)
    navigate('/')
  }

  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <header className="sticky top-0 z-30 flex h-14 items-center bg-primary px-4 text-white shadow-md">
        <div className="flex w-11 items-center justify-center">
          {onBack && (
            <button onClick={onBack} className="flex h-11 w-11 items-center justify-center">
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}
        </div>
        <div className="flex-1 text-center">
          {currentUser ? (
            <button
              onClick={() => setShowUserMenu(!showUserMenu)}
              className="flex items-center justify-center gap-1 mx-auto"
              data-testid="current-user-button"
            >
              <span className="text-lg font-semibold">{title}</span>
              <ChevronDown className="h-4 w-4 opacity-70" />
            </button>
          ) : (
            <h1 className="text-lg font-semibold">{title}</h1>
          )}
          {currentUser && (
            <p className="text-[10px] opacity-75 font-mono">
              {currentUser.displayName} · {currentUser.username}
            </p>
          )}
        </div>
        <div className="flex w-11 items-center justify-center">
          {rightAction}
        </div>
      </header>

      {showUserMenu && currentUser && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-end" onClick={() => setShowUserMenu(false)}>
          <div
            className="bg-white w-72 rounded-bl-2xl shadow-xl p-4"
            onClick={(e) => e.stopPropagation()}
            data-testid="user-switch-menu"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                  <User className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900">{currentUser.displayName}</p>
                  <p className="text-xs text-gray-500 font-mono">{currentUser.username}</p>
                  <p className="text-[10px] text-gray-400">
                    登录于 {new Date(currentUser.loginAt).toLocaleTimeString('zh-CN')}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowUserMenu(false)}
                className="p-1 rounded hover:bg-gray-100 text-gray-500"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="border-t border-gray-100 pt-3 mb-3">
              <p className="text-xs text-gray-500 mb-2">切换同角色用户</p>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {roleUsers.map((user) => (
                  <button
                    key={user.username}
                    onClick={() => handleSwitchUser(user)}
                    className={cn(
                      'w-full flex items-center gap-2 p-2 rounded-lg text-left transition-colors',
                      user.username === currentUser.username
                        ? 'bg-primary/10 text-primary'
                        : 'hover:bg-gray-50 text-gray-700'
                    )}
                    data-testid={`switch-user-${user.username}`}
                  >
                    <User className="h-4 w-4" />
                    <span className="text-sm">{user.displayName}</span>
                    {user.username === currentUser.username && (
                      <span className="ml-auto text-[10px] bg-primary/20 px-1.5 py-0.5 rounded">当前</span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={handleLogout}
              className="w-full flex items-center justify-center gap-2 p-3 rounded-lg bg-gray-50 text-gray-700 hover:bg-gray-100 transition-colors"
              data-testid="logout-button"
            >
              <LogOut className="h-4 w-4" />
              <span className="text-sm">退出登录</span>
            </button>
          </div>
        </div>
      )}

      <main className="flex-1 overflow-y-auto pb-16">
        {children ?? <Outlet />}
      </main>

      {showNav && (
        <nav className="fixed bottom-0 left-0 right-0 z-30 flex h-16 items-center justify-around border-t border-gray-200 bg-white shadow-[0_-2px_8px_rgba(0,0,0,0.06)]">
          {tabs.map((tab) => {
            const Icon = tab.icon
            const isActive = activeTab === tab.path
            return (
              <button
                key={tab.path}
                onClick={() => handleTabClick(tab.path)}
                className={cn(
                  'flex min-w-[44px] flex-col items-center justify-center gap-0.5 px-3 py-1',
                  isActive ? 'text-primary' : 'text-gray-400'
                )}
              >
                <Icon className="h-5 w-5" />
                <span className="text-xs font-medium">{tab.label}</span>
              </button>
            )
          })}
        </nav>
      )}
    </div>
  )
}
