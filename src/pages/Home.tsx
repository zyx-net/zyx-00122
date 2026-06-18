import { useNavigate } from 'react-router-dom'
import { ClipboardCheck, Settings } from 'lucide-react'
import { useAppStore } from '@/stores/useAppStore'

export default function Home() {
  const navigate = useNavigate()
  const setRole = useAppStore((s) => s.setRole)

  const handleRoleSelect = (role: 'inspector' | 'admin') => {
    setRole(role)
    if (role === 'inspector') {
      navigate('/inspector/tasks')
    } else {
      navigate('/admin/templates')
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <div className="flex flex-1 flex-col items-center justify-center px-8">
        <div className="mb-16 text-center">
          <h1 className="mb-3 text-3xl font-bold text-primary">离线巡检</h1>
          <p className="text-sm text-gray-500">适配手机浏览器的离线巡检应用</p>
        </div>

        <div className="flex w-full max-w-sm flex-col gap-5">
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

        <div className="mt-16 text-center">
          <p className="text-xs text-gray-400">所有数据本地存储，离线可用</p>
        </div>
      </div>
    </div>
  )
}
