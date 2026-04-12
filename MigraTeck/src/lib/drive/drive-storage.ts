import {
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListMultipartUploadsCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getDriveMockStorageRoot, readMockStoredObject } from "@/lib/drive/mock-storage";
import {
  driveDownloadStorageProvider,
  driveMultipartMinPartSizeMb,
  driveSignedUrlTtlSeconds,
  driveUploadStorageProvider,
  driveMaxUploadSizeMb,
  env,
} from "@/lib/env";

export type DriveStorageProvider = "s3" | "minio" | "mock";
export type DriveBucketKind = "primary" | "derivatives" | "archive" | "logs";

export interface DriveUploadMetadataInput {
  tenantId: string;
  fileId: string;
  versionId?: string;
  planCode: string;
  checksum?: string | null;
  uploadedBy?: string | null;
  origin?: "web" | "desktop" | "mobile" | "worker";
}

interface DriveS3Config {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  buckets: Record<DriveBucketKind, string | null>;
}

interface SignDriveUploadInput {
  fileKey: string;
  mimeType: string;
  ttlSeconds?: number;
  metadata?: Record<string, string>;
}

export interface DriveBucketInspection {
  kind: DriveBucketKind;
  bucket: string | null;
  configured: boolean;
  accessible: boolean;
  status: "ok" | "unconfigured" | "unreachable";
  errorCode: string | null;
  errorMessage: string | null;
}

export interface DriveMultipartInspection {
  supported: boolean;
  count: number | null;
  truncated: boolean;
  sampleKeys: string[];
  errorCode: string | null;
  errorMessage: string | null;
}

export interface DriveObjectInspection {
  key: string;
  bucketKind: DriveBucketKind;
  bucket: string | null;
  provider: DriveStorageProvider;
  accessible: boolean;
  exists: boolean;
  status: "ok" | "missing" | "unconfigured" | "unreachable";
  sizeBytes: string | null;
  contentType: string | null;
  etag: string | null;
  lastModified: string | null;
  metadata: Record<string, string> | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface DriveStorageInspection {
  provider: DriveStorageProvider;
  reachable: boolean;
  bucketChecks: DriveBucketInspection[];
  multipart: DriveMultipartInspection;
}

function encodeKey(fileKey: string): string {
  return fileKey
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function parseBoolean(value: string | undefined): boolean | null {
  if (value === undefined) {
    return null;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return null;
}

function getErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  if ("Code" in error && typeof error.Code === "string") {
    return error.Code;
  }

  return "name" in error && typeof error.name === "string" ? error.name : null;
}

function getErrorMessage(error: unknown): string | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  return "message" in error && typeof error.message === "string" ? error.message : null;
}

function getHttpStatus(error: unknown): number | null {
  if (!error || typeof error !== "object" || !("$metadata" in error)) {
    return null;
  }

  const metadata = error.$metadata;
  if (!metadata || typeof metadata !== "object") {
    return null;
  }

  return "httpStatusCode" in metadata && typeof metadata.httpStatusCode === "number"
    ? metadata.httpStatusCode
    : null;
}

function isMissingObjectError(error: unknown): boolean {
  const code = getErrorCode(error);
  const httpStatus = getHttpStatus(error);
  return code === "NotFound" || code === "NoSuchKey" || httpStatus === 404;
}

function getDriveEndpoint(): string | null {
  return env.MIGRADRIVE_S3_ENDPOINT || env.S3_ENDPOINT || null;
}

function getDriveRegion(): string {
  return env.MIGRADRIVE_S3_REGION || env.S3_REGION || "us-east-1";
}

function getDriveAccessKeyId(): string | null {
  return env.MIGRADRIVE_S3_ACCESS_KEY_ID || env.S3_ACCESS_KEY_ID || null;
}

function getDriveSecretAccessKey(): string | null {
  return env.MIGRADRIVE_S3_SECRET_ACCESS_KEY || env.S3_SECRET_ACCESS_KEY || null;
}

function getDriveBucket(kind: DriveBucketKind): string | null {
  switch (kind) {
    case "primary":
      return env.MIGRADRIVE_S3_BUCKET_PRIMARY || env.S3_BUCKET || null;
    case "derivatives":
      return env.MIGRADRIVE_S3_BUCKET_DERIVATIVES || null;
    case "archive":
      return env.MIGRADRIVE_S3_BUCKET_ARCHIVE || null;
    case "logs":
      return env.MIGRADRIVE_S3_BUCKET_LOGS || null;
    default:
      return null;
  }
}

function resolveForcePathStyle(provider: DriveStorageProvider, endpoint: string): boolean {
  const explicit = parseBoolean(env.MIGRADRIVE_S3_FORCE_PATH_STYLE);
  if (explicit !== null) {
    return explicit;
  }

  const hostname = new URL(endpoint).hostname.toLowerCase();
  return (
    provider === "minio"
    || hostname === "s3.migradrive.com"
    || (!hostname.endsWith(".amazonaws.com") && hostname !== "s3.amazonaws.com")
  );
}

function getDriveS3Config(provider: DriveStorageProvider): DriveS3Config {
  const endpoint = getDriveEndpoint();
  const accessKeyId = getDriveAccessKeyId();
  const secretAccessKey = getDriveSecretAccessKey();
  const primaryBucket = getDriveBucket("primary");

  if (!endpoint || !accessKeyId || !secretAccessKey || !primaryBucket) {
    throw new Error("MigraDrive S3 storage is not fully configured.");
  }

  return {
    endpoint: endpoint.replace(/\/+$/, ""),
    region: getDriveRegion(),
    accessKeyId,
    secretAccessKey,
    forcePathStyle: resolveForcePathStyle(provider, endpoint),
    buckets: {
      primary: primaryBucket,
      derivatives: getDriveBucket("derivatives"),
      archive: getDriveBucket("archive"),
      logs: getDriveBucket("logs"),
    },
  };
}

function getMockBucketName(kind: DriveBucketKind): string {
  return `mock-${kind}`;
}

let cachedUploadClient: S3Client | null = null;
let cachedDownloadClient: S3Client | null = null;

function getDriveS3Client(kind: "upload" | "download"): { client: S3Client; config: DriveS3Config } {
  const provider = kind === "upload" ? driveUploadStorageProvider : driveDownloadStorageProvider;
  const config = getDriveS3Config(provider);

  const cachedClient = kind === "upload" ? cachedUploadClient : cachedDownloadClient;
  if (cachedClient) {
    return { client: cachedClient, config };
  }

  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  if (kind === "upload") {
    cachedUploadClient = client;
  } else {
    cachedDownloadClient = client;
  }

  return { client, config };
}

export function buildDriveUploadMetadata(input: DriveUploadMetadataInput): Record<string, string> {
  const metadata: Record<string, string> = {
    "tenant-id": input.tenantId,
    "file-id": input.fileId,
    "version-id": input.versionId || "v1",
    "plan-code": input.planCode,
    origin: input.origin || "web",
  };

  if (input.checksum) {
    metadata.checksum = input.checksum;
  }

  if (input.uploadedBy) {
    metadata["uploaded-by"] = input.uploadedBy;
  }

  return metadata;
}

export async function signDriveUploadUrl(input: SignDriveUploadInput): Promise<string> {
  const boundedTtl = Math.max(30, Math.min(input.ttlSeconds || driveSignedUrlTtlSeconds, 3600));

  if (driveUploadStorageProvider === "mock") {
    const baseUrl = env.NEXTAUTH_URL || "http://localhost:3000";
    const query = new URLSearchParams({
      contentType: input.mimeType,
      ttlSeconds: String(boundedTtl),
    });
    return `${baseUrl.replace(/\/$/, "")}/mock-upload/${encodeKey(input.fileKey)}?${query.toString()}`;
  }

  const { client, config } = getDriveS3Client("upload");
  return getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: config.buckets.primary || undefined,
      Key: input.fileKey,
      ContentType: input.mimeType,
      Metadata: input.metadata,
    }),
    { expiresIn: boundedTtl },
  );
}

export async function signDriveDownloadUrl(fileKey: string, ttlSeconds = driveSignedUrlTtlSeconds): Promise<string> {
  const boundedTtl = Math.max(30, Math.min(ttlSeconds, 3600));

  if (driveDownloadStorageProvider === "mock") {
    const baseUrl = env.NEXTAUTH_URL || "http://localhost:3000";
    return `${baseUrl.replace(/\/$/, "")}/mock-download/${encodeKey(fileKey)}?ttlSeconds=${boundedTtl}`;
  }

  const { client, config } = getDriveS3Client("download");
  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: config.buckets.primary || undefined,
      Key: fileKey,
    }),
    { expiresIn: boundedTtl },
  );
}

export async function inspectDriveStoredObject(
  fileKey: string,
  bucketKind: DriveBucketKind = "primary",
): Promise<DriveObjectInspection> {
  const provider = driveDownloadStorageProvider;
  const bucket = getDriveBucket(bucketKind);

  if (provider === "mock") {
    const storedObject = await readMockStoredObject(fileKey);
    return {
      key: fileKey,
      bucketKind,
      bucket: bucket || getMockBucketName(bucketKind),
      provider,
      accessible: true,
      exists: Boolean(storedObject),
      status: storedObject ? "ok" : "missing",
      sizeBytes: storedObject ? String(storedObject.body.byteLength) : null,
      contentType: storedObject?.contentType || null,
      etag: null,
      lastModified: null,
      metadata: null,
      errorCode: null,
      errorMessage: null,
    };
  }

  if (!bucket) {
    return {
      key: fileKey,
      bucketKind,
      bucket: null,
      provider,
      accessible: false,
      exists: false,
      status: "unconfigured",
      sizeBytes: null,
      contentType: null,
      etag: null,
      lastModified: null,
      metadata: null,
      errorCode: "bucket_not_configured",
      errorMessage: `Drive ${bucketKind} bucket is not configured.`,
    };
  }

  try {
    const { client } = getDriveS3Client("download");
    const response = await client.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: fileKey,
      }),
    );

    return {
      key: fileKey,
      bucketKind,
      bucket,
      provider,
      accessible: true,
      exists: true,
      status: "ok",
      sizeBytes: response.ContentLength === undefined ? null : String(response.ContentLength),
      contentType: response.ContentType || null,
      etag: response.ETag || null,
      lastModified: response.LastModified?.toISOString() || null,
      metadata: response.Metadata || null,
      errorCode: null,
      errorMessage: null,
    };
  } catch (error) {
    if (isMissingObjectError(error)) {
      return {
        key: fileKey,
        bucketKind,
        bucket,
        provider,
        accessible: true,
        exists: false,
        status: "missing",
        sizeBytes: null,
        contentType: null,
        etag: null,
        lastModified: null,
        metadata: null,
        errorCode: null,
        errorMessage: null,
      };
    }

    return {
      key: fileKey,
      bucketKind,
      bucket,
      provider,
      accessible: false,
      exists: false,
      status: "unreachable",
      sizeBytes: null,
      contentType: null,
      etag: null,
      lastModified: null,
      metadata: null,
      errorCode: getErrorCode(error),
      errorMessage: getErrorMessage(error),
    };
  }
}

export async function inspectDriveMultipartUploads(prefix?: string | null): Promise<DriveMultipartInspection> {
  const provider = driveUploadStorageProvider;

  if (provider === "mock") {
    return {
      supported: false,
      count: 0,
      truncated: false,
      sampleKeys: [],
      errorCode: null,
      errorMessage: null,
    };
  }

  try {
    const { client, config } = getDriveS3Client("upload");
    const bucket = config.buckets.primary;
    if (!bucket) {
      return {
        supported: true,
        count: null,
        truncated: false,
        sampleKeys: [],
        errorCode: "bucket_not_configured",
        errorMessage: "Drive primary bucket is not configured.",
      };
    }

    const uploads: string[] = [];
    let keyMarker: string | undefined;
    let uploadIdMarker: string | undefined;
    let truncated = false;
    const maxUploads = 200;

    while (uploads.length < maxUploads) {
      const response = await client.send(
        new ListMultipartUploadsCommand({
          Bucket: bucket,
          Prefix: prefix || undefined,
          KeyMarker: keyMarker,
          UploadIdMarker: uploadIdMarker,
          MaxUploads: Math.min(maxUploads - uploads.length, 1000),
        }),
      );

      uploads.push(...(response.Uploads || []).flatMap((upload) => (upload.Key ? [upload.Key] : [])));

      if (!response.IsTruncated) {
        truncated = false;
        break;
      }

      truncated = true;
      if (uploads.length >= maxUploads || !response.NextKeyMarker) {
        break;
      }

      keyMarker = response.NextKeyMarker;
      uploadIdMarker = response.NextUploadIdMarker;
    }

    return {
      supported: true,
      count: uploads.length,
      truncated,
      sampleKeys: uploads.slice(0, 10),
      errorCode: null,
      errorMessage: null,
    };
  } catch (error) {
    return {
      supported: true,
      count: null,
      truncated: false,
      sampleKeys: [],
      errorCode: getErrorCode(error),
      errorMessage: getErrorMessage(error),
    };
  }
}

export async function inspectDriveStorage(): Promise<DriveStorageInspection> {
  const provider = driveDownloadStorageProvider;
  const bucketKinds: DriveBucketKind[] = ["primary", "derivatives", "archive", "logs"];

  if (provider === "mock") {
    return {
      provider,
      reachable: true,
      bucketChecks: bucketKinds.map((kind) => ({
        kind,
        bucket: getDriveBucket(kind) || getMockBucketName(kind),
        configured: kind === "primary" || Boolean(getDriveBucket(kind)),
        accessible: true,
        status: "ok",
        errorCode: null,
        errorMessage: null,
      })),
      multipart: await inspectDriveMultipartUploads(),
    };
  }

  let client: S3Client;
  let config: DriveS3Config;

  try {
    ({ client, config } = getDriveS3Client("download"));
  } catch (error) {
    return {
      provider,
      reachable: false,
      bucketChecks: bucketKinds.map((kind) => ({
        kind,
        bucket: getDriveBucket(kind),
        configured: Boolean(getDriveBucket(kind)),
        accessible: false,
        status: "unconfigured",
        errorCode: getErrorCode(error),
        errorMessage: getErrorMessage(error),
      })),
      multipart: await inspectDriveMultipartUploads(),
    };
  }

  const bucketChecks = await Promise.all(
    bucketKinds.map(async (kind) => {
      const bucket = config.buckets[kind];
      if (!bucket) {
        return {
          kind,
          bucket: null,
          configured: false,
          accessible: false,
          status: "unconfigured" as const,
          errorCode: null,
          errorMessage: null,
        };
      }

      try {
        await client.send(new HeadBucketCommand({ Bucket: bucket }));
        return {
          kind,
          bucket,
          configured: true,
          accessible: true,
          status: "ok" as const,
          errorCode: null,
          errorMessage: null,
        };
      } catch (error) {
        return {
          kind,
          bucket,
          configured: true,
          accessible: false,
          status: "unreachable" as const,
          errorCode: getErrorCode(error),
          errorMessage: getErrorMessage(error),
        };
      }
    }),
  );

  return {
    provider,
    reachable: bucketChecks.some((check) => check.kind === "primary" && check.status === "ok"),
    bucketChecks,
    multipart: await inspectDriveMultipartUploads(),
  };
}

export function getDriveStorageSummary() {
  const endpoint = getDriveEndpoint();
  const providerConfigured = Boolean(endpoint && getDriveAccessKeyId() && getDriveSecretAccessKey() && getDriveBucket("primary"));
  const provider = driveDownloadStorageProvider;
  const warnings: string[] = [];

  if (!providerConfigured && provider !== "mock") {
    warnings.push("primary_bucket_or_credentials_missing");
  }

  if (provider === "mock") {
    warnings.push("mock_storage_enabled");
  }

  return {
    uploadProvider: driveUploadStorageProvider,
    downloadProvider: driveDownloadStorageProvider,
    providerConfigured,
    endpoint: provider === "mock" ? `mock-local://${getDriveMockStorageRoot()}` : endpoint,
    region: getDriveRegion(),
    forcePathStyle: endpoint ? resolveForcePathStyle(provider, endpoint) : null,
    signedUrlTtlSeconds: driveSignedUrlTtlSeconds,
    multipartMinPartSizeMb: driveMultipartMinPartSizeMb,
    maxUploadSizeMb: driveMaxUploadSizeMb,
    buckets: {
      primary: getDriveBucket("primary") || (provider === "mock" ? getMockBucketName("primary") : null),
      derivatives: getDriveBucket("derivatives") || (provider === "mock" ? getMockBucketName("derivatives") : null),
      archive: getDriveBucket("archive") || (provider === "mock" ? getMockBucketName("archive") : null),
      logs: getDriveBucket("logs") || (provider === "mock" ? getMockBucketName("logs") : null),
    },
    privateAccessOnly: true,
    warnings,
  };
}