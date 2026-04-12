import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  PORTAL_SESSION_COOKIE,
  portalAuthEnabled,
  portalSessionToken,
} from "@/lib/shared/portal-auth";
import { PILOT_API_BASE, OPS_TOKEN } from "@/lib/shared/pilot-api-config";

export const runtime = "nodejs";

type ReleaseCheckPayload = {
  phaseNumber: string;
  baseDir: string;
  blocked: boolean;
  strictPlaceholders: boolean;
  allowIncompleteDecision: boolean;
  errors: string[];
  warnings: string[];
  passes: string[];
  soak?: {
    requiredDurationRaw?: string | null;
    requiredHours?: number | null;
    startTime?: string | null;
    startTimeRaw?: string | null;
    endTime?: string | null;
    endTimeRaw?: string | null;
    expectedEndTime?: string | null;
    elapsedHours?: string | null;
    remainingHours?: string | null;
    durationElapsed?: boolean;
  } | null;
  artifacts?: Record<string, string>;
  blockerDetails?: Array<{
    message: string;
    artifacts: string[];
  }>;
  nextActions?: string[];
  suggestedScripts?: Record<string, string>;
};

type ReleaseCheckReportPayload = {
  type: "release-check";
  label: string;
  phaseNumber: string;
  runner: "migrapilot-console";
  strict: boolean;
  generatedAt: string;
  artifactPaths: string[];
  governance: ReleaseCheckPayload & { exitCode: number };
};

function resolveRepoRoot(): string {
  const cwd = process.cwd();
  const candidates = [
    cwd,
    path.resolve(cwd, ".."),
    path.resolve(cwd, "..", ".."),
    path.resolve(cwd, "..", "..", ".."),
  ];

  const match = candidates.find((candidate) => fs.existsSync(path.join(candidate, "release-check.js")));
  return match ?? cwd;
}

async function ensurePortalAccess(): Promise<boolean> {
  if (!portalAuthEnabled()) {
    return true;
  }

  const store = await cookies();
  const token = store.get(PORTAL_SESSION_COOKIE)?.value ?? "";
  return token === portalSessionToken();
}

function gitInfo(repoRoot: string) {
  const commit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).stdout.trim() || null;
  const branch = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).stdout.trim() || null;
  const dirty = Boolean(spawnSync("git", ["status", "--porcelain"], { cwd: repoRoot, encoding: "utf8" }).stdout.trim());
  return { commit, branch, dirty };
}

function buildStages(payload: ReleaseCheckPayload, durationMs: number) {
  const blockingCount = payload.errors.length;
  const warningCount = payload.warnings.length;
  return [
    {
      name: "release-check",
      ok: !payload.blocked,
      durationMs,
      exitCode: payload.blocked ? 1 : 0,
      timedOut: false,
      summary: payload.blocked ? payload.errors[0] ?? "Blocked" : "Release gate passed",
    },
    {
      name: "blocking-gates",
      ok: blockingCount === 0,
      durationMs: 0,
      exitCode: blockingCount,
      timedOut: false,
      summary: `${blockingCount} blocking gate${blockingCount === 1 ? "" : "s"}`,
    },
    {
      name: "warnings",
      ok: true,
      durationMs: 0,
      exitCode: warningCount,
      timedOut: false,
      summary: `${warningCount} warning${warningCount === 1 ? "" : "s"}`,
    },
  ];
}

function buildGovernanceReport(
  payload: ReleaseCheckPayload,
  phaseNumber: string,
  generatedAt: string,
  exitCode: number,
): ReleaseCheckReportPayload {
  return {
    type: "release-check",
    label: `Phase ${phaseNumber} strict release check`,
    phaseNumber,
    runner: "migrapilot-console",
    strict: true,
    generatedAt,
    artifactPaths: Array.from(
      new Set((payload.blockerDetails ?? []).flatMap((item) => item.artifacts).filter(Boolean)),
    ),
    governance: {
      ...payload,
      exitCode,
    },
  };
}

export async function POST(request: Request) {
  if (!(await ensurePortalAccess())) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const repoRoot = resolveRepoRoot();
  const body = (await request.json().catch(() => ({}))) as { phase?: string };
  const phaseNumber = String(body.phase ?? "36").replace(/[^0-9]/g, "") || "36";
  const releaseCheckPath = path.join(repoRoot, "release-check.js");
  const baseDir = path.join(repoRoot, "docs", "migrapilot", `phase-${phaseNumber}`);
  const startedAt = new Date();

  const result = spawnSync(process.execPath, [releaseCheckPath, baseDir, phaseNumber, "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      RELEASE_STRICT_PLACEHOLDERS: "true",
    },
  });

  if (result.error) {
    return NextResponse.json({ ok: false, error: result.error.message }, { status: 500 });
  }

  const stdout = result.stdout?.trim() ?? "";
  if (!stdout) {
    return NextResponse.json(
      { ok: false, error: result.stderr?.trim() || "release-check returned no output" },
      { status: 500 },
    );
  }

  let payload: ReleaseCheckPayload;
  try {
    payload = JSON.parse(stdout) as ReleaseCheckPayload;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Failed to parse release-check output", detail: stdout },
      { status: 500 },
    );
  }

  const finishedAt = new Date();
  const runId = `release-check-phase-${phaseNumber}-${startedAt.toISOString().replace(/[:.]/g, "-")}`;
  const { commit, branch, dirty } = gitInfo(repoRoot);
  const stages = buildStages(payload, finishedAt.getTime() - startedAt.getTime());
  const governanceReport = buildGovernanceReport(
    payload,
    phaseNumber,
    finishedAt.toISOString(),
    result.status ?? (payload.blocked ? 1 : 0),
  );

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (OPS_TOKEN) {
    headers["x-ops-api-token"] = OPS_TOKEN;
  }
  const cookie = request.headers.get("cookie");
  if (cookie) {
    headers.cookie = cookie;
  }
  const authorization = request.headers.get("authorization");
  if (authorization) {
    headers.authorization = authorization;
  }

  const ledgerResponse = await fetch(`${PILOT_API_BASE}/api/ops/releases`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      runId,
      env: "prod",
      commit,
      branch,
      dirty,
      finalStatus: payload.blocked ? "BLOCKED" : "OK",
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      stages,
      reports: [
        {
          kind: "ops-report",
          env: "prod",
          reportJson: governanceReport,
        },
      ],
    }),
    cache: "no-store",
  });

  const ledgerPayload = await ledgerResponse.json().catch(() => ({ ok: false, error: "release ledger returned non-JSON" }));
  if (!ledgerResponse.ok || !ledgerPayload.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: ledgerPayload.error || "Failed to persist release check run",
        data: payload,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    data: {
      runId,
      finalStatus: payload.blocked ? "BLOCKED" : "OK",
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      governance: payload,
    },
  });
}