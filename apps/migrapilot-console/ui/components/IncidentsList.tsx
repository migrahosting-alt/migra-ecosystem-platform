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
import type { IncidentsListProps } from "@/lib/ui-contracts";

const SEV_VARIANT: Record<string, "default" | "info" | "warning" | "danger"> = {
  INFO: "info",
  WARN: "warning",
  ERROR: "danger",
  CRITICAL: "danger",
};

const STATUS_VARIANT: Record<string, "default" | "warning" | "success" | "secondary"> = {
  OPEN: "warning",
  ACK: "default",
  RESOLVED: "success",
};

export function IncidentsList({ env, rows, emptyText }: IncidentsListProps) {
  const t = useTranslations("incidents");

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {t("title", { defaultValue: "Incidents" })} — {env}
          </CardTitle>
          <Badge variant="outline">{rows.length}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            {emptyText ?? t("empty", { defaultValue: "No incidents." })}
          </p>
        ) : (
          <div className="space-y-3">
            {rows.map((inc, idx) => (
              <div key={inc.id}>
                {idx > 0 && <Separator className="my-2" />}
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={SEV_VARIANT[inc.severity] ?? "default"} className="text-[10px]">
                      {inc.severity}
                    </Badge>
                    <Badge variant={STATUS_VARIANT[inc.status] ?? "default"} className="text-[10px]">
                      {inc.status}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">{inc.env}</Badge>
                    <span className="font-medium text-sm">{inc.title}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    {inc.firstSeenText && <span>{t("firstSeen", { defaultValue: "First seen" })}: {inc.firstSeenText}</span>}
                    {inc.lastUpdateText && <span>{t("lastUpdate", { defaultValue: "Updated" })}: {inc.lastUpdateText}</span>}
                    {inc.runId && <span className="font-mono">{inc.runId.slice(0, 10)}</span>}
                    {inc.dedupeKey && <span className="font-mono text-[10px]">{inc.dedupeKey}</span>}
                  </div>
                  {inc.evidenceLinks && inc.evidenceLinks.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {inc.evidenceLinks.map((el, i) => (
                        <a key={i} href={el.href} className="text-xs text-primary hover:underline">
                          {el.label}
                        </a>
                      ))}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1">
                    {inc.actions.map((a) => (
                      <Button
                        key={a.id}
                        variant="ghost"
                        size="sm"
                        onClick={a.onClick}
                        disabled={a.disabled}
                        className="h-7 text-xs"
                      >
                        {a.label}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
