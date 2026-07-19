// Agentic answer loop — pure/deterministic parts (no model needed). Proves the
// read-only tool surface executes correctly, the native-chat URL is derived
// right, and the JSON-in-content tool-call fallback is safe (never treats a prose
// answer as a tool call). © MigraTeck LLC.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { executeTool, tryParseContentToolCall, nativeChatUrlFrom } from '../src/engine/agenticAnswer.js';

function tmpWorkspace(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'migra-agentic-')));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'auth.ts'), ['export function login() {', '  return verifyToken();', '}', ''].join('\n'));
  return dir;
}

test('nativeChatUrlFrom converts an OpenAI-compat /v1 base into Ollama native /api/chat', () => {
  assert.equal(nativeChatUrlFrom('http://127.0.0.1:11434/v1'), 'http://127.0.0.1:11434/api/chat');
  assert.equal(nativeChatUrlFrom('http://host:1234/v1/'), 'http://host:1234/api/chat');
});

test('executeTool: search runs read-only against the real workspace', async () => {
  const dir = tmpWorkspace();
  const r = await executeTool('search', { query: 'verifyToken' }, dir);
  assert.ok(r.ok, 'search succeeds');
  assert.match(r.feedback, /auth\.ts/, 'feedback contains the matching file');
  assert.match(r.summary, /1 hit|hit\(s\)/);
});

test('executeTool: read returns file lines; find locates by name', async () => {
  const dir = tmpWorkspace();
  const read = await executeTool('read', { path: 'src/auth.ts', startLine: 1, endLine: 3 }, dir);
  assert.ok(read.ok);
  assert.match(read.feedback, /login/);

  const find = await executeTool('find', { query: 'auth.ts', kind: 'file' }, dir);
  assert.ok(find.ok);
  assert.match(find.feedback, /auth\.ts/);
});

test('executeTool: a bad path is a typed read-only failure, never a throw', async () => {
  const dir = tmpWorkspace();
  const r = await executeTool('read', { path: '../../etc/passwd' }, dir);
  assert.equal(r.ok, false, 'escape attempt fails');
  assert.match(r.feedback, /Error:/);
});

test('executeTool: unknown tool is rejected, not executed', async () => {
  const dir = tmpWorkspace();
  const r = await executeTool('rm_rf', { path: '/' }, dir);
  assert.equal(r.ok, false);
  assert.match(r.feedback, /no such tool/i);
});

test('tryParseContentToolCall parses a JSON tool call but rejects prose', () => {
  const call = tryParseContentToolCall('{"name":"search","arguments":{"query":"login"}}');
  assert.deepEqual(call, { name: 'search', args: { query: 'login' } });

  assert.equal(tryParseContentToolCall('The login function verifies a token.'), null, 'prose is not a tool call');
  assert.equal(tryParseContentToolCall('{"name":"not_a_tool","arguments":{}}'), null, 'unknown tool name rejected');
});
