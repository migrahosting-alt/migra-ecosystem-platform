import * as vscode from "vscode";

import { getBrainClientConfig, getConfiguredAuthToken, normalizeBrainUrl } from "./brainClient.js";

function isMigraPilotMcpEnabled(): boolean {
  return vscode.workspace
    .getConfiguration("migrapilot")
    .get<boolean>("mcp.enabled", false);
}

export function registerMcpServerProvider(context: vscode.ExtensionContext, output: vscode.OutputChannel): void {
  const registerProvider = vscode.lm?.registerMcpServerDefinitionProvider;
  if (!registerProvider || !vscode.McpStdioServerDefinition) {
    output.appendLine("[mcp] VS Code MCP provider API is unavailable in this VS Code build.");
    return;
  }

  const provider: vscode.McpServerDefinitionProvider<vscode.McpStdioServerDefinition> = {
    provideMcpServerDefinitions() {
      if (!isMigraPilotMcpEnabled()) {
        return [];
      }

      const cfg = getBrainClientConfig();
      const env: Record<string, string> = {
        MIGRAPILOT_BRAIN_URL: normalizeBrainUrl(cfg.baseUrl),
      };
      const token = getConfiguredAuthToken(cfg);
      if (token) {
        env.MIGRAPILOT_AUTH_TOKEN = token;
      }

      const script = vscode.Uri.joinPath(context.extensionUri, "mcp", "migrapilot-mcp.mjs");
      const definition = new vscode.McpStdioServerDefinition(
        "MigraPilot",
        process.execPath,
        [script.fsPath],
        env,
        "0.4.1",
      );
      definition.cwd = context.extensionUri;
      return [definition];
    },
  };

  context.subscriptions.push(
    registerProvider("migrateck.migrapilot.mcp", provider),
  );
}
