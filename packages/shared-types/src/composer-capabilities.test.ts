import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  canSubmitComposer,
  visibleComposerActions,
  type ComposerCapability,
  type ComposerCapabilitySnapshot,
} from './composer-capabilities.ts';

const snapshot = (capabilities: ComposerCapability[]): ComposerCapabilitySnapshot => ({
  version: 1,
  generatedAt: '2026-08-22T00:00:00.000Z',
  capabilities,
});

test('a ready capability is shown', () => {
  const shown = visibleComposerActions(
    snapshot([{ id: 'chat', availability: 'ready', authenticatedOnly: false }]),
  );
  assert.deepEqual(shown.map((c) => c.id), ['chat']);
});

test('an unavailable capability WITH a reason is shown, so the user learns why', () => {
  // Hiding it would leave the user unable to tell "we do not have this" from
  // "this is temporarily off", which are different facts they can act on
  // differently.
  const shown = visibleComposerActions(
    snapshot([
      { id: 'vision.camera', availability: 'unavailable', reason: 'No camera capability is configured yet.', authenticatedOnly: true },
    ]),
  );
  assert.deepEqual(shown.map((c) => c.id), ['vision.camera']);
});

test('an unavailable capability with NO reason is omitted entirely', () => {
  // This is how the snapshot says "this product does not have this at all".
  // Rendering it would be a decorative card for something that does not exist.
  const shown = visibleComposerActions(
    snapshot([{ id: 'video.generate', availability: 'unavailable', authenticatedOnly: true }]),
  );
  assert.deepEqual(shown, []);
});

test('requires_auth, requires_connection and quota_exhausted are all shown', () => {
  // None of these mean "absent". They mean "you cannot use it right now", which
  // the user resolves by signing in, connecting, or waiting.
  const shown = visibleComposerActions(
    snapshot([
      { id: 'gmail', availability: 'requires_connection', reason: 'Connect Gmail to use this.', authenticatedOnly: true },
      { id: 'files.library', availability: 'requires_auth', reason: 'Sign in to use your library.', authenticatedOnly: true },
      { id: 'chat', availability: 'quota_exhausted', reason: 'You have used your free messages.', authenticatedOnly: false },
    ]),
  );
  assert.deepEqual(shown.map((c) => c.id).sort(), ['chat', 'files.library', 'gmail']);
});

test('the hub is a projection — an empty snapshot yields an empty hub', () => {
  // There is no hardcoded fallback menu. If the Brain reports nothing, the
  // composer offers nothing, rather than inventing a list of ten things.
  assert.deepEqual(visibleComposerActions(snapshot([])), []);
});

/* ── canSubmitComposer ───────────────────────────────────────────────────── */

test('text alone can be submitted when idle', () => {
  assert.equal(canSubmitComposer({ state: { kind: 'idle' }, text: 'bonjou', readyAssets: 0 }), true);
});

test('a READY asset alone can be submitted with no text', () => {
  assert.equal(canSubmitComposer({ state: { kind: 'idle' }, text: '   ', readyAssets: 1 }), true);
});

test('whitespace-only text with no assets cannot be submitted', () => {
  assert.equal(canSubmitComposer({ state: { kind: 'idle' }, text: '   \n\t ', readyAssets: 0 }), false);
});

test('nothing can be submitted while not idle', () => {
  // Every non-idle state, so a new state added later fails loudly here rather
  // than silently permitting a second send mid-stream.
  const busy = [
    { kind: 'uploading', count: 1 },
    { kind: 'recording', startedAt: 0 },
    { kind: 'transcribing' },
    { kind: 'sending' },
    { kind: 'streaming' },
    { kind: 'blocked', reason: 'anonymous_quota', message: 'x' },
  ] as const;

  for (const state of busy) {
    assert.equal(
      canSubmitComposer({ state, text: 'hello', readyAssets: 2 }),
      false,
      `${state.kind} must not accept a submit`,
    );
  }
});
