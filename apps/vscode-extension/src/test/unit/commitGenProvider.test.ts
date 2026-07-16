import assert from 'node:assert/strict';
import test from 'node:test';
import { type GitResult, type GitRunner } from '../../commitGen/git.js';
import { buildBoundedDiff } from '../../commitGen/prepare.js';
import { type CommitMessage, sanitizeCommitMessage } from '../../commitGen/sanitize.js';
import { OpenAiCompatProvider } from '../../providers/openAiCompatProvider.js';
import { collectCompletion } from '../../providers/providerFactory.js';
import { startMockModelProvider } from '../support/mockModelProvider.js';

const CONV = { conventional: false, maxSubjectLength: 72 };

async function providerMessage(text: string): Promise<CommitMessage> {
  const mock = await startMockModelProvider({ tokens: chunk(text) });
  try {
    const provider = new OpenAiCompatProvider({
      baseUrl: () => mock.url,
      apiKey: () => 'k',
      model: () => 'm',
      timeoutMs: () => 2000,
      log: () => {},
    });
    const completion = await collectCompletion(provider, { messages: [{ role: 'user', content: 'x' }], requestId: 'r' });
    return sanitizeCommitMessage(completion.content, CONV);
  } finally {
    await mock.close();
  }
}

function chunk(s: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += 6) out.push(s.slice(i, i + 6));
  return out.length ? out : [s];
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
