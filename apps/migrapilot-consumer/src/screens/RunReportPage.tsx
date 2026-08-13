'use client'

import Link from 'next/link'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Code2,
  FileText,
  FolderOpen,
  GitCompare,
  Rocket,
  TriangleAlert,
} from 'lucide-react'
import { Workspace } from '@/components/layout/AppShell'
import { RailCard } from '@/components/rail/RailPanels'
import { Badge, IconTile } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { StatusOrb } from '@/components/ui/Progress'
import { FileTypeIcon } from '@/components/ui/FileTypeIcon'
import { CopyButton } from '@/components/ui/CopyField'
import { completedRun } from '@/data/mock'

export function RunReportPage() {
  const run = completedRun

  const stats = [
    {
      icon: FileText,
      tone: 'blue' as const,
      value: String(run.filesChanged),
      label: 'Files Changed',
    },
    {
      icon: CheckCircle2,
      tone: 'green' as const,
      value: `${run.validationsPassed} / ${run.validationsTotal}`,
      label: 'Validations Passed',
    },
    {
      icon: TriangleAlert,
      tone: 'amber' as const,
      value: String(run.warnings),
      label: 'Warnings',
    },
    {
      icon: Code2,
      tone: 'purple' as const,
      value: run.linesModified.toLocaleString(),
      label: 'Lines Modified',
    },
  ]

  const details: [string, React.ReactNode][] = [
    [
      'Run ID',
      <span className="flex items-center gap-1">
        <code className="font-mono text-[13px] font-semibold text-slate-800">{run.id}</code>
        <CopyButton value={run.id} label="Copy run ID" />
      </span>,
    ],
    [
      'Revision',
      <span className="flex items-center gap-1">
        <code className="font-mono text-[13px] font-semibold text-slate-800">{run.revision}</code>
        <CopyButton value={run.revision} label="Copy revision" />
      </span>,
    ],
    ['Started', <span className="font-semibold text-slate-800">{run.started}</span>],
    ['Completed', <span className="font-semibold text-slate-800">{run.completed}</span>],
    ['Duration', <span className="font-semibold text-slate-800">{run.duration}</span>],
    [
      'Final Status',
      <span className="flex items-center gap-2 font-semibold text-emerald-600">
        <span className="h-2 w-2 rounded-full bg-emerald-500" />
        Success
      </span>,
    ],
    ['Environment', <span className="font-semibold text-slate-800">{run.environment}</span>],
    ['Validation', <span className="font-semibold text-emerald-600">All Checks Passed</span>],
  ]

  return (
    <Workspace
      contentClassName="mx-auto w-full max-w-[880px] px-6 py-7 sm:px-8"
      rail={
        <>
          <RailCard title="Run Details">
            <dl className="flex flex-col gap-3 text-sm">
              {details.map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-3">
                  <dt className="shrink-0 text-slate-500">{label}</dt>
                  <dd className="min-w-0 truncate text-right">{value}</dd>
                </div>
              ))}
            </dl>
          </RailCard>

          <RailCard title="Validation Summary">
            <StatusOrb tone="green">
              <Check className="h-8 w-8" strokeWidth={3} />
            </StatusOrb>
            <p className="mt-2 text-center text-[22px] font-bold tracking-[-0.02em] text-slate-900">
              {run.validationsPassed} / {run.validationsTotal}
            </p>
            <p className="text-center text-sm text-slate-500">Validations Passed</p>
            <button className="mt-4 flex w-full items-center justify-center gap-2 text-[13px] font-semibold text-brand-600 hover:text-brand-700">
              View validation details
              <ArrowRight className="h-4 w-4" />
            </button>
          </RailCard>

          <RailCard title="Next Steps">
            <p className="text-sm text-slate-600">Your code is ready to ship!</p>
            <button className="mt-4 flex h-11 w-full items-center justify-center gap-2.5 rounded-field border border-brand-200 bg-white text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-50">
              <Rocket className="h-4.5 w-4.5" strokeWidth={2} />
              Create Deployment Package
            </button>
          </RailCard>
        </>
      }
    >
      <Link
        href="/history"
        className="inline-flex items-center gap-2 text-[15px] font-semibold text-brand-600 hover:text-brand-700"
      >
        <ArrowLeft className="h-4.5 w-4.5" strokeWidth={2.2} />
        Back to History
      </Link>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-emerald-200/70 bg-emerald-50/60 p-5">
        <div className="flex items-center gap-4">
          <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
            <Check className="h-6 w-6" strokeWidth={3} />
          </span>
          <div>
            <h1 className="text-[21px] font-bold tracking-[-0.02em] text-slate-900">
              Run Completed Successfully
            </h1>
            <p className="mt-0.5 text-[15px] text-slate-600">
              Your code has been updated and validated.
            </p>
          </div>
        </div>
        <Badge tone="green" className="px-3 py-1.5 text-[13px]">
          Success
        </Badge>
      </div>

      <div className="mt-5 rounded-2xl border border-hairline bg-white p-5 shadow-card sm:p-6">
        <h2 className="text-[17px] font-semibold text-slate-900">Final Report</h2>
        <p className="mt-1 text-sm text-slate-500">Summary of changes and validation results.</p>

        <div className="mt-5 grid gap-3 rounded-xl border border-hairline p-4 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map(({ icon: Icon, tone, value, label }) => (
            <div key={label} className="flex items-center gap-3">
              <IconTile tone={tone}>
                <Icon strokeWidth={2} />
              </IconTile>
              <div className="min-w-0">
                <p className="text-[19px] leading-tight font-bold tracking-[-0.02em] text-slate-900">
                  {value}
                </p>
                <p className="truncate text-[13px] text-slate-500">{label}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6">
          <h3 className="text-[15px] font-semibold text-slate-900">What Was Fixed</h3>
          <ul className="mt-3.5 flex flex-col gap-3">
            {run.fixes.map((fix) => (
              <li key={fix} className="flex gap-3 text-[15px] leading-snug text-slate-700">
                <CheckCircle2 className="mt-0.5 h-4.5 w-4.5 shrink-0 text-emerald-500" strokeWidth={2.2} />
                {fix}
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-6 border-t border-hairline pt-5">
          <div className="flex items-center justify-between">
            <h3 className="text-[15px] font-semibold text-slate-900">Changed Files</h3>
            <button className="text-[13px] font-semibold text-brand-600 hover:text-brand-700">
              View all
            </button>
          </div>

          <ul className="mt-3.5 flex flex-col">
            {run.changedFiles.map((file) => (
              <li
                key={file.path}
                className="flex items-center gap-3.5 rounded-lg px-1 py-2.5 transition-colors hover:bg-slate-50"
              >
                <FileTypeIcon name={file.path} size="sm" />
                <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-slate-700">
                  {file.path}
                </span>
                <span className="shrink-0 text-[13px] font-semibold text-emerald-600 tabular-nums">
                  +{file.added}
                </span>
                <span className="w-10 shrink-0 text-right text-[13px] font-semibold text-red-500 tabular-nums">
                  −{file.removed}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <Button size="lg">
            <GitCompare className="h-4.5 w-4.5" strokeWidth={2} />
            View Diff
          </Button>
          <Button variant="secondary" size="lg">
            <FolderOpen className="h-4.5 w-4.5 text-slate-400" strokeWidth={2} />
            Open Files
          </Button>
          <Button
            variant="secondary"
            size="lg"
            onClick={() => {
              const report = [
                `MigraPilot run ${run.id} (${run.revision})`,
                `${run.filesChanged} files changed • ${run.linesModified} lines modified`,
                `${run.validationsPassed}/${run.validationsTotal} validations passed • ${run.warnings} warnings`,
                '',
                ...run.fixes.map((fix) => `- ${fix}`),
              ].join('\n')
              void navigator.clipboard?.writeText(report).catch(() => undefined)
            }}
          >
            <ClipboardCheck className="h-4.5 w-4.5 text-slate-400" strokeWidth={2} />
            Copy Report
          </Button>
        </div>
      </div>

      <p className="mt-5 text-center text-[13px] text-slate-400">
        MigraPilot can make mistakes. Check important info.
      </p>
    </Workspace>
  )
}
