import "server-only";
import { z } from "zod";
import { apiGet, apiPost } from "./client";

/* ── Schemas ── */

export const BrandSchema = z.object({
  id:           z.string(),
  slug:         z.string(),
  name:         z.string(),
  type:         z.enum(["INTERNAL", "CLIENT"]),
  parentSlug:   z.string().nullable().optional(),
  domainsJson:  z.unknown(),
  colorsJson:   z.unknown(),
  fontsJson:    z.unknown(),
  logosJson:    z.unknown(),
  socialJson:   z.unknown(),
  templatesJson: z.unknown(),
  active:       z.boolean(),
  createdAt:    z.string(),
  updatedAt:    z.string(),
});
export type Brand = z.infer<typeof BrandSchema>;

/* ── API wrappers ── */

export async function listBrands(type?: "INTERNAL" | "CLIENT") {
  const q = type ? `?type=${type}` : "";
  return apiGet<{ brands: Brand[] }>(`/api/brands${q}`);
}

export async function getBrand(slug: string) {
  return apiGet<{ brand: Brand }>(`/api/brands/${encodeURIComponent(slug)}`);
}

export async function upsertBrand(data: Partial<Brand> & { slug: string; name: string }) {
  return apiPost<{ brand: Brand }>("/api/brands", data);
}

export async function updateBrand(slug: string, data: Partial<Brand>) {
  const base = (process.env.PILOT_API_URL ?? "http://localhost:3399").replace(/\/$/, "");
  const res = await fetch(`${base}/api/brands/${encodeURIComponent(slug)}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      ...(process.env.OPS_API_TOKEN ? { "x-ops-api-token": process.env.OPS_API_TOKEN } : {}),
    },
    body: JSON.stringify(data),
    cache: "no-store",
  });
  const json = await res.json();
  return json as { ok: boolean; data?: { brand: Brand }; error?: string };
}
