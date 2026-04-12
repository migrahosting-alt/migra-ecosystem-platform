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
import type { ApprovalCardProps } from "@/lib/ui-contracts";

const TIER_VARIANT: Record<string, "default" | "warning" | "danger"> = {
  T0: "default",
  T1: "warning",
  T2: "danger",
};

const STATUS_VARIANT: Record<string, "default" | "warning" | "success" | "danger" | "secondary" | "info"> = {
  PENDING:   "warning",
  APPROVED:  "success",
  EXECUTING: "info",
  REJECTED:  "danger",
  EXPIRED:   "secondary",
  EXECUTED:  "default",
};

export function ApprovalCard({
  id,
  env,
  tier,
  status,
  title,
  why,
  impactSummary,
  expiresAtText,
  verificationPlanSummary,
  rollbackPlanSummary,
  payloadPreview,
  executionSummary,
  onApproveOnce,
  onApproveAlways,
  onReject,
  warningText,
}: ApprovalCardProps) {
  const t = useTranslations("approvals");

  const isPending = status === "PENDING";
  const isExecuting = status === "EXECUTING";

  return (
    <Card className={isPending ? "border-warning/50" : isExecuting ? "border-sky-500/40" : undefined}>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-sm font-semibold">{title}</CardTitle>
          <Badge variant={TIER_VARIANT[tier] ?? "default"}>{tier}</Badge>
          {isExecuting ? (
            <Badge variant="info" className="gap-1.5">
              <span className="inline-block h-1.5 w-1.5 rounded-full animate-pulse bg-sky-400" />
              {status}
            </Badge>
          ) : (
            <Badge variant={STATUS_VARIANT[status] ?? "default"}>{status}</Badge>
          )}
          <Badge variant="outline">{env}</Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-1 font-mono">{id.slice(0, 16)}…</p>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Why */}
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {t("why", { defaultValue: "Reason" })}
          </p>
          <p className="text-sm mt-0.5">{why}</p>
        </div>

        {/* Impact */}
        {impactSummary && (
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {t("impact", { defaultValue: "Impact" })}
            </p>
            <p className="text-sm mt-0.5">{impactSummary}</p>
          </div>
        )}

        {/* Verification plan */}
        {verificationPlanSummary && (
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {t("verifyPlan", { defaultValue: "Verification Plan" })}
            </p>
            <p className="text-sm mt-0.5 text-muted-foreground">{verificationPlanSummary}</p>
          </div>
        )}

        {/* Rollback plan */}
        {rollbackPlanSummary && (
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {t("rollbackPlan", { defaultValue: "Rollback Plan" })}
            </p>
            <p className="text-sm mt-0.5 text-muted-foreground">{rollbackPlanSummary}</p>
          </div>
        )}

        {/* Payload preview */}
        {payloadPreview && (
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {t("payload", { defaultValue: "Payload" })}
            </p>
            <pre className="mt-0.5 overflow-x-auto rounded bg-muted p-2 text-[10px] font-mono max-h-32">
              {payloadPreview}
            </pre>
          </div>
        )}

        {/* Last execution summary */}
        {executionSummary && (
          <p className="text-xs text-muted-foreground">{executionSummary}</p>
        )}

        {/* Expiry + warning */}
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{t("expires", { defaultValue: "Expires" })}: {expiresAtText}</span>
        </div>
        {warningText && (
          <div className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {warningText}
          </div>
        )}

        {/* Executing hint */}
        {isExecuting && (
          <div className="rounded border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs text-sky-400">
            {t("executingHint", { defaultValue: "This request is currently executing. Actions are temporarily disabled." })}
          </div>
        )}

        {/* Actions */}
        {(isPending || isExecuting) && (
          <>
            <Separator />
            <div className="flex flex-wrap gap-2">
              <Button variant="default" size="sm" disabled={isExecuting} onClick={onApproveOnce}>
                {t("approveOnce", { defaultValue: "Approve Once" })}
              </Button>
              <Button variant="secondary" size="sm" disabled={isExecuting} onClick={onApproveAlways}>
                {t("approveAlways", { defaultValue: "Approve Always" })}
              </Button>
              <Button variant="destructive" size="sm" disabled={isExecuting} onClick={onReject}>
                {t("reject", { defaultValue: "Reject" })}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
