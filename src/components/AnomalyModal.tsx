import { useState } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface AnomalyModalProps {
  open: boolean
  onClose: () => void
  onConfirm: (description: string, attachmentPlaceholder: string) => void
  checkItemLabel: string
}

export default function AnomalyModal({ open, onClose, onConfirm, checkItemLabel }: AnomalyModalProps) {
  const [description, setDescription] = useState('')
  const [attachment, setAttachment] = useState('')

  if (!open) return null

  const handleConfirm = () => {
    if (!description.trim()) return
    onConfirm(description.trim(), attachment.trim())
    setDescription('')
    setAttachment('')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-t-2xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">报告异常</h3>
          <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-gray-100">
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        <p className="mb-4 text-sm text-gray-500">
          检查项：<span className="font-medium text-gray-700">{checkItemLabel}</span>
        </p>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">异常描述 <span className="text-red-500">*</span></label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="请描述异常情况..."
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition-colors placeholder:text-gray-400 focus:border-primary"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">附件名称</label>
            <input
              type="text"
              value={attachment}
              onChange={(e) => setAttachment(e.target.value)}
              placeholder="输入附件文件名"
              className="w-full rounded-lg border border-gray-300 bg-white px-3 h-12 text-sm text-gray-900 outline-none transition-colors placeholder:text-gray-400 focus:border-primary"
            />
          </div>
        </div>

        <div className="mt-5 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border border-gray-300 bg-white h-11 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            disabled={!description.trim()}
            className={cn(
              'flex-1 rounded-lg h-11 text-sm font-medium transition-colors',
              description.trim()
                ? 'bg-accent text-white hover:bg-amber-600'
                : 'bg-amber-200 text-amber-100 cursor-not-allowed'
            )}
          >
            确认
          </button>
        </div>
      </div>
    </div>
  )
}
