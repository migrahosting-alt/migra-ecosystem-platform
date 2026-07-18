// Intelligent Provider Router — Slice 1: the fleet registry.
//
// The runtime FLEET view: it joins the first-class ProviderRegistry with the
// existing capability-routed ModelRegistry (discovered models) and truthful
// health, and reconciles declared provider capabilities against the capabilities
// of the models actually discovered for that provider. It changes NO routing —
// it is an inspectable snapshot the policy engine (and later slices) consume.
//
// © MigraTeck LLC.

import type { ModelDescriptor, ModelRegistry } from '../modelRegistry.js';
import type { ProviderCapabilities, ProviderHealth, ProviderSummary } from './types.js';
import { ProviderRegistry } from './providerRegistry.js';
import { deriveHealth, type ProbeOutcome, type ProviderProbe } from './health.js';

export interface FleetProvider {
  provider: ProviderSummary;
  /** Models discovered for this provider (empty for providers not yet wired). */
  models: ModelDescriptor[];
  /** What the provider declares it can do. */
  declaredCapabilities: ProviderCapabilities;
  /** What the DISCOVERED models actually back (union). Empty when no models. */
  modelBackedCapabilities: ProviderCapabilities;
  /** Truthful effective capabilities: narrowed to model evidence when models are
   * discovered, else the declaration (no evidence to narrow yet). */
  effectiveCapabilities: ProviderCapabilities;
}

export interface FleetSnapshot {
  providers: FleetProvider[];
  generatedAt: number;
}

const NO_CAPS: ProviderCapabilities = { chat: false, vision: false, tools: false, embedding: false, reasoning: false, coding: false };

function unionModelCaps(models: ModelDescriptor[]): ProviderCapabilities {
  const out: ProviderCapabilities = { ...NO_CAPS };
  for (const m of models) {
    out.chat ||= m.capabilities.chat;
    out.vision ||= m.capabilities.vision;
    out.tools ||= m.capabilities.tools;
    out.embedding ||= m.capabilities.embedding;
    out.reasoning ||= m.capabilities.reasoning;
    out.coding ||= m.capabilities.coding;
  }
  return out;
}

function andCaps(a: ProviderCapabilities, b: ProviderCapabilities): ProviderCapabilities {
  return {
    chat: a.chat && b.chat,
    vision: a.vision && b.vision,
    tools: a.tools && b.tools,
    embedding: a.embedding && b.embedding,
    reasoning: a.reasoning && b.reasoning,
    coding: a.coding && b.coding,
  };
}

export class FleetRegistry {
  private readonly health = new Map<string, ProviderHealth>();

  constructor(
    private readonly providers: ProviderRegistry,
    private readonly models: ModelRegistry,
    private readonly opts: { probe?: ProviderProbe; now?: () => number } = {},
  ) {}

  private now(): number {
    return (this.opts.now ?? (() => Date.now()))();
  }

  /** Actively probe enabled + credentialed providers (read-only reachability).
   * Disabled providers and cloud providers without a present credential are NOT
   * probed — their health is derived truthfully without a network call. */
  async refresh(): Promise<void> {
    for (const p of this.providers.list()) {
      const hasCred = this.providers.hasCredential(p);
      let outcome: ProbeOutcome | null = null;
      if (p.enabled && hasCred && this.opts.probe) {
        try {
          outcome = await this.opts.probe(p);
        } catch (err) {
          outcome = { reachable: false, detail: err instanceof Error ? err.name : 'probe error' };
        }
      }
      this.health.set(p.id, deriveHealth(p, hasCred, outcome, this.now()));
    }
  }

  /** Is any cloud provider actually usable (enabled + credentialed + reachable)?
   * Drives the truthful effective-policy downgrade to local-only. */
  async hasUsableCloud(): Promise<boolean> {
    const health = this.healthById();
    return this.providers.list().some((p) => {
      if (p.kind !== 'cloud' || !p.enabled || !this.providers.hasCredential(p)) return false;
      const h = health.get(p.id);
      return !h || h.status !== 'unreachable';
    });
  }

  healthById(): Map<string, ProviderHealth> {
    const out = new Map<string, ProviderHealth>();
    for (const p of this.providers.list()) {
      out.set(p.id, this.health.get(p.id) ?? deriveHealth(p, this.providers.hasCredential(p), null, this.now()));
    }
    return out;
  }

  /** Build the fleet snapshot: providers × discovered models × health, with
   * reconciled capabilities. Read-only; no completion is ever issued. */
  async snapshot(): Promise<FleetSnapshot> {
    const models = await this.models.list().catch(() => [] as ModelDescriptor[]);
    const providerIds = new Set(this.providers.list().map((p) => p.id));
    // Discovered models whose source id is a declared provider attach to it; any
    // other discovered model (e.g. the stub's `stub` source, or an ollama-named
    // source) is a LOCAL discovery and attaches to the local provider.
    const localFallbackId = this.providers.list().find((p) => p.kind === 'local')?.id;
    const byProvider = new Map<string, ModelDescriptor[]>();
    for (const m of models) {
      const target = providerIds.has(m.provider) ? m.provider : localFallbackId;
      if (!target) continue;
      const list = byProvider.get(target) ?? [];
      list.push(m);
      byProvider.set(target, list);
    }
    const healthById = this.healthById();
    const summaries = new Map(this.providers.summaries(healthById).map((s) => [s.id, s]));

    const providers: FleetProvider[] = this.providers.list().map((p) => {
      const mine = byProvider.get(p.id) ?? [];
      const declared = p.capabilities;
      const modelBacked = unionModelCaps(mine);
      const effective = mine.length > 0 ? andCaps(declared, modelBacked) : declared;
      return {
        provider: summaries.get(p.id)!,
        models: mine,
        declaredCapabilities: declared,
        modelBackedCapabilities: modelBacked,
        effectiveCapabilities: effective,
      };
    });
    return { providers, generatedAt: this.now() };
  }
}
