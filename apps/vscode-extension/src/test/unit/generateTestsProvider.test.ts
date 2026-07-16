import assert from 'node:assert/strict';
import test from 'node:test';
import { OpenAiCompatProvider } from '../../providers/openAiCompatProvider.js';
import { collectCompletion } from '../../providers/providerFactory.js';
import {
  type TestProposal,
  type WorkspaceFs,
  ProposalParseError,
  applyTestProposal,
  fingerprintProposal,
  parseProposal,
  validateProposal,
} from '../../generateTests/proposal.js';
import { startMockModelProvider } from '../support/mockModelProvider.js';

const ROOT = '/ws';

class MemFs implements WorkspaceFs {
  files = new Map<string, string>();
  seed(p: string, c = '// existing test'): this {
    this.files.set(p, c);
    return this;
  }
  async exists(p: string): Promise<boolean> {
    return this.files.has(p);
  }
  async read(p: string): Promise<string> {
    const v = this.files.get(p);
    if (v === undefined) throw new Error('ENOENT');
    return v;
  }
  async write(p: string, c: string): Promise<void> {
    this.files.set(p, c);
  }
}

/** Stream JSON tokens through the real provider, then parse the completion. */
async function proposalFromProvider(json: string): Promise<TestProposal> {
  const mock = await startMockModelProvider({ tokens: splitTokens(json) });
  try {
    const provider = new OpenAiCompatProvider({
      baseUrl: () => mock.url,
      apiKey: () => 'k',
      model: () => 'm',
      timeoutMs: () => 2000,
      log: () => {},
    });
    const completion = await collectCompletion(provider, { messages: [{ role: 'user', content: 'gen' }], requestId: 'r' });
    return parseProposal(completion.content);
  } finally {
    await mock.close();
  }
}

function splitTokens(s: string): string[] {
  // chunk the payload so it arrives across multiple SSE frames
  const out: string[] = [];
  for (let i = 0; i < s.length; i += 8) out.push(s.slice(i, i + 8));
  return out.length ? out : [s];
}

test('mock-provider: new-file proposal parses + validates', async () => {
  const json = JSON.stringify({ files: [{ path: 'src/a.test.ts', contents: 'ok', mode: 'create' }] });
  const proposal = await proposalFromProvider(json);
  assert.equal(proposal.files[0]?.mode, 'create');
  const v = await validateProposal(proposal, ROOT, new MemFs());
  assert.equal(v.ok, true);
});

test('mock-provider: update to an existing test file validates', async () => {
  const json = JSON.stringify({ files: [{ path: 'src/a.test.ts', contents: 'new', mode: 'update' }] });
  const proposal = await proposalFromProvider(json);
  const v = await validateProposal(proposal, ROOT, new MemFs().seed('src/a.test.ts'));
  assert.equal(v.ok, true);
});

test('mock-provider: malformed output throws ProposalParseError', async () => {
  const mock = await startMockModelProvider({ tokens: ['sorry, ', 'I cannot ', 'do that'] });
  try {
    const provider = new OpenAiCompatProvider({
      baseUrl: () => mock.url,
      apiKey: () => 'k',
      model: () => 'm',
      timeoutMs: () => 2000,
      log: () => {},
    });
    const completion = await collectCompletion(provider, { messages: [{ role: 'user', content: 'x' }], requestId: 'r' });
    assert.throws(() => parseProposal(completion.content), (e: unknown) => e instanceof ProposalParseError);
  } finally {
    await mock.close();
  }
});

test('mock-provider: unsafe path is refused by validation', async () => {
  const json = JSON.stringify({ files: [{ path: '../../etc/evil.ts', contents: 'x', mode: 'create' }] });
  const proposal = await proposalFromProvider(json);
  const v = await validateProposal(proposal, ROOT, new MemFs());
  assert.equal(v.ok, false);
});

test('mock-provider: proposal changed after review is refused at apply', async () => {
  const json = JSON.stringify({ files: [{ path: 'src/a.test.ts', contents: 'reviewed', mode: 'create' }] });
  const reviewed = await proposalFromProvider(json);
  const reviewedFp = fingerprintProposal(reviewed);

  // A different (changed) proposal arrives at apply time.
  const changed: TestProposal = { files: [{ path: 'src/a.test.ts', contents: 'CHANGED', mode: 'create' }] };
  const res = await applyTestProposal(changed, reviewedFp, ROOT, new MemFs());
  assert.equal(res.status, 'refused');
});
