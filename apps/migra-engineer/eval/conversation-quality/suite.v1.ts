/**
 * Conversation-quality suite, version 1.
 *
 * These are the conversations an ordinary person has on their first day with an
 * AI product. Nothing here is an engineered acceptance string, because the
 * failure this suite exists to catch was invisible to engineered strings and
 * obvious to a human typing two words.
 *
 * Versioned deliberately: a promotion record must name the suite version it was
 * measured against, or "passed the eval" means nothing six months from now.
 */

import type { EvalCase } from './types'
import {
  avoids,
  citesOnlyOwnedFiles,
  isShort,
  mentions,
  nonEmpty,
  notAnEngineeringPersona,
  notIn,
  refusesOrOmits,
  repliesIn,
} from './checks'

export const SUITE_VERSION = 'conversation-quality@1.0.0'

export const CASES: EvalCase[] = [
  // ── the incident ──────────────────────────────────────────────────────────
  {
    id: 'ht-sak-pase',
    capability: 'haitian_creole',
    prompt: 'sak pase?',
    note:
      'THE CANONICAL REGRESSION. Found by a human, not by any test. Production ' +
      'answered this in INDONESIAN ("Tentu, Anda bisa melanjutkan!"). Earlier ' +
      'still, it read short messages as filenames or paths.',
    assertions: [
      nonEmpty,
      notIn('indonesian'),
      repliesIn('haitian_creole'),
      notAnEngineeringPersona,
      avoids('filename', 'file name', 'path', 'typo', 'did you mean'),
    ],
    humanReview:
      'Is this natural, grammatical Haitian Creole that a Haitian speaker would ' +
      'actually say back — e.g. "Mwen la! Kijan ou ye?" — rather than word salad?',
  },
  {
    id: 'ht-kijan-ou-ye',
    capability: 'haitian_creole',
    prompt: 'Bonjou! Kijan ou ye jodi a?',
    assertions: [nonEmpty, repliesIn('haitian_creole'), notIn('indonesian')],
    humanReview: 'Grammatical, natural Creole? Does it actually answer how it is doing?',
  },
  {
    id: 'ht-capability-question',
    capability: 'haitian_creole',
    prompt: 'Ki sa ou ka fè?',
    assertions: [nonEmpty, repliesIn('haitian_creole'), notAnEngineeringPersona],
    humanReview: 'Does it describe general help in fluent Creole, not a coding tool?',
  },
  {
    id: 'ht-writing-task',
    capability: 'haitian_creole',
    prompt: 'Ede m ekri yon ti mesaj pou envite zanmi m nan yon fèt samdi.',
    assertions: [nonEmpty, repliesIn('haitian_creole')],
    humanReview: 'Is the invitation itself usable Creole a person would send?',
  },

  // ── identity ──────────────────────────────────────────────────────────────
  {
    id: 'identity-en',
    capability: 'identity',
    prompt: 'who are you?',
    note: 'Production answered "a coding assistant designed to work within your local workspace".',
    assertions: [nonEmpty, repliesIn('english'), notAnEngineeringPersona],
  },
  {
    id: 'identity-fr',
    capability: 'identity',
    prompt: 'Bonjour, peux-tu te présenter en une phrase ?',
    note: 'Production answered "un assistant de codage conscient de l\'espace de travail".',
    assertions: [nonEmpty, repliesIn('french'), notAnEngineeringPersona],
  },
  {
    id: 'identity-capabilities',
    capability: 'identity',
    prompt: 'what can you help me with?',
    assertions: [nonEmpty, repliesIn('english'), notAnEngineeringPersona],
    humanReview: 'Does it read as a broad everyday assistant rather than a developer tool?',
  },

  // ── greetings and small talk ──────────────────────────────────────────────
  {
    id: 'greet-en',
    capability: 'general_chat',
    prompt: 'hey there',
    assertions: [nonEmpty, repliesIn('english'), isShort(320)],
  },
  {
    id: 'greet-morning',
    capability: 'general_chat',
    prompt: 'good morning',
    assertions: [nonEmpty, repliesIn('english'), isShort(320)],
  },
  {
    id: 'greet-fr',
    capability: 'french',
    prompt: 'salut',
    assertions: [nonEmpty, repliesIn('french'), isShort(320)],
  },

  // ── ambiguous short turns ────────────────────────────────────────────────
  {
    id: 'ambiguous-ok',
    capability: 'ambiguous_turn',
    prompt: 'ok',
    assertions: [nonEmpty, isShort(320), avoids('filename', 'path', 'command')],
    humanReview: 'Does it respond like a person, rather than demanding clarification?',
  },
  {
    id: 'ambiguous-followup',
    capability: 'ambiguous_turn',
    prompt: 'tell me more',
    history: [
      { role: 'user', content: 'Give me one interesting fact about honey.' },
      { role: 'assistant', content: 'Honey never spoils — edible honey has been found in ancient tombs.' },
    ],
    assertions: [nonEmpty, repliesIn('english'), mentions('honey', 'bee')],
    note: 'Follow-up must use conversation context, not restart.',
  },

  // ── general knowledge ─────────────────────────────────────────────────────
  {
    id: 'knowledge-achebe',
    capability: 'general_knowledge',
    prompt: 'Who wrote the novel Things Fall Apart?',
    assertions: [nonEmpty, mentions('Achebe')],
  },
  {
    id: 'knowledge-capital',
    capability: 'general_knowledge',
    prompt: 'What is the capital of Haiti?',
    assertions: [nonEmpty, mentions('Port-au-Prince', 'Pòtoprens')],
  },

  // ── writing ───────────────────────────────────────────────────────────────
  {
    id: 'writing-warmer',
    capability: 'writing',
    prompt: 'Rewrite this to be warmer: "Your request has been denied."',
    assertions: [nonEmpty, repliesIn('english'), avoids('denied.')],
    humanReview: 'Is the rewrite actually warmer and usable?',
  },
  {
    id: 'writing-invitation',
    capability: 'writing',
    prompt: 'Write a short birthday invitation for my daughter turning 7.',
    assertions: [nonEmpty, repliesIn('english'), notAnEngineeringPersona],
    humanReview: 'Would a parent send this as-is?',
  },
  {
    id: 'writing-fr-email',
    capability: 'french',
    prompt: "Écris un court email professionnel pour reporter une réunion à jeudi.",
    assertions: [nonEmpty, repliesIn('french')],
    humanReview: 'Is the French idiomatic and appropriately formal?',
  },

  // ── learning ──────────────────────────────────────────────────────────────
  {
    id: 'learning-child',
    capability: 'learning',
    prompt: 'Explain photosynthesis to a 10 year old in 2 sentences.',
    assertions: [nonEmpty, repliesIn('english'), isShort(700)],
  },
  {
    id: 'learning-beginner',
    capability: 'learning',
    prompt: 'I have never used a spreadsheet. Where do I start?',
    assertions: [nonEmpty, repliesIn('english'), notAnEngineeringPersona],
  },

  // ── brainstorming ─────────────────────────────────────────────────────────
  {
    id: 'brainstorm-names',
    capability: 'brainstorming',
    prompt: 'Give me 5 name ideas for a small bakery in Port-au-Prince.',
    assertions: [nonEmpty, repliesIn('english')],
    humanReview: 'Are the ideas plausible and culturally sensible?',
  },

  // ── language switching ────────────────────────────────────────────────────
  {
    id: 'switch-en-to-fr',
    capability: 'language_switching',
    prompt: 'Peux-tu répondre en français maintenant ?',
    history: [
      { role: 'user', content: 'What is 2 + 2?' },
      { role: 'assistant', content: '2 + 2 = 4.' },
    ],
    assertions: [nonEmpty, repliesIn('french')],
  },
  {
    id: 'switch-fr-to-ht',
    capability: 'language_switching',
    prompt: 'Koulye a, ann pale kreyòl. Kijan ou ye?',
    history: [
      { role: 'user', content: 'Bonjour, comment vas-tu ?' },
      { role: 'assistant', content: 'Je vais bien, merci ! Comment puis-je vous aider ?' },
    ],
    assertions: [nonEmpty, repliesIn('haitian_creole')],
    humanReview: 'Did it switch cleanly to Creole and stay there?',
  },
  {
    id: 'switch-ht-to-en',
    capability: 'language_switching',
    prompt: 'Can you switch to English now?',
    history: [
      { role: 'user', content: 'Bonjou, kijan ou ye?' },
      { role: 'assistant', content: 'Mwen byen, mèsi! Kijan mwen ka ede w?' },
    ],
    assertions: [nonEmpty, repliesIn('english')],
  },

  // ── coding still works ────────────────────────────────────────────────────
  {
    id: 'code-reverse-list',
    capability: 'software_engineering',
    prompt: 'In Python, how do I reverse a list?',
    assertions: [nonEmpty, mentions('reverse', '[::-1]')],
  },
  {
    id: 'code-explain-error',
    capability: 'software_engineering',
    prompt: 'Why would a React useEffect run forever?',
    assertions: [nonEmpty, mentions('dependency', 'dependencies')],
  },

  // ── grounded documents and refusal integrity ─────────────────────────────
  {
    id: 'grounded-freeze-time',
    capability: 'document_retrieval',
    prompt: 'When does the database freeze begin?',
    grounded: true,
    assertions: [nonEmpty, mentions('02:00'), citesOnlyOwnedFiles],
    note: 'Answerable only from the uploaded migration-notes.md.',
  },
  {
    id: 'grounded-no-invention',
    capability: 'refusal_integrity',
    prompt: 'Summarise my uploaded documents and list every action item.',
    grounded: true,
    note:
      'Production invented a whole document for this shape of request: ' +
      '`user_sessions` tables, a Stripe v3 migration, Amplitude webhooks, ' +
      '`scripts/migrate_data.py`. None existed. Refusing is a PASS.',
    assertions: [
      nonEmpty,
      refusesOrOmits('user_sessions', 'Stripe', 'Amplitude', 'migrate_data.py', 'Mixpanel'),
      citesOnlyOwnedFiles,
    ],
  },
]
