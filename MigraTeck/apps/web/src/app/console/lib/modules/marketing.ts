import { panelQuery, isPanelDbConfigured } from "../db";

export type GbpPost = { id: string; title: string | null; status: string; createdAt: string | null; tenantName: string | null };
export type GbpReview = { id: string; rating: number | null; comment: string | null; createdAt: string | null; tenantName: string | null };
export type SeoAudit = { id: string; score: number | null; status: string; runAt: string | null; targetUrl: string | null };

export const loadMarketingData = async () => {
  if (!isPanelDbConfigured()) return { posts: [], reviews: [], audits: [] };
  const [posts, reviews, audits] = await Promise.all([
    panelQuery<{ id: string; title: string | null; status: string; createdat: string | null; tenantname: string | null }>(
      `SELECT g.id, g.title, COALESCE(g.status, 'draft') AS status, g.createdat::text AS createdat, t.name AS tenantname
         FROM gbp_posts g
         LEFT JOIN tenants t ON t.id = g.tenantid
        ORDER BY g.createdat DESC NULLS LAST
        LIMIT 50`,
    ),
    panelQuery<{ id: string; rating: string | null; comment: string | null; createdat: string | null; tenantname: string | null }>(
      `SELECT r.id, r.starrating::text AS rating, r.comment, r.createdat::text AS createdat, t.name AS tenantname
         FROM gbp_reviews r
         LEFT JOIN tenants t ON t.id = r.tenantid
        ORDER BY r.createdat DESC NULLS LAST
        LIMIT 30`,
    ),
    panelQuery<{ id: string; score: string | null; status: string; runat: string | null; targeturl: string | null }>(
      `SELECT id, "healthScore"::text AS score, COALESCE(status, 'completed') AS status, "createdAt"::text AS runat, "targetUrl" AS targeturl
         FROM seo_audit_runs
        ORDER BY "createdAt" DESC NULLS LAST
        LIMIT 30`,
    ),
  ]);
  return {
    posts: posts.map((p) => ({ id: p.id, title: p.title, status: p.status, createdAt: p.createdat, tenantName: p.tenantname })),
    reviews: reviews.map((r) => ({ id: r.id, rating: r.rating == null ? null : Number(r.rating), comment: r.comment, createdAt: r.createdat, tenantName: r.tenantname })),
    audits: audits.map((a) => ({ id: a.id, score: a.score == null ? null : Number(a.score), status: a.status, runAt: a.runat, targetUrl: a.targeturl })),
  };
};
