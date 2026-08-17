import assert from 'node:assert/strict';
import test from 'node:test';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

/*
 * STRUCTURAL INVARIANT — the extension has no way to reach a model.
 *
 * This is the guard for the architecture correction, not for today's filenames.
 * The extension owns UI, VS Code commands, workspace context and presentation.
 * Inference — routing, provider selection, persona, grounding, audit — belongs
 * to the Brain, and `brainClient` is the only approved way there.
 *
 * The failure mode this prevents is cheap to reintroduce: one `fetch` to
 * `/v1/chat/completions`, or one new `providers/` module, and the extension has
 * a second brain again with no test noticing. So the assertions target the
 * shape of a direct model call rather than any particular implementation:
 *
 *   - no OpenAI-compatible chat-completions endpoint
 *   - no Ollama endpoint (port 11434, or an /api/generate|/api/chat path)
 *   - no module that presents itself as a model provider
 *
 * Scope is PRODUCTION extension source only. Test files may name these things
 * — that is how this file itself is written.
 */

/*
 * This file runs COMPILED, from dist/test/unit — so __dirname is inside dist,
 * and anchoring relatively to it would scan the build output (stale .d.ts and
 * all) rather than the source that actually ships. Walk up to the package root
 * and scan src/ deliberately.
 */
const PACKAGE_ROOT = path.resolve(__dirname, '../../..'); // dist/test/unit -> package root
const SRC = path.join(PACKAGE_ROOT, 'src');

/** Every production .ts file: src/**, excluding src/test/**. */
async function productionFiles(dir: string, acc: string[] = []): Promise<string[]> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'test') continue; // test material is exempt by design
      await productionFiles(full, acc);
    } else if (entry.name.endsWith('.ts')) {
      acc.push(full);
    }
  }
  return acc;
}

const FORBIDDEN: ReadonlyArray<{ pattern: RegExp; why: string }> = [
  {
    pattern: /\/v1\/chat\/completions/,
    why: 'OpenAI-compatible chat-completions endpoint — inference must go through the Brain',
  },
  {
    pattern: /\b11434\b/,
    why: 'Ollama default port — the extension must not address a model server',
  },
  {
    pattern: /\/api\/(generate|chat)\b(?![\w-])/,
    why: 'Ollama native inference path — inference must go through the Brain',
  },
  {
    pattern: /from '.*\/providers\/(openAiCompat|providerFactory|stubProvider|modelProvider)/,
    why: 'extension-local model provider module — deleted; do not reintroduce',
  },
  {
    pattern: /\bcollectCompletion\s*\(/,
    why: 'direct provider completion call — use brainClient.chat instead',
  },
];

test('no production extension file can reach a model directly', async () => {
  const files = await productionFiles(SRC);
  assert.ok(files.length > 50, `expected to scan the extension source, saw ${files.length} files`);

  const violations: string[] = [];
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    for (const { pattern, why } of FORBIDDEN) {
      if (pattern.test(text)) {
        violations.push(`${path.relative(SRC, file)} — ${why}`);
      }
    }
  }

  assert.deepEqual(violations, [], `direct model path reintroduced:\n  ${violations.join('\n  ')}`);
});

test('the providers/ directory does not exist in the extension', async () => {
  const entries = await readdir(SRC, { withFileTypes: true });
  const providers = entries.find((e) => e.isDirectory() && e.name === 'providers');
  assert.equal(
    providers,
    undefined,
    'src/providers/ is gone: the extension consumes intelligence, it does not implement it',
  );
});

test('brainClient remains the single approved route to the Brain', async () => {
  const files = await productionFiles(SRC);
  const transports = files.filter((f) => {
    const base = path.basename(f);
    return base === 'brainClient.ts' || base === 'brainTransport.ts' || base === 'brainLocalChatBackend.ts';
  });
  assert.ok(
    transports.length >= 2,
    'expected the brain transport modules to be present as the canonical route',
  );
});
