import assert from "node:assert/strict";
import test from "node:test";

import { planNumberOrder, missingConfig, isNumberOrderingConfigured } from "./number-ordering.js";

const query = {
  tenantId: "t1",
  customerId: "c1",
  numberType: "local" as const,
  areaCode: "954",
  quantity: 1,
};

const configure = () => {
  process.env.PANEL_API_BASE = "http://panel.invalid";
  process.env.PANEL_INTERNAL_TOKEN = "tok";
};
const unconfigure = () => {
  delete process.env.PANEL_API_BASE;
  delete process.env.PANEL_INTERNAL_TOKEN;
};

async function withFetch<T>(impl: typeof fetch, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try { return await run(); } finally { globalThis.fetch = original; }
}

const respond = (status: number, body: unknown, json = true) =>
  (async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (!json) throw new SyntaxError("not json");
      return body;
    },
  })) as unknown as typeof fetch;

test("missing configuration is named, not guessed at", () => {
  unconfigure();
  assert.deepEqual(missingConfig().sort(), ["PANEL_API_BASE", "PANEL_INTERNAL_TOKEN"]);
  assert.equal(isNumberOrderingConfigured(), false);
  configure();
  assert.deepEqual(missingConfig(), []);
  assert.equal(isNumberOrderingConfigured(), true);
});

test("an unconfigured console says so and never calls out", async () => {
  unconfigure();
  let called = false;
  const spy = (async () => { called = true; throw new Error("should not be called"); }) as unknown as typeof fetch;
  const out = await withFetch(spy, () => planNumberOrder(query));
  assert.equal(out.state, "not_configured");
  assert.equal(called, false);
  configure();
});

test("an unreachable panel-api is 'unavailable', NOT an empty candidate list", async () => {
  // The defect this prevents: an operator reading a failed request as
  // "that area code is sold out" and going to buy elsewhere.
  configure();
  const boom = (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
  const out = await withFetch(boom, () => planNumberOrder(query));
  assert.equal(out.state, "unavailable");
  assert.match(out.state === "unavailable" ? out.detail : "", /ECONNREFUSED/);
});

test("a rejected token is 'unavailable', not 'no numbers available'", async () => {
  configure();
  const out = await withFetch(respond(401, { ok: false, error: "unauthorized" }), () =>
    planNumberOrder(query),
  );
  assert.equal(out.state, "unavailable");
  assert.match(out.state === "unavailable" ? out.detail : "", /unauthorized/);
});

test("a non-JSON response is 'unavailable' and names the status", async () => {
  configure();
  const out = await withFetch(respond(502, null, false), () => planNumberOrder(query));
  assert.equal(out.state, "unavailable");
  assert.match(out.state === "unavailable" ? out.detail : "", /502/);
});

test("a 200 that carries no plan is still 'unavailable'", async () => {
  configure();
  const out = await withFetch(respond(200, { ok: true }), () => planNumberOrder(query));
  assert.equal(out.state, "unavailable");
});

test("a real plan comes through intact", async () => {
  configure();
  const plan = {
    ok: true,
    blockers: [],
    warnings: [],
    candidates: [{
      e164: "+19545550142", display: "(954) 555-0142",
      monthlyCost: "1.00", upfrontCost: "1.00", currency: "USD",
      reservable: true, features: ["voice", "emergency"], emergencyCapable: true,
    }],
    totals: { monthly: "1.00", upfront: "1.00", currency: "USD" },
    identityStamp: { customerReference: "customer:c1", connectionId: "conn-1" },
    mode: "plan",
  };
  const out = await withFetch(respond(200, { ok: true, plan }), () => planNumberOrder(query));
  assert.equal(out.state, "planned");
  assert.equal(out.state === "planned" ? out.plan.candidates.length : 0, 1);
  assert.equal(out.state === "planned" ? out.plan.totals?.monthly : null, "1.00");
});

test("a plan carrying blockers is still 'planned' — the provider did answer", async () => {
  configure();
  const plan = {
    ok: false, blockers: ["only 1 number(s) available in 954, 3 requested"], warnings: [],
    candidates: [], totals: null,
    identityStamp: { customerReference: "customer:c1", connectionId: null }, mode: "plan",
  };
  const out = await withFetch(respond(200, { ok: true, plan }), () => planNumberOrder(query));
  assert.equal(out.state, "planned", "a real provider answer must not be downgraded to unavailable");
  assert.equal(out.state === "planned" ? out.plan.blockers.length : 0, 1);
});
