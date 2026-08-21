'use client'

import { AlertTriangle, CheckCircle2, FileText, ShieldOff, XCircle } from 'lucide-react'
import { Workspace } from '@/components/layout/AppShell'
import { RailCard } from '@/components/rail/RailPanels'
import { NotBuiltState } from '@/components/ui/SurfaceState'
import type { BrainView } from '@/server/brain/view'
import type { CodingRunSnapshot } from '@/server/brain/contracts'

/**
 * A real run snapshot, or an honest account of why there isn't one.
 *
 * What it replaced: `completedRun` from `src/data/mock.ts` — run id RUN-2025-05-16-1432,
 * "2m 47s", environment "Production", 18 files changed, 2,531 lines modified, five named
 * fixes and a per-file diff table with added/removed counts. Every number was invented, and
 * the page rendered them for ANY id in the URL, so a made-up run id produced a confident
 * report of work that never happened.
 *
 * The real `CodingRunSnapshot` has no duration, no environment, and no line counts, so
 * those are simply gone rather than approximated. This renders what the Brain publishes:
 * state, phase, blockers, the validation it actually ran, and the final report's own file
 * lists — including the paths it REFUSED, which the mock had no concept of.
 */
function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="rounded-2xl border border-hairline bg-white p-4">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p
        className={
          tone === 'good'
            ? 'mt-1 text-[15px] font-semibold text-emerald-700'
            : tone === 'bad'
              ? 'mt-1 text-[15px] font-semibold text-red-700'
              : 'mt-1 text-[15px] font-semibold text-slate-900'
        }
      >
        {value}
      </p>
    </div>
  )
}

function PathList({ title, paths, tone }: { title: string; paths: string[]; tone: 'slate' | 'red' }) {
  if (paths.length === 0) return null
  return (
    <section className="mt-6">
      <h2 className="text-[15px] font-semibold text-slate-800">
        {title} ({paths.length})
      </h2>
      <ul className="mt-2 flex flex-col gap-1.5">
        {paths.map((path) => (
          <li
            key={path}
            className={
              tone === 'red'
                ? 'truncate rounded-xl border border-red-100 bg-red-50/50 px-4 py-2.5 font-mono text-[13px] text-red-800'
                : 'truncate rounded-xl border border-hairline bg-white px-4 py-2.5 font-mono text-[13px] text-slate-700'
            }
          >
            {path}
          </li>
        ))}
      </ul>
    </section>
  )
}

export function RunReportPage({
  runId,
  run,
}: {
  runId: string
  run: BrainView<CodingRunSnapshot>
}) {
  if (run.state !== 'ready') {
    const title =
      run.state === 'unavailable'
        ? 'No run found for this id'
        : run.state === 'unreachable'
          ? 'The Brain could not be reached'
          : run.state === 'signed_out'
            ? 'Sign in to view this run'
            : 'This app and the Brain disagree on the run contract'
    return (
      <Workspace contentClassName="mx-auto w-full max-w-[880px] px-6 py-7 sm:px-8">
        <h1 className="text-[28px] leading-tight font-bold tracking-[-0.025em] text-slate-900">
          Run report
        </h1>
        <p className="mt-1 font-mono text-[13px] text-slate-500">{runId}</p>
        <div className="mt-6">
          <NotBuiltState
            icon={<ShieldOff className="h-6 w-6" strokeWidth={1.8} />}
            title={title}
            reason={run.reason}
          />
        </div>
      </Workspace>
    )
  }

  const snapshot = run.value
  const report = snapshot.finalReport
  const validation = snapshot.latestValidation

  return (
    <Workspace
      contentClassName="mx-auto w-full max-w-[880px] px-6 py-7 sm:px-8"
      rail={
        <RailCard title="Run">
          <dl className="flex flex-col gap-2.5 text-[13px]">
            <div>
              <dt className="text-slate-500">State</dt>
              <dd className="font-medium text-slate-800">{snapshot.state}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Phase</dt>
              <dd className="font-medium text-slate-800">{snapshot.phase}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Revision</dt>
              <dd className="font-mono font-medium text-slate-800">{snapshot.revision}</dd>
            </div>
          </dl>
        </RailCard>
      }
    >
      <h1 className="text-[28px] leading-tight font-bold tracking-[-0.025em] text-slate-900">
        Run report
      </h1>
      <p className="mt-1 font-mono text-[13px] text-slate-500">{snapshot.runId}</p>
      {snapshot.issueSummary && (
        <p className="mt-3 text-[15px] text-slate-600">{snapshot.issueSummary}</p>
      )}

      {snapshot.cancellation && (
        <p className="mt-4 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-[13px] text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          Cancellation {snapshot.cancellation.status}, requested{' '}
          {snapshot.cancellation.requestedAt}
          {snapshot.cancellation.confirmedAt ? `, confirmed ${snapshot.cancellation.confirmedAt}` : ''}.
        </p>
      )}

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <Stat
          label="Outcome"
          value={report ? (report.complete ? 'Complete' : 'Incomplete') : 'Not reported yet'}
          tone={report ? (report.complete ? 'good' : 'bad') : undefined}
        />
        <Stat label="Stop reason" value={report?.stopReason ?? '—'} />
        <Stat
          label="Validation"
          value={
            validation ? (validation.passed ? 'Passed' : validation.timedOut ? 'Timed out' : 'Failed') : 'None run'
          }
          tone={validation ? (validation.passed ? 'good' : 'bad') : undefined}
        />
      </div>

      {snapshot.blockers.length > 0 && (
        <section className="mt-6">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-slate-800">
            <XCircle className="h-4 w-4 text-red-600" />
            Blockers ({snapshot.blockers.length})
          </h2>
          <ul className="mt-2 flex flex-col gap-1.5">
            {snapshot.blockers.map((blocker) => (
              <li
                key={blocker}
                className="rounded-xl border border-red-100 bg-red-50/50 px-4 py-2.5 text-[13px] text-red-800"
              >
                {blocker}
              </li>
            ))}
          </ul>
        </section>
      )}

      {validation && (
        <section className="mt-6 rounded-2xl border border-hairline bg-white p-5">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-slate-800">
            {validation.passed ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            ) : (
              <XCircle className="h-4 w-4 text-red-600" />
            )}
            Validation
          </h2>
          <code className="mt-2 block overflow-x-auto rounded-lg bg-slate-900 px-3.5 py-2.5 font-mono text-[12px] text-slate-100">
            {validation.command.join(' ')}
          </code>
          <p className="mt-2 text-[13px] text-slate-500">
            Exit code {validation.exitCode ?? '—'}
            {validation.timedOut ? ' · timed out' : ''}
          </p>
          {validation.outputHead && (
            <pre className="mt-2 max-h-48 overflow-auto rounded-lg border border-hairline bg-slate-50 p-3 font-mono text-[12px] whitespace-pre-wrap text-slate-700">
              {validation.outputHead}
            </pre>
          )}
        </section>
      )}

      {report ? (
        <>
          <PathList title="Changed files" paths={report.changedFiles} tone="slate" />
          <PathList title="Refused paths" paths={report.refusedPaths} tone="red" />
          <PathList title="Approved but unused" paths={report.unusedScope} tone="slate" />
          {report.unresolvedRisks.length > 0 && (
            <section className="mt-6">
              <h2 className="text-[15px] font-semibold text-slate-800">
                Unresolved risks ({report.unresolvedRisks.length})
              </h2>
              <ul className="mt-2 flex flex-col gap-1.5">
                {report.unresolvedRisks.map((risk) => (
                  <li
                    key={risk}
                    className="rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-2.5 text-[13px] text-amber-900"
                  >
                    {risk}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      ) : (
        <p className="mt-6 flex items-start gap-2.5 rounded-xl border border-hairline bg-slate-50/70 p-3.5 text-[13px] text-slate-600">
          <FileText className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
          This run has not published a final report, so no file lists are available. Nothing is
          being estimated in its place.
        </p>
      )}
    </Workspace>
  )
}
