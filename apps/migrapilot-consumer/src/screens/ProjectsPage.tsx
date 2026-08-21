'use client'

import { FolderOpen } from 'lucide-react'
import { Workspace } from '@/components/layout/AppShell'
import { RailCard } from '@/components/rail/RailPanels'
import { NotBuiltState } from '@/components/ui/SurfaceState'

/**
 * TRUTHFULNESS CONTRACT. There is no projects backend — no `/api/projects` route and no
 * Brain seam — so this surface can show nothing real, and therefore shows nothing.
 *
 * What it replaced: four invented projects ("Website Launch 75%", "Product Roadmap 60%",
 * "Support Docs", "Codebase Review") with fabricated collaborator avatars and "Updated 2h
 * ago" timestamps, a stats strip reading Total Projects 4 · Active Today 3 · Total Files
 * 27 · Total Chats 58, and a Recent Activity feed of four events that never happened —
 * all from `src/data/mock.ts`, rendered to real signed-in people. The file counts and
 * chat counts were the most damaging: they are plausible, they look like a record of the
 * user's own work, and they were pure invention.
 *
 * Deliberately NOT rebuilt as "No projects yet" with a working-looking New Project button.
 * That phrasing invites the user to create one, and nothing would happen. Projects do not
 * exist here yet; the page says so.
 */
export function ProjectsPage() {
  return (
    <Workspace
      contentClassName="mx-auto w-full max-w-[880px] px-6 py-7 sm:px-8"
      rail={
        <RailCard title="About Projects">
          <p className="text-[13px] leading-relaxed text-slate-600">
            Projects would group chats and files into a shared workspace. The feature has no
            backend yet, so nothing is stored, counted, or shared.
          </p>
        </RailCard>
      }
    >
      <h1 className="text-[28px] leading-tight font-bold tracking-[-0.025em] text-slate-900">
        Projects
      </h1>
      <p className="mt-1 text-[15px] text-slate-500">
        Organize your workspaces and get more done with AI.
      </p>

      <div className="mt-6">
        <NotBuiltState
          icon={<FolderOpen className="h-6 w-6" strokeWidth={1.8} />}
          title="Projects aren't available yet"
          reason={
            <>
              MigraPilot has no project service, so there is nothing to list, count, or open.
              Your chats and files are real and live under{' '}
              <strong className="font-semibold text-slate-700">History</strong> and{' '}
              <strong className="font-semibold text-slate-700">Files</strong>.
            </>
          }
        />
      </div>
    </Workspace>
  )
}
