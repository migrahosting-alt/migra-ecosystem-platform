// mp-0007 — "delete it for good" has to mean it. © MigraTeck LLC.
//
// 🚨 WHAT WAS SURVIVING A DELETE. `message_feedback` and `conversation_project`
// both carry `conversation_id`, and neither has a foreign key or a cascade to
// `conversations`. The delete cleared messages, summaries and the conversation
// row, so those two were left behind permanently — the user's own up/down
// ratings on a thread they asked to be rid of, and a project binding pointing at
// a conversation that no longer exists.
//
// Neither is visible in the UI, which is exactly why nothing noticed. Orphan rows
// with no retention policy are not harmless: they are data a user asked to have
// deleted, kept because no query happened to join to it.
//
// Asserted on the STATEMENTS ISSUED rather than against a live database, because
// the property under test is "what does this delete reach", and that is decided
// by the SQL this function emits.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deleteConversation } from '../src/engine/persistence/postgres/conversationRepo.js';

/** A client that records what it was asked to run. */
function recordingClient(): { sql: string[]; client: { query: (text: string, params?: unknown[]) => Promise<{ rowCount: number }> } } {
  const sql: string[] = [];
  return {
    sql,
    client: {
      query: async (text: string) => {
        sql.push(text.replace(/\s+/g, ' ').trim());
        // Every delete reports one affected row, so the conversation delete
        // passes its own "already gone is an error" check.
        return { rowCount: 1 };
      },
    },
  };
}

const tablesCleared = (sql: readonly string[]): string[] =>
  sql
    .map((s) => /^DELETE FROM (\w+)/i.exec(s)?.[1])
    .filter((t): t is string => Boolean(t));

test('🚨 deleting a conversation clears EVERYTHING keyed to it', async () => {
  const { sql, client } = recordingClient();
  await deleteConversation(client as never, 'conv_1');
  const cleared = tablesCleared(sql);

  for (const table of [
    'conversation_messages',
    'conversation_summaries',
    'message_feedback',
    'conversation_project',
    'conversations',
  ]) {
    assert.ok(cleared.includes(table), `${table} survived the delete`);
  }
});

test('the conversation row goes LAST, so a failure cannot half-delete a thread', async () => {
  /*
   * Order is the safety property. Clearing the conversation first and then
   * failing would leave a thread the user cannot see and rows that outlive it —
   * the worst of both. Deleting the dependants first means a failure leaves the
   * conversation intact and the delete can simply be retried.
   */
  const { sql, client } = recordingClient();
  await deleteConversation(client as never, 'conv_1');
  const cleared = tablesCleared(sql);
  assert.equal(cleared[cleared.length - 1], 'conversations', 'the conversation row was not deleted last');
});

test('every delete is scoped to the conversation id, never unfiltered', async () => {
  // An unfiltered DELETE here would empty a table for every user at once.
  const { sql, client } = recordingClient();
  await deleteConversation(client as never, 'conv_1');
  for (const statement of sql.filter((s) => /^DELETE FROM/i.test(s))) {
    assert.match(statement, /WHERE (conversation_id|id) = \$1/, `unfiltered delete: ${statement}`);
  }
});
