/**
 * MigraAI Engine — Model Registry.
 *
 * Provider-independent catalog of the models the engine can route to. Models are
 * DISCOVERED from each configured provider (never hard-coded), enriched with a
 * capability profile (chat / vision / tools / embedding / reasoning / coding) and
 * a coarse size tier, and cached with a short TTL so routing stays fast without
 * going stale.
 *
 * Discovery adapters are intentionally small and additive: today the engine ships
 * an Ollama-native adapter (rich `capabilities` from `/api/tags`) plus a generic
 * OpenAI-compatible adapter (name-based capability inference from `/models`).
 * Adding vLLM / llama.cpp / a hosted provider = adding one `discover()` function;
 * nothing above the registry changes.
 */

import type { QualificationInfo } from './qualificationStore.js';

export type ModelTier = 'fast' | 'balanced' | 'deep';

export interface ModelCapabilities {
  chat: boolean;
  vision: boolean;
  tools: boolean;
  embedding: boolean;
  reasoning: boolean;
  coding: boolean;
  insert: boolean;
}

export interface ModelDescriptor {
  /** Provider-native model id, sent verbatim to the inference backend. */
  id: string;
  /** Logical provider this model was discovered from (e.g. `ollama`). */
  provider: string;
  family?: string;
  /** Parameter count in billions, when the provider reports it (for tiering). */
  paramCount?: number;
  contextLength?: number;
  sizeBytes?: number;
  capabilities: ModelCapabilities;
  tier: ModelTier;
  /** Qualification state (installing a model does not approve it). */
  qualification?: QualificationInfo;
}

/** A discovery adapter for one provider endpoint. */
export interface ProviderSource {
  /** Logical id used in `ModelDescriptor.provider`. */
  id: string;
  /** Base URL of an OpenAI-compatible endpoint (…/v1). */
  baseUrl: string;
  apiKey?: string;
}

export interface ModelRegistryOptions {
  sources: ProviderSource[];
  /** Cache TTL for the discovered catalog. Default 60s. */
  ttlMs?: number;
  /** Injected fetch (tests). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Per-request discovery timeout. Default 4s. */
  timeoutMs?: number;
  /** When set, discovery is skipped and this fixed catalog is returned. Used for
   * the deterministic (stub) backend so the engine facade is exercisable with no
   * real inference provider present. */
  staticModels?: ModelDescriptor[];
  /** Attach a qualification to each discovered model. Unqualified models default
   * to `installed` (present, not production-approved). */
  qualify?: (id: string) => QualificationInfo | undefined;
}

const DEFAULT_TTL = 60_000;
const DEFAULT_TIMEOUT = 4_000;

export class ModelRegistry {
  private readonly sources: ProviderSource[];
  private readonly ttlMs: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly staticModels?: ModelDescriptor[];
  private readonly qualifyFn?: (id: string) => QualificationInfo | undefined;
  private cache: ModelDescriptor[] | undefined;
  private cachedAt = 0;
  private inflight: Promise<ModelDescriptor[]> | undefined;

  constructor(opts: ModelRegistryOptions) {
    this.sources = opts.sources;
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.staticModels = opts.staticModels;
    this.qualifyFn = opts.qualify;
  }

  /** Return the discovered catalog, refreshing when the cache is cold/stale.
   * `force` bypasses the cache. Discovery failures degrade to an empty catalog
   * (or the last good cache) rather than throwing — a dead provider must not take
   * the engine down. */
  async list(force = false, now = Date.now()): Promise<ModelDescriptor[]> {
    if (this.staticModels) {
      return this.staticModels.map((m) => this.enrich(m));
    }
    if (!force && this.cache && now - this.cachedAt < this.ttlMs) {
      return this.cache;
    }
    if (this.inflight) {
      return this.inflight;
    }
    this.inflight = this.discoverAll()
      .then((models) => {
        this.cache = models;
        this.cachedAt = Date.now();
        return models;
      })
      .catch(() => this.cache ?? [])
      .finally(() => {
        this.inflight = undefined;
      });
    return this.inflight;
  }

  async get(id: string, now = Date.now()): Promise<ModelDescriptor | undefined> {
    const all = await this.list(false, now);
    return all.find((m) => m.id === id);
  }

  private async discoverAll(): Promise<ModelDescriptor[]> {
    const perSource = await Promise.all(this.sources.map((s) => this.discoverSource(s).catch(() => [])));
    const merged = new Map<string, ModelDescriptor>();
    for (const list of perSource) {
      for (const m of list) {
        // First provider to report an id wins (stable ordering by sources).
        if (!merged.has(m.id)) merged.set(m.id, m);
      }
    }
    return [...merged.values()].map((m) => this.enrich(m)).sort((a, b) => a.id.localeCompare(b.id));
  }

  /** Attach qualification; an unlisted installed model defaults to `installed`. */
  private enrich(m: ModelDescriptor): ModelDescriptor {
    return { ...m, qualification: this.qualifyFn?.(m.id) ?? { state: 'installed' } };
  }

  /** Prefer Ollama-native `/api/tags` (real capabilities); fall back to the
   * OpenAI-compatible `/models` list with name-based inference. */
  private async discoverSource(source: ProviderSource): Promise<ModelDescriptor[]> {
    const nativeBase = source.baseUrl.replace(/\/v1\/?$/, '');
    const tags = await this.tryJson(`${nativeBase}/api/tags`, source);
    if (tags && Array.isArray((tags as OllamaTags).models)) {
      return (tags as OllamaTags).models.map((m) => this.fromOllama(m, source.id));
    }
    const models = await this.tryJson(`${source.baseUrl.replace(/\/$/, '')}/models`, source);
    if (models && Array.isArray((models as OpenAiModels).data)) {
      return (models as OpenAiModels).data.map((m) => this.fromOpenAi(m.id, source.id));
    }
    return [];
  }

  private async tryJson(url: string, source: ProviderSource): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(url, {
        headers: source.apiKey ? { Authorization: `Bearer ${source.apiKey}` } : undefined,
        signal: controller.signal,
      });
      if (!res.ok) return undefined;
      return await res.json();
    } catch {
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }

  private fromOllama(m: OllamaModel, provider: string): ModelDescriptor {
    const caps = new Set(m.capabilities ?? []);
    const name = m.name ?? m.model ?? '';
    const paramCount = parseParamSize(m.details?.parameter_size);
    const capabilities: ModelCapabilities = {
      chat: caps.has('completion') || caps.has('chat') || (!caps.has('embedding') && caps.size === 0),
      vision: caps.has('vision'),
      tools: caps.has('tools'),
      embedding: caps.has('embedding'),
      reasoning: caps.has('thinking') || /(-r1|:r1|qwq|reason)/i.test(name),
      coding: /coder|code/i.test(name),
      insert: caps.has('insert'),
    };
    // An embedding-only model is not a chat model.
    if (capabilities.embedding && caps.size === 1) capabilities.chat = false;
    return {
      id: name,
      provider,
      family: m.details?.family,
      paramCount,
      contextLength: m.details?.context_length,
      sizeBytes: m.size,
      capabilities,
      tier: tierFor(paramCount),
    };
  }

  private fromOpenAi(id: string, provider: string): ModelDescriptor {
    // No capability metadata from /models — infer conservatively from the name.
    const capabilities: ModelCapabilities = {
      chat: !/embed/i.test(id),
      vision: /vision|-vl|llava|gpt-4o|gemini/i.test(id),
      tools: /gpt-4|gpt-4o|claude|gemini|qwen.*coder|llama3/i.test(id),
      embedding: /embed/i.test(id),
      reasoning: /-r1|qwq|o1|o3|reason|think/i.test(id),
      coding: /coder|code/i.test(id),
      insert: false,
    };
    return { id, provider, capabilities, tier: tierFor(parseParamSize(id)) };
  }
}

/** Parse "7.6B" / "32.8B" / "137M" → billions of parameters. */
export function parseParamSize(raw?: string): number | undefined {
  if (!raw) return undefined;
  const m = /([\d.]+)\s*([BM])/i.exec(raw);
  const num = m?.[1];
  const unit = m?.[2];
  if (num == null || unit == null) return undefined;
  const n = Number(num);
  if (!Number.isFinite(n)) return undefined;
  return unit.toUpperCase() === 'M' ? n / 1000 : n;
}

/** Coarse size tier used by the router when the caller asks for fast/balanced/deep. */
export function tierFor(paramCount?: number): ModelTier {
  if (paramCount == null) return 'balanced';
  if (paramCount < 8) return 'fast';
  if (paramCount <= 20) return 'balanced';
  return 'deep';
}

interface OllamaTags {
  models: OllamaModel[];
}
interface OllamaModel {
  name?: string;
  model?: string;
  size?: number;
  capabilities?: string[];
  details?: { family?: string; parameter_size?: string; context_length?: number };
}
interface OpenAiModels {
  data: Array<{ id: string }>;
}
