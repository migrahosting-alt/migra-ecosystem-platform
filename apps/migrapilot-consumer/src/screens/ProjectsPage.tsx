'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Code2,
  FileUp,
  FolderOpen,
  Globe,
  LayoutGrid,
  Lightbulb,
  List,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Search,
  Share2,
  Sparkles,
  Star,
  TrendingUp,
} from 'lucide-react'
import { Workspace } from '@/components/layout/AppShell'
import { RailCard, RailLink } from '@/components/rail/RailPanels'
import { AvatarStack } from '@/components/ui/Avatar'
import { IconTile, toneStyles } from '@/components/ui/Badge'
import { PillTabs } from '@/components/ui/Tabs'
import { ProgressBar } from '@/components/ui/Progress'
import { projects, recentActivity, workspaceStats } from '@/data/mock'
import type { Project } from '@/data/types'
import { useChat } from '@/state/ChatProvider'
import { cn } from '@/lib/cn'

const projectIcons = { globe: Globe, trend: TrendingUp, book: BookOpen, code: Code2 }

const filters = [
  { id: 'all', label: 'All Projects' },
  { id: 'starred', label: 'Starred' },
  { id: 'recent', label: 'Recent' },
  { id: 'shared', label: 'Shared with me' },
] as const

type Filter = (typeof filters)[number]['id']

const quickStart = [
  { icon: Sparkles, label: 'Ask MigraPilot anything', prompt: 'What should I work on next?' },
  { icon: FileUp, label: 'Upload a file', to: '/files' },
  { icon: Lightbulb, label: 'Generate ideas', prompt: 'Generate ideas for our next project milestone.' },
  { icon: LayoutGrid, label: 'Explore templates', to: '/explore' },
]

function ProjectCard({
  project,
  compact,
  onAsk,
}: {
  project: Project
  compact: boolean
  onAsk: (project: Project) => void
}) {
  const Icon = projectIcons[project.icon]

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      <button className="inline-flex h-9 items-center gap-2 rounded-lg border border-hairline bg-white px-3 text-[13px] font-semibold text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50">
        <FolderOpen className="h-4 w-4 text-slate-400" strokeWidth={2} />
        Open
      </button>
      <button
        onClick={() => onAsk(project)}
        className="inline-flex h-9 items-center gap-2 rounded-lg border border-brand-100 bg-brand-50/70 px-3 text-[13px] font-semibold text-brand-700 transition-colors hover:bg-brand-100"
      >
        <Sparkles className="h-4 w-4" strokeWidth={2} />
        Ask
      </button>
      <button className="inline-flex h-9 items-center gap-2 rounded-lg border border-hairline bg-white px-3 text-[13px] font-semibold text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50">
        <Share2 className="h-4 w-4 text-slate-400" strokeWidth={2} />
        Share
      </button>
    </div>
  )

  const progress = (
    <div className="flex items-center gap-3">
      <ProgressBar
        value={project.progress}
        tone={project.tone}
        label={`${project.name} progress`}
        className={cn(!compact && 'max-w-[220px]')}
      />
      <span
        className={cn(
          'shrink-0 rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums',
          toneStyles[project.tone].chip,
        )}
      >
        {project.progress}%
      </span>
    </div>
  )

  const heading = (
    <>
      <h3 className="flex items-center gap-2 text-[17px] font-semibold tracking-[-0.01em] text-slate-900">
        {project.starred && <Star className="h-4.5 w-4.5 shrink-0 fill-amber-400 text-amber-400" />}
        <span className="truncate">{project.name}</span>
      </h3>
      <p className="mt-1 truncate text-[15px] text-slate-500">{project.description}</p>
    </>
  )

  if (compact) {
    return (
      <div className="rounded-2xl border border-hairline bg-white p-4 transition-all duration-150 hover:border-brand-200 hover:shadow-raised">
        <div className="flex items-start justify-between gap-3">
          <IconTile tone={project.tone} size="lg" className="h-11 w-11 rounded-xl">
            <Icon strokeWidth={2} />
          </IconTile>
          <AvatarStack names={project.members} />
        </div>
        <div className="mt-3.5 min-w-0">{heading}</div>
        <div className="mt-3.5">{progress}</div>
        <div className="mt-3.5 flex items-center justify-between gap-3">
          <span className="text-[13px] text-slate-400">{project.updated}</span>
        </div>
        <div className="mt-2">{actions}</div>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-hairline bg-white p-5 transition-all duration-150 hover:border-brand-200 hover:shadow-raised">
      <div className="flex gap-5">
        <IconTile tone={project.tone} size="lg">
          <Icon strokeWidth={2} />
        </IconTile>

        <div className="grid min-w-0 flex-1 gap-x-6 gap-y-4 md:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0">{heading}</div>

          <div className="flex items-start gap-3 md:justify-end">
            <span className="mt-0.5 text-[13px] whitespace-nowrap text-slate-400">
              {project.updated}
            </span>
            <AvatarStack names={project.members} />
            <button
              aria-label={`Options for ${project.name}`}
              className="-mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            >
              <MoreHorizontal className="h-4.5 w-4.5" />
            </button>
          </div>

          <div className="self-center">{progress}</div>
          <div className="md:justify-self-end">{actions}</div>
        </div>
      </div>
    </div>
  )
}

export function ProjectsPage() {
  const router = useRouter()
  const { startConversation } = useChat()
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [grid, setGrid] = useState(false)

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase()
    return projects.filter((project) => {
      if (filter === 'starred' && !project.starred) return false
      if (filter === 'shared' && project.members.length < 3) return false
      if (!term) return true
      return (
        project.name.toLowerCase().includes(term) ||
        project.description.toLowerCase().includes(term)
      )
    })
  }, [filter, query])

  const ask = (project: Project) =>
    router.push(`/chat/${startConversation(`What's the current status of ${project.name}?`)}`)

  return (
    <Workspace
      contentClassName="mx-auto w-full max-w-[900px] px-6 py-7 sm:px-8"
      rail={
        <>
          <RailCard title="Workspace Overview">
            <ul className="flex flex-col gap-3.5">
              {[
                { icon: FolderOpen, tone: 'blue' as const, label: 'Total Projects', value: workspaceStats.totalProjects },
                { icon: TrendingUp, tone: 'green' as const, label: 'Active Today', value: workspaceStats.activeToday },
                { icon: FileUp, tone: 'purple' as const, label: 'Total Files', value: workspaceStats.totalFiles },
                { icon: MessageSquare, tone: 'amber' as const, label: 'Total Chats', value: workspaceStats.totalChats },
              ].map(({ icon: Icon, tone, label, value }) => (
                <li key={label} className="flex items-center gap-3">
                  <IconTile tone={tone} size="sm" className="h-9 w-9 rounded-lg [&_svg]:h-4.5 [&_svg]:w-4.5">
                    <Icon strokeWidth={2} />
                  </IconTile>
                  <span className="flex-1 text-[15px] text-slate-600">{label}</span>
                  <span className="text-[17px] font-bold text-slate-900 tabular-nums">{value}</span>
                </li>
              ))}
            </ul>
          </RailCard>

          <RailCard title="Recent Activity" action={<RailLink href="/history">View all</RailLink>}>
            <ul className="flex flex-col gap-3">
              {recentActivity.map((entry) => {
                const Icon = projectIcons[entry.icon]
                return (
                  <li key={entry.id} className="flex items-start gap-3">
                    <IconTile tone={entry.tone} size="sm">
                      <Icon strokeWidth={2} />
                    </IconTile>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-800">
                        {entry.project}
                      </p>
                      <p className="truncate text-[13px] text-slate-500">{entry.detail}</p>
                    </div>
                    <span className="shrink-0 text-xs text-slate-400">{entry.time}</span>
                  </li>
                )
              })}
            </ul>
          </RailCard>

          <RailCard title="Quick Start">
            <ul className="flex flex-col gap-1">
              {quickStart.map(({ icon: Icon, label, to, prompt }) => (
                <li key={label}>
                  <button
                    onClick={() =>
                      to ? router.push(to) : router.push(`/chat/${startConversation(prompt!)}`)
                    }
                    className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-slate-50"
                  >
                    <Icon className="h-4.5 w-4.5 shrink-0 text-brand-500" strokeWidth={2} />
                    <span className="flex-1 text-sm font-medium text-slate-700">{label}</span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
                  </button>
                </li>
              ))}
            </ul>
          </RailCard>
        </>
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] leading-tight font-bold tracking-[-0.025em] text-slate-900">
            Projects
          </h1>
          <p className="mt-1 text-[15px] text-slate-500">
            Organize your workspaces and get more done with AI.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search projects..."
              aria-label="Search projects"
              className="h-10 w-full rounded-field border border-slate-200 bg-white pr-3 pl-10 text-sm text-slate-700 placeholder:text-slate-400 focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10 focus:outline-none sm:w-56"
            />
          </div>

          <div className="flex items-center rounded-field border border-slate-200 bg-white p-1">
            {[
              { id: false, icon: List, label: 'List view' },
              { id: true, icon: LayoutGrid, label: 'Grid view' },
            ].map(({ id, icon: Icon, label }) => (
              <button
                key={label}
                onClick={() => setGrid(id)}
                aria-label={label}
                aria-pressed={grid === id}
                className={cn(
                  'inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors',
                  grid === id
                    ? 'bg-brand-50 text-brand-600'
                    : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600',
                )}
              >
                <Icon className="h-4.5 w-4.5" strokeWidth={2} />
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <PillTabs items={[...filters]} value={filter} onChange={setFilter} />
        <button className="inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-500 hover:text-slate-700">
          Sort by: Recent
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>

      <div className={cn('mt-5 grid gap-4', grid && 'sm:grid-cols-2')}>
        {visible.map((project) => (
          <ProjectCard key={project.id} project={project} compact={grid} onAsk={ask} />
        ))}

        {!visible.length && (
          <p className="rounded-2xl border border-dashed border-slate-200 py-14 text-center text-slate-400">
            No projects match that filter.
          </p>
        )}

        <button
          className={cn(
            'flex flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-slate-200 py-10 transition-colors hover:border-brand-300 hover:bg-brand-50/40',
            grid && 'sm:col-span-2',
          )}
        >
          <span className="mb-1.5 inline-flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-500">
            <Plus className="h-5 w-5" strokeWidth={2.4} />
          </span>
          <span className="text-[15px] font-semibold text-slate-800">Create a new project</span>
          <span className="text-[13px] text-slate-400">Start a workspace for your next big idea.</span>
        </button>
      </div>
    </Workspace>
  )
}
