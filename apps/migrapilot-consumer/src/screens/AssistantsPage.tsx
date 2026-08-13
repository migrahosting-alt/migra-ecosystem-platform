'use client'

import { useRouter } from 'next/navigation'
import {
  Briefcase,
  Code2,
  MessageSquare,
  PencilLine,
  Plus,
  Search,
  Sparkles,
} from 'lucide-react'
import { Workspace } from '@/components/layout/AppShell'
import { RailCard } from '@/components/rail/RailPanels'
import { AssistantStatusPanel } from '@/components/rail/RailPanels'
import { IconTile, toneStyles } from '@/components/ui/Badge'
import { assistants } from '@/data/mock'
import { useChat } from '@/state/ChatProvider'
import { cn } from '@/lib/cn'

const icons = { pencil: PencilLine, search: Search, code: Code2, briefcase: Briefcase }

const openers: Record<string, string> = {
  'writing-coach': 'Help me tighten this paragraph without losing its meaning.',
  'research-assistant': 'Research the current best practices for large-scale data migrations.',
  'coding-helper': 'Review my migration service for retry and error-handling gaps.',
  'business-planner': 'Draft a rollout plan for our new pricing model.',
}

export function AssistantsPage() {
  const router = useRouter()
  const { startConversation } = useChat()

  const open = (id: string) =>
    router.push(`/chat/${startConversation(openers[id] ?? 'Help me get started.')}`)

  return (
    <Workspace
      contentClassName="mx-auto w-full max-w-[880px] px-6 py-7 sm:px-8"
      rail={
        <>
          <AssistantStatusPanel />
          <RailCard title="About Assistants">
            <p className="text-sm leading-relaxed text-slate-600">
              Assistants are saved configurations — a role, a tone, and a set of grounding sources.
              Pick one to start a conversation that already knows how you want it to work.
            </p>
          </RailCard>
        </>
      }
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] leading-tight font-bold tracking-[-0.025em] text-slate-900">
            Assistants
          </h1>
          <p className="mt-1 text-[15px] text-slate-500">
            Saved specialists, each tuned for a different kind of work.
          </p>
        </div>
        <button className="inline-flex h-10 items-center gap-2 rounded-field bg-brand-600 px-4 text-sm font-semibold text-white shadow-brand transition-colors hover:bg-brand-700">
          <Plus className="h-4.5 w-4.5" strokeWidth={2.4} />
          New Assistant
        </button>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {assistants.map((assistant) => {
          const Icon = icons[assistant.icon]
          return (
            <div
              key={assistant.id}
              className="flex flex-col rounded-2xl border border-hairline bg-white p-5 transition-all duration-150 hover:border-brand-200 hover:shadow-raised"
            >
              <div className="flex flex-1 items-start gap-4">
                <IconTile tone={assistant.tone} size="lg" className="rounded-full">
                  <Icon strokeWidth={1.9} />
                </IconTile>
                <div className="min-w-0 flex-1">
                  <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-slate-900">
                    {assistant.name}
                  </h2>
                  <p className="mt-1 text-sm leading-snug text-slate-500">
                    {assistant.description}
                  </p>
                </div>
              </div>

              <div className="mt-5 flex items-center justify-between">
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold',
                    toneStyles[assistant.tone].chip,
                  )}
                >
                  <MessageSquare className="h-3.5 w-3.5" strokeWidth={2.2} />
                  {assistant.chats} chats
                </span>

                <button
                  onClick={() => open(assistant.id)}
                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-brand-100 bg-brand-50/70 px-3.5 text-[13px] font-semibold text-brand-700 transition-colors hover:bg-brand-100"
                >
                  <Sparkles className="h-4 w-4" strokeWidth={2} />
                  Start chat
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </Workspace>
  )
}
