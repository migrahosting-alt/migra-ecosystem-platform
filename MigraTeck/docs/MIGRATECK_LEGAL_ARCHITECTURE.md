# MigraTeck Legal Architecture

Master legal system for the MigraTeck ecosystem.

## Core principle

MigraTeck is the legal entity.

All products operate under MigraTeck.

That means:

- legal ownership lives with MigraTeck
- products are services offered under MigraTeck
- policies stay centralized, with modular product-specific extensions where needed

## Legal document structure

Recommended root structure:

```text
/legal
  /terms
  /privacy
  /payment
  /acceptable-use
  /security
  /products
    /migrahosting
    /migrabuilder
    /migravoice
    /migramail
    /migracredit
```

## Shared core policies

These documents apply across the ecosystem:

- Terms of Service
- Privacy Policy
- Payment Policy
- Acceptable Use Policy
- Security Policy

### Master Terms of Service

The global terms should define:

- MigraTeck
- services
- user and organization obligations
- service access and license limits
- billing references
- suspension and termination
- data and privacy references
- intellectual property
- limitation of liability
- indemnification
- modification rights
- governing law
- a product addenda clause

Required clause:

> Certain MigraTeck services may be subject to additional product-specific terms, which form part of this Agreement.

### Master Payment Policy

The payment policy should cover:

- subscription billing
- usage-based billing
- one-time fees
- payment authorization
- auto-renewal
- refunds
- failed payments
- cancellation timing
- chargebacks
- taxes
- product billing addenda

### Master Privacy Policy

The privacy policy should define:

- data collected
- how data is used
- how data is shared
- retention rules
- user rights
- security measures
- cross-border transfer posture
- product-specific data disclosures

### Acceptable Use Policy

The AUP should cover:

- illegal activity
- fraud and abuse
- harassment
- spam
- infrastructure misuse
- prohibited hosted content

### Security Policy

The security policy should document:

- baseline security practices
- account security controls
- encryption and access protections
- incident handling and disclosure paths
- shared responsibility boundaries

## Product-specific addenda

Product documents are extensions, not separate legal systems.

They should only introduce terms unique to the product.

### MigraHosting addendum

Should cover:

- billing start timing
- provisioning and overage rules
- infrastructure limitations
- customer responsibility for server security
- prohibited hosting activity

### MigraBuilder addendum

Should cover:

- subscription plan limits
- publishing and bandwidth constraints
- customer content responsibility

### MigraVoice addendum

Should cover:

- call and audio handling
- consent and recording compliance
- telecom and service limitations

### MigraMail addendum

Should cover:

- anti-spam enforcement
- sender reputation controls
- rate and sending limits
- blacklist and suspension consequences

### MigraCredit addendum

Should cover:

- compliance disclaimers
- informational-only positioning
- no guarantee language for legal, financial, or lending outcomes

## Public URL structure

Canonical structure:

- `/legal/terms`
- `/legal/privacy`
- `/legal/payment`
- `/legal/acceptable-use`
- `/legal/security`
- `/legal/migrahosting`
- `/legal/migrabuilder`
- `/legal/migravoice`
- `/legal/migramail`
- `/legal/migracredit`

## UI requirements

Every product should expose the shared legal surface clearly.

### Footer links

At minimum:

- Terms of Service
- Privacy Policy
- Payment Policy
- Acceptable Use

### Signup agreement

Signup should require an agreement control that references:

- Terms of Service
- Payment Policy

### Product notices

Where product-specific legal terms exist, product pages should state that the service is governed by:

- MigraTeck shared policies
- the relevant product addendum

## Versioning

Each legal page should include:

- last updated date
- optional version label
- a clause allowing updates with notice

## Best practices

Do:

- keep shared policies centralized
- use addenda only for true product differences
- keep terminology consistent
- cross-link related policies
- audit policy drift regularly

Do not:

- duplicate full policy sets per product
- let product terms contradict shared terms
- blur product branding with legal ownership
- publish vague or conflicting refund language

## Mental model

MigraTeck is the constitution.

Product addenda are local laws.
