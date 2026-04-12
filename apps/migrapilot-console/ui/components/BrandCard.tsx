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
import type { BrandCardProps } from "@/lib/ui-contracts";

export function BrandCard({
  id: _id,
  slug,
  name,
  type,
  primaryColor,
  accentColor,
  domainsCount,
  socialsCount,
  templatesCount,
  lastCheckText,
  status,
  onOpen,
}: BrandCardProps) {
  const t = useTranslations("brands");

  return (
    <Card
      className={`cursor-pointer transition-colors hover:border-primary/50 ${
        status === "needsAttention" ? "border-warning/50" : ""
      }`}
      onClick={onOpen}
    >
      <CardHeader className="pb-1">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {/* Color swatches */}
            {(primaryColor || accentColor) && (
              <div className="flex gap-1 shrink-0">
                {primaryColor && (
                  <span
                    className="h-4 w-4 rounded-full border border-border"
                    style={{ background: primaryColor }}
                    title={primaryColor}
                  />
                )}
                {accentColor && (
                  <span
                    className="h-4 w-4 rounded-full border border-border"
                    style={{ background: accentColor }}
                    title={accentColor}
                  />
                )}
              </div>
            )}
            <CardTitle className="text-sm font-semibold truncate">{name}</CardTitle>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Badge variant={type === "INTERNAL" ? "secondary" : "default"} className="text-[10px]">
              {type}
            </Badge>
            {status === "needsAttention" && (
              <Badge variant="warning" className="text-[10px]">
                {t("attention", { defaultValue: "!" })}
              </Badge>
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground font-mono">{slug}</p>
      </CardHeader>

      <CardContent>
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          {domainsCount !== undefined && (
            <span>{domainsCount} {t("domains", { defaultValue: "domains" })}</span>
          )}
          {socialsCount !== undefined && (
            <span>{socialsCount} {t("socials", { defaultValue: "socials" })}</span>
          )}
          {templatesCount !== undefined && (
            <span>{templatesCount} {t("templates", { defaultValue: "templates" })}</span>
          )}
          {lastCheckText && (
            <span>{t("lastCheck", { defaultValue: "last check" })}: {lastCheckText}</span>
          )}
        </div>
        <div className="mt-2 flex justify-end">
          <Button variant="ghost" size="sm" className="text-xs" onClick={(e) => { e.stopPropagation(); onOpen(); }}>
            {t("open", { defaultValue: "Open" })} →
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
