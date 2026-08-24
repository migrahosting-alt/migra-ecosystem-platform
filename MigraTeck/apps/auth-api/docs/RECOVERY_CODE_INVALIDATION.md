# Operational note — recovery codes issued before `8bac0c5`

**Every recovery code issued before `8bac0c5` is unusable and must never be
represented as a working fallback.**

## What happened

`storeRecoveryCodes` hashed each code **as issued**, separator included —
`hashToken("a1b2c-3d4e5")` — while `consumeRecoveryCode` hashed it with
separators stripped — `hashToken("a1b2c3d4e5")`. Those two values can never be
equal, so no correct verifier can redeem a pre-fix set. This is structural, not
probabilistic: there is no input that makes an old stored hash match.

It hid behind the people it failed. A rejected recovery code is
indistinguishable from a mistyped or already-spent one, so it reads as user
error — and everyone who reaches that screen is already locked out.

## How a stale set is identified

Sets written under the corrected normalization carry `metadata.v = 2`
(`RECOVERY_CODE_VERSION`). **Absence of the marker means pre-fix**, because every
row that already existed has no marker. Unmarked is therefore exactly "written
under the broken normalization", and defaulting an unmarked set to usable would
reintroduce the false assurance this flag exists to end.

`GET /v1/me/security` reports `recovery_codes_stale: true` for those accounts.
Consuming a code preserves the marker, so spending one does not make a good set
start reporting itself unusable.

## Required product behaviour

- **Do not** state or imply that an unmarked set is valid — no counts, no "you
  have recovery codes", no reassurance on a security page.
- Prompt anyone with `recovery_codes_stale: true` to regenerate, on their next
  security-surface visit or sign-in as appropriate.
- Regeneration happens through a fresh TOTP enrolment, which mints a marked set.
  **There is no standalone regenerate endpoint yet** — an account with MFA
  already enabled must disable and re-enrol, which is a poor experience for
  precisely the people affected and should be closed with a dedicated
  regenerate route.

## What was deliberately NOT done

Old rows were **not** deleted. They cannot be redeemed, so they are inert, and
destroying credential rows across every MFA account is a separate, irreversible
operation that should be decided on its own terms rather than as a side effect of
a bug fix.

Nobody was signed out and no MFA enrolment was disabled: the authenticator factor
itself was never affected, only the fallback.
