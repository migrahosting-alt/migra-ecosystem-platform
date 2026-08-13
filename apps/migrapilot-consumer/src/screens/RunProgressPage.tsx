'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleX,
  Clock,
  Info,
  Loader2,
  Terminal,
} from 'lucide-react'
import { Workspace } from '@/components/layout/AppShell'
import { RailCard, RailLink } from '@/components/rail/RailPanels'
import { ProgressBar } from '@/components/ui/Progress'
import { Badge } from '@/components/ui/Badge'
import { FileTypeIcon } from '@/components/ui/FileTypeIcon'
import { CopyButton } from '@/components/ui/CopyField'
import { activeRun, completedRun, runActivity, runOutputs, runSteps } from '@/data/mock'
import { formatElapsed } from '@/lib/hooks'
import { cn } from '@/lib/cn'

const TOTAL_SECONDS = 192 // matches the ~00:03:12 estimate
const START_SECONDS = 98 // the run is already in flight when you land on it

/**
 * The live run view. Progress advances on a local clock so the screen behaves
 * the way a durable-execution backend would drive it.
 */
export function RunProgressPage() {
  const router = useRouter()
  const [elapsed, setElapsed] = useState(START_SECONDS)
  const [cancelled, setCancelled] = useState(false)

  useEffect(() => {
    if (cancelled) return
    const id = window.setInterval(() => setElapsed((value) => value + 1), 1000)
    return () => window.clearInterval(id)
  }, [cancelled])

  const overall = Math.min(100, Math.round((elapsed / TOTAL_SECONDS) * 100))

  // Steps 1–2 are done; the remaining three consume the rest of the timeline.
  const steps = useMemo(() => {
    const tailStart = 30
    const perStep = (100 - tailStart) / 3

    return runSteps.map((step, index) => {
      if (index < 2) return step
      const from = tailStart + (index - 2) * perStep
      const local = Math.max(0, Math.min(100, ((overall - from) / perStep) * 100))

      if (local >= 100) {
        return { ...step, status: 'complete' as const, duration: index === 2 ? '1m 12s' : '0m 41s' }
      }
      if (local > 0) return { ...step, status: 'active' as const, progress: Math.round(local) }
      return { ...step, status: 'pending' as const }
    })
  }, [overall])

  const activity = useMemo(() => {
    const activeIndex = steps.findIndex((step) => step.status === 'active')
    const boundary = activeIndex === -1 ? runActivity.length : activeIndex + 1

    return runActivity.map((entry, index) => ({
      ...entry,
      status:
        index < boundary - 1
          ? ('completed' as const)
          : index === boundary - 1
            ? ('in-progress' as const)
            : ('pending' as const),
    }))
  }, [steps])

  const applying = Math.min(
    activeRun.filesInScope,
    Math.round((overall / 100) * activeRun.filesInScope),
  )
  const done = overall >= 100

  useEffect(() => {
    if (!done) return
    const id = window.setTimeout(() => router.push(`/runs/${completedRun.id}`), 1600)
    return () => window.clearTimeout(id)
  }, [done, router])

  return (
    <Workspace
      contentClassName="mx-auto w-full max-w-[880px] px-6 py-7 sm:px-8"
      rail={
        <>
          <RailCard
            title="Run Summary"
            action={
              <span className="flex items-center gap-2 text-[13px] font-semibold text-emerald-600">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                {cancelled ? 'Cancelled' : done ? 'Complete' : 'In Progress'}
              </span>
            }
          >
            <dl className="flex flex-col gap-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-slate-500">Run ID</dt>
                <dd className="flex items-center gap-1">
                  <code className="font-mono text-[13px] font-semibold text-slate-800">
                    {activeRun.id}
                  </code>
                  <CopyButton value={activeRun.id} label="Copy run ID" />
                </dd>
              </div>
              {[
                ['Started', activeRun.started],
                ['Elapsed Time', formatElapsed(elapsed)],
                ['Estimated Time', activeRun.estimated],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-3">
                  <dt className="text-slate-500">{label}</dt>
                  <dd className="font-semibold text-slate-800 tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>

            <div className="mt-5 border-t border-hairline pt-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">Overall Progress</span>
                <span className="font-semibold text-slate-800 tabular-nums">{overall}%</span>
              </div>
              <ProgressBar value={overall} className="mt-2.5" label="Overall run progress" />
            </div>
          </RailCard>

          <RailCard
            title="Files in Scope"
            action={
              <span className="text-[13px] font-medium text-slate-500">
                {activeRun.filesInScope} files
              </span>
            }
          >
            <div className="flex flex-col gap-4">
              <div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-600">Applying changes</span>
                  <span className="font-semibold text-slate-800 tabular-nums">
                    {applying} files
                  </span>
                </div>
                <ProgressBar
                  value={(applying / activeRun.filesInScope) * 100}
                  className="mt-2"
                  label="Files applied"
                />
              </div>
              <div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-600">Pending</span>
                  <span className="font-semibold text-slate-800 tabular-nums">
                    {activeRun.filesInScope - applying} files
                  </span>
                </div>
                <ProgressBar
                  value={((activeRun.filesInScope - applying) / activeRun.filesInScope) * 100}
                  tone="slate"
                  className="mt-2"
                  label="Files pending"
                />
              </div>
            </div>

            <Link
              href="/files"
              className="mt-4 flex items-center justify-between border-t border-hairline pt-4 text-[13px] font-semibold text-brand-600 hover:text-brand-700"
            >
              View all files
              <ArrowRight className="h-4 w-4" />
            </Link>
          </RailCard>

          <RailCard title="Recent Outputs" action={<RailLink href="/files">View all</RailLink>}>
            <ul className="flex flex-col gap-1">
              {runOutputs.map((output) => (
                <li
                  key={output.id}
                  className="flex items-center gap-3 rounded-lg p-2 transition-colors hover:bg-slate-50"
                >
                  <FileTypeIcon name={output.name} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-slate-800">
                      {output.name}
                    </span>
                    <span className="block text-xs text-slate-400">
                      {output.name.split('.').pop()?.toUpperCase()} • {output.size}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </RailCard>
        </>
      }
    >
      <Link
        href="/history"
        className="inline-flex items-center gap-2 text-[15px] font-semibold text-brand-600 hover:text-brand-700"
      >
        <ArrowLeft className="h-4.5 w-4.5" strokeWidth={2.2} />
        Back to Chat
      </Link>

      <div className="mt-5 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white">
            <Terminal className="h-5 w-5" strokeWidth={2.2} />
          </span>
          <div>
            <h1 className="text-[26px] leading-tight font-bold tracking-[-0.025em] text-slate-900">
              {cancelled ? 'Coding Run Cancelled' : done ? 'Coding Run Finished' : 'Coding Run in Progress'}
            </h1>
            <p className="mt-1 text-[15px] text-slate-500">
              Implementing migration changes and validating results.
            </p>
          </div>
        </div>

        <button
          onClick={() => setCancelled(true)}
          disabled={cancelled || done}
          className="inline-flex h-10 items-center gap-2 rounded-field border border-red-200 bg-white px-4 text-sm font-semibold text-red-600 transition-colors hover:border-red-300 hover:bg-red-50 disabled:opacity-50"
        >
          <CircleX className="h-4.5 w-4.5" strokeWidth={2} />
          {cancelled ? 'Run Cancelled' : 'Cancel Run'}
        </button>
      </div>

      <ol className="mt-6 rounded-2xl border border-hairline bg-white p-6 shadow-card">
        {steps.map((step, index) => (
          <li key={step.id} className="flex gap-4">
            <div className="flex flex-col items-center">
              <span
                className={cn(
                  'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-bold transition-colors',
                  step.status === 'complete' && 'bg-emerald-500 text-white',
                  step.status === 'active' && 'animate-pulse-ring bg-brand-600 text-white',
                  step.status === 'pending' && 'border-2 border-slate-200 bg-white text-slate-400',
                )}
              >
                {step.status === 'complete' ? (
                  <Check className="h-4.5 w-4.5" strokeWidth={3} />
                ) : (
                  index + 1
                )}
              </span>
              {index < steps.length - 1 && (
                <span
                  className={cn(
                    'my-1 w-px flex-1',
                    step.status === 'complete' ? 'bg-emerald-200' : 'bg-slate-200',
                  )}
                />
              )}
            </div>

            <div className={cn('min-w-0 flex-1', index < steps.length - 1 && 'pb-6')}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold text-slate-900">{step.title}</p>
                  <p
                    className={cn(
                      'mt-0.5 text-sm',
                      step.status === 'active' ? 'text-brand-600' : 'text-slate-500',
                    )}
                  >
                    {step.description}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2.5">
                  {step.status === 'complete' && (
                    <>
                      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                        <Check className="h-3.5 w-3.5" strokeWidth={3} />
                      </span>
                      <span className="text-sm font-medium text-slate-500 tabular-nums">
                        {step.duration}
                      </span>
                    </>
                  )}
                  {step.status === 'active' && (
                    <>
                      <Badge tone="blue">In Progress</Badge>
                      <span className="text-sm font-medium text-slate-500 tabular-nums">
                        {step.progress}%
                      </span>
                    </>
                  )}
                  {step.status === 'pending' && <Badge tone="slate">Pending</Badge>}
                </div>
              </div>

              {step.status === 'active' && (
                <ProgressBar
                  value={step.progress ?? 0}
                  className="mt-3"
                  label={`${step.title} progress`}
                />
              )}
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-5 rounded-2xl border border-hairline bg-white p-5 shadow-card sm:p-6">
        <h2 className="text-[17px] font-semibold text-slate-900">Live Activity</h2>
        <ul className="mt-4 flex flex-col gap-1">
          {activity.map((entry) => (
            <li key={entry.id} className="flex items-center gap-4 rounded-lg px-1 py-2.5">
              <span className="w-24 shrink-0 text-[13px] text-slate-400 tabular-nums">
                {entry.time}
              </span>

              <span
                className={cn(
                  'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
                  entry.status === 'completed' && 'bg-emerald-500 text-white',
                  entry.status === 'in-progress' && 'bg-brand-500 text-white',
                  entry.status === 'pending' && 'bg-slate-100 text-slate-400',
                )}
              >
                {entry.status === 'completed' && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                {entry.status === 'in-progress' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {entry.status === 'pending' && <Clock className="h-3.5 w-3.5" strokeWidth={2.2} />}
              </span>

              <span className="min-w-0 flex-1 truncate text-[15px] text-slate-700">
                {entry.label}
              </span>

              <Badge
                tone={
                  entry.status === 'completed'
                    ? 'green'
                    : entry.status === 'in-progress'
                      ? 'blue'
                      : 'slate'
                }
              >
                {entry.status === 'completed'
                  ? 'Completed'
                  : entry.status === 'in-progress'
                    ? 'In Progress'
                    : 'Pending'}
              </Badge>
            </li>
          ))}
        </ul>
      </div>

      <p className="mt-5 flex items-center justify-center gap-2.5 text-[15px] text-slate-500">
        <Info className="h-4.5 w-4.5 shrink-0 text-slate-400" strokeWidth={2} />
        Progress is based on durable execution records and is safe to close this window.
      </p>
    </Workspace>
  )
}
