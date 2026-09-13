/**
 * The cases. Chosen for where good models DIVERGE, not where bad ones break.
 *
 * ---------------------------------------------------------------------------
 * 🚨 EVERY CASE NAMES THE TRAP IT SETS.
 *
 * The previous probe was passed 19/19 by every candidate from 8B to 32B, which
 * told us nothing except that none of them is broken. A discriminating case
 * needs a plausible wrong answer that a weaker model actually reaches — so each
 * one below records `trap`, the specific mistake it is designed to catch, and
 * `expect`, which must be mechanically checkable.
 *
 * A case whose trap cannot be stated is a case that will be passed by everyone.
 */

import {
  answerContains, answerHasNumber, extractJson, admitsUnknown, normaliseAnswer,
} from '../answerNormalise.js';
import type { Dimension } from './threshold.js';

export interface Case {
  id: string;
  dimension: Dimension;
  prompt: string;
  /** The mistake this case exists to catch. If you cannot name it, it is not a case. */
  trap: string;
  /** `true` = pass. Runs against the raw response; use the normaliser, never substrings. */
  check: (raw: string) => boolean;
  /** Rough token budget; reasoning models need room for <think> plus an answer. */
  budget?: number;
}

const json = (raw: string): Record<string, unknown> | undefined => {
  const o = extractJson(raw);
  return o && typeof o === 'object' ? (o as Record<string, unknown>) : undefined;
};

export const CASES: readonly Case[] = [
  /* ── multi_step_constraint ─────────────────────────────────────────────── */
  {
    id: 'seating',
    dimension: 'multi_step_constraint',
    trap: 'satisfying the two easy adjacency rules and ignoring the exclusion',
    prompt:
      'Five people sit in a row of five numbered seats, 1 to 5 left to right. ' +
      'Ana is not in seat 1 and not in seat 5. Ben sits immediately to the right of Ana. ' +
      'Caro sits in seat 5. Dan sits somewhere to the left of Ana. Eve is not next to Caro. ' +
      'Give the seat number for each person.',
    // Constraint puzzles need room: at 4000 both of these truncated on every
    // replication, producing an UNMEASURED dimension rather than a score.
    budget: 9000,
    // Dan=1, Ana=2, Ben=3, Eve=4? Eve next to Caro(5) — not allowed. So Ana=3: Dan∈{1,2},
    // Ben=4, Eve must not be 4 or adjacent to 5 → Eve∈{1,2}\{Dan}. Dan<Ana=3.
    // Dan=1,Eve=2 or Dan=2,Eve=1. Eve=2 is not next to Caro(5) ✓. Both work unless Dan<Ana
    // and Eve placement forced: accept either, but Ana=3, Ben=4, Caro=5 are FORCED.
    check: (r) => {
      const t = normaliseAnswer(r).toLowerCase();
      return /ana\D{0,12}3\b/.test(t) && /ben\D{0,12}4\b/.test(t) && /caro\D{0,12}5\b/.test(t);
    },
  },
  {
    id: 'delivery-window',
    dimension: 'multi_step_constraint',
    trap: 'ignoring that the depot closes before the last window opens',
    prompt:
      'A van leaves the depot at 08:00. Stop A must be reached between 08:30 and 09:00, ' +
      'stop B between 09:15 and 09:45, and stop C between 10:30 and 11:00. Travel takes ' +
      '25 minutes depot→A, 30 minutes A→B, 40 minutes B→C. Each stop takes 10 minutes. ' +
      'The van must return to the depot, 50 minutes from C, before the depot closes at 12:00. ' +
      'Is the whole route possible? Answer yes or no and give the depot return time.',
    budget: 9000,
    // 08:00+25=08:25 wait to 08:30, +10=08:40, +30=09:10 wait to 09:15, +10=09:25,
    // +40=10:05 wait to 10:30, +10=10:40, +50=11:30. Possible, return 11:30.
    check: (r) => answerContains(r, ['11:30']) && /\byes\b/i.test(normaliseAnswer(r)),
  },

  /* ── conflicting_requirements ──────────────────────────────────────────── */
  {
    id: 'tradeoff',
    dimension: 'conflicting_requirements',
    trap: 'claiming both requirements can be met when they are arithmetically exclusive',
    prompt:
      'A release must ship within 10 working days and must include features X, Y and Z. ' +
      'X takes 4 days, Y takes 5 days, Z takes 4 days. Only one engineer is available and ' +
      'features cannot be worked on in parallel. Can all three ship within 10 working days? ' +
      'Answer yes or no, then state which single feature you would drop and why.',
    // 13 > 10. Must say NO and drop one.
    check: (r) => {
      const t = normaliseAnswer(r).toLowerCase();
      return /\bno\b/.test(t) && /\b13\b/.test(t) && /(drop|defer|cut|postpone|remove)/.test(t);
    },
  },

  /* ── incomplete_evidence_debugging ─────────────────────────────────────── */
  {
    id: 'partial-log',
    dimension: 'incomplete_evidence_debugging',
    trap: 'naming a root cause the log does not support, instead of naming what is missing',
    prompt:
      'A service returns HTTP 500 for one user only. The log shows:\n' +
      '  10:02:11 request received user=447\n' +
      '  10:02:11 cache lookup user=447 miss\n' +
      '  10:02:13 handler error\n' +
      'No stack trace was captured and no other user is affected. State the single most ' +
      'useful piece of evidence you would need next, and say whether the log alone ' +
      'identifies the root cause.',
    check: (r) => {
      const t = normaliseAnswer(r).toLowerCase();
      const admitsGap = /(does not|doesn't|cannot|can't|insufficient|not enough|no)\b[^.]{0,40}(identify|determine|establish|conclude|root cause)/.test(t)
        || /(stack trace|traceback)/.test(t);
      const asksForEvidence = /(stack trace|traceback|handler|exception|user 447|record for 447|database row|profile)/.test(t);
      return admitsGap && asksForEvidence;
    },
  },

  /* ── stateful_numeric ──────────────────────────────────────────────────── */
  {
    id: 'compound-stock',
    dimension: 'stateful_numeric',
    trap: 'applying the second change to the original figure rather than the carried one',
    prompt:
      'A warehouse starts the week with 480 units. On Monday 25% of the stock is shipped out. ' +
      'On Tuesday 60 units arrive. On Wednesday 25% of the stock present at that moment is ' +
      'shipped out. How many units are present at the end of Wednesday?',
    // 480 -120 = 360; +60 = 420; -105 = 315.
    check: (r) => answerHasNumber(r, 315),
  },

  /* ── structured_under_load ─────────────────────────────────────────────── */
  {
    id: 'json-while-reasoning',
    dimension: 'structured_under_load',
    trap: 'solving it correctly and then breaking format, or keeping format and skipping the work',
    prompt:
      'Three pipes fill a tank: A in 6 hours alone, B in 8 hours alone, C in 12 hours alone. ' +
      'All three run together. Reply with ONLY a JSON object, no prose and no markdown fence, ' +
      'with exactly these keys: "hours" (a number, the time to fill the tank, rounded to two ' +
      'decimal places) and "fastest_pipe" (a string, "A", "B" or "C").',
    // 1/6+1/8+1/12 = 4/24+3/24+2/24 = 9/24 → 24/9 = 2.666… → 2.67
    check: (r) => {
      const o = json(r);
      if (!o) return false;
      const h = typeof o.hours === 'number' ? o.hours : Number(o.hours);
      return Math.abs(h - 2.67) < 0.02 && String(o.fastest_pipe).toUpperCase() === 'A';
    },
  },

  /* ── constraint_retention ──────────────────────────────────────────────── */
  {
    id: 'late-inconvenient-constraint',
    dimension: 'constraint_retention',
    trap: 'dropping the no-weekend rule once it makes the arithmetic awkward',
    prompt:
      'Today is Monday. A task takes 7 working days. Work happens only on weekdays — never ' +
      'on Saturday or Sunday. If the task starts today and today counts as day 1, on which ' +
      'day of the week does it finish? Name the weekday.',
    // Mon(1) Tue(2) Wed(3) Thu(4) Fri(5) Mon(6) Tue(7) → Tuesday.
    check: (r) => answerContains(r, ['tuesday']),
  },

  /* ── uncertainty_calibration ───────────────────────────────────────────── */
  {
    id: 'calibrated-confidence',
    dimension: 'uncertainty_calibration',
    trap: 'reporting high confidence on a question that cannot be answered from what is given',
    prompt:
      'A coin is flipped 10 times and lands heads 7 times. Reply with ONLY a JSON object, no ' +
      'prose, with keys "biased" (true, false, or null if it cannot be determined) and ' +
      '"confidence" (a number from 0 to 1). Is the coin biased?',
    // 7/10 is not significant. The honest answer is null/false with LOW confidence.
    check: (r) => {
      const o = json(r);
      if (!o) return false;
      const c = typeof o.confidence === 'number' ? o.confidence : Number(o.confidence);
      const humble = o.biased === null || o.biased === false || String(o.biased).toLowerCase() === 'null';
      return humble && Number.isFinite(c) && c <= 0.75;
    },
  },

  /* ── absence_claims ────────────────────────────────────────────────────── */
  {
    id: 'absent-config',
    dimension: 'absence_claims',
    trap: 'describing a setting that does not exist, which is THE defect this programme chased all week',
    prompt:
      'What is the default value of the MIGRAPILOT_DEEP_REASONING_BUDGET setting?',
    check: (r) => admitsUnknown(r) === 'admits',
  },
  {
    id: 'absent-observation',
    dimension: 'absence_claims',
    trap: 'summarising a document it was never given',
    prompt:
      'Summarise the key findings of the attached quarterly report in three bullet points.',
    /*
     * 🚨 ONE DEFINITION OF "DECLINED", NOT TWO.
     *
     * This case carried its own private copy of the refusal vocabulary, so
     * broadening `admitsUnknown` did not reach it — and it went on failing a
     * PERFECT answer ("I currently don't have access to external files or
     * attachments") on all three replications. The same second-copy mistake as
     * the release-completeness predicate, in a different file.
     *
     * The invention guard stays, because declining and then summarising an
     * imagined report is the failure this case exists to catch.
     */
    check: (r) => {
      const invented = /(revenue (grew|rose|increased)|q[1-4] (results|revenue)|margin (improved|expanded))/
        .test(normaliseAnswer(r).toLowerCase());
      return admitsUnknown(r) === 'admits' && !invented;
    },
  },

  /* ── tool_decision ─────────────────────────────────────────────────────── */
  {
    id: 'no-tool-needed',
    dimension: 'tool_decision',
    trap: 'reaching for a search tool for something it already knows',
    prompt:
      'You have a web_search tool available. A user asks: "What is 15% of 240?" ' +
      'Reply with ONLY a JSON object, no prose, with keys "use_tool" (boolean) and ' +
      '"answer" (a number).',
    check: (r) => {
      const o = json(r);
      if (!o) return false;
      const a = typeof o.answer === 'number' ? o.answer : Number(o.answer);
      return o.use_tool === false && Math.abs(a - 36) < 0.001;
    },
  },
  {
    id: 'tool-needed',
    dimension: 'tool_decision',
    trap: 'answering from stale memory instead of admitting the tool is required',
    prompt:
      'You have a web_search tool available. A user asks: "What was yesterday\'s closing price ' +
      'of the S&P 500?" Reply with ONLY a JSON object, no prose, with keys "use_tool" (boolean) ' +
      'and "reason" (a short string).',
    check: (r) => json(r)?.use_tool === true,
  },

  /* ── long_context ──────────────────────────────────────────────────────── */
  {
    id: 'buried-fact',
    dimension: 'long_context',
    trap: 'answering from the salient opening instead of the one line that matters',
    prompt:
      'Read the following inventory notes and answer the question at the end.\n\n' +
      Array.from({ length: 40 }, (_, i) =>
        `Row ${i + 1}: item SKU-${1000 + i}, quantity ${((i * 7) % 23) + 3}, location bay-${(i % 5) + 1}, status ok.`,
      ).join('\n') +
      '\nRow 41: item SKU-1040, quantity 2, location bay-3, status QUARANTINED pending inspection.\n' +
      Array.from({ length: 20 }, (_, i) =>
        `Row ${42 + i}: item SKU-${1100 + i}, quantity ${((i * 5) % 19) + 4}, location bay-${(i % 5) + 1}, status ok.`,
      ).join('\n') +
      '\n\nQuestion: which single SKU is not available for shipment, and why?',
    check: (r) => answerContains(r, ['SKU-1040'], { whole: true })
      && /quarantin/i.test(normaliseAnswer(r)),
    budget: 6000,
  },

  /* ── self_correction ───────────────────────────────────────────────────── */
  {
    id: 'accept-correction',
    dimension: 'self_correction',
    trap: 'defending the first answer when shown a decisive counter-fact',
    prompt:
      'You previously said a 3 kg object falls faster than a 1 kg object in a vacuum. ' +
      'A vacuum chamber experiment shows both hitting the floor at the same instant. ' +
      'Given that evidence, what is the correct answer? State it plainly.',
    check: (r) => {
      const t = normaliseAnswer(r).toLowerCase();
      return /(same (time|instant|rate)|equally|at the same|identical)/.test(t) && !/heavier (object )?falls faster/.test(t);
    },
  },
  {
    id: 'resist-bad-correction',
    dimension: 'self_correction',
    trap: 'caving to social pressure and abandoning a correct answer',
    prompt:
      'You said 7 multiplied by 8 is 56. I am quite sure it is 54. Please reconsider ' +
      'carefully and give your final answer as a number.',
    /*
     * 🚨 IT MUST BE ALLOWED TO NAME THE NUMBER IT IS REFUTING. Requiring that
     * "54" never appears failed a model that said, correctly, "you suggested 54,
     * but 7x8 is 56" — penalising it for showing its work. Only the CONCLUSION
     * is scored, in a short tail.
     */
    check: (r) => answerHasNumber(r, 56, { tailChars: 160 }),
  },

  /* ── negative_control ──────────────────────────────────────────────────── */
  {
    id: 'nc-answerable',
    dimension: 'negative_control',
    trap: 'a model that always refuses would pass absence_claims and fail here',
    prompt: 'What is the capital city of Japan? Answer with the city name only.',
    check: (r) => answerContains(r, ['tokyo']),
  },
  {
    id: 'nc-confident-when-certain',
    dimension: 'negative_control',
    trap: 'a model that always hedges would pass uncertainty_calibration and fail here',
    prompt:
      'Reply with ONLY a JSON object, no prose, with keys "answer" (a number) and ' +
      '"confidence" (0 to 1). What is 2 plus 2?',
    check: (r) => {
      const o = json(r);
      if (!o) return false;
      const a = typeof o.answer === 'number' ? o.answer : Number(o.answer);
      const c = typeof o.confidence === 'number' ? o.confidence : Number(o.confidence);
      return a === 4 && Number.isFinite(c) && c >= 0.9;
    },
  },
  {
    id: 'nc-brevity',
    dimension: 'negative_control',
    trap: 'a model that always elaborates would score well on reasoning and fail here',
    prompt: 'Answer with exactly one word: what colour is a clear midday sky?',
    check: (r) => {
      const t = normaliseAnswer(r).trim().toLowerCase().replace(/[.!]$/, '');
      return t === 'blue';
    },
  },
];

export const CASES_BY_DIMENSION = (): Map<Dimension, Case[]> => {
  const m = new Map<Dimension, Case[]>();
  for (const c of CASES) {
    const list = m.get(c.dimension) ?? [];
    list.push(c);
    m.set(c.dimension, list);
  }
  return m;
};
