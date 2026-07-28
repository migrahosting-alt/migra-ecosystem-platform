/**
 * Four representative MigraPilot tasks with objective pass criteria.
 *
 * Every prompt, context block, temperature and token limit is FIXED and shared by both
 * models. The only variable is the model id — otherwise the comparison measures prompt
 * luck rather than model capability.
 *
 * `expect` records what a correct answer must contain, so scoring is checked against a
 * written-down criterion rather than an impression formed after reading the output.
 */

export const GEN = Object.freeze({
  temperature: 0,      // deterministic as the provider allows
  max_tokens: 1200,    // generous enough that truncation never confounds quality
  top_p: 1,
  seed: 7,
});

const SYSTEM =
  'You are a senior software engineer working inside a governed VS Code extension. ' +
  'Be precise and concise. Never invent APIs, files, or symbols that are not shown to you. ' +
  'If something is not in the provided material, say so explicitly.';

// ── 1. Repository diagnosis ──────────────────────────────────────────────────
// A real defect shape from this repo's history: a cache that returns `undefined` for a
// hole because results are collected by index into a sparse array.
const DIAGNOSIS = `A test is failing. Here is the test and the implementation.

FAILING TEST (embedder.test.ts):
  test('a partial cache hit returns a vector for every input', async () => {
    const cache = new Map([['b', [0.2, 0.2]]]);
    const embedder = new CachedEmbedder(cache, fakeProvider);   // provider returns [[0.1,0.1]] for ['a']
    const out = await embedder.embed(['a', 'b']);
    assert.equal(out.length, 2);
    assert.ok(out.every((v) => Array.isArray(v)));   // <-- FAILS: out[1] is undefined
  });

IMPLEMENTATION (embedder.ts):
  export class CachedEmbedder {
    constructor(private cache: Map<string, number[]>, private provider: Provider) {}

    async embed(inputs: string[]): Promise<number[][]> {
      const misses: string[] = [];
      const out: number[][] = [];
      inputs.forEach((text, i) => {
        const hit = this.cache.get(text);
        if (hit) out[i] = hit;
        else misses.push(text);
      });
      const fresh = await this.provider.embed(misses);
      misses.forEach((text, i) => {
        this.cache.set(text, fresh[i]);
        out.push(fresh[i]);
      });
      return out;
    }
  }

Identify the root cause, name the affected symbol and file, and propose the minimal fix.`;

// ── 2. Safe patch planning ───────────────────────────────────────────────────
const PLANNING = `Requested change: add an optional \`maxRetries\` setting to the live-knowledge fetch layer so a transient 503 can be retried once.

PROTECTED SURFACES — must not be modified:
  apps/brain-service/src/engine/grounding/**        (repository grounding)
  packages/protocol/src/grounding.ts
  apps/vscode-extension/**                          (no UI in this slice)

INVARIANTS that must survive:
  - repository relevance floor stays 0.53
  - provider idle timeout stays 120000 ms
  - live knowledge defaults to off and performs zero I/O when off
  - a retry must not bypass the per-turn document budget or the SSRF address checks
  - redirects are still revalidated per hop

RELEVANT EXISTING FILES:
  apps/brain-service/src/engine/liveKnowledge/liveFetch.ts        (guardedRequest, fetchLiveDocument)
  apps/brain-service/src/engine/liveKnowledge/liveResearch.ts     (researchLive, per-turn budgets)
  apps/brain-service/src/engine/liveKnowledge/liveKnowledgeDecision.ts  (LiveResearchBudget)
  apps/brain-service/test/liveFetchSecurity.test.ts

Produce a bounded file-by-file plan. List exactly which files you would change and why. Do not widen scope.`;

// ── 3. TypeScript implementation ─────────────────────────────────────────────
const IMPLEMENTATION = `Implement this function so all tests pass. TypeScript, strict mode. No \`any\`. Do not refactor anything else.

CONTRACT:
  /**
   * Parse a Retry-After header value into milliseconds.
   * Accepts either delay-seconds ("120") or an HTTP-date ("Wed, 21 Oct 2026 07:28:00 GMT").
   * Returns undefined when the value is absent, malformed, or resolves to a past instant.
   * Never returns a negative number. Caps the result at maxMs.
   */
  export function parseRetryAfter(value: string | null | undefined, now: Date, maxMs: number): number | undefined

TESTS THAT MUST PASS:
  const NOW = new Date('2026-10-21T07:00:00.000Z');
  parseRetryAfter('120', NOW, 600_000)                                  === 120_000
  parseRetryAfter('0', NOW, 600_000)                                    === 0
  parseRetryAfter('Wed, 21 Oct 2026 07:28:00 GMT', NOW, 600_000)        === 600_000     // 28 min > cap
  parseRetryAfter('Wed, 21 Oct 2026 06:00:00 GMT', NOW, 600_000)        === undefined   // past
  parseRetryAfter('not-a-number', NOW, 600_000)                         === undefined
  parseRetryAfter('-5', NOW, 600_000)                                   === undefined
  parseRetryAfter(null, NOW, 600_000)                                   === undefined
  parseRetryAfter('', NOW, 600_000)                                     === undefined
  parseRetryAfter('99999999', NOW, 600_000)                             === 600_000     // capped

Return only the function implementation.`;

// ── 4. Code review ──────────────────────────────────────────────────────────
// Exactly three planted defects: one correctness, one security, one misleading diagnostic.
const REVIEW = `Review this diff. Report every real defect, rank by severity, and do not report defects that are not present.

--- a/src/engine/liveKnowledge/fetchRetry.ts
+++ b/src/engine/liveKnowledge/fetchRetry.ts
@@
+export async function fetchWithRetry(
+  url: string,
+  deps: { resolve(h: string): Promise<Address[]>; fetchImpl: typeof fetch },
+  attempts = 3,
+): Promise<Response> {
+  let lastError: unknown;
+  for (let i = 0; i < attempts; i += 1) {
+    try {
+      // Validate the URL once up front; retries reuse the validated URL.
+      if (i === 0 && !(await addressesAreSafe(url, deps.resolve))) {
+        throw new Error('unsafe address');
+      }
+      const res = await deps.fetchImpl(url, { redirect: 'follow' });
+      if (res.status === 503 && i < attempts - 1) continue;
+      return res;
+    } catch (err) {
+      lastError = err;
+    }
+  }
+  throw new Error(\`fetch failed after \${attempts} attempts (connect timeout)\`);
+}

Report each defect with: severity, what is wrong, and why it matters.`;

export const TASKS = Object.freeze([
  {
    id: 'diagnosis',
    name: 'Repository diagnosis',
    prompt: DIAGNOSIS,
    expect: {
      correctness: [
        'the miss vectors are pushed onto `out` instead of written at the original input index',
        'so a cached hit at a later index leaves a hole / the array is misaligned',
      ],
      names: ['CachedEmbedder', 'embed', 'embedder.ts'],
      fix: 'write fresh[i] to the miss position (track indices) rather than out.push',
      forbidden: 'inventing APIs or files not shown',
    },
  },
  {
    id: 'planning',
    name: 'Safe patch planning',
    prompt: PLANNING,
    expect: {
      correctness: ['changes confined to liveFetch.ts / liveResearch.ts / the budget type / its test'],
      invariants: ['0.53 untouched', '120000 untouched', 'off stays zero-I/O', 'retry inside the budget', 'per-hop revalidation kept'],
      forbidden: 'touching grounding, protocol/grounding.ts, or the extension',
    },
  },
  {
    id: 'implementation',
    name: 'TypeScript implementation',
    prompt: IMPLEMENTATION,
    expect: {
      correctness: ['seconds path', 'HTTP-date path', 'past date -> undefined', 'negative -> undefined', 'cap at maxMs', 'null/empty -> undefined'],
      forbidden: 'any, unrelated refactor',
    },
  },
  {
    id: 'review',
    name: 'Code review',
    prompt: REVIEW,
    expect: {
      planted: [
        'SECURITY: addresses are validated only when i === 0, so a retry re-uses a stale verdict (DNS rebinding); and `redirect: \'follow\'` hands redirects to the platform, bypassing per-hop revalidation — a 302 into a private network is never re-checked',
        'CORRECTNESS: `lastError` is assigned and never surfaced, so the real cause is discarded; worse, the unsafe-address throw is caught by the same catch and silently RETRIED instead of failing closed',
        'DIAGNOSTIC: the final message hardcodes "(connect timeout)" for every failure mode, mislabelling the cause',
      ],
      forbidden: 'fabricated defects',
    },
  },
]);

export const SYSTEM_PROMPT = SYSTEM;
