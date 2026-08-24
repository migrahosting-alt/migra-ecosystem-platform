import {
  FileAudio,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileType,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/cn'

type DocSpec = { icon: LucideIcon; className: string }

const docTypes: Record<string, DocSpec> = {
  pdf: { icon: FileType, className: 'bg-red-50 text-red-500' },
  xlsx: { icon: FileSpreadsheet, className: 'bg-emerald-50 text-emerald-600' },
  csv: { icon: FileSpreadsheet, className: 'bg-emerald-50 text-emerald-600' },
  docx: { icon: FileText, className: 'bg-blue-50 text-blue-600' },
  txt: { icon: FileText, className: 'bg-slate-100 text-slate-500' },
  md: { icon: FileText, className: 'bg-slate-100 text-slate-500' },
  png: { icon: FileImage, className: 'bg-violet-50 text-violet-500' },
  jpg: { icon: FileImage, className: 'bg-violet-50 text-violet-500' },
  m4a: { icon: FileAudio, className: 'bg-sky-50 text-sky-500' },
  mp3: { icon: FileAudio, className: 'bg-sky-50 text-sky-500' },
}

/** Code files render as a solid label chip (TS, SQL, JSON…) like an editor gutter. */
const codeTypes: Record<string, { label: string; className: string }> = {
  ts: { label: 'TS', className: 'bg-blue-500 text-white' },
  tsx: { label: 'TS', className: 'bg-blue-500 text-white' },
  js: { label: 'JS', className: 'bg-amber-400 text-slate-900' },
  jsx: { label: 'JS', className: 'bg-amber-400 text-slate-900' },
  json: { label: '{ }', className: 'bg-emerald-500 font-mono text-white' },
  sql: { label: 'SQL', className: 'bg-indigo-500 text-white' },
  html: { label: '< >', className: 'bg-orange-500 font-mono text-white' },
  yml: { label: 'YML', className: 'bg-chip-neutral text-white' },
  sh: { label: '>_', className: 'bg-chip-neutral text-white' },
}

export function extensionOf(name: string) {
  return name.split('.').pop()?.toLowerCase() ?? ''
}

const boxes = {
  sm: 'h-7 w-7 rounded-md text-[9px]',
  md: 'h-9 w-9 rounded-lg text-[10px]',
  lg: 'h-11 w-11 rounded-xl text-xs',
}
const glyphs = { sm: 'h-3.5 w-3.5', md: 'h-[18px] w-[18px]', lg: 'h-5 w-5' }

export function FileTypeIcon({
  name,
  size = 'md',
  className,
}: {
  name: string
  size?: keyof typeof boxes
  className?: string
}) {
  const ext = extensionOf(name)
  const code = codeTypes[ext]

  if (code) {
    return (
      <span
        className={cn(
          'inline-flex shrink-0 items-center justify-center font-bold',
          code.className,
          boxes[size],
          className,
        )}
        aria-hidden
      >
        {code.label}
      </span>
    )
  }

  const doc = docTypes[ext] ?? { icon: FileText, className: 'bg-slate-100 text-slate-500' }
  const Icon = doc.icon
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center',
        doc.className,
        boxes[size],
        className,
      )}
      aria-hidden
    >
      <Icon className={glyphs[size]} strokeWidth={2} />
    </span>
  )
}
