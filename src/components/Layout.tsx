import { useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, ClipboardList, AlertTriangle, FileText, LayoutTemplate, CheckSquare, Shield, Upload } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { UserRole } from '@/types'

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

  const [activeTab, setActiveTab] = useState(location.pathname)

  const handleTabClick = (path: string) => {
    setActiveTab(path)
    navigate(path)
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
        <h1 className="flex-1 text-center text-lg font-semibold">{title}</h1>
        <div className="flex w-11 items-center justify-center">{rightAction}</div>
      </header>

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
