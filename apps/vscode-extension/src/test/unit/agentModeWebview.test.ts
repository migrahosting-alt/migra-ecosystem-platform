import assert from 'node:assert/strict';
import test from 'node:test';

import { agentModeWebviewScript } from '../../panel/agentModeWebviewScript.js';

test('Agent Mode generated webview script is valid JavaScript', () => {
  const script = agentModeWebviewScript();

  assert.doesNotThrow(
    () => new Function(script),
    'the exact packaged webview script must compile',
  );

  assert.match(script, /lines\.join\('\\n'\)/);
  assert.match(script, /type:'enter'/);
  assert.match(script, /type:'propose'/);
  assert.match(script, /type:id/);
  assert.match(script, /History is evidence only|historyBox/);
});

test('Agent Mode webview preserves escaped newlines instead of literal quoted line breaks', () => {
  const script = agentModeWebviewScript();

  assert.equal(
    script.includes("lines.join('\\n')"),
    true,
    'generated JavaScript must contain a backslash-n escape',
  );

  assert.equal(
    /lines\.join\('\r?\n'\)/.test(script),
    false,
    'generated JavaScript must not contain a literal newline inside quotes',
  );
});
