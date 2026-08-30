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
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

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
const stub = (payload, { status = 200, body } = {}) => async (url, opts) => {
  calls.push({ url, method: opts.method, headers: opts.headers, body: opts.body });
  return { ok: status >= 200 && status < 300, status,
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
t("all six operations send the contract version",
  calls.length === 6 && calls.every((x) => x.headers["x-migraai-contract-version"] === CLIENT_CONTRACT_VERSION),
  `${calls.filter((x) => !x.headers["x-migraai-contract-version"]).length} of ${calls.length} omitted it`);
t("all six operations identify the caller",
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

console.log("\n=== the package carries no implementation ===");
const src = readFileSync(join(PKG, "src", "index.ts"), "utf8");
const imports = src.match(/^\s*import\s.+$/gm) ?? [];
t("the client imports nothing at all",
  imports.length === 0,
  `imports found: ${imports.join(" | ")} — a contract package that pulls in a dependency can pull in a decision`);

const exported = Object.keys(await import(new URL("../dist/index.js", import.meta.url).href)).sort();
t("its runtime surface is exactly the transport",
  JSON.stringify(exported) === JSON.stringify(["CLIENT_CONTRACT_VERSION", "ComputeAuthorityError", "ComputeClient"]),
  `exports are ${JSON.stringify(exported)} — anything else is logic that escaped the authority`);

console.log("\n=== no drift while two copies exist ===");
// The Studio repo still holds a copy until its consumption is repointed. Two copies of a contract
// with nothing comparing them is precisely how a contract silently forks. Absent Studio is reported
// NOT_MEASURED — never a pass, because an unchecked copy is not a matching copy.
const studio = process.env.MIGRAAI_STUDIO_REPO || "/mnt/e/MigraTeck/AI/MigraAI-Studio";
const studioSrc = join(studio, "packages", "compute-client", "src", "index.ts");
if (!existsSync(studioSrc)) {
  unmeasured("dev and Studio copies are identical",
    `Studio copy not present at ${studioSrc} — set MIGRAAI_STUDIO_REPO to compare. Not a pass: an unchecked copy is not a matching copy.`);
} else {
  const h = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
  const a = h(join(PKG, "src", "index.ts")), b = h(studioSrc);
  t("dev and Studio copies are identical", a === b,
    `dev ${a.slice(0, 12)} != studio ${b.slice(0, 12)} — the contract has forked; the copies must be reconciled before either is trusted`);
}

console.log(fail ? "\nCONTRACT NEUTRALITY VIOLATED" : `\nCONTRACT NEUTRALITY HOLDS${notMeasured ? ` (${notMeasured} not measured)` : ""}`);
process.exit(fail ? 1 : 0);
