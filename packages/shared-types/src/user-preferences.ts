/**
 * What MigraPilot remembers about how you like it to behave.
 *
 * THE BOUNDARY IS THE WHOLE DESIGN. MigraAuth is canonical for identity — name,
 * email, avatar, verified state, linked providers, sessions. None of it is
 * copied here. What lives in this file is only what MigraPilot itself knows how
 * to honour: how an answer should read, what it may do without asking, what it
 * remembers. A second copy of "who you are" drifts the first time someone
 * changes their name in one place and not the other, and then no screen can say
 * which one is true.
 *
 * DEFAULTS LIVE HERE, ONCE. The server merges a stored document over these, so a
 * preference added after a document was written simply takes its default rather
 * than arriving as `undefined` and being rendered as an empty control. That is
 * also why the store is one JSON document instead of a column per setting: these
 * change constantly, and each change would otherwise be a schema migration.
 *
 * EVERY VALUE IS A CLOSED SET. Free strings are the exception (`customInstructions`),
 * and they are length-bounded. A preference that reaches the model as an
 * arbitrary string is a prompt-injection surface wearing a settings label.
 */

/** How much the assistant writes, and in what voice. */
export const RESPONSE_STYLES = ['neutral', 'concise', 'friendly', 'formal', 'technical'] as const;
export type ResponseStyle = (typeof RESPONSE_STYLES)[number];

/** How much ground an answer covers. Distinct from style: length is not tone. */
export const DETAIL_LEVELS = ['brief', 'balanced', 'thorough'] as const;
export type DetailLevel = (typeof DETAIL_LEVELS)[number];

/**
 * How hard the assistant should think before answering.
 *
 * `auto` is the default and stays the intelligent one: the router picks per
 * turn. The others are a CEILING the user has chosen, honoured only once the
 * runtime control exists — until then the capability probe reports it
 * unavailable and the UI says so rather than pretending the dial is connected.
 */
export const REASONING_DEPTHS = ['auto', 'fast', 'balanced', 'deep'] as const;
export type ReasoningDepth = (typeof REASONING_DEPTHS)[number];

/** Whether answers must be backed by the user's own documents. */
export const GROUNDING_PREFERENCES = ['auto', 'prefer_sources', 'require_sources'] as const;
export type GroundingPreference = (typeof GROUNDING_PREFERENCES)[number];

/**
 * How much the assistant may do without asking first.
 *
 * `ask_first` is deliberately the default. An assistant that acts before it is
 * trusted is harder to recover from than one that asks twice.
 */
export const AUTONOMY_LEVELS = ['ask_first', 'suggest', 'act'] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

/** What is carried between turns and between conversations. */
export const MEMORY_MODES = ['off', 'session', 'durable'] as const;
export type MemoryMode = (typeof MEMORY_MODES)[number];

export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

export const DENSITIES = ['comfortable', 'compact'] as const;
export type Density = (typeof DENSITIES)[number];

/**
 * A language the product will actually honour.
 *
 * Deliberately short and deliberately honest. `auto` follows the browser.
 * Haitian Creole is NOT offered here yet: the flagship Creole bar is a sustained
 * natural conversation, and listing it as a preference before that is met would
 * promise a quality the product cannot deliver.
 */
export const LANGUAGES = ['auto', 'en', 'fr', 'es'] as const;
export type Language = (typeof LANGUAGES)[number];

export const MAX_CUSTOM_INSTRUCTIONS = 2000;

export interface UserPreferences {
  /* ── how answers read ─────────────────────────────────────────────── */
  responseStyle: ResponseStyle;
  detailLevel: DetailLevel;
  reasoningDepth: ReasoningDepth;
  groundingPreference: GroundingPreference;
  autonomyLevel: AutonomyLevel;
  language: Language;
  /** Free text the user wants applied to every conversation. Bounded. */
  customInstructions: string;

  /* ── what is remembered ───────────────────────────────────────────── */
  memoryMode: MemoryMode;
  /** Whether new conversations are stored at all. */
  saveHistory: boolean;
  /** 0 means "keep until I delete it" — never a silent purge. */
  retentionDays: number;

  /* ── how it looks ─────────────────────────────────────────────────── */
  theme: Theme;
  density: Density;
  reduceMotion: boolean;
  highContrast: boolean;

  /* ── what reaches your inbox ──────────────────────────────────────── */
  securityEmails: boolean;
  productEmails: boolean;
}

/**
 * The starting point for an account that has never opened Settings.
 *
 * Chosen to match what MigraPilot already does, so opening Settings for the
 * first time never silently changes behaviour: the defaults describe the product
 * rather than reconfigure it.
 */
export const DEFAULT_PREFERENCES: UserPreferences = {
  responseStyle: 'neutral',
  detailLevel: 'balanced',
  reasoningDepth: 'auto',
  groundingPreference: 'auto',
  autonomyLevel: 'ask_first',
  language: 'auto',
  customInstructions: '',
  memoryMode: 'durable',
  saveHistory: true,
  retentionDays: 0,
  theme: 'system',
  density: 'comfortable',
  reduceMotion: false,
  highContrast: false,
  /**
   * Security mail is ON and stays a choice the user can see, because an account
   * that cannot be told it was accessed is worse than a noisy one. Product mail
   * is OFF: consent is opted into, never out of.
   */
  securityEmails: true,
  productEmails: false,
};

/** Preference keys whose change is worth recording. */
export const AUDITED_PREFERENCE_KEYS: readonly (keyof UserPreferences)[] = [
  'memoryMode',
  'saveHistory',
  'retentionDays',
  'autonomyLevel',
  'customInstructions',
  'securityEmails',
];

const oneOf = <T extends string>(allowed: readonly T[], value: unknown, fallback: T): T =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;

const bool = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;

/**
 * Retention, in days.
 *
 * Bounded to two years and floored at zero. A negative or absurd value is a bug
 * upstream, and the honest response is the default rather than a purge schedule
 * nobody chose — this is the one preference whose bad value DELETES things.
 */
function retention(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const days = Math.floor(value);
  if (days < 0 || days > 730) return fallback;
  return days;
}

function instructions(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.slice(0, MAX_CUSTOM_INSTRUCTIONS);
}

/**
 * A stored document merged over the defaults, with every field validated.
 *
 * NEVER TRUSTS WHAT IT READS. The document may have been written by an older
 * build (missing keys), a newer one (unknown keys), or a bug (wrong types). All
 * three resolve to a complete, valid object rather than to a runtime error on a
 * settings screen — and an unknown key is dropped rather than passed onward,
 * because the only thing downstream of here is a model prompt.
 */
export function normalizePreferences(stored: unknown): UserPreferences {
  const d = DEFAULT_PREFERENCES;
  const raw = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>;

  return {
    responseStyle: oneOf(RESPONSE_STYLES, raw['responseStyle'], d.responseStyle),
    detailLevel: oneOf(DETAIL_LEVELS, raw['detailLevel'], d.detailLevel),
    reasoningDepth: oneOf(REASONING_DEPTHS, raw['reasoningDepth'], d.reasoningDepth),
    groundingPreference: oneOf(GROUNDING_PREFERENCES, raw['groundingPreference'], d.groundingPreference),
    autonomyLevel: oneOf(AUTONOMY_LEVELS, raw['autonomyLevel'], d.autonomyLevel),
    language: oneOf(LANGUAGES, raw['language'], d.language),
    customInstructions: instructions(raw['customInstructions']),
    memoryMode: oneOf(MEMORY_MODES, raw['memoryMode'], d.memoryMode),
    saveHistory: bool(raw['saveHistory'], d.saveHistory),
    retentionDays: retention(raw['retentionDays'], d.retentionDays),
    theme: oneOf(THEMES, raw['theme'], d.theme),
    density: oneOf(DENSITIES, raw['density'], d.density),
    reduceMotion: bool(raw['reduceMotion'], d.reduceMotion),
    highContrast: bool(raw['highContrast'], d.highContrast),
    securityEmails: bool(raw['securityEmails'], d.securityEmails),
    productEmails: bool(raw['productEmails'], d.productEmails),
  };
}

/**
 * Apply a partial update to a current document.
 *
 * Only keys actually present in the patch are considered — so a client that
 * knows about three preferences cannot blank the twelve it has never heard of by
 * sending a whole object. Returns the new document AND which keys really
 * changed, because "saved" and "changed nothing" are different outcomes and the
 * audit trail should only carry the second kind.
 */
export function applyPreferencePatch(
  current: UserPreferences,
  patch: unknown,
): { next: UserPreferences; changed: (keyof UserPreferences)[] } {
  const raw = (patch && typeof patch === 'object' ? patch : {}) as Record<string, unknown>;
  const merged = normalizePreferences({ ...current, ...raw });

  const changed = (Object.keys(current) as (keyof UserPreferences)[]).filter(
    (key) => Object.prototype.hasOwnProperty.call(raw, key) && merged[key] !== current[key],
  );

  return { next: merged, changed };
}

/**
 * The subset the Brain needs to shape a turn.
 *
 * Extracted rather than passing the whole document, so appearance and email
 * preferences never travel to a model prompt. A preference the model does not
 * need is a preference it cannot leak.
 */
export interface TurnPreferences {
  responseStyle: ResponseStyle;
  detailLevel: DetailLevel;
  language: Language;
  customInstructions: string;
}

export function turnPreferences(preferences: UserPreferences): TurnPreferences {
  return {
    responseStyle: preferences.responseStyle,
    detailLevel: preferences.detailLevel,
    language: preferences.language,
    customInstructions: preferences.customInstructions,
  };
}

/** Human names for the languages a user can pin. */
const LANGUAGE_NAMES: Record<Exclude<Language, 'auto'>, string> = {
  en: 'English',
  fr: 'French',
  es: 'Spanish',
};

/**
 * Turn stored preferences into instructions a model should actually be given.
 *
 * ONLY WHAT DIFFERS FROM THE DEFAULT IS EMITTED, and that is a correctness
 * requirement rather than brevity. Naming a language in a system prompt biases
 * output INTO that language even when the user wrote in another; spelling out
 * "balanced detail, neutral style" on every turn spends the model's attention
 * restating the behaviour it already has. A preference the user never changed
 * should leave no trace in the prompt.
 *
 * Returns an empty array when the user has changed nothing, so the caller adds
 * no system message at all rather than an empty one.
 */
export function responseDirectives(preferences: TurnPreferences): string[] {
  const directives: string[] = [];

  const style: Partial<Record<ResponseStyle, string>> = {
    concise: 'Be brief. Prefer short, direct answers over thorough ones.',
    technical: 'Write for an experienced engineer. Use precise technical vocabulary and do not simplify.',
    friendly: 'Write warmly and conversationally.',
    formal: 'Write formally and professionally.',
  };
  if (style[preferences.responseStyle]) directives.push(style[preferences.responseStyle]!);

  const detail: Partial<Record<DetailLevel, string>> = {
    brief: 'Answer with the smallest useful response. Omit preamble and summary.',
    thorough: 'Cover the topic thoroughly, including edge cases and alternatives worth knowing.',
  };
  if (detail[preferences.detailLevel]) directives.push(detail[preferences.detailLevel]!);

  /*
   * 'auto' emits NOTHING, deliberately. The model already answers in the
   * language it is addressed in; naming one here would override the user's
   * actual choice of language mid-conversation.
   */
  if (preferences.language !== 'auto') {
    directives.push(`Reply in ${LANGUAGE_NAMES[preferences.language]}.`);
  }

  /*
   * The user's own words, LAST and clearly delimited. Last so they win over the
   * generated directives above, which is what a custom instruction is for.
   * Delimited so a long instruction cannot be mistaken for the conversation, and
   * labelled as the user's standing preference rather than as system policy —
   * it must not be able to impersonate the operator.
   */
  const custom = preferences.customInstructions.trim();
  if (custom.length > 0) {
    directives.push(
      `The user has given these standing instructions for how they want replies written. ` +
        `Follow them unless they conflict with safety or accuracy:\n${custom}`,
    );
  }

  return directives;
}
