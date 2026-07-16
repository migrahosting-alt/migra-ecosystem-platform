import * as vscode from 'vscode';
import type { ChatTurnRequest } from '@migrapilot/shared-types';
import { type ModelProvider, type ProviderMessage } from '../providers/modelProvider.js';
import { type OpenAiCompatConfig } from '../providers/openAiCompatProvider.js';
import { type ProviderKind, type ProviderSelection, collectCompletion, createProvider } from '../providers/providerFactory.js';
import { type LocalChatBackend, type LocalChatResult } from './backendRouter.js';
import { newRequestId } from '@migrapilot/pilot-client';

// VS Code-backed provider configuration. The API key lives in SecretStorage and
// is NEVER written to settings, logs, the output channel, or errors.

const PROVIDER_SECRET_KEY = 'migrapilot.providerApiKey';

export class VscodeProviderKeyStore {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  async get(): Promise<string | undefined> {
    const secret = await this.secrets.get(PROVIDER_SECRET_KEY);
    if (secret) {
      return secret;
    }
    const fallback = vscode.workspace.getConfiguration('migrapilot').get<string>('providerApiKey');
    return fallback && fallback.trim() ? fallback.trim() : undefined;
  }

  set(key: string): Thenable<void> {
    return this.secrets.store(PROVIDER_SECRET_KEY, key);
  }

  delete(): Thenable<void> {
    return this.secrets.delete(PROVIDER_SECRET_KEY);
  }
}

function cfg() {
  return vscode.workspace.getConfiguration('migrapilot');
}

export function getProviderKind(): ProviderKind {
  return cfg().get<string>('provider', 'stub') === 'openai-compat' ? 'openai-compat' : 'stub';
}

function openAiConfig(keys: VscodeProviderKeyStore, output: vscode.OutputChannel): OpenAiCompatConfig {
  return {
    baseUrl: () => String(cfg().get('providerUrl', 'http://127.0.0.1:11434/v1')).replace(/\/+$/, ''),
    apiKey: () => keys.get(),
    model: () => String(cfg().get('providerModel', 'gpt-oss:20b')),
    timeoutMs: () => {
      const v = Number(cfg().get('requestTimeoutMs', 30000));
      return Number.isFinite(v) && v > 0 ? v : 30000;
    },
    log: (message) => output.appendLine(`[${new Date().toISOString()}] ${message}`),
  };
}

export function getProviderSelection(keys: VscodeProviderKeyStore, output: vscode.OutputChannel): ProviderSelection {
  const kind = getProviderKind();
  return kind === 'openai-compat' ? { kind, openAi: openAiConfig(keys, output) } : { kind };
}

/** Build the currently-configured provider (fresh each call so config/key edits
 * take effect). Throws if openai-compat is selected but unconfigured — never a
 * silent stub fallback. */
export function buildActiveProvider(keys: VscodeProviderKeyStore, output: vscode.OutputChannel): ModelProvider {
  return createProvider(getProviderSelection(keys, output));
}

function buildMessages(req: ChatTurnRequest): ProviderMessage[] {
  const messages: ProviderMessage[] = [
    { role: 'system', content: `You are MigraPilot, a workspace-aware coding assistant. Feature: ${req.feature}.` },
  ];
  const ctx = req.context;
  const contextParts: string[] = [];
  if (ctx?.activeFile) {
    contextParts.push(`Active file: ${ctx.activeFile}`);
  }
  if (ctx?.selectionText) {
    contextParts.push(`Selection:\n${ctx.selectionText}`);
  }
  if (ctx?.retrievedChunks?.length) {
    contextParts.push(
      `Relevant code:\n${ctx.retrievedChunks.map((c) => `// ${c.path}\n${c.snippet}`).join('\n\n')}`,
    );
  }
  if (contextParts.length) {
    messages.push({ role: 'user', content: contextParts.join('\n\n') });
  }
  messages.push({ role: 'user', content: req.userPrompt });
  return messages;
}

/** LocalChatBackend backed by the configured model provider. Default provider is
 * the deterministic stub (preserves the current default chat behavior); a
 * configured real provider produces real completions. A provider failure
 * propagates as PilotError — never a silent fall back to stub. */
export class ProviderLocalChatBackend implements LocalChatBackend {
  constructor(private readonly makeProvider: () => ModelProvider) {}

  async chat(request: unknown, signal?: AbortSignal): Promise<LocalChatResult> {
    const req = request as ChatTurnRequest;
    const provider = this.makeProvider();
    const completion = await collectCompletion(
      provider,
      { messages: buildMessages(req), requestId: newRequestId() },
      signal,
    );
    return { content: completion.content };
  }
}
