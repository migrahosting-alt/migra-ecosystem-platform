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
import type { ReasoningCardProps } from "@/lib/ui-contracts";

const STEP_VARIANT: Record<string, "default" | "success" | "warning" | "danger" | "secondary" | "info"> = {
  pending: "secondary",
  running: "info",
  ok: "success",
  failed: "danger",
  blocked: "warning",
};

const TIER_VARIANT: Record<string, "default" | "warning" | "danger"> = {
  T0: "default",
  T1: "warning",
  T2: "danger",
};

export function ReasoningCard({
  intentLabel,
  confidencePct,
  mode,
  planLine,
  steps,
  proofsRequired,
  approvalNotice,
  runId,
  proofLinks,
  actions,
}: ReasoningCardProps) {
  const t = useTranslations("reasoning");

  return (
    <Card className="w-full">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-sm font-semibold">{intentLabel}</CardTitle>
          {confidencePct !== undefined && (
            <Badge variant={confidencePct >= 80 ? "success" : confidencePct >= 50 ? "warning" : "danger"}>
              {confidencePct}% {t("confidence", { defaultValue: "confidence" })}
            </Badge>
          )}
          <Badge variant="outline">{mode}</Badge>
          {runId && <span className="font-mono text-xs text-muted-foreground">{runId}</span>}
        </div>
        {planLine && (
          <p className="text-xs text-muted-foreground mt-1">{planLine}</p>
        )}
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Steps */}
        {steps.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {t("steps", { defaultValue: "Steps" })}
            </p>
            <ol className="space-y-1.5">
              {steps.map((step, idx) => (
                <li key={step.id} className="flex items-start gap-2 text-sm">
                  <span className="text-muted-foreground text-xs mt-0.5">{idx + 1}.</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium">{step.name}</span>
                      <Badge variant={TIER_VARIANT[step.tier] ?? "default"} className="text-[10px] px-1">
                        {step.tier}
                      </Badge>
                      {step.status && (
                        <Badge variant={STEP_VARIANT[step.status] ?? "default"} className="text-[10px] px-1">
                          {step.status}
                        </Badge>
                      )}
                    </div>
                    {step.detail && (
                      <p className="text-xs text-muted-foreground mt-0.5">{step.detail}</p>
                    )}
                    {step.expectedProofs && step.expectedProofs.length > 0 && (
                      <p className="text-[10px] text-muted-foreground">
                        {t("proofs", { defaultValue: "Proofs" })}: {step.expectedProofs.join(", ")}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* Proofs required */}
        {proofsRequired && proofsRequired.length > 0 && (
          <div className="text-xs">
            <span className="font-medium text-muted-foreground">
              {t("proofsRequired", { defaultValue: "Proofs required" })}:{" "}
            </span>
            {proofsRequired.join(", ")}
          </div>
        )}

        {/* Approval notice */}
        {approvalNotice && (
          <div className="rounded border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
            {approvalNotice}
          </div>
        )}

        {/* Proof links */}
        {proofLinks && proofLinks.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {proofLinks.map((pl, i) => (
              <a
                key={i}
                href={pl.href}
                className="text-xs text-primary hover:underline"
              >
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
                  variant="secondary"
                  size="sm"
                  onClick={a.onClick}
                  disabled={a.disabled}
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
