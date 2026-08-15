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
   * Honest placeholder while the real Brain path is being wired.
   *
   * This previously called `demoReply()` and, after a 900 ms fake "thinking"
   * delay, rendered an invented assistant answer — on a PUBLIC site. That is a
   * fabricated capability claim, so it is gone.
   *
   * `callBrain()` refuses without a session ("No session, no Brain call") and
   * derives tenancy from the principal, so real answers cannot land until
   * MigraAuth exists. Until then this states the truth rather than simulating
   * an assistant. Replace this whole function with the `chatTurn` seam — do not
   * reintroduce a local responder.
   */
  const appendReply = useCallback((conversationId: string) => {
    setPendingIn(conversationId)

    window.setTimeout(() => {
      const message: Message = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        time: clockTime(),
        blocks: [
          {
            type: 'paragraph',
            text: "MigraPilot's AI isn't connected to this page yet. Sign-in and the live model are being wired up now — your message wasn't sent to a model, and nothing here is a generated answer.",
          },
        ],
      }

      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === conversationId
            ? { ...conversation, messages: [...conversation.messages, message] }
            : conversation,
        ),
      )
      setPendingIn(null)
    }, 250)
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
      appendReply(id)
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
      appendReply(conversationId)
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
