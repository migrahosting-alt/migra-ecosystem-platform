'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  ChevronDown,
  ChevronUp,
  Download,
  ListChecks,
  Share2,
  SquareLibrary,
} from 'lucide-react'
import { Workspace } from '@/components/layout/AppShell'
import { Composer, ComposerDisclaimer } from '@/components/chat/Composer'
import { MessageView, TypingIndicator } from '@/components/chat/Message'
import { ActionRow, RailCard } from '@/components/rail/RailPanels'
import { IconTile } from '@/components/ui/Badge'
import { IconButton } from '@/components/ui/Button'
import { CopyButton } from '@/components/ui/CopyField'
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

/* ---------------------------------------------------------------- *
 * Page
 * ---------------------------------------------------------------- */

export function ChatPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const id = typeof params?.id === 'string' ? params.id : ''
  const { byId, sendMessage, pendingIn, loading, openConversation } = useChat()
  const conversation = byId(id)
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

  // A new conversation is routed to under an optimistic id, and the Brain names
  // it a moment later. Once `byId` resolves that alias to a different id, the
  // address bar is stale — and a stale one is a link that 404s on reload. Doing
  // it here rather than in the provider means it happens when this page is
  // actually mounted on that id, not on a guess about the pathname.
  const settledId = conversation?.id
  useEffect(() => {
    if (settledId && id && settledId !== id) {
      router.replace(`/chat/${settledId}`, { scroll: false })
    }
  }, [settledId, id, router])

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

  /*
   * The media rail is gone with its data.
   *
   * It rendered `mediaLibrary` from `src/data/mock.ts` — invented attachments —
   * behind `conversation.hasMedia`, a flag only the mock seed ever set. Durable
   * conversations come from the Brain and never set it, so this was unreachable
   * fabrication kept alive by a dead import. It returns with real attachments,
   * not before.
   */
  const framed = false

  const thread = (
    <div className={cn('flex flex-col gap-6', framed && 'px-5 py-6 sm:px-6')}>
      {conversation.messages.map((message) => (
        <MessageView
          key={message.id}
          message={message}
        />
      ))}
      {pending && <TypingIndicator />}
      <div ref={bottomRef} />
    </div>
  )

  return (
    <>
      <Workspace
        rail={<ConversationToolsRail />}
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

    </>
  )
}
