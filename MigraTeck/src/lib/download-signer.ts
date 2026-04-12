import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { downloadStorageProvider, downloadUrlTtlSeconds, env } from "@/lib/env";

export interface DownloadSigner {
  sign(fileKey: string, ttlSeconds?: number): Promise<string>;
}

interface S3LikeConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

function encodeKey(fileKey: string): string {
  return fileKey
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function getS3LikeConfig(): S3LikeConfig {
  if (!env.S3_ENDPOINT || !env.S3_BUCKET || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
    throw new Error("S3 download signer is not configured.");
  }

  const endpoint = env.S3_ENDPOINT.replace(/\/+$/, "");
  const hostname = new URL(endpoint).hostname.toLowerCase();
  const forcePathStyle =
    downloadStorageProvider === "minio" ||
    hostname === "s3.migradrive.com" ||
    (!hostname.endsWith(".amazonaws.com") && hostname !== "s3.amazonaws.com");

  return {
    endpoint,
    region: env.S3_REGION || "us-east-1",
    bucket: env.S3_BUCKET,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    forcePathStyle,
  };
}

class MockDownloadSigner implements DownloadSigner {
  async sign(fileKey: string, ttlSeconds = downloadUrlTtlSeconds): Promise<string> {
    const boundedTtl = Math.max(30, ttlSeconds);
    const baseUrl = env.NEXTAUTH_URL || "http://localhost:3000";
    return `${baseUrl.replace(/\/$/, "")}/mock-download/${encodeKey(fileKey)}?ttlSeconds=${boundedTtl}`;
  }
}

class S3LikeDownloadSigner implements DownloadSigner {
  async sign(fileKey: string, ttlSeconds = downloadUrlTtlSeconds): Promise<string> {
    const boundedTtl = Math.max(30, Math.min(ttlSeconds, 3600));
    const config = getS3LikeConfig();
    const client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });

    return getSignedUrl(
      client,
      new GetObjectCommand({
        Bucket: config.bucket,
        Key: fileKey,
      }),
      { expiresIn: boundedTtl },
    );
  }
}

let signerOverride: DownloadSigner | null = null;
let cachedSigner: DownloadSigner | null = null;

function buildSigner(): DownloadSigner {
  if (downloadStorageProvider === "mock") {
    return new MockDownloadSigner();
  }

  if (downloadStorageProvider === "s3" || downloadStorageProvider === "minio") {
    return new S3LikeDownloadSigner();
  }

  return new MockDownloadSigner();
}

export function getDownloadSigner(): DownloadSigner {
  if (signerOverride) {
    return signerOverride;
  }

  if (!cachedSigner) {
    cachedSigner = buildSigner();
  }

  return cachedSigner;
}

export function setDownloadSignerForTests(signer: DownloadSigner | null): void {
  signerOverride = signer;
}
