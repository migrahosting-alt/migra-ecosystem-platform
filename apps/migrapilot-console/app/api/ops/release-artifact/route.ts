import fs from "fs";
import path from "path";
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
  const requestedPath = url.searchParams.get("path") ?? "";
  if (!requestedPath) {
    return NextResponse.json({ ok: false, error: "path query parameter required" }, { status: 400 });
  }

  const repoRoot = resolveRepoRoot();
  const allowedRoot = path.join(repoRoot, "docs", "migrapilot");
  const allowedRootPrefix = `${allowedRoot}${path.sep}`;
  const resolved = path.resolve(repoRoot, requestedPath);
  if (resolved !== allowedRoot && !resolved.startsWith(allowedRootPrefix)) {
    return NextResponse.json({ ok: false, error: "Artifact path is outside the allowed docs root" }, { status: 403 });
  }

  if (!fs.existsSync(resolved)) {
    return NextResponse.json({ ok: false, error: "Artifact not found" }, { status: 404 });
  }

  const stat = fs.statSync(resolved);
  if (!stat.isFile()) {
    return NextResponse.json({ ok: false, error: "Artifact path must be a file" }, { status: 400 });
  }

  const content = fs.readFileSync(resolved, "utf8");
  const maxChars = 30000;
  const truncated = content.length > maxChars;
  return NextResponse.json({
    ok: true,
    data: {
      path: requestedPath,
      content: truncated ? `${content.slice(0, maxChars)}\n\n[truncated]` : content,
      truncated,
    },
  });
}