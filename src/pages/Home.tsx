import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ClipboardCheck, Settings, User, ChevronLeft, LogIn } from 'lucide-react'
import { useAppStore } from '@/stores/useAppStore'
import type { SystemUser, UserRole } from '@/types'
import { cn } from '@/lib/utils'

type Step = 'role' | 'user'

export default function Home() {
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('role')
  const [selectedRole, setSelectedRole] = useState<UserRole | null>(null)
  const setCurrentUser = useAppStore((s) => s.setCurrentUser)
  const getUsersByRole = useAppStore((s) => s.getUsersByRole)

  const roleUsers = selectedRole ? getUsersByRole(selectedRole) : []

  const handleRoleSelect = (role: UserRole) => {
    setSelectedRole(role)
    setStep('user')
  }

  const handleUserSelect = (user: SystemUser) => {
    setCurrentUser(user.username)
    if (user.role === 'inspector') {
      navigate('/inspector/tasks')
    } else {
      navigate('/admin/templates')
    }
  }

  const handleBack = () => {
    setStep('role')
    setSelectedRole(null)
  }

  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <div className="flex flex-1 flex-col items-center justify-center px-8">
        <div className="mb-12 text-center">
          <h1 className="mb-3 text-3xl font-bold text-primary">离线巡检</h1>
          <p className="text-sm text-gray-500">适配手机浏览器的离线巡检应用</p>
        </div>

        {step === 'role' && (
          <div className="flex w-full max-w-sm flex-col gap-5">
            <p className="text-center text-sm text-gray-600 mb-2">请选择您的角色</p>
            <button
              onClick={() => handleRoleSelect('inspector')}
              className="flex w-full flex-col items-center gap-3 rounded-2xl bg-white p-8 shadow-lg transition-all hover:shadow-xl active:scale-[0.98]"
            >
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
                <ClipboardCheck className="h-8 w-8 text-primary" />
              </div>
              <div className="text-center">
                <h2 className="text-lg font-semibold text-gray-900">巡检员</h2>
                <p className="text-xs text-gray-500">领取任务、填写检查项、上报异常</p>
              </div>
            </button>

            <button
              onClick={() => handleRoleSelect('admin')}
              className="flex w-full flex-col items-center gap-3 rounded-2xl bg-white p-8 shadow-lg transition-all hover:shadow-xl active:scale-[0.98]"
            >
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/10">
                <Settings className="h-8 w-8 text-accent" />
              </div>
              <div className="text-center">
                <h2 className="text-lg font-semibold text-gray-900">管理员</h2>
                <p className="text-xs text-gray-500">配置模板、分配任务、审核退回</p>
              </div>
            </button>
          </div>
        )}

        {step === 'user' && (
          <div className="flex w-full max-w-sm flex-col gap-4">
            <button
              onClick={handleBack}
              className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 mb-2"
            >
              <ChevronLeft className="h-4 w-4" />
              返回角色选择
            </button>

            <p className="text-center text-sm text-gray-600 mb-2">
              请选择 <span className="font-semibold text-primary">{selectedRole === 'inspector' ? '巡检员' : '管理员'}</span> 身份
            </p>

            <div className="space-y-2">
              {roleUsers.map((user) => (
                <button
                  key={user.username}
                  onClick={() => handleUserSelect(user)}
                  className={cn(
                    'w-full flex items-center gap-3 p-4 rounded-xl bg-white shadow-md',
                    'transition-all hover:shadow-lg active:scale-[0.98]',
                    'border-2 border-transparent hover:border-primary/20'
                  )}
                  data-testid={`user-select-${user.username}`}
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
                    <User className="h-6 w-6 text-gray-600" />
                  </div>
                  <div className="flex-1 text-left">
                    <p className="text-sm font-semibold text-gray-900">{user.displayName}</p>
                    <p className="text-xs text-gray-500 font-mono">{user.username}</p>
                  </div>
                  <LogIn className="h-5 w-5 text-primary" />
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-12 text-center">
          <p className="text-xs text-gray-400">所有数据本地存储，离线可用</p>
        </div>
      </div>
    </div>
  )
}
