import assert from "node:assert/strict";
import test from "node:test";
import { updateTaxInfo } from "./index.js";
import type { BillingContext } from "../context.js";

/**
 * Contract tests for partial tax updates.
 *
 * The defect these guard against: `updateTaxInfo` once took `TaxInfo`, the READ shape, whose
 * fields are all present and `string | null`. That forced every caller to supply all three
 * fields, so the route normalised omissions with `?? null` — turning "I did not mention
 * taxState" into "clear taxState". A caller correcting only its country code would silently
 * destroy its state and VAT number.
 *
 * Three states must stay distinguishable end to end:
 *   absent            -> undefined -> Prisma leaves the column alone
 *   present as null   -> null      -> Prisma clears the column
 *   present with value-> value     -> Prisma updates the column
 */

type StripeAddressUpdate = { address?: { country?: string; state?: string } };

function harness(opts: { stripeCustomerId?: string | null } = {}) {
  const seen: {
    data?: Record<string, unknown>;
    stripeUpdates: StripeAddressUpdate[];
    createdTaxIds: Array<{ type: unknown; value: unknown }>;
  } = { stripeUpdates: [], createdTaxIds: [] };

  // Pre-existing values, so "left untouched" is observably different from "cleared".
  const account = {
    orgId: "org_1",
    stripeCustomerId: opts.stripeCustomerId ?? null,
    taxCountry: "FR",
    taxState: "IDF",
    taxId: "FR12345678901",
  };

  const ctx = {
    db: {
      billingAccount: {
        findUnique: async () => account,
        update: async (args: { data: Record<string, unknown> }) => {
          seen.data = args.data;
          return { ...account, ...args.data };
        },
      },
    },
    stripe: {
      customers: {
        update: async (_id: string, params: StripeAddressUpdate) => {
          seen.stripeUpdates.push(params);
          return {};
        },
        listTaxIds: async () => ({ data: [] as Array<{ id: string }> }),
        deleteTaxId: async () => ({}),
        createTaxId: async (_id: string, params: { type: unknown; value: unknown }) => {
          seen.createdTaxIds.push(params);
          return {};
        },
      },
    },
  } as unknown as BillingContext;

  return { ctx, seen };
}

test("absent property -> no change: an omitted field reaches Prisma as undefined, never null", async () => {
  const { ctx, seen } = harness();

  await updateTaxInfo(ctx, "org_1", { taxCountry: "US" });

  assert.equal(seen.data?.taxCountry, "US");
  assert.equal(seen.data?.taxState, undefined, "an omitted taxState must not become null");
  assert.equal(seen.data?.taxId, undefined, "an omitted taxId must not become null");
});

test("property present with null -> clear", async () => {
  const { ctx, seen } = harness();

  await updateTaxInfo(ctx, "org_1", { taxCountry: "US", taxState: null, taxId: null });

  assert.equal(seen.data?.taxState, null);
  assert.equal(seen.data?.taxId, null);
});

test("property present with value -> update", async () => {
  const { ctx, seen } = harness();

  await updateTaxInfo(ctx, "org_1", {
    taxCountry: "US",
    taxState: "CA",
    taxId: "12-3456789",
  });

  assert.equal(seen.data?.taxCountry, "US");
  assert.equal(seen.data?.taxState, "CA");
  assert.equal(seen.data?.taxId, "12-3456789");
});

test("omission and explicit null remain distinguishable within one request", async () => {
  const { ctx, seen } = harness();

  await updateTaxInfo(ctx, "org_1", { taxCountry: "US", taxState: null });

  assert.equal(seen.data?.taxState, null, "the field named as null is cleared");
  assert.equal(seen.data?.taxId, undefined, "the field never named is untouched");
});

test("a cleared field is not pushed to Stripe as an address value", async () => {
  const { ctx, seen } = harness({ stripeCustomerId: "cus_1" });

  await updateTaxInfo(ctx, "org_1", { taxCountry: "US", taxState: null });

  assert.equal(seen.stripeUpdates.length, 1);
  const address = seen.stripeUpdates[0]?.address ?? {};
  assert.equal(address.country, "US");
  assert.equal(
    Object.hasOwn(address, "state"),
    false,
    "a cleared field must not be sent to Stripe as a value",
  );
});

test("omitting taxId does not rewrite the Stripe tax ID", async () => {
  const { ctx, seen } = harness({ stripeCustomerId: "cus_1" });

  await updateTaxInfo(ctx, "org_1", { taxCountry: "US" });

  assert.equal(seen.createdTaxIds.length, 0);
});

test("a supplied taxId is still written through to Stripe", async () => {
  const { ctx, seen } = harness({ stripeCustomerId: "cus_1" });

  await updateTaxInfo(ctx, "org_1", { taxCountry: "US", taxId: "12-3456789" });

  assert.equal(seen.createdTaxIds.length, 1);
  assert.equal(seen.createdTaxIds[0]?.value, "12-3456789");
  assert.equal(seen.createdTaxIds[0]?.type, "us_ein");
});
