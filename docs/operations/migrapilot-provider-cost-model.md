# MigraPilot Provider Cost Model

© MigraTeck LLC. Internal operational document.

## Pricing provenance

Pricing is bounded METADATA, never scraped or discovered in the execution path.
Each record: `providerId`, `modelId` (`*` = provider-wide), input/output cost per
million tokens, optional cached-input cost + request minimum, `effectiveFrom`,
`source`, and a `pricingStatus`:

- `verified` — externally confirmed;
- `configured` — owner-set (today: derived from a provider's declared `cost`);
- `estimated` — a best-effort figure;
- `unknown` — no trustworthy price.

Cloud execution under hard budget enforcement requires `verified` or `configured`.
`estimated`/`unknown` **fail closed** (no offer, no cloud). A missing record
returns a truthful `unknown` — never a silent `$0`.

## Preflight estimation

Before an escalation offer or a cloud call, the engine computes
`estimatedInputTokens`, `maximumOutputTokens`, `estimatedCostUsd` (expected), and
`worstCaseCostUsd` (max output + request minimum). **Hard enforcement uses the
worst case** — never an optimistic average. Unknown pricing → `costUnavailable`.

## Consent binds cost

An escalation offer carries the estimate, the worst-case cost, the remaining
request/period budget, and the fact that data leaves the local environment.
Consent binds the provider + model + a worst-case **cost ceiling**; if the
re-estimated cost at approval exceeds the ceiling (e.g. a price change), approval
is refused (`CEILING_EXCEEDED`) and no cloud call runs.

## Configuration

`MIGRAPILOT_CLOUD_{OPENAI,ANTHROPIC}_MODEL` (escalation target model) and the
owner-set provider `cost` declarations back the pricing book. No secrets or
credentials are ever stored in pricing records.

## Prohibited

- No dynamic price scraping in the execution path.
- No credentials/secrets in pricing records.
- No cloud execution on `estimated`/`unknown` pricing under hard enforcement.
