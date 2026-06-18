import { Inbox } from 'lucide-react'

interface EmptyStateProps {
  icon?: React.ReactNode
  message: string
  actionLabel?: string
  onAction?: () => void
}

export default function EmptyState({ icon, message, actionLabel, onAction }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16">
      <div className="mb-4 text-gray-300">
        {icon ?? <Inbox className="h-12 w-12" />}
      </div>
      <p className="mb-4 text-sm text-gray-500">{message}</p>
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="rounded-lg bg-accent px-5 h-11 text-sm font-medium text-white transition-colors hover:bg-amber-600"
        >
          {actionLabel}
        </button>
      )}
    </div>
  )
}
