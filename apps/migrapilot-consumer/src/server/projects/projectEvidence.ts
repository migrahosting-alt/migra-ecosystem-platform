/**
 * THE CONNECTED PROJECT, IN A CHAT TURN.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS CLOSES
 *
 * Connect, bind and read-only inspect were all proven — through the API. The
 * chat turn had no reference to any of it, so asking MigraPilot in conversation
 * to look at project files still refused. That refusal was the original defect
 * report, and fixing its wording never made the capability reachable.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE BROWSER SENDS NOTHING ABOUT THE PROJECT
 *
 * Not a root, not a permission, not an authority, not even a project id. The
 * turn carries a conversation, and everything else is resolved from it —
 * server-side, through the Brain, on THIS turn.
 *
 * That last part is the load-bearing one. A connection made yesterday is not
 * authorization today: the inspect route re-resolves the binding and the grant
 * on every call, so revocation lands on the next question rather than the next
 * reconnect.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS SITS BESIDE `tableEvidenceFor` RATHER THAN INSIDE THE BRAIN'S CHAT
 *
 * Deterministic evidence is already assembled here and prepended to the model's
 * prompt — computed figures from a spreadsheet, and now facts read out of a
 * project. Same seam, same shape, same rule that the model may not recalculate
 * what was measured for it.
 *
 * The AUTHORITY still lives in the Brain: this module knows a conversation id
 * and a question, and gets back either evidence or a refusal it did not author.
 * It never learns what the user may do, which is what keeps a second opinion
 * about access from forming in a second place.
 * ---------------------------------------------------------------------------
 */

import 'server-only'

import { callBrain } from '@/server/brain/gateway'
import type { Principal } from '@/server/tenancy/principal'
import { composeEvidence } from '@/server/evidence/composition'

/** What a question is asking of the project, if anything. */
export type ProjectIntent =
  | { op: 'search'; query: string }
  | { op: 'list' }
  | { op: 'git_status' }

/**
 * Read the question, conservatively.
 *
 * 🚨 RETURNS NULL WHEN UNSURE, ALWAYS. A false positive spends a real
 * filesystem read on a turn that never asked for one and puts project contents
 * in front of a question about something else. The cost of a false negative is
 * that the user rephrases; the cost of a false positive is evidence nobody
 * wanted, so the asymmetry decides the default.
 */
export function detectProjectIntent(prompt: string): ProjectIntent | null {
  const text = prompt.trim()
  if (!text) return null

  /*
   * A QUOTED STRING plus a looking-for verb is the unambiguous case: the user
   * has told us exactly what to find, so there is nothing to guess.
   */
  const quoted = text.match(/["'`]([^"'`\n]{2,200})["'`]/)
  const looking = /\b(find|search|look for|grep|locate|which files?|where is|contains?)\b/i.test(text)
  const projectish = /\b(project|repo|repository|codebase|workspace|files?|code)\b/i.test(text)

  if (quoted && looking) return { op: 'search', query: quoted[1]! }

  // "search my project for X" — the target trails the preposition.
  const trailing = text.match(/\b(?:search|find|look for|grep)\b[^.?!\n]*?\bfor\s+([^\s.?!,]{3,120})/i)
  if (trailing && projectish) return { op: 'search', query: trailing[1]! }

  if (projectish && /\b(list|show|what.s in|contents of|structure)\b/i.test(text)) return { op: 'list' }
  if (projectish && /\b(git status|uncommitted|changed files?)\b/i.test(text)) return { op: 'git_status' }

  return null
}

export interface ProjectEvidence {
  /** Prepended to the model's prompt. Never stored as the user's message. */
  text: string
  /** For the turn trace. */
  op: string
  /** The project's LABEL, for the trace and for citation. Never its id. */
  project?: string
  /** True when the turn produced a refusal rather than facts. */
  refused: boolean
  /** What the client should offer. Passed through from the Brain. */
  remedy?: string
}

/**
 * The directive attached to real findings.
 *
 * The same discipline the table evidence uses: these are MEASURED, the model
 * must not re-derive them, and it must not describe files it was not shown.
 */
const FOUND_DIRECTIVE = [
  'Use these results verbatim. They were read directly from the connected project by',
  'MigraPilot; do not guess at other files, do not invent paths, and do not claim to',
  'have read anything not listed here. Name the files that actually matched.',
]

/**
 * The directive attached to a refusal.
 *
 * 🚨 NO EXCEPTION CLAUSE. An earlier refusal directive said "unless the reason
 * above says so" and a model used it to invent a different, wronger reason. The
 * reason is the reason.
 */
const REFUSED_DIRECTIVE = [
  'Give THAT reason to the user — do not substitute a different one.',
  'Do NOT describe, guess at, or invent any project contents: nothing was read.',
  'Never suggest opening the project in another application.',
]

export async function projectEvidenceFor(
  prompt: string,
  conversationId: string,
  principal: Principal,
): Promise<ProjectEvidence | null> {
  const intent = detectProjectIntent(prompt)
  if (!intent) return null

  const result = await callBrain(
    {
      kind: 'inspectProject',
      conversationId,
      op: intent.op,
      ...(intent.op === 'search' ? { query: intent.query } : {}),
    },
    { principal },
  )

  /* ---------- the backend could not be asked ---------- */
  if (result.kind === 'transport_failure' || result.kind === 'timeout') {
    /*
     * AN AVAILABILITY FAILURE, NEVER "no project". The user's connection and
     * their access are both fine and simply unknown right now; reporting this
     * as a missing project would send them to reconnect something that is
     * already connected.
     */
    return {
      op: `unavailable:${intent.op}`,
      refused: true,
      remedy: 'retry',
      text: composeEvidence({
        fact: [
          '[MigraPilot could not reach the project service, so nothing was read from the',
          'connected project. This is a temporary service problem, NOT a problem with the',
          'user’s project or their access to it.',
        ],
        directives: REFUSED_DIRECTIVE,
      }),
    }
  }

  /* ---------- the Brain answered, and its answer may be a refusal ---------- */
  const payload = (result.kind === 'ok' ? result.value : (result as { body?: unknown }).body) as
    | { ok?: boolean; error?: string; remedy?: string; project?: string; data?: unknown }
    | undefined

  if (!payload || payload.ok !== true) {
    const reason = payload?.error
    if (!reason) return null // Nothing sayable; stay silent rather than guess.
    return {
      op: `refused:${intent.op}`,
      refused: true,
      ...(payload?.remedy ? { remedy: payload.remedy } : {}),
      text: composeEvidence({
        fact: [`[MigraPilot could not read the connected project: ${reason}`],
        directives: REFUSED_DIRECTIVE,
      }),
    }
  }

  /* ---------- real findings ---------- */
  const data = payload.data as { matches?: Array<{ path: string; line: number; preview: string }>; entries?: Array<{ name: string; type: string }> } | undefined
  const label = payload.project

  if (intent.op === 'search') {
    const matches = data?.matches ?? []
    if (matches.length === 0) {
      /*
       * FOUND NOTHING IS A RESULT, not an absence of evidence. Saying so stops
       * the model filling the gap with a plausible guess about where it "would"
       * be — which is the failure mode a silent return invites.
       */
      return {
        op: 'search',
        project: label,
        refused: false,
        text: composeEvidence({
          fact: [
            `[MigraPilot searched the connected project${label ? ` (${label})` : ''} for`,
            `"${intent.query}" and found NO matches.`,
          ],
          directives: [
            'Say so plainly. Do not speculate about where it might be or suggest files that',
            'were not searched.]',
          ],
        }),
      }
    }
    return {
      op: 'search',
      project: label,
      refused: false,
      text: composeEvidence({
        fact: [
          `[Read directly from the connected project${label ? ` (${label})` : ''} by MigraPilot.`,
          `Searching for "${intent.query}" matched ${matches.length} location(s):]`,
          ...matches.slice(0, 40).map((m) => `  ${m.path}:${m.line} — ${m.preview.trim().slice(0, 160)}`),
        ],
        directives: FOUND_DIRECTIVE,
      }),
    }
  }

  const entries = data?.entries ?? []
  return {
    op: intent.op,
    project: label,
    refused: false,
    text: composeEvidence({
      fact: [
        `[Read directly from the connected project${label ? ` (${label})` : ''} by MigraPilot:]`,
        ...(entries.length
          ? entries.slice(0, 60).map((e) => `  ${e.name}${e.type === 'dir' ? '/' : ''}`)
          : [`  ${JSON.stringify(data ?? {}).slice(0, 600)}`]),
      ],
      directives: FOUND_DIRECTIVE,
    }),
  }
}
