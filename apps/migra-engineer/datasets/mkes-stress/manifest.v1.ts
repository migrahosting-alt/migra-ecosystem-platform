/**
 * MKES_STRESS manifest, version 1.
 *
 * ⚠ TRANSCRIPTS ARE NOT YET PRESENT. Every `referenceTranscript` is `null` with
 * `transcriptStatus: 'awaiting-author'`. The ten scripts were authored by Bonex
 * but have not reached this repository, so the slots are prepared and empty.
 *
 * They are NOT invented, and must not be. These ten utterances are the held-out
 * benchmark for Haitian Creole; a fabricated reference would silently become the
 * thing every future candidate is scored against. When the scripts arrive they
 * drop straight into these slots — as the WAV files will into `audio`.
 *
 * What IS recorded here is everything Bonex specified directly: the id→filename
 * binding, the evaluation focus, the entity/numeric/code-switch targets he
 * enumerated, and the transcript rules that protect each item's signal.
 */

import { bindAudio } from './audio-binding'
import type { MkesStressItem, MkesStressManifest } from './types'

const VERSION = '1.0.0-draft'

/** Consent as stated for this set. Voice cloning is withheld, always and explicitly. */
const CONSENT = {
  permitted: [
    'speech-recognition evaluation',
    'Haitian Creole capability benchmarking',
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
}

/** Applies to every item: the defaults an ASR pipeline would impose are wrong here. */
const BASE_RULES = [
  {
    rule: 'Preserve Haitian Creole orthography exactly as authored.',
    rationale:
      'Normalising to French-influenced spelling would erase the orthographic ' +
      'signal and make the reference disagree with how the speaker actually writes.',
  },
  {
    rule: 'Never alter the reference transcript to improve an ASR score.',
    rationale:
      'The reference is the ground truth. Editing it to match a recognizer ' +
      'measures nothing and destroys the benchmark.',
  },
]

const item = (
  id: string,
  filename: string,
  purpose: string,
  extra: Partial<MkesStressItem>,
): MkesStressItem => ({
  id,
  suite: 'MKES_STRESS',
  version: VERSION,
  language: 'ht',
  referenceTranscript: null,
  transcriptStatus: 'awaiting-author',
  // Authored slot, overlaid with measured facts when the WAV has arrived.
  audio: bindAudio(id, { filename, status: 'pending' }),
  purpose,
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

export const MANIFEST: MkesStressManifest = {
  suite: 'MKES_STRESS',
  version: VERSION,
  language: 'ht',
  createdAt: '2026-08-16',
  datasetRole: 'held-out-evaluation',
  items: [
    item('MKES_STRESS_001', 'MKES_STRESS_001_conversation.wav', 'Natural everyday conversation', {
      evaluationTags: ['conversation'],
      notes:
        'Recognition and meaning are machine-checkable. NATURALNESS IS NOT — it ' +
        'is human review, and must not be scored by another model.',
    }),

    item('MKES_STRESS_002', 'MKES_STRESS_002_places_names.wav', 'Haitian names, geography, named entities', {
      evaluationTags: ['named_entities', 'geography'],
      // Enumerated by the author. Haitian place names are routinely mangled into
      // their French forms (Jacmel, Cap-Haïtien, Gonaïves, Les Cayes, Jérémie);
      // the Creole surface form is what must survive.
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

    item('MKES_STRESS_003', 'MKES_STRESS_003_numbers_money.wav', 'Dates, time, quantities, currency', {
      evaluationTags: ['numbers', 'dates', 'currency'],
      // `value` is left absent: normalisation is the author's to state, not
      // mine to infer. Recording a guessed normalisation would make a derived
      // reading indistinguishable from ground truth.
      numericTargets: [
        { surface: 'Vandredi 21 dawout', kind: 'date' },
        { surface: 'twa zè nan apremidi', kind: 'time' },
        { surface: 'de bagay', kind: 'count' },
        { surface: 'mil senk san goud', kind: 'currency' },
        { surface: 'de mil goud', kind: 'currency' },
        { surface: 'senk san goud', kind: 'currency' },
      ],
    }),

    item('MKES_STRESS_004', 'MKES_STRESS_004_codeswitch_en.wav', 'Kreyòl + English code-switching', {
      evaluationTags: ['code_switch'],
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
            'recognizer can handle mixed-language input at all.',
        },
      ],
    }),

    item('MKES_STRESS_005', 'MKES_STRESS_005_codeswitch_fr.wav', 'Kreyòl + French code-switching', {
      evaluationTags: ['code_switch'],
      codeSwitchLanguages: ['fr'],
      transcriptRules: [
        ...BASE_RULES,
        {
          rule:
            "Preserve the French phrases as French: rendez-vous, pièce d'identité, " +
            'documents nécessaires, confirmé.',
          rationale:
            'Kreyòl and French are closely related, so a normaliser will happily ' +
            'collapse the utterance into one language. That is precisely the ' +
            'failure this item exists to detect.',
        },
      ],
    }),

    item('MKES_STRESS_006', 'MKES_STRESS_006_self_correction.wav', 'Hesitation and self-correction', {
      evaluationTags: ['self_correction'],
      transcriptRules: [
        ...BASE_RULES,
        {
          rule:
            'Preserve the full self-correction, including the mistaken statement ' +
            'and the repair: "... madi ... non, tann, se te mèkredi ...".',
          rationale:
            'A transcript that keeps only "mèkredi" is WRONG. Cleaning disfluency ' +
            'is the default behaviour of most pipelines and it deletes the entire ' +
            'phenomenon under test.',
        },
      ],
    }),

    item('MKES_STRESS_007', 'MKES_STRESS_007_instructions.wav', 'Ordered instructions / sequence', {
      evaluationTags: ['instruction_sequence'],
      notes:
        'Order is the measurement, not merely the words. Expected sequence: ' +
        'fèmen → dekonekte → tann → verifye → branche → limen → verifye pwoblèm. ' +
        'A transcript containing every verb in the wrong order is a failure.',
    }),

    item('MKES_STRESS_008', 'MKES_STRESS_008_prosody.wav', 'Prosody / expressive speech', {
      evaluationTags: ['prosody'],
      notes:
        'NO EMOTION LABEL IS RECORDED HERE. The intended expressive reading is an ' +
        'instruction to the speaker, not an observed acoustic fact, and text ' +
        'cannot evidence prosody. Acoustic evaluation is pending the WAV; until ' +
        'then only the text-level content is assessable.',
    }),

    item('MKES_STRESS_009', 'MKES_STRESS_009_culture.wav', 'Haitian culture and identity', {
      evaluationTags: ['culture'],
      notes:
        'Comprehension is tested WITHOUT assuming word-for-word translation. ' +
        'Culturally grounded expressions frequently have no literal English ' +
        'equivalent, and scoring against a literal gloss would penalise a correct ' +
        'reading.',
    }),

    item('MKES_STRESS_010', 'MKES_STRESS_010_context_reasoning.wav', 'Long-context reasoning', {
      evaluationTags: ['long_context_reasoning'],
      notes:
        'Measures whether the model uses the whole utterance rather than fixating ' +
        'on a single unknown token — the failure mode where one unfamiliar word ' +
        'derails an otherwise understood sentence.',
    }),
  ],
}

/** Items still waiting on their authored text. */
export const awaitingTranscript = (): MkesStressItem[] =>
  MANIFEST.items.filter((i) => i.transcriptStatus === 'awaiting-author')

/** Items still waiting on their recording. */
export const awaitingAudio = (): MkesStressItem[] =>
  MANIFEST.items.filter((i) => i.audio.status === 'pending')

/**
 * Is this set ready to score a candidate?
 *
 * False while any reference is missing. A partially-populated benchmark that
 * reports a number is how a benchmark starts lying.
 */
export const readyToEvaluateText = (): boolean => awaitingTranscript().length === 0
