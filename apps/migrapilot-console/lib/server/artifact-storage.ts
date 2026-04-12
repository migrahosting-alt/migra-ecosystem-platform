import fs from "node:fs";
import { Readable } from "node:stream";

import {
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";

export interface ArtifactReference {
  storageProvider: "migradrive";
  bucket: string;
  endpoint: string;
  objectKey: string;
  contentType: string;
}

export interface ArtifactStorageHealth {
  backend: string;
  configured: boolean;
  bucketReachable: boolean;
  bucket: string | null;
  endpoint: string | null;
  prefix: string;
}

function normalizeSegment(segment: string, fallback = "artifact"): string {
  const normalized = segment
    .trim()
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .map((part) => part.replace(/[^a-zA-Z0-9._-]/g, "_"))
    .filter(Boolean)
    .join("/");
  return normalized || fallback;
}

function normalizePrefix(prefix: string): string {
  return normalizeSegment(prefix, "migrapilot");
}

function normalizeMetadata(metadata?: Record<string, string | number | boolean | null | undefined>) {
  return Object.fromEntries(
    Object.entries(metadata ?? {})
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [key.toLowerCase().replace(/[^a-z0-9-]/g, ""), String(value)])
      .filter(([key]) => key.length > 0)
  );
}

const backend = (
  process.env.MIGRAPILOT_ARTIFACT_STORAGE_BACKEND ||
  (process.env.S3_ENDPOINT && process.env.S3_BUCKET ? "migradrive" : "filesystem")
).toLowerCase();

const artifactPrefix = normalizePrefix(process.env.MIGRAPILOT_ARTIFACT_PREFIX || "migrapilot");
const endpoint = process.env.S3_ENDPOINT || null;
const bucket = process.env.S3_BUCKET || null;
const accessKeyId = process.env.S3_ACCESS_KEY_ID || null;
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY || null;
const region = process.env.S3_REGION || "us-east-1";

const s3 =
  backend === "migradrive" && endpoint && bucket && accessKeyId && secretAccessKey
    ? new S3Client({
        region,
        endpoint,
        forcePathStyle: true,
        credentials: {
          accessKeyId,
          secretAccessKey
        }
      })
    : null;

function buildObjectKey(category: string, relativePath: string): string {
  return [
    artifactPrefix,
    normalizeSegment(category, "artifacts"),
    normalizeSegment(relativePath, "artifact.json")
  ].join("/");
}

async function bodyToString(body: unknown): Promise<string> {
  if (!body) {
    return "";
  }

  if (typeof (body as { transformToString?: () => Promise<string> }).transformToString === "function") {
    return (body as { transformToString: () => Promise<string> }).transformToString();
  }

  if (body instanceof Readable) {
    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }
    return Buffer.concat(chunks).toString("utf8");
  }

  if (Buffer.isBuffer(body)) {
    return body.toString("utf8");
  }

  return String(body);
}

export function isArtifactStorageEnabled(): boolean {
  return backend === "migradrive" && Boolean(s3);
}

export async function artifactStorageHealth(): Promise<ArtifactStorageHealth> {
  if (!isArtifactStorageEnabled() || !bucket) {
    return {
      backend,
      configured: false,
      bucketReachable: false,
      bucket,
      endpoint,
      prefix: artifactPrefix
    };
  }

  try {
    await s3!.send(new HeadBucketCommand({ Bucket: bucket }));
    return {
      backend,
      configured: true,
      bucketReachable: true,
      bucket,
      endpoint,
      prefix: artifactPrefix
    };
  } catch {
    return {
      backend,
      configured: true,
      bucketReachable: false,
      bucket,
      endpoint,
      prefix: artifactPrefix
    };
  }
}

export async function writeJsonArtifact<T>(input: {
  category: string;
  relativePath: string;
  data: T;
  metadata?: Record<string, string | number | boolean | null | undefined>;
}): Promise<ArtifactReference | null> {
  if (!isArtifactStorageEnabled() || !bucket || !endpoint) {
    return null;
  }

  const objectKey = buildObjectKey(input.category, input.relativePath);
  await s3!.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: `${JSON.stringify(input.data, null, 2)}\n`,
      ContentType: "application/json; charset=utf-8",
      Metadata: normalizeMetadata(input.metadata)
    })
  );

  return {
    storageProvider: "migradrive",
    bucket,
    endpoint,
    objectKey,
    contentType: "application/json; charset=utf-8"
  };
}

export async function writeTextArtifact(input: {
  category: string;
  relativePath: string;
  text: string;
  contentType?: string;
  metadata?: Record<string, string | number | boolean | null | undefined>;
}): Promise<ArtifactReference | null> {
  if (!isArtifactStorageEnabled() || !bucket || !endpoint) {
    return null;
  }

  const objectKey = buildObjectKey(input.category, input.relativePath);
  const contentType = input.contentType || "text/plain; charset=utf-8";
  await s3!.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: input.text,
      ContentType: contentType,
      Metadata: normalizeMetadata(input.metadata)
    })
  );

  return {
    storageProvider: "migradrive",
    bucket,
    endpoint,
    objectKey,
    contentType
  };
}

export async function uploadFileArtifact(input: {
  category: string;
  relativePath: string;
  localPath: string;
  contentType?: string;
  metadata?: Record<string, string | number | boolean | null | undefined>;
}): Promise<ArtifactReference | null> {
  if (!isArtifactStorageEnabled() || !bucket || !endpoint) {
    return null;
  }

  const stats = await fs.promises.stat(input.localPath);
  const objectKey = buildObjectKey(input.category, input.relativePath);
  const contentType = input.contentType || "application/octet-stream";

  await s3!.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: fs.createReadStream(input.localPath),
      ContentType: contentType,
      ContentLength: stats.size,
      Metadata: normalizeMetadata(input.metadata)
    })
  );

  return {
    storageProvider: "migradrive",
    bucket,
    endpoint,
    objectKey,
    contentType
  };
}

export async function readJsonArtifact<T>(input: {
  category: string;
  relativePath: string;
}): Promise<T | null> {
  if (!isArtifactStorageEnabled() || !bucket) {
    return null;
  }

  try {
    const response = await s3!.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: buildObjectKey(input.category, input.relativePath)
      })
    );
    const text = await bodyToString(response.Body);
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export async function readTextArtifact(input: {
  category: string;
  relativePath: string;
}): Promise<string | null> {
  if (!isArtifactStorageEnabled() || !bucket) {
    return null;
  }

  try {
    const response = await s3!.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: buildObjectKey(input.category, input.relativePath)
      })
    );
    return bodyToString(response.Body);
  } catch {
    return null;
  }
}
