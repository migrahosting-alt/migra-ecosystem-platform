import { getAppSession } from "@migrateck/auth-client";
import { NextResponse } from "next/server";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { fetchAuthApi } from "@/lib/auth/api";

type AuditEntry = {
  id: string;
  actor_user_id: string | null;
  actor_type: string | null;
  target_user_id: string | null;
  client_id: string | null;
  event_type: string;
  event_data: Record<string, unknown>;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
};

type AuditResponse = {
  audit_logs: AuditEntry[];
  total: number;
  limit: number;
  offset: number;
};

const EXPORT_CAP = 2_000;
const PAGE_SIZE = 200;

function safeSpreadsheetValue(value: string) {
  const trimmed = value.trimStart();
  return /^[=+\-@]/.test(trimmed) ? "'" + value : value;
}

function csvCell(value: unknown) {
  const text =
    value === null || value === undefined
      ? ""
      : typeof value === "string"
        ? value
        : JSON.stringify(value);
  const safe = safeSpreadsheetValue(text);
  return '"' + safe.replace(/"/g, '""') + '"';
}

function buildBaseParams(input: URLSearchParams) {
  const params = new URLSearchParams();
  for (const key of ["event_type", "user_id", "client_id"] as const) {
    const value = input.get(key)?.trim();
    if (value) params.set(key, value);
  }
  return params;
}

export async function GET(request: Request) {
  ensureAuthClientInitialized();
  const session = await getAppSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!session.permissions.includes("platform.read")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const source = new URL(request.url).searchParams;
  const base = buildBaseParams(source);
  const collected: AuditEntry[] = [];
  let offset = 0;
  let total = 0;

  while (collected.length < EXPORT_CAP) {
    const params = new URLSearchParams(base);
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String(offset));

    const result = await fetchAuthApi<AuditResponse>(
      "/v1/admin/audit?" + params.toString(),
    );

    if (!result.ok) {
      const error =
        result.status === 403
          ? "MigraTeck platform audit authority is required to export global compliance evidence."
          : result.error;
      return NextResponse.json({ error }, { status: result.status });
    }

    total = result.data.total;
    collected.push(...result.data.audit_logs);
    offset += result.data.audit_logs.length;

    if (
      result.data.audit_logs.length === 0 ||
      offset >= result.data.total ||
      collected.length >= EXPORT_CAP
    ) {
      break;
    }
  }

  const rows = collected.slice(0, EXPORT_CAP);
  const header = [
    "id",
    "created_at",
    "event_type",
    "actor_user_id",
    "actor_type",
    "target_user_id",
    "client_id",
    "ip_address",
    "user_agent",
    "event_data",
  ];

  const csv = [
    header.map(csvCell).join(","),
    ...rows.map((entry) =>
      [
        entry.id,
        entry.created_at,
        entry.event_type,
        entry.actor_user_id,
        entry.actor_type,
        entry.target_user_id,
        entry.client_id,
        entry.ip_address,
        entry.user_agent,
        entry.event_data,
      ]
        .map(csvCell)
        .join(","),
    ),
  ].join("\r\n");

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const truncated = total > EXPORT_CAP;

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="migrateck-audit-${stamp}.csv"`,
      "Cache-Control": "no-store",
      "X-MigraTeck-Evidence-Total": String(total),
      "X-MigraTeck-Evidence-Exported": String(rows.length),
      "X-MigraTeck-Evidence-Truncated": truncated ? "true" : "false",
    },
  });
}
