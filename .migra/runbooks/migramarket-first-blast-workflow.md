# MigraMarket First Blast Workflow

Updated: 2026-03-16

## Production baseline

- Product: `MigraMarket`
- App URL: `https://migrateck.com/app/migramarket`
- Workspace org: `migrahosting-admin`
- Messaging brand: `MigraHosting`
- Messaging from number: `+18775455428`
- Support email: `admin@migrahosting.com`
- Telnyx messaging profile: `MigraMarket-SMS`

## Consent standard

Primary intake form is configured with:

`I agree to receive SMS and MMS marketing messages, updates, and offers from MigraHosting. Reply STOP to opt out and HELP for help.`

Only leads with:

- `phone` present
- `smsConsentStatus = subscribed`
- `smsOptedOutAt = null`

should be considered blast-eligible.

## Audience tag convention

Use flat lowercase tags on leads.

Recommended starter tags:

- `marketing-subscribers`
- `new-inquiries`
- `warm-followup`
- `past-customers`
- `reengagement`

Do not launch broad campaigns without a tag once the list grows.

## First-send checklist

1. Confirm the lead list has explicit consent evidence.
2. Tag the audience segment you want to reach.
3. Open the draft campaign `MigraHosting Intro Offer - Draft`.
4. Replace `{{offer_headline}}` and `{{offer_detail}}` with the actual offer.
5. Verify the `fromNumber` is `+18775455428`.
6. Keep media URLs HTTPS-only if sending MMS.
7. Launch first with a small known-safe audience tag.
8. Review delivery activity before any larger send.

## Current drafts

The production workspace contains:

- `MigraHosting Intro Offer - Draft`
- `MigraHosting Welcome Opt-In - Draft`
- `MigraHosting First Offer Follow-Up - Draft`

Recommended sequence:

1. `MigraHosting Welcome Opt-In - Draft`
2. `MigraHosting First Offer Follow-Up - Draft`
3. `MigraHosting Intro Offer - Draft`

All current starter drafts target:

- `audienceTag = marketing-subscribers`

## Suggested first use

- Send the welcome draft to newly consented subscribers first.
- Wait for early STOP or HELP responses before any broader promotional send.
- Then duplicate the follow-up draft, replace placeholders, and launch a narrow tagged offer.

## Follow-up hardening

- Add `TELNYX_MESSAGING_WEBHOOK_PUBLIC_KEY` to production and enforce signed webhook validation.
- Add approval/review workflow before large campaign launches.
- Add a dedicated marketing number later if the main business line should not carry outbound campaigns long term.
