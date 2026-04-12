"use client";

import { pilotApiUrl } from "../shared/pilot-api";

/* ── Types ── */

export interface V1Command {
  command: string;
  label: string;
  description: string;
  riskTier: number;
  capability: string;
  category: string;
  mutating: boolean;
}

export interface V1PlanResponse {
  ok: boolean;
  command: string;
  label: string;
  description: string;
  riskTier: number;
  requiredCapability: string;
  category: string;
  mutating: boolean;
  authorized: boolean;
  approvalRequired: boolean;
  denyReason?: string;
}

export interface V1RunSummary {
  id: string;
  actorId: string;
  command: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  error: string | null;
}

export interface V1RunEvent {
  id: string;
  seq: number;
  type: string;
  level: string;
  message: string;
  payload: unknown;
  durationMs: number | null;
  timestamp: string;
}

export interface V1RunDetail {
  id: string;
  actorId: string;
  command: string;
  status: string;
  dryRun: boolean;
  riskTier: number;
  capability: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  error: string | null;
  result: unknown;
  events: V1RunEvent[];
  artifactCount: number;
}

export interface V1Health {
  ok: boolean;
  overall: string;
  api: { status: string; uptime: number };
  database: { status: string; latencyMs: number };
  stats: {
    operators: number;
    executionRuns: number;
    activeIncidents: number;
  };
  checkedAt: string;
  durationMs: number;
}

export interface V1ExecuteResponse {
  ok: boolean;
  runId: string;
  command: string;
  status: string;
  result?: unknown;
  denyReason?: string;
  durationMs: number;
  steps: Array<{
    step: string;
    status: "ok" | "failed" | "skipped";
    durationMs: number;
    detail?: string;
  }>;
}

/* ── API calls ── */

async function v1Get<T>(path: string): Promise<T> {
  const res = await fetch(pilotApiUrl(`/api/pilot/v1${path}`), {
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

async function v1Post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(pilotApiUrl(`/api/pilot/v1${path}`), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body != null ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  return data as T;
}

export function fetchCommands(): Promise<{
  ok: boolean;
  role: string;
  commandCount: number;
  commands: V1Command[];
}> {
  return v1Get("/commands?all=true");
}

export function fetchPlan(command: string): Promise<V1PlanResponse> {
  return v1Post("/plan", { command });
}

export function executeCommand(
  command: string,
  dryRun = false,
): Promise<V1ExecuteResponse> {
  return v1Post("/execute", { command, dryRun });
}

export function fetchRuns(params?: {
  limit?: number;
  offset?: number;
  status?: string;
  command?: string;
}): Promise<{
  ok: boolean;
  total: number;
  limit: number;
  offset: number;
  runs: V1RunSummary[];
}> {
  const qs = new URLSearchParams();
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.offset) qs.set("offset", String(params.offset));
  if (params?.status) qs.set("status", params.status);
  if (params?.command) qs.set("command", params.command);
  const query = qs.toString();
  return v1Get(`/runs${query ? `?${query}` : ""}`);
}

export function fetchRunDetail(id: string): Promise<{ ok: boolean; run: V1RunDetail }> {
  return v1Get(`/runs/${encodeURIComponent(id)}`);
}

export function fetchHealth(): Promise<V1Health> {
  return v1Get("/health");
}

/* ── Resource Graph API ── */

export interface V1GraphNode {
  id: string;
  nodeType: string;
  displayName: string;
  product: string | null;
  environment: string | null;
  status: string;
  orgId: string | null;
}

export interface V1GraphNodesResponse {
  ok: boolean;
  nodeCount: number;
  typeBreakdown: Record<string, number>;
  nodes: V1GraphNode[];
}

export interface V1ImpactResponse {
  ok: boolean;
  node: { id: string; nodeType: string; displayName: string; product: string | null; status: string };
  blastRadius: string;
  impactedCount: number;
  impactedResources: Array<{
    id: string;
    nodeType: string;
    displayName: string;
    status: string;
    product: string | null;
    relationship: string;
  }>;
}

export interface V1DependenciesResponse {
  ok: boolean;
  node: { id: string; nodeType: string; displayName: string; product: string | null; status: string };
  dependencyCount: number;
  dependencies: Array<{
    id: string;
    nodeType: string;
    displayName: string;
    status: string;
    product: string | null;
    relationship: string;
  }>;
}

export function fetchGraphNodes(): Promise<V1GraphNodesResponse> {
  return v1Get("/graph/nodes");
}

export function fetchImpact(nodeId: string): Promise<V1ImpactResponse> {
  return v1Get(`/graph/impact/${encodeURIComponent(nodeId)}`);
}

export function fetchDependencies(nodeId: string): Promise<V1DependenciesResponse> {
  return v1Get(`/graph/dependencies/${encodeURIComponent(nodeId)}`);
}

/* ── Audit API ── */

export interface V1AuditEntry {
  id: string;
  runId: string | null;
  actorId: string;
  actorType: string;
  command: string;
  target: string | null;
  result: string;
  timestamp: string;
}

export function fetchAuditLog(params?: {
  limit?: number;
  offset?: number;
  command?: string;
}): Promise<{
  ok: boolean;
  total: number;
  limit: number;
  offset: number;
  entries: V1AuditEntry[];
}> {
  const qs = new URLSearchParams();
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.offset) qs.set("offset", String(params.offset));
  if (params?.command) qs.set("command", params.command);
  const query = qs.toString();
  return v1Get(`/audit${query ? `?${query}` : ""}`);
}

/* ── Edge API ── */

export interface V1EdgeRoute {
  id: string;
  domain: string;
  path: string;
  upstream: string;
  tlsPolicy: string;
  status: string;
  server: string;
}

export interface V1DomainRecord {
  id: string;
  domain: string;
  status: string;
  dnsManaged: boolean;
  sslStatus: string;
  sslExpiry: string | null;
}

export function fetchEdges(): Promise<{
  ok: boolean;
  routes: { total: number; active: number; items: V1EdgeRoute[] };
  domains: { total: number; items: V1DomainRecord[] };
}> {
  return v1Get("/edges");
}
