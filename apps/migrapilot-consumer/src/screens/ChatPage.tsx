'use client'

import { useEffect, useLayoutEffect, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Workspace } from '@/components/layout/AppShell'
import { Composer, ComposerDisclaimer } from '@/components/chat/Composer'
import { MessageView, TypingIndicator } from '@/components/chat/Message'
import { RailCard } from '@/components/rail/RailPanels'
import { useChat } from '@/state/ChatProvider'
import { FeedbackProvider } from '@/state/FeedbackProvider'
import { ConversationMenu } from '@/features/conversations/ConversationMenu'
import { AnonymousQuotaNotice } from '@/features/anonymous/AnonymousQuotaNotice'
import { isExhausted, useAnonymousQuota } from '@/features/anonymous/AnonymousQuotaProvider'

/* ---------------------------------------------------------------- *
 * Rails
 * ---------------------------------------------------------------- */

/**
 * WHAT YOU CAN DO TO THIS CONVERSATION, and nothing you cannot.
 *
 * This rail used to offer Summary, Export and Sources as three rows with a
 * trailing arrow and no handler between them — the exact shape of a working
 * control, promising a summariser that does not exist, an export that never ran,
 * and a source list for a product that had no citations to show.
 *
 * What replaced them is what is actually built. Rename and Export are real and
 * immediate; Delete is real and asks first. Summary and Sources are gone rather
 * than disabled: a greyed-out row still advertises a feature, and these two are
 * not "switched off", they were never written.
 */
function ConversationToolsRail({
  conversationId,
  title,
  onDeleted,
}: {
  conversationId: string
  title?: string
  onDeleted: () => void
}) {
  return (
    <RailCard title="Conversation">
      {/*
        THE NAME, WHERE IT IS RENAMED.
        Renaming worked end to end — the PATCH returned 200, the record changed,
        and History showed the new name — but this view displayed the title
        NOWHERE, so from inside the conversation the control looked dead. A rename
        you cannot see is indistinguishable from one that did not happen, and that
        is what it was reported as.
      */}
      {title && (
        <p className="mb-1.5 truncate text-[14px] font-semibold text-slate-800" title={title}>
          {title}
        </p>
      )}
      <p className="text-[13px] leading-relaxed text-slate-500">
        Rename it, keep a copy, or delete it for good.
      </p>
      <div className="mt-3">
        <ConversationMenu conversationId={conversationId} onDeleted={onDeleted} align="left" />
      </div>
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
  const { byId, sendMessage, detachConversationImage,
    detachConversationFile, pendingIn, loading, openConversation, isMissingConversation } = useChat()
  const allowance = useAnonymousQuota()
  const outOfTurns = isExhausted(allowance)
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
    /*
     * ONLY WHEN THE SERVER HAS SAID SO. This used to fire on "the list finished
     * and this id is not in it", which is a race: the thread's own fetch may
     * still be in flight. Signing in from a conversation landed on the home page
     * for exactly that reason — every server hop was correct, the claim moved the
     * conversation, the callback redirected to it, and this bounced the user off
     * it a moment later.
     */
    if (!loading && !conversation && isMissingConversation(id)) router.replace('/')
  }, [loading, conversation, id, isMissingConversation, router])

  if (!conversation) return null

  /*
   * The media frame is gone, and so is the branch that rendered it.
   *
   * It hung off `const framed = false` — permanently unreachable — and carried a
   * title button with no handler and a Share control that shared nothing. Dead
   * code is not harmless when it is dead UI: the next person to flip that flag
   * gets three broken controls and no warning that they were never wired. It
   * comes back with real attachments and a real share, not before.
   */
  /*
   * Feedback is loaded ONCE for the whole conversation and provided to every
   * turn, rather than each message fetching its own. Wrapping the thread also
   * means the state resets when the conversation changes — a thumb from another
   * conversation must never render here.
   */
  const thread = (
    <FeedbackProvider conversationId={conversation.id}>
      <div className="flex flex-col gap-6">
        {conversation.messages.map((message) => (
          <MessageView
            key={message.id}
            message={message}
          />
        ))}
        {pending && <TypingIndicator />}
        <div ref={bottomRef} />
      </div>
    </FeedbackProvider>
  )

  return (
    <>
      <Workspace
        rail={
          <ConversationToolsRail
            conversationId={conversation.id}
            title={conversation.title}
            // The thread the page is showing no longer exists, so the page must
            // not keep showing it.
            onDeleted={() => router.replace('/')}
          />
        }
        contentClassName="mx-auto flex min-h-full w-full max-w-[880px] flex-col px-6 py-7 sm:px-8"
      >
        <div className="flex-1">{thread}</div>

        <div className="sticky bottom-0 mt-7 bg-canvas pb-1">
          {/* fades the thread out as it passes behind the pinned composer */}
          <div className="pointer-events-none -mt-6 h-6 bg-linear-to-b from-transparent to-canvas" />
          {/*
            Above the composer, not below the thread: this is the last thing read
            before typing, which is when the count actually changes a decision.
          */}
          <AnonymousQuotaNotice className="mb-3.5" />
          <Composer
            onSubmit={(value, meta) => {
              if (outOfTurns) return
              sendMessage(conversation.id, value, meta)
            }}
            {...(conversation.imageRefs?.length ? { conversationImages: conversation.imageRefs } : {})}
            onDetachConversationImage={(ref) => void detachConversationImage(conversation.id, ref)}
            {...(conversation.groundingFiles?.length
              ? { conversationFiles: conversation.groundingFiles }
              : {})}
            onDetachConversationFile={(name) => void detachConversationFile(conversation.id, name)}
            disabled={outOfTurns}
            disabledReason="You have used all your free messages. Sign in or create an account to keep going — this conversation comes with you."
          />
          <ComposerDisclaimer className="mt-3.5" />
        </div>
      </Workspace>

    </>
  )
}
