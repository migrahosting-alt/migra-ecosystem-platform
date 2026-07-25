import * as vscode from 'vscode';
import type {
  ChatTurnRequest,
  ChatTurnResponse,
  HealthResponse,
  RetrieveRequest,
  RetrieveResponse,
  RouteRequest,
  RouteResponse,
} from '@migrapilot/shared-types';

/** `GET /health` as the engine actually serves it. The extra blocks are optional
 * because an older brain may not report them; consumers must handle absence. */
export interface BrainHealthDetail extends HealthResponse {
  readiness?: {
    process?: string;
    inferenceProviders?: string;
    persistence?: string;
    memory?: string;
    rag?: string;
    schemaVersion?: number;
    migrationState?: string;
    detail?: string;
  };
  operational?: {
    status?: string;
    reachable?: boolean;
    schemaCurrent?: boolean;
    schemaVersion?: number;
    integrity?: string;
    retentionWorker?: string;
    writeLatencyMs?: number | null;
    storageBytes?: number | null;
  };
}

export class BrainClient {
  constructor(private readonly output: vscode.OutputChannel) {}

  get baseUrl(): string {
    const config = vscode.workspace.getConfiguration('migrapilot');
    return String(config.get('brainUrl', 'http://127.0.0.1:3988')).replace(/\/$/, '');
  }

  async health(): Promise<HealthResponse> {
    return this.request<HealthResponse>('GET', '/health');
  }

  /**
   * The SAME `GET /health` payload, typed to include the operational readiness
   * fields the engine already returns beyond {@link HealthResponse}: persistence
   * readiness, schema version, durable-store integrity and the retention worker.
   *
   * No new endpoint and no new request — the extra fields were always on the
   * wire; this accessor just stops discarding them so the shell can display
   * canonical readiness instead of guessing from `status` alone.
   */
  async healthDetail(): Promise<BrainHealthDetail> {
    return this.request<BrainHealthDetail>('GET', '/health');
  }

  async route(payload: RouteRequest): Promise<RouteResponse> {
    return this.request<RouteResponse>('POST', '/route', payload);
  }

  async retrieve(payload: RetrieveRequest): Promise<RetrieveResponse> {
    return this.request<RetrieveResponse>('POST', '/retrieve', payload);
  }

  async chat(payload: ChatTurnRequest): Promise<ChatTurnResponse> {
    return this.request<ChatTurnResponse>('POST', '/chat', payload);
  }

  private async request<TResponse>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<TResponse> {
    const url = `${this.baseUrl}${path}`;
    this.log(`${method} ${url}`);

    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: method === 'GET' ? undefined : JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as TResponse;
  }

  log(message: string): void {
    this.output.appendLine(`[${new Date().toISOString()}] ${message}`);
  }
}

export async function callBrainTool<TRequest, TResponse>(
  baseUrl: string,
  toolPath: string,
  body: TRequest,
): Promise<TResponse> {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}${toolPath}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Brain tool call failed: ${response.status} ${text}`);
  }

  return (await response.json()) as TResponse;
}
