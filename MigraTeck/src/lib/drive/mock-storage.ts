import fs from "node:fs/promises";
import path from "node:path";
import { driveDownloadStorageProvider, driveUploadStorageProvider, env } from "@/lib/env";

interface MockStoredObject {
  body: Buffer;
  contentType: string;
}

interface MockStoredMetadata {
  contentType?: string;
}

let hasWarnedAboutMockStorage = false;

export function getMockStorageAvailability() {
  if (driveUploadStorageProvider !== "mock" && driveDownloadStorageProvider !== "mock") {
    return {
      ok: false as const,
      error: "mock_storage_disabled",
      status: 404,
    };
  }

  if (env.NODE_ENV === "production") {
    return {
      ok: false as const,
      error: "mock_storage_production_disabled",
      status: 404,
    };
  }

  if (!hasWarnedAboutMockStorage && env.NODE_ENV === "development") {
    console.warn("[migradrive] Mock storage routes are enabled in development.");
    hasWarnedAboutMockStorage = true;
  }

  return {
    ok: true as const,
  };
}

export function getDriveMockStorageRoot(): string {
  return path.join(process.cwd(), "tmp", "migradrive-mock-storage");
}

function getSafeSegments(fileKey: string): string[] {
  return fileKey
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.replace(/\.\./g, "_").replace(/[\\/]/g, "_"));
}

function getPaths(fileKey: string) {
  const segments = getSafeSegments(fileKey);
  const filePath = path.join(getDriveMockStorageRoot(), ...segments);
  return {
    filePath,
    metadataPath: `${filePath}.meta.json`,
  };
}

export async function writeMockStoredObject(fileKey: string, body: Buffer, contentType: string): Promise<void> {
  const { filePath, metadataPath } = getPaths(fileKey);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, body);
  await fs.writeFile(metadataPath, JSON.stringify({ contentType } satisfies MockStoredMetadata), "utf8");
}

export async function readMockStoredObject(fileKey: string): Promise<MockStoredObject | null> {
  const { filePath, metadataPath } = getPaths(fileKey);

  try {
    const [body, metadataRaw] = await Promise.all([
      fs.readFile(filePath),
      fs.readFile(metadataPath, "utf8").catch(() => "{}"),
    ]);
    const metadata = JSON.parse(metadataRaw) as MockStoredMetadata;

    return {
      body,
      contentType: metadata.contentType || "application/octet-stream",
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
}