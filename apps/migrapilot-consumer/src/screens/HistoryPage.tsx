'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  BarChart3,
  ChevronDown,
  FileSpreadsheet,
  FileText,
  Mail,
  MessageSquare,
  MoreHorizontal,
  Search,
  SquarePen,
} from 'lucide-react'
import { Workspace } from '@/components/layout/AppShell'
import { IconTile } from '@/components/ui/Badge'
import type { Conversation } from '@/data/types'
import { useChat } from '@/state/ChatProvider'
import { cn } from '@/lib/cn'

const conversationIcons = {
  chat: MessageSquare,
  doc: FileText,
  sheet: FileSpreadsheet,
  chart: BarChart3,
  mail: Mail,
}

const groups = ['Today', 'Yesterday', 'This Week'] as const

function HistorySidebar({
  conversations,
  activeId,
  onSelect,
}: {
  conversations: Conversation[]
  activeId: string | null
  onSelect: (id: string) => void
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  return (
    <div className="scroll-slim flex h-full flex-col overflow-y-auto px-4 py-6">
      <div className="flex items-center justify-between px-1.5">
        <h2 className="text-[19px] font-bold tracking-[-0.02em] text-slate-900">Chat History</h2>
        <Link
          href="/"
          aria-label="Start a new chat"
          title="Start a new chat"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
        >
          <SquarePen className="h-[18px] w-[18px]" strokeWidth={1.9} />
        </Link>
      </div>

      <div className="mt-5 flex flex-col gap-4">
        {groups.map((group) => {
          const items = conversations.filter((conversation) => conversation.group === group)
          if (!items.length) return null
          const isCollapsed = collapsed[group]

          return (
            <section key={group}>
              <button
                onClick={() => setCollapsed((current) => ({ ...current, [group]: !isCollapsed }))}
                aria-expanded={!isCollapsed}
                className="flex w-full items-center gap-1.5 px-1.5 py-1 text-[13px] font-semibold text-slate-500 hover:text-slate-700"
              >
                <ChevronDown
                  className={cn('h-4 w-4 transition-transform', isCollapsed && '-rotate-90')}
                />
                {group}
              </button>

              {!isCollapsed && (
                <ul className="mt-1 flex flex-col gap-0.5">
                  {items.map((conversation) => {
                    const Icon = conversationIcons[conversation.icon]
                    const active = conversation.id === activeId

                    return (
                      <li key={conversation.id}>
                        <button
                          onClick={() => onSelect(conversation.id)}
                          className={cn(
                            'group flex w-full items-start gap-3 rounded-xl p-2.5 text-left transition-colors',
                            active ? 'bg-brand-50' : 'hover:bg-slate-50',
                          )}
                        >
                          <IconTile tone={conversation.tone} size="sm">
                            <Icon strokeWidth={2} />
                          </IconTile>

                          <span className="min-w-0 flex-1">
                            <span className="flex items-baseline justify-between gap-2">
                              <span
                                className={cn(
                                  'truncate text-sm font-semibold',
                                  active ? 'text-brand-800' : 'text-slate-800',
                                )}
                              >
                                {conversation.title}
                              </span>
                              <span className="shrink-0 text-xs text-slate-400">
                                {conversation.time}
                              </span>
                            </span>
                            <span className="mt-0.5 block truncate text-[13px] text-slate-500">
                              {conversation.preview}
                            </span>
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          )
        })}
      </div>

      <Link
        href="/history"
        className="mt-5 flex h-11 shrink-0 items-center justify-center gap-2 rounded-field border border-hairline bg-white text-sm font-semibold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50"
      >
        View All History
        <span aria-hidden>→</span>
      </Link>
    </div>
  )
}

export function HistoryPage() {
  const router = useRouter()
  const { conversations } = useChat()
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return conversations
    return conversations.filter(
      (conversation) =>
        conversation.title.toLowerCase().includes(term) ||
        conversation.preview.toLowerCase().includes(term),
    )
  }, [conversations, query])

  const recent = filtered.slice(0, 5)

  return (
    <Workspace
      contentClassName="mx-auto w-full max-w-[920px] px-6 py-7 sm:px-8"
      secondary={
        <HistorySidebar
          conversations={filtered}
          activeId={filtered[0]?.id ?? null}
          onSelect={(id) => router.push(`/chat/${id}`)}
        />
      }
    >
      <div className="relative">
        <Search className="absolute top-1/2 left-4 h-[18px] w-[18px] -translate-y-1/2 text-slate-400" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search conversations, assistants, or topics..."
          aria-label="Search history"
          className="h-12 w-full rounded-field border border-slate-200 bg-white pr-16 pl-12 text-[15px] text-slate-700 placeholder:text-slate-400 focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10 focus:outline-none"
        />
        <kbd className="absolute top-1/2 right-4 -translate-y-1/2 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-sans text-xs font-medium text-slate-400">
          ⌘K
        </kbd>
      </div>

      <section className="mt-9">
        <div className="flex items-center justify-between">
          <h2 className="text-[21px] font-bold tracking-[-0.02em] text-slate-900">
            Recent Conversations
          </h2>
          <button className="text-[13px] font-semibold text-brand-600 hover:text-brand-700">
            View all
          </button>
        </div>

        <ul className="mt-4 flex flex-col gap-2.5">
          {recent.map((conversation) => {
            const Icon = conversationIcons[conversation.icon]
            return (
              <li key={conversation.id}>
                <button
                  onClick={() => router.push(`/chat/${conversation.id}`)}
                  className="flex w-full items-center gap-4 rounded-2xl border border-hairline bg-white p-4 text-left transition-all duration-150 hover:border-brand-200 hover:shadow-card"
                >
                  <IconTile tone={conversation.tone} size="md">
                    <Icon strokeWidth={2} />
                  </IconTile>

                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold text-slate-900">
                      {conversation.title}
                    </span>
                    <span className="mt-0.5 block truncate text-sm text-slate-500">
                      {conversation.preview}
                    </span>
                  </span>

                  <span className="shrink-0 text-[13px] text-slate-400">{conversation.time}</span>
                  <span
                    aria-hidden
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400"
                  >
                    <MoreHorizontal className="h-4.5 w-4.5" />
                  </span>
                </button>
              </li>
            )
          })}

          {!recent.length && (
            <li className="rounded-2xl border border-dashed border-slate-200 py-12 text-center text-slate-400">
              {/* "No match" and "none yet" are different facts. With the seeded list gone,
                  an empty account hit the search-miss copy and was told its own history had
                  been filtered out — implying conversations existed somewhere. */}
              {query.trim()
                ? `No conversations match “${query}”.`
                : 'No conversations yet. Start one from New Chat.'}
            </li>
          )}
        </ul>
      </section>

      <section className="mt-9 pb-4">
        <h2 className="text-[21px] font-bold tracking-[-0.02em] text-slate-900">Coding Runs</h2>
        <p className="mt-1 text-[15px] text-slate-500">
          Governed changes MigraPilot has executed on your behalf.
        </p>

        {/* No run LIST exists. `getCodingRun(id)` reads ONE run by id, but no seam
            enumerates them, and runs are started by the VS Code extension — the consumer
            watches. Two invented runs used to sit here with fabricated ids, file counts
            and "lines modified", which read as a record of the user's real work. */}
        <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 px-6 py-8 text-center">
          <p className="text-[14px] leading-relaxed text-slate-500">
            Runs are started from the MigraPilot VS Code extension. This app can open a run by
            its id, but cannot list your runs yet.
          </p>
        </div>
      </section>

    </Workspace>
  )
}
