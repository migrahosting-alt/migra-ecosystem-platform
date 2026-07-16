import * as vscode from 'vscode';
import { BackendRouter } from '../services/backendRouter.js';
import { BrainClient } from '../services/brainClient.js';
import { MigraAiClient } from '../services/migraAiClient.js';
import { EngineDiagnostics } from '../services/engineDiagnostics.js';
import { type ChatSink, runChatTurn, summarizeChatContext } from './chatEngine.js';

export function registerMigraPilotParticipant(
  context: vscode.ExtensionContext,
  brainClient: BrainClient,
  router: BackendRouter,
  migraAiClient: MigraAiClient,
  engineDiagnostics?: EngineDiagnostics,
): void {
  const participant = vscode.chat.createChatParticipant(
    'migrapilot.chat',
    async (request, chatContext, stream, token) => {
      // Adapt the native ChatResponseStream to the backend-agnostic sink. Note:
      // progress() renders a transient spinner line; markdown() would leak the
      // literal "$(sparkle)" codicon syntax (only progress/ThemeIcon expand it),
      // so the engine uses progress() for spinners.
      const sink: ChatSink = {
        progress: (text) => stream.progress(text),
        markdown: (text) => stream.markdown(text),
      };
      await runChatTurn(
        { brainClient, router, migraAiClient, engineDiagnostics },
        sink,
        request.prompt,
        summarizeChatContext(chatContext.history),
        token,
      );
    },
  );

  participant.iconPath = new vscode.ThemeIcon('sparkle');
  context.subscriptions.push(participant);
}
