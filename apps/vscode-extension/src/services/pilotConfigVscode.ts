import * as vscode from 'vscode';
import type { ChatTurnRequest, ChatTurnResponse } from '@migrapilot/shared-types';
import { type BackendMode } from './backendRouter.js';
import { type LocalChatBackend, type LocalChatResult } from './backendRouter.js';
import { BrainClient } from './brainClient.js';
import { type PilotApiConfig } from '@migrapilot/pilot-client';
import { type TokenStore } from './tokenStore.js';

// VS Code-backed adapters for the (vscode-free) transport core. Kept in a
// separate file so the unit-testable modules never import `vscode`.
//
// SECRET SAFETY: the JWT is read from SecretStorage (or a settings fallback) and
// handed to the transport as a Bearer header. It is NEVER written to settings,
// logs, the output channel, telemetry, or error text by this layer.

const SECRET_KEY = 'migrapilot.pilotApiToken';

/** Maps the `migrapilot.mode` setting (incl. legacy aliases) to a canonical
 * BackendMode. Legacy values resolve conservatively so remote is strictly
 * opt-in and the current local-only behavior is preserved by default. */
export function resolveMode(raw: string | undefined): BackendMode {
  switch (raw) {
    case 'remote-pilot':
    case 'cloud': // legacy: explicit remote intent
      return 'remote-pilot';
    case 'auto':
      return 'auto';
    case 'local-brain':
    case 'offline': // legacy
    case 'hybrid': // legacy default — kept local so remote stays opt-in
    default:
      return 'local-brain';
  }
}

export function getMode(): BackendMode {
  return resolveMode(vscode.workspace.getConfiguration('migrapilot').get<string>('mode'));
}

/**
 * TokenStore over VS Code SecretStorage. A non-secret settings fallback
 * (`migrapilot.pilotApiToken`) is honored ONLY when the secret is empty, for
 * headless/dev; production writes go to SecretStorage.
 */
export class VscodeSecretTokenStore implements TokenStore {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  async get(): Promise<string | undefined> {
    const secret = await this.secrets.get(SECRET_KEY);
    if (secret) {
      return secret;
    }
    const fallback = vscode.workspace.getConfiguration('migrapilot').get<string>('pilotApiToken');
    return fallback && fallback.trim() ? fallback.trim() : undefined;
  }

  async set(token: string): Promise<void> {
    await this.secrets.store(SECRET_KEY, token);
  }

  async delete(): Promise<void> {
    await this.secrets.delete(SECRET_KEY);
  }
}

/** PilotApiConfig backed by workspace settings + SecretStorage token. */
export class VscodePilotApiConfig implements PilotApiConfig {
  constructor(
    private readonly tokenStore: TokenStore,
    private readonly output: vscode.OutputChannel,
  ) {}

  private cfg() {
    return vscode.workspace.getConfiguration('migrapilot');
  }

  baseUrl(): string {
    return String(this.cfg().get('pilotApiUrl', 'http://127.0.0.1:3377')).replace(/\/+$/, '');
  }

  authMode(): 'bearer' | 'none' {
    return this.cfg().get<string>('pilotApiAuthMode', 'bearer') === 'none' ? 'none' : 'bearer';
  }

  timeoutMs(): number {
    const v = Number(this.cfg().get('requestTimeoutMs', 30000));
    return Number.isFinite(v) && v > 0 ? v : 30000;
  }

  token(): Promise<string | undefined> {
    return this.tokenStore.get();
  }

  log(message: string): void {
    // Transport only logs method/url/requestId — never the token.
    this.output.appendLine(`[${new Date().toISOString()}] ${message}`);
  }
}

/** LocalChatBackend over the existing brain-service client. */
export class VscodeLocalChatBackend implements LocalChatBackend {
  constructor(private readonly brain: BrainClient) {}

  async chat(request: unknown): Promise<LocalChatResult> {
    const res: ChatTurnResponse = await this.brain.chat(request as ChatTurnRequest);
    return {
      content: res.content,
      citations: res.citations?.map((c) => ({
        path: c.path,
        startLine: c.startLine,
        endLine: c.endLine,
      })),
    };
  }
}
