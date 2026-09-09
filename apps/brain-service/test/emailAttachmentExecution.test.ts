/**
 * ATTACHMENTS — fetched through the caller's own connection, judged by the
 * bytes that actually arrived.
 *
 * The bridge itself is tested separately and parses nothing. What is under test
 * here is the path INTO it: whose provider the bytes came from, and what is
 * checked before and after they arrive.
 */

import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import { resolveFilePolicy, type FilePipelineConfig } from '@migrapilot/shared-types/file-policy';

import {
  bindEmailExecution,
  executeEmailFetchAttachment,
  executeEmailListAttachments,
} from '../src/engine/email/emailExecution.js';
import { __resetInFlightForTest } from '../src/engine/email/tokenRefresh.js';
import type { MailConnectionRecord, MailConnectionStore } from '../src/engine/email/connectionStore.js';
import type { EmailAttachmentEvidence } from '../src/engine/email/evidence.js';
import type { AttachmentPolicy } from '../src/engine/email/attachmentBridge.js';
import { MAIL_TOKEN_KEY_ENV, seal, sealKeyFrom, type SealKey } from '../src/engine/email/tokenSealing.js';
import { GOOGLE_SCOPES } from '../src/engine/email/oauthConfig.js';
import type { ToolHandlerContext } from '../src/engine/models/capabilityRegistry.js';

const keyResult = sealKeyFrom({ [MAIL_TOKEN_KEY_ENV]: Buffer.alloc(32, 7).toString('base64') });
assert.equal(keyResult.ok, true);
const key = (keyResult as { ok: true; key: SealKey }).key;

const NOW = 1_000_000;
const ALICE = { owner: 'user:alice', workspace: 'ws:1' };
const BOB = { owner: 'user:bob', workspace: 'ws:1' };

/*
 * 🚨 THE REAL RESOLVER, NOT A HAND-WRITTEN POLICY.
 *
 * The policy is no longer an input to the fetch — it is derived from the
 * binding's deployment configuration by the canonical shared implementation,
 * so a test that invented its own object would be asserting against something
 * the product never uses. These tests drive the configuration instead, which
 * is the only thing a deployment actually owns.
 */
const PIPELINE: FilePipelineConfig = { maxFileMb: 1 };
const POLICY: AttachmentPolicy = resolveFilePolicy({
  config: PIPELINE,
  principal: { principalId: 'test-owner', workspaceId: 'test-workspace' },
});

function record(scope: typeof ALICE, accountId: string, over: Partial<MailConnectionRecord> = {}): MailConnectionRecord {
  const b = (purpose: 'access_token' | 'refresh_token') => ({
    ownerScope: scope.owner, workspaceScope: scope.workspace,
    provider: 'gmail', providerAccountId: accountId, purpose,
  } as const);
  return {
    ownerScope: scope.owner,
    workspaceScope: scope.workspace,
    provider: 'gmail',
    providerAccountId: accountId,
    accountAddress: `${accountId}@example.com`,
    sealedAccessToken: seal(key, b('access_token'), `access-${accountId}`),
    sealedRefreshToken: seal(key, b('refresh_token'), `refresh-${accountId}`),
    accessTokenExpiresAt: NOW + 3_600_000,
    grantedScopes: [GOOGLE_SCOPES.read],
    authorizationRevokedAt: null,
    connectedAt: 1_000,
    lastRefreshAt: null,
    updatedAt: 1_000,
    ...over,
  };
}

const evidence = (over: Partial<EmailAttachmentEvidence> = {}): EmailAttachmentEvidence => ({
  id: 'att-ev-1',
  ref: 'ref-att-1',
  messageId: 'msg-ev-1',
  providerMessageId: 'pm-1',
  providerThreadId: 'pt-1',
  providerAttachmentId: 'pa-1',
  filename: 'invoice.pdf',
  mimeType: 'application/pdf',
  ...over,
});

function bind(records: MailConnectionRecord[]) {
  const lookups: string[] = [];
  const store: MailConnectionStore = {
    list: async (scope, provider) => {
      lookups.push(`list:${scope.owner}`);
      return records.filter((r) => r.ownerScope === scope.owner && r.provider === provider);
    },
    get: async (scope, provider, id) => {
      lookups.push(`get:${scope.owner}`);
      return records.find((r) => r.ownerScope === scope.owner && r.provider === provider && r.providerAccountId === id) ?? null;
    },
    put: async () => {},
    recordRefresh: async () => {},
    markAuthorizationRevoked: async () => {},
    disconnect: async () => true,
  };
  bindEmailExecution({
    connections: store,
    key,
    refresh: async () => ({ kind: 'refreshed', accessToken: 'fresh', expiresAt: NOW + 3_600_000 }),
    now: () => NOW,
    filePipeline: PIPELINE,
  });
  return { lookups };
}

const ctxFor = (scope: typeof ALICE): ToolHandlerContext => ({ principal: scope });

afterEach(() => {
  bindEmailExecution(null);
  __resetInFlightForTest();
});

/* ------------------------------------------------------------------ *
 * 🚨 Whose attachment
 * ------------------------------------------------------------------ */

test('🚨 an attachment fetch resolves the CALLER’s connection, and nothing else', async () => {
  const { lookups } = bind([record(ALICE, 'alice-1'), record(BOB, 'bob-1')]);
  await executeEmailFetchAttachment({ evidence: evidence(), ctx: ctxFor(BOB) });
  assert.ok(lookups.length > 0, 'no connection was resolved for the fetch');
  for (const lookup of lookups) {
    assert.ok(lookup.endsWith(BOB.owner), `an attachment fetch crossed a boundary: ${lookup}`);
  }
});

test('🚨 with NO principal, no bytes are fetched', async () => {
  /*
   * An attachment id alone must not reach a mailbox. The boundary is the
   * connection, and without a principal there is no connection to resolve.
   */
  const { lookups } = bind([record(ALICE, 'alice-1')]);
  const result = await executeEmailFetchAttachment({ evidence: evidence(), ctx: undefined });
  assert.equal(result.ok, false);
  if (!result.ok && 'failure' in result) assert.equal(result.failure.kind, 'refused');
  assert.equal(lookups.length, 0, 'a fetch was attempted with no principal');
});

test('a caller with no connection gets no bytes, not someone else’s', async () => {
  bind([record(ALICE, 'alice-1')]);
  const result = await executeEmailFetchAttachment({ evidence: evidence(), ctx: ctxFor(BOB) });
  assert.equal(result.ok, false);
  if (!result.ok && 'failure' in result) assert.equal(result.failure.kind, 'not_connected');
});

test('listing attachments requires the same principal and read scope', async () => {
  bind([record(ALICE, 'alice-1', { grantedScopes: [GOOGLE_SCOPES.send] })]);
  const result = await executeEmailListAttachments('pm-1', ctxFor(ALICE));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failure.kind, 'insufficient_scope');

  __resetInFlightForTest();
  const noPrincipal = await executeEmailListAttachments('pm-1', undefined);
  assert.equal(noPrincipal.ok, false);
  if (!noPrincipal.ok) assert.equal(noPrincipal.failure.kind, 'refused');
});

/* ------------------------------------------------------------------ *
 * 🚨 What is checked, and when
 * ------------------------------------------------------------------ */

test('🚨 a DECLARED oversize is refused before the bytes are downloaded', async () => {
  /*
   * Downloading 200MB to then refuse it spends the user's time and our memory
   * reaching a conclusion the listing already supported.
   */
  bind([record(ALICE, 'alice-1')]);
  const result = await executeEmailFetchAttachment({
    evidence: evidence({ sizeBytes: POLICY.maxBytes + 1 }),
    ctx: ctxFor(ALICE),
  });
  assert.equal(result.ok, false);
  if (!result.ok && 'refusal' in result) {
    assert.equal(result.refusal.kind, 'too_large');
    if (result.refusal.kind === 'too_large') {
      assert.equal(result.refusal.limitBytes, POLICY.maxBytes);
      assert.equal(result.refusal.actualBytes, POLICY.maxBytes + 1);
    }
  } else {
    assert.fail('an oversized attachment was not refused as too_large');
  }
});

test('🚨 a refusal is a DIFFERENT outcome from a provider failure', async () => {
  /*
   * "We will not take this file" and "we could not reach your mail" call for
   * different words and different remedies. Collapsing them would tell someone
   * to try again later about a PDF that will never be accepted.
   */
  bind([record(ALICE, 'alice-1')]);
  const refused = await executeEmailFetchAttachment({
    evidence: evidence({ sizeBytes: POLICY.maxBytes + 1 }),
    ctx: ctxFor(ALICE),
  });
  const unreachable = await executeEmailFetchAttachment({
    evidence: evidence(), ctx: ctxFor(BOB),
  });
  assert.ok(!refused.ok && 'refusal' in refused);
  assert.ok(!unreachable.ok && 'failure' in unreachable);
});

test('🚨 no failure or refusal carries a credential', async () => {
  bind([record(ALICE, 'alice-1')]);
  const result = await executeEmailFetchAttachment({
    evidence: evidence({ sizeBytes: POLICY.maxBytes + 1 }),
    ctx: ctxFor(ALICE),
  });
  const serialised = JSON.stringify(result);
  assert.ok(!/refresh-alice|access-alice/.test(serialised), 'a credential reached an attachment outcome');
});

/* ------------------------------------------------------------------ *
 * 🚨 The download wins over the listing
 * ------------------------------------------------------------------ */

test('🚨 the file is judged by the BYTES THAT ARRIVED, not by the listing', async () => {
  /*
   * 🚨 THIS IS TESTED THROUGH AN EXTRACTED FUNCTION, DELIBERATELY.
   *
   * The Gmail adapter has no HTTP seam yet, so nothing downstream of a
   * successful provider read is reachable from a test — a mutation that made
   * the bridge judge the LISTED name instead of the downloaded one passed the
   * whole file. Extracting the decision is the difference between a claim in a
   * comment and an assertion.
   *
   * Why it matters: a listing is metadata from the sender's side of the world.
   * A message can advertise `notes.txt` and deliver `payload.exe`.
   */
  const { bridgeDownloadedAttachment } = await import('../src/engine/email/emailExecution.js');

  const result = bridgeDownloadedAttachment({
    evidence: evidence({ filename: 'notes.txt', mimeType: 'text/plain' }),
    downloaded: { filename: 'payload.exe', mimeType: 'application/octet-stream', bytes: new Uint8Array([1, 2, 3]) },
    policy: POLICY,
  });

  assert.equal(result.ok, false, 'a file the listing mislabelled was accepted on the listing’s word');
  if (!result.ok) assert.equal(result.refusal.kind, 'unsupported_type');
});

test('🚨 an UNDER-REPORTED size is caught after download', async () => {
  // The pre-check trusts a number the provider supplied. This is the one that
  // applies the limit to the file itself.
  const { bridgeDownloadedAttachment } = await import('../src/engine/email/emailExecution.js');

  const result = bridgeDownloadedAttachment({
    evidence: evidence({ sizeBytes: 10 }),
    downloaded: {
      filename: 'invoice.pdf',
      mimeType: 'application/pdf',
      bytes: new Uint8Array(POLICY.maxBytes + 1),
    },
    policy: POLICY,
  });

  assert.equal(result.ok, false, 'a file that lied about its size slipped past the limit');
  if (!result.ok) assert.equal(result.refusal.kind, 'too_large');
});

test('a well-formed attachment becomes a canonical handoff with its provenance', async () => {
  const { bridgeDownloadedAttachment } = await import('../src/engine/email/emailExecution.js');

  const result = bridgeDownloadedAttachment({
    evidence: evidence(),
    downloaded: { filename: 'invoice.pdf', mimeType: 'application/pdf', bytes: new Uint8Array([37, 80]) },
    policy: POLICY,
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    // Provenance survives, or a citation can only say "a file" and the user
    // cannot tell which email it came from.
    assert.equal(result.handoff.provenance.source, 'email');
    assert.equal(result.handoff.provenance.providerMessageId, 'pm-1');
    assert.equal(result.handoff.provenance.providerThreadId, 'pt-1');
  }
});
