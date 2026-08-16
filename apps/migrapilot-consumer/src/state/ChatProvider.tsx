'use client'

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { conversations as seedConversations } from '@/data/mock'
import type { Conversation, Message } from '@/data/types'
import { titleFromPrompt } from './demoResponder'

interface ChatContextValue {
  conversations: Conversation[]
  byId: (id: string) => Conversation | undefined
  /** Conversation id currently awaiting a reply, if any. */
  pendingIn: string | null
  startConversation: (prompt: string) => string
  sendMessage: (conversationId: string, prompt: string) => void
}

const ChatContext = createContext<ChatContextValue | null>(null)

function clockTime() {
  return new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function ChatProvider({ children }: { children: ReactNode }) {
  const [conversations, setConversations] = useState<Conversation[]>(seedConversations)
  const [pendingIn, setPendingIn] = useState<string | null>(null)
  const counter = useRef(0)

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
  const appendReply = useCallback(async (conversationId: string, prompt: string) => {
    setPendingIn(conversationId)

    const push = (message: Message) => {
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === conversationId
            ? { ...conversation, messages: [...conversation.messages, message] }
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
        body: JSON.stringify({ prompt }),
      })

      if (!response.ok) {
        const detail = (await response.json().catch(() => null)) as { message?: string } | null
        push(
          notice(
            detail?.message ??
              'The assistant could not answer that. Nothing here is a generated answer.',
          ),
        )
        return
      }

      const { content } = (await response.json()) as { content?: string }
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
  }, [])

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
      byId: (id) => conversations.find((conversation) => conversation.id === id),
      pendingIn,
      startConversation,
      sendMessage,
    }),
    [conversations, pendingIn, startConversation, sendMessage],
  )

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
}

export function useChat() {
  const context = useContext(ChatContext)
  if (!context) throw new Error('useChat must be used inside <ChatProvider>')
  return context
}
