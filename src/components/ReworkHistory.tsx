import { cn } from '@/lib/utils'
import type { Submission, SubmissionStatus } from '@/types'

const statusLabels: Record<SubmissionStatus, { label: string; dotColor: string }> = {
  pending: { label: '待审核', dotColor: 'bg-amber-500' },
  approved: { label: '已通过', dotColor: 'bg-green-500' },
  rework: { label: '返工', dotColor: 'bg-red-500' },
}

interface ReworkHistoryProps {
  submissions: Submission[]
}

export default function ReworkHistory({ submissions }: ReworkHistoryProps) {
  if (submissions.length === 0) return null

  const sorted = [...submissions].sort((a, b) => a.version - b.version)

  return (
    <div className="space-y-0">
      {sorted.map((sub, index) => {
        const config = statusLabels[sub.status]
        const isLast = index === sorted.length - 1

        return (
          <div key={sub.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div className={cn('h-3 w-3 shrink-0 rounded-full', config.dotColor)} />
              {!isLast && <div className="w-0.5 flex-1 bg-gray-200" />}
            </div>

            <div className={cn('pb-4', !isLast && 'pb-5')}>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-gray-900 font-mono">V{sub.version}</span>
                <span className={cn(
                  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
                  sub.status === 'pending' && 'bg-amber-50 text-amber-700',
                  sub.status === 'approved' && 'bg-green-50 text-green-700',
                  sub.status === 'rework' && 'bg-red-50 text-red-700'
                )}>
                  {config.label}
                </span>
              </div>

              <p className="mt-0.5 text-xs text-gray-400">
                {new Date(sub.submittedAt).toLocaleString('zh-CN')}
              </p>

              {sub.reworkReason && (
                <div className="mt-1.5 rounded-lg border border-red-100 bg-red-50 px-3 py-2">
                  <p className="text-xs font-medium text-red-600">返工原因</p>
                  <p className="mt-0.5 text-xs text-red-700">{sub.reworkReason}</p>
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
