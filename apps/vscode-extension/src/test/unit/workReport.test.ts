// The machine-authored work report must be consistent and truthful about what
// happened after every build task (applied vs proposed vs cancelled). © MigraTeck LLC.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildWorkReport } from '../../chat/workReport.js';

test('applied build reports the files and an Applied status', () => {
  const r = buildWorkReport({
    task: 'build me an app named Bonex that plays music',
    root: '/home/me/bonex',
    proposedFiles: [{ path: 'index.html', kind: 'add' }, { path: 'app.js', kind: 'add' }],
    applied: true,
    cancelled: false,
  });
  assert.match(r, /### 📋 Summary/);
  assert.match(r, /\*\*Task:\*\* build me an app named Bonex/);
  assert.match(r, /\*\*Folder:\*\* `\/home\/me\/bonex`/);
  assert.match(r, /\*\*Files:\*\* 2 — `index\.html`.*`app\.js`/);
  assert.match(r, /Applied to the workspace/);
});

test('proposed-but-not-applied reports how to apply', () => {
  const r = buildWorkReport({ task: 't', root: '/w', proposedFiles: [{ path: 'a.js' }], applied: false, cancelled: false });
  assert.match(r, /not applied yet/i);
  assert.match(r, /click \*\*Apply\*\*|autoApplyChangeset/);
});

test('auto-apply that did not complete is reported honestly (not a false success)', () => {
  const r = buildWorkReport({ task: 't', root: '/w', proposedFiles: [{ path: 'a.js' }], applied: false, cancelled: false, autoApply: true });
  assert.match(r, /NOT applied/);
  assert.doesNotMatch(r, /Applied to the workspace/);
});

test('a run with no file changes says so, and reports Done', () => {
  const r = buildWorkReport({ task: 'run the tests', root: '/w', proposedFiles: [], applied: false, cancelled: false });
  assert.match(r, /none proposed/);
  assert.match(r, /✅ Done/);
});

test('a cancelled run reports Stopped and no changes', () => {
  const r = buildWorkReport({ task: 't', root: '/w', proposedFiles: [{ path: 'a.js' }], applied: false, cancelled: true });
  assert.match(r, /Stopped/);
  assert.match(r, /no changes were applied/);
  assert.doesNotMatch(r, /Files:/);
});

test('a long file list is truncated with a "+N more" tail', () => {
  const files = Array.from({ length: 20 }, (_, i) => ({ path: `src/f${i}.ts`, kind: 'add' }));
  const r = buildWorkReport({ task: 't', root: '/w', proposedFiles: files, applied: true, cancelled: false });
  assert.match(r, /\*\*Files:\*\* 20 —/);
  assert.match(r, /\+8 more/);
});
