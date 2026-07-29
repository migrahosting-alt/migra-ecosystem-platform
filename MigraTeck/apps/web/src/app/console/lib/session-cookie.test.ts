import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_PATH,
} from "./session-cookie.ts";

test("session cookie name + path are the single source of truth", () => {
  assert.equal(SESSION_COOKIE_NAME, "migrateck_console_session");
  // Logout must clear at exactly this path (where issueSession sets it).
  assert.equal(SESSION_COOKIE_PATH, "/console");
});
