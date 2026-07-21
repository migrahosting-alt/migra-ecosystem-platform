// Wire MCP into the running brain: load config, connect over real stdio child
// processes, and register the discovered tools as capabilities.
//
// Best-effort and non-fatal: MCP is an ADD-ON. A missing config, a server that
// will not start, or the SDK being unavailable must never stop the brain — the
// built-in tools always work regardless.

import fs from 'node:fs';
import path from 'node:path';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { McpHub, parseMcpConfig, type McpConfig, type McpServerConfig } from './mcpHub.js';
import { mcpCapabilities, MCP_GRANT } from './mcpCapabilities.js';

/** A registry we can register MCP tools into and grant the mcp.call token on. */
export interface McpRegistryTarget {
  registerMcp(caps: ReadonlyArray<{
    descriptor: { id: string; displayName: string; description: string; readOnly: boolean; approvalRequired: boolean; requiredCapabilities: string[] };
    inputSchema: unknown;
    handler: (input: unknown) => Promise<unknown>;
  }>): number;
  /** Add a grant so MCP capabilities become available. */
  grant?(token: string): void;
}

export interface McpStartupResult {
  hub: McpHub | null;
  servers: Array<{ server: string; ok: boolean; tools: number; error?: string }>;
  registered: number;
}

/** Real stdio transport: spawn the configured command as a child process. */
function stdioTransport(_name: string, cfg: McpServerConfig): Promise<Transport> {
  return Promise.resolve(
    new StdioClientTransport({
      command: cfg.command,
      args: cfg.args ?? [],
      env: { ...process.env, ...(cfg.env ?? {}) } as Record<string, string>,
    }),
  );
}

/** Read + parse the MCP config file. Returns empty servers when absent/unreadable
 * — MCP is opt-in and its config is optional. */
export function loadMcpConfig(configPath: string | undefined): McpConfig {
  if (!configPath) return { servers: {} };
  try {
    const raw = fs.readFileSync(path.resolve(configPath), 'utf8');
    return parseMcpConfig(JSON.parse(raw));
  } catch {
    return { servers: {} };
  }
}

/** Connect configured MCP servers and register their tools. Never throws.
 * `transportFactory` is injectable so tests avoid spawning processes. */
export async function startMcp(
  registry: McpRegistryTarget,
  configPath: string | undefined,
  opts: { transportFactory?: (name: string, cfg: McpServerConfig) => Promise<Transport>; log?: (msg: string) => void } = {},
): Promise<McpStartupResult> {
  const log = opts.log ?? (() => {});
  const config = loadMcpConfig(configPath);
  if (Object.keys(config.servers).length === 0) {
    return { hub: null, servers: [], registered: 0 };
  }
  try {
    const hub = new McpHub(opts.transportFactory ?? stdioTransport);
    const servers = await hub.connectAll(config);
    // Owner posture: ALL configured tools always on. Grant the mcp token so they
    // are available, then register them (mutating ones arrive approval-gated).
    registry.grant?.(MCP_GRANT);
    const registered = registry.registerMcp(mcpCapabilities(hub) as never);
    for (const s of servers) {
      log(s.ok ? `mcp: ${s.server} connected (${s.tools} tools)` : `mcp: ${s.server} FAILED — ${s.error}`);
    }
    log(`mcp: registered ${registered} tool(s)`);
    return { hub, servers, registered };
  } catch (err) {
    // The SDK itself failing to load, etc. MCP is optional; the brain continues.
    log(`mcp: disabled — ${err instanceof Error ? err.message : String(err)}`);
    return { hub: null, servers: [], registered: 0 };
  }
}
