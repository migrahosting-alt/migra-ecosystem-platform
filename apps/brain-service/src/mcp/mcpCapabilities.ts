// Turn MCP tools into agent capabilities so they run through the SAME funnel as
// every built-in tool: availability, schema validation, approval, audit.
//
// Safety posture (owner decision): mutating MCP tools are exposed but require
// approval; only tools a server marks read-only run without it. Since the
// engineer loop cannot yet hold an approval, a mutating MCP tool is registered
// and visible but refuses to run in-loop for now — identical to edit.apply —
// and becomes runnable when the approval-resume slice lands.

import { z, type ZodType } from 'zod';
import type { McpHub, McpToolInfo } from './mcpHub.js';

/** A capability shape compatible with the registry's runnable entries. Kept
 * structural (not importing the registry) so the registry can depend on this,
 * not the other way round. */
export interface McpRunnableCapability {
  descriptor: {
    kind: 'tool';
    id: string;
    displayName: string;
    description: string;
    category: 'mcp';
    requiredCapabilities: string[];
    readOnly: boolean;
    approvalRequired: boolean;
  };
  inputSchema: ZodType;
  handler: (input: unknown) => Promise<unknown>;
}

/** Grant that must be held for any MCP tool to be available. Off unless the
 * deployment explicitly adds it, so MCP is opt-in at the capability layer too. */
export const MCP_GRANT = 'mcp.call';

/** Namespaced id: `mcp.<server>.<tool>`. Server and tool are sanitised to the
 * id charset so a server's naming can never collide with a built-in id. */
export function mcpCapabilityId(server: string, tool: string): string {
  const clean = (s: string): string => s.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `mcp.${clean(server)}.${clean(tool)}`;
}

/** A permissive Zod validator derived from a tool's JSON Schema.
 *
 * A full JSON-Schema→Zod compiler is a rabbit hole and the MCP SERVER validates
 * its own arguments anyway, so this only enforces the top-level shape: an object,
 * with required keys present. That rejects obvious malformed calls at our funnel
 * while leaving detailed validation to the server that owns the contract. */
export function schemaFromJsonSchema(jsonSchema: unknown): ZodType {
  const js = (jsonSchema ?? {}) as { type?: unknown; required?: unknown; properties?: unknown };
  if (js.type !== 'object' || typeof js.properties !== 'object' || js.properties === null) {
    // No usable object schema — accept any object (server will validate).
    return z.record(z.unknown());
  }
  const required = Array.isArray(js.required) ? js.required.filter((k): k is string => typeof k === 'string') : [];
  const shape: Record<string, ZodType> = {};
  for (const key of Object.keys(js.properties as Record<string, unknown>)) {
    // A required key must be PRESENT; z.unknown() alone accepts a missing key.
    shape[key] = required.includes(key)
      ? z.unknown().refine((v) => v !== undefined, { message: `"${key}" is required` })
      : z.unknown().optional();
  }
  // passthrough: extra properties are allowed — the server may accept more than
  // it advertises, and we are not the source of truth for its contract.
  return z.object(shape).passthrough();
}

/** Wrap one MCP tool as a registry-compatible capability. */
export function mcpToolToCapability(tool: McpToolInfo, hub: McpHub): McpRunnableCapability {
  return {
    descriptor: {
      kind: 'tool',
      id: mcpCapabilityId(tool.server, tool.name),
      displayName: `${tool.server}: ${tool.name}`,
      // Server-provided text is UNTRUSTED (it reaches the model's prompt). Kept
      // as-is for usefulness but prefixed so its origin is unambiguous.
      description: `[MCP:${tool.server}] ${tool.description}`.slice(0, 400),
      category: 'mcp',
      requiredCapabilities: [MCP_GRANT],
      readOnly: tool.readOnly,
      // Read-only tools run immediately; everything else needs approval. Unknown
      // read-only status already resolved to false in the hub, so this is safe.
      approvalRequired: !tool.readOnly,
    },
    inputSchema: schemaFromJsonSchema(tool.inputSchema),
    handler: (input) => hub.callTool(tool.server, tool.name, input),
  };
}

/** All connected MCP tools as capabilities. */
export function mcpCapabilities(hub: McpHub): McpRunnableCapability[] {
  return hub.tools().map((t) => mcpToolToCapability(t, hub));
}
