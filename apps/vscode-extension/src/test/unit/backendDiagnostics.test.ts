import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BackendDiagnostics,
  type ResolutionInfo,
  classifyRemoteProbe,
} from '../../services/backendDiagnostics.js';
import { CONSERVATIVE_CAPABILITIES, type PilotCapabilities } from '@migrapilot/pilot-client';

function clock(): () => number {
  let t = 1000;
  return () => (t += 1);
}

const LOCAL: ResolutionInfo = { mode: 'local-brain', backend: 'local', reason: 'local-mode-configured', remoteProbe: 'n/a' };
const REMOTE_READY: ResolutionInfo = {
  mode: 'remote-pilot',
  backend: 'remote',
  reason: 'remote-ready',
  remoteProbe: 'ready',
  protocolVersion: 1,
  supported: { streaming: true, approvals: true },
};

// ── recording + backend-change ───────────────────────────────────────────────

test('first record has no prior backend (changed=false, changedFrom=null)', () => {
  const d = new BackendDiagnostics(clock());
  const ev = d.record(LOCAL, { source: 'explicit', trigger: 'activation' });
  assert.equal(ev.changed, false);
  assert.equal(ev.changedFrom, null);
  assert.equal(ev.source, 'explicit');
  assert.equal(ev.trigger, 'activation');
});

test('backend change is recorded on re-resolution', () => {
  const d = new BackendDiagnostics(clock());
  d.record(LOCAL, { source: 'explicit', trigger: 'activation' });
  const ev = d.record(REMOTE_READY, { source: 'explicit', trigger: 're-resolve' });
  assert.equal(ev.changed, true);
  assert.equal(ev.changedFrom, 'local');
  assert.equal(ev.backend, 'remote');
});

test('same backend on re-resolution is not a change', () => {
  const d = new BackendDiagnostics(clock());
  d.record(LOCAL, { source: 'explicit', trigger: 'activation' });
  const ev = d.record(LOCAL, { source: 'explicit', trigger: 're-resolve' });
  assert.equal(ev.changed, false);
  assert.equal(ev.changedFrom, 'local');
});

// ── bounded history ──────────────────────────────────────────────────────────

test('history is bounded to the latest 20 events', () => {
  const d = new BackendDiagnostics(clock(), 20);
  for (let i = 0; i < 30; i++) {
    d.record(LOCAL, { source: 'explicit', trigger: 're-resolve' });
  }
  const snap = d.snapshot();
  assert.equal(snap.history.length, 20);
  assert.equal(snap.current, snap.history[snap.history.length - 1]);
});

// ── local-probe annotation ───────────────────────────────────────────────────

test('annotateLocalProbe updates only the most recent event', () => {
  const d = new BackendDiagnostics(clock());
  d.record(LOCAL, { source: 'auto', trigger: 'activation' });
  assert.equal(d.snapshot().current?.localProbe, 'unknown');
  d.annotateLocalProbe('ready');
  assert.equal(d.snapshot().current?.localProbe, 'ready');
});

// ── remote-probe classification ──────────────────────────────────────────────

test('classifyRemoteProbe maps every capability state to a coarse outcome', () => {
  const caps: PilotCapabilities = { ...CONSERVATIVE_CAPABILITIES, protocolVersion: 1 };
  assert.equal(classifyRemoteProbe({ status: 'ready', caps }), 'ready');
  assert.equal(classifyRemoteProbe({ status: 'unauthorized' }), 'unauthorized');
  assert.equal(classifyRemoteProbe({ status: 'incompatible', observedProtocolVersion: 2 }), 'incompatible');
  assert.equal(classifyRemoteProbe({ status: 'degraded', reason: 'missing', caps }), 'unavailable');
  assert.equal(classifyRemoteProbe({ status: 'degraded', reason: 'malformed', caps }), 'unavailable');
});

// ── sanitization: no secrets can appear (by construction) ────────────────────

test('rendered snapshot never contains secrets/urls/payloads', () => {
  const d = new BackendDiagnostics(clock());
  // Even if a caller fabricated a "supported" object, only booleans/enums land.
  d.record(REMOTE_READY, { source: 'explicit', trigger: 'activation' });
  d.record({ mode: 'remote-pilot', backend: 'remote-unavailable', reason: 'remote-error', remoteProbe: 'unavailable' }, {
    source: 'explicit',
    trigger: 're-resolve',
  });
  const rendered = JSON.stringify(d.snapshot());
  for (const forbidden of [
    'Bearer',
    'sk-',
    'authorization',
    'eyJ', // JWT
    'apiKey',
    'approvalToken',
    'http://',
    'https://',
    'x-request-id',
    'password',
    'secret',
  ]) {
    assert.ok(!rendered.toLowerCase().includes(forbidden.toLowerCase()), `snapshot must not contain "${forbidden}"`);
  }
  // It DOES contain the observational fields.
  assert.match(rendered, /remote-ready/);
  assert.match(rendered, /"protocolVersion":1/);
});

test('clear() empties history and resets change tracking', () => {
  const d = new BackendDiagnostics(clock());
  d.record(LOCAL, { source: 'explicit', trigger: 'activation' });
  d.clear();
  assert.deepEqual(d.snapshot().history, []);
  const ev = d.record(REMOTE_READY, { source: 'explicit', trigger: 'activation' });
  assert.equal(ev.changedFrom, null); // tracking reset
});
