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
import { demoReply, titleFromPrompt } from './demoResponder'

interface ChatContextValue {
  conversations: Conversation[]
  byId: (id: string) => Conversation | undefined
  /** Conversation id currently awaiting a reply, if any. */
  pendingIn: string | null
  startConversation: (prompt: string) => string
  sendMessage: (conversationId: string, prompt: string) => void
}

const ChatContext = createContext<ChatContextValue | null>(null)

const REPLY_DELAY_MS = 900

function clockTime() {
  return new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function ChatProvider({ children }: { children: ReactNode }) {
  const [conversations, setConversations] = useState<Conversation[]>(seedConversations)
  const [pendingIn, setPendingIn] = useState<string | null>(null)
  const counter = useRef(0)

  const appendReply = useCallback((conversationId: string, prompt: string) => {
    setPendingIn(conversationId)

    window.setTimeout(() => {
      const reply = demoReply(prompt)
      const message: Message = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        time: clockTime(),
        blocks: reply.blocks,
        sources: reply.sources,
        action: reply.action,
      }

      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === conversationId
            ? { ...conversation, messages: [...conversation.messages, message] }
            : conversation,
        ),
      )
      setPendingIn(null)
    }, REPLY_DELAY_MS)
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
      appendReply(id, prompt)
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
      appendReply(conversationId, prompt)
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
