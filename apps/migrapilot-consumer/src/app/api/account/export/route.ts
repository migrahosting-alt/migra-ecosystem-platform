/**
 * Everything MigraPilot holds about you, as a file.
 *
 * ASSEMBLED FROM THE REAL STORES, not from a template. Conversations and their
 * messages come from the Brain, preferences from the preferences document, and
 * identity is NOT copied in — it is MigraAuth's, and an export that duplicated
 * it would be handing out a second version of the account that can drift.
 * What appears instead is a pointer saying where it lives.
 *
 * A PARTIAL EXPORT SAYS SO. If any conversation's messages cannot be read, the
 * file records that rather than omitting them silently — an export with a
 * quietly missing conversation is worse than no export, because the person
 * believes they have everything.
 */

import { getPreferences, listConversations, listMessages } from '@/server/brain/seams'
import { resolveRequestPrincipal } from '@/server/tenancy/requestPrincipal'
import type { ConversationSummary, ConversationMessage } from '@/server/brain/contracts'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  const resolved = await resolveRequestPrincipal()
  if (!resolved) {
    return Response.json({ error: 'unauthenticated', message: 'Sign in to export your data.' }, { status: 401 })
  }
  const principal = resolved.principal

  const [prefs, convs] = await Promise.all([
    getPreferences({ principal }),
    listConversations({ principal }),
  ])

  if (convs.kind !== 'ok') {
    /*
     * Refused rather than partial. An export is used precisely when someone is
     * leaving or keeping a record; handing them a file missing every
     * conversation, with a 200, is the worst possible failure here.
     */
    return Response.json(
      { error: 'export_failed', message: 'Your conversations could not be read, so no export was produced.' },
      { status: 503 },
    )
  }

  const conversations = (convs.value as { conversations?: ConversationSummary[] })?.conversations ?? []
  const incomplete: string[] = []

  const threads = await Promise.all(
    conversations.map(async (conversation) => {
      const messages = await listMessages(conversation.id, { principal })
      if (messages.kind !== 'ok') {
        incomplete.push(conversation.id)
        return { id: conversation.id, title: conversation.title ?? null, messages: null }
      }
      return {
        id: conversation.id,
        title: conversation.title ?? null,
        updatedAt: conversation.updatedAt ?? null,
        groundingFiles: conversation.groundingFiles ?? [],
        messages: ((messages.value as { messages?: ConversationMessage[] })?.messages ?? []).map((m) => ({
          role: m.role,
          content: m.content,
          createdAt: m.createdAt ?? null,
        })),
      }
    }),
  )

  const payload = {
    exportedAt: new Date().toISOString(),
    format: 'migrapilot.export.v1',
    /*
     * A POINTER, NOT A COPY. Name, email, verified state and linked providers
     * are MigraAuth's record. Duplicating them here would put a second version
     * of the account in a file that outlives every change made afterwards.
     */
    identity: {
      note: 'Account identity is held by MigraAuth and is not duplicated in this export.',
      managedAt: 'https://auth.migrateck.com/sessions',
    },
    preferences: prefs.kind === 'ok' ? prefs.value.preferences : null,
    preferencesAvailable: prefs.kind === 'ok',
    conversationCount: threads.length,
    conversations: threads,
    ...(incomplete.length > 0
      ? {
          incomplete: {
            note: 'These conversations could not be read in full. Nothing was omitted silently.',
            conversationIds: incomplete,
          },
        }
      : {}),
  }

  const stamp = new Date().toISOString().slice(0, 10)
  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="migrapilot-export-${stamp}.json"`,
      'cache-control': 'no-store',
    },
  })
}
