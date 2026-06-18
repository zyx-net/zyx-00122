import { cn } from '@/lib/utils'
import type { TaskStatus } from '@/types'

const statusConfig: Record<TaskStatus, { label: string; color: string; bg: string }> = {
  available: { label: '待领取', color: 'bg-gray-400', bg: 'bg-gray-100 text-gray-600' },
  in_progress: { label: '进行中', color: 'bg-blue-500', bg: 'bg-blue-50 text-blue-700' },
  submitted: { label: '已提交', color: 'bg-amber-500', bg: 'bg-amber-50 text-amber-700' },
  rework: { label: '返工', color: 'bg-red-500', bg: 'bg-red-50 text-red-700' },
  approved: { label: '已通过', color: 'bg-green-500', bg: 'bg-green-50 text-green-700' },
}

interface StatusBadgeProps {
  status: TaskStatus
}

export default function StatusBadge({ status }: StatusBadgeProps) {
  const config = statusConfig[status]

  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium', config.bg)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', config.color)} />
      {config.label}
    </span>
  )
}
