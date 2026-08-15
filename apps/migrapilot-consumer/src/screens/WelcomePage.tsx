'use client'

import { useRouter } from 'next/navigation'
import { ArrowRight, BarChart3, Lightbulb, PencilLine, ScrollText } from 'lucide-react'
import { Workspace } from '@/components/layout/AppShell'
import { LogoMark } from '@/components/brand/Logo'
import { Composer, ComposerDisclaimer } from '@/components/chat/Composer'
import { IconTile } from '@/components/ui/Badge'
import { useChat } from '@/state/ChatProvider'

const suggestions = [
  {
    icon: ScrollText,
    title: 'Explain a topic',
    description: 'Get a clear explanation on any topic.',
    prompt: 'Explain how a phased cloud migration works, in plain language.',
  },
  {
    icon: Lightbulb,
    title: 'Generate ideas',
    description: 'Brainstorm creative ideas and solutions.',
    prompt: 'Generate ideas for reducing downtime during our system migration.',
  },
  {
    icon: PencilLine,
    title: 'Write something',
    description: 'Create emails, articles, notes, and more.',
    prompt: 'Write a stakeholder update email about our migration progress.',
  },
  {
    icon: BarChart3,
    title: 'Analyze data',
    description: 'Upload a file and get insights fast.',
    prompt: 'Analyze our migration readiness data and summarise the risks.',
  },
]

export function WelcomePage() {
  const router = useRouter()
  const { startConversation } = useChat()

  const start = (prompt: string) => router.push(`/chat/${startConversation(prompt)}`)

  return (
    <Workspace
      contentClassName="mx-auto flex min-h-full w-full max-w-[820px] flex-col px-6 py-8 sm:px-8"
    >
      <div className="flex flex-1 flex-col items-center justify-center pb-8 text-center">
        <LogoMark className="h-[108px] w-[108px] drop-shadow-[0_12px_28px_rgba(37,99,235,0.28)]" id="hero" />

        <h1 className="mt-7 text-[40px] leading-tight font-bold tracking-[-0.03em] text-slate-900">
          Welcome to MigraPilot
        </h1>
        <p className="mt-3 max-w-md text-[17px] leading-relaxed text-slate-500">
          Your AI assistant for smarter answers, simpler workflows, and better results.
        </p>

        <div className="mt-9 grid w-full gap-4 sm:grid-cols-2">
          {suggestions.map(({ icon: Icon, title, description, prompt }) => (
            <button
              key={title}
              onClick={() => start(prompt)}
              className="group flex items-center gap-4 rounded-2xl border border-hairline bg-white p-4.5 text-left transition-all duration-150 hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-raised"
            >
              <IconTile tone="blue">
                <Icon strokeWidth={2} />
              </IconTile>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold text-slate-900">{title}</span>
                <span className="mt-0.5 block text-sm leading-snug text-slate-500">
                  {description}
                </span>
              </span>
              <ArrowRight className="h-[18px] w-[18px] shrink-0 text-slate-300 transition-all group-hover:translate-x-0.5 group-hover:text-brand-500" />
            </button>
          ))}
        </div>
      </div>

      <div className="mt-auto">
        <Composer onSubmit={start} autoFocus />
        <ComposerDisclaimer className="mt-3.5" />
      </div>
    </Workspace>
  )
}
