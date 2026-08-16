'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import {
  ChevronDown,
  ChevronUp,
  Download,
  Filter,
  FolderOpen,
  ListChecks,
  MoreVertical,
  Play,
  Share2,
  SquareLibrary,
} from 'lucide-react'
import { Workspace } from '@/components/layout/AppShell'
import { Composer, ComposerDisclaimer } from '@/components/chat/Composer'
import { MessageView, TypingIndicator } from '@/components/chat/Message'
import { DiagramPreview } from '@/components/chat/DiagramPreview'
import { ActionRow, RailCard } from '@/components/rail/RailPanels'
import { IconTile } from '@/components/ui/Badge'
import { IconButton } from '@/components/ui/Button'
import { FileTypeIcon } from '@/components/ui/FileTypeIcon'
import { UnderlineTabs } from '@/components/ui/Tabs'
import { CopyButton } from '@/components/ui/CopyField'
import { ScopeApprovalModal } from '@/features/governance/ScopeApprovalModal'
import { mediaLibrary } from '@/data/mock'
import type { Attachment } from '@/data/types'
import { useChat } from '@/state/ChatProvider'
import { cn } from '@/lib/cn'

/* ---------------------------------------------------------------- *
 * Rails
 * ---------------------------------------------------------------- */

const conversationTools = [
  {
    icon: ListChecks,
    tone: 'blue' as const,
    title: 'Summary',
    subtitle: 'Get a quick summary of this conversation.',
  },
  {
    icon: Download,
    tone: 'green' as const,
    title: 'Export',
    subtitle: 'Export this conversation or save as a file.',
  },
  {
    icon: SquareLibrary,
    tone: 'purple' as const,
    title: 'Sources',
    subtitle: 'View the sources and references used.',
  },
]

function ConversationToolsRail() {
  const [open, setOpen] = useState(true)

  return (
    <RailCard
      title={
        <button
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="flex flex-1 items-center justify-between gap-3 text-left"
        >
          <span className="text-[15px] font-semibold tracking-[-0.01em] text-slate-900">
            Conversation Tools
          </span>
          {open ? (
            <ChevronUp className="h-4 w-4 text-slate-400" />
          ) : (
            <ChevronDown className="h-4 w-4 text-slate-400" />
          )}
        </button>
      }
    >
      {open && (
        <div className="flex animate-fade flex-col gap-3">
          {conversationTools.map(({ icon: Icon, tone, title, subtitle }) => (
            <ActionRow
              key={title}
              icon={
                <IconTile tone={tone} size="md">
                  <Icon strokeWidth={2} />
                </IconTile>
              }
              title={title}
              subtitle={subtitle}
              trailing={<span className="text-slate-300">→</span>}
              className="items-start"
            />
          ))}
        </div>
      )}
    </RailCard>
  )
}

const mediaFilters = [
  { id: 'all', label: 'All' },
  { id: 'images', label: 'Images' },
  { id: 'audio', label: 'Audio' },
  { id: 'files', label: 'Files' },
] as const

type MediaFilter = (typeof mediaFilters)[number]['id']

function matchesFilter(attachment: Attachment, filter: MediaFilter) {
  if (filter === 'all') return true
  if (filter === 'images') return attachment.kind === 'image'
  if (filter === 'audio') return attachment.kind === 'audio'
  return attachment.kind === 'document'
}

function MediaThumb({ attachment }: { attachment: Attachment }) {
  if (attachment.kind === 'image' && attachment.preview) {
    return (
      <span className="h-10 w-12 shrink-0 overflow-hidden rounded-lg border border-hairline bg-white p-0.5">
        <DiagramPreview variant={attachment.preview} />
      </span>
    )
  }
  if (attachment.kind === 'audio') {
    return (
      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600">
        <Play className="ml-0.5 h-4 w-4 fill-current" />
      </span>
    )
  }
  return <FileTypeIcon name={attachment.name} size="lg" className="h-10 w-10" />
}

function MediaRail() {
  const [filter, setFilter] = useState<MediaFilter>('all')
  const visible = mediaLibrary.filter((item) => matchesFilter(item, filter))
  const groups = ['Today', 'Yesterday'] as const

  return (
    <RailCard
      title="Media"
      action={
        <IconButton label="Filter media" className="-mr-1">
          <Filter className="h-4.5 w-4.5" strokeWidth={1.9} />
        </IconButton>
      }
      bodyClassName="-mt-1"
    >
      <UnderlineTabs items={[...mediaFilters]} value={filter} onChange={setFilter} />

      <div className="mt-4 flex flex-col gap-4">
        {groups.map((group) => {
          const items = visible.filter((item) => item.uploadedAt === group)
          if (!items.length) return null

          return (
            <div key={group}>
              <p className="mb-2 text-[13px] font-semibold text-slate-500">{group}</p>
              <ul className="flex flex-col gap-2.5">
                {items.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center gap-2.5 rounded-xl border border-hairline bg-white p-2.5 transition-colors hover:border-brand-200"
                  >
                    <MediaThumb attachment={item} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-semibold text-slate-800">
                        {item.name}
                      </span>
                      <span className="block truncate text-[11px] text-slate-400">
                        {item.duration ? `${item.duration} • ` : ''}
                        {item.size} •{' '}
                        {item.kind === 'document'
                          ? 'Document'
                          : item.kind === 'image'
                            ? 'Image'
                            : 'Audio'}
                      </span>
                    </span>
                    <IconButton label={`Options for ${item.name}`} className="h-6 w-6">
                      <MoreVertical className="h-4 w-4" />
                    </IconButton>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}

        {!visible.length && (
          <p className="rounded-xl border border-dashed border-slate-200 py-8 text-center text-sm text-slate-400">
            Nothing here yet.
          </p>
        )}
      </div>

      <Link
        href="/files"
        className="mt-4 flex h-11 items-center justify-center gap-2.5 rounded-field border border-hairline bg-white text-sm font-semibold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50"
      >
        <FolderOpen className="h-4.5 w-4.5 text-slate-400" strokeWidth={1.9} />
        View all files
      </Link>
    </RailCard>
  )
}

/* ---------------------------------------------------------------- *
 * Page
 * ---------------------------------------------------------------- */

export function ChatPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const id = typeof params?.id === 'string' ? params.id : ''
  const { byId, sendMessage, pendingIn, loading, openConversation } = useChat()
  const conversation = byId(id)
  const [scopeOpen, setScopeOpen] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const messageCount = conversation?.messages.length ?? 0
  const pending = pendingIn === id

  // Jump to the newest turn on load, then glide for turns added afterwards.
  const first = useRef(true)
  useLayoutEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: first.current ? 'auto' : 'smooth' })
  }, [messageCount, pending])
  useEffect(() => {
    first.current = false
  }, [])

  // Pull this conversation's durable messages in. The provider only holds
  // titles until a conversation is opened, so on a fresh load — a reload, or a
  // shared link — this is what puts the thread on screen.
  useEffect(() => {
    if (id) openConversation(id)
  }, [id, openConversation])

  // An unknown conversation id sends the user home. Done in an effect rather
  // than during render because navigation is a side effect in the App Router.
  //
  // `loading` is what makes a reload work: the conversation list is fetched
  // after mount, so on the first render of `/chat/<id>` NO conversation is
  // known yet. Redirecting on that would bounce every reload straight home
  // before the durable history ever arrived.
  useEffect(() => {
    if (!loading && !conversation) router.replace('/')
  }, [loading, conversation, router])

  if (!conversation) return null

  const framed = Boolean(conversation.hasMedia)

  const thread = (
    <div className={cn('flex flex-col gap-6', framed && 'px-5 py-6 sm:px-6')}>
      {conversation.messages.map((message) => (
        <MessageView
          key={message.id}
          message={message}
          onReviewScope={() => setScopeOpen(true)}
        />
      ))}
      {pending && <TypingIndicator />}
      <div ref={bottomRef} />
    </div>
  )

  return (
    <>
      <Workspace
        rail={framed ? <MediaRail /> : <ConversationToolsRail />}
        contentClassName="mx-auto flex min-h-full w-full max-w-[880px] flex-col px-6 py-7 sm:px-8"
      >
        <div className="flex-1">
          {framed ? (
            <div className="overflow-hidden rounded-2xl border border-hairline bg-white shadow-card">
              <div className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-3.5">
                <button className="flex items-center gap-2 rounded-lg text-[17px] font-semibold tracking-[-0.01em] text-slate-900">
                  {conversation.title}
                  <ChevronDown className="h-4.5 w-4.5 text-slate-400" />
                </button>
                <div className="flex items-center gap-1">
                  <CopyButton
                    value={conversation.messages.map((m) => m.text ?? '').join('\n')}
                    label="Copy conversation"
                    className="h-9 w-9"
                  />
                  <IconButton label="Share conversation">
                    <Share2 className="h-4.5 w-4.5" strokeWidth={1.9} />
                  </IconButton>
                </div>
              </div>
              {thread}
            </div>
          ) : (
            thread
          )}
        </div>

        <div className="sticky bottom-0 mt-7 bg-canvas pb-1">
          {/* fades the thread out as it passes behind the pinned composer */}
          <div className="pointer-events-none -mt-6 h-6 bg-linear-to-b from-transparent to-canvas" />
          <Composer
            variant={framed ? 'media' : 'default'}
            onSubmit={(value) => sendMessage(conversation.id, value)}
          />
          {!framed && <ComposerDisclaimer className="mt-3.5" />}
        </div>

        {framed && <ComposerDisclaimer className="mt-1 mb-1" />}
      </Workspace>

      <ScopeApprovalModal open={scopeOpen} onClose={() => setScopeOpen(false)} />
    </>
  )
}
