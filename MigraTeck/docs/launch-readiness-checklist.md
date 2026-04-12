# Launch Readiness Checklist

This checklist is intended for the final pre-launch review of the MigraTeck platform surface.

## Design QA

- [x] Homepage narrative order is aligned to the platform story: hero, architecture, products, developer systems, distribution, security, final CTA.
- [x] Core route surfaces use a shared container width, border radius, spacing scale, and button hierarchy.
- [x] Product cards, home narrative cards, and route-level intro blocks use a consistent enterprise visual system.
- [ ] Final stakeholder visual sign-off completed on desktop and mobile breakpoints.

## Content QA

- [x] Homepage and route copy reflects a platform-first posture rather than marketing-site language.
- [x] Product naming follows the canonical MigraTeck ecosystem registry.
- [x] Product URLs and access slots derive from the canonical registry.
- [x] No pricing language appears on product or download surfaces.
- [ ] Final editorial review completed for tone, grammar, and domain-specific accuracy.

## Product Logo and Asset QA

- [x] Normalized product logos are served from `apps/web/public/brands/products`.
- [x] Public filenames avoid spaces and inconsistent casing.
- [x] Logo renderings preserve aspect ratio and include alt text.
- [x] MigraInvoice is included in the registry and grouped ecosystem views.
- [ ] Final visual review completed against source brand assets.

## Metadata and Search QA

- [x] Primary routes provide route-level metadata.
- [x] Canonical URLs are defined for primary route surfaces.
- [x] Open Graph and Twitter card metadata are configured.
- [x] JSON-LD is present for organization, website, product collection, and product detail contexts.
- [x] `robots.txt`, `sitemap.xml`, `manifest.webmanifest`, and `security.txt` routes are present.
- [x] Staging metadata now renders against `https://staging.migrateck.com` with `noindex,nofollow`.
- [ ] Search Console / Bing Webmaster validation completed after deployment.

## Accessibility QA

- [x] Heading hierarchy is structured on the audited pages.
- [x] Focus-visible states are present on navigation and primary interactive controls.
- [x] Images and logos render with descriptive alt text.
- [x] Landmark regions are present through header, main, and footer structure.
- [x] CTA rows stack cleanly on mobile.
- [ ] Dedicated keyboard-only walkthrough completed after deployment.
- [ ] Screen reader spot-check completed on homepage, products, and developers.

## Responsive QA

- [x] Homepage desktop layout holds across long-form section flow.
- [x] Homepage mobile layout stacks sections and CTAs without overflow.
- [x] Products page grid remains legible on desktop.
- [x] Developers page content hierarchy remains readable on desktop.
- [x] Downloads page cards remain intact and readable on desktop.
- [ ] Additional tablet and wide-desktop review completed in-browser.

## Performance QA

- [x] Shared home sections remain server-rendered.
- [x] Images use `next/image` where appropriate across core product/home surfaces.
- [x] Homepage internal route prefetching was reduced to avoid unnecessary background route churn.
- [x] Unused heavy UI libraries were not introduced.
- [ ] Lighthouse score verification completed successfully in the target deployment environment.
  Current blocker: the available Lighthouse runners still return `FAILED_DOCUMENT_REQUEST (net::ERR_ABORTED)` even against the real staging HTTPS deployment.

## Security QA

- [x] CSP, HSTS, X-Frame-Options, X-Content-Type-Options, and related security headers are applied through middleware.
- [x] CSP was corrected to follow Next.js nonce propagation requirements for dynamic rendering.
- [x] Request/response CSP header propagation is present for nonce-aware rendering.
- [x] External links use `rel=\"noreferrer noopener\"` where appropriate.
- [x] No client-exposed secrets were introduced in the audited app surface.
- [x] Download surfaces avoid fake checksum and fake artifact claims.
- [ ] Production CSP should be validated on the live HTTPS domain after deployment.

## Deployment QA

- [x] `pnpm lint` passes.
- [x] `pnpm typecheck` passes.
- [x] `pnpm build` passes.
- [x] `pnpm --filter @migrateck/web build` passes.
- [x] Staging deployment is active at `https://staging.migrateck.com`.
- [x] Current live `migrateck.com` runtime remains untouched during staging validation.
- [x] Staging-first release policy is in effect for major MigraTeck platform changes.
- [ ] CI secret scanning and dependency scanning should be verified on the remote GitHub workflow runs.
- [ ] Branch protection and required review policies should be enforced in the GitHub repository settings.
- [ ] Post-deploy smoke test completed on the live domain and any edge/CDN layer.
