import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { downloadStorageProvider, downloadUrlTtlSeconds, env } from "@/lib/env";

export interface UploadSigner {
  sign(fileKey: string, mimeType: string, ttlSeconds?: number): Promise<string>;
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
    throw new Error("S3 upload signer is not configured.");
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

class MockUploadSigner implements UploadSigner {
  async sign(fileKey: string, mimeType: string, ttlSeconds = downloadUrlTtlSeconds): Promise<string> {
    const boundedTtl = Math.max(30, ttlSeconds);
    const baseUrl = env.NEXTAUTH_URL || "http://localhost:3000";
    return `${baseUrl.replace(/\/$/, "")}/mock-upload/${encodeKey(fileKey)}?contentType=${encodeURIComponent(mimeType)}&ttlSeconds=${boundedTtl}`;
  }
}

class S3LikeUploadSigner implements UploadSigner {
  async sign(fileKey: string, mimeType: string, ttlSeconds = downloadUrlTtlSeconds): Promise<string> {
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
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: fileKey,
        ContentType: mimeType,
      }),
      { expiresIn: boundedTtl },
    );
  }
}

let signerOverride: UploadSigner | null = null;
let cachedSigner: UploadSigner | null = null;

function buildSigner(): UploadSigner {
  if (downloadStorageProvider === "mock") {
    return new MockUploadSigner();
  }

  if (downloadStorageProvider === "s3" || downloadStorageProvider === "minio") {
    return new S3LikeUploadSigner();
  }

  return new MockUploadSigner();
}

export function getUploadSigner(): UploadSigner {
  if (signerOverride) {
    return signerOverride;
  }

  if (!cachedSigner) {
    cachedSigner = buildSigner();
  }

  return cachedSigner;
}

export function setUploadSignerForTests(signer: UploadSigner | null): void {
  signerOverride = signer;
}