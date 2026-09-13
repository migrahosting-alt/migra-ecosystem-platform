/**
 * "CAN YOU …?" IS A QUESTION ABOUT THE PRODUCT, NOT A QUESTION FOR THE MODEL.
 *
 * ---------------------------------------------------------------------------
 * 🚨 WHAT THIS EXISTS TO STOP — TEN MEASURED ANSWERS
 *
 * Asked on staging `3c204aa8`, every one answered from the model's priors while
 * the action hub two centimetres away stated the truth correctly:
 *
 *   "Can you search the web for today's news?"
 *     → "I can scour the web for news articles relevant to today's date."
 *        There is no search provider. It cannot.
 *
 *   "Can you read a PDF if I attach one?"
 *     → "I do not have the ability to directly access or read files."
 *        It had just read one, with page citations.
 *
 *   "Can you look at an image and tell me what is in it?"
 *     → "I'm a text-based AI and don't have the ability to look at images."
 *        There is a governed vision route; it is blocked on an approval.
 *
 *   "Can you remember what we discussed yesterday?"
 *     → "I'm a stateless AI, each interaction starts from scratch."
 *        Conversations are durable in PostgreSQL and were proven so.
 *
 *   "Can you transcribe an audio recording?"
 *     → "I can process WAV or MP3 files. Please share the audio file."
 *        There is no speech runtime. The composer's own Dictate button says so.
 *
 * Wrong in BOTH directions: offering what does not exist, denying what does.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE SAME RULE AS ATTACHMENT LISTS, ON A NEW SURFACE
 *
 * A fact the system holds as typed data must reach the user as typed data
 * rendered by code. Capability state IS such a fact: the registry knows it,
 * each entry carries the authority's own sentence, and the product already
 * renders it into a menu. Asking an 8B model to restate it can only introduce
 * a difference.
 *
 * ---------------------------------------------------------------------------
 * 🚨 FOUR STATES, BECAUSE "NO" HIDES THE DIFFERENCE THAT MATTERS
 *
 * "Can you see images?" answered "no" is useless. The true answers are:
 *
 *   available        it works now
 *   blocked          built and supported; an approval or configuration is
 *                    missing, and someone can act on that
 *   not-configured   registered, no provider behind it on this deployment
 *   unavailable      not offered at all
 *
 * `blocked` and `not-configured` both render as "no" to a user and are
 * completely different facts to an operator.
 */

/** A subject a person can ask about. Not a capability id — several map to one. */
export type PlatformTopic =
  | 'web-search'
  | 'documents'
  | 'images'
  | 'audio'
  | 'memory'
  | 'files'
  | 'email'
  | 'code-execution'
  | 'image-generation'
  | 'overview'

export type PlatformCapabilityState = 'available' | 'blocked' | 'not-configured' | 'unavailable'

export interface PlatformCapabilityFact {
  topic: PlatformTopic
  /** How the product names this to a person. */
  label: string
  state: PlatformCapabilityState
  /**
   * The authority's own sentence where one exists, or a code-owned one.
   * Never generated: this is the text that must not be re-authored.
   */
  detail: string
}

/**
 * What the authorities say right now.
 *
 * Passed in, never fetched here, so this module stays pure and the same facts
 * that drew the menu are the facts that answer the question. A second source
 * would be a second opinion, which is how a menu and an answer start
 * disagreeing.
 */
export interface PlatformCapabilitySnapshot {
  /** Files, library and durable history are authenticated-only. */
  signedIn: boolean
  /** The engine's registry. `null` means it did not answer — NOT "empty". */
  registry: ReadonlyArray<{ id: string; available: boolean; unavailableReason?: string }> | null
  /** The vision gate's own verdict. */
  vision: { state: string; message: string } | null
  /** The speech runtime's own verdict. */
  speech: { state: string; reason?: string } | null
  /**
   * The attachment authority's own numbers.
   *
   * 🚨 PASSED IN, NOT RETYPED HERE. "What are the limits on the files I can
   * attach?" is one of the question families this layer owns, and it was
   * answering with a capability that named no limit at all — true, and not an
   * answer. A constant copied into this file would be a second opinion that
   * drifts the first time the env var changes.
   */
  limits?: { maxFileBytes?: number; maxFiles?: number; maxExtractBytes?: number }
}

/* ------------------------------------------------------------------ *
 * Recognising the question — a classifier, not a list of phrases
 * ------------------------------------------------------------------ *
 *
 * 🚨 WHY THIS IS NO LONGER PHRASE-MATCHED
 *
 * The first version recognised self-referential PHRASES ("can you", "do you
 * have"). Owner validation on staging broke it in a single sitting with two
 * ordinary questions it had never been shown:
 *
 *   "Will you remember this conversation after the service restarts?"
 *     → the model answered "I do not maintain a persistent memory of
 *        individual conversations between service restarts … each conversation
 *        is ephemeral." Conversations are durable in PostgreSQL.
 *
 *   "What audio or transcription support is currently available?"
 *     → the model invented "Audio Playback — MP3, WAV, AAC. Text-to-Speech.
 *        Speech-to-Text. Transcription Services: integration with third-party
 *        tools." None of that exists on any deployment.
 *
 * Rephrased as "Do you remember previous conversations after a restart?" the
 * first one produced the correct capability-owned answer — so the mechanism
 * was right and only the detector was wrong. Adding those two strings would
 * have fixed exactly those two strings.
 *
 * THE INVARIANT THIS LAYER IMPLEMENTS:
 *
 *   Any question whose factual answer is about MigraPilot's own current
 *   capabilities, configuration, availability, persistence, limits or
 *   supported modalities must resolve from authoritative capability state
 *   before model commentary is allowed. The model may explain the facts; it
 *   must never originate them.
 *
 * THREE INDEPENDENT AXES, ALL THREE REQUIRED:
 *
 *   SUBJECT  is this about THIS product? — explicitly ("you", "MigraPilot",
 *            "this service"), or implicitly by asking whether a feature is
 *            supported / enabled / configured / currently available, which is
 *            a property only a system has.
 *   FACET    is it asking about STATE rather than about the world? — ability,
 *            availability, persistence, current-state, configuration, limits,
 *            modality, negative/indirect.
 *   TOPIC    which capability.
 *
 * Requiring all three is what keeps ordinary knowledge ordinary. "How does
 * computer memory work?" and "What audio format is best for podcasts?" both
 * name a capability noun and neither is a capability question: no self
 * subject, and the facet is explanation and advice, not state.
 */

/** The question family a prompt belongs to. Several can apply at once. */
export type CapabilityFacet =
  | 'ability'
  | 'availability'
  | 'persistence'
  | 'current-state'
  | 'configuration'
  | 'limits'
  | 'modality'
  | 'negative-indirect'

/** Who the question is about. */
export type CapabilitySubject = 'self-explicit' | 'self-implicit' | 'none'

export interface CapabilityIntent {
  subject: CapabilitySubject
  facets: CapabilityFacet[]
  topics: PlatformTopic[]
  /**
   * `high`   a topic resolved — answer from capability state.
   * `low`    it is a question about this product, but which capability is not
   *          safely classifiable. DO NOT fabricate and do not guess a topic:
   *          the model answers, exactly as it would for ordinary prose.
   * `none`   not a capability question at all.
   */
  confidence: 'high' | 'low' | 'none'
  /** Why, in one phrase — for evidence records and for debugging a miss. */
  reason: string
}

/* ── axis 1: subject ─────────────────────────────────────────────────── */

/** Names this product, the assistant, or the deployment it runs on. */
const SELF_REFERENCE =
  /\byou\b|\byour\b|\byou'?(?:re|ve|ll|d)\b|\bmigrapilot\b|\bthis\s+(?:assistant|ai|app|chat|tool|product|service|system|platform|deployment|server|instance)\b|\bthe\s+(?:assistant|app|chat|service|system|platform|deployment|product|server)\b/i

/**
 * Implicit self-reference: a state predicate applied to a feature.
 *
 * "Is X supported?", "What X support is currently available?" — nothing but a
 * system HAS a feature that is supported, enabled or configured, and in a chat
 * with no other named system that system is this one. This is the route that
 * carries "What audio or transcription support is currently available?", which
 * never says "you" at all.
 */
const FEATURE_STATE_FRAMES: readonly RegExp[] = [
  /\b(?:is|are|does|do|has|have)\b[^?.!]{0,60}?\b(?:available|enabled|disabled|configured|set\s*up|supported|turned\s+(?:on|off)|switched\s+(?:on|off)|active|working|live|offered|installed|connected|approved|allowed|permitted|granted|hooked\s+up)\b/i,
  /\b(?:what|which|how\s+much|how\s+many)\b[^?.!]{0,80}?\b(?:support|capabilit(?:y|ies)|features?|limits?|formats?|file\s*types?|modalities)\b[^?.!]{0,60}?\b(?:available|supported|enabled|configured|currently|offered|exist|in\s+place|there)\b/i,
  /\bis\s+there\b[^?.!]{0,60}?\b(?:support|a\s+way|an\s+option|any\s+way)\b/i,
  /\b(?:currently|right\s+now|at\s+the\s+moment|as\s+of\s+now|on\s+this\s+(?:server|deployment|instance|machine))\b[^?.!]{0,60}?\b(?:available|supported|enabled|configured|set\s*up|working|offered)\b/i,
  // Persistence of the user's own data is a property of the system holding it.
  /\b(?:is|are|does|do|will|can)\b[^?.!]{0,60}?\b(?:retained|kept|saved|stored|persist\w*|preserved|remembered|survives?)\b/i,
  // "Does X work here?" — but never "HOW does X work", which is an explanation.
  /\b(?:does|do|is|are)\b[^?.!]{0,40}?\bworks?\s+(?:yet|now|here|at\s+all)\b/i,
  // "Is X … yet?" — "yet" asks about a state that is expected to change.
  /\b(?:is|are|does|do|has|have|can)\b[^?.!]{0,50}?\byet\b/i,
  // "What are the limits on …?" — a limit belongs to whatever enforces it.
  /\b(?:what|which)\s+(?:is\s+|are\s+)?(?:the\s+)?(?:limits?|limitations?|restrictions?|maximum|max|biggest|largest|longest)\b/i,
  // "How many files can I keep?" — "can I" plus a verb only this product
  // performs is a question about what this product permits.
  /\bhow\s+(?:many|much|large|big|long)\b[^?.!]{0,60}?\b(?:can|may)\s+i\s+(?:keep|store|upload|attach|send|save|add)\b/i,
]

/**
 * Another vendor is named, so an implicit "is it supported?" is about THEM.
 * Only applied to implicit subjects: "can you do what ChatGPT does?" is still
 * a question about this product.
 */
const OTHER_PRODUCT =
  /\b(?:chatgpt|gpt-?[0-9]|openai|claude|gemini|bard|copilot|cursor|notion|slack|excel|word|powerpoint|photoshop|acrobat|adobe|google\s+docs|microsoft|salesforce|dropbox|google\s+drive|onedrive|icloud|sharepoint|box\.com|s3|github|gitlab|jira|trello|zoom|teams|discord|whatsapp)\b/i

/* ── axis 2: facet ───────────────────────────────────────────────────── */

const FACET_PATTERNS: ReadonlyArray<{ facet: CapabilityFacet; pattern: RegExp }> = [
  {
    facet: 'ability',
    pattern:
      /\b(?:can|could|will|would)\s+(?:you|it|this|migrapilot)\b|\bare\s+you\s+able\b|\bable\s+to\b|\bcapable\s+of\b|\bis\s+it\s+possible\b|\bdo(?:es)?\s+(?:you|it|this|migrapilot)\s+(?:support|handle|allow|do|offer)\b|\bdo\s+you\s+have\b/i,
  },
  {
    facet: 'availability',
    pattern:
      /\b(?:available|availability|enabled|disabled|turned\s+(?:on|off)|switched\s+(?:on|off)|active|offered|supported|support)\b|\bis\s+there\b|\bdo\s+i\s+have\s+access\b|\bworks?\s+(?:yet|now|here|at\s+all)\b|\bworking\b|\bapproved\b|\ballowed\b|\bpermitted\b|\bgranted\b/i,
  },
  {
    facet: 'persistence',
    pattern:
      /\b(?:remember|remembers|remembering|recall|recalls|forget|forgets|persist\w*|retain\w*|kept|keeps?|saved|stored|survive\w*)\b|\bcarry\s+over\b|\bbetween\s+sessions\b|\bacross\s+sessions\b|\bafter\s+(?:a\s+|the\s+|it\s+)?\w*\s*(?:restarts?|reboots?|reloads?|refreshes)\b|\bnext\s+time\b/i,
  },
  {
    facet: 'current-state',
    pattern: /\b(?:currently|right\s+now|at\s+the\s+moment|as\s+of\s+now|status|state\s+of|so\s+far)\b/i,
  },
  {
    facet: 'configuration',
    pattern:
      /\b(?:configured|configuration|set\s*up|setup|installed|provisioned|connected|credentials)\b|\bhooked\s+up\b|\bapi\s+key\b|\benvironment\s+variable\b/i,
  },
  {
    facet: 'limits',
    pattern: /\b(?:limits?|limitations?|restrictions?|maximum|max|cap|quota|biggest|largest|longest)\b|\bhow\s+(?:large|big|many|much|long)\b/i,
  },
  {
    facet: 'modality',
    pattern: /\b(?:file\s*types?|formats?|modalit\w*)\b|\bkinds?\s+of\s+(?:files?|input|content)\b|\bwhat\s+sorts?\s+of\b/i,
  },
  {
    facet: 'negative-indirect',
    pattern:
      /\b(?:can'?t|cannot|unable|won'?t|doesn'?t|don'?t|isn'?t|aren'?t)\b|\bno\s+longer\b|\bi\s+thought\s+you\s+(?:could|had)\b|\byou\s+said\s+you\s+could\b|\bwhy\s+(?:can'?t|won'?t|doesn'?t|isn'?t)\b/i,
  },
]

/**
 * Facets that are about the STATE of the deployment rather than about what is
 * being asked for. One of these present means the question survives the
 * explanation and advice guards below — "is your web search configured?" is a
 * status question even though it reads like a request for an explanation.
 */
const STATUS_FACETS: ReadonlySet<CapabilityFacet> = new Set<CapabilityFacet>([
  'availability',
  'persistence',
  'current-state',
  'configuration',
  'limits',
  'modality',
])

/* ── the guards: what is NOT a capability question ───────────────────── */

/** Asking how something works, or what something is. A subject, not a state. */
const EXPLANATION_FRAME =
  /\bhow\s+(?:does|do|did|would|can|is|are)\b[^?.!]{0,80}\bwork(?:s|ed|ing)?\b|\bexplain\b|\btell\s+me\s+about\b|\bwhat\s+(?:is|are|was|were)\s+(?:a|an|the)\b|\bdifference\s+between\b|\bunder\s+the\s+hood\b|\bhow\s+do\s+i\b|\bteach\s+me\b/i

/** Asking which is better. An opinion about the world, never about this server. */
const ADVICE_FRAME =
  /\b(?:best|better|worst|recommend\w*|prefer\w*|advice|tips?|versus)\b|\bshould\s+i\b|\bwhich\s+should\b|\bworth\s+(?:it|using)\b|\bpros\s+and\s+cons\b|\bvs\.?\b/i

/**
 * A request to PRODUCE something. "Can you write a Python script to parse this
 * CSV?" names a document format and is not a question about document support;
 * the CSV is the object of a subordinate clause, not the subject of the ask.
 */
const TASK_REQUEST =
  /\b(?:write|writing|create|creating|build|building|implement|draft|compose|refactor|debug|fix|translate|rewrite|generate)\b(?:\s+\w+){0,4}?\s+(?:a|an|the|some|me|my)?\s*(?:python|javascript|typescript|java|sql|bash|shell|rust|go|css|html|react)?\s*(?:scripts?|functions?|programs?|code|snippets?|quer(?:y|ies)|regexe?s?|class(?:es)?|methods?|modules?|components?|tests?|essays?|poems?|letters?|articles?|plans?|outlines?)\b/i

/**
 * …unless the same sentence asks to RUN it or to take an ATTACHMENT, which are
 * themselves capability questions. "Can you write and run code for me?" is a
 * question about execution with a production verb in front of it.
 */
const STRONG_CAPABILITY_FRAME =
  /\b(?:run|runs|running|execute|executes|executing)\s+(?:it|them|the|this|that|a|my|some|code|scripts?|commands?|programs?)\b|\battach(?:ed|ing|ment|ments)?\b|\bupload(?:ed|ing|s)?\b/i

/* ── axis 3: topic ───────────────────────────────────────────────────── */

/**
 * Topic patterns name the FEATURE, not the interaction. The subject and facet
 * axes already carry the "is this about state" question, so these do not have
 * to encode a verb list — which is what made the first version miss every
 * paraphrase that did not use one of its verbs.
 */
const TOPIC_PATTERNS: ReadonlyArray<{ topic: PlatformTopic; pattern: RegExp }> = [
  {
    topic: 'image-generation',
    pattern:
      /\b(?:generate|generating|create|creating|make|making|draw|drawing|paint|painting|render|rendering|produce|producing)\s+(?:me\s+)?(?:an?\s+|some\s+|the\s+)?(?:images?|pictures?|photos?|illustrations?|logos?|artwork|drawings?)\b|\bimage\s+generation\b|\btext[-\s]to[-\s]image\b|\bdall[-\s]?e\b|\bstable\s+diffusion\b|\bmidjourney\b/i,
  },
  {
    topic: 'images',
    pattern:
      /\b(?:images?|pictures?|photos?|photographs?|screenshots?|diagrams?|charts?|graphs?)\b|\bvision\b|\bvisually\b|\bmultimodal\b|\bocr\b/i,
  },
  {
    topic: 'documents',
    pattern:
      /\b(?:pdfs?|docx?|documents?|spreadsheets?|csv|xlsx|attachments?|attach(?:ed|ing)?|markdown)\b|\bfile\s*types?\b|\bfile\s*formats?\b|\btext\s+files?\b|\bfiles?\b[^?.!]{0,25}?\b(?:can\s+i|i\s+can)\s+(?:upload|attach|send|read)\b/i,
  },
  {
    topic: 'audio',
    pattern:
      /\b(?:audio|voice|speech|transcri\w*|recordings?|microphones?|mic|dictat\w*|stt|tts|spoken|listen)\b|\btext[-\s]to[-\s]speech\b|\bspeech[-\s]to[-\s]text\b/i,
  },
  {
    topic: 'memory',
    pattern:
      /\b(?:remember|remembers|remembering|recall|recalls|forget|forgets|memory|persist\w*|retain\w*)\b|\bconversation\s+history\b|\bchat\s+history\b|\b(?:previous|earlier|past|prior|last)\s+(?:conversations?|chats?|sessions?|messages?)\b|\bmy\s+(?:chats?|conversations?)\b|\bwe\s+(?:talked|discussed|spoke)\b|\brecord\s+of\s+(?:our|this|the)\b|\btranscripts?\s+of\s+(?:our|this|the)\b|\bbetween\s+sessions\b|\bacross\s+sessions\b/i,
  },
  {
    topic: 'files',
    pattern:
      /\bmy\s+(?:files?|computer|drive|machine|laptop|uploads?|hard\s+drive)\b|\blocal\s+files?\b|\bfile\s+system\b|\bfilesystem\b|\bfile\s+library\b|\buploaded\s+files?\b|\b(?:open|access|read|see|get|browse|keep|store|upload|save)\s+(?:a\s+|the\s+|many\s+)?files?\b|\bhow\s+many\s+files?\b|\bfiles?\b[^?.!]{0,25}?\b(?:can\s+i|i\s+can)\s+(?:keep|store|save)\b/i,
  },
  { topic: 'email', pattern: /\b(?:e-?mails?|inbox|gmail|mailbox)\b|\bmail\s+account\b/i },
  {
    topic: 'code-execution',
    pattern:
      /\b(?:run|runs|running|execute|executes|executing)\s+(?:it|them|the|this|that|a|my|some)?\s*(?:code|scripts?|commands?|programs?|python|bash|shell|sql)\b|\bterminal\b|\bshell\s+(?:command|access)\b|\bcode\s+execution\b|\bsandbox\b/i,
  },
  {
    topic: 'web-search',
    pattern:
      /\bweb\s*search\b|\bsearch(?:ing)?\s+(?:the\s+)?(?:web|internet|online)\b|\bbrows(?:e|ing)\s+(?:the\s+)?(?:web|internet)\b|\bgoogle\b|\binternet\s+access\b|\bonline\s+(?:search|sources?)\b|\blook\s+(?:it\s+|things\s+|that\s+)?up\s+(?:online|on\s+the\s+web)\b|\bcurrent\s+(?:news|events)\b|\btoday'?s\s+news\b|\breal[-\s]time\s+(?:information|data|web)\b/i,
  },
]

/**
 * A capability noun used in its ordinary-world sense.
 *
 * "memory" and "audio" are the two that collide hardest: computer memory and
 * audio formats are ordinary subjects. Each pair is "the domain sense" plus
 * "the signal that overrides it", and the override wins — "What audio or
 * transcription support is currently available?" says transcription, so it is
 * about this product no matter how many format words surround it.
 */
const DOMAIN_SENSE: Partial<Record<PlatformTopic, { domain: RegExp; override: RegExp }>> = {
  memory: {
    domain:
      /\b(?:computer|ram|vram|gpu|cpu|virtual|physical|shared|cache|heap|stack|muscle)\s+memory\b|\bmemory\s+(?:management|leaks?|allocation|address|usage|model|bandwidth|chips?)\b|\bmemory\s+(?:in|of)\s+(?:a\s+)?(?:computer|cpu|gpu|program)\b/i,
    override:
      /\b(?:remember|remembers|remembering|recall|recalls|forgets?|persist\w*)\b|\bconversation\s+history\b|\bchat\s+history\b|\b(?:previous|earlier|past|prior|last)\s+(?:conversations?|chats?|sessions?)\b|\bbetween\s+sessions\b|\bacross\s+sessions\b/i,
  },
  audio: {
    domain:
      /\b(?:codecs?|bitrates?|sample\s+rate|mixing|mastering|podcasts?|mp3|wav|flac|aac|ogg)\b|\baudio\s+(?:formats?|quality|compression|engineering|interface|editing)\b/i,
    override:
      /\btranscri\w*\b|\bdictat\w*\b|\bmicrophones?\b|\bvoice\s+notes?\b|\bspeech[-\s]to[-\s]text\b|\bstt\b/i,
  },
}

/** Asking about the product as a whole. */
const OVERVIEW_FRAME =
  /\bwhat\s+(?:else\s+)?can\s+(?:you|migrapilot|it|this)\b|\bwhat\s+are\s+you\s+(?:able\s+to\s+do|capable\s+of)\b|\bwhat\s+are\s+your\s+capabilities\b|\bwhat\s+capabilities\b|\bwhat\s+features\b|\bwhat\s+do\s+you\s+support\b|\blist\s+your\s+capabilities\b/i

/* ── the classifier ──────────────────────────────────────────────────── */

function classifySubject(text: string): CapabilitySubject {
  if (SELF_REFERENCE.test(text)) return 'self-explicit'
  if (OTHER_PRODUCT.test(text)) return 'none'
  if (FEATURE_STATE_FRAMES.some((p) => p.test(text))) return 'self-implicit'
  return 'none'
}

function classifyFacets(text: string): CapabilityFacet[] {
  return FACET_PATTERNS.filter(({ pattern }) => pattern.test(text)).map((f) => f.facet)
}

function classifyTopics(text: string): PlatformTopic[] {
  let found = TOPIC_PATTERNS.filter(({ pattern }) => pattern.test(text)).map((t) => t.topic)

  // A capability noun in its ordinary-world sense is not this product's.
  found = found.filter((topic) => {
    const sense = DOMAIN_SENSE[topic]
    if (!sense) return true
    if (!sense.domain.test(text)) return true
    return sense.override.test(text)
  })

  // Asking to MAKE a picture is not asking whether pictures can be read.
  if (found.includes('image-generation')) found = found.filter((t) => t !== 'images')

  return [...new Set(found)]
}

/**
 * The whole intent, with its reason. `platformCapabilityTopics` is the thin
 * wrapper the chat route calls; this is what the tests and evidence records
 * read, because "why did it not fire" is the question that matters when one
 * of these misses.
 *
 * 🚨 AN ATTACHED DOCUMENT WINS. "Can you read this PDF?" with a file attached
 * is a request to read the file, and the document path answers it far better
 * than a capability table. The caller passes `hasAttachments` so this module
 * never has to guess at a turn's shape.
 */
export function classifyCapabilityIntent(
  prompt: string,
  opts: { hasAttachments?: boolean } = {},
): CapabilityIntent {
  const none = (reason: string): CapabilityIntent => ({
    subject: 'none', facets: [], topics: [], confidence: 'none', reason,
  })

  if (opts.hasAttachments) return none('an attachment is present — the document path owns this turn')
  const text = prompt.trim()
  if (!text) return none('empty prompt')
  // A long message is a task, not a question about the product.
  if (text.length > 240) return none('longer than 240 characters — a task, not a question')

  const subject = classifySubject(text)
  if (subject === 'none') return none('no self subject — the question is about the world')

  const facets = classifyFacets(text)
  // "What are your capabilities?" carries no facet word at all: asking for the
  // whole list IS the availability question, so the overview frame stands in
  // for one. Specific topics still win over it further down.
  const asksForOverview = OVERVIEW_FRAME.test(text)
  if (facets.length === 0 && !asksForOverview) {
    return { subject, facets, topics: [], confidence: 'none', reason: 'no capability facet — a request, not a question about state' }
  }

  const hasStatusFacet = facets.some((f) => STATUS_FACETS.has(f))

  // "How does X work", "what is an X", "which is best" are about a subject.
  // A status facet overrides them: "is your search configured?" is a status
  // question whatever frame it arrives in.
  if (!hasStatusFacet && (EXPLANATION_FRAME.test(text) || ADVICE_FRAME.test(text))) {
    return { subject, facets, topics: [], confidence: 'none', reason: 'an explanation or advice question' }
  }

  // A request to produce something, with a capability noun somewhere inside it.
  if (TASK_REQUEST.test(text) && !STRONG_CAPABILITY_FRAME.test(text)) {
    return { subject, facets, topics: [], confidence: 'none', reason: 'a request to produce something' }
  }

  const topics = classifyTopics(text)
  if (topics.length > 0) {
    return { subject, facets, topics, confidence: 'high', reason: `capability question about ${topics.join(', ')}` }
  }
  if (asksForOverview) {
    return { subject, facets, topics: ['overview'], confidence: 'high', reason: 'asked what the product can do' }
  }

  // 🚨 THIS IS THE NON-FABRICATION BRANCH. It is a question about this
  // product, and which capability it is about did not resolve. Guessing a
  // topic here would answer with a fact about something else — strictly worse
  // than the model's prose, which at least does not carry the product's
  // authority. The model answers; nothing is claimed on the product's behalf.
  return { subject, facets, topics: [], confidence: 'low', reason: 'about this product, but no capability resolved' }
}

/** Which platform topics this prompt is asking about, if any. */
export function platformCapabilityTopics(
  prompt: string,
  opts: { hasAttachments?: boolean } = {},
): PlatformTopic[] {
  return classifyCapabilityIntent(prompt, opts).topics
}

/* ------------------------------------------------------------------ *
 * Resolving state from the authorities
 * ------------------------------------------------------------------ */

const LABELS: Record<PlatformTopic, string> = {
  'web-search': 'Searching the web',
  documents: 'Reading documents you attach',
  images: 'Understanding images',
  audio: 'Transcribing audio',
  memory: 'Remembering earlier conversations',
  files: 'Reading your uploaded files',
  email: 'Reading your email',
  'code-execution': 'Running code',
  'image-generation': 'Generating images',
  overview: 'Overview',
}

/** Every topic an overview should cover, in the order a person meets them. */
const OVERVIEW_TOPICS: readonly PlatformTopic[] = [
  'documents', 'files', 'memory', 'images', 'web-search', 'email', 'audio', 'image-generation', 'code-execution',
]

/**
 * 🚨 "NOT VERIFIED" IS A DIFFERENT ANSWER FROM "NO".
 *
 * When an authority does not answer, the honest statement is that its state
 * was not verified. Saying "not offered here" would be a claim about the
 * deployment made from no evidence — the same class of defect this whole
 * module exists to stop, just with the product's voice instead of the model's.
 */
const NOT_VERIFIED =
  'The capability registry did not answer, so this was not verified — nothing here is a claim about it.'

function fromRegistry(
  snapshot: PlatformCapabilitySnapshot,
  id: string,
): { state: PlatformCapabilityState; detail: string } | null {
  // Did not answer. NOT "answered, and the capability is absent".
  if (snapshot.registry === null) return { state: 'unavailable', detail: NOT_VERIFIED }
  const row = snapshot.registry.find((c) => c.id === id)
  if (!row) return null
  if (row.available) return { state: 'available', detail: 'Available now.' }
  return {
    state: 'not-configured',
    // The engine's own sentence. Not paraphrased.
    detail: row.unavailableReason ?? 'Not set up on this deployment yet.',
  }
}

/**
 * Megabytes, in the product's own arithmetic.
 *
 * 🚨 1_048_576, NOT 1_000_000, AND FLOOR, NOT ROUND. Found on deployed staging:
 * this said "26 MB" while the file-too-large message on the very next turn said
 * "25 MB" — one limit, two numbers, from two surfaces of the same product. The
 * env vars are named `_MB` and `megabytes()` multiplies by 1024×1024, so this
 * must divide the same way the other surface does (`route.ts`, the
 * `file_too_large_to_read` branch) or the product contradicts itself.
 */
function mb(bytes: number | undefined): string | null {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return null
  return `${Math.floor(bytes / 1_048_576)} MB`
}

/** The limits sentence, or nothing at all when no authority supplied them. */
function documentLimits(snapshot: PlatformCapabilitySnapshot): string {
  const perFile = mb(snapshot.limits?.maxFileBytes)
  const extract = mb(snapshot.limits?.maxExtractBytes)
  if (!perFile && !extract) return ''
  if (perFile && extract) return ` Up to ${perFile} per file, and text is read from the first ${extract} of it.`
  return ` Up to ${perFile ?? extract} per file.`
}

const SIGN_IN = 'Sign in and this becomes available — it needs an account to hold your files.'

/** Resolve one topic against the authorities. Never guesses. */
export function platformCapabilityFact(
  topic: PlatformTopic,
  snapshot: PlatformCapabilitySnapshot,
): PlatformCapabilityFact {
  const label = LABELS[topic]
  switch (topic) {
    case 'documents':
      return snapshot.signedIn
        ? { topic, label, state: 'available', detail: `PDF, CSV, JSON, Markdown, plain text, code and .xlsx spreadsheets. Attach one and ask about it — answers cite the file and the lines they came from.${documentLimits(snapshot)}` }
        : { topic, label, state: 'blocked', detail: SIGN_IN }

    case 'files':
      return snapshot.signedIn
        ? { topic, label, state: 'available', detail: `Files you have already uploaded stay in your library and can be attached again without re-sending them. Local paths on your own computer are not readable.${
            typeof snapshot.limits?.maxFiles === 'number' && snapshot.limits.maxFiles > 0
              ? ` You can keep up to ${snapshot.limits.maxFiles.toLocaleString('en-US')} files.`
              : ''
          }` }
        : { topic, label, state: 'blocked', detail: SIGN_IN }

    case 'memory':
      return snapshot.signedIn
        ? { topic, label, state: 'available', detail: 'Conversations are saved and readable later from History, including after a restart. Within a conversation, earlier turns are used as context.' }
        : { topic, label, state: 'blocked', detail: 'Signed out, this conversation is not saved. Sign in and it is kept.' }

    case 'images': {
      if (!snapshot.vision) return { topic, label, state: 'unavailable', detail: 'The image capability did not report its state, so nothing here is a claim about it.' }
      if (snapshot.vision.state === 'ready') {
        return { topic, label, state: 'available', detail: snapshot.vision.message }
      }
      if (snapshot.vision.state === 'signed_out') {
        return { topic, label, state: 'blocked', detail: snapshot.vision.message }
      }
      // Installed but not approved is BLOCKED, not missing: the difference is
      // an approval someone can grant, and saying "no" would hide that.
      return { topic, label, state: 'blocked', detail: snapshot.vision.message }
    }

    case 'audio': {
      if (!snapshot.speech) return { topic, label, state: 'unavailable', detail: 'The speech capability did not report its state, so nothing here is a claim about it.' }
      if (snapshot.speech.state === 'ready' || snapshot.speech.state === 'available') {
        return { topic, label, state: 'available', detail: snapshot.speech.reason ?? 'Available now.' }
      }
      return {
        topic, label, state: 'not-configured',
        detail: snapshot.speech.reason ?? 'No speech runtime is configured on this deployment.',
      }
    }

    case 'web-search': {
      const r = fromRegistry(snapshot, 'migra.search')
      return r
        ? { topic, label, ...r }
        : { topic, label, state: 'unavailable', detail: 'Web search is not offered here.' }
    }

    case 'email': {
      const r = fromRegistry(snapshot, 'migra.email')
      return r
        ? { topic, label, ...r }
        : { topic, label, state: 'unavailable', detail: 'Email is not offered here.' }
    }

    case 'code-execution': {
      const r = fromRegistry(snapshot, 'terminal.exec')
      if (!r) return { topic, label, state: 'unavailable', detail: 'Running code is not offered in chat. Explaining, writing and reviewing it is.' }
      if (r.state === 'available') return { topic, label, ...r }
      if (r.detail === NOT_VERIFIED) return { topic, label, ...r }
      return {
        topic, label, state: 'not-configured',
        detail: 'Running code is not enabled in chat. Explaining, writing and reviewing it is.',
      }
    }

    case 'image-generation':
      return {
        topic, label, state: 'not-configured',
        detail: 'Image generation is not configured on this server.',
      }

    case 'overview':
      return { topic, label, state: 'available', detail: '' }
  }
}

/* ------------------------------------------------------------------ *
 * The renderer — typed facts in, exact text out
 * ------------------------------------------------------------------ */

const VERDICT: Record<PlatformCapabilityState, string> = {
  available: 'yes',
  blocked: 'not right now',
  'not-configured': 'no',
  unavailable: 'no',
}

/** An unverified capability does not get a verdict at all. */
function line(f: PlatformCapabilityFact): string {
  if (f.detail === NOT_VERIFIED) return `${f.label} — not verified. ${f.detail}`
  return `${f.label} — ${VERDICT[f.state]}. ${f.detail}`.trim()
}

/**
 * The text the product owns for these facts.
 *
 * 🚨 NOT ONE WORD OF THIS IS GENERATED. Every verdict comes from a typed state
 * and every detail is either the authority's own sentence or a constant in this
 * file. That is what makes "it claimed it could search the web" impossible
 * rather than unlikely.
 */
export function renderPlatformCapabilities(facts: readonly PlatformCapabilityFact[]): string {
  const real = facts.filter((f) => f.topic !== 'overview')
  if (real.length === 0) return ''
  const lines = real.map(line)
  if (real.length === 1) return lines[0]!
  return ['Here is where each of those actually stands:', '', ...lines.map((l) => `• ${l}`)].join('\n')
}

/** Facts for every topic a prompt asked about, overview included. */
export function platformCapabilityAnswer(
  topics: readonly PlatformTopic[],
  snapshot: PlatformCapabilitySnapshot,
): { facts: PlatformCapabilityFact[]; text: string } {
  const expanded = topics.includes('overview')
    ? OVERVIEW_TOPICS
    : topics
  const facts = expanded.map((t) => platformCapabilityFact(t, snapshot))
  return { facts, text: renderPlatformCapabilities(facts) }
}
