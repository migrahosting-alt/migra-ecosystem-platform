"use client";

import { useState } from "react";
import { ActionButton } from "@/components/ui/button";
import {
  getSocialPlatformDefinition,
  socialPlatformDefinitions,
  type SocialPlatformDefinition,
} from "@/lib/migramarket-social-platforms";
import { platformPrefersLinkPreview, platformSupportsLinkPreview } from "@/lib/migramarket-social-link-preview";

export interface WorkspaceSocialConnection {
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
  scopes: string[];
  metadata: unknown;
  tokenExpiresAt: string | null;
  lastVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
  oauth: {
    supported: boolean;
    configured: boolean;
    usesPkce: boolean;
    label: string | null;
    connected: boolean;
  };
  publishReadiness: {
    state: string;
    label: string;
    reason: string;
    canDirectPublish: boolean;
    needsAttention: boolean;
    reasons: string[];
  };
  health: {
    state: string;
    summary: string;
    recommendedAction: string;
    connected: boolean;
    canAutoRefresh: boolean;
    tokenExpired: boolean;
    tokenExpiresSoon: boolean;
    verificationStale: boolean;
    missingAccountBinding: boolean;
    requiresReconnect: boolean;
    needsAttention: boolean;
    lastSyncError: string | null;
    expiresInHours: number | null;
  };
}

export interface WorkspaceCreativeBrief {
  id: string;
  orgId: string;
  name: string;
  campaignKey?: string | null;
  brand: string;
  category?: string;
  product: string | null;
  audience: string | null;
  objective: string;
  offer: string | null;
  headline?: string | null;
  subheadline?: string | null;
  price?: string | null;
  cta: string | null;
  landingPage: string | null;
  channels: string[];
  visualFamily?: string | null;
  visualStyle: string | null;
  approvedTemplateKeys?: string[];
  disallowedAssetTags?: string[];
  requireOgMatch?: boolean;
  active?: boolean;
  diversityNotes: string | null;
  brandSignature: string | null;
  promptNotes: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceContentJob {
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
  scheduledAt: string | null;
  publishedAt: string | null;
  caption: string | null;
  assetUrls: string[];
  thumbnailUrl: string | null;
  externalPostUrl: string | null;
  publishProofUrl: string | null;
  aiPrompt: string | null;
  internalNotes: string | null;
  complianceNotes: string | null;
  createdAt: string;
  updatedAt: string;
  brief: { id: string; name: string; brand: string; campaignKey?: string | null; category?: string } | null;
  connection: { id: string; platform: string; handle: string; publishMode: string } | null;
  captionVariant?: { id: string; captionKey: string; platform: string; cta: string; destinationUrl: string } | null;
  selectedAsset?: { id: string; assetKey: string; width: number; height: number; fileUrl: string; qualityScore: number | null } | null;
  latestValidation?: { id: string; finalStatus: string; designQualityScore: number | null; createdAt: string } | null;
}

export interface WorkspaceContentTemplate {
  id: string;
  orgId: string;
  name: string;
  templateKey?: string | null;
  platform: string;
  format: string;
  cadence: string;
  publishMode: string;
  titleTemplate: string;
  captionTemplate: string | null;
  aiPromptTemplate: string | null;
  cta: string | null;
  width?: number | null;
  height?: number | null;
  styleFamily?: string | null;
  logoRequired?: boolean;
  ctaRequired?: boolean;
  maxHeadlineChars?: number;
  maxSubheadlineChars?: number;
  maxBullets?: number;
  safeZones?: Record<string, unknown> | null;
  hashtags: string[];
  diversityChecklist: string[];
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceCalendarSlot {
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
  scheduledFor: string | null;
  status: string;
  theme: string | null;
  cta: string | null;
  aiPrompt: string | null;
  assetChecklist: string[];
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  template: { id: string; name: string; platform: string; cadence: string } | null;
  connection: { id: string; platform: string; handle: string } | null;
}

interface MigraMarketSocialOpsProps {
  canManage: boolean;
  initialConnections: WorkspaceSocialConnection[];
  initialBriefs: WorkspaceCreativeBrief[];
  initialJobs: WorkspaceContentJob[];
  initialTemplates: WorkspaceContentTemplate[];
  initialCalendarSlots: WorkspaceCalendarSlot[];
}

const platformOptions = socialPlatformDefinitions.map((platform) => platform.key);
const publishModeOptions = ["api", "assisted"] as const;
const accessModelOptions = ["oauth", "profile_access", "shared_credentials"] as const;
const connectionStatusOptions = ["draft", "ready", "reconnect_required", "restricted", "paused"] as const;
const briefStatusOptions = ["draft", "approved", "in_production", "archived"] as const;
const objectiveOptions = ["awareness", "lead_gen", "retention", "education", "launch"] as const;
const formatOptions = ["post", "carousel", "reel", "story", "short", "video", "video_pin"] as const;
const jobStatusOptions = ["draft", "queued", "scheduled", "awaiting_publish", "published", "failed"] as const;
const templateCadenceOptions = ["daily", "weekly", "biweekly", "monthly"] as const;
const templateStatusOptions = ["active", "paused", "archived"] as const;
const calendarStatusOptions = ["planned", "drafting", "ready", "published", "skipped"] as const;
const weekdayOptions = [
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
  { value: 7, label: "Sunday" },
] as const;

function getPlatformLabel(platform: string) {
  return getSocialPlatformDefinition(platform)?.label || platform;
}

function getConnectionDefaults(platform: string) {
  const definition = getSocialPlatformDefinition(platform);
  return {
    publishMode: definition?.defaultPublishMode || "assisted",
    accessModel: definition?.defaultAccessModel || "profile_access",
  };
}

function getJobDefaults(platform: string) {
  const definition = getSocialPlatformDefinition(platform);
  return {
    publishMode: definition?.defaultPublishMode || "assisted",
    format: definition?.primaryFormats[0] || "post",
    useLinkPreview: platformPrefersLinkPreview(platform),
  };
}

function getConnectionHealthClass(state: string) {
  if (state === "healthy") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }
  if (state === "reconnect_required") {
    return "border-rose-200 bg-rose-50 text-rose-800";
  }
  return "border-amber-200 bg-amber-50 text-amber-800";
}

function getPublishReadinessClass(state: string) {
  if (state === "publish_ready") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }
  if (state === "assisted_only") {
    return "border-slate-200 bg-slate-100 text-slate-700";
  }
  if (state === "connect_required") {
    return "border-rose-200 bg-rose-50 text-rose-800";
  }
  return "border-amber-200 bg-amber-50 text-amber-800";
}

function renderPlatformNotes(definition: SocialPlatformDefinition | null, tone: "surface" | "plain" = "surface") {
  if (!definition) return null;

  const className =
    tone === "surface"
      ? "mt-3 rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-3 text-sm text-[var(--ink-muted)]"
      : "mt-3 text-sm text-[var(--ink-muted)]";

  return (
    <div className={className}>
      <p className="font-semibold text-[var(--ink)]">{definition.label} publishing notes</p>
      <p className="mt-1">{definition.brandRule}</p>
      <p className="mt-2 text-xs uppercase tracking-[0.18em] text-[var(--ink-soft)]">
        {definition.apiSupported ? "API-supported" : "Assisted-only"} lane
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        {definition.setupChecklist.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function fromMultiline(value: string): string[] {
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function toDatetimeLocal(value: string | null): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 16);
}

function fromDatetimeLocal(value: string): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function weekdayLabel(value: number): string {
  return weekdayOptions.find((item) => item.value === value)?.label || `Day ${value}`;
}

function readMetadataValue(metadata: unknown, key: string): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function readMetadataNumber(metadata: unknown, key: string): number | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function MigraMarketSocialOps({
  canManage,
  initialConnections,
  initialBriefs,
  initialJobs,
  initialTemplates,
  initialCalendarSlots,
}: MigraMarketSocialOpsProps) {
  const defaultConnectionSettings = getConnectionDefaults("instagram");
  const defaultJobSettings = getJobDefaults("instagram");
  const [connections, setConnections] = useState(initialConnections);
  const [briefs, setBriefs] = useState(initialBriefs);
  const [jobs, setJobs] = useState(initialJobs);
  const [templates, setTemplates] = useState(initialTemplates);
  const [calendarSlots, setCalendarSlots] = useState(initialCalendarSlots);
  const [busyConnectionId, setBusyConnectionId] = useState<string | null>(null);
  const [busyBriefId, setBusyBriefId] = useState<string | null>(null);
  const [busyJobId, setBusyJobId] = useState<string | null>(null);
  const [busyTemplateId, setBusyTemplateId] = useState<string | null>(null);
  const [busyCalendarId, setBusyCalendarId] = useState<string | null>(null);
  const [connectionMessage, setConnectionMessage] = useState<string | null>(null);
  const [briefMessage, setBriefMessage] = useState<string | null>(null);
  const [jobMessage, setJobMessage] = useState<string | null>(null);
  const [templateMessage, setTemplateMessage] = useState<string | null>(null);
  const [calendarMessage, setCalendarMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [connectionForm, setConnectionForm] = useState({
    platform: "instagram",
    handle: "",
    profileType: "business",
    profileUrl: "",
    publishMode: defaultConnectionSettings.publishMode,
    accessModel: defaultConnectionSettings.accessModel,
    status: "draft",
    externalAccountId: "",
    scopes: "",
  });
  const [briefForm, setBriefForm] = useState({
    name: "",
    brand: "MigraHosting",
    product: "",
    audience: "",
    objective: "awareness",
    offer: "",
    cta: "",
    landingPage: "",
    channels: "instagram\nfacebook\nlinkedin",
    visualStyle: "Photorealistic business marketing",
    diversityNotes:
      "Use a balanced mix of Black, white, Asian, Latino, and women-led representation across the campaign set.",
    brandSignature: "Powered by MigraTeck",
    promptNotes: "",
    status: "draft",
  });
  const [jobForm, setJobForm] = useState({
    briefId: "",
    connectionId: "",
    title: "",
    platform: "instagram",
    format: defaultJobSettings.format,
    publishMode: defaultJobSettings.publishMode,
    status: "draft",
    scheduledAt: "",
    destinationUrl: "",
    useLinkPreview: defaultJobSettings.useLinkPreview,
    caption: "",
    assetUrls: "",
    thumbnailUrl: "",
    externalPostUrl: "",
    publishProofUrl: "",
    aiPrompt: "",
    internalNotes: "",
    complianceNotes: "",
  });
  const [templateForm, setTemplateForm] = useState({
    name: "",
    platform: "instagram",
    format: "reel",
    cadence: "weekly",
    publishMode: "api",
    titleTemplate: "",
    captionTemplate: "",
    aiPromptTemplate: "",
    cta: "Click to learn more",
    hashtags: "poweredbymigrateck\nmigrateck",
    diversityChecklist:
      "Balance Black, white, Asian, and Latino representation\nInclude women-led and mixed-team scenes",
    status: "active",
  });
  const [calendarForm, setCalendarForm] = useState({
    templateId: "",
    connectionId: "",
    title: "",
    platform: "instagram",
    format: "reel",
    publishMode: "api",
    weekday: "1",
    slotTime: "09:30",
    scheduledFor: "",
    status: "planned",
    theme: "",
    cta: "",
    aiPrompt: "",
    assetChecklist: "Hook visual\nCaption\nCTA",
    notes: "",
  });
  const selectedConnectionPlatform = getSocialPlatformDefinition(connectionForm.platform);
  const selectedJobPlatform = getSocialPlatformDefinition(jobForm.platform);
  const selectedTemplatePlatform = getSocialPlatformDefinition(templateForm.platform);
  const selectedCalendarPlatform = getSocialPlatformDefinition(calendarForm.platform);

  async function createConnection() {
    setConnectionMessage(null);
    setErrorMessage(null);
    const response = await fetch("/api/migramarket/social/connections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...connectionForm,
        profileUrl: connectionForm.profileUrl || null,
        externalAccountId: connectionForm.externalAccountId || null,
        scopes: fromMultiline(connectionForm.scopes),
      }),
    });
    const payload = (await response.json().catch(() => null)) as { error?: string; connection?: WorkspaceSocialConnection } | null;
    if (!response.ok || !payload?.connection) {
      setErrorMessage(payload?.error || "Unable to create social connection.");
      return;
    }
    setConnections((current) => [...current, payload.connection!]);
    const defaults = getConnectionDefaults("instagram");
    setConnectionForm({
      platform: "instagram",
      handle: "",
      profileType: "business",
      profileUrl: "",
      publishMode: defaults.publishMode,
      accessModel: defaults.accessModel,
      status: "draft",
      externalAccountId: "",
      scopes: "",
    });
    setConnectionMessage("Social connection created.");
  }

  async function updateConnection(connection: WorkspaceSocialConnection) {
    setBusyConnectionId(connection.id);
    setConnectionMessage(null);
    setErrorMessage(null);
    const response = await fetch(`/api/migramarket/social/connections/${connection.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform: connection.platform,
        handle: connection.handle,
        profileType: connection.profileType,
        profileUrl: connection.profileUrl,
        publishMode: connection.publishMode,
        accessModel: connection.accessModel,
        status: connection.status,
        externalAccountId: connection.externalAccountId,
        scopes: connection.scopes,
      }),
    });
    const payload = (await response.json().catch(() => null)) as { error?: string; connection?: WorkspaceSocialConnection } | null;
    setBusyConnectionId(null);
    if (!response.ok || !payload?.connection) {
      setErrorMessage(payload?.error || "Unable to save social connection.");
      return;
    }
    setConnections((current) => current.map((item) => (item.id === connection.id ? payload.connection! : item)));
    setConnectionMessage("Social connection saved.");
  }

  async function deleteConnection(id: string) {
    setBusyConnectionId(id);
    setConnectionMessage(null);
    setErrorMessage(null);
    const response = await fetch(`/api/migramarket/social/connections/${id}`, { method: "DELETE" });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    setBusyConnectionId(null);
    if (!response.ok) {
      setErrorMessage(payload?.error || "Unable to delete social connection.");
      return;
    }
    setConnections((current) => current.filter((item) => item.id !== id));
    setConnectionMessage("Social connection deleted.");
  }

  async function startOauthConnection(connection: WorkspaceSocialConnection) {
    setBusyConnectionId(connection.id);
    setConnectionMessage(null);
    setErrorMessage(null);
    const response = await fetch(`/api/migramarket/social/connect/${connection.platform}/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connectionId: connection.id }),
    });
    const payload = (await response.json().catch(() => null)) as { error?: string; authorizeUrl?: string } | null;
    setBusyConnectionId(null);
    if (!response.ok || !payload?.authorizeUrl) {
      setErrorMessage(payload?.error || "Unable to start OAuth connection.");
      return;
    }

    window.location.assign(payload.authorizeUrl);
  }

  async function disconnectOauthConnection(connection: WorkspaceSocialConnection) {
    setBusyConnectionId(connection.id);
    setConnectionMessage(null);
    setErrorMessage(null);
    const response = await fetch(`/api/migramarket/social/connections/${connection.id}/disconnect`, {
      method: "POST",
    });
    const payload = (await response.json().catch(() => null)) as { error?: string; connection?: WorkspaceSocialConnection } | null;
    setBusyConnectionId(null);
    if (!response.ok || !payload?.connection) {
      setErrorMessage(payload?.error || "Unable to disconnect OAuth connection.");
      return;
    }

    setConnections((current) => current.map((item) => (item.id === connection.id ? payload.connection! : item)));
    setConnectionMessage(`${getPlatformLabel(connection.platform)} connection disconnected.`);
  }

  async function syncConnection(connection: WorkspaceSocialConnection) {
    setBusyConnectionId(connection.id);
    setConnectionMessage(null);
    setErrorMessage(null);
    const response = await fetch(`/api/migramarket/social/connections/${connection.id}/sync`, {
      method: "POST",
    });
    const payload = (await response.json().catch(() => null)) as { error?: string; connection?: WorkspaceSocialConnection } | null;
    setBusyConnectionId(null);
    if (!response.ok || !payload?.connection) {
      setErrorMessage(payload?.error || "Unable to sync social connection.");
      return;
    }
    setConnections((current) => current.map((item) => (item.id === connection.id ? payload.connection! : item)));
    setConnectionMessage(`${getPlatformLabel(connection.platform)} connection synced.`);
  }

  async function createBrief() {
    setBriefMessage(null);
    setErrorMessage(null);
    const response = await fetch("/api/migramarket/social/briefs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...briefForm,
        product: briefForm.product || null,
        audience: briefForm.audience || null,
        offer: briefForm.offer || null,
        cta: briefForm.cta || null,
        landingPage: briefForm.landingPage || null,
        channels: fromMultiline(briefForm.channels),
        visualStyle: briefForm.visualStyle || null,
        diversityNotes: briefForm.diversityNotes || null,
        brandSignature: briefForm.brandSignature || null,
        promptNotes: briefForm.promptNotes || null,
      }),
    });
    const payload = (await response.json().catch(() => null)) as { error?: string; brief?: WorkspaceCreativeBrief } | null;
    if (!response.ok || !payload?.brief) {
      setErrorMessage(payload?.error || "Unable to create creative brief.");
      return;
    }
    setBriefs((current) => [payload.brief!, ...current].slice(0, 12));
    setBriefForm((current) => ({
      ...current,
      name: "",
      product: "",
      audience: "",
      offer: "",
      cta: "",
      landingPage: "",
      promptNotes: "",
    }));
    setBriefMessage("Creative brief created.");
  }

  async function updateBrief(brief: WorkspaceCreativeBrief) {
    setBusyBriefId(brief.id);
    setBriefMessage(null);
    setErrorMessage(null);
    const response = await fetch(`/api/migramarket/social/briefs/${brief.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: brief.name,
        brand: brief.brand,
        product: brief.product,
        audience: brief.audience,
        objective: brief.objective,
        offer: brief.offer,
        cta: brief.cta,
        landingPage: brief.landingPage,
        channels: brief.channels,
        visualStyle: brief.visualStyle,
        diversityNotes: brief.diversityNotes,
        brandSignature: brief.brandSignature,
        promptNotes: brief.promptNotes,
        status: brief.status,
      }),
    });
    const payload = (await response.json().catch(() => null)) as { error?: string; brief?: WorkspaceCreativeBrief } | null;
    setBusyBriefId(null);
    if (!response.ok || !payload?.brief) {
      setErrorMessage(payload?.error || "Unable to save creative brief.");
      return;
    }
    setBriefs((current) => current.map((item) => (item.id === brief.id ? payload.brief! : item)));
    setBriefMessage("Creative brief saved.");
  }

  async function deleteBrief(id: string) {
    setBusyBriefId(id);
    setBriefMessage(null);
    setErrorMessage(null);
    const response = await fetch(`/api/migramarket/social/briefs/${id}`, { method: "DELETE" });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    setBusyBriefId(null);
    if (!response.ok) {
      setErrorMessage(payload?.error || "Unable to delete creative brief.");
      return;
    }
    setBriefs((current) => current.filter((item) => item.id !== id));
    setBriefMessage("Creative brief deleted.");
  }

  async function createJob() {
    setJobMessage(null);
    setErrorMessage(null);
    const response = await fetch("/api/migramarket/social/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...jobForm,
        briefId: jobForm.briefId || null,
        connectionId: jobForm.connectionId || null,
        scheduledAt: fromDatetimeLocal(jobForm.scheduledAt),
        destinationUrl: jobForm.destinationUrl || null,
        useLinkPreview: platformSupportsLinkPreview(jobForm.platform) ? jobForm.useLinkPreview : false,
        caption: jobForm.caption || null,
        assetUrls: fromMultiline(jobForm.assetUrls),
        thumbnailUrl: jobForm.thumbnailUrl || null,
        externalPostUrl: jobForm.externalPostUrl || null,
        publishProofUrl: jobForm.publishProofUrl || null,
        aiPrompt: jobForm.aiPrompt || null,
        internalNotes: jobForm.internalNotes || null,
        complianceNotes: jobForm.complianceNotes || null,
      }),
    });
    const payload = (await response.json().catch(() => null)) as { error?: string; job?: WorkspaceContentJob } | null;
    if (!response.ok || !payload?.job) {
      setErrorMessage(payload?.error || "Unable to create content job.");
      return;
    }
    setJobs((current) => [payload.job!, ...current].slice(0, 20));
    const defaults = getJobDefaults("instagram");
    setJobForm((current) => ({
      ...current,
      briefId: "",
      connectionId: "",
      title: "",
      platform: "instagram",
      format: defaults.format,
      publishMode: defaults.publishMode,
      scheduledAt: "",
      destinationUrl: "",
      useLinkPreview: defaults.useLinkPreview,
      caption: "",
      assetUrls: "",
      thumbnailUrl: "",
      externalPostUrl: "",
      publishProofUrl: "",
      aiPrompt: "",
      internalNotes: "",
      complianceNotes: "",
    }));
    setJobMessage("Content job created.");
  }

  async function updateJob(job: WorkspaceContentJob) {
    setBusyJobId(job.id);
    setJobMessage(null);
    setErrorMessage(null);
    const response = await fetch(`/api/migramarket/social/jobs/${job.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        briefId: job.briefId,
        connectionId: job.connectionId,
        title: job.title,
        platform: job.platform,
        format: job.format,
        publishMode: job.publishMode,
        status: job.status,
        destinationUrl: job.destinationUrl,
        useLinkPreview: platformSupportsLinkPreview(job.platform) ? Boolean(job.useLinkPreview) : false,
        scheduledAt: job.scheduledAt,
        caption: job.caption,
        assetUrls: job.assetUrls,
        thumbnailUrl: job.thumbnailUrl,
        externalPostUrl: job.externalPostUrl,
        publishProofUrl: job.publishProofUrl,
        aiPrompt: job.aiPrompt,
        internalNotes: job.internalNotes,
        complianceNotes: job.complianceNotes,
      }),
    });
    const payload = (await response.json().catch(() => null)) as { error?: string; job?: WorkspaceContentJob } | null;
    setBusyJobId(null);
    if (!response.ok || !payload?.job) {
      setErrorMessage(payload?.error || "Unable to save content job.");
      return;
    }
    setJobs((current) => current.map((item) => (item.id === job.id ? payload.job! : item)));
    setJobMessage("Content job saved.");
  }

  async function deleteJob(id: string) {
    setBusyJobId(id);
    setJobMessage(null);
    setErrorMessage(null);
    const response = await fetch(`/api/migramarket/social/jobs/${id}`, { method: "DELETE" });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    setBusyJobId(null);
    if (!response.ok) {
      setErrorMessage(payload?.error || "Unable to delete content job.");
      return;
    }
    setJobs((current) => current.filter((item) => item.id !== id));
    setJobMessage("Content job deleted.");
  }

  async function publishJob(job: WorkspaceContentJob) {
    setBusyJobId(job.id);
    setJobMessage(null);
    setErrorMessage(null);
    const response = await fetch(`/api/migramarket/social/jobs/${job.id}/publish`, {
      method: "POST",
    });
    const payload = (await response.json().catch(() => null)) as { error?: string; job?: WorkspaceContentJob; externalPostUrl?: string | null } | null;
    setBusyJobId(null);
    if (!response.ok || !payload?.job) {
      setErrorMessage(payload?.error || "Unable to publish content job.");
      return;
    }
    setJobs((current) => current.map((item) => (item.id === job.id ? payload.job! : item)));
    setJobMessage(`${getPlatformLabel(job.platform)} post published.`);
  }

  async function validateJob(job: WorkspaceContentJob) {
    setBusyJobId(job.id);
    setJobMessage(null);
    setErrorMessage(null);
    const response = await fetch(`/api/migramarket/social/jobs/${job.id}/validate`, {
      method: "POST",
    });
    const payload = (await response.json().catch(() => null)) as { error?: string; job?: WorkspaceContentJob } | null;
    setBusyJobId(null);
    if (!response.ok || !payload?.job) {
      setErrorMessage(payload?.error || "Unable to validate content job.");
      return;
    }
    setJobs((current) => current.map((item) => (item.id === job.id ? payload.job! : item)));
    setJobMessage("Validation report refreshed.");
  }

  async function createTemplate() {
    setTemplateMessage(null);
    setErrorMessage(null);
    const response = await fetch("/api/migramarket/social/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...templateForm,
        hashtags: fromMultiline(templateForm.hashtags),
        diversityChecklist: fromMultiline(templateForm.diversityChecklist),
      }),
    });
    const payload = (await response.json().catch(() => null)) as { error?: string; template?: WorkspaceContentTemplate } | null;
    if (!response.ok || !payload?.template) {
      setErrorMessage(payload?.error || "Unable to create content template.");
      return;
    }
    setTemplates((current) => [...current, payload.template!]);
    setTemplateForm({
      name: "",
      platform: "instagram",
      format: "reel",
      cadence: "weekly",
      publishMode: "api",
      titleTemplate: "",
      captionTemplate: "",
      aiPromptTemplate: "",
      cta: "Click to learn more",
      hashtags: "poweredbymigrateck\nmigrateck",
      diversityChecklist:
        "Balance Black, white, Asian, and Latino representation\nInclude women-led and mixed-team scenes",
      status: "active",
    });
    setTemplateMessage("Content template created.");
  }

  async function updateTemplate(template: WorkspaceContentTemplate) {
    setBusyTemplateId(template.id);
    setTemplateMessage(null);
    setErrorMessage(null);
    const response = await fetch(`/api/migramarket/social/templates/${template.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...template,
        hashtags: template.hashtags,
        diversityChecklist: template.diversityChecklist,
      }),
    });
    const payload = (await response.json().catch(() => null)) as { error?: string; template?: WorkspaceContentTemplate } | null;
    setBusyTemplateId(null);
    if (!response.ok || !payload?.template) {
      setErrorMessage(payload?.error || "Unable to update template.");
      return;
    }
    setTemplates((current) => current.map((item) => (item.id === payload.template!.id ? payload.template! : item)));
    setTemplateMessage("Content template updated.");
  }

  async function deleteTemplate(id: string) {
    setBusyTemplateId(id);
    setTemplateMessage(null);
    setErrorMessage(null);
    const response = await fetch(`/api/migramarket/social/templates/${id}`, { method: "DELETE" });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    setBusyTemplateId(null);
    if (!response.ok) {
      setErrorMessage(payload?.error || "Unable to delete template.");
      return;
    }
    setTemplates((current) => current.filter((item) => item.id !== id));
    setCalendarSlots((current) => current.map((item) => (item.templateId === id ? { ...item, templateId: null, template: null } : item)));
    setTemplateMessage("Content template deleted.");
  }

  async function createCalendarSlot() {
    setCalendarMessage(null);
    setErrorMessage(null);
    const response = await fetch("/api/migramarket/social/calendar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...calendarForm,
        templateId: calendarForm.templateId || null,
        connectionId: calendarForm.connectionId || null,
        weekday: Number.parseInt(calendarForm.weekday, 10),
        slotTime: calendarForm.slotTime || null,
        scheduledFor: fromDatetimeLocal(calendarForm.scheduledFor),
        assetChecklist: fromMultiline(calendarForm.assetChecklist),
      }),
    });
    const payload = (await response.json().catch(() => null)) as { error?: string; slot?: WorkspaceCalendarSlot } | null;
    if (!response.ok || !payload?.slot) {
      setErrorMessage(payload?.error || "Unable to create calendar slot.");
      return;
    }
    setCalendarSlots((current) => [...current, payload.slot!].sort((a, b) => a.weekday - b.weekday || (a.slotTime || "").localeCompare(b.slotTime || "")));
    setCalendarForm({
      templateId: "",
      connectionId: "",
      title: "",
      platform: "instagram",
      format: "reel",
      publishMode: "api",
      weekday: "1",
      slotTime: "09:30",
      scheduledFor: "",
      status: "planned",
      theme: "",
      cta: "",
      aiPrompt: "",
      assetChecklist: "Hook visual\nCaption\nCTA",
      notes: "",
    });
    setCalendarMessage("Calendar slot created.");
  }

  async function updateCalendarSlot(slot: WorkspaceCalendarSlot) {
    setBusyCalendarId(slot.id);
    setCalendarMessage(null);
    setErrorMessage(null);
    const response = await fetch(`/api/migramarket/social/calendar/${slot.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...slot,
        assetChecklist: slot.assetChecklist,
      }),
    });
    const payload = (await response.json().catch(() => null)) as { error?: string; slot?: WorkspaceCalendarSlot } | null;
    setBusyCalendarId(null);
    if (!response.ok || !payload?.slot) {
      setErrorMessage(payload?.error || "Unable to update calendar slot.");
      return;
    }
    setCalendarSlots((current) =>
      current
        .map((item) => (item.id === payload.slot!.id ? payload.slot! : item))
        .sort((a, b) => a.weekday - b.weekday || (a.slotTime || "").localeCompare(b.slotTime || "")),
    );
    setCalendarMessage("Calendar slot updated.");
  }

  async function deleteCalendarSlot(id: string) {
    setBusyCalendarId(id);
    setCalendarMessage(null);
    setErrorMessage(null);
    const response = await fetch(`/api/migramarket/social/calendar/${id}`, { method: "DELETE" });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    setBusyCalendarId(null);
    if (!response.ok) {
      setErrorMessage(payload?.error || "Unable to delete calendar slot.");
      return;
    }
    setCalendarSlots((current) => current.filter((item) => item.id !== id));
    setCalendarMessage("Calendar slot deleted.");
  }

  return (
    <section className="grid gap-6">
      <article className="rounded-2xl border border-[var(--line)] bg-white p-5">
        <h2 className="text-lg font-bold">Social publishing control</h2>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          Manage platform access, creative briefs, and queued publish jobs for API-first and assisted posting lanes.
        </p>
        {errorMessage ? <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</p> : null}
        <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_1fr]">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-[var(--ink)]">Connected channels</p>
              {connectionMessage ? <span className="text-sm text-green-700">{connectionMessage}</span> : null}
            </div>
            {connections.map((connection) => (
              <div key={connection.id} className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <input value={connection.platform} disabled={!canManage || busyConnectionId === connection.id} onChange={(event) => setConnections((current) => current.map((item) => item.id === connection.id ? { ...item, platform: event.target.value } : item))} className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm" />
                  <input value={connection.handle} disabled={!canManage || busyConnectionId === connection.id} onChange={(event) => setConnections((current) => current.map((item) => item.id === connection.id ? { ...item, handle: event.target.value } : item))} className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm" />
                  <select value={connection.publishMode} disabled={!canManage || busyConnectionId === connection.id} onChange={(event) => setConnections((current) => current.map((item) => item.id === connection.id ? { ...item, publishMode: event.target.value } : item))} className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm">
                    {publishModeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                  <select value={connection.accessModel} disabled={!canManage || busyConnectionId === connection.id} onChange={(event) => setConnections((current) => current.map((item) => item.id === connection.id ? { ...item, accessModel: event.target.value } : item))} className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm">
                    {accessModelOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                  <select value={connection.status} disabled={!canManage || busyConnectionId === connection.id} onChange={(event) => setConnections((current) => current.map((item) => item.id === connection.id ? { ...item, status: event.target.value } : item))} className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm">
                    {connectionStatusOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                  <input value={connection.profileUrl || ""} disabled={!canManage || busyConnectionId === connection.id} onChange={(event) => setConnections((current) => current.map((item) => item.id === connection.id ? { ...item, profileUrl: event.target.value } : item))} placeholder="Profile URL" className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm" />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.18em] text-[var(--ink-soft)]">
                  <span
                    className={`rounded-full border px-2 py-1 text-[11px] font-semibold tracking-[0.18em] ${getPublishReadinessClass(connection.publishReadiness.state)}`}
                  >
                    {connection.publishReadiness.label}
                  </span>
                  <span className={`rounded-full border px-2 py-1 text-[11px] font-semibold tracking-[0.18em] ${getConnectionHealthClass(connection.health.state)}`}>
                    {connection.health.summary}
                  </span>
                  <span>{connection.publishReadiness.reason}</span>
                  {connection.tokenExpiresAt ? <span>Token expires {new Date(connection.tokenExpiresAt).toLocaleDateString()}</span> : null}
                  {connection.lastVerifiedAt ? <span>Verified {new Date(connection.lastVerifiedAt).toLocaleDateString()}</span> : null}
                  {connection.health.expiresInHours !== null ? <span>{connection.health.expiresInHours}h to expiry</span> : null}
                  {readMetadataNumber(connection.metadata, "legacyFollowers") !== null ? (
                    <span>{readMetadataNumber(connection.metadata, "legacyFollowers")!.toLocaleString()} legacy followers</span>
                  ) : null}
                </div>
                {connection.publishReadiness.needsAttention ? (
                  <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                    Direct publish blocked: {connection.publishReadiness.reason}
                  </p>
                ) : null}
                {connection.health.needsAttention ? (
                  <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    Recommended action: {connection.health.recommendedAction.replace(/_/g, " ")}.
                  </p>
                ) : null}
                {readMetadataValue(connection.metadata, "migrationState") === "reconnect_required" ? (
                  <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    {readMetadataValue(connection.metadata, "migrationNote") ||
                      "This channel was imported from the legacy marketing stack without a usable OAuth token. Reconnect it here in MigraMarket so Postgres becomes the system of record."}
                  </p>
                ) : null}
                {readMetadataValue(connection.metadata, "lastSyncError") ? (
                  <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    {readMetadataValue(connection.metadata, "lastSyncError")}
                  </p>
                ) : null}
                {renderPlatformNotes(getSocialPlatformDefinition(connection.platform), "plain")}
                <input value={connection.scopes.join("\n")} disabled={!canManage || busyConnectionId === connection.id} onChange={(event) => setConnections((current) => current.map((item) => item.id === connection.id ? { ...item, scopes: fromMultiline(event.target.value) } : item))} placeholder="Scopes, one per line" className="mt-3 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm" />
                {canManage ? (
                  <div className="mt-3 flex gap-3">
                    {connection.oauth.supported ? (
                      connection.oauth.connected ? (
                        <ActionButton variant="secondary" onClick={() => void disconnectOauthConnection(connection)} disabled={busyConnectionId === connection.id}>
                          Disconnect OAuth
                        </ActionButton>
                      ) : (
                        <ActionButton variant="secondary" onClick={() => void startOauthConnection(connection)} disabled={busyConnectionId === connection.id || !connection.oauth.configured}>
                          {busyConnectionId === connection.id ? "Connecting..." : connection.oauth.configured ? "Connect OAuth" : "OAuth not configured"}
                        </ActionButton>
                      )
                    ) : null}
                    {connection.oauth.connected ? (
                      <ActionButton variant="secondary" onClick={() => void syncConnection(connection)} disabled={busyConnectionId === connection.id}>
                        {busyConnectionId === connection.id ? "Syncing..." : "Sync"}
                      </ActionButton>
                    ) : null}
                    <ActionButton variant="secondary" onClick={() => void updateConnection(connection)} disabled={busyConnectionId === connection.id}>
                      {busyConnectionId === connection.id ? "Saving..." : "Save"}
                    </ActionButton>
                    <ActionButton variant="secondary" onClick={() => void deleteConnection(connection.id)} disabled={busyConnectionId === connection.id}>
                      Delete
                    </ActionButton>
                  </div>
                ) : null}
              </div>
            ))}
            {canManage ? (
              <div className="rounded-2xl border border-dashed border-[var(--line)] p-4">
                <p className="font-semibold text-[var(--ink)]">Add channel</p>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <select
                    value={connectionForm.platform}
                    onChange={(event) => {
                      const platform = event.target.value;
                      const defaults = getConnectionDefaults(platform);
                      setConnectionForm((current) => ({
                        ...current,
                        platform,
                        publishMode: defaults.publishMode,
                        accessModel: defaults.accessModel,
                      }));
                    }}
                    className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm"
                  >
                    {platformOptions.map((option) => <option key={option} value={option}>{getPlatformLabel(option)}</option>)}
                  </select>
                  <input value={connectionForm.handle} onChange={(event) => setConnectionForm((current) => ({ ...current, handle: event.target.value }))} placeholder="@migrahosting" className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                  <input value={connectionForm.profileType} onChange={(event) => setConnectionForm((current) => ({ ...current, profileType: event.target.value }))} placeholder="business" className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                  <input value={connectionForm.profileUrl} onChange={(event) => setConnectionForm((current) => ({ ...current, profileUrl: event.target.value }))} placeholder="https://..." className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                  <select value={connectionForm.publishMode} onChange={(event) => setConnectionForm((current) => ({ ...current, publishMode: event.target.value as (typeof publishModeOptions)[number] }))} className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm">
                    {publishModeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                  <select value={connectionForm.accessModel} onChange={(event) => setConnectionForm((current) => ({ ...current, accessModel: event.target.value as (typeof accessModelOptions)[number] }))} className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm">
                    {accessModelOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </div>
                {renderPlatformNotes(selectedConnectionPlatform)}
                <textarea value={connectionForm.scopes} onChange={(event) => setConnectionForm((current) => ({ ...current, scopes: event.target.value }))} placeholder="Scopes or permission notes" className="mt-3 min-h-20 w-full rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                <div className="mt-3">
                  <ActionButton onClick={() => void createConnection()} disabled={!connectionForm.handle}>
                    Add channel
                  </ActionButton>
                </div>
              </div>
            ) : null}
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-[var(--ink)]">Creative briefs</p>
              {briefMessage ? <span className="text-sm text-green-700">{briefMessage}</span> : null}
            </div>
            {briefs.map((brief) => (
              <div key={brief.id} className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-4">
                <input value={brief.name} disabled={!canManage || busyBriefId === brief.id} onChange={(event) => setBriefs((current) => current.map((item) => item.id === brief.id ? { ...item, name: event.target.value } : item))} className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm font-semibold text-[var(--ink)]" />
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <input value={brief.brand} disabled={!canManage || busyBriefId === brief.id} onChange={(event) => setBriefs((current) => current.map((item) => item.id === brief.id ? { ...item, brand: event.target.value } : item))} className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm" />
                  <select value={brief.objective} disabled={!canManage || busyBriefId === brief.id} onChange={(event) => setBriefs((current) => current.map((item) => item.id === brief.id ? { ...item, objective: event.target.value } : item))} className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm">
                    {objectiveOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                  <input value={brief.product || ""} disabled={!canManage || busyBriefId === brief.id} onChange={(event) => setBriefs((current) => current.map((item) => item.id === brief.id ? { ...item, product: event.target.value } : item))} placeholder="Product" className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm" />
                  <input value={brief.audience || ""} disabled={!canManage || busyBriefId === brief.id} onChange={(event) => setBriefs((current) => current.map((item) => item.id === brief.id ? { ...item, audience: event.target.value } : item))} placeholder="Audience" className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm" />
                </div>
                <input value={brief.offer || ""} disabled={!canManage || busyBriefId === brief.id} onChange={(event) => setBriefs((current) => current.map((item) => item.id === brief.id ? { ...item, offer: event.target.value } : item))} placeholder="Offer" className="mt-3 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm" />
                <input value={brief.channels.join("\n")} disabled={!canManage || busyBriefId === brief.id} onChange={(event) => setBriefs((current) => current.map((item) => item.id === brief.id ? { ...item, channels: fromMultiline(event.target.value) } : item))} placeholder="Channels" className="mt-3 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm" />
                <textarea value={brief.diversityNotes || ""} disabled={!canManage || busyBriefId === brief.id} onChange={(event) => setBriefs((current) => current.map((item) => item.id === brief.id ? { ...item, diversityNotes: event.target.value } : item))} placeholder="Diversity notes" className="mt-3 min-h-20 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm" />
                <textarea value={brief.promptNotes || ""} disabled={!canManage || busyBriefId === brief.id} onChange={(event) => setBriefs((current) => current.map((item) => item.id === brief.id ? { ...item, promptNotes: event.target.value } : item))} placeholder="Prompt notes" className="mt-3 min-h-20 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm" />
                <div className="mt-3 flex flex-wrap gap-3">
                  <select value={brief.status} disabled={!canManage || busyBriefId === brief.id} onChange={(event) => setBriefs((current) => current.map((item) => item.id === brief.id ? { ...item, status: event.target.value } : item))} className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm">
                    {briefStatusOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                  {canManage ? (
                    <>
                      <ActionButton variant="secondary" onClick={() => void updateBrief(brief)} disabled={busyBriefId === brief.id}>
                        {busyBriefId === brief.id ? "Saving..." : "Save"}
                      </ActionButton>
                      <ActionButton variant="secondary" onClick={() => void deleteBrief(brief.id)} disabled={busyBriefId === brief.id}>
                        Delete
                      </ActionButton>
                    </>
                  ) : null}
                </div>
              </div>
            ))}
            {canManage ? (
              <div className="rounded-2xl border border-dashed border-[var(--line)] p-4">
                <p className="font-semibold text-[var(--ink)]">Create brief</p>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <input value={briefForm.name} onChange={(event) => setBriefForm((current) => ({ ...current, name: event.target.value }))} placeholder="April launch wave" className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                  <input value={briefForm.brand} onChange={(event) => setBriefForm((current) => ({ ...current, brand: event.target.value }))} placeholder="MigraHosting" className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                  <input value={briefForm.product} onChange={(event) => setBriefForm((current) => ({ ...current, product: event.target.value }))} placeholder="Product" className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                  <select value={briefForm.objective} onChange={(event) => setBriefForm((current) => ({ ...current, objective: event.target.value }))} className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm">
                    {objectiveOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </div>
                <input value={briefForm.offer} onChange={(event) => setBriefForm((current) => ({ ...current, offer: event.target.value }))} placeholder="Offer" className="mt-3 w-full rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                <textarea value={briefForm.channels} onChange={(event) => setBriefForm((current) => ({ ...current, channels: event.target.value }))} placeholder="Channels" className="mt-3 min-h-20 w-full rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                <textarea value={briefForm.diversityNotes} onChange={(event) => setBriefForm((current) => ({ ...current, diversityNotes: event.target.value }))} placeholder="Diversity requirements" className="mt-3 min-h-20 w-full rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                <textarea value={briefForm.promptNotes} onChange={(event) => setBriefForm((current) => ({ ...current, promptNotes: event.target.value }))} placeholder="Prompt notes" className="mt-3 min-h-20 w-full rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                <div className="mt-3">
                  <ActionButton onClick={() => void createBrief()} disabled={!briefForm.name}>
                    Create brief
                  </ActionButton>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </article>

      <article className="rounded-2xl border border-[var(--line)] bg-white p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold">Templates and weekly calendar</h2>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">
              Build reusable post systems, then map them into a repeatable weekly cadence for reels, shorts, carousels, and authority posts.
            </p>
          </div>
        </div>
        <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_1fr]">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-[var(--ink)]">Content templates</p>
              {templateMessage ? <span className="text-sm text-green-700">{templateMessage}</span> : null}
            </div>
            {templates.map((template) => (
              <div key={template.id} className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <input value={template.name} disabled={!canManage || busyTemplateId === template.id} onChange={(event) => setTemplates((current) => current.map((item) => item.id === template.id ? { ...item, name: event.target.value } : item))} className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm font-semibold" />
                  <select value={template.platform} disabled={!canManage || busyTemplateId === template.id} onChange={(event) => setTemplates((current) => current.map((item) => item.id === template.id ? { ...item, platform: event.target.value } : item))} className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm">
                    {platformOptions.map((option) => <option key={option} value={option}>{getPlatformLabel(option)}</option>)}
                  </select>
                  <select value={template.format} disabled={!canManage || busyTemplateId === template.id} onChange={(event) => setTemplates((current) => current.map((item) => item.id === template.id ? { ...item, format: event.target.value } : item))} className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm">
                    {formatOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                  <select value={template.cadence} disabled={!canManage || busyTemplateId === template.id} onChange={(event) => setTemplates((current) => current.map((item) => item.id === template.id ? { ...item, cadence: event.target.value } : item))} className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm">
                    {templateCadenceOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </div>
                <input value={template.titleTemplate} disabled={!canManage || busyTemplateId === template.id} onChange={(event) => setTemplates((current) => current.map((item) => item.id === template.id ? { ...item, titleTemplate: event.target.value } : item))} placeholder="Title template" className="mt-3 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm" />
                {renderPlatformNotes(getSocialPlatformDefinition(template.platform), "plain")}
                <textarea value={template.captionTemplate || ""} disabled={!canManage || busyTemplateId === template.id} onChange={(event) => setTemplates((current) => current.map((item) => item.id === template.id ? { ...item, captionTemplate: event.target.value } : item))} placeholder="Caption template" className="mt-3 min-h-20 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm" />
                <textarea value={template.aiPromptTemplate || ""} disabled={!canManage || busyTemplateId === template.id} onChange={(event) => setTemplates((current) => current.map((item) => item.id === template.id ? { ...item, aiPromptTemplate: event.target.value } : item))} placeholder="AI prompt template" className="mt-3 min-h-20 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm" />
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <input value={template.cta || ""} disabled={!canManage || busyTemplateId === template.id} onChange={(event) => setTemplates((current) => current.map((item) => item.id === template.id ? { ...item, cta: event.target.value } : item))} placeholder="CTA" className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm" />
                  <select value={template.status} disabled={!canManage || busyTemplateId === template.id} onChange={(event) => setTemplates((current) => current.map((item) => item.id === template.id ? { ...item, status: event.target.value } : item))} className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm">
                    {templateStatusOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </div>
                <input value={template.hashtags.join("\n")} disabled={!canManage || busyTemplateId === template.id} onChange={(event) => setTemplates((current) => current.map((item) => item.id === template.id ? { ...item, hashtags: fromMultiline(event.target.value) } : item))} placeholder="Hashtags, one per line" className="mt-3 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm" />
                <textarea value={template.diversityChecklist.join("\n")} disabled={!canManage || busyTemplateId === template.id} onChange={(event) => setTemplates((current) => current.map((item) => item.id === template.id ? { ...item, diversityChecklist: fromMultiline(event.target.value) } : item))} placeholder="Diversity checklist" className="mt-3 min-h-20 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm" />
                {canManage ? (
                  <div className="mt-3 flex flex-wrap gap-3">
                    <ActionButton variant="secondary" onClick={() => void updateTemplate(template)} disabled={busyTemplateId === template.id}>
                      {busyTemplateId === template.id ? "Saving..." : "Save"}
                    </ActionButton>
                    <ActionButton variant="secondary" onClick={() => void deleteTemplate(template.id)} disabled={busyTemplateId === template.id}>
                      Delete
                    </ActionButton>
                  </div>
                ) : null}
              </div>
            ))}
            {canManage ? (
              <div className="rounded-2xl border border-dashed border-[var(--line)] p-4">
                <p className="font-semibold text-[var(--ink)]">Create template</p>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <input value={templateForm.name} onChange={(event) => setTemplateForm((current) => ({ ...current, name: event.target.value }))} placeholder="Monday founder reel" className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                  <select value={templateForm.platform} onChange={(event) => setTemplateForm((current) => ({ ...current, platform: event.target.value }))} className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm">
                    {platformOptions.map((option) => <option key={option} value={option}>{getPlatformLabel(option)}</option>)}
                  </select>
                  <select value={templateForm.format} onChange={(event) => setTemplateForm((current) => ({ ...current, format: event.target.value }))} className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm">
                    {formatOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                  <select value={templateForm.cadence} onChange={(event) => setTemplateForm((current) => ({ ...current, cadence: event.target.value }))} className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm">
                    {templateCadenceOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </div>
                <input value={templateForm.titleTemplate} onChange={(event) => setTemplateForm((current) => ({ ...current, titleTemplate: event.target.value }))} placeholder="Title template" className="mt-3 w-full rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                {renderPlatformNotes(selectedTemplatePlatform)}
                <textarea value={templateForm.captionTemplate} onChange={(event) => setTemplateForm((current) => ({ ...current, captionTemplate: event.target.value }))} placeholder="Caption template" className="mt-3 min-h-20 w-full rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                <textarea value={templateForm.aiPromptTemplate} onChange={(event) => setTemplateForm((current) => ({ ...current, aiPromptTemplate: event.target.value }))} placeholder="AI prompt template" className="mt-3 min-h-20 w-full rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                <input value={templateForm.hashtags} onChange={(event) => setTemplateForm((current) => ({ ...current, hashtags: event.target.value }))} placeholder="Hashtags" className="mt-3 w-full rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                <textarea value={templateForm.diversityChecklist} onChange={(event) => setTemplateForm((current) => ({ ...current, diversityChecklist: event.target.value }))} placeholder="Diversity checklist" className="mt-3 min-h-20 w-full rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                <div className="mt-3">
                  <ActionButton onClick={() => void createTemplate()} disabled={!templateForm.name || !templateForm.titleTemplate}>
                    Create template
                  </ActionButton>
                </div>
              </div>
            ) : null}
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-[var(--ink)]">Weekly calendar</p>
              {calendarMessage ? <span className="text-sm text-green-700">{calendarMessage}</span> : null}
            </div>
            {calendarSlots.map((slot) => (
              <div key={slot.id} className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <input value={slot.title} disabled={!canManage || busyCalendarId === slot.id} onChange={(event) => setCalendarSlots((current) => current.map((item) => item.id === slot.id ? { ...item, title: event.target.value } : item))} className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm font-semibold" />
                  <select value={String(slot.weekday)} disabled={!canManage || busyCalendarId === slot.id} onChange={(event) => setCalendarSlots((current) => current.map((item) => item.id === slot.id ? { ...item, weekday: Number.parseInt(event.target.value, 10) } : item))} className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm">
                    {weekdayOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                  <select value={slot.platform} disabled={!canManage || busyCalendarId === slot.id} onChange={(event) => setCalendarSlots((current) => current.map((item) => item.id === slot.id ? { ...item, platform: event.target.value } : item))} className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm">
                    {platformOptions.map((option) => <option key={option} value={option}>{getPlatformLabel(option)}</option>)}
                  </select>
                  <input value={slot.slotTime || ""} disabled={!canManage || busyCalendarId === slot.id} onChange={(event) => setCalendarSlots((current) => current.map((item) => item.id === slot.id ? { ...item, slotTime: event.target.value } : item))} placeholder="09:30" className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm" />
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <select value={slot.templateId || ""} disabled={!canManage || busyCalendarId === slot.id} onChange={(event) => setCalendarSlots((current) => current.map((item) => item.id === slot.id ? { ...item, templateId: event.target.value || null, template: templates.find((template) => template.id === event.target.value) ? { id: event.target.value, name: templates.find((template) => template.id === event.target.value)!.name, platform: templates.find((template) => template.id === event.target.value)!.platform, cadence: templates.find((template) => template.id === event.target.value)!.cadence } : null } : item))} className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm">
                    <option value="">No template</option>
                    {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
                  </select>
                  <select value={slot.connectionId || ""} disabled={!canManage || busyCalendarId === slot.id} onChange={(event) => setCalendarSlots((current) => current.map((item) => item.id === slot.id ? { ...item, connectionId: event.target.value || null, connection: connections.find((connection) => connection.id === event.target.value) ? { id: event.target.value, platform: connections.find((connection) => connection.id === event.target.value)!.platform, handle: connections.find((connection) => connection.id === event.target.value)!.handle } : null } : item))} className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm">
                    <option value="">No channel</option>
                    {connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.platform} / {connection.handle}</option>)}
                  </select>
                  <select value={slot.status} disabled={!canManage || busyCalendarId === slot.id} onChange={(event) => setCalendarSlots((current) => current.map((item) => item.id === slot.id ? { ...item, status: event.target.value } : item))} className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm">
                    {calendarStatusOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                  <input type="datetime-local" value={toDatetimeLocal(slot.scheduledFor)} disabled={!canManage || busyCalendarId === slot.id} onChange={(event) => setCalendarSlots((current) => current.map((item) => item.id === slot.id ? { ...item, scheduledFor: fromDatetimeLocal(event.target.value) } : item))} className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm" />
                </div>
                {renderPlatformNotes(getSocialPlatformDefinition(slot.platform), "plain")}
                <div className="mt-3 text-xs uppercase tracking-[0.18em] text-[var(--ink-soft)]">
                  {weekdayLabel(slot.weekday)}{slot.slotTime ? ` · ${slot.slotTime}` : ""}{slot.template ? ` · Template: ${slot.template.name}` : ""}
                </div>
                <textarea value={slot.assetChecklist.join("\n")} disabled={!canManage || busyCalendarId === slot.id} onChange={(event) => setCalendarSlots((current) => current.map((item) => item.id === slot.id ? { ...item, assetChecklist: fromMultiline(event.target.value) } : item))} placeholder="Asset checklist" className="mt-3 min-h-20 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm" />
                <textarea value={slot.aiPrompt || ""} disabled={!canManage || busyCalendarId === slot.id} onChange={(event) => setCalendarSlots((current) => current.map((item) => item.id === slot.id ? { ...item, aiPrompt: event.target.value } : item))} placeholder="Prompt override" className="mt-3 min-h-20 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm" />
                <textarea value={slot.notes || ""} disabled={!canManage || busyCalendarId === slot.id} onChange={(event) => setCalendarSlots((current) => current.map((item) => item.id === slot.id ? { ...item, notes: event.target.value } : item))} placeholder="Notes" className="mt-3 min-h-20 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm" />
                {canManage ? (
                  <div className="mt-3 flex flex-wrap gap-3">
                    <ActionButton variant="secondary" onClick={() => void updateCalendarSlot(slot)} disabled={busyCalendarId === slot.id}>
                      {busyCalendarId === slot.id ? "Saving..." : "Save"}
                    </ActionButton>
                    <ActionButton variant="secondary" onClick={() => void deleteCalendarSlot(slot.id)} disabled={busyCalendarId === slot.id}>
                      Delete
                    </ActionButton>
                  </div>
                ) : null}
              </div>
            ))}
            {canManage ? (
              <div className="rounded-2xl border border-dashed border-[var(--line)] p-4">
                <p className="font-semibold text-[var(--ink)]">Add calendar slot</p>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <input value={calendarForm.title} onChange={(event) => setCalendarForm((current) => ({ ...current, title: event.target.value }))} placeholder="Thursday promo short" className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                  <select value={calendarForm.weekday} onChange={(event) => setCalendarForm((current) => ({ ...current, weekday: event.target.value }))} className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm">
                    {weekdayOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                  <select value={calendarForm.platform} onChange={(event) => setCalendarForm((current) => ({ ...current, platform: event.target.value }))} className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm">
                    {platformOptions.map((option) => <option key={option} value={option}>{getPlatformLabel(option)}</option>)}
                  </select>
                  <input value={calendarForm.slotTime} onChange={(event) => setCalendarForm((current) => ({ ...current, slotTime: event.target.value }))} placeholder="09:30" className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                  <select value={calendarForm.templateId} onChange={(event) => setCalendarForm((current) => ({ ...current, templateId: event.target.value }))} className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm">
                    <option value="">No template</option>
                    {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
                  </select>
                  <select value={calendarForm.connectionId} onChange={(event) => setCalendarForm((current) => ({ ...current, connectionId: event.target.value }))} className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm">
                    <option value="">No channel</option>
                    {connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.platform} / {connection.handle}</option>)}
                  </select>
                </div>
                {renderPlatformNotes(selectedCalendarPlatform)}
                <textarea value={calendarForm.assetChecklist} onChange={(event) => setCalendarForm((current) => ({ ...current, assetChecklist: event.target.value }))} placeholder="Asset checklist" className="mt-3 min-h-20 w-full rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                <textarea value={calendarForm.aiPrompt} onChange={(event) => setCalendarForm((current) => ({ ...current, aiPrompt: event.target.value }))} placeholder="Prompt override" className="mt-3 min-h-20 w-full rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                <div className="mt-3">
                  <ActionButton onClick={() => void createCalendarSlot()} disabled={!calendarForm.title}>
                    Add slot
                  </ActionButton>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </article>

      <article className="rounded-2xl border border-[var(--line)] bg-white p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold">Publish queue</h2>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">
              Queue reels, posts, and shorts by platform, then push them through API or assisted publish lanes.
            </p>
          </div>
          {jobMessage ? <span className="text-sm text-green-700">{jobMessage}</span> : null}
        </div>
        <div className="mt-4 space-y-3">
          {jobs.map((job) => (
            <div key={job.id} className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-4">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <input value={job.title} disabled={!canManage || busyJobId === job.id} onChange={(event) => setJobs((current) => current.map((item) => item.id === job.id ? { ...item, title: event.target.value } : item))} className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm" />
                <select value={job.platform} disabled={!canManage || busyJobId === job.id} onChange={(event) => setJobs((current) => current.map((item) => item.id === job.id ? { ...item, platform: event.target.value } : item))} className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm">
                  {platformOptions.map((option) => <option key={option} value={option}>{getPlatformLabel(option)}</option>)}
                </select>
                <select value={job.format} disabled={!canManage || busyJobId === job.id} onChange={(event) => setJobs((current) => current.map((item) => item.id === job.id ? { ...item, format: event.target.value } : item))} className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm">
                  {formatOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
                <select value={job.publishMode} disabled={!canManage || busyJobId === job.id} onChange={(event) => setJobs((current) => current.map((item) => item.id === job.id ? { ...item, publishMode: event.target.value } : item))} className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm">
                  {publishModeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <select value={job.status} disabled={!canManage || busyJobId === job.id} onChange={(event) => setJobs((current) => current.map((item) => item.id === job.id ? { ...item, status: event.target.value } : item))} className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm">
                  {jobStatusOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
                <select value={job.briefId || ""} disabled={!canManage || busyJobId === job.id} onChange={(event) => setJobs((current) => current.map((item) => item.id === job.id ? { ...item, briefId: event.target.value || null } : item))} className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm">
                  <option value="">No brief</option>
                  {briefs.map((brief) => <option key={brief.id} value={brief.id}>{brief.name}</option>)}
                </select>
                <select value={job.connectionId || ""} disabled={!canManage || busyJobId === job.id} onChange={(event) => setJobs((current) => current.map((item) => item.id === job.id ? { ...item, connectionId: event.target.value || null } : item))} className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm">
                  <option value="">No channel</option>
                  {connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.platform} / {connection.handle}</option>)}
                </select>
                <input type="datetime-local" value={toDatetimeLocal(job.scheduledAt)} disabled={!canManage || busyJobId === job.id} onChange={(event) => setJobs((current) => current.map((item) => item.id === job.id ? { ...item, scheduledAt: fromDatetimeLocal(event.target.value) } : item))} className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm" />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.18em] text-[var(--ink-soft)]">
                <span>Validation: {(job.validationStatus || "unvalidated").replaceAll("_", " ")}</span>
                {job.destinationUrl ? <span>Destination linked</span> : null}
                {job.useLinkPreview ? <span>Link ad preview on</span> : null}
                {job.latestValidation ? (
                  <span>
                    Latest QA {(job.latestValidation.finalStatus || "unknown").replaceAll("_", " ")}
                    {job.latestValidation.designQualityScore ? ` / ${job.latestValidation.designQualityScore.toFixed(1)}` : ""}
                  </span>
                ) : null}
                {job.selectedAsset ? <span>Asset {job.selectedAsset.assetKey}</span> : null}
                {job.captionVariant ? <span>Caption {job.captionVariant.captionKey}</span> : null}
              </div>
              {renderPlatformNotes(getSocialPlatformDefinition(job.platform), "plain")}
              <textarea value={job.caption || ""} disabled={!canManage || busyJobId === job.id} onChange={(event) => setJobs((current) => current.map((item) => item.id === job.id ? { ...item, caption: event.target.value } : item))} placeholder="Caption" className="mt-3 min-h-20 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm" />
              <input value={job.assetUrls.join("\n")} disabled={!canManage || busyJobId === job.id} onChange={(event) => setJobs((current) => current.map((item) => item.id === job.id ? { ...item, assetUrls: fromMultiline(event.target.value) } : item))} placeholder="Asset URLs, one per line" className="mt-3 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm" />
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <input value={job.destinationUrl || ""} disabled={!canManage || busyJobId === job.id} onChange={(event) => setJobs((current) => current.map((item) => item.id === job.id ? { ...item, destinationUrl: event.target.value } : item))} placeholder="Destination URL for website/link ad" className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm" />
                <label className="flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm text-[var(--ink)]">
                  <input
                    type="checkbox"
                    checked={platformSupportsLinkPreview(job.platform) ? Boolean(job.useLinkPreview) : false}
                    disabled={!canManage || busyJobId === job.id || !platformSupportsLinkPreview(job.platform)}
                    onChange={(event) => setJobs((current) => current.map((item) => item.id === job.id ? { ...item, useLinkPreview: event.target.checked } : item))}
                  />
                  Publish as website/link advertisement preview
                </label>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <input value={job.externalPostUrl || ""} disabled={!canManage || busyJobId === job.id} onChange={(event) => setJobs((current) => current.map((item) => item.id === job.id ? { ...item, externalPostUrl: event.target.value } : item))} placeholder="Published post URL" className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm" />
                <input value={job.publishProofUrl || ""} disabled={!canManage || busyJobId === job.id} onChange={(event) => setJobs((current) => current.map((item) => item.id === job.id ? { ...item, publishProofUrl: event.target.value } : item))} placeholder="Screenshot or proof URL" className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm" />
              </div>
              <textarea value={job.aiPrompt || ""} disabled={!canManage || busyJobId === job.id} onChange={(event) => setJobs((current) => current.map((item) => item.id === job.id ? { ...item, aiPrompt: event.target.value } : item))} placeholder="AI prompt" className="mt-3 min-h-20 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm" />
              <textarea value={job.complianceNotes || ""} disabled={!canManage || busyJobId === job.id} onChange={(event) => setJobs((current) => current.map((item) => item.id === job.id ? { ...item, complianceNotes: event.target.value } : item))} placeholder="Compliance notes" className="mt-3 min-h-20 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm" />
              {job.externalPostUrl || job.publishProofUrl ? (
                <div className="mt-3 flex flex-wrap gap-3 text-sm">
                  {job.externalPostUrl ? (
                    <a href={job.externalPostUrl} target="_blank" rel="noreferrer" className="text-[var(--brand)] underline-offset-2 hover:underline">
                      Open live post
                    </a>
                  ) : null}
                  {job.publishProofUrl ? (
                    <a href={job.publishProofUrl} target="_blank" rel="noreferrer" className="text-[var(--brand)] underline-offset-2 hover:underline">
                      Open proof
                    </a>
                  ) : null}
                </div>
              ) : null}
              {canManage ? (
                <div className="mt-3 flex flex-wrap gap-3">
                  <ActionButton variant="secondary" onClick={() => void validateJob(job)} disabled={busyJobId === job.id}>
                    {busyJobId === job.id ? "Validating..." : "Run QA gate"}
                  </ActionButton>
                  {job.publishMode === "api" && job.connectionId ? (
                    <ActionButton variant="secondary" onClick={() => void publishJob(job)} disabled={busyJobId === job.id}>
                      {busyJobId === job.id ? "Publishing..." : "Publish now"}
                    </ActionButton>
                  ) : null}
                  <ActionButton variant="secondary" onClick={() => void updateJob(job)} disabled={busyJobId === job.id}>
                    {busyJobId === job.id ? "Saving..." : "Save"}
                  </ActionButton>
                  <ActionButton variant="secondary" onClick={() => void deleteJob(job.id)} disabled={busyJobId === job.id}>
                    Delete
                  </ActionButton>
                </div>
              ) : null}
            </div>
          ))}
        </div>
        {canManage ? (
          <div className="mt-5 rounded-2xl border border-dashed border-[var(--line)] p-4">
            <p className="font-semibold text-[var(--ink)]">Create content job</p>
            <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <input value={jobForm.title} onChange={(event) => setJobForm((current) => ({ ...current, title: event.target.value }))} placeholder="Launch reel #1" className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
              <select
                value={jobForm.platform}
                onChange={(event) => {
                  const platform = event.target.value;
                  const defaults = getJobDefaults(platform);
                  setJobForm((current) => ({
                    ...current,
                    platform,
                    publishMode: defaults.publishMode,
                    format: defaults.format,
                    useLinkPreview: defaults.useLinkPreview,
                  }));
                }}
                className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm"
              >
                {platformOptions.map((option) => <option key={option} value={option}>{getPlatformLabel(option)}</option>)}
              </select>
              <select value={jobForm.format} onChange={(event) => setJobForm((current) => ({ ...current, format: event.target.value }))} className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm">
                {formatOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
              <select value={jobForm.publishMode} onChange={(event) => setJobForm((current) => ({ ...current, publishMode: event.target.value as (typeof publishModeOptions)[number] }))} className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm">
                {publishModeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
              <select value={jobForm.briefId} onChange={(event) => setJobForm((current) => ({ ...current, briefId: event.target.value }))} className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm">
                <option value="">No brief</option>
                {briefs.map((brief) => <option key={brief.id} value={brief.id}>{brief.name}</option>)}
              </select>
              <select value={jobForm.connectionId} onChange={(event) => setJobForm((current) => ({ ...current, connectionId: event.target.value }))} className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm">
                <option value="">No channel</option>
                {connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.platform} / {connection.handle}</option>)}
              </select>
              <select value={jobForm.status} onChange={(event) => setJobForm((current) => ({ ...current, status: event.target.value }))} className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm">
                {jobStatusOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
              <input type="datetime-local" value={jobForm.scheduledAt} onChange={(event) => setJobForm((current) => ({ ...current, scheduledAt: event.target.value }))} className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
            </div>
            {renderPlatformNotes(selectedJobPlatform)}
            <textarea value={jobForm.caption} onChange={(event) => setJobForm((current) => ({ ...current, caption: event.target.value }))} placeholder="Caption" className="mt-3 min-h-20 w-full rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
            <textarea value={jobForm.aiPrompt} onChange={(event) => setJobForm((current) => ({ ...current, aiPrompt: event.target.value }))} placeholder="AI prompt" className="mt-3 min-h-20 w-full rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
            <input value={jobForm.assetUrls} onChange={(event) => setJobForm((current) => ({ ...current, assetUrls: event.target.value }))} placeholder="Asset URLs, one per line" className="mt-3 w-full rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <input value={jobForm.destinationUrl} onChange={(event) => setJobForm((current) => ({ ...current, destinationUrl: event.target.value }))} placeholder="Destination URL for website/link ad" className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
              <label className="flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm text-[var(--ink)]">
                <input
                  type="checkbox"
                  checked={platformSupportsLinkPreview(jobForm.platform) ? Boolean(jobForm.useLinkPreview) : false}
                  disabled={!platformSupportsLinkPreview(jobForm.platform)}
                  onChange={(event) => setJobForm((current) => ({ ...current, useLinkPreview: event.target.checked }))}
                />
                Publish as website/link advertisement preview
              </label>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <input value={jobForm.externalPostUrl} onChange={(event) => setJobForm((current) => ({ ...current, externalPostUrl: event.target.value }))} placeholder="Published post URL" className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
              <input value={jobForm.publishProofUrl} onChange={(event) => setJobForm((current) => ({ ...current, publishProofUrl: event.target.value }))} placeholder="Screenshot or proof URL" className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
            </div>
            <textarea value={jobForm.complianceNotes} onChange={(event) => setJobForm((current) => ({ ...current, complianceNotes: event.target.value }))} placeholder="Compliance notes" className="mt-3 min-h-20 w-full rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
            <div className="mt-3">
              <ActionButton onClick={() => void createJob()} disabled={!jobForm.title}>
                Create job
              </ActionButton>
            </div>
          </div>
        ) : null}
      </article>
    </section>
  );
}
