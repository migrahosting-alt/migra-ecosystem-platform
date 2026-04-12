import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { StatusBriefCardWithLinks } from "@/ui/components/StatusBriefCardWithLinks";
import { getReleases } from "@/lib/api/ops";
import { getIncidents } from "@/lib/api/ops";
import { getAutonomyConfig, getEnvStates } from "@/lib/api/autonomy";
import type {
  EnvName,
  AutonomyRuntimeState,
  PrimaryAction,
} from "@/lib/ui-contracts";

/* ── Data fetcher ── */
async function fetchBriefData(env: EnvName) {
  const [releasesResult, incidentsResult, autonomyResult, statesResult] = await Promise.allSettled([
    getReleases(env, 1),
    getIncidents(env, "OPEN"),
    getAutonomyConfig(),
    getEnvStates(),
  ]);

  const releasesData = releasesResult.status === "fulfilled" && releasesResult.value.ok
    ? releasesResult.value.data
    : null;

  const incidentsData = incidentsResult.status === "fulfilled" && incidentsResult.value.ok
    ? incidentsResult.value.data
    : null;

  const autonomyData = autonomyResult.status === "fulfilled" && autonomyResult.value.ok
    ? autonomyResult.value.data
    : null;

  const statesData = statesResult.status === "fulfilled" && statesResult.value.ok
    ? statesResult.value.data
    : null;

  return { releasesData, incidentsData, autonomyData, statesData };
}

/* ── Page ── */
export default async function LocalePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  await params; // locale resolved by layout

  const env: EnvName = "prod";

  const t = await getTranslations("console.statusBrief");

  const { releasesData, incidentsData, autonomyData, statesData } =
    await fetchBriefData(env);

  /* Resolve autonomy state */
  const envState = statesData?.states?.[env];
  const state: AutonomyRuntimeState =
    (envState?.state as AutonomyRuntimeState) ?? "NORMAL";

  const autonomyEnabled = autonomyData?.status?.enabled ?? false;

  /* Last release */
  const lastReleaseRaw = releasesData?.releases?.[0];
  const lastRelease = lastReleaseRaw
    ? {
        runId: lastReleaseRaw.runId,
        runIdShort: lastReleaseRaw.runId.slice(0, 10),
        status: (["OK", "FAILED", "PARTIAL", "BLOCKED"].includes(
          lastReleaseRaw.finalStatus ?? ""
        )
          ? lastReleaseRaw.finalStatus
          : lastReleaseRaw.finalStatus?.startsWith("IN_PROGRESS")
          ? "PARTIAL"
          : "FAILED") as "OK" | "FAILED" | "PARTIAL" | "BLOCKED",
        finishedAtText: lastReleaseRaw.finishedAt
          ? new Date(lastReleaseRaw.finishedAt).toLocaleString()
          : lastReleaseRaw.startedAt
          ? new Date(lastReleaseRaw.startedAt).toLocaleString()
          : undefined,
        href: `/releases?env=${env}`,
      }
    : undefined;

  /* Incidents */
  const openIncidents = incidentsData?.incidents ?? [];
  const openCount = openIncidents.length;
  const topIncident = openIncidents[0];
  const incidents = {
    openCount,
    topIncident: topIncident
      ? {
          title: topIncident.title,
          severity: topIncident.severity,
          href: `/incidents?env=${env}`,
        }
      : undefined,
  };

  /* Notes */
  const notes: string[] = [];
  if (state === "CAUTION") notes.push(t("stateNotes.caution"));
  if (state === "READ_ONLY") notes.push(t("stateNotes.readOnly"));
  if (openCount === 0) notes.push(t("empty.allGreen"));

  type LinkAction = Omit<PrimaryAction, "onClick"> & { href: string };
  const actions: LinkAction[] = [
    {
      id: "go-console",
      label: "Open Console",
      tone: "primary",
      href: "/console",
    },
    {
      id: "view-releases",
      label: t("actions.viewReleases"),
      tone: "secondary",
      href: `/releases?env=${env}`,
    },
    ...(openCount > 0
      ? [
          {
            id: "view-incidents",
            label: t("actions.viewIncidents"),
            tone: "secondary" as const,
            href: `/incidents?env=${env}`,
          },
        ]
      : []),
    ...(state === "READ_ONLY"
      ? [
          {
            id: "request-unlock",
            label: t("actions.requestUnlock"),
            tone: "danger" as const,
            href: "/autonomy",
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-6 p-4 max-w-3xl mx-auto">
      <div>
        <h1 className="text-xl font-bold tracking-tight">MigraPilot</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {t("summary", {
            autonomy: autonomyEnabled ? "ON" : "OFF",
            env,
            state,
          })}
        </p>
      </div>

      <Suspense fallback={<div className="text-sm text-muted-foreground">Loading status…</div>}>
        <StatusBriefCardWithLinks
          autonomyEnabled={autonomyEnabled}
          env={env}
          state={state}
          lastRelease={lastRelease}
          incidents={incidents}
          notes={notes}
          actions={actions}
        />
      </Suspense>

      {/* Quick nav */}
      <nav className="flex flex-wrap gap-2 text-sm">
        <a href="/console" className="text-primary hover:underline">→ Console</a>
        <a href={`/releases?env=${env}`} className="text-primary hover:underline">→ Releases</a>
        <a href={`/incidents?env=${env}`} className="text-primary hover:underline">→ Incidents</a>
        <a href="/autonomy" className="text-primary hover:underline">→ Autonomy</a>
        <a href="/brands" className="text-primary hover:underline">→ Brands</a>
      </nav>
    </div>
  );
}
