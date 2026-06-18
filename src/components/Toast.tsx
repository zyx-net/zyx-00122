import { useEffect } from 'react'
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/useAppStore'

const typeConfig = {
  success: { icon: CheckCircle, bg: 'bg-green-50 border-green-200', text: 'text-green-800', iconColor: 'text-green-500' },
  error: { icon: AlertCircle, bg: 'bg-red-50 border-red-200', text: 'text-red-800', iconColor: 'text-red-500' },
  warning: { icon: AlertTriangle, bg: 'bg-amber-50 border-amber-200', text: 'text-amber-800', iconColor: 'text-amber-500' },
  info: { icon: Info, bg: 'bg-blue-50 border-blue-200', text: 'text-blue-800', iconColor: 'text-blue-500' },
}

export default function Toast() {
  const toasts = useAppStore((s) => s.toasts)
  const removeToast = useAppStore((s) => s.removeToast)

  if (toasts.length === 0) return null

  return (
    <div className="fixed left-0 right-0 top-0 z-50 flex flex-col items-center gap-2 px-4 pt-4 pointer-events-none">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} id={toast.id} message={toast.message} type={toast.type} onDismiss={removeToast} />
      ))}
    </div>
  )
}

function ToastItem({ id, message, type, onDismiss }: { id: string; message: string; type: 'success' | 'error' | 'warning' | 'info'; onDismiss: (id: string) => void }) {
  const config = typeConfig[type]
  const Icon = config.icon

  useEffect(() => {
    const timer = setTimeout(() => onDismiss(id), 3000)
    return () => clearTimeout(timer)
  }, [id, onDismiss])

  return (
    <div
      className={cn(
        'pointer-events-auto flex w-full max-w-sm items-center gap-2 rounded-lg border px-4 py-3 shadow-lg',
        'animate-[slideIn_0.3s_ease-out]',
        config.bg
      )}
    >
      <Icon className={cn('h-5 w-5 shrink-0', config.iconColor)} />
      <span className={cn('flex-1 text-sm font-medium', config.text)}>{message}</span>
      <button onClick={() => onDismiss(id)} className="shrink-0 p-1">
        <X className="h-4 w-4 text-gray-400" />
      </button>
    </div>
  )
}
