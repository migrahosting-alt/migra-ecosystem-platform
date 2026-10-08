import assert from "node:assert/strict";
import test from "node:test";
import { classifyDiskCapacity } from "./host-capacity.js";

const GIB = 1024 ** 3;

test("disk capacity is critical on either percentage or absolute-free floor", () => {
  assert.deepEqual(
    classifyDiskCapacity({
      usedPercent: 96,
      availableBytes: 20 * GIB,
    }).state,
    "critical",
  );

  assert.deepEqual(
    classifyDiskCapacity({
      usedPercent: 80,
      availableBytes: 4 * GIB,
    }).state,
    "critical",
  );
});

test("disk capacity warns before the critical boundary", () => {
  assert.equal(
    classifyDiskCapacity({
      usedPercent: 92,
      availableBytes: 20 * GIB,
    }).state,
    "warning",
  );

  assert.equal(
    classifyDiskCapacity({
      usedPercent: 80,
      availableBytes: 8 * GIB,
    }).state,
    "warning",
  );
});

test("disk capacity is healthy only when both relative and absolute headroom are safe", () => {
  const result = classifyDiskCapacity({
    usedPercent: 80,
    availableBytes: 20 * GIB,
  });
  assert.equal(result.state, "healthy");
  assert.deepEqual(result.reasons, []);
});

test("custom thresholds remain deterministic", () => {
  assert.equal(
    classifyDiskCapacity({
      usedPercent: 88,
      availableBytes: 30 * GIB,
      warningPercent: 85,
      criticalPercent: 90,
      warningFreeBytes: 12 * GIB,
      criticalFreeBytes: 6 * GIB,
    }).state,
    "warning",
  );
});
