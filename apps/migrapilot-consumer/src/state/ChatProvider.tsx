'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useRouter } from 'next/navigation'
import type { Block, Conversation, Message } from '@/data/types'
import { titleFromPrompt } from './demoResponder'

interface ChatContextValue {
  conversations: Conversation[]
  byId: (id: string) => Conversation | undefined
  /** Conversation id currently awaiting a reply, if any. */
  pendingIn: string | null
  /** True until the caller's durable conversations have been read once. */
  loading: boolean
  startConversation: (prompt: string) => string
  sendMessage: (conversationId: string, prompt: string) => void
  /** Load one conversation's durable messages. Safe to call repeatedly. */
  openConversation: (conversationId: string) => void
}

const ChatContext = createContext<ChatContextValue | null>(null)

function clockTime() {
  return new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/** Wire shapes from this app's own routes. Never the Brain's. */
interface WireConversation {
  id: string
  title: string
  updatedAt: number | string | null
}
interface WireMessage {
  id: string | null
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: number | string | null
}

/**
 * Does this id name a conversation the Brain knows about?
 *
 * Client-side ids are minted optimistically so a new chat can render and route
 * immediately. Sending one to the Brain would be asking about a conversation
 * that does not exist, so only durable ids are echoed back.
 */
const isDurableId = (id: string): boolean => !id.startsWith('chat-')

function dateOf(value: number | string | null): Date | null {
  if (value === null) return null
  const date = new Date(typeof value === 'number' ? value : Date.parse(value))
  return Number.isNaN(date.getTime()) ? null : date
}

function timeOf(value: number | string | null): string {
  const date = dateOf(value)
  return date ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''
}

/** The sidebar bucket, derived from when the conversation last changed. */
function groupOf(value: number | string | null): Conversation['group'] {
  const date = dateOf(value)
  if (!date) return 'Older'

  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const days = Math.floor((startOfToday.getTime() - date.getTime()) / 86_400_000)

  if (days < 0) return 'Today'
  if (days === 0) return 'Yesterday'
  return days < 6 ? 'This Week' : 'Older'
}

/** Paragraph text of a block, or nothing. `Block` is a union; lists have no `text`. */
const paragraphText = (block: Block | undefined): string | undefined =>
  block?.type === 'paragraph' ? block.text : undefined

/** A durable message becomes the shape the existing renderer already speaks. */
function toMessage(message: WireMessage, index: number): Message {
  const time = timeOf(message.createdAt)
  return message.role === 'user'
    ? { id: message.id ?? `u-${index}`, role: 'user', text: message.content, time, delivered: true }
    : {
        id: message.id ?? `a-${index}`,
        role: 'assistant',
        time,
        blocks: [{ type: 'paragraph', text: message.content }],
      }
}

export function ChatProvider({ children }: { children: ReactNode }) {
  /*
   * Starts EMPTY, not seeded.
   *
   * This list used to come from `src/data/mock.ts` — invented conversations,
   * attributed to an invented user, rendered to real signed-in people on a
   * public site. Whatever is here is now what the Brain durably holds for the
   * authenticated caller, so an empty account honestly shows nothing.
   */
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [pendingIn, setPendingIn] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const counter = useRef(0)
  /** Conversations whose messages have already been fetched. */
  const hydrated = useRef(new Set<string>())
  const router = useRouter()
  /** Optimistic id → durable id, so a URL captured before the swap still resolves. */
  const aliases = useRef(new Map<string, string>())
  /** Mirrors `pendingIn` so the id swap can read it without re-creating callbacks. */
  const pendingRef = useRef<string | null>(null)
  pendingRef.current = pendingIn

  /** Read the caller's durable conversations once, on mount. */
  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const response = await fetch('/api/conversations')
        if (!response.ok) return
        const { conversations: list } = (await response.json()) as { conversations?: WireConversation[] }
        if (cancelled || !list) return

        const loaded: Conversation[] = list.map((conversation) => ({
          id: conversation.id,
          title: conversation.title,
          // Filled in when the conversation is opened and its messages load.
          preview: '',
          time: timeOf(conversation.updatedAt),
          group: groupOf(conversation.updatedAt),
          icon: 'chat',
          tone: 'blue',
          messages: [],
        }))

        /*
         * MERGE, never replace — and never discard messages already in hand.
         *
         * This fetch races two other things, and lost to both:
         *
         *   Starting a chat immediately on load adds an optimistic conversation
         *   before the list arrives. Assigning the loaded array wholesale
         *   discarded it, so the conversation vanished from under the open chat
         *   page, which then redirected home mid-turn.
         *
         *   Opening a conversation directly (a reload, a shared link) fetches
         *   its messages in parallel with this list. Those messages usually win
         *   the race, so overwriting the entry with a fresh `messages: []` threw
         *   away the very thread the page was opened to show — a durable
         *   conversation rendering as empty.
         */
        setConversations((current) => {
          const existing = new Map(current.map((conversation) => [conversation.id, conversation]))
          const merged = loaded.map((conversation) => {
            const held = existing.get(conversation.id)
            return held?.messages.length
              ? { ...conversation, messages: held.messages, preview: held.preview }
              : conversation
          })
          const known = new Set(loaded.map((conversation) => conversation.id))
          return [...current.filter((conversation) => !known.has(conversation.id)), ...merged]
        })
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const openConversation = useCallback((conversationId: string) => {
    // An optimistic id names nothing the Brain has stored, so asking for its
    // messages is a guaranteed 404.
    if (!isDurableId(conversationId)) return
    // A conversation created in this tab already holds its own turns; refetching
    // would be a redundant round trip, not a correctness gain.
    if (hydrated.current.has(conversationId)) return
    hydrated.current.add(conversationId)

    void (async () => {
      try {
        const response = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}/messages`)
        if (!response.ok) {
          // Allow a later retry rather than pinning the failure permanently.
          hydrated.current.delete(conversationId)
          return
        }
        const { messages } = (await response.json()) as { messages?: WireMessage[] }
        if (!messages?.length) return

        const thread = messages.map(toMessage)
        const preview = messages[messages.length - 1]!.content.slice(0, 120)

        setConversations((current) => {
          if (current.some((conversation) => conversation.id === conversationId)) {
            return current.map((conversation) =>
              conversation.id === conversationId
                ? { ...conversation, messages: thread, preview }
                : conversation,
            )
          }

          /*
           * The conversation list has not arrived yet — this is a reload or a
           * shared link, where both fetches are in flight and this one won.
           * Mapping over an empty list would silently drop the thread, so the
           * conversation is inserted here and the list merge fills in its
           * title and timestamp when it lands.
           */
          return [
            {
              id: conversationId,
              title: '',
              preview,
              time: thread[thread.length - 1]?.time ?? '',
              group: 'Today' as const,
              icon: 'chat' as const,
              tone: 'blue' as const,
              messages: thread,
            },
            ...current,
          ]
        })
      } catch {
        hydrated.current.delete(conversationId)
      }
    })()
  }, [])

  /**
   * A real turn against the Brain.
   *
   * This replaces two earlier stand-ins, and must not regress to either: first
   * `demoReply()`, which invented an assistant answer after a fake 900 ms
   * "thinking" delay, then a fixed "AI isn't connected" notice. Both were
   * capability claims the app could not back, on a public site.
   *
   * The request goes to this app's own `/api/chat`, never to the Brain — the
   * browser has no Brain address and no way to assert a tenancy scope. Identity
   * travels as the httpOnly session cookie and is verified server-side.
   *
   * A failure renders as a failure. There is deliberately no fallback text that
   * could be mistaken for a generated answer: if the model did not answer, the
   * message says so and says why.
   */
  const appendReply = useCallback(async (localId: string, prompt: string) => {
    let conversationId = localId
    setPendingIn(conversationId)

    /*
     * Adopt the Brain's id in place of the optimistic client-side one.
     *
     * A new conversation is rendered and routed to before the Brain has named
     * it, so the first turn is the moment the two ids reconcile. The URL has to
     * follow: leaving `/chat/chat-1786…` in the address bar gives the user a
     * link that 404s the moment they reload it.
     *
     * Two things this must NOT do, both learned the hard way:
     *
     *   `window.history.replaceState` is invisible to the App Router, so
     *   `useParams()` kept returning the old id, `byId` found nothing, and the
     *   chat page redirected home mid-turn. The router has to be told.
     *
     *   Even with the router told, the rename and the navigation do not land in
     *   the same commit. The alias keeps the old id resolvable across that gap,
     *   so there is no render in which the open conversation does not exist.
     */
    const adoptDurableId = (from: string, to: string) => {
      hydrated.current.add(to)
      aliases.current.set(from, to)
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === from ? { ...conversation, id: to } : conversation,
        ),
      )
      if (pendingRef.current === from) setPendingIn(to)
      if (window.location.pathname === `/chat/${from}`) {
        router.replace(`/chat/${to}`, { scroll: false })
      }
    }

    const push = (message: Message) => {
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === conversationId
            ? {
                ...conversation,
                messages: [...conversation.messages, message],
                preview: message.text ?? paragraphText(message.blocks?.[0])?.slice(0, 120) ?? conversation.preview,
                time: message.time,
              }
            : conversation,
        ),
      )
      setPendingIn(null)
    }

    const notice = (text: string): Message => ({
      id: `a-${Date.now()}`,
      role: 'assistant',
      time: clockTime(),
      // `error` marks this as a system notice rather than model output, so it
      // can never be read — or copied, or exported — as a generated answer.
      error: true,
      blocks: [{ type: 'paragraph', text }],
    })

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // A brand-new conversation has only a client-side id, which the Brain
        // has never seen; omitting it is what asks the Brain to create one.
        body: JSON.stringify({ prompt, ...(isDurableId(conversationId) ? { conversationId } : {}) }),
      })

      const payload = (await response.json().catch(() => null)) as {
        content?: string
        conversationId?: string
        message?: string
      } | null

      // The durable id arrives on success AND on failure, because the user's
      // message is persisted before the model runs. Adopting it either way is
      // what makes a failed turn retryable in the same conversation.
      if (payload?.conversationId && payload.conversationId !== conversationId) {
        adoptDurableId(conversationId, payload.conversationId)
        conversationId = payload.conversationId
      }

      if (!response.ok) {
        push(
          notice(
            payload?.message ??
              'The assistant could not answer that. Nothing here is a generated answer.',
          ),
        )
        return
      }

      const content = payload?.content
      if (typeof content !== 'string' || !content.trim()) {
        push(notice('The model returned an empty answer.'))
        return
      }

      push({
        id: `a-${Date.now()}`,
        role: 'assistant',
        time: clockTime(),
        blocks: [{ type: 'paragraph', text: content }],
      })
    } catch {
      // A dropped connection is not an answer either.
      push(notice('The assistant could not be reached. Nothing here is a generated answer.'))
    }
  }, [router])

  const startConversation = useCallback(
    (prompt: string) => {
      counter.current += 1
      const id = `chat-${Date.now()}-${counter.current}`
      const conversation: Conversation = {
        id,
        title: titleFromPrompt(prompt),
        preview: prompt,
        time: clockTime(),
        group: 'Today',
        icon: 'chat',
        tone: 'blue',
        messages: [
          { id: `u-${Date.now()}`, role: 'user', text: prompt, time: clockTime(), delivered: true },
        ],
      }

      setConversations((current) => [conversation, ...current])
      void appendReply(id, prompt)
      return id
    },
    [appendReply],
  )

  const sendMessage = useCallback(
    (conversationId: string, prompt: string) => {
      const message: Message = {
        id: `u-${Date.now()}`,
        role: 'user',
        text: prompt,
        time: clockTime(),
        delivered: true,
      }

      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === conversationId
            ? { ...conversation, messages: [...conversation.messages, message] }
            : conversation,
        ),
      )
      void appendReply(conversationId, prompt)
    },
    [appendReply],
  )

  const value = useMemo<ChatContextValue>(
    () => ({
      conversations,
      byId: (id) => {
        const direct = conversations.find((conversation) => conversation.id === id)
        if (direct) return direct
        const aliased = aliases.current.get(id)
        return aliased ? conversations.find((conversation) => conversation.id === aliased) : undefined
      },
      pendingIn,
      loading,
      startConversation,
      sendMessage,
      openConversation,
    }),
    [conversations, pendingIn, loading, startConversation, sendMessage, openConversation],
  )

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
}

export function useChat() {
  const context = useContext(ChatContext)
  if (!context) throw new Error('useChat must be used inside <ChatProvider>')
  return context
}
