// Intelligent Provider Router — Slice 3: the one-shot cloud attempt executor.
//
// Runs EXACTLY ONE attributed cloud completion for an APPROVED escalation. No
// failover, no retry, no queueing. It is only ever reached after the escalation
// gate + a single-use approval; it does not decide eligibility. The credential is
// resolved from its env var here and NEVER surfaced. Every attempt is audited.
//
// © MigraTeck LLC.

import type { ChatTurnRequest } from '@migrapilot/shared-types';
import { OpenAiCompatProvider } from '../../providers/openAiCompatProvider.js';
import type { ProviderAdapter } from '../../providers/providerRegistry.js';
import { auditStore } from '../auditLog.js';
import { sanitizeError } from '../redaction.js';
import type { EscalationReason } from './escalation.js';
import type { Provider } from './types.js';

export interface CloudAttemptInput {
  correlationId: string;
  /** The approved target cloud provider. */
  provider: Provider;
  modelId: string;
  reason: EscalationReason;
  request: ChatTurnRequest;
}

export interface CloudAttemptResult {
  ok: boolean;
  viaEscalation: true;
  provider: string;
  model: string;
  reason: EscalationReason;
  content?: string;
  usage?: { inputTokens: number; outputTokens: number; latencyMs?: number };
  /** Sanitized error (no stack, no secret) when the single attempt fails. */
  error?: string;
}

export type CloudProviderFactory = (opts: { baseUrl: string; model: string; apiKey?: string }) => ProviderAdapter;

const defaultFactory: CloudProviderFactory = (opts) => new OpenAiCompatProvider({ profile: 'default', baseUrl: opts.baseUrl, model: opts.model, apiKey: opts.apiKey });

export class CloudEscalationExecutor {
  constructor(
    private readonly makeProvider: CloudProviderFactory = defaultFactory,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  /** Execute exactly one cloud completion. Fail-closed on a missing credential. */
  async attempt(input: CloudAttemptInput): Promise<CloudAttemptResult> {
    const cid = input.correlationId;
    const base = { ok: false as const, viaEscalation: true as const, provider: input.provider.id, model: input.modelId, reason: input.reason };
    auditStore.append({ correlationId: cid, type: 'escalation.attempted', component: 'escalation', fields: { provider: input.provider.id, model: input.modelId, reason: input.reason } });

    const key = input.provider.credentialEnv ? this.env[input.provider.credentialEnv] : undefined;
    if (input.provider.credentialEnv && !(typeof key === 'string' && key.trim().length > 0)) {
      auditStore.append({ correlationId: cid, type: 'escalation.failed', component: 'escalation', outcome: 'NO_CREDENTIAL', fields: { provider: input.provider.id, reason: input.reason } });
      return { ...base, error: 'cloud credential unavailable' };
    }
    if (!input.provider.baseUrl) {
      auditStore.append({ correlationId: cid, type: 'escalation.failed', component: 'escalation', outcome: 'NO_ENDPOINT', fields: { provider: input.provider.id, reason: input.reason } });
      return { ...base, error: 'cloud endpoint unavailable' };
    }

    try {
      // ONE attempt — no failover, no retry.
      const client = this.makeProvider({ baseUrl: input.provider.baseUrl, model: input.modelId, apiKey: key });
      const res = await client.complete(input.request);
      auditStore.append({ correlationId: cid, type: 'escalation.completed', component: 'escalation', outcome: 'ok', fields: { provider: input.provider.id, model: input.modelId, reason: input.reason, outputTokens: res.telemetry.outputTokens } });
      return {
        ok: true,
        viaEscalation: true,
        provider: input.provider.id,
        model: input.modelId,
        reason: input.reason,
        content: res.content,
        usage: { inputTokens: res.telemetry.inputTokens, outputTokens: res.telemetry.outputTokens, latencyMs: res.telemetry.latencyMs },
      };
    } catch (err) {
      auditStore.append({ correlationId: cid, type: 'escalation.failed', component: 'escalation', outcome: 'error', fields: { provider: input.provider.id, model: input.modelId, reason: input.reason } });
      return { ...base, error: sanitizeError(err).message };
    }
  }
}
