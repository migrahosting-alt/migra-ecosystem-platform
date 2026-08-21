'use client'

import { Terminal } from 'lucide-react'
import { Workspace } from '@/components/layout/AppShell'
import { RailCard } from '@/components/rail/RailPanels'
import { NotBuiltState } from '@/components/ui/SurfaceState'

/**
 * TRUTHFULNESS CONTRACT. There is no "active run" source.
 *
 * `getCodingRun(runId)` reads ONE run by id; no seam enumerates runs or reports which is
 * currently running, and by design there is no `startCodingRun` either — starting a run
 * needs a workspace root the browser does not have, so runs are started in the VS Code
 * extension and the consumer watches.
 *
 * What it replaced: a fully animated progress screen driven by `activeRun`, `runSteps`,
 * `runActivity` and `runOutputs` from `src/data/mock.ts` — a fabricated run id, staged
 * "Analyzing / Applying changes / Validating" steps, a live-looking activity feed and
 * generated output files, none of which corresponded to any execution. A progress bar that
 * advances without a process behind it is the most convincing lie a product can tell.
 */
export function RunProgressPage() {
  return (
    <Workspace
      contentClassName="mx-auto w-full max-w-[880px] px-6 py-7 sm:px-8"
      rail={
        <RailCard title="About Runs">
          <p className="text-[13px] leading-relaxed text-slate-600">
            A coding run applies governed changes to a workspace on disk. It is started and
            approved in the MigraPilot VS Code extension, which has the workspace; this app can
            open a run by id to watch it.
          </p>
        </RailCard>
      }
    >
      <h1 className="text-[28px] leading-tight font-bold tracking-[-0.025em] text-slate-900">
        Active run
      </h1>
      <p className="mt-1 text-[15px] text-slate-500">Live progress of a governed change.</p>

      <div className="mt-6">
        <NotBuiltState
          icon={<Terminal className="h-6 w-6" strokeWidth={1.8} />}
          title="No active run can be shown"
          reason={
            <>
              MigraPilot has no way to ask which run is currently active — runs are started from
              the VS Code extension, and this app can only open one by its id. Nothing here is
              being tracked in the background.
            </>
          }
        />
      </div>
    </Workspace>
  )
}
