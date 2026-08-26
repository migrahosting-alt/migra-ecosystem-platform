import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface HidsEdrAgent {
  agentId: string;
  name: string;
  host: string;
  os: string;
  certificatePem?: string;
  publicKey?: string;
  tokenHash: string;
  createdAt: string;
  updatedAt: string;
  lastHeartbeatAt?: string;
  heartbeatStatus?: "healthy" | "degraded" | "offline";
}

interface AgentStore {
  agents: HidsEdrAgent[];
}

const storePath = path.resolve(process.cwd(), ".data", "hids-edr-agents.json");

function ensureStore(): void {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  if (!fs.existsSync(storePath)) {
    const initial: AgentStore = { agents: [] };
    fs.writeFileSync(storePath, JSON.stringify(initial, null, 2), "utf8");
  }
}

function readStore(): AgentStore {
  ensureStore();
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath, "utf8")) as AgentStore;
    const agents = Array.isArray(parsed?.agents) ? parsed.agents : [];
    return { agents };
  } catch {
    return { agents: [] };
  }
}

function writeStore(store: AgentStore): void {
  ensureStore();
  fs.writeFileSync(storePath, JSON.stringify(store, null, 2), "utf8");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createEnrollment(input: {
  name: string;
  host: string;
  os: string;
  certificatePem?: string;
  publicKey?: string;
}): { agent: HidsEdrAgent; token: string } {
  const store = readStore();
  const now = new Date().toISOString();
  const token = `hedr_${randomUUID()}_${randomUUID()}`;

  const agent: HidsEdrAgent = {
    agentId: `agent_${randomUUID()}`,
    name: input.name,
    host: input.host,
    os: input.os,
    certificatePem: input.certificatePem,
    publicKey: input.publicKey,
    tokenHash: hashToken(token),
    createdAt: now,
    updatedAt: now,
    heartbeatStatus: "healthy"
  };

  store.agents.unshift(agent);
  store.agents = store.agents.slice(0, 5000);
  writeStore(store);

  return { agent, token };
}

export function listAgents(limit = 200): HidsEdrAgent[] {
  const store = readStore();
  return store.agents.slice(0, Math.max(1, Math.min(5000, limit)));
}

export function verifyAgentToken(agentId: string, token: string): HidsEdrAgent | null {
  const store = readStore();
  const agent = store.agents.find((entry) => entry.agentId === agentId);
  if (!agent) {
    return null;
  }
  if (agent.tokenHash !== hashToken(token)) {
    return null;
  }
  return agent;
}

export function updateHeartbeat(input: {
  agentId: string;
  status: "healthy" | "degraded" | "offline";
}): HidsEdrAgent | null {
  const store = readStore();
  const now = new Date().toISOString();
  const index = store.agents.findIndex((entry) => entry.agentId === input.agentId);
  if (index < 0) {
    return null;
  }

  const next: HidsEdrAgent = {
    ...store.agents[index],
    updatedAt: now,
    lastHeartbeatAt: now,
    heartbeatStatus: input.status
  };
  store.agents[index] = next;
  writeStore(store);
  return next;
}

export function getAgentStorePath(): string {
  return storePath;
}
