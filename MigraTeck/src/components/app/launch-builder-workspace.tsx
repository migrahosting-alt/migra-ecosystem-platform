"use client";

import { useMemo, useState } from "react";
import { ActionButton } from "@/components/ui/button";

type LaunchPreviewStep = {
  command: string;
  displayName: string;
  orderIndex: number;
  capability: string;
};

type LaunchSiteSection = {
  kind: string;
  heading: string;
  body: string;
  bullets?: string[];
  ctaLabel?: string | null;
};

type LaunchSitePage = {
  slug: string;
  title: string;
  purpose: string;
  sections: LaunchSiteSection[];
};

type LaunchPreviewResponse = {
  requestedCommands: string[];
  steps: LaunchPreviewStep[];
  warnings: string[];
  blockers: string[];
  sitePreview: {
    templateKey: string;
    templateLabel: string;
    siteTitle: string;
    siteDescription: string;
    domain: string | null;
    targetAudience: string;
    tone: string;
    pages: LaunchSitePage[];
    publishReadiness: string[];
  };
  error?: string;
};

type LaunchStartResponse = {
  launchId?: string;
  missionId?: string;
  status?: string;
  error?: string;
};

interface LaunchBuilderWorkspaceProps {
  orgName: string;
  canStartLaunch: boolean;
}

function parseMultiline(value: string): string[] {
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function LaunchBuilderWorkspace({ orgName, canStartLaunch }: LaunchBuilderWorkspaceProps) {
  const [form, setForm] = useState({
    businessName: orgName,
    industry: "home-services",
    location: "",
    domain: "",
    prompt: "",
    targetAudience: "",
    tone: "clear, confident, and conversion-focused",
    primaryCta: "Request a quote",
    services: "",
    differentiators: "",
    plan: "business",
    emailUser: "info",
    enableVoice: false,
  });
  const [preview, setPreview] = useState<LaunchPreviewResponse | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [launchBusy, setLaunchBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [launchMessage, setLaunchMessage] = useState<string | null>(null);

  const requestBody = useMemo(
    () => ({
      businessName: form.businessName.trim(),
      industry: form.industry.trim() || undefined,
      location: form.location.trim() || undefined,
      domain: form.domain.trim().toLowerCase() || undefined,
      prompt: form.prompt.trim() || undefined,
      targetAudience: form.targetAudience.trim() || undefined,
      tone: form.tone.trim() || undefined,
      primaryCta: form.primaryCta.trim() || undefined,
      services: parseMultiline(form.services),
      differentiators: parseMultiline(form.differentiators),
      plan: form.plan,
      emailUser: form.emailUser.trim().toLowerCase() || undefined,
      enableVoice: form.enableVoice,
    }),
    [form],
  );

  async function generatePreview() {
    setPreviewBusy(true);
    setError(null);
    setLaunchMessage(null);

    const response = await fetch("/api/launch/business/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    const payload = (await response.json().catch(() => null)) as LaunchPreviewResponse | null;
    setPreviewBusy(false);

    if (!response.ok || !payload?.sitePreview) {
      setError(payload?.error || "Unable to generate site preview.");
      return;
    }

    setPreview(payload);
  }

  async function startLaunch() {
    setLaunchBusy(true);
    setError(null);
    setLaunchMessage(null);

    const response = await fetch("/api/launch/business", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    const payload = (await response.json().catch(() => null)) as LaunchStartResponse | null;
    setLaunchBusy(false);

    if (!response.ok || !payload?.launchId) {
      setError(payload?.error || "Unable to start launch.");
      return;
    }

    setLaunchMessage(`Launch created: ${payload.launchId}${payload.missionId ? ` | Mission: ${payload.missionId}` : ""}`);
  }

  return (
    <section className="space-y-6">
      <article className="rounded-2xl border border-[var(--line)] bg-white p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">Client Launch Workspace</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight">AI Website Builder</h1>
        <p className="mt-2 max-w-3xl text-sm text-[var(--ink-muted)]">
          Build a guided launch brief, generate a multi-page website draft, and move into hosted deployment from the client portal.
        </p>
        {!canStartLaunch ? (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            Preview is available, but launch execution is currently limited to eligible MigraHosting client organizations.
          </div>
        ) : null}
      </article>

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <article className="rounded-2xl border border-[var(--line)] bg-white p-5">
          <h2 className="text-xl font-bold">Builder Brief</h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Capture the business context that drives the first generated site draft.
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <input value={form.businessName} onChange={(event) => setForm((current) => ({ ...current, businessName: event.target.value }))} placeholder="Business name" className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
            <input value={form.domain} onChange={(event) => setForm((current) => ({ ...current, domain: event.target.value }))} placeholder="yourdomain.com" className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
            <input value={form.industry} onChange={(event) => setForm((current) => ({ ...current, industry: event.target.value }))} placeholder="Industry" className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
            <input value={form.location} onChange={(event) => setForm((current) => ({ ...current, location: event.target.value }))} placeholder="Location" className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
            <input value={form.targetAudience} onChange={(event) => setForm((current) => ({ ...current, targetAudience: event.target.value }))} placeholder="Target audience" className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
            <input value={form.primaryCta} onChange={(event) => setForm((current) => ({ ...current, primaryCta: event.target.value }))} placeholder="Primary CTA" className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
            <input value={form.tone} onChange={(event) => setForm((current) => ({ ...current, tone: event.target.value }))} placeholder="Tone" className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm md:col-span-2" />
            <textarea value={form.prompt} onChange={(event) => setForm((current) => ({ ...current, prompt: event.target.value }))} placeholder="Short business prompt" className="min-h-24 rounded-xl border border-[var(--line)] px-3 py-2 text-sm md:col-span-2" />
            <textarea value={form.services} onChange={(event) => setForm((current) => ({ ...current, services: event.target.value }))} placeholder="Services, one per line" className="min-h-28 rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
            <textarea value={form.differentiators} onChange={(event) => setForm((current) => ({ ...current, differentiators: event.target.value }))} placeholder="Differentiators, one per line" className="min-h-28 rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
            <select value={form.plan} onChange={(event) => setForm((current) => ({ ...current, plan: event.target.value }))} className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm">
              <option value="starter">starter</option>
              <option value="business">business</option>
              <option value="growth">growth</option>
            </select>
            <input value={form.emailUser} onChange={(event) => setForm((current) => ({ ...current, emailUser: event.target.value }))} placeholder="Email user" className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm" />
          </div>
          <label className="mt-4 flex items-center gap-2 text-sm text-[var(--ink-muted)]">
            <input type="checkbox" checked={form.enableVoice} onChange={(event) => setForm((current) => ({ ...current, enableVoice: event.target.checked }))} />
            Include business voice setup in launch plan
          </label>
          <div className="mt-5 flex flex-wrap gap-3">
            <ActionButton onClick={() => void generatePreview()} disabled={previewBusy || !form.businessName.trim()}>
              {previewBusy ? "Generating..." : "Generate Preview"}
            </ActionButton>
            <ActionButton variant="secondary" onClick={() => void startLaunch()} disabled={launchBusy || !canStartLaunch || !form.businessName.trim()}>
              {launchBusy ? "Starting..." : "Start Launch"}
            </ActionButton>
          </div>
          {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
          {launchMessage ? <p className="mt-3 text-sm text-green-700">{launchMessage}</p> : null}
        </article>

        <div className="space-y-6">
          <article className="rounded-2xl border border-[var(--line)] bg-white p-5">
            <h2 className="text-xl font-bold">Preview Output</h2>
            {!preview ? (
              <p className="mt-3 text-sm text-[var(--ink-muted)]">
                Generate a preview to see the draft site structure, sections, and launch commands.
              </p>
            ) : (
              <div className="mt-4 space-y-4">
                <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">Template</p>
                  <p className="mt-1 text-sm font-semibold text-[var(--ink)]">{preview.sitePreview.templateLabel}</p>
                  <p className="mt-2 text-sm text-[var(--ink-muted)]">{preview.sitePreview.siteDescription}</p>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">Audience</p>
                    <p className="mt-1 text-sm font-semibold text-[var(--ink)]">{preview.sitePreview.targetAudience}</p>
                  </div>
                  <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">Tone</p>
                    <p className="mt-1 text-sm font-semibold text-[var(--ink)]">{preview.sitePreview.tone}</p>
                  </div>
                </div>
                <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">Publish readiness</p>
                  <ul className="mt-2 space-y-2 text-sm text-[var(--ink-muted)]">
                    {preview.sitePreview.publishReadiness.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </article>

          {preview ? (
            <>
              <article className="rounded-2xl border border-[var(--line)] bg-white p-5">
                <h2 className="text-xl font-bold">Generated Pages</h2>
                <div className="mt-4 space-y-4">
                  {preview.sitePreview.pages.map((page) => (
                    <div key={page.slug} className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-4">
                      <p className="text-lg font-bold text-[var(--ink)]">{page.title}</p>
                      <p className="mt-1 text-sm text-[var(--ink-muted)]">{page.purpose}</p>
                      <div className="mt-3 space-y-3">
                        {page.sections.map((section) => (
                          <div key={`${page.slug}-${section.heading}`} className="rounded-lg border border-[var(--line)] bg-white p-3">
                            <p className="text-sm font-semibold text-[var(--ink)]">{section.heading}</p>
                            <p className="mt-1 text-sm text-[var(--ink-muted)]">{section.body}</p>
                            {section.bullets && section.bullets.length > 0 ? (
                              <ul className="mt-2 space-y-1 text-sm text-[var(--ink-muted)]">
                                {section.bullets.map((bullet) => (
                                  <li key={bullet}>{bullet}</li>
                                ))}
                              </ul>
                            ) : null}
                            {section.ctaLabel ? <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-[var(--brand-600)]">{section.ctaLabel}</p> : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </article>

              <article className="rounded-2xl border border-[var(--line)] bg-white p-5">
                <h2 className="text-xl font-bold">Launch Commands</h2>
                <div className="mt-4 grid gap-3">
                  {preview.steps.map((step) => (
                    <div key={step.command} className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3">
                      <p className="text-sm font-semibold text-[var(--ink)]">{step.orderIndex}. {step.displayName}</p>
                      <p className="mt-1 text-xs uppercase tracking-wide text-[var(--ink-muted)]">{step.command}</p>
                    </div>
                  ))}
                </div>
              </article>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}
