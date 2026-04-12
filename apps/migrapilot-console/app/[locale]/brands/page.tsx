"use client";

import { useEffect, useState } from "react";
import { BrandCard, BrandDetail } from "@/components/BrandComponents";
import type { BrandType } from "@/lib/ui-contracts";

interface Brand {
  id: string;
  slug: string;
  name: string;
  type: string;
  parentSlug: string | null;
  domainsJson: unknown;
  colorsJson: unknown;
  fontsJson: unknown;
  logosJson: unknown;
  socialJson: unknown;
  templatesJson: unknown;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

type Colors = { primary?: string; accent?: string };
type Social = Record<string, string>;
type Fonts = { heading?: string; body?: string };
type TemplatesMap = Record<string, { name?: string; kind?: string }>;

function getColors(b: Brand): Colors {
  return (b.colorsJson ?? {}) as Colors;
}

function getDomains(b: Brand): string[] {
  if (Array.isArray(b.domainsJson)) return b.domainsJson as string[];
  return [];
}

function getSocial(b: Brand): Social {
  return (b.socialJson ?? {}) as Social;
}

function getFonts(b: Brand): Fonts {
  return (b.fontsJson ?? {}) as Fonts;
}

function getTemplates(b: Brand): Array<{ id: string; name: string; kind: "banner" | "post" }> {
  const tmpl = b.templatesJson;
  if (!tmpl || typeof tmpl !== "object" || Array.isArray(tmpl)) return [];
  const obj = tmpl as TemplatesMap;
  return Object.entries(obj).map(([id, val]) => ({
    id,
    name: val?.name ?? id,
    kind: val?.kind === "banner" ? "banner" as const : "post" as const,
  }));
}

export default function BrandsPage() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [typeFilter, setTypeFilter] = useState<"all" | "INTERNAL" | "CLIENT">("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const qs = typeFilter !== "all" ? `?type=${typeFilter}` : "";
      const res = await fetch(`/api/brands${qs}`, { cache: "no-store" });
      const payload = (await res.json()) as { ok: boolean; data?: { brands: Brand[] }; error?: string };
      if (!payload.ok) { setError(payload.error ?? "Failed"); return; }
      setBrands(payload.data?.brands ?? []);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [typeFilter]);

  const internal = brands.filter((b) => b.type === "INTERNAL");
  const client = brands.filter((b) => b.type === "CLIENT");
  const selectedBrand = selectedSlug ? brands.find((b) => b.slug === selectedSlug) ?? null : null;

  function renderBrandCard(b: Brand) {
    const colors = getColors(b);
    const domains = getDomains(b);
    const social = getSocial(b);
    const templates = getTemplates(b);
    return (
      <BrandCard
        key={b.slug}
        id={b.id}
        slug={b.slug}
        name={b.name}
        type={b.type as BrandType}
        primaryColor={colors.primary}
        accentColor={colors.accent}
        domainsCount={domains.length}
        socialsCount={Object.keys(social).length}
        templatesCount={templates.length}
        status={b.active ? "healthy" : "needsAttention"}
        onOpen={() => setSelectedSlug(selectedSlug === b.slug ? null : b.slug)}
      />
    );
  }

  return (
    <section className="panel" style={{ padding: 16 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ marginTop: 0 }}>Brand Registry</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <label className="small">type:</label>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}>
            <option value="all">all</option>
            <option value="INTERNAL">internal</option>
            <option value="CLIENT">client</option>
          </select>
          <button onClick={() => void load()} disabled={loading}>{loading ? "..." : "Refresh"}</button>
        </div>
      </div>
      <p className="small" style={{ color: "var(--muted)", marginTop: -8 }}>
        Canonical brand definitions for the Migra ecosystem — colors, domains, social links, and templates.
      </p>

      {error ? <div className="small" style={{ color: "var(--danger)", marginBottom: 10 }}>{error}</div> : null}

      {/* Stats bar */}
      {brands.length > 0 && (
        <div style={{ display: "flex", gap: 16, marginBottom: 16, padding: "10px 14px", background: "var(--surface-2, #111)", borderRadius: 8 }}>
          <div className="small"><span style={{ color: "var(--muted)" }}>Total:</span> {brands.length}</div>
          <div className="small"><span style={{ color: "var(--muted)" }}>Internal:</span> {internal.length}</div>
          <div className="small"><span style={{ color: "var(--muted)" }}>Client:</span> {client.length}</div>
          <div className="small"><span style={{ color: "var(--muted)" }}>Active:</span> {brands.filter((b) => b.active).length}</div>
        </div>
      )}

      {/* Brand grid */}
      {brands.length === 0 && !loading ? (
        <div className="small" style={{ color: "var(--muted)", padding: 20, textAlign: "center" }}>
          No brands found. Brands are seeded automatically on pilot-api startup.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {typeFilter === "all" && internal.length > 0 && (
            <>
              <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, paddingTop: 4 }}>Internal Brands</div>
              {internal.map((b) => renderBrandCard(b))}
            </>
          )}
          {typeFilter === "all" && client.length > 0 && (
            <>
              <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, paddingTop: 8 }}>Client Brands</div>
              {client.map((b) => renderBrandCard(b))}
            </>
          )}
          {typeFilter !== "all" && brands.map((b) => renderBrandCard(b))}
        </div>
      )}

      {/* Brand Detail Panel */}
      {selectedBrand && (() => {
        const colors = getColors(selectedBrand);
        const domains = getDomains(selectedBrand);
        const social = getSocial(selectedBrand);
        const fonts = getFonts(selectedBrand);
        const templates = getTemplates(selectedBrand);
        const palette = Object.entries(colors).map(([name, value]) => ({ name, value: String(value) }));
        return (
          <div style={{ marginTop: 16 }}>
            <BrandDetail
              id={selectedBrand.id}
              slug={selectedBrand.slug}
              name={selectedBrand.name}
              type={selectedBrand.type as BrandType}
              assets={{ palette, fonts: { heading: fonts.heading, body: fonts.body } }}
              domains={domains.map((host) => ({ host }))}
              socials={Object.entries(social).map(([platform, url]) => ({ platform, url }))}
              templates={templates}
              actions={{
                runDomainCheck: {
                  id: "runDomainCheck",
                  label: "Run Domain Check",
                  onClick: () => { /* stub */ },
                },
                generateLaunchKit: {
                  id: "generateLaunchKit",
                  label: "Generate Launch Kit",
                  onClick: () => { /* stub */ },
                },
              }}
            />
          </div>
        );
      })()}
    </section>
  );
}
