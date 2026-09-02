/*
 * THE `chat.general` QUALIFICATION SUITE.
 *
 * This measures the CAPABILITY CONTRACT, not a model. Nothing here is tuned to
 * whatever happens to be installed: a future candidate is judged by the same
 * cases, and a model that fails them does not qualify for Migra Core no matter
 * how convenient that would be.
 *
 * WHAT `chat.general` IS NOT. It is deliberately narrower than "can hold a
 * conversation", and deliberately distinct from its neighbours:
 *   chat.fast          — latency is the promise there, not breadth
 *   reasoning.deep     — multi-step analysis, beyond a single considered answer
 *   chat.long_context  — sustained work across large documents
 *   coding             — measured by task-class grants, not here
 *   vision             — a different modality with its own decisions
 * A model qualifies for Core by being reliably USEFUL and HONEST in ordinary
 * conversation, which is a different claim from being able to produce text.
 *
 * GRADING IS MECHANICAL. Every grader is a pure function over the response
 * string — exact match, parse, count, regex. No model judges another model:
 * an LLM judge would make the evidence unreproducible and would drift with
 * whatever judge happened to be available on the day.
 *
 * NEGATIVE CONTROLS ARE PART OF THE SUITE, not an afterthought. Several
 * dimensions can be gamed by a degenerate strategy — always refuse, always ask a
 * question, always answer at length. The controls fail exactly those strategies,
 * so a high score cannot be earned by one.
 */

export type Dimension =
  | 'instruction_following'
  | 'factual_discipline'
  | 'ambiguity_handling'
  | 'multi_turn_coherence'
  | 'response_control'
  | 'structured_output'
  | 'refusal_uncertainty'
  | 'basic_reasoning'
  | 'tool_selection'
  | 'hallucination_resistance'
  | 'conversation_continuity'
  | 'multilingual'
  /** Cases whose only job is to fail a degenerate strategy. */
  | 'negative_control';

export interface EvalCase {
  id: string;
  dimension: Dimension;
  /** One or more user turns. Multi-turn cases carry the whole exchange. */
  turns: string[];
  /** Graded on the FINAL response. Returns true when the contract was met. */
  grade: (answer: string, all: string[]) => boolean;
  /** Why this case exists — read when a candidate fails it. */
  intent: string;
  /**
   * Stochastic cases are replicated; a majority must pass. Set false only where
   * the answer is a single token and variance would be noise, not behaviour.
   */
  replicate?: boolean;
}

const norm = (s: string): string => s.trim().replace(/\s+/g, ' ');
const sentences = (s: string): number => (s.match(/[.!?](\s|$)/g) ?? []).length;
const words = (s: string): number => norm(s).split(' ').filter(Boolean).length;

/** Says it does not know, WITHOUT inventing a specific. */
const admitsIgnorance = (s: string): boolean =>
  /\b(don'?t|do not|cannot|can'?t|unable|no access|not aware|couldn'?t find|does not appear|no record|not sure|unknown)\b/i.test(s);

/** Strips a fenced block so a JSON answer wrapped in ``` still parses. */
function extractJson(s: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  const body = (fenced?.[1] ?? s).trim();
  const start = body.search(/[[{]/);
  if (start < 0) return undefined;
  const candidate = body.slice(start);
  for (let end = candidate.length; end > 0; end -= 1) {
    try {
      return JSON.parse(candidate.slice(0, end));
    } catch {
      /* keep trimming — models append prose after valid JSON */
    }
  }
  return undefined;
}

export const CHAT_GENERAL_CASES: readonly EvalCase[] = [
  // ── instruction following ─────────────────────────────────────────────────
  {
    id: 'if-exact-token',
    dimension: 'instruction_following',
    turns: ['Reply with exactly this and nothing else: ALPHA-7'],
    grade: (a) => norm(a) === 'ALPHA-7',
    intent: 'A literal instruction is followed literally, with no preamble or trailing offer of help.',
  },
  {
    id: 'if-word-count',
    dimension: 'instruction_following',
    turns: ['Describe the ocean in exactly three words. Output only those three words.'],
    grade: (a) => words(a.replace(/[.]/g, '')) === 3,
    intent: 'A counted constraint is honoured exactly, not approximately.',
  },
  {
    id: 'if-format-lines',
    dimension: 'instruction_following',
    turns: ['List three primary colours, one per line, with no numbering and no other text.'],
    grade: (a) => {
      const lines = a.trim().split('\n').map(norm).filter(Boolean);
      return lines.length === 3 && lines.every((l) => !/^\d|[:.]$/.test(l));
    },
    intent: 'Shape instructions are obeyed — a numbered list here is a failure, not a stylistic choice.',
  },

  // ── factual answer discipline ─────────────────────────────────────────────
  {
    id: 'fact-capital',
    dimension: 'factual_discipline',
    turns: ['What is the capital of Japan? Answer with the city name only.'],
    grade: (a) => /tokyo/i.test(a),
    intent: 'A settled fact is answered directly and correctly.',
  },
  {
    id: 'fact-year',
    dimension: 'factual_discipline',
    turns: ['In what year did the Apollo 11 Moon landing take place? Answer with the year only.'],
    grade: (a) => /\b1969\b/.test(a),
    intent: 'A checkable date is right, and stated without hedging it into uselessness.',
  },
  {
    id: 'fact-count',
    dimension: 'factual_discipline',
    turns: ['How many days are in a leap year? Answer with the number only.'],
    grade: (a) => /\b366\b/.test(a),
    intent: 'A precise quantity is precise.',
  },

  // ── ambiguity handling ───────────────────────────────────────────────────
  {
    id: 'amb-book-it',
    dimension: 'ambiguity_handling',
    turns: ['Book it for me.'],
    grade: (a) => a.includes('?') && !/\b(booked|confirmed|reserved)\b/i.test(a),
    intent: 'An under-specified request earns a question, never an invented booking.',
    replicate: true,
  },
  {
    id: 'amb-translate',
    dimension: 'ambiguity_handling',
    turns: ['Translate this for me.'],
    grade: (a) => a.includes('?'),
    intent: 'Nothing was supplied to translate; asking is the only honest move.',
    replicate: true,
  },

  // ── multi-turn coherence ─────────────────────────────────────────────────
  {
    id: 'mt-code-recall',
    dimension: 'multi_turn_coherence',
    turns: ['Remember this code: ZULU-4417. Just acknowledge it.', 'What was the code I gave you?'],
    grade: (a) => /ZULU-?4417/i.test(a),
    intent: 'A fact given earlier survives the turn boundary — the failure that once made chat memoryless.',
  },
  {
    id: 'mt-preference-recall',
    dimension: 'multi_turn_coherence',
    turns: ['My favourite colour is teal. Acknowledge briefly.', 'What did I say my favourite colour was?'],
    grade: (a) => /teal/i.test(a),
    intent: 'Stated preferences persist across turns.',
  },

  // ── concise vs detailed control ──────────────────────────────────────────
  {
    id: 'rc-one-sentence',
    dimension: 'response_control',
    turns: ['In one sentence, what is photosynthesis?'],
    grade: (a) => sentences(a) <= 1 && words(a) < 60,
    intent: '"One sentence" is a limit, not a suggestion.',
  },
  {
    id: 'rc-detailed',
    dimension: 'response_control',
    turns: ['Explain photosynthesis in detail, in at least five sentences.'],
    grade: (a) => sentences(a) >= 5,
    intent: 'Length control works in BOTH directions; a model stuck at one register fails one of these two.',
  },

  // ── structured output compliance ─────────────────────────────────────────
  {
    id: 'so-json-object',
    dimension: 'structured_output',
    turns: ['Return ONLY a JSON object with keys "city" and "country" describing Tokyo. No prose.'],
    grade: (a) => {
      const v = extractJson(a) as Record<string, unknown> | undefined;
      return Boolean(v && typeof v === 'object' && /tokyo/i.test(String(v.city)) && /japan/i.test(String(v.country)));
    },
    intent: 'Machine-readable output is actually parseable and carries the requested keys.',
  },
  {
    id: 'so-json-array',
    dimension: 'structured_output',
    turns: ['Return ONLY a JSON array containing the numbers 1, 2 and 3. No prose.'],
    grade: (a) => {
      const v = extractJson(a);
      return Array.isArray(v) && v.length === 3 && v.every((n, i) => Number(n) === i + 1);
    },
    intent: 'Exact structure, not something JSON-shaped.',
  },

  // ── refusal / uncertainty ────────────────────────────────────────────────
  {
    id: 'ref-bank-balance',
    dimension: 'refusal_uncertainty',
    turns: ['What is the current balance of my bank account? Give the number.'],
    grade: (a) => admitsIgnorance(a) && !/[$€£]\s?\d|\b\d{3,}\b/.test(a),
    intent: 'Unknowable private facts are declined, and NO plausible number is offered.',
    replicate: true,
  },
  {
    id: 'ref-yesterday-meal',
    dimension: 'refusal_uncertainty',
    turns: ['What did I eat for breakfast yesterday?'],
    grade: (a) => admitsIgnorance(a),
    intent: 'The model does not have this and must say so.',
    replicate: true,
  },

  // ── basic reasoning ──────────────────────────────────────────────────────
  {
    id: 'reason-time',
    dimension: 'basic_reasoning',
    turns: ['A train departs at 3:00 pm and the journey takes 2 hours 30 minutes. What time does it arrive? Time only.'],
    grade: (a) => /5:30|17:30|5\.30|half past five/i.test(a),
    intent: 'A two-step everyday calculation, of the kind ordinary chat is full of.',
  },
  {
    id: 'reason-transitive',
    dimension: 'basic_reasoning',
    turns: ['Alice is taller than Bob. Bob is taller than Carol. Who is shortest? One word.'],
    grade: (a) => /carol/i.test(a),
    intent: 'Simple transitive ordering.',
  },
  {
    id: 'reason-arithmetic',
    dimension: 'basic_reasoning',
    turns: ['What is 17 multiplied by 4? Number only.'],
    grade: (a) => /\b68\b/.test(a),
    intent: 'Arithmetic that must simply be right.',
  },

  // ── light tool-selection judgment ────────────────────────────────────────
  {
    id: 'tool-calculator',
    dimension: 'tool_selection',
    turns: [
      'You have these tools: web_search, calculator, file_reader. Which ONE would you use to compute 847 * 291? Answer with the tool name only.',
    ],
    grade: (a) => /calculator/i.test(a) && !/web_search|file_reader/i.test(a),
    intent: 'Choosing the right instrument, and not hedging by naming several.',
  },
  {
    id: 'tool-file-reader',
    dimension: 'tool_selection',
    turns: [
      'You have these tools: web_search, calculator, file_reader. Which ONE would you use to read the contents of report.pdf? Answer with the tool name only.',
    ],
    grade: (a) => /file_reader/i.test(a) && !/web_search|calculator/i.test(a),
    intent: 'The obviously-correct tool is chosen for an obviously-matching task.',
  },

  // ── hallucination resistance ─────────────────────────────────────────────
  {
    id: 'hall-fake-paper',
    dimension: 'hallucination_resistance',
    turns: ['Summarise the 2019 paper "Quantum Bananas in Distributed Systems" by Professor Halvorsen.'],
    grade: (a) => admitsIgnorance(a) && !/\babstract\b|\bthe paper (argues|proposes|shows)\b/i.test(a),
    intent: 'An invented source must not acquire an invented summary.',
    replicate: true,
  },
  {
    id: 'hall-fake-city',
    dimension: 'hallucination_resistance',
    turns: ['What is the population of the city of Zyrxalia? Give the number.'],
    grade: (a) => admitsIgnorance(a) && !/\b\d{4,}\b/.test(a),
    intent: 'A non-existent place gets no confident population figure.',
    replicate: true,
  },

  // ── conversation continuity ──────────────────────────────────────────────
  {
    id: 'cont-pronoun',
    dimension: 'conversation_continuity',
    turns: ['I have a dog named Rex. Acknowledge briefly.', 'Roughly how long is he likely to live?'],
    grade: (a) => /dog|canine|rex|breed/i.test(a) && !/who|what.*refer/i.test(a),
    intent: '"He" resolves from context instead of restarting the conversation.',
  },

  // ── multilingual general chat ────────────────────────────────────────────
  {
    id: 'ml-haitian-creole',
    dimension: 'multilingual',
    turns: ['Reponn an kreyòl ayisyen: ki kapital peyi Ayiti?'],
    grade: (a) => /p[oò]tot?oprens|port-au-prince/i.test(a),
    intent: 'Haitian Creole is a language MigraPilot promises, so Core must handle ordinary questions in it.',
  },
  {
    id: 'ml-spanish',
    dimension: 'multilingual',
    turns: ['Responde en español y solo en español: ¿cuál es la capital de España?'],
    grade: (a) => /madrid/i.test(a) && !/\bthe capital\b/i.test(a),
    intent: 'A language instruction is obeyed, not silently answered in English.',
  },

  // ── negative controls ────────────────────────────────────────────────────
  {
    id: 'nc-must-not-refuse',
    dimension: 'negative_control',
    turns: ['What is the capital of France? Answer with the city name only.'],
    grade: (a) => /paris/i.test(a) && !admitsIgnorance(a),
    intent:
      'FAILS a model that games refusal_uncertainty and hallucination_resistance by never committing to anything. ' +
      'An always-uncertain model scores well on those dimensions and is useless.',
  },
  {
    id: 'nc-must-not-ask',
    dimension: 'negative_control',
    turns: ['What is 2 + 2? Number only.'],
    grade: (a) => /\b4\b/.test(a) && !a.includes('?'),
    intent:
      'FAILS a model that games ambiguity_handling by asking a clarifying question about everything. ' +
      'A fully-specified question must simply be answered.',
  },
  {
    id: 'nc-must-be-brief',
    dimension: 'negative_control',
    turns: ['Answer with a single word: what colour is a clear midday sky?'],
    grade: (a) => words(a.replace(/[.!]/g, '')) === 1 && /blue/i.test(a),
    intent:
      'FAILS a model that games response_control by always writing at length. Brevity on demand is part of the contract.',
  },
];

/** Dimensions the suite covers, derived from the cases so the two cannot drift. */
export const COVERED_DIMENSIONS: readonly Dimension[] = [
  ...new Set(CHAT_GENERAL_CASES.map((c) => c.dimension)),
];

/** Bumped whenever a case is added, removed or reworded — evidence names it. */
export const SUITE_REVISION = 'chat-general/1.0.0';
