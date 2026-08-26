import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

import type { Classification, Finding } from "./types";

export interface HidsEdrEvent {
  eventId: string;
  agentId?: string;
  ts: string;
  host: string;
  severity: Finding["severity"];
  indicator: string;
  details: string;
  classification?: Classification;
  tenantId?: string;
}

const MAX_READ_EVENTS = 500;
const DEFAULT_FILE = path.resolve(process.cwd(), ".data", "hids-edr-events.jsonl");

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asClassification(value: unknown): Classification | undefined {
  if (value === "internal" || value === "client") {
    return value;
  }
  return undefined;
}

function asSeverity(value: unknown): Finding["severity"] {
  if (value === "critical" || value === "warn" || value === "info") {
    return value;
  }
  const normalized = asString(value)?.toLowerCase() ?? "";
  if (["high", "severe", "alert", "fatal", "emergency"].includes(normalized)) {
    return "critical";
  }
  if (["medium", "warning", "suspicious", "notice"].includes(normalized)) {
    return "warn";
  }
  return "info";
}

function buildEventId(input: {
  ts: string;
  host: string;
  indicator: string;
  details: string;
  agentId?: string;
}): string {
  const key = `${input.agentId ?? ""}|${input.ts}|${input.host}|${input.indicator}|${input.details}`;
  return `evt_${createHash("sha256").update(key).digest("hex").slice(0, 24)}`;
}

export function normalizeHidsEdrEvent(input: unknown): HidsEdrEvent | null {
  const row = asRecord(input);
  const tsValue = asString(row.ts) ?? asString(row.timestamp) ?? asString(row.detectedAt);
  const ts = tsValue ? new Date(tsValue) : null;
  if (!ts || Number.isNaN(ts.getTime())) {
    return null;
  }

  const host = asString(row.host) ?? asString(row.hostname) ?? "unknown-host";
  const indicator = asString(row.indicator) ?? asString(row.type) ?? asString(row.rule) ?? "unknown-indicator";
  const details = asString(row.details) ?? asString(row.message) ?? "HIDS/EDR event detected";
  const agentId = asString(row.agentId) ?? undefined;
  const eventId = asString(row.eventId) ?? buildEventId({
    ts: ts.toISOString(),
    host,
    indicator,
    details,
    agentId
  });

  return {
    eventId,
    agentId,
    ts: ts.toISOString(),
    host,
    severity: asSeverity(row.severity),
    indicator,
    details,
    classification: asClassification(row.classification),
    tenantId: asString(row.tenantId) ?? undefined
  };
}

export function getHidsEdrEventPath(): string {
  return process.env.MIGRAPILOT_HIDS_EDR_EVENT_PATH?.trim() || DEFAULT_FILE;
}

export async function appendHidsEdrEvents(events: HidsEdrEvent[], filePath = getHidsEdrEventPath()): Promise<void> {
  if (events.length === 0) {
    return;
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const payload = events.map((event) => JSON.stringify(event)).join("\n") + "\n";
  await fs.appendFile(filePath, payload, "utf8");
}

async function readJsonArray(filePath: string): Promise<unknown[]> {
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) {
    return parsed;
  }
  if (parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>).events)) {
    return (parsed as Record<string, unknown>).events as unknown[];
  }
  return [];
}

async function readJsonLines(filePath: string): Promise<unknown[]> {
  const raw = await fs.readFile(filePath, "utf8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((row): row is unknown => row !== null);
}

export async function readHidsEdrEvents(filePath = getHidsEdrEventPath()): Promise<HidsEdrEvent[]> {
  try {
    const rows = filePath.endsWith(".jsonl") ? await readJsonLines(filePath) : await readJsonArray(filePath);
    const normalized = rows
      .map((row) => normalizeHidsEdrEvent(row))
      .filter((row): row is HidsEdrEvent => Boolean(row));
    return normalized.slice(-MAX_READ_EVENTS);
  } catch {
    return [];
  }
}
