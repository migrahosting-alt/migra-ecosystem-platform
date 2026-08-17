import assert from 'node:assert/strict';
import test from 'node:test';
import { type GitResult, type GitRunner } from '../../commitGen/git.js';
import { buildBoundedDiff } from '../../commitGen/prepare.js';
import { type CommitMessage, sanitizeCommitMessage } from '../../commitGen/sanitize.js';

const CONV = { conventional: false, maxSubjectLength: 72 };

/**
 * What these cases actually verify is sanitization of model output. They used
 * to stream the text through a real OpenAI-compatible provider to get there;
 * the extension no longer has one — the Brain owns inference — so the text is
 * handed to the sanitizer directly. The assertions are unchanged.
 */
async function providerMessage(text: string): Promise<CommitMessage> {
  return sanitizeCommitMessage(text, CONV);
}

class FakeGit implements GitRunner {
  constructor(private readonly r: Record<string, string>) {}
  async run(args: string[]): Promise<GitResult> {
    return { stdout: this.r[args.join(' ')] ?? '', code: 0 };
  }
}

// ── provider OUTPUT cases (sanitization) ─────────────────────────────────────

test('ordinary change → clean subject + body', async () => {
  const m = await providerMessage('Add retry logic\n\nHandle transient network failures.');
  assert.equal(m.subject, 'Add retry logic');
  assert.match(m.body, /transient network failures/);
});

test('multi-component change → no invented scope in non-conventional repo', async () => {
  const m = await providerMessage('feat(parser,formatter): update both');
  assert.equal(m.subject, 'update both'); // conventional prefix stripped (repo not conventional)
});

test('malformed output (fences + control chars) is sanitized', async () => {
  const m = await providerMessage('```\nfix broken thing\n```');
  assert.equal(m.subject, 'fix broken thing');
});

test('invented issue references + fabricated trailers stripped', async () => {
  const m = await providerMessage('Add caching (#42)\n\nCloses #42\nCo-authored-by: Bot <b@x>\nreal note');
  assert.ok(!m.subject.includes('#42'));
  assert.ok(!/Closes|Co-authored-by/.test(m.body));
  assert.match(m.body, /real note/);
});

// ── diff INPUT cases (bounding / redaction / summarization) ───────────────────

test('secret-bearing diff is redacted before transmission', async () => {
  const git = new FakeGit({ 'diff --cached -- .env': 'diff\n+API_KEY=sk-ABCDEFGHIJKLMNOPQRSTUV' });
  const bounded = await buildBoundedDiff(git, [{ path: '.env', status: 'M', added: 1, removed: 0, binary: false }], true);
  const content = bounded.files[0]!.content;
  assert.ok(!content.includes('sk-ABCDEFGHIJKLMNOPQRSTUV'), 'secret redacted');
});

test('binary change is summarized, not transmitted', async () => {
  const git = new FakeGit({});
  const bounded = await buildBoundedDiff(git, [{ path: 'logo.png', status: 'A', added: 0, removed: 0, binary: true }], true);
  assert.equal(bounded.files[0]?.category, 'binary');
  assert.match(bounded.files[0]!.content, /binary file/);
});

test('oversized diff is summarized rather than sent wholesale', async () => {
  const git = new FakeGit({ 'diff --cached -- big.ts': 'x'.repeat(9000) });
  const bounded = await buildBoundedDiff(git, [{ path: 'big.ts', status: 'M', added: 9000, removed: 0, binary: false }], true, {
    maxPerFileChars: 500,
  });
  assert.equal(bounded.files[0]?.category, 'oversized');
});
