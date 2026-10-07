import assert from "node:assert/strict";
import test from "node:test";
import {
  provisioningJobProductLane,
  provisioningProductAllowed,
  provisioningProductAllowlist,
} from "./provisioning-policy.js";

function withAllowlist(value: string | undefined, run: () => void) {
  const previous = process.env.PROVISIONING_WORKER_PRODUCT_ALLOWLIST;
  try {
    if (value === undefined) {
      delete process.env.PROVISIONING_WORKER_PRODUCT_ALLOWLIST;
    } else {
      process.env.PROVISIONING_WORKER_PRODUCT_ALLOWLIST = value;
    }
    run();
  } finally {
    if (previous === undefined) {
      delete process.env.PROVISIONING_WORKER_PRODUCT_ALLOWLIST;
    } else {
      process.env.PROVISIONING_WORKER_PRODUCT_ALLOWLIST = previous;
    }
  }
}

test("empty rollout allowlist preserves all-lane processing", () => {
  withAllowlist(undefined, () => {
    assert.deepEqual(provisioningProductAllowlist(), []);
    assert.equal(provisioningProductAllowed("MIGRAHOSTING"), true);
    assert.equal(provisioningProductAllowed("MIGRAMAIL"), true);
    assert.equal(provisioningProductAllowed(null), true);
  });
});

test("configured rollout allowlist normalizes and deduplicates product lanes", () => {
  withAllowlist(" migrahosting, MIGRAMAIL, migrahosting ", () => {
    assert.deepEqual(provisioningProductAllowlist(), [
      "MIGRAHOSTING",
      "MIGRAMAIL",
    ]);
    assert.equal(provisioningProductAllowed("migrahosting"), true);
    assert.equal(provisioningProductAllowed("MIGRAMAIL"), true);
    assert.equal(provisioningProductAllowed("MIGRAVOICE"), false);
    assert.equal(provisioningProductAllowed(null), false);
  });
});

test("job product lane uses productLane first and falls back to product", () => {
  assert.equal(
    provisioningJobProductLane({
      productLane: " migramail ",
      product: "MIGRAHOSTING",
    }),
    "MIGRAMAIL",
  );
  assert.equal(
    provisioningJobProductLane({ product: "migrahosting" }),
    "MIGRAHOSTING",
  );
  assert.equal(provisioningJobProductLane({}), null);
  assert.equal(provisioningJobProductLane(null), null);
});
