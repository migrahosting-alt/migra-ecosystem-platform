/**
 * Conversation-quality runner.
 *
 *   node --import tsx run.ts --target brain
 *   node --import tsx run.ts --target ollama --model qwen3:14b
 *   node --import tsx run.ts --target brain --only haitian_creole
 *
 * Targets are interchangeable on purpose: a promotion decision needs a CANDIDATE
 * measured the same way as the incumbent. `brain` measures what users actually
 * get, end to end; `ollama` measures a raw model, which is what a Migra Engineer
 * candidate is before it has earned a route.
 *
 * Exit code is 1 when any case FAILS. Cases needing human review do not fail the
 * run — they are printed and counted, because a machine pretending to judge
 * Creole fluency is precisely the fabrication this program forbids.
 */

import { CASES, SUITE_VERSION } from './suite.v1'
import type { CaseResult, EvalContext, EvalTarget, Outcome, SuiteResult } from './types'

const arg = (name: string, fallback?: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : fallback
}

/** The whole product path: auth-scoped consumer → Brain → model. */
function brainTarget(): EvalTarget {
  const base = process.env.BRAIN_BASE_URL ?? 'http://127.0.0.1:3988'
  const owner = process.env.EVAL_OWNER_SCOPE
  const workspace = process.env.EVAL_WORKSPACE_SCOPE
  if (!owner || !workspace) {
    throw new Error(
      'EVAL_OWNER_SCOPE and EVAL_WORKSPACE_SCOPE are required for the brain target.\n' +
        'They are the tenancy headers the Brain grounds on; guessing them would measure the wrong tenant.',
    )
  }

  const headers = {
    'content-type': 'application/json',
    'x-owner-scope': owner,
    'x-workspace-scope': workspace,
  }

  return {
    name: `brain(${base})`,
    async model() {
      const res = await fetch(`${base}/health`)
      const body = (await res.json()) as { providers?: { name: string }[] }
      return body.providers?.map((p) => p.name).join(',') ?? 'unknown'
    },
    async ask({ prompt, history, grounded }) {
      // History is folded into the summary field: the eval measures the model's
      // conversational behaviour, not the Brain's memory store.
      const conversationSummary = history?.length
        ? history.map((m) => `${m.role}: ${m.content}`).join('\n')
        : undefined
      const res = await fetch(`${base}/api/ai/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          prompt,
          ...(conversationSummary ? { conversationSummary } : {}),
          groundingMode: grounded ? 'approved' : 'none',
        }),
      })
      const body = (await res.json()) as { content?: string; error?: string; code?: string }
      // A grounded refusal is a legitimate answer for the refusal-integrity case,
      // so it is returned as text rather than thrown.
      return body.content ?? (body.code ? `[${body.code}] ${body.error ?? ''}` : '')
    },
  }
}

/** A raw candidate model, before it has earned any route. */
function ollamaTarget(model: string): EvalTarget {
  const base = process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434'
  return {
    name: `ollama(${model})`,
    async model() {
      return model
    },
    async ask({ prompt, history }) {
      const messages = [
        ...(history ?? []).map((m) => ({ role: m.role, content: m.content })),
        { role: 'user', content: prompt },
      ]
      const res = await fetch(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, messages, stream: false }),
      })
      const body = (await res.json()) as { choices?: { message?: { content?: string } }[] }
      return body.choices?.[0]?.message?.content ?? ''
    },
  }
}

async function main(): Promise<void> {
  const targetName = arg('target', 'brain')!
  const target = targetName === 'ollama' ? ollamaTarget(arg('model', 'qwen3:8b')!) : brainTarget()
  const only = arg('only')

  const context: EvalContext = {
    ownedFiles: (process.env.EVAL_OWNED_FILES ?? '').split(',').map((f) => f.trim()).filter(Boolean),
  }

  const cases = only ? CASES.filter((c) => c.capability === only || c.id === only) : CASES
  if (cases.length === 0) throw new Error(`No cases match --only ${only}`)

  const model = await target.model()
  console.log(`\n${SUITE_VERSION}\ntarget: ${target.name}\nmodel:  ${model}\ncases:  ${cases.length}\n`)

  const results: CaseResult[] = []
  for (const testCase of cases) {
    const started = Date.now()
    let reply = ''
    let outcome: Outcome = 'pass'
    let failed: string[] = []

    try {
      reply = await target.ask({
        prompt: testCase.prompt,
        ...(testCase.history ? { history: testCase.history } : {}),
        ...(testCase.grounded ? { grounded: true } : {}),
      })
      failed = testCase.assertions.filter((a) => !a.check(reply, context)).map((a) => a.describe)
      // Human review never overrides a hard failure: a machine-decidable
      // expectation that did not hold is a failure regardless of taste.
      outcome = failed.length > 0 ? 'fail' : testCase.humanReview ? 'needs-human' : 'pass'
    } catch (error) {
      outcome = 'error'
      failed = [error instanceof Error ? error.message : String(error)]
    }

    const result: CaseResult = {
      id: testCase.id,
      capability: testCase.capability,
      outcome,
      prompt: testCase.prompt,
      reply,
      latencyMs: Date.now() - started,
      failed,
      ...(testCase.humanReview ? { humanReview: testCase.humanReview } : {}),
    }
    results.push(result)

    const mark = { pass: 'PASS', fail: 'FAIL', 'needs-human': 'HUMAN', error: 'ERR ' }[outcome]
    console.log(`${mark}  ${testCase.id.padEnd(26)} ${String(result.latencyMs).padStart(6)}ms  ${testCase.capability}`)
    if (outcome === 'fail' || outcome === 'error') {
      for (const reason of failed) console.log(`      ✗ ${reason}`)
      console.log(`      reply: ${reply.replace(/\s+/g, ' ').slice(0, 200)}`)
    }
  }

  const totals: Record<Outcome, number> = { pass: 0, fail: 0, 'needs-human': 0, error: 0 }
  const byCapability: SuiteResult['byCapability'] = {}
  for (const r of results) {
    totals[r.outcome] += 1
    const bucket = (byCapability[r.capability] ??= { pass: 0, fail: 0, needsHuman: 0, error: 0 })
    if (r.outcome === 'pass') bucket.pass += 1
    else if (r.outcome === 'fail') bucket.fail += 1
    else if (r.outcome === 'needs-human') bucket.needsHuman += 1
    else bucket.error += 1
  }

  console.log(
    `\npass ${totals.pass}   fail ${totals.fail}   needs-human ${totals['needs-human']}   error ${totals.error}\n`,
  )
  console.log('by capability:')
  for (const [capability, b] of Object.entries(byCapability).sort()) {
    console.log(
      `  ${capability.padEnd(22)} pass ${b.pass}  fail ${b.fail}  human ${b.needsHuman}  err ${b.error}`,
    )
  }

  const needing = results.filter((r) => r.outcome === 'needs-human')
  if (needing.length) {
    console.log(`\n── HUMAN REVIEW REQUIRED (${needing.length}) ────────────────────────`)
    console.log('A machine cannot judge these. Read the reply and decide.\n')
    for (const r of needing) {
      console.log(`[${r.id}] ${r.capability}`)
      console.log(`  asked:  ${r.prompt}`)
      console.log(`  reply:  ${r.reply.replace(/\s+/g, ' ').slice(0, 400)}`)
      console.log(`  judge:  ${r.humanReview}\n`)
    }
  }

  const suite: SuiteResult = {
    suiteVersion: SUITE_VERSION,
    target: target.name,
    model,
    startedAt: new Date().toISOString(),
    results,
    totals,
    byCapability,
  }

  const out = arg('out')
  if (out) {
    const { writeFile } = await import('node:fs/promises')
    await writeFile(out, JSON.stringify(suite, null, 2))
    console.log(`\nreport: ${out}`)
  }

  // Human review does not fail the run; an unmet machine expectation does.
  process.exit(totals.fail + totals.error > 0 ? 1 : 0)
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
