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
}

/* ------------------------------------------------------------------ *
 * Recognising the question
 * ------------------------------------------------------------------ */

/**
 * A self-referential frame. Without one of these it is not a question about
 * the product — "explain how web search works" is a request for an
 * explanation, and answering it with a capability table would be worse than
 * the model's prose.
 */
const SELF_FRAME =
  /\b(can|could|are)\s+you\b|\bdo\s+you\s+(have|support|remember|know how)\b|\bable\s+to\b|\byou\s+can'?t\b|\bwhat\s+can\s+you\s+do\b|\bwhat\s+are\s+you\s+able\b|\bwhat\s+can\s+migrapilot\b/i

/**
 * Topic keywords.
 *
 * 🚨 DELIBERATELY NARROW. A false positive answers a real question with a
 * capability table, which is a worse failure than the one being fixed — so
 * every pattern here names the FEATURE, not a subject the feature is about.
 */
const TOPIC_PATTERNS: ReadonlyArray<{ topic: PlatformTopic; pattern: RegExp }> = [
  { topic: 'web-search', pattern: /\b(search|browse|google|look\s*up)\b.{0,20}\b(web|internet|online|news)\b|\bweb\s*search\b|\bbrowse\s+the\s+(web|internet)\b/i },
  { topic: 'images', pattern: /\b(see|look at|view|analyse|analyze|read|understand|describe)\b.{0,24}\b(image|images|picture|pictures|photo|photos|screenshot|chart)\b|\bvision\b/i },
  { topic: 'image-generation', pattern: /\b(make|create|generate|draw|paint)\b.{0,24}\b(image|picture|photo|illustration|logo|drawing)\b/i },
  { topic: 'documents', pattern: /\b(read|open|parse|understand|analyse|analyze|summari[sz]e)\b.{0,24}\b(pdf|pdfs|document|documents|docx|spreadsheet|csv|xlsx|attachment|attachments)\b|\battach\b.{0,20}\b(pdf|document|file)\b/i },
  { topic: 'audio', pattern: /\btranscrib|\b(audio|voice|speech|recording|microphone|dictat)/i },
  { topic: 'memory', pattern: /\bremember\b|\brecall\b|\b(previous|earlier|past|last)\s+(conversation|conversations|chat|chats|session)|\bconversation\s+history\b/i },
  { topic: 'files', pattern: /\b(access|open|read|see|get)\b.{0,24}\b(my\s+files|my\s+file|my\s+computer|my\s+drive|local\s+file|file\s+system)\b/i },
  { topic: 'email', pattern: /\b(e-?mail|inbox|gmail|mailbox)\b/i },
  { topic: 'code-execution', pattern: /\b(run|execute)\b.{0,20}\b(code|script|command|program|terminal|shell)\b|\bterminal\b|\bshell\s+command\b/i },
]

const OVERVIEW =
  /\bwhat\s+can\s+you\s+(actually\s+)?do\b|\bwhat\s+are\s+you\s+able\s+to\s+do\b|\bwhat\s+can\s+migrapilot\s+do\b|\bwhat\s+are\s+your\s+capabilities\b/i

/**
 * Which platform topics this prompt is asking about, if any.
 *
 * 🚨 AN ATTACHED DOCUMENT WINS. "Can you read this PDF?" with a file attached
 * is a request to read the file, and the document path answers it far better
 * than a capability table. The caller passes `hasAttachments` so this module
 * never has to guess at a turn's shape.
 */
export function platformCapabilityTopics(
  prompt: string,
  opts: { hasAttachments?: boolean } = {},
): PlatformTopic[] {
  if (opts.hasAttachments) return []
  const text = prompt.trim()
  if (!text) return []
  // A long message is a task, not a question about the product.
  if (text.length > 240) return []
  if (OVERVIEW.test(text)) return ['overview']
  if (!SELF_FRAME.test(text)) return []
  const found = TOPIC_PATTERNS.filter(({ pattern }) => pattern.test(text)).map((t) => t.topic)
  return [...new Set(found)]
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

function fromRegistry(
  snapshot: PlatformCapabilitySnapshot,
  id: string,
): { state: PlatformCapabilityState; detail: string } | null {
  if (snapshot.registry === null) return null
  const row = snapshot.registry.find((c) => c.id === id)
  if (!row) return null
  if (row.available) return { state: 'available', detail: 'Available now.' }
  return {
    state: 'not-configured',
    // The engine's own sentence. Not paraphrased.
    detail: row.unavailableReason ?? 'Not set up on this deployment yet.',
  }
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
        ? { topic, label, state: 'available', detail: 'PDF, CSV, JSON, Markdown, plain text, code and .xlsx spreadsheets. Attach one and ask about it — answers cite the file and the lines they came from.' }
        : { topic, label, state: 'blocked', detail: SIGN_IN }

    case 'files':
      return snapshot.signedIn
        ? { topic, label, state: 'available', detail: 'Files you have already uploaded stay in your library and can be attached again without re-sending them. Local paths on your own computer are not readable.' }
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
  const lines = real.map((f) => `${f.label} — ${VERDICT[f.state]}. ${f.detail}`.trim())
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
