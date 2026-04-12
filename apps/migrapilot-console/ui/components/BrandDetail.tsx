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
import type { BrandDetailProps } from "@/lib/ui-contracts";

const DNS_VARIANT: Record<string, "success" | "danger" | "secondary"> = {
  ok: "success",
  fail: "danger",
  unknown: "secondary",
};

const TLS_VARIANT: Record<string, "success" | "warning" | "danger" | "secondary"> = {
  ok: "success",
  expiringSoon: "warning",
  fail: "danger",
  unknown: "secondary",
};

export function BrandDetail({
  slug,
  name,
  type,
  identity,
  assets,
  domains,
  socials,
  templates,
  launchKit,
  actions,
}: BrandDetailProps) {
  const t = useTranslations("brands");

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base font-semibold">{name}</CardTitle>
          <Badge variant={type === "INTERNAL" ? "secondary" : "default"}>{type}</Badge>
          <span className="font-mono text-xs text-muted-foreground">{slug}</span>
        </div>
        {identity?.descriptionShort && (
          <p className="text-sm text-muted-foreground mt-1">{identity.descriptionShort}</p>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Identity */}
        {identity?.descriptionLong && (
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
              {t("description", { defaultValue: "Description" })}
            </p>
            <p className="text-sm">{identity.descriptionLong}</p>
          </div>
        )}

        {/* Assets */}
        {assets && (
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
              {t("assets", { defaultValue: "Assets" })}
            </p>
            <div className="flex flex-wrap gap-3 text-sm">
              {assets.fonts?.heading && (
                <span>{t("headingFont", { defaultValue: "Heading" })}: <span className="font-medium">{assets.fonts.heading}</span></span>
              )}
              {assets.fonts?.body && (
                <span>{t("bodyFont", { defaultValue: "Body" })}: <span className="font-medium">{assets.fonts.body}</span></span>
              )}
            </div>
            {assets.palette && assets.palette.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {assets.palette.map((color) => (
                  <div key={color.name} className="flex items-center gap-1.5 text-xs">
                    <span
                      className="h-4 w-4 rounded border border-border"
                      style={{ background: color.value }}
                    />
                    <span className="text-muted-foreground">{color.name}</span>
                    <span className="font-mono">{color.value}</span>
                  </div>
                ))}
              </div>
            )}
            {assets.logoUrls && assets.logoUrls.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {assets.logoUrls.map((url, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={i} src={url} alt={`${name} logo ${i + 1}`} className="h-8 max-w-24 object-contain rounded border border-border p-0.5 bg-muted" />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Domains */}
        {domains && domains.length > 0 && (
          <div>
            <Separator className="mb-3" />
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {t("domains", { defaultValue: "Domains" })}
              </p>
              {actions?.runDomainCheck && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[10px]"
                  onClick={actions.runDomainCheck.onClick}
                  disabled={actions.runDomainCheck.disabled}
                >
                  {actions.runDomainCheck.label}
                </Button>
              )}
            </div>
            <div className="space-y-1">
              {domains.map((d) => (
                <div key={d.host} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-mono text-xs">{d.host}</span>
                  {d.dnsStatus && (
                    <Badge variant={DNS_VARIANT[d.dnsStatus] ?? "secondary"} className="text-[10px]">
                      DNS:{d.dnsStatus}
                    </Badge>
                  )}
                  {d.tlsStatus && (
                    <Badge variant={TLS_VARIANT[d.tlsStatus] ?? "secondary"} className="text-[10px]">
                      TLS:{d.tlsStatus}
                    </Badge>
                  )}
                  {d.lastCheckedText && (
                    <span className="text-xs text-muted-foreground">{d.lastCheckedText}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Socials */}
        {socials && socials.length > 0 && (
          <div>
            <Separator className="mb-3" />
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {t("socials", { defaultValue: "Socials" })}
              </p>
              {actions?.verifySocialLinks && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[10px]"
                  onClick={actions.verifySocialLinks.onClick}
                  disabled={actions.verifySocialLinks.disabled}
                >
                  {actions.verifySocialLinks.label}
                </Button>
              )}
            </div>
            <div className="space-y-1">
              {socials.map((s, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground w-16 text-xs">{s.platform}</span>
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline truncate max-w-xs">
                    {s.url}
                  </a>
                  {s.status && (
                    <Badge variant={s.status === "ok" ? "success" : s.status === "fail" ? "danger" : "secondary"} className="text-[10px]">
                      {s.status}
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Templates */}
        {templates && templates.length > 0 && (
          <div>
            <Separator className="mb-3" />
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {t("templates", { defaultValue: "Templates" })}
              </p>
              <div className="flex gap-1">
                {actions?.createBannerTemplate && (
                  <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={actions.createBannerTemplate.onClick}>
                    {actions.createBannerTemplate.label}
                  </Button>
                )}
                {actions?.createPostTemplate && (
                  <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={actions.createPostTemplate.onClick}>
                    {actions.createPostTemplate.label}
                  </Button>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {templates.map((tmpl) => (
                <Badge key={tmpl.id} variant="secondary" className="text-[10px]">
                  {tmpl.name} ({tmpl.kind})
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Launch Kit */}
        {launchKit && (
          <div>
            <Separator className="mb-3" />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {t("launchKit", { defaultValue: "Launch Kit" })}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  <Badge variant={launchKit.status === "generated" ? "success" : "secondary"} className="text-[10px]">
                    {launchKit.status}
                  </Badge>
                  {launchKit.updatedAtText && (
                    <span className="text-xs text-muted-foreground">{launchKit.updatedAtText}</span>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                {actions?.generateLaunchKit && (
                  <Button variant="default" size="sm" className="text-xs h-7" onClick={actions.generateLaunchKit.onClick} disabled={actions.generateLaunchKit.disabled}>
                    {actions.generateLaunchKit.label}
                  </Button>
                )}
                {actions?.previewLaunchKit && launchKit.previewHref && (
                  <Button variant="secondary" size="sm" className="text-xs h-7" onClick={actions.previewLaunchKit.onClick}>
                    {actions.previewLaunchKit.label}
                  </Button>
                )}
                {actions?.publishLaunchKit && launchKit.status === "generated" && (
                  <Button variant="outline" size="sm" className="text-xs h-7" onClick={actions.publishLaunchKit.onClick} disabled={actions.publishLaunchKit.disabled}>
                    {actions.publishLaunchKit.label}
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
