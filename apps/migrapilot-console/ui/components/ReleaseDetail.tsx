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
import type { ReleaseDetailProps } from "@/lib/ui-contracts";

const STATUS_VARIANT: Record<string, "default" | "success" | "warning" | "danger"> = {
  OK: "success",
  PARTIAL: "warning",
  BLOCKED: "warning",
  FAILED: "danger",
};

export function ReleaseDetail({
  env,
  runId,
  status,
  summaryLines,
  meta,
  stages,
  reportLinks,
  activityProofLinks,
  actions,
}: ReleaseDetailProps) {
  const t = useTranslations("releases");

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="font-mono text-sm">{runId.slice(0, 16)}</CardTitle>
          <Badge variant={STATUS_VARIANT[status] ?? "default"}>{status}</Badge>
          <Badge variant="outline">{env}</Badge>
        </div>
        {meta && (
          <p className="text-xs text-muted-foreground mt-1">
            {meta.branch && <span>{meta.branch} </span>}
            {meta.commit && <span className="font-mono">{meta.commit.slice(0, 8)} </span>}
            {meta.dirty && <span className="text-warning">(dirty) </span>}
            {meta.startedAtText && <span>{meta.startedAtText}</span>}
            {meta.finishedAtText && <span> → {meta.finishedAtText}</span>}
          </p>
        )}
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Summary */}
        {summaryLines && summaryLines.length > 0 && (
          <ul className="space-y-0.5">
            {summaryLines.map((line, i) => (
              <li key={i} className="text-sm">{line}</li>
            ))}
          </ul>
        )}

        {/* Stages */}
        {stages.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
              {t("stages", { defaultValue: "Stages" })}
            </p>
            <div className="space-y-1">
              {stages.map((stage, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span className={stage.ok ? "text-success" : "text-destructive"}>
                    {stage.ok ? "✓" : "✗"}
                  </span>
                  <span className="flex-1">{stage.name}</span>
                  <span className="text-xs text-muted-foreground">{stage.durationText}</span>
                  {stage.code != null && (
                    <span className="text-xs font-mono text-muted-foreground">exit {stage.code}</span>
                  )}
                  {stage.timedOut && (
                    <Badge variant="warning" className="text-[10px]">timeout</Badge>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Report links */}
        {reportLinks && reportLinks.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <span className="text-xs text-muted-foreground">{t("reports", { defaultValue: "Reports" })}:</span>
            {reportLinks.map((pl, i) => (
              <a key={i} href={pl.href} className="text-xs text-primary hover:underline">
                {pl.label}
              </a>
            ))}
          </div>
        )}

        {/* Activity proof links */}
        {activityProofLinks && activityProofLinks.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <span className="text-xs text-muted-foreground">{t("proofs", { defaultValue: "Proofs" })}:</span>
            {activityProofLinks.map((pl, i) => (
              <a key={i} href={pl.href} className="text-xs text-primary hover:underline">
                {pl.label}
              </a>
            ))}
          </div>
        )}

        {/* Actions */}
        {actions && actions.length > 0 && (
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
