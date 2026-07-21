// Progressive decoding of a final answer while it streams. Presentation only —
// the loop still parses the complete reply — so the bar is: never leak protocol
// text, never emit a half-decoded escape, and never stream a tool call.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FinalAnswerStreamer } from '../src/engine/finalAnswerStream.js';

/** Feed a reply one character at a time — the worst case for chunk boundaries. */
function streamCharByChar(reply: string): { text: string; isFinal: boolean } {
  const s = new FinalAnswerStreamer();
  let text = '';
  for (const ch of reply) text += s.push(ch);
  return { text, isFinal: s.isFinal };
}

test('decodes a final answer progressively, in the right order', () => {
  const s = new FinalAnswerStreamer();
  assert.equal(s.push('{"final":"Hello'), 'Hello');
  assert.equal(s.push(' there'), ' there');
  assert.equal(s.push('"}'), '');
  assert.equal(s.text, 'Hello there');
  assert.equal(s.isFinal, true);
});

test('a tool call never streams a single character', () => {
  const action = '{"action":{"tool":"workspace.search","input":{"rootPath":"/w","query":"x"}}}';
  const out = streamCharByChar(action);
  assert.equal(out.text, '', 'no protocol text leaks into the chat');
  assert.equal(out.isFinal, false);
});

test('a fenced final still streams (models add ```json constantly)', () => {
  const out = streamCharByChar('```json\n{"final":"Fenced answer text."}\n```');
  assert.equal(out.text, 'Fenced answer text.');
  assert.equal(out.isFinal, true);
});

test('escapes are decoded, never emitted half-formed', () => {
  // Split precisely on the escape boundaries a real stream would break at.
  const s = new FinalAnswerStreamer();
  let out = s.push('{"final":"line one\\');
  out += s.push('nline two\\u0021 \\"quoted\\" back\\\\slash');
  assert.equal(out, 'line one\nline two! "quoted" back\\slash');
  assert.doesNotMatch(out, /\\u|\\n(?!ew)/, 'no raw escape sequence reaches the user');
});

test('a partial \\uXXXX split across chunks is held back until complete', () => {
  const s = new FinalAnswerStreamer();
  assert.equal(s.push('{"final":"A\\u00'), 'A', 'the incomplete escape is withheld');
  assert.equal(s.push('41B'), 'AB', 'and completed once its payload arrives');
});

test('character-by-character delivery decodes identically to one big chunk', () => {
  const reply = '{"final":"# Title\\n\\n- `a.ts:1` — first\\n- `b.ts:2` — second\\n\\nDone."}';
  const whole = new FinalAnswerStreamer();
  const wholeText = whole.push(reply);
  assert.equal(streamCharByChar(reply).text, wholeText);
  assert.equal(wholeText, JSON.parse(reply.slice(0, -1) + '"}'.slice(1)) ? wholeText : wholeText);
  // And it matches what a normal JSON parse would have produced.
  assert.equal(wholeText, (JSON.parse(reply) as { final: string }).final);
});

test('text after the closing quote is ignored', () => {
  const s = new FinalAnswerStreamer();
  s.push('{"final":"answer"');
  assert.equal(s.push(', "steps": 3}'), '', 'trailing protocol never renders');
  assert.equal(s.text, 'answer');
});

test('prose with no protocol at all never streams', () => {
  // Handled by the loop's prose-answer salvage instead, which runs after parsing.
  const out = streamCharByChar('I will now build the app for you, starting with index.html and app.js. '.repeat(4));
  assert.equal(out.text, '');
  assert.equal(out.isFinal, false);
});
