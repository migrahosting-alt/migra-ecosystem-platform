export const ENGINEERING_HANDOFF = `Good news on the acceptance, and I found one real bug while checking the two open items.

## I checked both remaining items — one is fine, one wasn't

**Lower-hand cleanup on leave: already correct. Not a defect.** I traced it end to end before touching anything, and three independent mechanisms cover it:
- the roster query filters \`leftAt: null\`, so a departed participant never comes back in a reload
- \`onParticipantLeft\` removes them from the client list outright
- rejoin resets \`isHandRaised: false\` (live.service.ts:497)

So that one is purely an acceptance gap — your taps missed it, the code is right. Nothing for me to fix, and I'm glad I checked rather than "fixing" a non-bug.

**Listener leave/count: there was a real bug.** Join increments \`listenerCount\` only for non-hosts (\`if (session.hostUserId !== userId)\`), but leave decremented **unconditionally** — and \`POST /:id/leave\` carries no host guard. A host leaving through that endpoint removed a listener slot that was never added; with nobody else in the room it goes to **−1**. That number feeds straight into the authoritative ended-session snapshot you just built, so it would have shown up as exactly the kind of summary drift you were fixing.

Fixed: both sides now ask the same question (\`countsAsListener\`), and the floor is enforced by the database (\`updateMany\` with \`listenerCount: { gt: 0 }\`) rather than a read-then-write that two simultaneous leavers could race past.

One honest note: this broke an existing test, because the Prisma double had no \`updateMany\`. I extended the double to model the guard faithfully rather than loosening the test.

## A deployment landmine that's already defused

\`ValidationPipe\` runs with \`forbidNonWhitelisted: true\`, so the deployed backend **400s the entire request** on an unknown field. When I added \`hasVideo\` I put it on the wire unconditionally — which would have broken starting *any* live, audio included, not just video.

Someone (you or the other session) already changed it to \`...(hasVideo ? { hasVideo: true } : {})\`. That's the correct fix and it's why you saw video blocked but audio working. I've pinned it with a test and a negative control, because this one silently breaks the whole feature if it ever regresses.

The practical upshot: **the app build is shippable now.** Audio Live is wire-compatible with production as-is; video lights up on its own once the backend is deployed. No ordering trap.

## Verification

- Backend: \`tsc\` clean, **334 tests green** (41 files), 0 lint errors
- Mobile: \`tsc\` clean, **1153 tests green** (197 files), 0 lint errors
- Negative controls on both new suites — reverting the count guard fails 2 tests, reverting the wire-compat fix fails 1
- Your original call-runtime work: **184 lines, 0 missing**
- The other session's 3 live files: 170 insertions, **untouched by me**

## Deploying video Live — your call, not mine

I did **not** deploy and did **not** run the migration. Both need your explicit authorization, and there's a governance wrinkle: the deployment freeze is per-service and clears a service only when its own Article IV is COMPLIANT — **Pale isn't in the services ledger at all**, so there's no record clearing it. That's worth fixing separately under Article II §1 regardless of this release.

When you authorize it, the order matters:

1. **Migration first** — \`20261003000500_add_live_session_video_mode\`. Additive, \`NOT NULL DEFAULT false\`, no backfill, \`IF NOT EXISTS\`. Existing sessions become audio, which is what they already were.
2. **Then the backend.** New backend + old clients is safe (\`hasVideo\` optional). Old backend + a client sending \`hasVideo: true\` is the 400 you hit.
3. **Then video Live works** on the next build — no app change needed to unblock it.

Still outstanding on my side: the camera publish path in \`useLiveSession.ts\` (video tiles on the stage), which I'm staying out of while the other session holds that file. Tell me when it's free and I'll take slice 1 to completion.`;

export const HANDOFF_FOLLOW_UP =
  'Your report puts the count and audio-compatibility fixes in source, not video Live in production; I have not independently verified those results. ' +
  'The next source task is the camera-publish path, while deployment remains separately gated. ' +
  'Is useLiveSession.ts now free from the other session so we can take that slice next?';
