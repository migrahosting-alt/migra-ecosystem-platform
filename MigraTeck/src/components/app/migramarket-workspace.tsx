"use client";

import { useState } from "react";
import {
  MigraMarketSocialOps,
  type WorkspaceCalendarSlot,
  type WorkspaceContentJob,
  type WorkspaceContentTemplate,
  type WorkspaceCreativeBrief,
  type WorkspaceSocialConnection,
} from "@/components/app/migramarket-social-ops";
import { ActionButton } from "@/components/ui/button";

export type {
  WorkspaceCalendarSlot,
  WorkspaceContentJob,
  WorkspaceContentTemplate,
  WorkspaceCreativeBrief,
  WorkspaceSocialConnection,
} from "@/components/app/migramarket-social-ops";

export interface WorkspaceAccount {
  id: string;
  orgId: string;
  packageTemplateId: string | null;
  packageTemplateCode: string | null;
  packageName: string | null;
  clientStage: string;
  healthStatus: string;
  messagingBrandName: string | null;
  messagingFromNumber: string | null;
  messagingSupportEmail: string | null;
  primaryGoals: string[];
  targetMarkets: string[];
  googleBusinessProfileUrl: string | null;
  websiteUrl: string | null;
  socialProfiles: string[];
  adBudgetMonthly: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceLocation {
  id: string;
  name: string;
  city: string;
  region: string | null;
  country: string;
  serviceArea: string | null;
  primaryPhone: string | null;
  primary: boolean;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceChecklistItem {
  id: string;
  key: string;
  title: string;
  description: string | null;
  status: string;
  owner: string | null;
  dueAt: string | null;
  completedAt: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceTask {
  id: string;
  title: string;
  category: string;
  status: string;
  priority: string;
  dueAt: string | null;
  completedAt: string | null;
  assignee: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceReportSnapshot {
  id: string;
  label: string;
  periodStart: string;
  periodEnd: string;
  leads: number;
  calls: number;
  bookedAppointments: number;
  profileViews: number;
  websiteSessions: number;
  conversionRate: number | null;
  reviewCount: number;
  averageRating: number | null;
  emailOpenRate: number | null;
  socialReach: number;
  adSpend: number | null;
  costPerLead: number | null;
  revenueAttributed: number | null;
  summary: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspacePackageTemplate {
  id: string;
  code: string;
  name: string;
  description: string;
  category: string;
  monthlyPrice: number | null;
  setupPrice: number | null;
  serviceBundle: string[];
  defaultTasks: Array<{
    title: string;
    category: string;
    priority: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceLeadForm {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  sourceChannel: string;
  destinationEmail: string | null;
  thankYouMessage: string | null;
  smsConsentEnabled: boolean;
  smsConsentLabel: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceLead {
  id: string;
  orgId: string;
  formId: string | null;
  fullName: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  sourceChannel: string;
  campaign: string | null;
  landingPage: string | null;
  status: string;
  valueEstimate: number | null;
  notes: string | null;
  smsConsentStatus: string;
  smsConsentAt: string | null;
  smsConsentSource: string | null;
  smsConsentEvidence: string | null;
  smsOptedOutAt: string | null;
  messagingTags: string[];
  metadata: unknown;
  createdAt: string;
  updatedAt: string;
  form: WorkspaceLeadForm | null;
}

export interface WorkspaceMessagingCampaign {
  id: string;
  orgId: string;
  name: string;
  channel: string;
  fromNumber: string;
  audienceTag: string | null;
  body: string;
  mediaUrls: string[];
  notes: string | null;
  status: string;
  scheduledAt: string | null;
  launchedAt: string | null;
  completedAt: string | null;
  lastDispatchedAt: string | null;
  recipientCount: number;
  queuedCount: number;
  sentCount: number;
  deliveredCount: number;
  failedCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceMessagingDelivery {
  id: string;
  orgId: string;
  campaignId: string | null;
  leadId: string | null;
  phone: string;
  direction: string;
  status: string;
  externalMessageId: string | null;
  body: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  costAmount: number | null;
  deliveredAt: string | null;
  finalizedAt: string | null;
  createdAt: string;
  updatedAt: string;
  campaign: {
    id: string;
    name: string;
  } | null;
  lead: {
    id: string;
    fullName: string;
    phone: string | null;
  } | null;
}

interface MigraMarketWorkspaceProps {
  orgName: string;
  orgSlug: string;
  canManage: boolean;
  initialWorkspace: {
    account: WorkspaceAccount | null;
    locations: WorkspaceLocation[];
    checklist: WorkspaceChecklistItem[];
    tasks: WorkspaceTask[];
    reports: WorkspaceReportSnapshot[];
    packageTemplates: WorkspacePackageTemplate[];
    leadForms: WorkspaceLeadForm[];
    leads: WorkspaceLead[];
    messagingCampaigns: WorkspaceMessagingCampaign[];
    recentDeliveries: WorkspaceMessagingDelivery[];
    socialConnections: WorkspaceSocialConnection[];
    creativeBriefs: WorkspaceCreativeBrief[];
    contentJobs: WorkspaceContentJob[];
    contentTemplates: WorkspaceContentTemplate[];
    calendarSlots: WorkspaceCalendarSlot[];
  };
}

type LeadImportSummary = {
  dryRun: boolean;
  totalRows: number;
  validRows: number;
  createCount: number;
  updateCount: number;
  skippedCount: number;
  errors: Array<{
    rowNumber: number;
    message: string;
  }>;
};

function toMultiline(value: string[] | null | undefined): string {
  return (value || []).join("\n");
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

const stageOptions = ["onboarding", "active", "expanding", "at_risk"];
const healthOptions = ["healthy", "needs_attention", "critical"];
const checklistStatusOptions = ["pending", "in_progress", "blocked", "completed"];
const taskStatusOptions = ["todo", "in_progress", "waiting", "done"];
const taskPriorityOptions = ["low", "normal", "high", "urgent"];
const leadStatusOptions = ["new", "qualified", "proposal", "won", "lost"];
const consentStatusOptions = ["unknown", "subscribed", "unsubscribed"];
const campaignStatusOptions = ["draft", "scheduled", "paused"];

export function MigraMarketWorkspace({ orgName, orgSlug, canManage, initialWorkspace }: MigraMarketWorkspaceProps) {
  const [account, setAccount] = useState<WorkspaceAccount | null>(initialWorkspace.account);
  const [locations, setLocations] = useState(initialWorkspace.locations);
  const [checklist, setChecklist] = useState(initialWorkspace.checklist);
  const [tasks, setTasks] = useState(initialWorkspace.tasks);
  const [reports, setReports] = useState(initialWorkspace.reports);
  const [packageTemplates] = useState(initialWorkspace.packageTemplates);
  const [leadForms, setLeadForms] = useState(initialWorkspace.leadForms);
  const [leads, setLeads] = useState(initialWorkspace.leads);
  const [messagingCampaigns, setMessagingCampaigns] = useState(initialWorkspace.messagingCampaigns);
  const [recentDeliveries, setRecentDeliveries] = useState(initialWorkspace.recentDeliveries);
  const [savingProfile, setSavingProfile] = useState(false);
  const [locationSaving, setLocationSaving] = useState(false);
  const [taskSaving, setTaskSaving] = useState(false);
  const [reportSaving, setReportSaving] = useState(false);
  const [leadSaving, setLeadSaving] = useState(false);
  const [formSaving, setFormSaving] = useState(false);
  const [campaignSaving, setCampaignSaving] = useState(false);
  const [leadImporting, setLeadImporting] = useState(false);
  const [assigningPackageId, setAssigningPackageId] = useState<string | null>(null);
  const [busyChecklistId, setBusyChecklistId] = useState<string | null>(null);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [busyLocationId, setBusyLocationId] = useState<string | null>(null);
  const [busyLeadId, setBusyLeadId] = useState<string | null>(null);
  const [busyReportId, setBusyReportId] = useState<string | null>(null);
  const [busyFormId, setBusyFormId] = useState<string | null>(null);
  const [busyCampaignId, setBusyCampaignId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [locationMessage, setLocationMessage] = useState<string | null>(null);
  const [taskMessage, setTaskMessage] = useState<string | null>(null);
  const [leadMessage, setLeadMessage] = useState<string | null>(null);
  const [reportMessage, setReportMessage] = useState<string | null>(null);
  const [formMessage, setFormMessage] = useState<string | null>(null);
  const [campaignMessage, setCampaignMessage] = useState<string | null>(null);
  const [leadImportMessage, setLeadImportMessage] = useState<string | null>(null);
  const [activityMessage, setActivityMessage] = useState<string | null>(null);
  const [leadImportSummary, setLeadImportSummary] = useState<LeadImportSummary | null>(null);
  const [profileForm, setProfileForm] = useState({
    packageName: account?.packageName || "",
    packageTemplateId: account?.packageTemplateId || "",
    clientStage: account?.clientStage || "onboarding",
    healthStatus: account?.healthStatus || "needs_attention",
    messagingBrandName: account?.messagingBrandName || "",
    messagingFromNumber: account?.messagingFromNumber || "",
    messagingSupportEmail: account?.messagingSupportEmail || "",
    primaryGoals: toMultiline(account?.primaryGoals),
    targetMarkets: toMultiline(account?.targetMarkets),
    googleBusinessProfileUrl: account?.googleBusinessProfileUrl || "",
    websiteUrl: account?.websiteUrl || "",
    socialProfiles: toMultiline(account?.socialProfiles),
    adBudgetMonthly: account?.adBudgetMonthly ? String(account.adBudgetMonthly) : "",
    notes: account?.notes || "",
  });
  const [locationForm, setLocationForm] = useState({
    name: "",
    city: "",
    region: "",
    country: "US",
    serviceArea: "",
    primaryPhone: "",
    primary: locations.length === 0,
  });
  const [taskForm, setTaskForm] = useState({
    title: "",
    category: "fulfillment",
    priority: "normal",
    assignee: "",
    dueAt: "",
    notes: "",
  });
  const [reportForm, setReportForm] = useState({
    label: "",
    periodStart: "",
    periodEnd: "",
    leads: "0",
    calls: "0",
    bookedAppointments: "0",
    profileViews: "0",
    websiteSessions: "0",
    conversionRate: "",
    reviewCount: "0",
    averageRating: "",
    emailOpenRate: "",
    socialReach: "0",
    adSpend: "",
    costPerLead: "",
    revenueAttributed: "",
    summary: "",
  });
  const [leadForm, setLeadForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    company: "",
    sourceChannel: "manual",
    campaign: "",
    landingPage: "",
    status: "new",
    smsConsentStatus: "unknown",
    smsConsentSource: "manual",
    smsConsentEvidence: "",
    messagingTags: "",
    valueEstimate: "",
    notes: "",
  });
  const [leadCaptureForm, setLeadCaptureForm] = useState({
    name: "",
    slug: "",
    sourceChannel: "website",
    destinationEmail: "",
    thankYouMessage: "",
    smsConsentEnabled: false,
    smsConsentLabel: "",
    active: true,
  });
  const [campaignForm, setCampaignForm] = useState({
    name: "",
    fromNumber: account?.messagingFromNumber || "",
    audienceTag: "",
    body: "",
    mediaUrls: "",
    notes: "",
    scheduledAt: "",
  });
  const [leadImportForm, setLeadImportForm] = useState({
    text: "fullName,phone,email,company,smsConsentStatus,smsConsentSource,smsConsentEvidence,messagingTags\n",
    defaultSourceChannel: "csv_import",
    defaultStatus: "new",
    defaultConsentStatus: "subscribed",
    defaultConsentSource: "csv_import",
    defaultTags: "marketing-subscribers",
  });

  function announceSuccess(message: string) {
    setActivityMessage(message);
    setErrorMessage(null);
  }

  function getOptInPath(form: WorkspaceLeadForm) {
    return `/migramarket/opt-in/${orgSlug}/${form.slug}`;
  }

  function getOptInUrl(form: WorkspaceLeadForm) {
    const path = getOptInPath(form);
    if (typeof window === "undefined") {
      return path;
    }

    return `${window.location.origin}${path}`;
  }

  async function copyToClipboard(value: string, message: string) {
    try {
      await navigator.clipboard.writeText(value);
      setFormMessage(message);
      announceSuccess(message);
    } catch {
      setErrorMessage("Unable to copy to clipboard.");
    }
  }

  async function refreshWorkspaceData() {
    const response = await fetch("/api/migramarket/workspace", {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    const payload = (await response.json().catch(() => null)) as
      | { error?: string; workspace?: MigraMarketWorkspaceProps["initialWorkspace"] }
      | null;

    if (!response.ok || !payload?.workspace) {
      throw new Error(payload?.error || "Unable to refresh workspace.");
    }

    const { workspace } = payload;
    setAccount(workspace.account);
    setLocations(workspace.locations);
    setChecklist(workspace.checklist);
    setTasks(workspace.tasks);
    setReports(workspace.reports);
    setLeadForms(workspace.leadForms);
    setLeads(workspace.leads);
    setMessagingCampaigns(workspace.messagingCampaigns);
    setRecentDeliveries(workspace.recentDeliveries);
  }

  async function saveProfile() {
    setSavingProfile(true);
    setProfileMessage(null);
    setErrorMessage(null);
    setActivityMessage(null);

    const response = await fetch("/api/migramarket/workspace", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        packageName: profileForm.packageName || null,
        packageTemplateId: profileForm.packageTemplateId || null,
        clientStage: profileForm.clientStage,
        healthStatus: profileForm.healthStatus,
        messagingBrandName: profileForm.messagingBrandName || null,
        messagingFromNumber: profileForm.messagingFromNumber || null,
        messagingSupportEmail: profileForm.messagingSupportEmail || null,
        primaryGoals: fromMultiline(profileForm.primaryGoals),
        targetMarkets: fromMultiline(profileForm.targetMarkets),
        googleBusinessProfileUrl: profileForm.googleBusinessProfileUrl || null,
        websiteUrl: profileForm.websiteUrl || null,
        socialProfiles: fromMultiline(profileForm.socialProfiles),
        adBudgetMonthly: profileForm.adBudgetMonthly ? Number(profileForm.adBudgetMonthly) : null,
        notes: profileForm.notes || null,
      }),
    });

    const payload = (await response.json().catch(() => null)) as
      | { error?: string; workspace?: MigraMarketWorkspaceProps["initialWorkspace"] }
      | null;

    setSavingProfile(false);
    if (!response.ok || !payload?.workspace) {
      setErrorMessage(payload?.error || "Unable to save workspace profile.");
      return;
    }

    const { workspace } = payload;
    setAccount(workspace.account);
    setLocations(workspace.locations);
    setChecklist(workspace.checklist);
    setTasks(workspace.tasks);
    setReports(workspace.reports);
    setLeadForms(workspace.leadForms);
    setLeads(workspace.leads);
    setMessagingCampaigns(workspace.messagingCampaigns);
    setRecentDeliveries(workspace.recentDeliveries);
    setProfileMessage("Workspace profile saved.");
    setCampaignForm((current) => ({
      ...current,
      fromNumber: workspace.account?.messagingFromNumber || current.fromNumber,
    }));
    announceSuccess("Workspace profile saved.");
  }

  async function assignPackage(packageTemplateId: string) {
    setAssigningPackageId(packageTemplateId);
    setErrorMessage(null);
    setActivityMessage(null);

    const response = await fetch("/api/migramarket/package/assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ packageTemplateId }),
    });

    const payload = (await response.json().catch(() => null)) as
      | { error?: string; assignedPackage?: WorkspacePackageTemplate; workspace?: { account?: Partial<WorkspaceAccount> | null; tasks?: WorkspaceTask[] } }
      | null;

    setAssigningPackageId(null);
    if (!response.ok || !payload?.assignedPackage) {
      setErrorMessage(payload?.error || "Unable to assign package.");
      return;
    }

    setProfileForm((current) => ({
      ...current,
      packageTemplateId: payload.assignedPackage!.id,
      packageName: payload.assignedPackage!.name,
    }));
    setAccount((current) =>
      current
        ? {
            ...current,
            packageTemplateId: payload.assignedPackage!.id,
            packageTemplateCode: payload.assignedPackage!.code,
            packageName: payload.assignedPackage!.name,
          }
        : null,
    );
    if (payload.workspace?.tasks) {
      setTasks(payload.workspace.tasks);
    }
    announceSuccess(`${payload.assignedPackage.name} assigned.`);
  }

  async function createLocation() {
    setLocationSaving(true);
    setLocationMessage(null);
    setErrorMessage(null);
    setActivityMessage(null);

    const response = await fetch("/api/migramarket/locations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...locationForm,
        region: locationForm.region || null,
        serviceArea: locationForm.serviceArea || null,
        primaryPhone: locationForm.primaryPhone || null,
      }),
    });

    const payload = (await response.json().catch(() => null)) as { error?: string; location?: WorkspaceLocation } | null;
    setLocationSaving(false);

    if (!response.ok || !payload?.location) {
      setErrorMessage(payload?.error || "Unable to create location.");
      return;
    }

    const createdLocation = payload.location;
    setLocations((current) => {
      const next = locationForm.primary ? current.map((item) => ({ ...item, primary: false })) : current;
      return [...next, createdLocation];
    });
    setLocationForm({
      name: "",
      city: "",
      region: "",
      country: "US",
      serviceArea: "",
      primaryPhone: "",
      primary: false,
    });
    setLocationMessage("Location added.");
    announceSuccess("Location added.");
  }

  async function updateLocation(location: WorkspaceLocation) {
    setBusyLocationId(location.id);
    setErrorMessage(null);
    setActivityMessage(null);
    const response = await fetch(`/api/migramarket/locations/${location.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: location.name,
        city: location.city,
        region: location.region,
        country: location.country,
        serviceArea: location.serviceArea,
        primaryPhone: location.primaryPhone,
        primary: location.primary,
        status: location.status,
      }),
    });
    const payload = (await response.json().catch(() => null)) as { error?: string; location?: WorkspaceLocation } | null;
    setBusyLocationId(null);
    if (!response.ok || !payload?.location) {
      setErrorMessage(payload?.error || "Unable to update location.");
      return;
    }
    setLocations((current) => current.map((item) => (item.id === location.id ? payload.location! : item)));
    announceSuccess("Location updated.");
  }

  async function deleteLocation(id: string) {
    if (!window.confirm("Delete this location?")) return;
    setBusyLocationId(id);
    setErrorMessage(null);
    setActivityMessage(null);
    const response = await fetch(`/api/migramarket/locations/${id}`, { method: "DELETE" });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    setBusyLocationId(null);
    if (!response.ok) {
      setErrorMessage(payload?.error || "Unable to delete location.");
      return;
    }
    setLocations((current) => current.filter((item) => item.id !== id));
    announceSuccess("Location deleted.");
  }

  async function updateChecklistItem(id: string, patch: Partial<WorkspaceChecklistItem>) {
    setBusyChecklistId(id);
    setErrorMessage(null);
    setActivityMessage(null);

    const current = checklist.find((item) => item.id === id);
    if (!current) {
      setBusyChecklistId(null);
      return;
    }

    const response = await fetch(`/api/migramarket/checklist/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: patch.status ?? current.status,
        owner: patch.owner ?? current.owner,
        dueAt: patch.dueAt ?? current.dueAt,
      }),
    });

    const payload = (await response.json().catch(() => null)) as { error?: string; item?: WorkspaceChecklistItem } | null;
    setBusyChecklistId(null);

    if (!response.ok || !payload?.item) {
      setErrorMessage(payload?.error || "Unable to update checklist item.");
      return;
    }

    setChecklist((currentItems) => currentItems.map((item) => (item.id === id ? payload.item! : item)));
    announceSuccess("Checklist item updated.");
  }

  async function createTask() {
    setTaskSaving(true);
    setTaskMessage(null);
    setErrorMessage(null);
    setActivityMessage(null);

    const response = await fetch("/api/migramarket/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: taskForm.title,
        category: taskForm.category,
        priority: taskForm.priority,
        assignee: taskForm.assignee || null,
        dueAt: fromDatetimeLocal(taskForm.dueAt),
        notes: taskForm.notes || null,
      }),
    });

    const payload = (await response.json().catch(() => null)) as { error?: string; task?: WorkspaceTask } | null;
    setTaskSaving(false);

    if (!response.ok || !payload?.task) {
      setErrorMessage(payload?.error || "Unable to create task.");
      return;
    }

    setTasks((current) => [...current, payload.task!]);
    setTaskForm({
      title: "",
      category: "fulfillment",
      priority: "normal",
      assignee: "",
      dueAt: "",
      notes: "",
    });
    setTaskMessage("Task created.");
    announceSuccess("Task created.");
  }

  async function updateTask(id: string, patch: Partial<WorkspaceTask>) {
    setBusyTaskId(id);
    setErrorMessage(null);
    setActivityMessage(null);

    const current = tasks.find((item) => item.id === id);
    if (!current) {
      setBusyTaskId(null);
      return;
    }

    const response = await fetch(`/api/migramarket/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: patch.status ?? current.status,
        priority: patch.priority ?? current.priority,
        assignee: patch.assignee ?? current.assignee,
        dueAt: patch.dueAt ?? current.dueAt,
        notes: patch.notes ?? current.notes,
      }),
    });

    const payload = (await response.json().catch(() => null)) as { error?: string; task?: WorkspaceTask } | null;
    setBusyTaskId(null);

    if (!response.ok || !payload?.task) {
      setErrorMessage(payload?.error || "Unable to update task.");
      return;
    }

    setTasks((currentTasks) => currentTasks.map((item) => (item.id === id ? payload.task! : item)));
    announceSuccess("Task updated.");
  }

  async function deleteTask(id: string) {
    if (!window.confirm("Delete this task?")) return;
    setBusyTaskId(id);
    setErrorMessage(null);
    setActivityMessage(null);
    const response = await fetch(`/api/migramarket/tasks/${id}`, { method: "DELETE" });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    setBusyTaskId(null);
    if (!response.ok) {
      setErrorMessage(payload?.error || "Unable to delete task.");
      return;
    }
    setTasks((current) => current.filter((item) => item.id !== id));
    announceSuccess("Task deleted.");
  }

  async function createReport() {
    setReportSaving(true);
    setReportMessage(null);
    setErrorMessage(null);
    setActivityMessage(null);

    const response = await fetch("/api/migramarket/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label: reportForm.label,
        periodStart: fromDatetimeLocal(reportForm.periodStart),
        periodEnd: fromDatetimeLocal(reportForm.periodEnd),
        leads: Number(reportForm.leads || 0),
        calls: Number(reportForm.calls || 0),
        bookedAppointments: Number(reportForm.bookedAppointments || 0),
        profileViews: Number(reportForm.profileViews || 0),
        websiteSessions: Number(reportForm.websiteSessions || 0),
        conversionRate: reportForm.conversionRate ? Number(reportForm.conversionRate) : null,
        reviewCount: Number(reportForm.reviewCount || 0),
        averageRating: reportForm.averageRating ? Number(reportForm.averageRating) : null,
        emailOpenRate: reportForm.emailOpenRate ? Number(reportForm.emailOpenRate) : null,
        socialReach: Number(reportForm.socialReach || 0),
        adSpend: reportForm.adSpend ? Number(reportForm.adSpend) : null,
        costPerLead: reportForm.costPerLead ? Number(reportForm.costPerLead) : null,
        revenueAttributed: reportForm.revenueAttributed ? Number(reportForm.revenueAttributed) : null,
        summary: reportForm.summary || null,
      }),
    });

    const payload = (await response.json().catch(() => null)) as { error?: string; report?: WorkspaceReportSnapshot } | null;
    setReportSaving(false);

    if (!response.ok || !payload?.report) {
      setErrorMessage(payload?.error || "Unable to create report snapshot.");
      return;
    }

    setReports((current) => [payload.report!, ...current].slice(0, 6));
    setReportForm({
      label: "",
      periodStart: "",
      periodEnd: "",
      leads: "0",
      calls: "0",
      bookedAppointments: "0",
      profileViews: "0",
      websiteSessions: "0",
      conversionRate: "",
      reviewCount: "0",
      averageRating: "",
      emailOpenRate: "",
      socialReach: "0",
      adSpend: "",
      costPerLead: "",
      revenueAttributed: "",
      summary: "",
    });
    setReportMessage("Snapshot saved.");
    announceSuccess("Report snapshot saved.");
  }

  async function updateLead(lead: WorkspaceLead) {
    setBusyLeadId(lead.id);
    setErrorMessage(null);
    setActivityMessage(null);
    const response = await fetch(`/api/migramarket/leads/${lead.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fullName: lead.fullName,
        email: lead.email,
        phone: lead.phone,
        company: lead.company,
        sourceChannel: lead.sourceChannel,
        campaign: lead.campaign,
        landingPage: lead.landingPage,
        status: lead.status,
        smsConsentStatus: lead.smsConsentStatus,
        smsConsentSource: lead.smsConsentSource,
        smsConsentEvidence: lead.smsConsentEvidence,
        messagingTags: lead.messagingTags,
        valueEstimate: lead.valueEstimate,
        notes: lead.notes,
      }),
    });
    const payload = (await response.json().catch(() => null)) as { error?: string; lead?: WorkspaceLead } | null;
    setBusyLeadId(null);
    if (!response.ok || !payload?.lead) {
      setErrorMessage(payload?.error || "Unable to update lead.");
      return;
    }
    setLeads((current) => current.map((item) => (item.id === lead.id ? payload.lead! : item)));
    announceSuccess("Lead updated.");
  }

  async function deleteLead(id: string) {
    if (!window.confirm("Delete this lead?")) return;
    setBusyLeadId(id);
    setErrorMessage(null);
    setActivityMessage(null);
    const response = await fetch(`/api/migramarket/leads/${id}`, { method: "DELETE" });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    setBusyLeadId(null);
    if (!response.ok) {
      setErrorMessage(payload?.error || "Unable to delete lead.");
      return;
    }
    setLeads((current) => current.filter((item) => item.id !== id));
    announceSuccess("Lead deleted.");
  }

  async function deleteReport(id: string) {
    if (!window.confirm("Delete this report snapshot?")) return;
    setBusyReportId(id);
    setErrorMessage(null);
    setActivityMessage(null);
    const response = await fetch(`/api/migramarket/reports/${id}`, { method: "DELETE" });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    setBusyReportId(null);
    if (!response.ok) {
      setErrorMessage(payload?.error || "Unable to delete report.");
      return;
    }
    setReports((current) => current.filter((item) => item.id !== id));
    announceSuccess("Report snapshot deleted.");
  }

  async function updateReport(report: WorkspaceReportSnapshot) {
    setBusyReportId(report.id);
    setErrorMessage(null);
    setActivityMessage(null);
    const response = await fetch(`/api/migramarket/reports/${report.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label: report.label,
        periodStart: report.periodStart,
        periodEnd: report.periodEnd,
        leads: report.leads,
        calls: report.calls,
        bookedAppointments: report.bookedAppointments,
        profileViews: report.profileViews,
        websiteSessions: report.websiteSessions,
        conversionRate: report.conversionRate,
        reviewCount: report.reviewCount,
        averageRating: report.averageRating,
        emailOpenRate: report.emailOpenRate,
        socialReach: report.socialReach,
        adSpend: report.adSpend,
        costPerLead: report.costPerLead,
        revenueAttributed: report.revenueAttributed,
        summary: report.summary,
      }),
    });
    const payload = (await response.json().catch(() => null)) as { error?: string; report?: WorkspaceReportSnapshot } | null;
    setBusyReportId(null);
    if (!response.ok || !payload?.report) {
      setErrorMessage(payload?.error || "Unable to update report.");
      return;
    }
    setReports((current) => current.map((item) => (item.id === report.id ? payload.report! : item)));
    announceSuccess("Report snapshot updated.");
  }

  async function createLead() {
    setLeadSaving(true);
    setLeadMessage(null);
    setErrorMessage(null);
    setActivityMessage(null);

    const response = await fetch("/api/migramarket/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fullName: leadForm.fullName,
        email: leadForm.email || null,
        phone: leadForm.phone || null,
        company: leadForm.company || null,
        sourceChannel: leadForm.sourceChannel,
        campaign: leadForm.campaign || null,
        landingPage: leadForm.landingPage || null,
        status: leadForm.status,
        smsConsentStatus: leadForm.smsConsentStatus,
        smsConsentSource: leadForm.smsConsentSource || null,
        smsConsentEvidence: leadForm.smsConsentEvidence || null,
        messagingTags: fromMultiline(leadForm.messagingTags),
        valueEstimate: leadForm.valueEstimate ? Number(leadForm.valueEstimate) : null,
        notes: leadForm.notes || null,
      }),
    });

    const payload = (await response.json().catch(() => null)) as { error?: string; lead?: WorkspaceLead } | null;
    setLeadSaving(false);

    if (!response.ok || !payload?.lead) {
      setErrorMessage(payload?.error || "Unable to create lead.");
      return;
    }

    setLeads((current) => [payload.lead!, ...current].slice(0, 25));
    setLeadForm({
      fullName: "",
      email: "",
      phone: "",
      company: "",
      sourceChannel: "manual",
      campaign: "",
      landingPage: "",
      status: "new",
      smsConsentStatus: "unknown",
      smsConsentSource: "manual",
      smsConsentEvidence: "",
      messagingTags: "",
      valueEstimate: "",
      notes: "",
    });
    setLeadMessage("Lead recorded.");
    announceSuccess("Lead recorded.");
  }

  async function createLeadCaptureForm() {
    setFormSaving(true);
    setFormMessage(null);
    setErrorMessage(null);
    setActivityMessage(null);
    const response = await fetch("/api/migramarket/forms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...leadCaptureForm,
        destinationEmail: leadCaptureForm.destinationEmail || null,
        thankYouMessage: leadCaptureForm.thankYouMessage || null,
        smsConsentLabel: leadCaptureForm.smsConsentLabel || null,
      }),
    });
    const payload = (await response.json().catch(() => null)) as { error?: string; form?: WorkspaceLeadForm } | null;
    setFormSaving(false);
    if (!response.ok || !payload?.form) {
      setErrorMessage(payload?.error || "Unable to create intake form.");
      return;
    }
    setLeadForms((current) => [...current, payload.form!]);
    setLeadCaptureForm({
      name: "",
      slug: "",
      sourceChannel: "website",
      destinationEmail: "",
      thankYouMessage: "",
      smsConsentEnabled: false,
      smsConsentLabel: "",
      active: true,
    });
    setFormMessage("Form created.");
    announceSuccess("Intake form created.");
  }

  async function updateLeadForm(form: WorkspaceLeadForm) {
    setBusyFormId(form.id);
    setErrorMessage(null);
    setActivityMessage(null);
    const response = await fetch(`/api/migramarket/forms/${form.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        slug: form.slug,
        sourceChannel: form.sourceChannel,
        destinationEmail: form.destinationEmail,
        thankYouMessage: form.thankYouMessage,
        smsConsentEnabled: form.smsConsentEnabled,
        smsConsentLabel: form.smsConsentLabel,
        active: form.active,
      }),
    });
    const payload = (await response.json().catch(() => null)) as { error?: string; form?: WorkspaceLeadForm } | null;
    setBusyFormId(null);
    if (!response.ok || !payload?.form) {
      setErrorMessage(payload?.error || "Unable to update intake form.");
      return;
    }
    setLeadForms((current) => current.map((item) => (item.id === form.id ? payload.form! : item)));
    announceSuccess("Intake form updated.");
  }

  async function deleteLeadForm(id: string) {
    if (!window.confirm("Delete this intake form?")) return;
    setBusyFormId(id);
    setErrorMessage(null);
    setActivityMessage(null);
    const response = await fetch(`/api/migramarket/forms/${id}`, { method: "DELETE" });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    setBusyFormId(null);
    if (!response.ok) {
      setErrorMessage(payload?.error || "Unable to delete intake form.");
      return;
    }
    setLeadForms((current) => current.filter((item) => item.id !== id));
    announceSuccess("Intake form deleted.");
  }

  async function createCampaign() {
    setCampaignSaving(true);
    setCampaignMessage(null);
    setErrorMessage(null);
    setActivityMessage(null);

    const response = await fetch("/api/migramarket/messaging/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: campaignForm.name,
        fromNumber: campaignForm.fromNumber,
        audienceTag: campaignForm.audienceTag || null,
        body: campaignForm.body,
        mediaUrls: fromMultiline(campaignForm.mediaUrls),
        notes: campaignForm.notes || null,
        scheduledAt: fromDatetimeLocal(campaignForm.scheduledAt),
      }),
    });

    const payload = (await response.json().catch(() => null)) as
      | { error?: string; campaign?: WorkspaceMessagingCampaign }
      | null;
    setCampaignSaving(false);

    if (!response.ok || !payload?.campaign) {
      setErrorMessage(payload?.error || "Unable to create messaging campaign.");
      return;
    }

    setMessagingCampaigns((current) => [payload.campaign!, ...current].slice(0, 12));
    setCampaignForm({
      name: "",
      fromNumber: profileForm.messagingFromNumber || account?.messagingFromNumber || "",
      audienceTag: "",
      body: "",
      mediaUrls: "",
      notes: "",
      scheduledAt: "",
    });
    setCampaignMessage("Campaign created.");
    announceSuccess("Messaging campaign created.");
  }

  async function updateCampaign(campaign: WorkspaceMessagingCampaign) {
    setBusyCampaignId(campaign.id);
    setErrorMessage(null);
    setActivityMessage(null);

    const response = await fetch(`/api/migramarket/messaging/campaigns/${campaign.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: campaign.name,
        fromNumber: campaign.fromNumber,
        audienceTag: campaign.audienceTag,
        body: campaign.body,
        mediaUrls: campaign.mediaUrls,
        notes: campaign.notes,
        scheduledAt: campaign.scheduledAt,
        status: campaign.status,
      }),
    });

    const payload = (await response.json().catch(() => null)) as
      | { error?: string; campaign?: WorkspaceMessagingCampaign }
      | null;
    setBusyCampaignId(null);

    if (!response.ok || !payload?.campaign) {
      setErrorMessage(payload?.error || "Unable to update messaging campaign.");
      return;
    }

    setMessagingCampaigns((current) => current.map((item) => (item.id === campaign.id ? payload.campaign! : item)));
    announceSuccess("Messaging campaign updated.");
  }

  async function deleteCampaign(id: string) {
    if (!window.confirm("Delete this messaging campaign?")) return;
    setBusyCampaignId(id);
    setErrorMessage(null);
    setActivityMessage(null);

    const response = await fetch(`/api/migramarket/messaging/campaigns/${id}`, {
      method: "DELETE",
    });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    setBusyCampaignId(null);

    if (!response.ok) {
      setErrorMessage(payload?.error || "Unable to delete messaging campaign.");
      return;
    }

    setMessagingCampaigns((current) => current.filter((item) => item.id !== id));
    setRecentDeliveries((current) => current.filter((item) => item.campaignId !== id));
    announceSuccess("Messaging campaign deleted.");
  }

  async function launchCampaign(id: string) {
    setBusyCampaignId(id);
    setErrorMessage(null);
    setActivityMessage(null);

    const response = await fetch(`/api/migramarket/messaging/campaigns/${id}/launch`, {
      method: "POST",
    });
    const payload = (await response.json().catch(() => null)) as
      | {
          error?: string;
          campaign?: WorkspaceMessagingCampaign;
          stats?: { createdCount: number; processedCount: number; queuedRemaining: number };
        }
      | null;
    setBusyCampaignId(null);

    if (!response.ok || !payload?.campaign || !payload?.stats) {
      setErrorMessage(payload?.error || "Unable to launch messaging campaign.");
      return;
    }

    setMessagingCampaigns((current) => current.map((item) => (item.id === id ? payload.campaign! : item)));
    announceSuccess(
      `Campaign launched. ${payload.stats.processedCount} deliveries submitted, ${payload.stats.queuedRemaining} queued.`,
    );
  }

  async function importLeads(dryRun: boolean) {
    setLeadImporting(true);
    setLeadImportMessage(null);
    setLeadImportSummary(null);
    setErrorMessage(null);
    setActivityMessage(null);

    const response = await fetch("/api/migramarket/leads/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: leadImportForm.text,
        defaultSourceChannel: leadImportForm.defaultSourceChannel,
        defaultStatus: leadImportForm.defaultStatus,
        defaultConsentStatus: leadImportForm.defaultConsentStatus,
        defaultConsentSource: leadImportForm.defaultConsentSource,
        defaultTags: fromMultiline(leadImportForm.defaultTags),
        dryRun,
      }),
    });

    const payload = (await response.json().catch(() => null)) as
      | { error?: string; summary?: LeadImportSummary }
      | null;

    setLeadImporting(false);

    if (!response.ok || !payload?.summary) {
      setErrorMessage(payload?.error || "Unable to import leads.");
      return;
    }

    setLeadImportSummary(payload.summary);

    if (dryRun) {
      setLeadImportMessage("Import preview ready.");
      announceSuccess("Lead import preview completed.");
      return;
    }

    await refreshWorkspaceData().catch((error) => {
      setErrorMessage(error instanceof Error ? error.message : "Unable to refresh workspace after import.");
    });
    setLeadImportMessage("Leads imported.");
    announceSuccess("Leads imported.");
  }

  const latestReport = reports[0] || null;
  const primaryLeadForm = leadForms[0] || null;
  const latestCampaign = messagingCampaigns[0] || null;
  const onboardingCompletion = checklist.length
    ? Math.round((checklist.filter((item) => item.status === "completed").length / checklist.length) * 100)
    : 0;
  const subscribedLeadCount = leads.filter((lead) => lead.smsConsentStatus === "subscribed" && !lead.smsOptedOutAt).length;
  const recentDeliverySuccessCount = recentDeliveries.filter((delivery) =>
    ["submitted", "sent", "delivered", "finalized"].includes(delivery.status),
  ).length;

  return (
    <div className="space-y-6">
      <div aria-live="polite" className="sr-only">
        {activityMessage || ""}
      </div>
      <section data-testid="migramarket-kpis" className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <div className="rounded-2xl border border-[var(--line)] bg-white p-5">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--ink-muted)]">Open tasks</p>
          <p className="mt-3 text-3xl font-black tracking-tight">{tasks.filter((item) => item.status !== "done").length}</p>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">Recurring delivery still in flight.</p>
        </div>
        <div className="rounded-2xl border border-[var(--line)] bg-white p-5">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--ink-muted)]">Onboarding</p>
          <p className="mt-3 text-3xl font-black tracking-tight">{onboardingCompletion}%</p>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">Checklist completion across activation.</p>
        </div>
        <div className="rounded-2xl border border-[var(--line)] bg-white p-5">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--ink-muted)]">Latest leads</p>
          <p className="mt-3 text-3xl font-black tracking-tight">{latestReport?.leads ?? leads.length}</p>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">Most recent snapshot or current list size.</p>
        </div>
        <div className="rounded-2xl border border-[var(--line)] bg-white p-5">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--ink-muted)]">Attributed revenue</p>
          <p className="mt-3 text-3xl font-black tracking-tight">${(latestReport?.revenueAttributed ?? 0).toLocaleString()}</p>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">From the latest reporting snapshot.</p>
        </div>
        <div className="rounded-2xl border border-[var(--line)] bg-white p-5">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--ink-muted)]">Pipeline</p>
          <p className="mt-3 text-3xl font-black tracking-tight">{leads.filter((lead) => lead.status !== "lost").length}</p>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">Open leads across the current pipeline.</p>
        </div>
        <div className="rounded-2xl border border-[var(--line)] bg-white p-5">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--ink-muted)]">SMS audience</p>
          <p className="mt-3 text-3xl font-black tracking-tight">{subscribedLeadCount}</p>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">Subscribed contacts currently eligible for campaigns.</p>
        </div>
      </section>

      <section className="rounded-3xl border border-[var(--line)] bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[var(--brand-600)]">MigraMarket</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight">Enterprise growth operations workspace</h1>
            <p className="mt-2 max-w-3xl text-sm text-[var(--ink-muted)]">
              Run package activation, onboarding, lead capture, local visibility, and reporting for {orgName} from one
              workspace.
            </p>
          </div>
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3 text-sm">
            <p className="font-semibold text-[var(--ink)]">Primary intake endpoint</p>
            <p className="text-[var(--ink-muted)]">
              {primaryLeadForm ? `/api/migramarket/intake/submit` : "No active form"}
            </p>
          </div>
        </div>
      </section>

      {errorMessage ? (
        <div aria-live="assertive" data-testid="migramarket-error" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{errorMessage}</div>
      ) : null}

      {activityMessage ? (
        <div aria-live="polite" data-testid="migramarket-activity" className="rounded-2xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">{activityMessage}</div>
      ) : null}

      <section data-testid="migramarket-kpis" className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <div className="rounded-2xl border border-[var(--line)] bg-white p-5">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--ink-muted)]">Open tasks</p>
          <p className="mt-3 text-3xl font-black tracking-tight">{tasks.filter((item) => item.status !== "done").length}</p>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">Recurring delivery still in flight.</p>
        </div>
        <div className="rounded-2xl border border-[var(--line)] bg-white p-5">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--ink-muted)]">Onboarding</p>
          <p className="mt-3 text-3xl font-black tracking-tight">{onboardingCompletion}%</p>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">Checklist completion across activation.</p>
        </div>
        <div className="rounded-2xl border border-[var(--line)] bg-white p-5">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--ink-muted)]">Latest leads</p>
          <p className="mt-3 text-3xl font-black tracking-tight">{latestReport?.leads ?? leads.length}</p>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">Most recent snapshot or current list size.</p>
        </div>
        <div className="rounded-2xl border border-[var(--line)] bg-white p-5">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--ink-muted)]">Attributed revenue</p>
          <p className="mt-3 text-3xl font-black tracking-tight">${(latestReport?.revenueAttributed ?? 0).toLocaleString()}</p>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">From the latest reporting snapshot.</p>
        </div>
        <div className="rounded-2xl border border-[var(--line)] bg-white p-5">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--ink-muted)]">Pipeline</p>
          <p className="mt-3 text-3xl font-black tracking-tight">{leads.filter((lead) => lead.status !== "lost").length}</p>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">Open leads across the current pipeline.</p>
        </div>
        <div className="rounded-2xl border border-[var(--line)] bg-white p-5">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--ink-muted)]">SMS audience</p>
          <p className="mt-3 text-3xl font-black tracking-tight">{subscribedLeadCount}</p>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">Subscribed contacts currently eligible for campaigns.</p>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
        <article data-testid="package-automation-section" className="rounded-2xl border border-[var(--line)] bg-white p-5">
          <h2 className="text-lg font-bold">Package automation</h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Assign a service tier to standardize delivery, seed task defaults, and keep the commercial offer aligned.
          </p>
          <div className="mt-4 grid gap-3">
            {packageTemplates.map((template) => {
              const active = account?.packageTemplateId === template.id;
              return (
                <div key={template.id} data-testid={`package-card-${template.code.toLowerCase()}`} className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-[var(--ink)]">{template.name}</p>
                      <p className="mt-1 text-sm text-[var(--ink-muted)]">{template.description}</p>
                    </div>
                    {active ? (
                      <span className="rounded-full bg-[var(--brand-600)] px-3 py-1 text-xs font-bold text-white">Assigned</span>
                    ) : null}
                  </div>
                  <p className="mt-3 text-sm text-[var(--ink-muted)]">
                    Setup: ${template.setupPrice?.toLocaleString() || 0} | Monthly: ${template.monthlyPrice?.toLocaleString() || 0}
                  </p>
                  <p className="mt-2 text-sm text-[var(--ink-muted)]">
                    Bundle: {template.serviceBundle.join(", ") || "No bundle listed"}
                  </p>
                  {canManage ? (
                    <div className="mt-3">
                      <ActionButton
                        variant={active ? "secondary" : "primary"}
                        disabled={assigningPackageId === template.id}
                        onClick={() => void assignPackage(template.id)}
                      >
                        {assigningPackageId === template.id ? "Assigning..." : active ? "Assigned" : "Assign package"}
                      </ActionButton>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </article>

        <article data-testid="client-profile-section" className="rounded-2xl border border-[var(--line)] bg-white p-5">
          <h2 className="text-lg font-bold">Client profile</h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Store commercial scope, current stage, target markets, and operating context.
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-[var(--ink-muted)]">Package name</span>
              <input value={profileForm.packageName} onChange={(event) => setProfileForm((current) => ({ ...current, packageName: event.target.value }))} className="w-full rounded-xl border border-[var(--line)] px-3 py-2" disabled={!canManage} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-[var(--ink-muted)]">Monthly ad budget</span>
              <input type="number" min="0" step="0.01" value={profileForm.adBudgetMonthly} onChange={(event) => setProfileForm((current) => ({ ...current, adBudgetMonthly: event.target.value }))} className="w-full rounded-xl border border-[var(--line)] px-3 py-2" disabled={!canManage} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-[var(--ink-muted)]">Client stage</span>
              <select value={profileForm.clientStage} onChange={(event) => setProfileForm((current) => ({ ...current, clientStage: event.target.value }))} className="w-full rounded-xl border border-[var(--line)] px-3 py-2" disabled={!canManage}>
                {stageOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-[var(--ink-muted)]">Health status</span>
              <select value={profileForm.healthStatus} onChange={(event) => setProfileForm((current) => ({ ...current, healthStatus: event.target.value }))} className="w-full rounded-xl border border-[var(--line)] px-3 py-2" disabled={!canManage}>
                {healthOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-[var(--ink-muted)]">Messaging brand</span>
              <input value={profileForm.messagingBrandName} onChange={(event) => setProfileForm((current) => ({ ...current, messagingBrandName: event.target.value }))} className="w-full rounded-xl border border-[var(--line)] px-3 py-2" disabled={!canManage} placeholder="MigraMarket" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-[var(--ink-muted)]">Default SMS/MMS from number</span>
              <input value={profileForm.messagingFromNumber} onChange={(event) => setProfileForm((current) => ({ ...current, messagingFromNumber: event.target.value }))} className="w-full rounded-xl border border-[var(--line)] px-3 py-2" disabled={!canManage} placeholder="+1..." />
            </label>
            <label className="text-sm md:col-span-2">
              <span className="mb-1 block text-[var(--ink-muted)]">Messaging support email</span>
              <input value={profileForm.messagingSupportEmail} onChange={(event) => setProfileForm((current) => ({ ...current, messagingSupportEmail: event.target.value }))} className="w-full rounded-xl border border-[var(--line)] px-3 py-2" disabled={!canManage} placeholder="support@example.com" />
            </label>
            <label className="text-sm md:col-span-2">
              <span className="mb-1 block text-[var(--ink-muted)]">Google Business Profile URL</span>
              <input data-testid="profile-gbp-url" value={profileForm.googleBusinessProfileUrl} onChange={(event) => setProfileForm((current) => ({ ...current, googleBusinessProfileUrl: event.target.value }))} className="w-full rounded-xl border border-[var(--line)] px-3 py-2" disabled={!canManage} />
            </label>
            <label className="text-sm md:col-span-2">
              <span className="mb-1 block text-[var(--ink-muted)]">Website URL</span>
              <input data-testid="profile-website-url" value={profileForm.websiteUrl} onChange={(event) => setProfileForm((current) => ({ ...current, websiteUrl: event.target.value }))} className="w-full rounded-xl border border-[var(--line)] px-3 py-2" disabled={!canManage} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-[var(--ink-muted)]">Primary goals</span>
              <textarea value={profileForm.primaryGoals} onChange={(event) => setProfileForm((current) => ({ ...current, primaryGoals: event.target.value }))} className="min-h-24 w-full rounded-xl border border-[var(--line)] px-3 py-2" disabled={!canManage} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-[var(--ink-muted)]">Target markets</span>
              <textarea value={profileForm.targetMarkets} onChange={(event) => setProfileForm((current) => ({ ...current, targetMarkets: event.target.value }))} className="min-h-24 w-full rounded-xl border border-[var(--line)] px-3 py-2" disabled={!canManage} />
            </label>
            <label className="text-sm md:col-span-2">
              <span className="mb-1 block text-[var(--ink-muted)]">Social profiles</span>
              <textarea value={profileForm.socialProfiles} onChange={(event) => setProfileForm((current) => ({ ...current, socialProfiles: event.target.value }))} className="min-h-20 w-full rounded-xl border border-[var(--line)] px-3 py-2" disabled={!canManage} />
            </label>
            <label className="text-sm md:col-span-2">
              <span className="mb-1 block text-[var(--ink-muted)]">Notes</span>
              <textarea value={profileForm.notes} onChange={(event) => setProfileForm((current) => ({ ...current, notes: event.target.value }))} className="min-h-20 w-full rounded-xl border border-[var(--line)] px-3 py-2" disabled={!canManage} />
            </label>
          </div>
          {canManage ? (
            <div className="mt-4 flex items-center gap-3">
              <ActionButton onClick={() => void saveProfile()} disabled={savingProfile}>{savingProfile ? "Saving..." : "Save profile"}</ActionButton>
              {profileMessage ? <span className="text-sm text-green-700">{profileMessage}</span> : null}
            </div>
          ) : null}
        </article>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <article data-testid="lead-pipeline-section" className="rounded-2xl border border-[var(--line)] bg-white p-5">
          <h2 className="text-lg font-bold">Lead intake and pipeline</h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Capture attributed leads from intake forms and manual entry, then track them through the pipeline.
          </p>
          <div className="mt-4 space-y-3">
            {primaryLeadForm ? (
              <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-4 text-sm">
                <p className="font-semibold text-[var(--ink)]">{primaryLeadForm.name}</p>
                <p className="mt-1 text-[var(--ink-muted)]">
                  Public submit payload: `orgSlug={orgSlug}` and `formSlug={primaryLeadForm.slug}` to `/api/migramarket/intake/submit`
                </p>
              </div>
            ) : null}
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-4">
              <p className="font-semibold text-[var(--ink)]">Intake forms</p>
              <div className="mt-3 space-y-3">
                {leadForms.map((form) => (
                  <div key={form.id} data-testid={`lead-form-card-${form.slug}`} className="rounded-xl border border-[var(--line)] bg-white p-3">
                    <div className="grid gap-3 md:grid-cols-2">
                      <input
                        value={form.name}
                        disabled={!canManage || busyFormId === form.id}
                        onChange={(event) => setLeadForms((current) => current.map((item) => item.id === form.id ? { ...item, name: event.target.value } : item))}
                        className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm"
                      />
                      <input
                        value={form.slug}
                        disabled={!canManage || busyFormId === form.id}
                        onChange={(event) => setLeadForms((current) => current.map((item) => item.id === form.id ? { ...item, slug: event.target.value } : item))}
                        className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm"
                      />
                      <input
                        value={form.sourceChannel}
                        disabled={!canManage || busyFormId === form.id}
                        onChange={(event) => setLeadForms((current) => current.map((item) => item.id === form.id ? { ...item, sourceChannel: event.target.value } : item))}
                        className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm"
                      />
                      <input
                        value={form.destinationEmail || ""}
                        disabled={!canManage || busyFormId === form.id}
                        onChange={(event) => setLeadForms((current) => current.map((item) => item.id === form.id ? { ...item, destinationEmail: event.target.value } : item))}
                        className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm"
                        placeholder="Destination email"
                      />
                    </div>
                    <textarea
                      value={form.thankYouMessage || ""}
                      disabled={!canManage || busyFormId === form.id}
                      onChange={(event) => setLeadForms((current) => current.map((item) => item.id === form.id ? { ...item, thankYouMessage: event.target.value } : item))}
                      className="mt-3 min-h-20 w-full rounded-xl border border-[var(--line)] px-3 py-2 text-sm"
                      placeholder="Thank you message"
                    />
                    <div className="mt-3 grid gap-3 md:grid-cols-[auto_1fr]">
                      <label className="flex items-center gap-2 text-sm text-[var(--ink-muted)]">
                        <input
                          type="checkbox"
                          checked={form.smsConsentEnabled}
                          disabled={!canManage || busyFormId === form.id}
                          onChange={(event) =>
                            setLeadForms((current) =>
                              current.map((item) =>
                                item.id === form.id ? { ...item, smsConsentEnabled: event.target.checked } : item,
                              ),
                            )
                          }
                        />
                        Require SMS consent
                      </label>
                      <input
                        value={form.smsConsentLabel || ""}
                        disabled={!canManage || busyFormId === form.id}
                        onChange={(event) =>
                          setLeadForms((current) =>
                            current.map((item) =>
                              item.id === form.id ? { ...item, smsConsentLabel: event.target.value } : item,
                            ),
                          )
                        }
                        className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm"
                        placeholder="I agree to receive SMS/MMS marketing messages from ..."
                      />
                    </div>
                    {form.smsConsentEnabled && form.active ? (
                      <div className="mt-3 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3 text-sm">
                        <p className="font-semibold text-[var(--ink)]">Public opt-in link</p>
                        <p className="mt-1 text-[var(--ink-muted)]">
                          Share by email, website, QR code, or direct message. Do not send this link by SMS until the
                          recipient has already opted in.
                        </p>
                        <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-center">
                          <input
                            value={getOptInUrl(form)}
                            readOnly
                            className="min-w-0 flex-1 rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm"
                          />
                          <div className="flex gap-2">
                            <ActionButton
                              variant="secondary"
                              onClick={() => void copyToClipboard(getOptInUrl(form), `Copied opt-in link for ${form.name}.`)}
                            >
                              Copy link
                            </ActionButton>
                            <a
                              href={getOptInPath(form)}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center justify-center rounded-xl border border-[var(--line)] bg-white px-4 py-2 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--surface-2)]"
                            >
                              Open page
                            </a>
                          </div>
                        </div>
                      </div>
                    ) : null}
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <label className="flex items-center gap-2 text-sm text-[var(--ink-muted)]">
                        <input
                          type="checkbox"
                          checked={form.active}
                          disabled={!canManage || busyFormId === form.id}
                          onChange={(event) => setLeadForms((current) => current.map((item) => item.id === form.id ? { ...item, active: event.target.checked } : item))}
                        />
                        Published
                      </label>
                      {canManage ? (
                        <>
                          <ActionButton variant="secondary" onClick={() => void updateLeadForm(form)} disabled={busyFormId === form.id}>
                            {busyFormId === form.id ? "Saving..." : "Save form"}
                          </ActionButton>
                          <ActionButton variant="secondary" onClick={() => void deleteLeadForm(form.id)} disabled={busyFormId === form.id}>
                            Delete
                          </ActionButton>
                        </>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
              {canManage ? (
                <div className="mt-4 rounded-xl border border-dashed border-[var(--line)] p-3">
                  <p className="font-semibold text-[var(--ink)]">Create intake form</p>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <input value={leadCaptureForm.name} onChange={(event) => setLeadCaptureForm((current) => ({ ...current, name: event.target.value }))} placeholder="Form name" className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                    <input value={leadCaptureForm.slug} onChange={(event) => setLeadCaptureForm((current) => ({ ...current, slug: event.target.value }))} placeholder="form-slug" className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                    <input value={leadCaptureForm.sourceChannel} onChange={(event) => setLeadCaptureForm((current) => ({ ...current, sourceChannel: event.target.value }))} placeholder="Source channel" className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                    <input value={leadCaptureForm.destinationEmail} onChange={(event) => setLeadCaptureForm((current) => ({ ...current, destinationEmail: event.target.value }))} placeholder="Destination email" className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                  </div>
                  <textarea value={leadCaptureForm.thankYouMessage} onChange={(event) => setLeadCaptureForm((current) => ({ ...current, thankYouMessage: event.target.value }))} placeholder="Thank you message" className="mt-3 min-h-20 w-full rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                  <div className="mt-3 grid gap-3 md:grid-cols-[auto_1fr]">
                    <label className="flex items-center gap-2 text-sm text-[var(--ink-muted)]">
                      <input type="checkbox" checked={leadCaptureForm.smsConsentEnabled} onChange={(event) => setLeadCaptureForm((current) => ({ ...current, smsConsentEnabled: event.target.checked }))} />
                      Require SMS consent
                    </label>
                    <input value={leadCaptureForm.smsConsentLabel} onChange={(event) => setLeadCaptureForm((current) => ({ ...current, smsConsentLabel: event.target.value }))} placeholder="Consent checkbox label" className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                  </div>
                  <div className="mt-3 flex items-center gap-3">
                    <ActionButton onClick={() => void createLeadCaptureForm()} disabled={formSaving || !leadCaptureForm.name || !leadCaptureForm.slug}>
                      {formSaving ? "Creating..." : "Create form"}
                    </ActionButton>
                    {formMessage ? <span className="text-sm text-green-700">{formMessage}</span> : null}
                  </div>
                </div>
              ) : null}
            </div>
            {leads.map((lead) => (
              <div key={lead.id} data-testid={`lead-card-${lead.id}`} className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <input
                      value={lead.fullName}
                      disabled={!canManage || busyLeadId === lead.id}
                      onChange={(event) => setLeads((current) => current.map((item) => item.id === lead.id ? { ...item, fullName: event.target.value } : item))}
                      className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm font-semibold text-[var(--ink)]"
                    />
                    <div className="mt-2 grid gap-2 md:grid-cols-3">
                      <input value={lead.company || ""} disabled={!canManage || busyLeadId === lead.id} onChange={(event) => setLeads((current) => current.map((item) => item.id === lead.id ? { ...item, company: event.target.value } : item))} placeholder="Company" className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm" />
                      <input value={lead.email || ""} disabled={!canManage || busyLeadId === lead.id} onChange={(event) => setLeads((current) => current.map((item) => item.id === lead.id ? { ...item, email: event.target.value } : item))} placeholder="Email" className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm" />
                      <input value={lead.phone || ""} disabled={!canManage || busyLeadId === lead.id} onChange={(event) => setLeads((current) => current.map((item) => item.id === lead.id ? { ...item, phone: event.target.value } : item))} placeholder="Phone" className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm" />
                    </div>
                  </div>
                  <div className="text-right text-sm text-[var(--ink-muted)]">
                    <select value={lead.status} disabled={!canManage || busyLeadId === lead.id} onChange={(event) => setLeads((current) => current.map((item) => item.id === lead.id ? { ...item, status: event.target.value } : item))} className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm">
                      {leadStatusOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                    <input value={lead.sourceChannel} disabled={!canManage || busyLeadId === lead.id} onChange={(event) => setLeads((current) => current.map((item) => item.id === lead.id ? { ...item, sourceChannel: event.target.value } : item))} className="mt-2 rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm" />
                  </div>
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-3">
                  <input value={lead.campaign || ""} disabled={!canManage || busyLeadId === lead.id} onChange={(event) => setLeads((current) => current.map((item) => item.id === lead.id ? { ...item, campaign: event.target.value } : item))} placeholder="Campaign" className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm" />
                  <input value={lead.landingPage || ""} disabled={!canManage || busyLeadId === lead.id} onChange={(event) => setLeads((current) => current.map((item) => item.id === lead.id ? { ...item, landingPage: event.target.value } : item))} placeholder="Landing page" className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm" />
                  <input value={lead.valueEstimate || 0} type="number" min="0" step="0.01" disabled={!canManage || busyLeadId === lead.id} onChange={(event) => setLeads((current) => current.map((item) => item.id === lead.id ? { ...item, valueEstimate: Number(event.target.value) } : item))} placeholder="Value estimate" className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm" />
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-3">
                  <select value={lead.smsConsentStatus} disabled={!canManage || busyLeadId === lead.id} onChange={(event) => setLeads((current) => current.map((item) => item.id === lead.id ? { ...item, smsConsentStatus: event.target.value, smsOptedOutAt: event.target.value === "unsubscribed" ? item.smsOptedOutAt || new Date().toISOString() : event.target.value === "subscribed" ? null : item.smsOptedOutAt } : item))} className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm">
                    {consentStatusOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                  <input value={lead.smsConsentSource || ""} disabled={!canManage || busyLeadId === lead.id} onChange={(event) => setLeads((current) => current.map((item) => item.id === lead.id ? { ...item, smsConsentSource: event.target.value } : item))} placeholder="Consent source" className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm" />
                  <input value={lead.messagingTags.join(", ")} disabled={!canManage || busyLeadId === lead.id} onChange={(event) => setLeads((current) => current.map((item) => item.id === lead.id ? { ...item, messagingTags: fromMultiline(event.target.value) } : item))} placeholder="Audience tags" className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm" />
                </div>
                <input value={lead.smsConsentEvidence || ""} disabled={!canManage || busyLeadId === lead.id} onChange={(event) => setLeads((current) => current.map((item) => item.id === lead.id ? { ...item, smsConsentEvidence: event.target.value } : item))} placeholder="Consent evidence or notes" className="mt-3 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm" />
                <p className="mt-2 text-xs text-[var(--ink-muted)]">
                  Consent: {lead.smsConsentStatus}
                  {lead.smsConsentAt ? ` since ${new Date(lead.smsConsentAt).toLocaleDateString()}` : ""}
                  {lead.smsOptedOutAt ? ` · opted out ${new Date(lead.smsOptedOutAt).toLocaleDateString()}` : ""}
                </p>
                <textarea value={lead.notes || ""} disabled={!canManage || busyLeadId === lead.id} onChange={(event) => setLeads((current) => current.map((item) => item.id === lead.id ? { ...item, notes: event.target.value } : item))} placeholder="Lead notes" className="mt-3 min-h-20 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm" />
                {canManage ? (
                  <div className="mt-3 flex gap-3">
                    <ActionButton variant="secondary" onClick={() => void updateLead(lead)} disabled={busyLeadId === lead.id}>
                      {busyLeadId === lead.id ? "Saving..." : "Save lead"}
                    </ActionButton>
                    <ActionButton variant="secondary" onClick={() => void deleteLead(lead.id)} disabled={busyLeadId === lead.id}>
                      Delete
                    </ActionButton>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          {canManage ? (
            <div className="mt-5 rounded-2xl border border-dashed border-[var(--line)] p-4">
              <p className="font-semibold text-[var(--ink)]">Bulk import consented audience</p>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">
                Paste CSV or tab-delimited rows with a header line. Use this to load your first SMS/MMS audience safely,
                preview the results, then import once the summary looks right.
              </p>
              <div className="mt-3 grid gap-3">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <input value={leadImportForm.defaultSourceChannel} onChange={(event) => setLeadImportForm((current) => ({ ...current, defaultSourceChannel: event.target.value }))} placeholder="Default source channel" className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                  <input value={leadImportForm.defaultStatus} onChange={(event) => setLeadImportForm((current) => ({ ...current, defaultStatus: event.target.value }))} placeholder="Default lead status" className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                  <select value={leadImportForm.defaultConsentStatus} onChange={(event) => setLeadImportForm((current) => ({ ...current, defaultConsentStatus: event.target.value }))} className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm">
                    {consentStatusOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                  <input value={leadImportForm.defaultConsentSource} onChange={(event) => setLeadImportForm((current) => ({ ...current, defaultConsentSource: event.target.value }))} placeholder="Default consent source" className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm md:col-span-2 xl:col-span-1" />
                  <input value={leadImportForm.defaultTags} onChange={(event) => setLeadImportForm((current) => ({ ...current, defaultTags: event.target.value }))} placeholder="Default audience tags" className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm md:col-span-2" />
                </div>
                <textarea value={leadImportForm.text} onChange={(event) => setLeadImportForm((current) => ({ ...current, text: event.target.value }))} className="min-h-40 rounded-xl border border-[var(--line)] px-3 py-2 font-mono text-sm" placeholder="Paste CSV with headers here" />
                <p className="text-xs text-[var(--ink-muted)]">
                  Recommended headers: <code>fullName,phone,email,company,smsConsentStatus,smsConsentSource,smsConsentEvidence,messagingTags</code>
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <ActionButton variant="secondary" onClick={() => void importLeads(true)} disabled={leadImporting || !leadImportForm.text.trim()}>
                    {leadImporting ? "Working..." : "Preview import"}
                  </ActionButton>
                  <ActionButton onClick={() => void importLeads(false)} disabled={leadImporting || !leadImportForm.text.trim()}>
                    {leadImporting ? "Importing..." : "Import audience"}
                  </ActionButton>
                  {leadImportMessage ? <span className="text-sm text-green-700">{leadImportMessage}</span> : null}
                </div>
                {leadImportSummary ? (
                  <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3 text-sm">
                    <p className="font-semibold text-[var(--ink)]">
                      {leadImportSummary.dryRun ? "Preview summary" : "Import summary"}
                    </p>
                    <p className="mt-1 text-[var(--ink-muted)]">
                      {leadImportSummary.validRows} valid of {leadImportSummary.totalRows} rows · {leadImportSummary.createCount} create · {leadImportSummary.updateCount} update · {leadImportSummary.skippedCount} skipped
                    </p>
                    {leadImportSummary.errors.length ? (
                      <div className="mt-2 space-y-1 text-xs text-red-700">
                        {leadImportSummary.errors.map((error) => (
                          <p key={`${error.rowNumber}-${error.message}`}>
                            Row {error.rowNumber}: {error.message}
                          </p>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
          {canManage ? (
            <div className="mt-5 rounded-2xl border border-dashed border-[var(--line)] p-4">
              <p className="font-semibold text-[var(--ink)]">Add lead</p>
              <div className="mt-3 grid gap-3">
                <div className="grid gap-3 md:grid-cols-2">
                  <input value={leadForm.fullName} onChange={(event) => setLeadForm((current) => ({ ...current, fullName: event.target.value }))} placeholder="Full name" className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                  <input value={leadForm.company} onChange={(event) => setLeadForm((current) => ({ ...current, company: event.target.value }))} placeholder="Company" className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                  <input value={leadForm.email} onChange={(event) => setLeadForm((current) => ({ ...current, email: event.target.value }))} placeholder="Email" className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                  <input value={leadForm.phone} onChange={(event) => setLeadForm((current) => ({ ...current, phone: event.target.value }))} placeholder="Phone" className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                  <input value={leadForm.sourceChannel} onChange={(event) => setLeadForm((current) => ({ ...current, sourceChannel: event.target.value }))} placeholder="Source channel" className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                  <select value={leadForm.status} onChange={(event) => setLeadForm((current) => ({ ...current, status: event.target.value }))} className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm">
                    {leadStatusOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                  <input value={leadForm.campaign} onChange={(event) => setLeadForm((current) => ({ ...current, campaign: event.target.value }))} placeholder="Campaign" className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                  <input value={leadForm.valueEstimate} onChange={(event) => setLeadForm((current) => ({ ...current, valueEstimate: event.target.value }))} placeholder="Value estimate" type="number" min="0" step="0.01" className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                  <select value={leadForm.smsConsentStatus} onChange={(event) => setLeadForm((current) => ({ ...current, smsConsentStatus: event.target.value }))} className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm">
                    {consentStatusOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                  <input value={leadForm.smsConsentSource} onChange={(event) => setLeadForm((current) => ({ ...current, smsConsentSource: event.target.value }))} placeholder="Consent source" className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                </div>
                <input value={leadForm.landingPage} onChange={(event) => setLeadForm((current) => ({ ...current, landingPage: event.target.value }))} placeholder="Landing page" className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                <input value={leadForm.messagingTags} onChange={(event) => setLeadForm((current) => ({ ...current, messagingTags: event.target.value }))} placeholder="Audience tags, comma separated" className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                <input value={leadForm.smsConsentEvidence} onChange={(event) => setLeadForm((current) => ({ ...current, smsConsentEvidence: event.target.value }))} placeholder="Consent evidence" className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                <textarea value={leadForm.notes} onChange={(event) => setLeadForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Lead notes" className="min-h-20 rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                <div className="flex items-center gap-3">
                  <ActionButton onClick={() => void createLead()} disabled={leadSaving || !leadForm.fullName}>{leadSaving ? "Saving..." : "Create lead"}</ActionButton>
                  {leadMessage ? <span className="text-sm text-green-700">{leadMessage}</span> : null}
                </div>
              </div>
            </div>
          ) : null}
        </article>

        <article data-testid="reporting-section" className="rounded-2xl border border-[var(--line)] bg-white p-5">
          <h2 className="text-lg font-bold">Reporting snapshots</h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Preserve clean monthly performance history for calls, leads, reviews, spend, and revenue.
          </p>
          <div className="mt-4 space-y-3">
            {reports.map((report) => (
              <div key={report.id} data-testid={`report-card-${report.id}`} className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <input
                      value={report.label}
                      disabled={!canManage || busyReportId === report.id}
                      onChange={(event) => setReports((current) => current.map((item) => item.id === report.id ? { ...item, label: event.target.value } : item))}
                      className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm font-semibold text-[var(--ink)]"
                    />
                    <p className="text-sm text-[var(--ink-muted)]">
                      {new Date(report.periodStart).toLocaleDateString()} to {new Date(report.periodEnd).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="text-right text-sm text-[var(--ink-muted)]">
                    <input
                      value={report.leads}
                      type="number"
                      min="0"
                      disabled={!canManage || busyReportId === report.id}
                      onChange={(event) => setReports((current) => current.map((item) => item.id === report.id ? { ...item, leads: Number(event.target.value) } : item))}
                      className="w-24 rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm"
                    />
                    <input
                      value={report.calls}
                      type="number"
                      min="0"
                      disabled={!canManage || busyReportId === report.id}
                      onChange={(event) => setReports((current) => current.map((item) => item.id === report.id ? { ...item, calls: Number(event.target.value) } : item))}
                      className="mt-2 w-24 rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm"
                    />
                  </div>
                </div>
                <p className="mt-3 text-sm text-[var(--ink-muted)]">
                  Revenue ${report.revenueAttributed?.toLocaleString() || 0} | CPL ${report.costPerLead?.toLocaleString() || 0}
                </p>
                <textarea
                  value={report.summary || ""}
                  disabled={!canManage || busyReportId === report.id}
                  onChange={(event) => setReports((current) => current.map((item) => item.id === report.id ? { ...item, summary: event.target.value } : item))}
                  className="mt-3 min-h-20 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm"
                  placeholder="Summary"
                />
                {canManage ? (
                  <div className="mt-3 flex gap-3">
                    <ActionButton variant="secondary" onClick={() => void updateReport(report)} disabled={busyReportId === report.id}>
                      {busyReportId === report.id ? "Saving..." : "Save snapshot"}
                    </ActionButton>
                    <ActionButton variant="secondary" onClick={() => void deleteReport(report.id)} disabled={busyReportId === report.id}>
                      {busyReportId === report.id ? "Deleting..." : "Delete snapshot"}
                    </ActionButton>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          {canManage ? (
            <div className="mt-5 rounded-2xl border border-dashed border-[var(--line)] p-4">
              <p className="font-semibold text-[var(--ink)]">Add snapshot</p>
              <div className="mt-3 grid gap-3">
                <input value={reportForm.label} onChange={(event) => setReportForm((current) => ({ ...current, label: event.target.value }))} placeholder="March 2026" className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                <div className="grid gap-3 md:grid-cols-2">
                  <input type="datetime-local" value={reportForm.periodStart} onChange={(event) => setReportForm((current) => ({ ...current, periodStart: event.target.value }))} className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                  <input type="datetime-local" value={reportForm.periodEnd} onChange={(event) => setReportForm((current) => ({ ...current, periodEnd: event.target.value }))} className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                </div>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <input value={reportForm.leads} onChange={(event) => setReportForm((current) => ({ ...current, leads: event.target.value }))} placeholder="Leads" type="number" min="0" className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                  <input value={reportForm.calls} onChange={(event) => setReportForm((current) => ({ ...current, calls: event.target.value }))} placeholder="Calls" type="number" min="0" className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                  <input value={reportForm.bookedAppointments} onChange={(event) => setReportForm((current) => ({ ...current, bookedAppointments: event.target.value }))} placeholder="Booked appointments" type="number" min="0" className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                  <input value={reportForm.profileViews} onChange={(event) => setReportForm((current) => ({ ...current, profileViews: event.target.value }))} placeholder="Profile views" type="number" min="0" className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                  <input value={reportForm.websiteSessions} onChange={(event) => setReportForm((current) => ({ ...current, websiteSessions: event.target.value }))} placeholder="Website sessions" type="number" min="0" className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                  <input value={reportForm.socialReach} onChange={(event) => setReportForm((current) => ({ ...current, socialReach: event.target.value }))} placeholder="Social reach" type="number" min="0" className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                  <input value={reportForm.reviewCount} onChange={(event) => setReportForm((current) => ({ ...current, reviewCount: event.target.value }))} placeholder="Review count" type="number" min="0" className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                  <input value={reportForm.averageRating} onChange={(event) => setReportForm((current) => ({ ...current, averageRating: event.target.value }))} placeholder="Average rating" type="number" step="0.1" min="0" max="5" className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                  <input value={reportForm.emailOpenRate} onChange={(event) => setReportForm((current) => ({ ...current, emailOpenRate: event.target.value }))} placeholder="Email open rate %" type="number" step="0.1" min="0" max="100" className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                  <input value={reportForm.conversionRate} onChange={(event) => setReportForm((current) => ({ ...current, conversionRate: event.target.value }))} placeholder="Conversion rate %" type="number" step="0.1" min="0" className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                  <input value={reportForm.adSpend} onChange={(event) => setReportForm((current) => ({ ...current, adSpend: event.target.value }))} placeholder="Ad spend" type="number" min="0" step="0.01" className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                  <input value={reportForm.costPerLead} onChange={(event) => setReportForm((current) => ({ ...current, costPerLead: event.target.value }))} placeholder="Cost per lead" type="number" min="0" step="0.01" className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                  <input value={reportForm.revenueAttributed} onChange={(event) => setReportForm((current) => ({ ...current, revenueAttributed: event.target.value }))} placeholder="Revenue attributed" type="number" min="0" step="0.01" className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm md:col-span-2 xl:col-span-3" />
                </div>
                <textarea value={reportForm.summary} onChange={(event) => setReportForm((current) => ({ ...current, summary: event.target.value }))} placeholder="Summary" className="min-h-20 rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                <div className="flex items-center gap-3">
                  <ActionButton onClick={() => void createReport()} disabled={reportSaving || !reportForm.label || !reportForm.periodStart || !reportForm.periodEnd}>{reportSaving ? "Saving..." : "Save snapshot"}</ActionButton>
                  {reportMessage ? <span className="text-sm text-green-700">{reportMessage}</span> : null}
                </div>
              </div>
            </div>
          ) : null}
        </article>
      </section>

      <MigraMarketSocialOps
        canManage={canManage}
        initialConnections={initialWorkspace.socialConnections}
        initialBriefs={initialWorkspace.creativeBriefs}
        initialJobs={initialWorkspace.contentJobs}
        initialTemplates={initialWorkspace.contentTemplates}
        initialCalendarSlots={initialWorkspace.calendarSlots}
      />

      <section className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
        <article data-testid="messaging-campaigns-section" className="rounded-2xl border border-[var(--line)] bg-white p-5">
          <h2 className="text-lg font-bold">SMS and MMS campaigns</h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Launch compliant outbound campaigns with consent-only audiences, STOP handling, and delivery tracking.
          </p>
          <div className="mt-4 space-y-3">
            {messagingCampaigns.map((campaign) => (
              <div key={campaign.id} data-testid={`messaging-campaign-${campaign.id}`} className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex-1">
                    <input
                      value={campaign.name}
                      disabled={!canManage || busyCampaignId === campaign.id}
                      onChange={(event) =>
                        setMessagingCampaigns((current) =>
                          current.map((item) => (item.id === campaign.id ? { ...item, name: event.target.value } : item)),
                        )
                      }
                      className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm font-semibold text-[var(--ink)]"
                    />
                    <div className="mt-2 grid gap-2 md:grid-cols-3">
                      <input
                        value={campaign.fromNumber}
                        disabled={!canManage || busyCampaignId === campaign.id}
                        onChange={(event) =>
                          setMessagingCampaigns((current) =>
                            current.map((item) => (item.id === campaign.id ? { ...item, fromNumber: event.target.value } : item)),
                          )
                        }
                        placeholder="From number"
                        className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm"
                      />
                      <input
                        value={campaign.audienceTag || ""}
                        disabled={!canManage || busyCampaignId === campaign.id}
                        onChange={(event) =>
                          setMessagingCampaigns((current) =>
                            current.map((item) => (item.id === campaign.id ? { ...item, audienceTag: event.target.value } : item)),
                          )
                        }
                        placeholder="Audience tag"
                        className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm"
                      />
                      <select
                        value={campaign.status}
                        disabled={!canManage || busyCampaignId === campaign.id}
                        onChange={(event) =>
                          setMessagingCampaigns((current) =>
                            current.map((item) => (item.id === campaign.id ? { ...item, status: event.target.value } : item)),
                          )
                        }
                        className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm"
                      >
                        {campaignStatusOptions.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm text-[var(--ink-muted)]">
                    <p>
                      {campaign.channel.toUpperCase()} · {campaign.recipientCount} recipients
                    </p>
                    <p className="mt-1">
                      {campaign.deliveredCount} delivered · {campaign.failedCount} failed
                    </p>
                  </div>
                </div>
                <textarea
                  value={campaign.body}
                  disabled={!canManage || busyCampaignId === campaign.id}
                  onChange={(event) =>
                    setMessagingCampaigns((current) =>
                      current.map((item) => (item.id === campaign.id ? { ...item, body: event.target.value } : item)),
                    )
                  }
                  className="mt-3 min-h-24 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm"
                  placeholder="Campaign message body"
                />
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  <input
                    value={campaign.mediaUrls.join("\n")}
                    disabled={!canManage || busyCampaignId === campaign.id}
                    onChange={(event) =>
                      setMessagingCampaigns((current) =>
                        current.map((item) =>
                          item.id === campaign.id ? { ...item, mediaUrls: fromMultiline(event.target.value) } : item,
                        ),
                      )
                    }
                    placeholder="HTTPS media URLs, one per line"
                    className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm"
                  />
                  <input
                    type="datetime-local"
                    value={toDatetimeLocal(campaign.scheduledAt)}
                    disabled={!canManage || busyCampaignId === campaign.id}
                    onChange={(event) =>
                      setMessagingCampaigns((current) =>
                        current.map((item) =>
                          item.id === campaign.id ? { ...item, scheduledAt: fromDatetimeLocal(event.target.value) } : item,
                        ),
                      )
                    }
                    className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm"
                  />
                </div>
                <textarea
                  value={campaign.notes || ""}
                  disabled={!canManage || busyCampaignId === campaign.id}
                  onChange={(event) =>
                    setMessagingCampaigns((current) =>
                      current.map((item) => (item.id === campaign.id ? { ...item, notes: event.target.value } : item)),
                    )
                  }
                  className="mt-3 min-h-20 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm"
                  placeholder="Internal campaign notes"
                />
                <p className="mt-2 text-xs text-[var(--ink-muted)]">
                  Last dispatch: {campaign.lastDispatchedAt ? new Date(campaign.lastDispatchedAt).toLocaleString() : "not yet"}
                  {campaign.audienceTag ? ` · audience ${campaign.audienceTag}` : " · all subscribed leads"}
                </p>
                {canManage ? (
                  <div className="mt-3 flex flex-wrap gap-3">
                    <ActionButton variant="secondary" onClick={() => void updateCampaign(campaign)} disabled={busyCampaignId === campaign.id}>
                      {busyCampaignId === campaign.id ? "Saving..." : "Save campaign"}
                    </ActionButton>
                    <ActionButton onClick={() => void launchCampaign(campaign.id)} disabled={busyCampaignId === campaign.id}>
                      {busyCampaignId === campaign.id ? "Launching..." : "Launch now"}
                    </ActionButton>
                    <ActionButton variant="secondary" onClick={() => void deleteCampaign(campaign.id)} disabled={busyCampaignId === campaign.id}>
                      Delete
                    </ActionButton>
                  </div>
                ) : null}
              </div>
            ))}
            {!messagingCampaigns.length ? (
              <div className="rounded-2xl border border-dashed border-[var(--line)] p-4 text-sm text-[var(--ink-muted)]">
                No messaging campaigns yet. Create a compliant SMS or MMS blast below.
              </div>
            ) : null}
          </div>
          {canManage ? (
            <div className="mt-5 rounded-2xl border border-dashed border-[var(--line)] p-4">
              <p className="font-semibold text-[var(--ink)]">Create campaign</p>
              <div className="mt-3 grid gap-3">
                <div className="grid gap-3 md:grid-cols-2">
                  <input value={campaignForm.name} onChange={(event) => setCampaignForm((current) => ({ ...current, name: event.target.value }))} placeholder="Spring launch blast" className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                  <input value={campaignForm.fromNumber} onChange={(event) => setCampaignForm((current) => ({ ...current, fromNumber: event.target.value }))} placeholder="+1..." className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                  <input value={campaignForm.audienceTag} onChange={(event) => setCampaignForm((current) => ({ ...current, audienceTag: event.target.value }))} placeholder="Audience tag filter" className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                  <input type="datetime-local" value={campaignForm.scheduledAt} onChange={(event) => setCampaignForm((current) => ({ ...current, scheduledAt: event.target.value }))} className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                </div>
                <textarea value={campaignForm.body} onChange={(event) => setCampaignForm((current) => ({ ...current, body: event.target.value }))} placeholder="Offer details, CTA, and clear value. STOP/HELP language is appended automatically." className="min-h-24 rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                <input value={campaignForm.mediaUrls} onChange={(event) => setCampaignForm((current) => ({ ...current, mediaUrls: event.target.value }))} placeholder="HTTPS media URLs, one per line for MMS" className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                <textarea value={campaignForm.notes} onChange={(event) => setCampaignForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Internal notes" className="min-h-20 rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                <div className="flex items-center gap-3">
                  <ActionButton onClick={() => void createCampaign()} disabled={campaignSaving || !campaignForm.name || !campaignForm.fromNumber || !campaignForm.body}>
                    {campaignSaving ? "Creating..." : "Create campaign"}
                  </ActionButton>
                  {campaignMessage ? <span className="text-sm text-green-700">{campaignMessage}</span> : null}
                </div>
              </div>
            </div>
          ) : null}
        </article>

        <article data-testid="messaging-deliveries-section" className="rounded-2xl border border-[var(--line)] bg-white p-5">
          <h2 className="text-lg font-bold">Delivery activity</h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Recent two-way SMS activity, including outbound delivery telemetry and inbound customer replies.
          </p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-4">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--ink-muted)]">Recent successes</p>
              <p className="mt-2 text-3xl font-black tracking-tight">{recentDeliverySuccessCount}</p>
              <p className="mt-2 text-sm text-[var(--ink-muted)]">Submitted, sent, delivered, or finalized recently.</p>
            </div>
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-4">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--ink-muted)]">Latest campaign</p>
              <p className="mt-2 text-xl font-black tracking-tight">{latestCampaign?.name || "No campaigns yet"}</p>
              <p className="mt-2 text-sm text-[var(--ink-muted)]">
                {latestCampaign ? `${latestCampaign.deliveredCount} delivered · ${latestCampaign.failedCount} failed` : "Waiting for your first outbound run."}
              </p>
            </div>
          </div>
          <div className="mt-4 space-y-3">
            {recentDeliveries.map((delivery) => (
              <div key={delivery.id} data-testid={`messaging-delivery-${delivery.id}`} className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-[var(--ink)]">{delivery.phone}</p>
                    <p className="mt-1 text-sm text-[var(--ink-muted)]">
                      {delivery.campaign?.name || (delivery.direction === "inbound" ? "Inbound reply" : "Unassigned message")}
                      {delivery.lead ? ` · ${delivery.lead.fullName}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-white px-3 py-1 text-xs font-bold uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                      {delivery.direction}
                    </span>
                    <span className="rounded-full bg-white px-3 py-1 text-xs font-bold uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                      {delivery.status}
                    </span>
                  </div>
                </div>
                {delivery.body ? <p className="mt-3 text-sm text-[var(--ink)]">{delivery.body}</p> : null}
                <p className="mt-3 text-sm text-[var(--ink-muted)]">
                  Created {new Date(delivery.createdAt).toLocaleString()}
                  {delivery.deliveredAt ? ` · delivered ${new Date(delivery.deliveredAt).toLocaleString()}` : ""}
                  {delivery.finalizedAt ? ` · finalized ${new Date(delivery.finalizedAt).toLocaleString()}` : ""}
                </p>
                {delivery.errorMessage ? (
                  <p className="mt-2 text-sm text-red-700">
                    {delivery.errorCode ? `${delivery.errorCode}: ` : ""}
                    {delivery.errorMessage}
                  </p>
                ) : null}
              </div>
            ))}
            {!recentDeliveries.length ? (
              <div className="rounded-2xl border border-dashed border-[var(--line)] p-4 text-sm text-[var(--ink-muted)]">
                No delivery activity yet. Launch a campaign to populate send telemetry here.
              </div>
            ) : null}
          </div>
        </article>
      </section>

      <section className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
        <article data-testid="locations-section" className="rounded-2xl border border-[var(--line)] bg-white p-5">
          <h2 className="text-lg font-bold">Locations</h2>
          <div className="mt-4 space-y-3">
            {locations.map((location) => (
              <div key={location.id} data-testid={`location-card-${location.id}`} className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <input value={location.name} disabled={!canManage || busyLocationId === location.id} onChange={(event) => setLocations((current) => current.map((item) => item.id === location.id ? { ...item, name: event.target.value } : item))} className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm font-semibold text-[var(--ink)]" />
                    <div className="mt-2 grid gap-2 md:grid-cols-3">
                      <input value={location.city} disabled={!canManage || busyLocationId === location.id} onChange={(event) => setLocations((current) => current.map((item) => item.id === location.id ? { ...item, city: event.target.value } : item))} className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm" />
                      <input value={location.region || ""} disabled={!canManage || busyLocationId === location.id} onChange={(event) => setLocations((current) => current.map((item) => item.id === location.id ? { ...item, region: event.target.value } : item))} className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm" />
                      <input value={location.country} disabled={!canManage || busyLocationId === location.id} onChange={(event) => setLocations((current) => current.map((item) => item.id === location.id ? { ...item, country: event.target.value } : item))} className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm" />
                    </div>
                  </div>
                  {location.primary ? <span className="rounded-full bg-[var(--brand-600)] px-3 py-1 text-xs font-bold text-white">Primary</span> : null}
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  <input value={location.primaryPhone || ""} disabled={!canManage || busyLocationId === location.id} onChange={(event) => setLocations((current) => current.map((item) => item.id === location.id ? { ...item, primaryPhone: event.target.value } : item))} placeholder="Primary phone" className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm" />
                  <input value={location.serviceArea || ""} disabled={!canManage || busyLocationId === location.id} onChange={(event) => setLocations((current) => current.map((item) => item.id === location.id ? { ...item, serviceArea: event.target.value } : item))} placeholder="Service area" className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm" />
                </div>
                {canManage ? (
                  <div className="mt-3 flex gap-3">
                    <ActionButton variant="secondary" onClick={() => void updateLocation(location)} disabled={busyLocationId === location.id}>
                      {busyLocationId === location.id ? "Saving..." : "Save location"}
                    </ActionButton>
                    <ActionButton variant="secondary" onClick={() => void deleteLocation(location.id)} disabled={busyLocationId === location.id}>
                      Delete
                    </ActionButton>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          {canManage ? (
            <div className="mt-5 rounded-2xl border border-dashed border-[var(--line)] p-4">
              <p className="font-semibold text-[var(--ink)]">Add location</p>
              <div className="mt-3 grid gap-3">
                <div className="grid gap-3 md:grid-cols-2">
                  <input value={locationForm.name} onChange={(event) => setLocationForm((current) => ({ ...current, name: event.target.value }))} placeholder="Location name" className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                  <input value={locationForm.city} onChange={(event) => setLocationForm((current) => ({ ...current, city: event.target.value }))} placeholder="City" className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                  <input value={locationForm.region} onChange={(event) => setLocationForm((current) => ({ ...current, region: event.target.value }))} placeholder="State / Region" className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                  <input value={locationForm.country} onChange={(event) => setLocationForm((current) => ({ ...current, country: event.target.value }))} placeholder="Country" className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                  <input value={locationForm.primaryPhone} onChange={(event) => setLocationForm((current) => ({ ...current, primaryPhone: event.target.value }))} placeholder="Primary phone" className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                  <input value={locationForm.serviceArea} onChange={(event) => setLocationForm((current) => ({ ...current, serviceArea: event.target.value }))} placeholder="Service area" className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                </div>
                <label className="flex items-center gap-2 text-sm text-[var(--ink-muted)]">
                  <input type="checkbox" checked={locationForm.primary} onChange={(event) => setLocationForm((current) => ({ ...current, primary: event.target.checked }))} />
                  Mark as primary location
                </label>
                <div className="flex items-center gap-3">
                  <ActionButton variant="secondary" onClick={() => void createLocation()} disabled={locationSaving || !locationForm.name || !locationForm.city}>{locationSaving ? "Adding..." : "Add location"}</ActionButton>
                  {locationMessage ? <span className="text-sm text-green-700">{locationMessage}</span> : null}
                </div>
              </div>
            </div>
          ) : null}
        </article>

        <article data-testid="operations-section" className="rounded-2xl border border-[var(--line)] bg-white p-5">
          <h2 className="text-lg font-bold">Operations</h2>
          <div className="mt-4 space-y-3">
            {checklist.map((item) => (
              <div key={item.id} data-testid={`checklist-item-${item.key}`} className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-[var(--ink)]">{item.title}</p>
                    {item.description ? <p className="mt-1 text-sm text-[var(--ink-muted)]">{item.description}</p> : null}
                  </div>
                  <select value={item.status} disabled={!canManage || busyChecklistId === item.id} onChange={(event) => setChecklist((current) => current.map((entry) => (entry.id === item.id ? { ...entry, status: event.target.value } : entry)))} className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm">
                    {checklistStatusOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
                  <input value={item.owner || ""} disabled={!canManage || busyChecklistId === item.id} onChange={(event) => setChecklist((current) => current.map((entry) => (entry.id === item.id ? { ...entry, owner: event.target.value } : entry)))} placeholder="Owner" className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm" />
                  <input type="datetime-local" value={toDatetimeLocal(item.dueAt)} disabled={!canManage || busyChecklistId === item.id} onChange={(event) => setChecklist((current) => current.map((entry) => (entry.id === item.id ? { ...entry, dueAt: fromDatetimeLocal(event.target.value) } : entry)))} className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm" />
                  {canManage ? <ActionButton variant="secondary" onClick={() => void updateChecklistItem(item.id, item)} disabled={busyChecklistId === item.id}>{busyChecklistId === item.id ? "Saving..." : "Save"}</ActionButton> : null}
                </div>
              </div>
            ))}
            {tasks.map((task) => (
              <div key={task.id} data-testid={`task-card-${task.id}`} className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-[var(--ink)]">{task.title}</p>
                    <p className="mt-1 text-sm text-[var(--ink-muted)]">{task.category} · {task.assignee || "unassigned"}</p>
                  </div>
                  <div className="flex gap-2">
                    <select value={task.status} disabled={!canManage || busyTaskId === task.id} onChange={(event) => setTasks((current) => current.map((entry) => (entry.id === task.id ? { ...entry, status: event.target.value } : entry)))} className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm">
                      {taskStatusOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                    <select value={task.priority} disabled={!canManage || busyTaskId === task.id} onChange={(event) => setTasks((current) => current.map((entry) => (entry.id === task.id ? { ...entry, priority: event.target.value } : entry)))} className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm">
                      {taskPriorityOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </div>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr]">
                  <input value={task.assignee || ""} disabled={!canManage || busyTaskId === task.id} onChange={(event) => setTasks((current) => current.map((entry) => (entry.id === task.id ? { ...entry, assignee: event.target.value } : entry)))} placeholder="Assignee" className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm" />
                  <input type="datetime-local" value={toDatetimeLocal(task.dueAt)} disabled={!canManage || busyTaskId === task.id} onChange={(event) => setTasks((current) => current.map((entry) => (entry.id === task.id ? { ...entry, dueAt: fromDatetimeLocal(event.target.value) } : entry)))} className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm" />
                  <textarea value={task.notes || ""} disabled={!canManage || busyTaskId === task.id} onChange={(event) => setTasks((current) => current.map((entry) => (entry.id === task.id ? { ...entry, notes: event.target.value } : entry)))} placeholder="Task notes" className="min-h-20 rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm md:col-span-2" />
                </div>
                {canManage ? <div className="mt-3 flex gap-3"><ActionButton variant="secondary" onClick={() => void updateTask(task.id, task)} disabled={busyTaskId === task.id}>{busyTaskId === task.id ? "Saving..." : "Save task"}</ActionButton><ActionButton variant="secondary" onClick={() => void deleteTask(task.id)} disabled={busyTaskId === task.id}>Delete</ActionButton></div> : null}
              </div>
            ))}
          </div>
          {canManage ? (
            <div className="mt-5 rounded-2xl border border-dashed border-[var(--line)] p-4">
              <p className="font-semibold text-[var(--ink)]">Add recurring task</p>
              <div className="mt-3 grid gap-3">
                <input value={taskForm.title} onChange={(event) => setTaskForm((current) => ({ ...current, title: event.target.value }))} placeholder="Task title" className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                <div className="grid gap-3 md:grid-cols-3">
                  <input value={taskForm.category} onChange={(event) => setTaskForm((current) => ({ ...current, category: event.target.value }))} placeholder="Category" className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                  <select value={taskForm.priority} onChange={(event) => setTaskForm((current) => ({ ...current, priority: event.target.value }))} className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm">
                    {taskPriorityOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                  <input value={taskForm.assignee} onChange={(event) => setTaskForm((current) => ({ ...current, assignee: event.target.value }))} placeholder="Assignee" className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                </div>
                <input type="datetime-local" value={taskForm.dueAt} onChange={(event) => setTaskForm((current) => ({ ...current, dueAt: event.target.value }))} className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                <textarea value={taskForm.notes} onChange={(event) => setTaskForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Notes" className="min-h-20 rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
                <div className="flex items-center gap-3">
                  <ActionButton onClick={() => void createTask()} disabled={taskSaving || !taskForm.title}>{taskSaving ? "Creating..." : "Create task"}</ActionButton>
                  {taskMessage ? <span className="text-sm text-green-700">{taskMessage}</span> : null}
                </div>
              </div>
            </div>
          ) : null}
        </article>
      </section>
    </div>
  );
}
