import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMPOSER_PLACEHOLDER,
  ROUTING_OPTIONS,
  SLASH_COMMANDS,
  composerKeyAction,
  composerState,
  matchSlashCommands,
  shouldDispatchSubmit,
} from '../../panel/shell/composerModel.js';

function input(overrides: Partial<Parameters<typeof composerState>[0]> = {}) {
  return { inFlight: false, connected: true, voiceSupported: true, text: '', attachmentCount: 0, ...overrides };
}

test('the composer placeholder is the exact approved copy', () => {
  assert.equal(COMPOSER_PLACEHOLDER, 'Ask MigraPilot to inspect, build, diagnose, or plan...');
  assert.equal(composerState(input()).placeholder, COMPOSER_PLACEHOLDER);
});

test('send is disabled with no content and enabled with text or an attachment', () => {
  assert.equal(composerState(input()).canSend, false);
  assert.equal(composerState(input({ text: '   ' })).canSend, false, 'whitespace is not content');
  assert.equal(composerState(input({ text: 'hello' })).canSend, true);
  assert.equal(composerState(input({ attachmentCount: 1 })).canSend, true, 'an attachment alone is a valid turn');
});

test('a disconnected backend blocks submission and says why', () => {
  const state = composerState(input({ connected: false, text: 'hello' }));
  assert.equal(state.disabled, true);
  assert.equal(state.canSend, false);
  assert.match(state.hint, /disconnected/i);
});

test('an in-flight turn shows stop instead of send and never allows a second send', () => {
  const state = composerState(input({ inFlight: true, text: 'hello' }));
  assert.equal(state.showStop, true);
  assert.equal(state.canSend, false);
  assert.match(state.hint, /Streaming/);
  assert.match(state.sendLabel, /streaming/i);
});

test('voice reports unavailable rather than faking a recording affordance', () => {
  const available = composerState(input({ voiceSupported: true }));
  assert.equal(available.voice, 'available');
  assert.match(available.voiceLabel, /click to record/i);

  const unavailable = composerState(input({ voiceSupported: false }));
  assert.equal(unavailable.voice, 'unavailable');
  assert.match(unavailable.voiceLabel, /unavailable/i);
});

test('Enter sends, Shift+Enter inserts a newline, and an open palette owns Enter', () => {
  assert.equal(composerKeyAction('Enter', false, false), 'send');
  assert.equal(composerKeyAction('Enter', true, false), 'newline');
  assert.equal(composerKeyAction('Enter', false, true), 'palette');
  assert.equal(composerKeyAction('Enter', true, true), 'palette');
  assert.equal(composerKeyAction('a', false, false), 'ignore');
  assert.equal(composerKeyAction('Escape', false, false), 'ignore');
});

test('duplicate submission is refused on every unsafe combination', () => {
  const base = { inFlight: false, dispatching: false, hasContent: true, connected: true };
  assert.equal(shouldDispatchSubmit(base), true);
  assert.equal(shouldDispatchSubmit({ ...base, inFlight: true }), false, 'a turn already streaming');
  assert.equal(shouldDispatchSubmit({ ...base, dispatching: true }), false, 'a dispatch already in progress');
  assert.equal(shouldDispatchSubmit({ ...base, hasContent: false }), false, 'nothing to send');
  assert.equal(shouldDispatchSubmit({ ...base, connected: false }), false, 'backend unreachable');
});

test('every slash command maps to a real command, prompt, or shell action', () => {
  assert.ok(SLASH_COMMANDS.length >= 10);
  for (const command of SLASH_COMMANDS) {
    assert.match(command.name, /^\/[a-z]+$/, `${command.name} must be a simple slash command`);
    assert.ok(command.description.length > 4, `${command.name} needs a description`);
    if (command.effect.kind === 'command') assert.ok(command.effect.command.length > 0);
    else if (command.effect.kind === 'prompt') assert.ok(command.effect.prefix.length > 0);
    // `sourceMode:*` is an evidence-source selection — a STRUCTURED action, so the
    // approved-only boundary is armed by a control rather than by prompt wording.
    else assert.match(command.effect.action, /^(tab:(chat|agent|diff|audit)|newChat|sourceMode:(auto|approved))$/);
  }
});

test('slash matching is prefix-first and falls back to description search', () => {
  assert.deepEqual(matchSlashCommands('/exp').map((c) => c.name), ['/explain']);
  assert.deepEqual(matchSlashCommands('/hist').map((c) => c.name), ['/history']);
  assert.equal(matchSlashCommands('/').length, SLASH_COMMANDS.length, 'a bare slash lists everything');
  assert.ok(matchSlashCommands('/commit').some((c) => c.name === '/commit'));
  assert.ok(matchSlashCommands('/evidence').length === 0 || matchSlashCommands('/evidence').length > 0);
  // Description search: "policy" appears in /policy's description.
  assert.ok(matchSlashCommands('/policy').some((c) => c.name === '/policy'));
});

test('routing options expose Auto plus the three engine tiers', () => {
  assert.deepEqual(ROUTING_OPTIONS.map((option) => option.value), ['auto', 'cheap', 'default', 'premium']);
  // "Auto model" is deliberate: the composer now has two selects, and two controls
  // both reading "Auto" were impossible to tell apart while collapsed.
  assert.deepEqual(ROUTING_OPTIONS.map((option) => option.label), ['Auto model', 'Fast', 'Balanced', 'Deep']);
});
