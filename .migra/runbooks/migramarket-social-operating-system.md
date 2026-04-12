# MigraMarket Social Operating System

## Objective

Build a single MigraMarket publishing lane that can:

- plan, generate, approve, schedule, publish, and report on social content
- use direct API publishing where the platform officially supports it
- fall back to assisted/manual publish where API coverage is limited or account approval is blocked
- keep brand attribution consistent as `Powered by MigraTeck`
- keep creative casting intentionally diverse across Black, white, Asian, Latino, and women-led representation

## Channel Matrix

### API-first channels

- Instagram
  - Route: Instagram Graph / Reels publishing support
  - Use for: reels, image posts, carousels where supported by approved app setup
  - Notes: requires business or creator setup and Meta app review
- Facebook
  - Route: Meta Pages / Reels publishing support
  - Use for: page posts, video posts, reels
  - Notes: best for business account automation
- LinkedIn
  - Route: Posts API
  - Use for: company posts, article posts, image/video posts
  - Notes: good for B2B, trust, recruiting, partnerships
- TikTok
  - Route: Content Posting API / Direct Post or Upload API
  - Use for: short-form vertical video
  - Notes: unreviewed apps are restricted; direct-post content must avoid watermarks and promotional overlays in-video
- YouTube
  - Route: YouTube Data API `videos.insert`
  - Use for: Shorts, long-form explainers, testimonials, tutorials
  - Notes: unverified API projects upload as private by default until audited
- X
  - Route: media upload + post creation flow
  - Use for: text, image, short video, threads, launch announcements
  - Notes: quotas and paid access tiers matter
- Pinterest
  - Route: Pinterest API
  - Use for: standard pins, video pins, product pins, boards
  - Notes: especially strong for search-style evergreen traffic

### Assisted-publish fallback

Use browser-assisted publishing with stored profile access, operator checklist, and proof-of-post capture when:

- app review is still pending
- the account lacks required business permissions
- a format is supported by the platform UI but not by the approved app scope
- a brand or creator account should keep final human review before go-live

## System Design

### Core objects

- `SocialConnection`
  - platform, account type, handle, OAuth status, scopes, expiresAt
- `CreativeBrief`
  - brand, offer, audience, product, format, hook, CTA, diversity requirements
- `ContentAsset`
  - image, video, caption, hashtags, alt text, transcript, language, AI-disclosure flags
- `PublishingTarget`
  - platform, profileId, format, publishMode (`api` or `assisted`)
- `ContentJob`
  - draft, rendering, awaiting_approval, scheduled, published, failed
- `MetricSnapshot`
  - impressions, reach, views, watch time, clicks, saves, shares, leads

### Workflow

1. Create brief.
2. Generate variants for image, reel, caption, and CTA.
3. Validate brand, compliance, and diversity checks.
4. Approve.
5. Schedule by platform.
6. Publish through API or assisted mode.
7. Pull metrics back into MigraMarket reporting.

## Creative Rules

### Brand rules

- Default footer/end-card line: `Powered by MigraTeck`
- Always include a clear product or service CTA
- Always include brand-safe contact or landing page destination
- Every asset must be reusable across at least 2 channels with channel-specific edits

### TikTok exception

Do not burn `Powered by MigraTeck` into TikTok direct-post video assets. Keep TikTok branding in:

- caption
- profile identity
- landing page
- comments or pinned comment when appropriate

This avoids conflict with TikTok's direct-post guidelines against superimposed branding and watermark-like overlays.

### Diversity rules

Every monthly content batch should deliberately mix:

- Black professionals and families
- white professionals and families
- Asian professionals and families
- Latino professionals and families
- women in leadership, technical, creative, and owner roles

Avoid:

- only white-collar white-male imagery
- token single-person swaps
- stereotypes tied to ethnicity or gender
- unrealistic beauty filters or synthetic-looking faces

### AI realism rules

- prefer photorealistic business/lifestyle scenes
- natural skin texture, realistic hands, real-world lighting, clean typography
- subtitles on every short-form video
- show product context: hosting, domains, email, PBX, migrations, support, dashboards
- add synthetic media disclosure metadata where the platform supports or expects it

## Content Mix

### Weekly cadence

- 3 reels or short-form videos
- 3 static graphics or carousel posts
- 2 thought-leadership or trust posts
- 1 testimonial or case-study post
- 1 promo/offer push

### Monthly campaign lanes

- MigraHosting growth
- MigraVoice demos and business phone pain-point content
- MigraMail trust and deliverability
- MigraDrive / infra / enterprise credibility
- migration success stories

## Implementation Order

### Phase 1

- add `SocialConnection`, `CreativeBrief`, `ContentAsset`, and `ContentJob` models to MigraMarket
- add connection setup for Instagram/Facebook, LinkedIn, TikTok, YouTube, X, Pinterest
- add scheduler and approval queue

### Phase 2

- add render pipeline for static graphics, captions, and vertical videos
- add assisted publish mode with operator checklists and post-proof screenshots
- add metrics ingestion

### Phase 3

- add reusable campaign templates
- add per-platform A/B testing
- add monthly diversity and creative-balance audit

## First-launch Standard

Before a platform is considered live, confirm:

- account connected
- scopes approved
- test draft published
- scheduled publish works
- metrics return
- rollback or retry path exists
- brand and diversity checks passed

## Sources

- TikTok Content Posting API: https://developers.tiktok.com/products/content-posting-api
- TikTok direct-post guidelines: https://developers.tiktok.com/doc/content-sharing-guidelines/
- YouTube Data API `videos.insert`: https://developers.google.com/youtube/v3/docs/videos
- YouTube Data API reference: https://developers.google.com/youtube/v3/docs
- LinkedIn Posts API: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-02
- LinkedIn Share on LinkedIn: https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin?context=linkedin%2Fconsumer%2Fcontext
- Pinterest content creation overview: https://developers.pinterest.com/usecase/content/
- Pinterest developer platform overview: https://developers.pinterest.com/
- X API v2 support and posting limits: https://developer.x.com/en/support/twitter-api/v2
- X media upload overview: https://developer.x.com/en/docs/x-api/v1/media/upload-media/overview
- Meta Reels publishing sample apps: https://github.com/fbsamples/reels_publishing_apis
