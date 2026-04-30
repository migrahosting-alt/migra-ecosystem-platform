#!/usr/bin/env node

const brainUrl = (process.env.MIGRAPILOT_BRAIN_URL || "http://127.0.0.1:3377").replace(/\/$/, "");
const authToken = process.env.MIGRAPILOT_AUTH_TOKEN || "";

let buffer = Buffer.alloc(0);

const tools = [
  {
    name: "migrapilot_chat",
    description: "Ask MigraPilot to execute or analyze a task using its backend agent loop and tool registry.",
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string", description: "The operator request for MigraPilot." },
        provider: { type: "string", enum: ["auto", "local", "haiku", "sonnet", "opus"], description: "Optional provider override." },
        dryRun: { type: "boolean", description: "When true, ask MigraPilot not to make changes." },
      },
      required: ["message"],
    },
  },
  {
    name: "migrapilot_repo_search",
    description: "Search the MigraPilot workspace through pilot-api repo search.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Text or regex to search for." },
        globs: { type: "array", items: { type: "string" }, description: "Optional glob filters." },
        limit: { type: "number", description: "Maximum matches." },
      },
      required: ["query"],
    },
  },
];

function send(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
}

function result(id, value) {
  send({ jsonrpc: "2.0", id, result: value });
}

function error(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

async function postJson(path, body) {
  const headers = { "content-type": "application/json" };
  if (authToken) headers.authorization = `Bearer ${authToken}`;
  const response = await fetch(`${brainUrl}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error?.message || payload?.error || `HTTP ${response.status}`);
  }
  return payload;
}

async function streamChat(args) {
  const headers = { "content-type": "application/json" };
  if (authToken) headers.authorization = `Bearer ${authToken}`;
  const body = {
    message: String(args.message || ""),
    provider: args.provider && args.provider !== "auto" ? args.provider : undefined,
    dryRun: Boolean(args.dryRun),
  };
  const response = await fetch(`${brainUrl}/api/pilot/chat/stream`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await response.text().catch(() => `HTTP ${response.status}`));
  }
  if (!response.body) throw new Error("No stream body returned by pilot-api.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let event = "";
  let text = "";
  const toolEvents = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith("event: ")) {
        event = line.slice(7).trim();
        continue;
      }
      if (!line.startsWith("data: ")) continue;
      const data = JSON.parse(line.slice(6));
      if (event === "token" && typeof data.text === "string") text += data.text;
      if (event === "tool") toolEvents.push(data);
    }
  }

  return { text, toolEvents };
}

async function callTool(name, args) {
  if (name === "migrapilot_chat") {
    const answer = await streamChat(args || {});
    return {
      content: [
        { type: "text", text: answer.text || JSON.stringify(answer.toolEvents, null, 2) },
      ],
    };
  }

  if (name === "migrapilot_repo_search") {
    const payload = await postJson("/api/pilot/repo/search", args || {});
    return {
      content: [
        { type: "text", text: JSON.stringify(payload, null, 2) },
      ],
    };
  }

  throw new Error(`Unknown tool: ${name}`);
}

async function handle(message) {
  if (!message || typeof message !== "object") return;
  const { id, method, params } = message;

  try {
    if (method === "initialize") {
      result(id, {
        protocolVersion: params?.protocolVersion || "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "migrapilot", version: "0.4.1" },
      });
      return;
    }
    if (method === "tools/list") {
      result(id, { tools });
      return;
    }
    if (method === "tools/call") {
      result(id, await callTool(params?.name, params?.arguments || {}));
      return;
    }
    if (id !== undefined) {
      error(id, -32601, `Unsupported method: ${method}`);
    }
  } catch (err) {
    error(id, -32000, err?.message || String(err));
  }
}

function drain() {
  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) return;

    const header = buffer.slice(0, headerEnd).toString("utf8");
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) {
      buffer = buffer.slice(headerEnd + 4);
      continue;
    }

    const length = Number(match[1]);
    const messageStart = headerEnd + 4;
    const messageEnd = messageStart + length;
    if (buffer.length < messageEnd) return;

    const raw = buffer.slice(messageStart, messageEnd).toString("utf8");
    buffer = buffer.slice(messageEnd);
    Promise.resolve()
      .then(() => handle(JSON.parse(raw)))
      .catch((err) => error(null, -32700, err?.message || String(err)));
  }
}

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  drain();
});

process.stdin.resume();
