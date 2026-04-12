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
import type { AutonomyControlPanelProps } from "@/lib/ui-contracts";

const STATE_VARIANT: Record<string, "default" | "warning" | "danger"> = {
  NORMAL: "default",
  CAUTION: "warning",
  READ_ONLY: "danger",
};

export function AutonomyControlPanel({
  env,
  autonomyEnabled,
  state,
  stateReason,
  onToggleAutonomy,
  onRunTickNow,
  onRequestUnlock,
  missionRows,
}: AutonomyControlPanelProps) {
  const t = useTranslations("autonomy");

  return (
    <div className="space-y-4">
      {/* Control Card */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {t("title", { defaultValue: "Autonomy Control" })} — {env}
            </CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant={STATE_VARIANT[state] ?? "default"}>{state}</Badge>
              <Badge variant={autonomyEnabled ? "success" : "secondary"}>
                {autonomyEnabled ? t("enabled", { defaultValue: "Enabled" }) : t("disabled", { defaultValue: "Disabled" })}
              </Badge>
            </div>
          </div>
          {stateReason && (
            <p className="text-xs text-muted-foreground mt-1">{stateReason}</p>
          )}
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Button
              variant={autonomyEnabled ? "destructive" : "default"}
              size="sm"
              onClick={() => onToggleAutonomy(!autonomyEnabled)}
            >
              {autonomyEnabled
                ? t("disable", { defaultValue: "Disable Autonomy" })
                : t("enable", { defaultValue: "Enable Autonomy" })}
            </Button>
            <Button variant="secondary" size="sm" onClick={onRunTickNow}>
              {t("runTick", { defaultValue: "Run Tick Now" })}
            </Button>
            {state === "READ_ONLY" && onRequestUnlock && (
              <Button variant="outline" size="sm" onClick={onRequestUnlock}>
                {t("requestUnlock", { defaultValue: "Request Unlock" })}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Missions */}
      {missionRows.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {t("missions", { defaultValue: "Missions" })}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {missionRows.map((mission, idx) => (
              <div key={mission.id}>
                {idx > 0 && <Separator className="my-2" />}
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium text-sm">{mission.title}</span>
                      {mission.badges?.map((b, i) => (
                        <Badge
                          key={i}
                          variant={
                            b.tone === "success" ? "success"
                              : b.tone === "warning" ? "warning"
                              : b.tone === "danger" ? "danger"
                              : b.tone === "info" ? "info"
                              : "secondary"
                          }
                          className="text-[10px] px-1"
                          title={b.tooltip}
                        >
                          {b.label}
                        </Badge>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {mission.scheduleText}
                      {mission.nextDueText && ` · next: ${mission.nextDueText}`}
                      {mission.lastRunText && ` · last: ${mission.lastRunText}`}
                      {mission.successRateText && ` · ${mission.successRateText}`}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {mission.actions.map((a) => (
                      <Button
                        key={a.id}
                        variant="ghost"
                        size="sm"
                        onClick={a.onClick}
                        disabled={a.disabled}
                      >
                        {a.label}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
