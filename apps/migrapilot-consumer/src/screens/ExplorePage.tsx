'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ChevronRight,
  FileText,
  Globe,
  Search,
  ShieldCheck,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react'
import { Workspace } from '@/components/layout/AppShell'
import { Composer } from '@/components/chat/Composer'
import { RailCard, RailLink } from '@/components/rail/RailPanels'
import { ChipTabs } from '@/components/ui/Tabs'
import { LogoMark } from '@/components/brand/Logo'
import { researchAnswer } from '@/data/mock'
import { useChat } from '@/state/ChatProvider'
import { cn } from '@/lib/cn'

const scopes = [
  { id: 'all', label: 'All', icon: <Search className="h-4 w-4" strokeWidth={2} /> },
  { id: 'web', label: 'Web', icon: <Globe className="h-4 w-4" strokeWidth={2} /> },
  { id: 'docs', label: 'Docs', icon: <FileText className="h-4 w-4" strokeWidth={2} /> },
  { id: 'files', label: 'Files', icon: <FileText className="h-4 w-4" strokeWidth={2} /> },
] as const

type Scope = (typeof scopes)[number]['id']

export function ExplorePage() {
  const router = useRouter()
  const { startConversation } = useChat()
  const [scope, setScope] = useState<Scope>('all')
  const [vote, setVote] = useState<'up' | 'down' | null>(null)
  const answer = researchAnswer

  return (
    <Workspace
      contentClassName="mx-auto w-full max-w-[880px] px-6 py-7 sm:px-8"
      rail={
        <>
          <RailCard title="Sources" action={<RailLink href="/files">View all</RailLink>}>
            <ul className="flex flex-col gap-4">
              {answer.sources.map((source) => (
                <li key={source.id} className="flex gap-3">
                  <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-brand-50 text-xs font-bold text-brand-700">
                    {source.n}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">{source.title}</p>
                    <p className="mt-0.5 text-[13px] leading-snug text-slate-500">
                      {source.description}
                    </p>
                    <a
                      href={`https://${source.domain}`}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1.5 inline-block rounded-md bg-brand-50/70 px-2 py-1 text-xs font-medium text-brand-700 transition-colors hover:bg-brand-100"
                    >
                      {source.domain}
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          </RailCard>

          <RailCard title="Related Topics">
            <ul className="flex flex-col gap-2.5">
              {answer.related.map((topic) => (
                <li key={topic}>
                  <button
                    onClick={() => router.push(`/chat/${startConversation(topic)}`)}
                    className="flex w-full items-center gap-2.5 rounded-lg border border-hairline bg-white px-3 py-2.5 text-left text-[13px] font-medium text-slate-700 transition-colors hover:border-brand-200 hover:bg-brand-50/50"
                  >
                    <Search className="h-4 w-4 shrink-0 text-slate-400" strokeWidth={2} />
                    <span className="truncate">{topic}</span>
                  </button>
                </li>
              ))}
            </ul>
          </RailCard>

          <div className="flex gap-3.5 rounded-card border border-brand-100 bg-brand-50/60 p-4">
            <ShieldCheck className="h-6 w-6 shrink-0 text-brand-600" strokeWidth={1.9} />
            <div>
              <p className="text-[13px] leading-relaxed text-slate-600">
                Answers are grounded in trusted sources. Learn more about how MigraPilot ensures
                accuracy.
              </p>
              <button className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-semibold text-brand-600 hover:text-brand-700">
                Learn more
                <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.5} />
              </button>
            </div>
          </div>
        </>
      }
    >
      <h1 className="text-[28px] leading-tight font-bold tracking-[-0.025em] text-slate-900">
        Research
      </h1>
      <p className="mt-1 text-[15px] text-slate-500">Get grounded answers with trusted sources.</p>

      <Composer
        className="mt-5"
        variant="research"
        highlighted
        defaultValue={answer.question}
        placeholder="Ask a research question…"
        onSubmit={(value) => router.push(`/chat/${startConversation(value)}`)}
      />

      <ChipTabs items={[...scopes]} value={scope} onChange={setScope} className="mt-5" />

      <article className="mt-5 rounded-2xl border border-hairline bg-white p-5 shadow-card sm:p-6">
        <header className="flex items-center gap-2.5">
          <LogoMark className="h-7 w-7" id="research" />
          <span className="text-[15px] font-semibold text-slate-900">MigraPilot</span>
          <span className="rounded-md bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
            Answer
          </span>
        </header>

        <p className="mt-4 text-[15px] leading-[1.7] text-slate-700">{answer.summary}</p>
        <p className="mt-3 text-[15px] leading-[1.7] text-slate-700">
          Here are the key steps and best practices:
        </p>

        <ol className="mt-4 flex flex-col">
          {answer.steps.map((step, index) => (
            <li
              key={step.title}
              className={cn(
                'flex items-start gap-3.5 py-4',
                index > 0 && 'border-t border-hairline',
              )}
            >
              <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">
                {index + 1}
              </span>

              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold text-slate-900">{step.title}</p>
                <p className="mt-1 text-[15px] leading-[1.6] text-slate-600">{step.text}</p>
              </div>

              <div className="flex shrink-0 gap-1.5">
                {step.citations.map((citation) => (
                  <button
                    key={citation}
                    title={`Source ${citation}: ${answer.sources.find((s) => s.n === citation)?.title}`}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-hairline bg-white text-xs font-semibold text-slate-500 transition-colors hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700"
                  >
                    {citation}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ol>

        <footer className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-4">
          <div className="flex items-center gap-2.5">
            <span className="text-sm text-slate-500">Was this answer helpful?</span>
            <button
              aria-label="Helpful"
              aria-pressed={vote === 'up'}
              onClick={() => setVote(vote === 'up' ? null : 'up')}
              className={cn(
                'inline-flex h-9 w-9 items-center justify-center rounded-lg border border-hairline transition-colors',
                vote === 'up'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-600'
                  : 'text-slate-400 hover:bg-slate-50 hover:text-slate-600',
              )}
            >
              <ThumbsUp className="h-4 w-4" />
            </button>
            <button
              aria-label="Not helpful"
              aria-pressed={vote === 'down'}
              onClick={() => setVote(vote === 'down' ? null : 'down')}
              className={cn(
                'inline-flex h-9 w-9 items-center justify-center rounded-lg border border-hairline transition-colors',
                vote === 'down'
                  ? 'border-red-200 bg-red-50 text-red-600'
                  : 'text-slate-400 hover:bg-slate-50 hover:text-slate-600',
              )}
            >
              <ThumbsDown className="h-4 w-4" />
            </button>
          </div>

          <button
            onClick={() => router.push(`/chat/${startConversation(answer.question)}`)}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-brand-700"
          >
            Ask a follow-up
            <ChevronRight className="h-4 w-4" strokeWidth={2.5} />
          </button>
        </footer>
      </article>
    </Workspace>
  )
}
