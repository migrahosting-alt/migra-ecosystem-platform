"use client";

import { useTranslations } from "next-intl";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { StatusBriefCardProps } from "@/lib/ui-contracts";

const STATE_VARIANT: Record<string, "default" | "warning" | "danger"> = {
  NORMAL: "default",
  CAUTION: "warning",
  READ_ONLY: "danger",
};

const RELEASE_VARIANT: Record<string, "default" | "success" | "warning" | "danger"> = {
  OK: "success",
  PARTIAL: "warning",
  BLOCKED: "warning",
  FAILED: "danger",
};

export function StatusBriefCard({
  autonomyEnabled,
  env,
  state,
  lastRelease,
  drift,
  incidents,
  nextMissions,
  notes,
  actions,
  onDismiss,
}: StatusBriefCardProps) {
  const t = useTranslations("console.statusBrief");

  return (
    <Card className="w-full">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {t("title", { defaultValue: "Status Brief" })}
        </CardTitle>
        <div className="flex items-center gap-2">
          <Badge variant={STATE_VARIANT[state] ?? "default"}>{state}</Badge>
          <Badge variant={autonomyEnabled ? "success" : "secondary"}>
            {autonomyEnabled ? t("autonomyOn", { defaultValue: "Autonomy ON" }) : t("autonomyOff", { defaultValue: "Autonomy OFF" })}
          </Badge>
          <Badge variant="outline">{env}</Badge>
          {onDismiss && (
            <Button variant="ghost" size="icon" onClick={onDismiss} aria-label="Dismiss">
              ✕
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Last Release */}
        {lastRelease && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">{t("lastRelease", { defaultValue: "Last release" })}:</span>
            <Badge variant={RELEASE_VARIANT[lastRelease.status] ?? "default"}>
              {lastRelease.status}
            </Badge>
            {lastRelease.href ? (
              <a href={lastRelease.href} className="font-mono text-xs text-primary hover:underline">
                {lastRelease.runIdShort ?? lastRelease.runId}
              </a>
            ) : (
              <span className="font-mono text-xs">{lastRelease.runIdShort ?? lastRelease.runId}</span>
            )}
            {lastRelease.finishedAtText && (
              <span className="text-muted-foreground text-xs">{lastRelease.finishedAtText}</span>
            )}
          </div>
        )}

        {/* Drift */}
        {drift && drift.status !== "none" && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">{t("drift", { defaultValue: "Drift" })}:</span>
            <Badge variant={drift.status === "detected" ? "danger" : drift.status === "warn" ? "warning" : "secondary"}>
              {drift.status}
            </Badge>
            {drift.text && <span className="text-xs">{drift.text}</span>}
            {drift.href && (
              <a href={drift.href} className="text-xs text-primary hover:underline">
                {t("view", { defaultValue: "view" })}
              </a>
            )}
          </div>
        )}

        {/* Incidents */}
        {incidents && incidents.openCount > 0 && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">{t("incidents", { defaultValue: "Incidents" })}:</span>
            <Badge variant="danger">{incidents.openCount} open</Badge>
            {incidents.topIncident && (
              <span className="text-xs truncate max-w-xs">
                {incidents.topIncident.severity !== "INFO" && (
                  <Badge variant={incidents.topIncident.severity === "CRITICAL" ? "danger" : "warning"} className="mr-1 text-[10px]">
                    {incidents.topIncident.severity}
                  </Badge>
                )}
                {incidents.topIncident.href ? (
                  <a href={incidents.topIncident.href} className="hover:underline">{incidents.topIncident.title}</a>
                ) : (
                  incidents.topIncident.title
                )}
              </span>
            )}
          </div>
        )}

        {/* Next Missions */}
        {nextMissions && nextMissions.length > 0 && (
          <div className="text-sm">
            <span className="text-muted-foreground">{t("nextMissions", { defaultValue: "Next missions" })}:</span>
            <ul className="mt-1 space-y-0.5 pl-2">
              {nextMissions.map((m) => (
                <li key={m.id} className="flex gap-2 text-xs">
                  <span className="font-medium">{m.title}</span>
                  <span className="text-muted-foreground">{m.etaText}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Notes */}
        {notes && notes.length > 0 && (
          <ul className="space-y-0.5 pl-2">
            {notes.map((n, i) => (
              <li key={i} className="text-xs text-muted-foreground">{n}</li>
            ))}
          </ul>
        )}

        {/* Actions */}
        {actions.length > 0 && (
          <>
            <Separator />
            <div className="flex flex-wrap gap-2">
              {actions.map((a) => (
                <Button
                  key={a.id}
                  variant={a.tone === "danger" ? "destructive" : a.tone === "secondary" ? "secondary" : "default"}
                  size="sm"
                  onClick={a.onClick}
                  disabled={a.disabled}
                  title={a.tooltip}
                >
                  {a.label}
                </Button>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
