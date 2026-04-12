import fs from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

import { artifactStorageHealth } from "../../lib/server/artifact-storage";

function readAppVersion(): string {
  try {
    const packageJson = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf8")
    ) as { version?: string };
    return packageJson.version ?? "0.1.0";
  } catch {
    return "0.1.0";
  }
}

export async function GET() {
  const artifactStorage = await artifactStorageHealth();
  return NextResponse.json({
    status: "ok",
    uptime: Math.floor(process.uptime()),
    version: readAppVersion(),
    artifactStorage
  });
}
