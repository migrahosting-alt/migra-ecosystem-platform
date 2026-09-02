// Cold starts are PROGRESS, never an answer.
//
// The defect this pins, from a real screenshot: a user attached a mockup and
// asked "can you help me build this page". MigraPilot replied with "Loading the
// language model — the first answer after a pause takes longer to start.",
// persisted with a timestamp and a Listen button, and ran a SECOND typing
// indicator underneath it. Infrastructure state became the answer, there were
// two progress surfaces, and the requested work never visibly began.

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const src = (rel: string): string => readFileSync(join(process.cwd(), 'src', ...rel.split('/')), 'utf8')

const provider = src('state/ChatProvider.tsx')
const chatPage = src('screens/ChatPage.tsx')
const message = src('components/chat/Message.tsx')

test('a stage detail NEVER becomes message content', () => {
  // The exact regression: paint(detail) wrote runtime state into the bubble.
  assert.doesNotMatch(provider, /paint\(detail\)/, 'a stage detail is being painted as the answer')
  const stageBlock = provider.slice(provider.indexOf("frame.event === 'stage'"), provider.indexOf("frame.event === 'image'"))
  assert.match(stageBlock, /setProgressIn\(/, 'a stage must set transient progress')
  assert.doesNotMatch(stageBlock, /\bpaint\(/, 'a stage must not paint into the message')
})

test('progress is cleared the moment generation begins', () => {
  const tokenBlock = provider.slice(provider.indexOf("frame.event === 'token'"))
  assert.match(tokenBlock.slice(0, 600), /setProgressIn\(null\)/, 'the first token must clear the progress line')
})

test('progress is cleared when the turn ends, so nothing survives it', () => {
  const clears = (provider.match(/setProgressIn\(null\)/g) ?? []).length
  const pendings = (provider.match(/setPendingIn\(null\)/g) ?? []).length
  assert.ok(clears >= pendings, 'every path that ends the turn must also clear progress')
})

test('there is EXACTLY ONE progress surface — the indicator, carrying the detail', () => {
  assert.match(chatPage, /pending && \(\s*<TypingIndicator/, 'the indicator is the single surface')
  assert.match(chatPage, /progressIn\?\.conversationId === id/, 'detail is scoped to this conversation')
  // And it must not be possible to render a loading MESSAGE alongside it.
  assert.doesNotMatch(chatPage, /<MessageView[^>]*loading/i)
})

test('the indicator accepts a transient detail rather than requiring a message', () => {
  assert.match(message, /export function TypingIndicator\(\{ detail \}/)
})

test('the detail is scoped per conversation, so another turn cannot leak into this one', () => {
  assert.match(provider, /progressIn.*\{ conversationId: string; detail: string \} \| null/s)
})
