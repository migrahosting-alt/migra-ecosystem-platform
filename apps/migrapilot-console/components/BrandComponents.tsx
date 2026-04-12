"use client";

import { useState } from "react";
import type { BrandCardProps, BrandDetailProps, BrandType } from "../lib/ui-contracts";

const TYPE_COLOR: Record<BrandType, string> = {
  INTERNAL: "var(--accent)",
  CLIENT:   "var(--warn)",
};

const STATUS_COLOR: Record<string, string> = {
  ok:      "var(--ok)",
  fail:    "var(--danger)",
  unknown: "var(--muted)",
  expiringSoon: "var(--warn)",
};

/* ── BrandCard ── */
export function BrandCard({
  slug,
  name,
  type,
  primaryColor = "var(--accent)",
  accentColor,
  domainsCount,
  socialsCount,
  templatesCount,
  lastCheckText,
  status,
  onOpen,
}: BrandCardProps) {
  const accent = accentColor ?? primaryColor;
  const typeColor = TYPE_COLOR[type];

  return (
    <div
      className="panel"
      style={{ padding: 0, overflow: "hidden", borderColor: `${primaryColor}33`, cursor: "pointer" }}
      onClick={onOpen}
    >
      <div style={{ height: 3, background: `linear-gradient(90deg, ${primaryColor}, ${accent})` }} />
      <div style={{ padding: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: `linear-gradient(135deg, ${primaryColor}, ${accent})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, color: "#fff", flexShrink: 0 }}>
              {name.charAt(0)}
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{name}</div>
              <div style={{ fontSize: 10, color: "var(--muted)", fontFamily: "var(--mono)" }}>{slug}</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {status === "needsAttention" && (
              <span style={{ fontSize: 10, color: "var(--warn)", padding: "1px 6px", border: "1px solid var(--warn)", borderRadius: 8 }}>Needs attention</span>
            )}
            <span style={{ fontSize: 10, fontWeight: 700, color: typeColor, padding: "2px 8px", border: `1px solid ${typeColor}44`, borderRadius: 10 }}>
              {type}
            </span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          {domainsCount !== undefined && <span className="small" style={{ color: "var(--muted)" }}>Domains: {domainsCount}</span>}
          {socialsCount !== undefined && <span className="small" style={{ color: "var(--muted)" }}>Socials: {socialsCount}</span>}
          {templatesCount !== undefined && <span className="small" style={{ color: "var(--muted)" }}>Templates: {templatesCount}</span>}
          {lastCheckText && <span className="small" style={{ color: "var(--muted)" }}>Last check: {lastCheckText}</span>}
        </div>
      </div>
    </div>
  );
}

/* ── BrandDetail ── */
const DETAIL_TABS = ["Identity", "Assets", "Domains", "Socials", "Templates", "Launch Kit"] as const;
type DetailTab = typeof DETAIL_TABS[number];

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
  const [tab, setTab] = useState<DetailTab>("Identity");
  const typeColor = TYPE_COLOR[type];

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {/* Brand header */}
      <div className="panel" style={{ padding: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{name}</div>
            <div style={{ fontSize: 11, color: "var(--muted)", fontFamily: "var(--mono)" }}>{slug}</div>
          </div>
          <span style={{ fontSize: 11, fontWeight: 700, color: typeColor, padding: "3px 10px", border: `1px solid ${typeColor}44`, borderRadius: 10 }}>{type}</span>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {DETAIL_TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{ fontSize: 11, padding: "4px 12px", background: tab === t ? "rgba(99,102,241,0.12)" : "transparent", border: `1px solid ${tab === t ? "var(--accent)" : "var(--line)"}`, borderRadius: 8, color: tab === t ? "var(--accent)" : "var(--text)" }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="panel" style={{ padding: 14 }}>
        {tab === "Identity" && (
          <div>
            <div className="small" style={{ color: "var(--muted)", marginBottom: 10 }}>
              Internal brands power the Migra ecosystem. Client brands are isolated and tenant-scoped.
            </div>
            {identity?.descriptionShort && <div style={{ marginBottom: 8 }}><span style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" }}>Short Description</span><div className="small" style={{ marginTop: 4 }}>{identity.descriptionShort}</div></div>}
            {identity?.descriptionLong && <div><span style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" }}>Long Description</span><div className="small" style={{ marginTop: 4 }}>{identity.descriptionLong}</div></div>}
            {!identity?.descriptionShort && !identity?.descriptionLong && <div className="small" style={{ color: "var(--muted)" }}>No description set.</div>}
          </div>
        )}

        {tab === "Assets" && (
          <div style={{ display: "grid", gap: 14 }}>
            {assets?.palette && assets.palette.length > 0 && (
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Color System</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {assets.palette.map((c) => (
                    <div key={c.name} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ width: 24, height: 24, borderRadius: 6, background: c.value, border: "1px solid var(--line)" }} />
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 600 }}>{c.name}</div>
                        <div style={{ fontSize: 9, color: "var(--muted)", fontFamily: "var(--mono)" }}>{c.value}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {assets?.fonts && (
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Typography</div>
                <div className="small">{assets.fonts.heading && `Heading: ${assets.fonts.heading}`}{assets.fonts.body && ` · Body: ${assets.fonts.body}`}</div>
              </div>
            )}
            {!assets?.palette?.length && !assets?.fonts && <div className="small" style={{ color: "var(--muted)" }}>No assets defined.</div>}
          </div>
        )}

        {tab === "Domains" && (
          <div>
            <div className="small" style={{ color: "var(--muted)", marginBottom: 10 }}>Domains are verified daily for DNS resolution and TLS health.</div>
            {actions?.runDomainCheck && (
              <button onClick={actions.runDomainCheck.onClick} disabled={actions.runDomainCheck.disabled} style={{ fontSize: 11, marginBottom: 10 }}>
                Run Domain Check
              </button>
            )}
            {domains && domains.length > 0 ? (
              <div style={{ display: "grid", gap: 6 }}>
                {domains.map((d) => (
                  <div key={d.host} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 10px", border: "1px solid var(--line)", borderRadius: 8 }}>
                    <span style={{ fontFamily: "var(--mono)", fontSize: 12 }}>{d.host}</span>
                    <div style={{ display: "flex", gap: 6 }}>
                      <span style={{ fontSize: 10, color: STATUS_COLOR[d.dnsStatus ?? "unknown"] }}>DNS: {d.dnsStatus ?? "unknown"}</span>
                      <span style={{ fontSize: 10, color: STATUS_COLOR[d.tlsStatus ?? "unknown"] }}>TLS: {d.tlsStatus ?? "unknown"}</span>
                      {d.lastCheckedText && <span style={{ fontSize: 10, color: "var(--muted)" }}>{d.lastCheckedText}</span>}
                    </div>
                  </div>
                ))}
              </div>
            ) : <div className="small" style={{ color: "var(--muted)" }}>No domains configured.</div>}
          </div>
        )}

        {tab === "Socials" && (
          <div>
            <div className="small" style={{ color: "var(--muted)", marginBottom: 10 }}>Store profile links and verify they remain reachable.</div>
            {actions?.verifySocialLinks && (
              <button onClick={actions.verifySocialLinks.onClick} disabled={actions.verifySocialLinks.disabled} style={{ fontSize: 11, marginBottom: 10 }}>
                Verify Social Links
              </button>
            )}
            {socials && socials.length > 0 ? (
              <div style={{ display: "grid", gap: 6 }}>
                {socials.map((s) => (
                  <div key={s.platform} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 10px", border: "1px solid var(--line)", borderRadius: 8 }}>
                    <span style={{ fontWeight: 600, fontSize: 12 }}>{s.platform}</span>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{ fontSize: 12, fontFamily: "var(--mono)" }}>{s.url}</span>
                      <span style={{ fontSize: 10, color: STATUS_COLOR[s.status ?? "unknown"] }}>{s.status ?? "unknown"}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : <div className="small" style={{ color: "var(--muted)" }}>No socials configured.</div>}
          </div>
        )}

        {tab === "Templates" && (
          <div>
            <div className="small" style={{ color: "var(--muted)", marginBottom: 10 }}>Generate banners and post templates from brand assets.</div>
            <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
              {actions?.createBannerTemplate && <button onClick={actions.createBannerTemplate.onClick} disabled={actions.createBannerTemplate.disabled} style={{ fontSize: 11 }}>Create Banner Template</button>}
              {actions?.createPostTemplate && <button onClick={actions.createPostTemplate.onClick} disabled={actions.createPostTemplate.disabled} style={{ fontSize: 11 }}>Create Post Template</button>}
            </div>
            {templates && templates.length > 0 ? (
              <div style={{ display: "grid", gap: 6 }}>
                {templates.map((t) => (
                  <div key={t.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 10px", border: "1px solid var(--line)", borderRadius: 8 }}>
                    <span style={{ fontWeight: 600, fontSize: 12 }}>{t.name}</span>
                    <span style={{ fontSize: 10, padding: "1px 6px", border: "1px solid var(--line)", borderRadius: 6 }}>{t.kind}</span>
                  </div>
                ))}
              </div>
            ) : <div className="small" style={{ color: "var(--muted)" }}>No templates yet.</div>}
          </div>
        )}

        {tab === "Launch Kit" && (
          <div>
            <div className="small" style={{ color: "var(--muted)", marginBottom: 10 }}>A ready-to-share press kit: logos, colors, boilerplate, and links.</div>
            {launchKit?.status === "generated" ? (
              <div style={{ padding: "10px 14px", border: "1px solid var(--ok)", borderRadius: 8, marginBottom: 10 }}>
                <div style={{ fontWeight: 600, color: "var(--ok)", fontSize: 12 }}>Launch Kit generated</div>
                {launchKit.updatedAtText && <div className="small" style={{ color: "var(--muted)" }}>Updated {launchKit.updatedAtText}</div>}
              </div>
            ) : (
              <div style={{ padding: "10px 14px", border: "1px solid var(--line)", borderRadius: 8, marginBottom: 10 }}>
                <div className="small" style={{ color: "var(--muted)" }}>No launch kit generated yet.</div>
              </div>
            )}
            <div style={{ display: "flex", gap: 6 }}>
              {actions?.generateLaunchKit && <button onClick={actions.generateLaunchKit.onClick} disabled={actions.generateLaunchKit.disabled} style={{ fontSize: 11 }}>Generate Launch Kit</button>}
              {launchKit?.previewHref && actions?.previewLaunchKit && <button onClick={actions.previewLaunchKit.onClick} disabled={actions.previewLaunchKit.disabled} style={{ fontSize: 11 }}>Preview</button>}
              {actions?.publishLaunchKit && <button onClick={actions.publishLaunchKit.onClick} disabled={actions.publishLaunchKit.disabled} style={{ fontSize: 11 }}>Publish Internal Page</button>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
