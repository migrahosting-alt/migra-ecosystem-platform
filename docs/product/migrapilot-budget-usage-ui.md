# MigraPilot — Budget & Usage UI

© MigraTeck LLC.

A read-only view (command: "MigraPilot: AI Usage & Budget") over the server's
budget + usage APIs. It never mutates a limit; there is no client limit-increase
control.

## What it shows

- Per-scope budget: `$spent / $limit` with reserved amount; warning at the
  configured threshold, error at the limit.
- Cloud requests + cloud spend (calculated), local requests, and **estimated
  avoided cloud spend** (clearly labeled an estimate).
- Provider breakdown.

## Cost labels

Every figure is labeled **actual**, **calculated**, **estimated**, or **unknown**.
An unknown cost is **never** rendered as `$0.00` — local marginal cost is reported
as `unknown` and only the avoided cloud spend is estimated.

## Warning states

`Budget warning: 80% used`, `Cloud spending disabled`, `Pricing unavailable`,
`Reservation pending`, `Accounting degraded` — surfaced truthfully.

## Server authority

The extension reads `GET /api/ai/providers/budget` and `/usage`; it performs no
pricing/budget math and cannot raise a limit. Budget configuration is server-side
only for this slice.
