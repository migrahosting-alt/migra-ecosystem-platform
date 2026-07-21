// MCP client hub + capability bridge, exercised against a REAL MCP server over an
// in-memory transport — no spawned process, but the actual SDK client/server
// handshake, listTools and callTool paths.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { McpHub, parseMcpConfig } from '../src/mcp/mcpHub.js';
import {
  mcpToolToCapability,
  mcpCapabilityId,
  schemaFromJsonSchema,
  MCP_GRANT,
} from '../src/mcp/mcpCapabilities.js';

/** A minimal real MCP server: one read-only tool, one mutating tool. */
function fakeServer(): Server {
  const server = new Server({ name: 'fake', version: '1.0.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'echo',
        description: 'Echo the message back.',
        inputSchema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] },
        annotations: { readOnlyHint: true },
      },
      {
        name: 'write_note',
        description: 'Write a note (mutating).',
        inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
        annotations: { readOnlyHint: false },
      },
    ],
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    if (req.params.name === 'echo') {
      return { content: [{ type: 'text', text: `echo: ${req.params.arguments?.message}` }] };
    }
    return { content: [{ type: 'text', text: 'wrote note' }] };
  });
  return server;
}

/** A hub whose transport is one half of an in-memory pair; the server runs on the
 * other half. Real handshake, no process. */
async function connectedHub(): Promise<McpHub> {
  const hub = new McpHub(async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await fakeServer().connect(serverTransport);
    return clientTransport;
  });
  const outcomes = await hub.connectAll(parseMcpConfig({ servers: { fake: { command: 'noop' } } }));
  assert.deepEqual(outcomes, [{ server: 'fake', ok: true, tools: 2 }]);
  return hub;
}

test('connects to a real MCP server and lists its tools', async () => {
  const hub = await connectedHub();
  const tools = hub.tools();
  assert.equal(tools.length, 2);
  assert.equal(tools.find((t) => t.name === 'echo')?.readOnly, true);
  assert.equal(tools.find((t) => t.name === 'write_note')?.readOnly, false);
  await hub.close();
});

test('calls a tool end-to-end and returns its content', async () => {
  const hub = await connectedHub();
  const res = (await hub.callTool('fake', 'echo', { message: 'hi' })) as { content: Array<{ text: string }> };
  assert.equal(res.content[0]!.text, 'echo: hi');
  await hub.close();
});

test('an unknown server or tool is a clear error, not a silent null', async () => {
  const hub = await connectedHub();
  await assert.rejects(() => hub.callTool('nope', 'echo', {}), /not connected/);
  await assert.rejects(() => hub.callTool('fake', 'nope', {}), /has no tool/);
  await hub.close();
});

test('one failing server never blocks the others', async () => {
  let n = 0;
  const hub = new McpHub(async (name) => {
    n += 1;
    if (name === 'bad') throw new Error('spawn failed');
    const [c, srv] = InMemoryTransport.createLinkedPair();
    await fakeServer().connect(srv);
    return c;
  });
  const outcomes = await hub.connectAll(parseMcpConfig({ servers: { bad: { command: 'x' }, good: { command: 'y' } } }));
  assert.equal(outcomes.find((o) => o.server === 'bad')?.ok, false);
  assert.equal(outcomes.find((o) => o.server === 'good')?.ok, true);
  assert.equal(hub.tools().length, 2, 'the good server still contributed its tools');
  await hub.close();
});

test('a disabled server is skipped entirely', async () => {
  const hub = new McpHub(async () => {
    throw new Error('must not connect a disabled server');
  });
  const outcomes = await hub.connectAll(parseMcpConfig({ servers: { off: { command: 'x', enabled: false } } }));
  assert.deepEqual(outcomes, []);
  await hub.close();
});

// ── the capability bridge ────────────────────────────────────────────────────

test('a read-only MCP tool becomes an approval-free capability; mutating needs approval', async () => {
  const hub = await connectedHub();
  const caps = hub.tools().map((t) => mcpToolToCapability(t, hub));

  const echo = caps.find((c) => c.descriptor.id === 'mcp.fake.echo')!;
  assert.equal(echo.descriptor.readOnly, true);
  assert.equal(echo.descriptor.approvalRequired, false);
  assert.equal(echo.descriptor.category, 'mcp');
  assert.deepEqual(echo.descriptor.requiredCapabilities, [MCP_GRANT]);

  const write = caps.find((c) => c.descriptor.id === 'mcp.fake.write_note')!;
  assert.equal(write.descriptor.readOnly, false);
  assert.equal(write.descriptor.approvalRequired, true, 'a mutating MCP tool must be approval-gated');
  await hub.close();
});

test('the capability handler actually invokes the tool', async () => {
  const hub = await connectedHub();
  const echo = mcpToolToCapability(hub.tools().find((t) => t.name === 'echo')!, hub);
  const res = (await echo.handler({ message: 'yo' })) as { content: Array<{ text: string }> };
  assert.equal(res.content[0]!.text, 'echo: yo');
  await hub.close();
});

test('the capability description marks its MCP origin (untrusted text)', async () => {
  const hub = await connectedHub();
  const echo = mcpToolToCapability(hub.tools().find((t) => t.name === 'echo')!, hub);
  assert.match(echo.descriptor.description, /^\[MCP:fake\]/);
  await hub.close();
});

// ── pure helpers ─────────────────────────────────────────────────────────────

test('ids are namespaced and sanitised so they never collide with built-ins', () => {
  assert.equal(mcpCapabilityId('play wright', 'browser/click'), 'mcp.play_wright.browser_click');
});

test('schemaFromJsonSchema enforces the top-level shape and passes extras through', () => {
  const schema = schemaFromJsonSchema({ type: 'object', properties: { a: {} }, required: ['a'] });
  assert.equal(schema.safeParse({ a: 1, extra: true }).success, true, 'required present + extras allowed');
  assert.equal(schema.safeParse({ b: 2 }).success, false, 'missing required key is rejected');
  assert.equal(schema.safeParse('not an object').success, false);
  // No usable schema → accept any object rather than block the call.
  assert.equal(schemaFromJsonSchema(undefined).safeParse({ anything: 1 }).success, true);
});

test('broken config never throws — it yields no servers', () => {
  assert.deepEqual(parseMcpConfig('garbage').servers, {});
  assert.deepEqual(parseMcpConfig({ servers: 'nope' }).servers, {});
  assert.deepEqual(parseMcpConfig(null).servers, {});
});

// ── runtime wiring ───────────────────────────────────────────────────────────

test('startMcp registers connected tools and grants the mcp token', async () => {
  const { startMcp } = await import('../src/mcp/mcpRuntime.js');
  const registered: string[] = [];
  const grants: string[] = [];
  const registry = {
    registerMcp: (caps: ReadonlyArray<{ descriptor: { id: string } }>) => {
      for (const c of caps) registered.push(c.descriptor.id);
      return caps.length;
    },
    grant: (t: string) => grants.push(t),
  };
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const cfgPath = path.join(os.tmpdir(), `mcp-${Date.now()}.json`);
  fs.writeFileSync(cfgPath, JSON.stringify({ servers: { fake: { command: 'noop' } } }));

  const res = await startMcp(registry, cfgPath, {
    transportFactory: async () => {
      const [c, srv] = InMemoryTransport.createLinkedPair();
      await fakeServer().connect(srv);
      return c;
    },
  });

  assert.equal(res.registered, 2);
  assert.deepEqual(registered.sort(), ['mcp.fake.echo', 'mcp.fake.write_note']);
  assert.deepEqual(grants, [MCP_GRANT], 'tools are useless without the grant');
  await res.hub?.close();
});

test('no config means MCP is simply off — never an error', async () => {
  const { startMcp } = await import('../src/mcp/mcpRuntime.js');
  const registry = { registerMcp: () => 0, grant: () => {} };
  const res = await startMcp(registry, undefined, {
    transportFactory: async () => {
      throw new Error('must not connect');
    },
  });
  assert.deepEqual(res, { hub: null, servers: [], registered: 0 });
});

test('an unreadable or malformed config disables MCP rather than crashing the brain', async () => {
  const { startMcp, loadMcpConfig } = await import('../src/mcp/mcpRuntime.js');
  assert.deepEqual(loadMcpConfig('/definitely/not/here.json').servers, {});
  const registry = { registerMcp: () => 0, grant: () => {} };
  const res = await startMcp(registry, '/definitely/not/here.json', {
    transportFactory: async () => {
      throw new Error('must not connect');
    },
  });
  assert.equal(res.registered, 0);
});
