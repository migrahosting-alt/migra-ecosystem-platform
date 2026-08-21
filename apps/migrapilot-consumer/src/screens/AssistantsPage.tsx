'use client'

import { Users } from 'lucide-react'
import { Workspace } from '@/components/layout/AppShell'
import { RailCard } from '@/components/rail/RailPanels'
import { NotBuiltState } from '@/components/ui/SurfaceState'

/**
 * TRUTHFULNESS CONTRACT. There is no assistants backend — nothing saves a role, a tone, or
 * a set of grounding sources — so this surface shows nothing real.
 *
 * What it replaced: four invented assistants (Writing Coach, Research Assistant, Coding
 * Helper, Business Planner) each carrying a fabricated usage count — "12 chats", "8 chats",
 * "15 chats", "6 chats" — for conversations that never happened, and a "Start chat" button
 * that opened a normal chat seeded with a hardcoded opener, making a generic conversation
 * look like a configured specialist.
 *
 * The counts were the sharpest problem: they claim a history of the user's own use.
 */
export function AssistantsPage() {
  return (
    <Workspace
      contentClassName="mx-auto w-full max-w-[880px] px-6 py-7 sm:px-8"
      rail={
        <RailCard title="About Assistants">
          <p className="text-[13px] leading-relaxed text-slate-600">
            Assistants would be saved configurations — a role, a tone, and a set of grounding
            sources — that you pick before starting a conversation. Saving one needs a store
            MigraPilot does not have yet.
          </p>
        </RailCard>
      }
    >
      <h1 className="text-[28px] leading-tight font-bold tracking-[-0.025em] text-slate-900">
        Assistants
      </h1>
      <p className="mt-1 text-[15px] text-slate-500">
        Saved specialists, each tuned for a different kind of work.
      </p>

      <div className="mt-6">
        <NotBuiltState
          icon={<Users className="h-6 w-6" strokeWidth={1.8} />}
          title="Assistants aren't available yet"
          reason={
            <>
              There is no place to save an assistant, so none can be listed or created. Starting
              a normal chat from{' '}
              <strong className="font-semibold text-slate-700">New Chat</strong> uses the same
              model and the same grounding rules.
            </>
          }
        />
      </div>
    </Workspace>
  )
}
