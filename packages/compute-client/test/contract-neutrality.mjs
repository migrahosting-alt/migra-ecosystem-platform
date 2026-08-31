#!/usr/bin/env node
/**
 * The client is a CONTRACT, not an implementation — enforced, not asserted in a comment.
 *
 * "No authority logic inside it" is the condition this package was extracted under. A condition
 * that is only stated in a docstring is the "declared but never read" pattern that produced every
 * other defect in this subsystem: an unread version field, an unenforced wire contract, a lint that
 * could not fire. So it is checked here, behaviourally.
 *
 * These are BEHAVIOURAL tests, deliberately not keyword greps. Grepping for "runpod" or "schedule"
 * would be a keyword proxy for a semantic property — the client legitimately contains the
 * LifecycleState union, which names authority states without implementing any of them. The real
 * property is: THE CLIENT MUST NOT DECIDE ANYTHING. It serialises a request, and it returns what
 * the authority said, unchanged. So that is what gets tested — with an injected fetch, which makes
 * "did it transform the answer" directly observable.
 */
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, "..");

let fail = 0, notMeasured = 0;
const t = (name, cond, why) => {
  if (cond) console.log(`  PASS  ${name}`);
  else { console.log(`  FAIL  ${name}\n        ${why}`); fail = 1; }
};
const unmeasured = (name, why) => { console.log(`  NOT_MEASURED  ${name}\n        ${why}`); notMeasured++; };

const { ComputeClient, ComputeAuthorityError, CLIENT_CONTRACT_VERSION } =
  await import(new URL("../dist/index.js", import.meta.url).href);

console.log("=== the client decides nothing ===");

// A stub authority. Records what was sent; returns exactly what we tell it to.
const calls = [];
const stub = (payload, { status = 200, body, advertise = CLIENT_CONTRACT_VERSION } = {}) => async (url, opts) => {
  calls.push({ url, method: opts.method, headers: opts.headers, body: opts.body });
  // The real authority advertises its contract on EVERY response. The stub must too, or these
  // tests would exercise a transport the authority does not actually present.
  return { ok: status >= 200 && status < 300, status,
           headers: { get: (k) => (k.toLowerCase() === "x-migraai-contract-version" ? advertise : null) },
           text: async () => body ?? JSON.stringify(payload) };
};

// The authority's answer must come back UNCHANGED. If the client re-ranked targets, recomputed a
// fingerprint, or substituted a default, this is where it would show.
const authorityPlan = {
  ok: true, decision: "remote", target: "remote/runpod", remoteBlocked: false,
  fingerprint: { key: "fp-from-authority", parts: { pipeline: "x" } },
  evaluations: [{ target: "local/windows", qualified: false, reasons: ["insufficient vram"] }],
  sideEffects: "none",
};
let c = new ComputeClient({ actor: "studio", fetchImpl: stub(authorityPlan) });
const got = await c.plan({ jobId: "j1", pipeline: "x" });
t("plan() returns the authority's answer verbatim",
  JSON.stringify(got) === JSON.stringify(authorityPlan),
  "the client altered the authority's decision — a client that reshapes a plan is a second authority");

// The single most important negative: a client that answered locally when the authority was
// unreachable would silently become the decision-maker.
calls.length = 0;
c = new ComputeClient({ actor: "studio", fetchImpl: async () => { throw new Error("ECONNREFUSED"); } });
let threw = null;
try { await c.plan({ jobId: "j1", pipeline: "x" }); } catch (e) { threw = e; }
t("an unreachable authority THROWS rather than deciding locally",
  threw !== null,
  "the client returned a plan with no authority reachable — that is a local decision wearing the authority's name");

// A non-2xx must surface as an error carrying the status, never be swallowed into a default.
c = new ComputeClient({ actor: "studio", fetchImpl: stub(null, { status: 409, body: JSON.stringify({ error: "unsupported_newer_contract" }) }) });
threw = null;
try { await c.plan({ jobId: "j1", pipeline: "x" }); } catch (e) { threw = e; }
t("a refusal surfaces as ComputeAuthorityError with its status",
  threw instanceof ComputeAuthorityError && threw.status === 409 && /unsupported_newer_contract/.test(threw.message),
  `got ${threw && threw.constructor.name} status=${threw && threw.status} — a refusal absorbed into a default is a refusal ignored`);

console.log("\n=== every request declares the contract ===");
calls.length = 0;
c = new ComputeClient({ actor: "brain", fetchImpl: stub({ ok: true }) });
await c.plan({ jobId: "j", pipeline: "p" });
await c.getState("j");
await c.getCapabilities();
await c.getEvidence("j");
await c.submit({ jobId: "j", pipeline: "p" }, "because");
await c.cancel("j", "because");
/*
 * THE SEVENTH. /observations arrived with service contract 1.1.0 and sends the version like every
 * other operation — the discovery exemption on GET /capabilities is the only one, and it is
 * authority-side. Counting operations here is deliberate: a client that grows an operation without
 * this number moving is a client whose contract claim has quietly stopped describing it.
 */
await c.recordObservation({ runId: "r", pipeline: "p", outcome: "completed", executionMode: "local", executionTarget: "local/wsl", peakVramStatus: "NOT_MEASURED" });
t("all seven operations send the contract version",
  calls.length === 7 && calls.every((x) => x.headers["x-migraai-contract-version"] === CLIENT_CONTRACT_VERSION),
  `${calls.filter((x) => !x.headers["x-migraai-contract-version"]).length} of ${calls.length} omitted it`);
t("all seven operations identify the caller",
  calls.every((x) => x.headers["x-migraai-actor"] === "brain"),
  "an unidentified request cannot be attributed to a caller");

// Spend must carry a reason. This is the one thing the client refuses on its own — and it is a
// GUARD (it refuses to proceed), not a DECISION (it never substitutes one).
for (const [op, run] of [["submit", () => c.submit({ jobId: "j", pipeline: "p" }, "")],
                         ["cancel", () => c.cancel("j", "")]]) {
  let e = null;
  try { await run(); } catch (err) { e = err; }
  t(`${op}() without a reason is refused locally`, e !== null,
    "spend and teardown must record why; the client refuses rather than inventing a reason");
}

/*
 * ARTIFACT-CAPABLE FROM HERE, AND THAT IS THE POINT OF THE SPLIT.
 *
 * This file reads NOTHING from the source tree. It exercises the BUILT module, so it runs
 * unchanged against a published tarball installed into a stranger's project — which is the only
 * place the claim "this package carries no logic" can actually be tested. Source-tree integrity
 * lives in source-integrity.mjs and cannot run here: a correct package ships no `src`.
 *
 * Found the hard way. This suite once crashed on ENOENT reading src/index.ts out of an installed
 * package, after seven behavioural tests had already passed — a suite that audited the repository
 * while claiming to audit the artifact.
 */
console.log("\n=== the shipped artifact carries no implementation ===");
const exported = Object.keys(await import(new URL("../dist/index.js", import.meta.url).href)).sort();
t("its runtime surface is exactly the transport",
  JSON.stringify(exported) === JSON.stringify(["CLIENT_CONTRACT_VERSION", "ComputeAuthorityError", "ComputeClient"]),
  `exports are ${JSON.stringify(exported)} — anything else is logic that escaped the authority`);

console.log("\n=== the client verifies the contract it is answered in ===");

/*
 * VERSION SKEW, IN THE DIRECTION THAT ACTUALLY MATTERS.
 *
 * Exact equality used to be the rule, and it made an ADDITIVE server bump breaking: the moment the
 * authority moved to 1.1.0 a 1.0.0 client refused every response, including responses to the six
 * operations that had not changed. So the rule is now "same major, authority >= client".
 *
 * A NEWER authority is SAFE: every operation this client knows still exists, and new response
 * fields are optional and simply go unread. An OLDER authority is the dangerous one — this client
 * carries seven operations and an older authority may never have had the seventh, so a call would
 * 404 after passing a version gate that said compatible. That asymmetry is the whole point, and a
 * test that only checked inequality would have passed against a rule that had it backwards.
 */
c = new ComputeClient({ actor: "studio", fetchImpl: stub(authorityPlan, { advertise: "1.2.0" }) });
let newer = null;
try { await c.plan({ jobId: "j", pipeline: "p" }); } catch (e) { newer = e; }
t("a NEWER authority within the same major is accepted, not refused",
  newer === null,
  `an additive server bump must not brick this client, got: ${newer && newer.message}`);

c = new ComputeClient({ actor: "studio", fetchImpl: stub(authorityPlan, { advertise: "1.0.0" }) });
let older = null;
try { await c.plan({ jobId: "j", pipeline: "p" }); } catch (e) { older = e; }
t("an OLDER authority is refused — this client may call an operation it never had",
  older instanceof ComputeAuthorityError && /1\.0\.0/.test(older.message),
  `expected a refusal naming the advertised version, got: ${older && older.message}`);

c = new ComputeClient({ actor: "studio", fetchImpl: stub(authorityPlan, { advertise: "2.0.0" }) });
let major = null;
try { await c.plan({ jobId: "j", pipeline: "p" }); } catch (e) { major = e; }
t("a different MAJOR is refused whichever way it moved",
  major instanceof ComputeAuthorityError,
  `a major bump may change behaviour beneath a name this client knows, got: ${major && major.message}`);

// AN UNVERSIONED SUCCESS IS NOT A SUCCESS. Something answered as the authority without identifying
// itself as one; interpreting that is exactly what the version exists to prevent.
c = new ComputeClient({ actor: "studio", fetchImpl: stub(authorityPlan, { advertise: null }) });
let unversioned = null;
try { await c.plan({ jobId: "j", pipeline: "p" }); } catch (e) { unversioned = e; }
t("an unversioned successful response is refused",
  unversioned instanceof ComputeAuthorityError && /did not advertise a contract version/.test(unversioned.message),
  `expected a refusal, got: ${unversioned && unversioned.message}`);

// BUT A TRANSPORT FAILURE STAYS A TRANSPORT FAILURE. A proxy can return 502 without ever reaching
// the authority; calling that a contract fault would blame the wrong component.
c = new ComputeClient({ actor: "studio", fetchImpl: stub(null, { status: 502, body: JSON.stringify({ error: "bad gateway" }), advertise: null }) });
let gateway = null;
try { await c.plan({ jobId: "j", pipeline: "p" }); } catch (e) { gateway = e; }
t("an unversioned ERROR response is reported as its status, not as contract drift",
  gateway instanceof ComputeAuthorityError && gateway.status === 502 && !/contract version/.test(gateway.message),
  `expected the 502 to survive as a 502, got: ${gateway && gateway.status} ${gateway && gateway.message}`);

console.log(fail ? "\nCONTRACT NEUTRALITY VIOLATED" : `\nCONTRACT NEUTRALITY HOLDS${notMeasured ? ` (${notMeasured} not measured)` : ""}`);
process.exit(fail ? 1 : 0);
