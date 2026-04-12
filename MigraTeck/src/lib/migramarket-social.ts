import { getSocialOauthCapabilities } from "@/lib/migramarket-social-connectors";
import { assessSocialConnectionHealth } from "@/lib/migramarket-social-health";
import { normalizeStringList } from "@/lib/migramarket";

function sanitizeConnectionMetadata(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }

  const record = metadata as Record<string, unknown>;
  const safeRecord: Record<string, unknown> = {};

  for (const key of [
    "displayName",
    "avatarUrl",
    "email",
    "username",
    "connectionLabel",
    "lastSyncError",
    "lastTokenRefreshAt",
    "lastTokenRefreshError",
    "migrationState",
    "migrationNote",
    "legacySourceLabel",
    "legacyConnectionMethod",
    "legacyProfileUrl",
    "legacyFollowers",
    "legacyFollowing",
    "legacyPostsCount",
    "legacyEngagementRate",
  ]) {
    if (record[key] !== undefined) {
      safeRecord[key] = record[key];
    }
  }

  return safeRecord;
}

function formatConnectionStatus(status: string | null | undefined) {
  return (status || "unknown")
    .trim()
    .toLowerCase()
    .replace(/_/g, " ");
}

function derivePublishReadiness(connection: {
  publishMode: string;
  accessModel: string;
  status: string;
  externalAccountId: string | null;
  credentialCiphertext?: string | null;
  metadata: unknown;
  tokenExpiresAt?: Date | null;
  lastVerifiedAt: Date | null;
  platform: string;
}) {
  const oauth = getSocialOauthCapabilities(connection.platform);
  const health = assessSocialConnectionHealth(connection);
  const directPublish = connection.publishMode.trim().toLowerCase() === "api";
  const accountBound = Boolean(connection.externalAccountId);
  const reasons: string[] = [];

  if (!directPublish) {
    reasons.push("Channel is configured for assisted publishing only.");
  }

  if (oauth.supported && !oauth.configured) {
    reasons.push("OAuth app credentials are not configured on this server.");
  }

  if (oauth.supported && !health.connected) {
    reasons.push("OAuth credentials are missing for direct publishing.");
  }

  if (!accountBound) {
    reasons.push("Platform account binding is missing.");
  }

  if ((connection.status || "").trim().toLowerCase() !== "ready") {
    reasons.push(`Connection status is ${formatConnectionStatus(connection.status)}.`);
  }

  if (health.state !== "healthy") {
    reasons.push(health.summary);
  }

  if (health.lastSyncError) {
    reasons.push(health.lastSyncError);
  }

  const uniqueReasons = Array.from(new Set(reasons.filter(Boolean)));

  if (!directPublish) {
    return {
      state: "assisted_only",
      label: "Assisted Only",
      reason: uniqueReasons[0] || "Channel is configured for assisted publishing only.",
      canDirectPublish: false,
      needsAttention: false,
      reasons: [...uniqueReasons],
    };
  }

  if (uniqueReasons.length === 0) {
    return {
      state: "publish_ready",
      label: "Publish Ready",
      reason: "Direct publishing credentials and account binding are healthy.",
      canDirectPublish: true,
      needsAttention: false,
      reasons: [],
    };
  }

  const connectRequired = oauth.supported && (!oauth.configured || !health.connected);

  return {
    state: connectRequired ? "connect_required" : "attention_required",
    label: connectRequired ? "Connect OAuth" : "Attention Required",
    reason: uniqueReasons[0] || "Direct publishing is blocked until this connection is repaired.",
    canDirectPublish: false,
    needsAttention: true,
    reasons: [...uniqueReasons],
  };
}

export function serializeSocialConnection(connection: {
  id: string;
  orgId: string;
  platform: string;
  handle: string;
  profileType: string;
  profileUrl: string | null;
  publishMode: string;
  accessModel: string;
  status: string;
  externalAccountId: string | null;
  scopes: unknown;
  metadata: unknown;
  tokenExpiresAt?: Date | null;
  credentialCiphertext?: string | null;
  lastVerifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  const oauth = getSocialOauthCapabilities(connection.platform);
  const health = assessSocialConnectionHealth(connection);
  return {
    id: connection.id,
    orgId: connection.orgId,
    platform: connection.platform,
    handle: connection.handle,
    profileType: connection.profileType,
    profileUrl: connection.profileUrl,
    publishMode: connection.publishMode,
    accessModel: connection.accessModel,
    status: connection.status,
    externalAccountId: connection.externalAccountId,
    scopes: normalizeStringList(connection.scopes),
    metadata: sanitizeConnectionMetadata(connection.metadata),
    tokenExpiresAt: connection.tokenExpiresAt ? connection.tokenExpiresAt.toISOString() : null,
    lastVerifiedAt: connection.lastVerifiedAt ? connection.lastVerifiedAt.toISOString() : null,
    createdAt: connection.createdAt.toISOString(),
    updatedAt: connection.updatedAt.toISOString(),
    oauth: {
      ...oauth,
      connected: Boolean(connection.credentialCiphertext),
    },
    health,
    publishReadiness: derivePublishReadiness(connection),
  };
}

export function serializeCreativeBrief(brief: {
  id: string;
  orgId: string;
  name: string;
  campaignKey: string | null;
  brand: string;
  category: string;
  product: string | null;
  audience: string | null;
  objective: string;
  offer: string | null;
  headline: string | null;
  subheadline: string | null;
  price: string | null;
  cta: string | null;
  landingPage: string | null;
  channels: unknown;
  visualFamily: string | null;
  visualStyle: string | null;
  approvedTemplateKeys: unknown;
  disallowedAssetTags: unknown;
  requireOgMatch: boolean;
  active: boolean;
  diversityNotes: string | null;
  brandSignature: string | null;
  promptNotes: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...brief,
    channels: normalizeStringList(brief.channels),
    approvedTemplateKeys: normalizeStringList(brief.approvedTemplateKeys),
    disallowedAssetTags: normalizeStringList(brief.disallowedAssetTags),
    createdAt: brief.createdAt.toISOString(),
    updatedAt: brief.updatedAt.toISOString(),
  };
}

export function serializeContentJob(job: {
  id: string;
  orgId: string;
  briefId: string | null;
  connectionId: string | null;
  captionId?: string | null;
  selectedAssetId?: string | null;
  title: string;
  platform: string;
  format: string;
  publishMode: string;
  status: string;
  destinationUrl?: string | null;
  useLinkPreview?: boolean;
  validationStatus?: string;
  scheduledAt: Date | null;
  publishedAt: Date | null;
  caption: string | null;
  assetUrls: unknown;
  thumbnailUrl: string | null;
  externalPostUrl: string | null;
  publishProofUrl: string | null;
  aiPrompt: string | null;
  internalNotes: string | null;
  complianceNotes: string | null;
  createdAt: Date;
  updatedAt: Date;
  brief?: { id: string; name: string; brand: string; campaignKey?: string | null; category?: string } | null;
  connection?: { id: string; platform: string; handle: string; publishMode: string } | null;
  captionVariant?: { id: string; captionKey: string; platform: string; cta: string; destinationUrl: string } | null;
  selectedAsset?: { id: string; assetKey: string; width: number; height: number; fileUrl: string; qualityScore: number | null } | null;
  validations?: Array<{ id: string; finalStatus: string; designQualityScore: number | null; createdAt: Date }>;
}) {
  const latestValidation = job.validations?.[0] || null;
  return {
    ...job,
    assetUrls: normalizeStringList(job.assetUrls),
    scheduledAt: job.scheduledAt ? job.scheduledAt.toISOString() : null,
    publishedAt: job.publishedAt ? job.publishedAt.toISOString() : null,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    brief: job.brief
      ? {
          id: job.brief.id,
          name: job.brief.name,
          brand: job.brief.brand,
          campaignKey: job.brief.campaignKey || null,
          category: job.brief.category || "brand",
        }
      : null,
    connection: job.connection
      ? {
          id: job.connection.id,
          platform: job.connection.platform,
          handle: job.connection.handle,
          publishMode: job.connection.publishMode,
        }
      : null,
    captionVariant: job.captionVariant
      ? {
          id: job.captionVariant.id,
          captionKey: job.captionVariant.captionKey,
          platform: job.captionVariant.platform,
          cta: job.captionVariant.cta,
          destinationUrl: job.captionVariant.destinationUrl,
        }
      : null,
    selectedAsset: job.selectedAsset
      ? {
          id: job.selectedAsset.id,
          assetKey: job.selectedAsset.assetKey,
          width: job.selectedAsset.width,
          height: job.selectedAsset.height,
          fileUrl: job.selectedAsset.fileUrl,
          qualityScore: job.selectedAsset.qualityScore,
        }
      : null,
    latestValidation: latestValidation
      ? {
          id: latestValidation.id,
          finalStatus: latestValidation.finalStatus,
          designQualityScore: latestValidation.designQualityScore,
          createdAt: latestValidation.createdAt.toISOString(),
        }
      : null,
  };
}

export function serializeContentTemplate(template: {
  id: string;
  orgId: string;
  name: string;
  templateKey: string | null;
  platform: string;
  format: string;
  cadence: string;
  publishMode: string;
  titleTemplate: string;
  captionTemplate: string | null;
  aiPromptTemplate: string | null;
  cta: string | null;
  width: number | null;
  height: number | null;
  styleFamily: string | null;
  logoRequired: boolean;
  ctaRequired: boolean;
  maxHeadlineChars: number;
  maxSubheadlineChars: number;
  maxBullets: number;
  safeZones: unknown;
  hashtags: unknown;
  diversityChecklist: unknown;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...template,
    safeZones:
      template.safeZones && typeof template.safeZones === "object" && !Array.isArray(template.safeZones)
        ? (template.safeZones as Record<string, unknown>)
        : null,
    hashtags: normalizeStringList(template.hashtags),
    diversityChecklist: normalizeStringList(template.diversityChecklist),
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString(),
  };
}

export function serializeCalendarSlot(slot: {
  id: string;
  orgId: string;
  templateId: string | null;
  connectionId: string | null;
  title: string;
  platform: string;
  format: string;
  publishMode: string;
  weekday: number;
  slotTime: string | null;
  scheduledFor: Date | null;
  status: string;
  theme: string | null;
  cta: string | null;
  aiPrompt: string | null;
  assetChecklist: unknown;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  template?: { id: string; name: string; platform: string; cadence: string } | null;
  connection?: { id: string; platform: string; handle: string } | null;
}) {
  return {
    ...slot,
    assetChecklist: normalizeStringList(slot.assetChecklist),
    scheduledFor: slot.scheduledFor ? slot.scheduledFor.toISOString() : null,
    createdAt: slot.createdAt.toISOString(),
    updatedAt: slot.updatedAt.toISOString(),
    template: slot.template
      ? {
          id: slot.template.id,
          name: slot.template.name,
          platform: slot.template.platform,
          cadence: slot.template.cadence,
        }
      : null,
    connection: slot.connection
      ? {
          id: slot.connection.id,
          platform: slot.connection.platform,
          handle: slot.connection.handle,
        }
      : null,
  };
}
