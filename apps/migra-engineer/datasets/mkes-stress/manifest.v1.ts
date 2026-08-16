/**
 * MKES_STRESS manifest, version 1.
 *
 * ⚠ TRANSCRIPTS ARE NOT PRESENT. Every `referenceTranscript` is `null` with
 * `transcriptStatus: 'awaiting-author'`. The utterances were authored by Bonex
 * but have not reached this repository — the speech-source tree and the MKES
 * evaluations directory contain no script text.
 *
 * They are NOT invented. These are the held-out Haitian Creole benchmark; a
 * generated reference would silently become the ground truth every future
 * candidate is scored against, and it would look authored. The slots stay empty.
 *
 * What IS here: the case↔variant structure, the measured recordings, and every
 * target Bonex enumerated directly.
 */

import { SOURCE_DIRECTORY, recordingsFor } from './recordings'
import type { MkesAcousticControl, MkesStressCase, MkesStressManifest } from './types'

const VERSION = '1.1.0-draft'

const CONSENT = {
  permitted: [
    'speech-recognition evaluation',
    'Haitian Creole capability benchmarking',
    'acoustic robustness evaluation',
    'internal linguistic review',
  ],
  withheld: [
    'voice cloning / speech synthesis of this speaker',
    'redistribution outside MigraTeck',
    'training data (this set is held out — see datasetRole)',
  ],
}

const PROVENANCE = {
  author: 'Bonex Petit-Frere',
  authoredFor: 'MKES_STRESS — Haitian Creole capability stress set',
  sourceDirectory: SOURCE_DIRECTORY,
}

/** Applies to every case: the defaults an ASR pipeline imposes are wrong here. */
const BASE_RULES = [
  {
    rule: 'Preserve Haitian Creole orthography exactly as authored.',
    rationale:
      'Normalising toward French spelling erases the orthographic signal and ' +
      'makes the reference disagree with how the speaker actually writes.',
  },
  {
    rule: 'Never alter the reference transcript to improve an ASR score.',
    rationale: 'Editing ground truth to match a recognizer measures nothing.',
  },
  {
    rule: 'Review every take independently, even when variants share a reference.',
    rationale:
      'Two takes of one script are not one performance. A speaker hesitates, ' +
      'drops a word, or self-corrects on one take and not the other, and that ' +
      'deviation is data rather than an error to tidy away.',
  },
]

const speechCase = (
  id: string,
  purpose: string,
  extra: Partial<MkesStressCase>,
): MkesStressCase => ({
  id,
  kind: 'speech',
  suite: 'MKES_STRESS',
  version: VERSION,
  language: 'ht',
  referenceTranscript: null,
  transcriptStatus: 'awaiting-author',
  purpose,
  variants: recordingsFor(id),
  evaluationTags: [],
  codeSwitchLanguages: [],
  namedEntities: [],
  numericTargets: [],
  transcriptRules: BASE_RULES,
  provenance: PROVENANCE,
  consentScope: CONSENT,
  datasetRole: 'held-out-evaluation',
  trainingEligible: false,
  ...extra,
})

/** 011 is not speech. See `MkesAcousticControl` for why it is a separate type. */
const ROOM_SILENCE: MkesAcousticControl = {
  id: 'MKES_STRESS_011',
  kind: 'acoustic-control',
  suite: 'MKES_STRESS',
  version: VERSION,
  purpose: 'Room tone / noise floor — negative acoustic control',
  variants: recordingsFor('MKES_STRESS_011'),
  expectation: {
    speechDetected: false,
    // Null, not "". Expected to be empty, but nobody has listened yet, and
    // asserting the ground truth of a file we have not heard is exactly the
    // fabrication this catalogue refuses.
    transcript: null,
    hallucinatedSpeech: 'none',
    confirmedByHuman: false,
  },
  evaluationTags: ['acoustic_robustness'],
  provenance: PROVENANCE,
  consentScope: CONSENT,
  datasetRole: 'held-out-evaluation',
  trainingEligible: false,
  notes:
    'Tests voice-activity detection and false-positive transcription. Many ASR ' +
    'systems invent plausible words from room noise; a system that transcribes ' +
    'silence into fluent Kreyòl is broken in a way no accuracy metric on speech ' +
    'would reveal. WER against this file would be meaningless — the measurement ' +
    'is "did it produce anything at all".',
}

export const MANIFEST: MkesStressManifest = {
  suite: 'MKES_STRESS',
  version: VERSION,
  language: 'ht',
  createdAt: '2026-08-16',
  datasetRole: 'held-out-evaluation',
  sourceDirectory: SOURCE_DIRECTORY,
  entries: [
    speechCase('MKES_STRESS_001', 'Natural everyday conversation', {
      evaluationTags: ['conversation', 'acoustic_robustness'],
      notes:
        'Clean and phone variants share one utterance. Naturalness is human ' +
        'review — never scored by another model.',
    }),

    speechCase('MKES_STRESS_002', 'Haitian names, geography, named entities', {
      evaluationTags: ['named_entities', 'geography'],
      // Haitian place names are routinely rewritten into their French forms
      // (Jacmel, Cap-Haïtien, Gonaïves, Les Cayes, Jérémie). The Creole surface
      // form is what must survive recognition.
      namedEntities: [
        { surface: 'Bonex', type: 'PERSON' },
        { surface: 'Pòtoprens', type: 'PLACE' },
        { surface: 'Jakmèl', type: 'PLACE' },
        { surface: 'Okap', type: 'PLACE' },
        { surface: 'Gonayiv', type: 'PLACE' },
        { surface: 'Okay', type: 'PLACE' },
        { surface: 'Jeremi', type: 'PLACE' },
      ],
    }),

    speechCase('MKES_STRESS_003', 'Dates, time, quantities, currency', {
      evaluationTags: ['numbers', 'dates', 'currency'],
      // `value` deliberately absent: normalisation is the author's to state.
      // A guessed normalisation would be indistinguishable from ground truth.
      numericTargets: [
        { surface: 'Vandredi 21 dawout', kind: 'date' },
        { surface: 'twa zè nan apremidi', kind: 'time' },
        { surface: 'de bagay', kind: 'count' },
        { surface: 'mil senk san goud', kind: 'currency' },
        { surface: 'de mil goud', kind: 'currency' },
        { surface: 'senk san goud', kind: 'currency' },
      ],
    }),

    speechCase('MKES_STRESS_004', 'Kreyòl + English code-switching', {
      evaluationTags: ['code_switch', 'acoustic_robustness'],
      codeSwitchLanguages: ['en'],
      transcriptRules: [
        ...BASE_RULES,
        {
          rule:
            'Keep these English technical words in English as spoken: server, ' +
            'application, crash, check logs, restart service, system, online, ' +
            'debugging, problem.',
          rationale:
            'Haitian technical speech genuinely code-switches. Translating them ' +
            'into Creole produces a transcript nobody said and hides whether the ' +
            'recognizer handles mixed-language input at all.',
        },
      ],
      notes: 'Clean and noise variants share one utterance — code-switching under degraded audio.',
    }),

    speechCase('MKES_STRESS_005', 'Kreyòl + French code-switching', {
      evaluationTags: ['code_switch', 'acoustic_robustness'],
      codeSwitchLanguages: ['fr'],
      transcriptRules: [
        ...BASE_RULES,
        {
          rule:
            "Preserve the French phrases as French: rendez-vous, pièce d'identité, " +
            'documents nécessaires, confirmé.',
          rationale:
            'Kreyòl and French are close enough that a normaliser will collapse ' +
            'the utterance into one language — precisely the failure this detects.',
        },
      ],
      notes: 'Clean and phone variants share one utterance.',
    }),

    speechCase('MKES_STRESS_006', 'Hesitation and self-correction', {
      evaluationTags: ['self_correction'],
      transcriptRules: [
        ...BASE_RULES,
        {
          rule:
            'Preserve the full self-correction, mistake and repair together: ' +
            '"... madi ... non, tann, se te mèkredi ...".',
          rationale:
            'A transcript keeping only "mèkredi" is WRONG. Cleaning disfluency is ' +
            'the default in most pipelines and deletes the entire phenomenon.',
        },
      ],
    }),

    speechCase('MKES_STRESS_007', 'Ordered instructions / sequence', {
      evaluationTags: ['instruction_sequence'],
      notes:
        'Order is the measurement, not merely the words. Expected sequence: ' +
        'fèmen → dekonekte → tann → verifye → branche → limen → verifye pwoblèm. ' +
        'Every verb present in the wrong order is a failure.',
    }),

    speechCase('MKES_STRESS_008', 'Prosody / expressive speech', {
      evaluationTags: ['prosody'],
      notes:
        'NO EMOTION LABEL IS RECORDED. The intended expressive reading is an ' +
        'instruction to the speaker, not an observed acoustic fact. Prosody is ' +
        'evidenced by listening to the recording, not by reading the text.',
    }),

    speechCase('MKES_STRESS_009', 'Haitian culture and identity', {
      evaluationTags: ['culture'],
      notes:
        'Comprehension WITHOUT assuming word-for-word translation. Culturally ' +
        'grounded expressions often have no literal English equivalent, and ' +
        'scoring against a literal gloss would penalise a correct reading.',
    }),

    speechCase('MKES_STRESS_010', 'Long-context reasoning', {
      evaluationTags: ['long_context_reasoning', 'acoustic_robustness'],
      notes:
        'Whether the model uses the whole utterance rather than fixating on one ' +
        'unknown token. Clean and distance variants share one utterance.',
    }),

    ROOM_SILENCE,
  ],
}

export const speechCases = (): MkesStressCase[] =>
  MANIFEST.entries.filter((e): e is MkesStressCase => e.kind === 'speech')

export const awaitingTranscript = (): MkesStressCase[] =>
  speechCases().filter((c) => c.transcriptStatus === 'awaiting-author')

export const unreviewedTakes = (): { id: string; filename: string }[] =>
  MANIFEST.entries.flatMap((e) =>
    e.variants.filter((v) => v.review === 'not-reviewed').map((v) => ({ id: e.id, filename: v.filename })),
  )

/**
 * Can this set score a candidate yet?
 *
 * False while any reference is missing. A partially-populated benchmark that
 * still reports a number is how a benchmark starts lying.
 */
export const readyToEvaluateText = (): boolean => awaitingTranscript().length === 0
