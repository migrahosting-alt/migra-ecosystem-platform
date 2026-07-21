// MCP client hub — connects MigraPilot's agent to Model Context Protocol servers
// so it can use the SAME external tools an editor like Copilot does (Prisma,
// Playwright, Python tooling, …) instead of each being hand-built here.
//
// Scope of this slice: connect to configured servers, list their tools, and call
// one. Turning those tools into agent capabilities lives in mcpCapabilities.ts;
// the approval flow for MUTATING tools is a later slice (they are registered and
// visible now, but the engineer loop refuses to run an approval-required tool
// in-loop, exactly as it already refuses edit.apply).
//
// The transport is INJECTED so the whole path is testable in-memory against a
// real MCP server, without spawning a process.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { z } from 'zod';

/** One configured server. `command`/`args` describe a local stdio process; the
 * real transport is built by the caller so tests can inject an in-memory one. */
export const McpServerConfigSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  /** Turn a configured server off without deleting it. */
  enabled: z.boolean().optional(),
});

export const McpConfigSchema = z.object({
  servers: z.record(McpServerConfigSchema).default({}),
});

export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;
export type McpConfig = z.infer<typeof McpConfigSchema>;

/** A tool as advertised by a server, already namespaced by server. */
export interface McpToolInfo {
  server: string;
  name: string;
  description: string;
  /** JSON Schema for the tool's arguments (as the server declares it). */
  inputSchema: unknown;
  /** MCP annotations — `readOnlyHint` decides whether the tool is safe to run
   * without approval. Absent/unknown is treated as NOT read-only. */
  readOnly: boolean;
}

/** How to open a connection for a server. Injected so tests use InMemoryTransport
 * and production uses a stdio child process. */
export type TransportFactory = (name: string, config: McpServerConfig) => Promise<Transport>;

interface Connected {
  client: Client;
  tools: McpToolInfo[];
}

const CALL_TIMEOUT_MS = 30_000;

/** Parse+validate raw config text. Never throws on shape — returns empty servers
 * for anything unusable, because a broken MCP config must not break the engine. */
export function parseMcpConfig(raw: unknown): McpConfig {
  const parsed = McpConfigSchema.safeParse(raw);
  return parsed.success ? parsed.data : { servers: {} };
}

export class McpHub {
  private readonly connected = new Map<string, Connected>();

  constructor(private readonly connect: TransportFactory) {}

  /** Connect every ENABLED server, list its tools, and remember it. A server
   * that fails to connect is skipped with its error — one bad server never
   * blocks the others or the engine. Returns per-server outcomes. */
  async connectAll(config: McpConfig): Promise<Array<{ server: string; ok: boolean; tools: number; error?: string }>> {
    const results: Array<{ server: string; ok: boolean; tools: number; error?: string }> = [];
    for (const [name, cfg] of Object.entries(config.servers)) {
      if (cfg.enabled === false) continue;
      try {
        const transport = await this.connect(name, cfg);
        const client = new Client({ name: 'migrapilot', version: '0.1.0' }, { capabilities: {} });
        await client.connect(transport);
        const listed = await client.listTools();
        const tools: McpToolInfo[] = (listed.tools ?? []).map((t) => ({
          server: name,
          name: t.name,
          description: t.description ?? '',
          inputSchema: t.inputSchema,
          readOnly: Boolean(t.annotations?.readOnlyHint),
        }));
        this.connected.set(name, { client, tools });
        results.push({ server: name, ok: true, tools: tools.length });
      } catch (err) {
        results.push({ server: name, ok: false, tools: 0, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return results;
  }

  /** Every tool across every connected server, namespaced. */
  tools(): McpToolInfo[] {
    return [...this.connected.values()].flatMap((c) => c.tools);
  }

  /** Call a tool by server + name. The server does its own argument validation;
   * a call to an unknown server/tool or a crashed connection throws. */
  async callTool(server: string, name: string, args: unknown): Promise<unknown> {
    const conn = this.connected.get(server);
    if (!conn) throw new Error(`MCP server "${server}" is not connected`);
    if (!conn.tools.some((t) => t.name === name)) throw new Error(`MCP server "${server}" has no tool "${name}"`);
    const res = await conn.client.callTool(
      { name, arguments: (args ?? {}) as Record<string, unknown> },
      undefined,
      { timeout: CALL_TIMEOUT_MS },
    );
    return res;
  }

  async close(): Promise<void> {
    for (const { client } of this.connected.values()) {
      try {
        await client.close();
      } catch {
        /* a server that will not close cleanly must not block shutdown */
      }
    }
    this.connected.clear();
  }
}
