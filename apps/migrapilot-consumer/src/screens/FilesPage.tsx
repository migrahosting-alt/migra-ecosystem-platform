'use client'

import { useRef, useState, type DragEvent } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowRight,
  BookOpen,
  Calendar,
  CheckCircle2,
  CloudUpload,
  FileSpreadsheet,
  FileText,
  Info,
  Loader2,
  MessageCircle,
  Network,
  ShieldAlert,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { Workspace } from '@/components/layout/AppShell'
import { ActionRow, RailCard } from '@/components/rail/RailPanels'
import { Button } from '@/components/ui/Button'
import { IconTile, toneStyles } from '@/components/ui/Badge'
import { FileTypeIcon, extensionOf } from '@/components/ui/FileTypeIcon'
import {
  analysisSummary,
  detectedTopics,
  keyPoints,
  uploadedFiles as seedFiles,
} from '@/data/mock'
import type { UploadedFile } from '@/data/types'
import { useChat } from '@/state/ChatProvider'
import { cn } from '@/lib/cn'

const topicIcons = {
  calendar: Calendar,
  sheet: FileSpreadsheet,
  integration: Network,
  shield: ShieldAlert,
  book: BookOpen,
}

function bytesLabel(mb: number) {
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(mb * 1000)} KB`
}

export function FilesPage() {
  const router = useRouter()
  const { startConversation } = useChat()
  const inputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<UploadedFile[]>(seedFiles)
  const [dragging, setDragging] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzed, setAnalyzed] = useState(false)

  const totalSize = files.reduce((sum, file) => sum + file.bytes, 0)
  const totalPages = files.reduce((sum, file) => sum + file.pages, 0)
  const fileTypes = [...new Set(files.map((file) => extensionOf(file.name).toUpperCase()))]
  const ready = files.length > 0 && files.every((file) => file.status === 'ready')

  const addFiles = (incoming: FileList | null) => {
    if (!incoming?.length) return

    const mapped: UploadedFile[] = Array.from(incoming).map((file, index) => ({
      id: `up-${Date.now()}-${index}`,
      name: file.name,
      size: bytesLabel(file.size / 1_000_000),
      meta: '—',
      status: 'processing',
      pages: 0,
      bytes: file.size / 1_000_000,
    }))

    setFiles((current) => [...current, ...mapped])
    setAnalyzed(false)

    // Simulated extraction pass — a real build swaps this for the ingest API.
    window.setTimeout(() => {
      setFiles((current) =>
        current.map((file) =>
          mapped.some((added) => added.id === file.id)
            ? {
                ...file,
                status: 'ready',
                meta: ['pdf', 'docx'].includes(extensionOf(file.name)) ? '8 pages' : 'Sheet1',
                pages: ['pdf', 'docx'].includes(extensionOf(file.name)) ? 8 : 0,
              }
            : file,
        ),
      )
    }, 1400)
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    addFiles(event.dataTransfer.files)
  }

  const analyze = () => {
    setAnalyzing(true)
    window.setTimeout(() => {
      setAnalyzing(false)
      setAnalyzed(true)
    }, 1200)
  }

  return (
    <Workspace
      contentClassName="mx-auto w-full max-w-[880px] px-6 py-7 sm:px-8"
      rail={
        <>
          <RailCard title="File Insights">
            <p className="flex items-center gap-2.5 text-sm font-semibold text-slate-700">
              <FileText className="h-[18px] w-[18px] text-slate-400" strokeWidth={1.9} />
              {files.length} {files.length === 1 ? 'file' : 'files'} uploaded
            </p>

            <dl className="mt-4 flex flex-col gap-3 text-sm">
              {[
                ['Total size', `${totalSize.toFixed(2)} MB`],
                ['Total pages', String(totalPages)],
                ['File types', fileTypes.join(', ') || '—'],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-4">
                  <dt className="text-slate-500">{label}</dt>
                  <dd className="truncate font-semibold text-slate-800">{value}</dd>
                </div>
              ))}
            </dl>

            <div className="mt-5 border-t border-hairline pt-5">
              <p className="text-sm font-semibold text-slate-800">Detected Topics</p>
              <div className="mt-3 flex flex-col gap-2">
                {detectedTopics.map((topic) => {
                  const Icon = topicIcons[topic.icon]
                  return (
                    <span
                      key={topic.label}
                      className={cn(
                        'inline-flex w-fit items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] font-semibold ring-1 ring-inset',
                        toneStyles[topic.tone].chip,
                      )}
                    >
                      <Icon className="h-4 w-4" strokeWidth={2} />
                      {topic.label}
                    </span>
                  )
                })}
              </div>
            </div>
          </RailCard>

          <RailCard title="Quick Actions">
            <div className="flex flex-col gap-3">
              <ActionRow
                icon={
                  <IconTile tone="blue">
                    <MessageCircle strokeWidth={2} />
                  </IconTile>
                }
                title="Ask about these files"
                subtitle="Get answers and insights"
                trailing={<ArrowRight className="h-4 w-4 shrink-0 text-slate-300" />}
                onClick={() =>
                  router.push(
                    `/chat/${startConversation('Summarise the key risks and dependencies across my uploaded migration files.')}`,
                  )
                }
              />
              <ActionRow
                icon={
                  <IconTile tone="slate">
                    <FileText strokeWidth={2} />
                  </IconTile>
                }
                title="Generate summary"
                subtitle="Create a detailed summary"
                trailing={<ArrowRight className="h-4 w-4 shrink-0 text-slate-300" />}
                onClick={analyze}
              />
            </div>
          </RailCard>

          <RailCard title="Export Insights">
            <ActionRow
              icon={<FileTypeIcon name="insights.pdf" size="md" />}
              title="Export to PDF"
              trailing={<ArrowRight className="h-4 w-4 shrink-0 text-slate-300" />}
            />
          </RailCard>
        </>
      }
    >
      <h1 className="text-[26px] leading-tight font-bold tracking-[-0.025em] text-slate-900">
        Upload files to analyze
      </h1>

      <div
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          'mt-5 rounded-2xl border-2 border-dashed px-6 py-11 text-center transition-colors',
          dragging ? 'border-brand-400 bg-brand-50/60' : 'border-slate-200 bg-white',
        )}
      >
        <CloudUpload
          className={cn(
            'mx-auto h-11 w-11 transition-colors',
            dragging ? 'text-brand-600' : 'text-brand-500',
          )}
          strokeWidth={1.6}
        />
        <p className="mt-3.5 text-[17px] font-medium text-slate-700">Drag and drop files here</p>
        <p className="mt-1 text-[15px] text-slate-500">
          or{' '}
          <button
            onClick={() => inputRef.current?.click()}
            className="font-semibold text-brand-600 underline-offset-2 hover:underline"
          >
            browse files
          </button>
        </p>
        <p className="mt-3 text-[13px] text-slate-400">PDF, DOCX, XLSX, CSV up to 50MB each</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => {
            addFiles(event.target.files)
            event.target.value = ''
          }}
        />
      </div>

      {files.length > 0 && (
        <ul className="mt-5 divide-y divide-slate-100 overflow-hidden rounded-2xl border border-hairline bg-white">
          {files.map((file) => (
            <li key={file.id} className="flex items-center gap-4 px-4 py-3.5">
              <FileTypeIcon name={file.name} size="lg" />

              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold text-slate-900">{file.name}</p>
                <p className="text-[13px] text-slate-400">
                  <span className="uppercase">{extensionOf(file.name)}</span> • {file.size}
                </p>
              </div>

              <span className="hidden w-24 shrink-0 text-sm text-slate-500 sm:block">
                {file.meta}
              </span>

              <span className="flex w-28 shrink-0 items-center gap-2 text-sm font-medium">
                {file.status === 'ready' ? (
                  <>
                    <CheckCircle2 className="h-[18px] w-[18px] text-emerald-500" strokeWidth={2.2} />
                    <span className="text-emerald-600">Ready</span>
                  </>
                ) : (
                  <>
                    <Loader2 className="h-[18px] w-[18px] animate-spin text-brand-500" />
                    <span className="text-slate-500">Processing</span>
                  </>
                )}
              </span>

              <button
                onClick={() => setFiles((current) => current.filter((item) => item.id !== file.id))}
                aria-label={`Remove ${file.name}`}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500"
              >
                <Trash2 className="h-[18px] w-[18px]" strokeWidth={1.9} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
        <p className="text-[15px] text-slate-500">
          <span className="font-semibold text-slate-700">{files.length} files selected</span>
          {' • '}
          {totalSize.toFixed(2)} MB total
        </p>
        <Button size="lg" onClick={analyze} disabled={!ready || analyzing}>
          {analyzing ? (
            <Loader2 className="h-4.5 w-4.5 animate-spin" />
          ) : (
            <Sparkles className="h-4.5 w-4.5" strokeWidth={2.2} />
          )}
          {analyzing ? 'Analyzing…' : 'Analyze Files'}
        </Button>
      </div>

      <div className="mt-6 rounded-2xl border border-hairline bg-white p-5 shadow-card sm:p-6">
        <h2 className="flex items-center gap-2.5 text-[17px] font-semibold text-slate-900">
          <Sparkles className="h-5 w-5 text-brand-600" strokeWidth={2.2} />
          Analysis Preview
        </h2>

        <div className="mt-5 grid gap-6 md:grid-cols-[1fr_320px]">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Key Points Extracted</h3>
            <ul className="mt-3.5 flex flex-col gap-3">
              {keyPoints.map((point) => (
                <li key={point} className="flex gap-3 text-[15px] leading-snug text-slate-700">
                  <CheckCircle2 className="mt-0.5 h-4.5 w-4.5 shrink-0 text-brand-500" strokeWidth={2} />
                  {point}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-slate-800">AI Summary</h3>
            <div className="mt-3.5 rounded-xl border border-hairline bg-slate-50/70 p-4">
              <p className="text-sm leading-relaxed text-slate-600">{analysisSummary}</p>
              <button
                onClick={() =>
                  router.push(
                    `/chat/${startConversation('Give me the full summary of my uploaded migration documents.')}`,
                  )
                }
                className="mt-4 inline-flex h-9 items-center rounded-lg border border-brand-200 bg-white px-3.5 text-[13px] font-semibold text-brand-700 transition-colors hover:bg-brand-50"
              >
                View full summary
              </button>
            </div>
          </div>
        </div>
      </div>

      <div
        className={cn(
          'mt-5 flex items-center gap-3 rounded-xl border p-4 text-[15px]',
          analyzed
            ? 'border-emerald-200/70 bg-emerald-50/60 text-emerald-800'
            : 'border-brand-100 bg-brand-50/60 text-slate-600',
        )}
      >
        {analyzed ? (
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" strokeWidth={2.2} />
        ) : (
          <Info className="h-5 w-5 shrink-0 text-brand-600" strokeWidth={2.2} />
        )}
        {analyzed
          ? 'Analysis complete. Insights are up to date in the panel on the right.'
          : 'Ready to analyze. Click “Analyze Files” to generate insights and answers.'}
      </div>
    </Workspace>
  )
}
