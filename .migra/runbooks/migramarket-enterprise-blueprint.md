# MigraMarket Enterprise Blueprint

**Date**: 2026-03-14  
**Status**: Proposed execution model  
**Audience**: Founder, sales, delivery, platform, operations

## Executive Summary

MigraMarket should be positioned as an enterprise-grade growth operations product for local and service businesses, not as a generic "marketing help" service.

The core offer is:

- Make the client visible on Google
- Turn that visibility into calls, forms, and booked jobs
- Use social media and email to increase repeat business
- Prove results with reporting clients can understand quickly

The current platform already provides important foundation pieces:

- Product registration for `MIGRAMARKET`
- Organization tenancy
- Entitlements
- Billing and Stripe webhook ingestion
- Provisioning dispatch lanes
- Email capability
- Invitation and role flows
- Revenue handoff route for post-sale activation

Relevant implementation surfaces:

- [MigraTeck/src/lib/constants.ts](../../MigraTeck/src/lib/constants.ts)
- [MigraTeck/src/app/api/internal/revenue-provision/route.ts](../../MigraTeck/src/app/api/internal/revenue-provision/route.ts)
- [MigraTeck/src/lib/provisioning/provider.ts](../../MigraTeck/src/lib/provisioning/provider.ts)
- [MigraTeck/README.md](../../MigraTeck/README.md)

## 1. Product Positioning

### Category

MigraMarket is a managed growth system for small and mid-sized businesses that need:

- Google Business Profile visibility
- local SEO
- review generation
- social posting
- email campaigns
- ads management
- lead capture and follow-up

### Core promise

"We help businesses show up on Google, convert attention into leads, and turn leads into revenue through a repeatable growth system."

### Enterprise-grade positioning

Enterprise-grade for MigraMarket means:

- productized delivery
- standardized onboarding
- clear SLAs and scopes
- auditability
- role-based access
- client reporting
- recurring revenue model
- automation where repeatable
- human fulfillment where high-trust or creative work is required

## 2. Revenue Model

MigraMarket should monetize through a mix of setup fees, recurring retainers, ad management, and add-ons.

### Recommended package ladder

#### 1. Google Presence Setup

One-time implementation for businesses that need to "appear on Google."

Includes:

- Google Business Profile optimization
- categories, services, hours, description, photos
- citation baseline setup
- review link creation
- analytics and call/form tracking setup
- local landing page recommendations

Suggested price:

- `$500-$1,500` one-time

#### 2. Local Visibility Retainer

Monthly service for businesses that need consistent Google growth.

Includes:

- Google Business Profile posts
- review request workflow
- citation cleanup/consistency
- keyword and competitor tracking
- monthly reporting

Suggested price:

- `$300-$900/month`

#### 3. Social + Email Retainer

Monthly service for businesses that need customer retention and brand consistency.

Includes:

- monthly content calendar
- post scheduling
- one or two campaign emails per month
- list segmentation
- lead nurture basics

Suggested price:

- `$400-$1,200/month`

#### 4. Paid Acquisition Retainer

Monthly management for Google Ads and/or Meta.

Includes:

- campaign setup
- audience and keyword planning
- landing page alignment
- weekly optimization
- conversion reporting

Suggested price:

- `$500-$1,500/month` plus ad spend

#### 5. Full Growth Engine

Flagship recurring offer.

Includes:

- Google presence
- local SEO
- social media
- email marketing
- lead capture
- ads management
- dashboard and monthly strategy review

Suggested price:

- `$1,200-$3,500+/month`

### Add-ons

- extra locations
- extra social channels
- website rebuild
- landing pages
- CRM migration
- reputation management
- bilingual campaigns
- call tracking
- photography/video coordination

## 3. Target Customer Profiles

Start with businesses that have clear local-intent demand and weak digital operations.

Best first verticals:

- home services
- legal services
- immigration and consulting
- clinics and health-adjacent practices
- restaurants and food brands
- auto services
- beauty and wellness
- local retail

Qualification signals:

- poor Google Business Profile optimization
- weak or inconsistent reviews
- outdated website
- no lead capture or follow-up
- active social accounts with poor consistency
- owner asks for "help appearing on Google"

## 4. Service Delivery Operating Model

MigraMarket should run as a productized service operation with five lanes.

### Lane A: Acquisition

Purpose:

- turn prospects into paying clients

Functions:

- lead capture forms
- intake questionnaire
- opportunity scoring
- proposal generation
- close and billing

### Lane B: Onboarding

Purpose:

- collect all client data and access before fulfillment starts

Functions:

- business profile intake
- access request checklist
- brand asset collection
- location/service inventory
- goal definition
- conversion tracking checklist

### Lane C: Fulfillment

Purpose:

- execute the packaged marketing work consistently

Functions:

- GBP optimization
- local SEO tasks
- content production
- scheduling/publishing
- email campaign deployment
- ad operations
- landing page deployment

### Lane D: Reporting

Purpose:

- show the client outcomes and preserve retention

Functions:

- dashboard
- monthly snapshot
- trend reporting
- ROI narrative
- call and lead summaries

### Lane E: Expansion

Purpose:

- grow revenue per client and reduce churn

Functions:

- cross-sell add-ons
- location expansion
- ads upsell
- website upsell
- seasonal campaign upsell

## 5. Product Architecture

MigraMarket should be structured into modules rather than one undifferentiated service.

### Module 1: Client Workspace

Client-facing portal for:

- status
- deliverables
- approvals
- documents
- invoices/subscription visibility
- reports

This should sit naturally on the existing org and invite model.

### Module 2: Intake and Asset Collection

Data capture for:

- company name
- industry
- locations
- service list
- target cities
- owner/contact details
- Google Business Profile URL
- website URL
- social links
- brand voice
- logo/photos/videos

### Module 3: Google Growth

Core records:

- business profile status
- service areas
- categories
- NAP consistency
- review velocity
- profile posts
- target keywords
- local landing pages

### Module 4: Social Publishing

Core capabilities:

- content calendar
- draft approval
- scheduling
- channel mapping
- post history
- asset reuse

### Module 5: Email Marketing

Core capabilities:

- audience lists
- segmentation
- templates
- campaign scheduling
- automation sequences
- unsubscribe and compliance handling

### Module 6: Lead Operations

Core capabilities:

- forms
- landing pages
- lead inbox
- source attribution
- appointment/call tracking
- pipeline stage

### Module 7: Reporting and Health

Core capabilities:

- traffic
- leads
- calls
- rankings
- reviews
- reach and engagement
- email metrics
- ad metrics
- client health score

### Module 8: Agency Operations

Internal-facing capabilities:

- SOP checklists
- task queues
- SLA timers
- issue tracking
- account owner assignment
- renewal risk flags
- upsell prompts

## 6. Platform Mapping To Existing Codebase

The current platform can already support the early enterprise operating model.

### Already aligned

- `Organization` can represent each client
- `OrgEntitlement` can represent MigraMarket package access
- billing models support recurring revenue visibility
- invite flow supports team access
- provisioning lane already recognizes `MIGRAMARKET`
- internal revenue handoff can activate service on sale

### Immediate use of existing surfaces

Use [MigraTeck/src/app/api/internal/revenue-provision/route.ts](../../MigraTeck/src/app/api/internal/revenue-provision/route.ts) to activate a client after payment or signed agreement.

Recommended handoff payload additions for MigraMarket workflow:

- `campaignTier`
- `serviceBundle`
- `targetMarkets`
- `primaryGoals`
- `googleBusinessProfileUrl`
- `websiteUrl`
- `socialProfiles`
- `adBudgetMonthly`
- `accountManager`
- `launchChecklistVersion`

### Recommended MigraMarket provisioning behavior

The `MIGRAMARKET` provisioning target should create a client workspace and default operating records, not infrastructure-heavy resources.

Provisioning should initialize:

- client workspace
- onboarding checklist
- default campaigns/tasks
- reporting placeholders
- account manager assignment
- client health baseline

## 7. Enterprise Data Model Additions

To make MigraMarket operationally complete, add new models for repeatable service delivery.

### Recommended entities

- `MarketingAccount`
  One per client org; high-level configuration and package metadata

- `MarketingLocation`
  One per physical service location or geography

- `MarketingService`
  Services the client sells

- `OnboardingChecklist`
  Track setup completion and blockers

- `MarketingAsset`
  Logos, photos, videos, documents, ad assets

- `SocialChannelConnection`
  Channel metadata and connection status

- `SocialContentItem`
  Draft, approved, scheduled, published content

- `EmailAudience`
  Client list or segment

- `EmailCampaign`
  Campaign record with schedule and performance metadata

- `LeadCaptureForm`
  Form definitions and destinations

- `LeadRecord`
  Inbound leads with source attribution

- `GoogleBusinessProfileRecord`
  Profile status, categories, review metrics, posting status

- `LocalSeoTarget`
  Keyword and city targeting records

- `ReportingSnapshot`
  Monthly or weekly summarized metrics

- `ClientSuccessHealth`
  Retention and risk indicators

- `ManagedServiceTask`
  Internal fulfillment tasks and SLA state

## 8. Sales Process

Use a standardized enterprise sales motion.

### Stage 1: Discovery

Collect:

- business type
- number of locations
- current Google visibility
- current website
- current marketing channels
- revenue target
- lead bottleneck

### Stage 2: Audit

Produce a short audit:

- Google Business Profile
- reviews
- citations
- website conversion issues
- social consistency
- follow-up gaps

### Stage 3: Offer

Present a package tied to revenue outcomes:

- more calls
- more form submissions
- better Google visibility
- more repeat business

### Stage 4: Close

Capture:

- agreement
- billing
- access checklist
- kickoff date

### Stage 5: Activate

Trigger MigraMarket entitlement and workspace provisioning.

## 9. Fulfillment SOP Standard

Every client should follow the same activation checklist.

### Day 0-3

- create org/workspace
- send invites
- collect intake
- confirm offer and KPI targets
- request platform access

### Day 3-7

- optimize Google Business Profile
- install conversion tracking
- collect and organize assets
- finalize first campaign calendar

### Day 7-14

- publish first posts
- launch first email sequence
- launch or prepare paid campaigns
- create first reporting baseline

### Ongoing monthly cadence

- publish content
- run email campaigns
- update Google profile
- review lead quality
- optimize ads
- deliver monthly report
- propose next upsell or expansion

## 10. Reporting Standard

Clients stay when reporting is simple and tied to money.

### Dashboard should answer

- How many people found the business?
- How many called or submitted a form?
- Which channel produced the lead?
- How is Google visibility changing?
- Are reviews increasing?
- What was done this month?

### Core KPI set

- calls
- form leads
- booked appointments
- cost per lead
- review count and rating
- profile views
- website conversion rate
- email opens/clicks
- social reach/engagement
- ad spend and conversions

## 11. Controls, Governance, and Risk

Enterprise-grade delivery needs controls.

### Required controls

- role-based client access
- internal role separation for fulfillment vs billing
- audit trail for changes
- approval flow for content where needed
- asset retention policy
- unsubscribe compliance for email
- consent-aware lead capture
- change log for major account edits

### Operational risks to manage

- over-customizing each client
- unclear scope
- weak onboarding discipline
- reporting that does not show business outcomes
- poor handoff from sales to fulfillment
- ad spend without conversion tracking

## 12. Phase Plan

### Phase 1: Monetize Immediately

Goal:

- start selling before full software build-out

Deliver:

- package ladder
- onboarding form
- internal checklist
- revenue handoff into MigraTeck
- client portal access

### Phase 2: Core MigraMarket Ops MVP

Goal:

- make fulfillment repeatable inside the platform

Deliver:

- marketing account model
- onboarding checklist UI
- task/SLA management
- simple reporting snapshots
- package-aware provisioning defaults

### Phase 3: Campaign and Publishing Layer

Goal:

- centralize content and channel operations

Deliver:

- social content records
- approval workflow
- email campaign records
- asset library

### Phase 4: Advanced Attribution and Automation

Goal:

- move from service business to scalable growth operating system

Deliver:

- source attribution
- lead routing
- follow-up automation
- health scoring
- upsell prompts

## 13. Immediate Build Recommendation

If the goal is to make money quickly while staying enterprise-grade, build in this order:

1. Productized offers and pricing
2. Onboarding and access collection workflow
3. MigraMarket client workspace
4. Internal task/checklist system
5. Reporting snapshots
6. Content/email/ad operations records

Do not start with a complex all-in-one campaign engine.

Start with:

- strong packaging
- disciplined onboarding
- operational visibility
- credible reporting

That is the shortest path to recurring revenue.

## 14. Next Implementation Items

Recommended next engineering work:

1. Add MigraMarket-specific data models to Prisma
2. Add a MigraMarket workspace under `/app`
3. Extend revenue handoff payload to create marketing accounts
4. Add onboarding checklist and asset collection UI
5. Add reporting snapshot model and dashboard cards
6. Add internal task queue for recurring monthly delivery

## Bottom Line

MigraMarket becomes enterprise-grade when it is treated as a managed growth operating system with:

- clear packages
- recurring billing
- standardized onboarding
- repeatable fulfillment
- measurable reporting
- strong client retention mechanics

The platform already has enough foundation to support Phase 1 immediately and Phase 2 with focused product work.
