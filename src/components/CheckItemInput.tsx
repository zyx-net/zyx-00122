import { Upload } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CheckItem } from '@/types'

interface CheckItemInputProps {
  item: CheckItem
  value: unknown
  onChange: (val: unknown) => void
  error?: string
}

export default function CheckItemInput({ item, value, onChange, error }: CheckItemInputProps) {
  const strValue = (value as string) ?? ''
  const numValue = (value as number) ?? ''

  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-gray-700">
        {item.label}
        {item.required && <span className="ml-0.5 text-red-500">*</span>}
      </label>

      {item.type === 'text' && (
        <input
          type="text"
          value={strValue}
          onChange={(e) => onChange(e.target.value)}
          placeholder={item.placeholder}
          className={cn(
            'w-full rounded-lg border bg-white px-3 h-12 text-sm text-gray-900 outline-none transition-colors placeholder:text-gray-400',
            error ? 'border-red-300 focus:border-red-500' : 'border-gray-300 focus:border-primary'
          )}
        />
      )}

      {item.type === 'number' && (
        <input
          type="number"
          value={numValue}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
          min={item.min}
          max={item.max}
          placeholder={item.placeholder}
          className={cn(
            'w-full rounded-lg border bg-white px-3 h-12 text-sm text-gray-900 outline-none transition-colors placeholder:text-gray-400 font-mono',
            error ? 'border-red-300 focus:border-red-500' : 'border-gray-300 focus:border-primary'
          )}
        />
      )}

      {item.type === 'select' && (
        <div className="flex flex-wrap gap-2">
          {item.options?.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => onChange(opt)}
              className={cn(
                'rounded-lg border px-4 h-10 text-sm font-medium transition-colors',
                strValue === opt
                  ? 'border-primary bg-primary text-white'
                  : 'border-gray-300 bg-white text-gray-700'
              )}
            >
              {opt}
            </button>
          ))}
        </div>
      )}

      {item.type === 'attachment' && (
        <button
          type="button"
          onClick={() => onChange('placeholder_file.jpg')}
          className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 bg-white h-20 text-sm text-gray-500 transition-colors hover:border-accent hover:text-accent"
        >
          <Upload className="h-5 w-5" />
          <span>点击上传附件</span>
        </button>
      )}

      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  )
}
