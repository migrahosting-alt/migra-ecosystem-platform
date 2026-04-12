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

export const runtime = "nodejs";

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

export async function GET(request: Request) {
  if (!(await ensurePortalAccess())) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const phaseNumber = (url.searchParams.get("phase") ?? "36").replace(/[^0-9]/g, "") || "36";
  const repoRoot = resolveRepoRoot();
  const releaseCheckPath = path.join(repoRoot, "release-check.js");
  const baseDir = path.join(repoRoot, "docs", "migrapilot", `phase-${phaseNumber}`);

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

  try {
    const payload = JSON.parse(stdout) as Record<string, unknown>;
    return NextResponse.json({
      ok: true,
      data: {
        ...payload,
        exitCode: result.status ?? 1,
      },
    });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: "Failed to parse release-check output",
        detail: stdout,
        stderr: result.stderr?.trim() || null,
      },
      { status: 500 },
    );
  }
}