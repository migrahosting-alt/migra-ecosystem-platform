import assert from 'node:assert/strict';
import test from 'node:test';
import {
  type TestProposal,
  type WorkspaceFs,
  ProposalParseError,
  applyTestProposal,
  fingerprintProposal,
  parseProposal,
  validateProposal,
} from '../../generateTests/proposal.js';

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

/**
 * These cases verify proposal parsing/validation of model output. They used to
 * stream the JSON through a real provider first; the extension no longer has
 * one — the Brain owns inference — so the payload is parsed directly. The
 * assertions are unchanged.
 */
async function proposalFromProvider(json: string): Promise<TestProposal> {
  return parseProposal(json);
}

test('new-file proposal parses + validates', async () => {
  const json = JSON.stringify({ files: [{ path: 'src/a.test.ts', contents: 'ok', mode: 'create' }] });
  const proposal = await proposalFromProvider(json);
  assert.equal(proposal.files[0]?.mode, 'create');
  const v = await validateProposal(proposal, ROOT, new MemFs());
  assert.equal(v.ok, true);
});

test('update to an existing test file validates', async () => {
  const json = JSON.stringify({ files: [{ path: 'src/a.test.ts', contents: 'new', mode: 'update' }] });
  const proposal = await proposalFromProvider(json);
  const v = await validateProposal(proposal, ROOT, new MemFs().seed('src/a.test.ts'));
  assert.equal(v.ok, true);
});

test('malformed model output throws ProposalParseError', () => {
  // The Brain can return prose when the model ignores the JSON instruction.
  assert.throws(() => parseProposal('sorry, I cannot do that'), (e: unknown) => e instanceof ProposalParseError);
});

test('unsafe path is refused by validation', async () => {
  const json = JSON.stringify({ files: [{ path: '../../etc/evil.ts', contents: 'x', mode: 'create' }] });
  const proposal = await proposalFromProvider(json);
  const v = await validateProposal(proposal, ROOT, new MemFs());
  assert.equal(v.ok, false);
});

test('proposal changed after review is refused at apply', async () => {
  const json = JSON.stringify({ files: [{ path: 'src/a.test.ts', contents: 'reviewed', mode: 'create' }] });
  const reviewed = await proposalFromProvider(json);
  const reviewedFp = fingerprintProposal(reviewed);

  // A different (changed) proposal arrives at apply time.
  const changed: TestProposal = { files: [{ path: 'src/a.test.ts', contents: 'CHANGED', mode: 'create' }] };
  const res = await applyTestProposal(changed, reviewedFp, ROOT, new MemFs());
  assert.equal(res.status, 'refused');
});
