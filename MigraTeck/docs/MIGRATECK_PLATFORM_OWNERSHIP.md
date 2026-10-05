# MigraTeck Platform Ownership Contract

## Product role

MigraTeck Platform is the parent-company platform layer for the MigraTeck ecosystem.

It owns shared primitives that products and operator tools consume. It is not a generic admin dashboard and it is not the day-to-day operator console.

## Boundary

### MigraTeck Platform owns

- MigraAuth identity contracts and platform authority
- organizations, memberships, ownership and delegated access
- developer access: API keys, service accounts, OAuth clients and scopes
- API governance: environments, rate limits, request visibility and version contracts
- webhook/event contracts, delivery policy, replay and signing
- product registry, plans, price book, entitlements and provisioning contracts
- MigraPay commercial primitives: billing accounts, subscriptions, invoices, payment methods, refunds, credits and settlement state
- usage and metering contracts
- security, compliance and audit governance

### MigraPanel owns

- day-to-day operator workflows
- infrastructure and service operations
- deployments and execution recovery
- support and customer-service operations
- operational suspension/reactivation and service lifecycle controls
- operator queues, incidents and action routing

### Individual products own

- product-specific domain workflow and UX
- product-local configuration that does not redefine shared platform primitives
- consumption of platform identity, billing, API, entitlement and event contracts

### External processors own

External processors such as Stripe process money or provide downstream capability. They do not own the canonical MigraTeck commercial model.

## Commercial rule

MigraPay is authoritative for catalog and prices, billing accounts, subscriptions, invoices, payment methods, payment attempts, refunds and credits, renewal/dunning state, entitlements, usage charging, reconciliation, and audit history.

Products send purchase or usage context to MigraPay. Products do not define authoritative charge amounts or talk directly to processors.

## Navigation domains

- Home: Overview
- Organization: Organizations; Members & Access
- Developers: Developer Overview; API Keys; OAuth Apps; Webhooks & Events; API Usage
- Commerce: Commerce Overview; MigraPay & Billing; Catalog & Entitlements; Usage & Metering
- Trust: Trust Overview; Security; Compliance & Audit

## Implementation rule

A module is not considered functional because a page exists. Each module must identify its authoritative source, actions, mutation boundary, audit behavior, failure/recovery behavior, visibility rules, and live-data readiness.

Do not add child-product modules to the parent navigation merely because they exist. Child products remain reachable through product registry and deep links.
