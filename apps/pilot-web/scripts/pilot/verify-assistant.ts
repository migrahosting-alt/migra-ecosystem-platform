// MigraPilot embeddable assistant verifier (P1 + P2). READ-ONLY, no network, no model call.
// P1: checkAssistantAuth 200/401 (fail-closed) behavior. P2: static proof the assistant routes
// execute no tools (use chatOnce, never the tool loop / runTool, offer no tools, assert flags).
// Run: npx --yes tsx scripts/pilot/verify-assistant.ts

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { checkAssistantAuth, checkAssistantAuthForEnv } from "../../lib/pilot/assistant-auth";

const fails: string[] = [];
const ok = (cond: boolean, label: string) => { if (!cond) fails.push(label); else console.log(`  PASS  ${label}`); };
const reqWith = (auth?: string) =>
  new Request("http://x/api/pilot/assistant", { method: "POST", headers: auth !== undefined ? { authorization: auth } : {} });

// --- P1: bearer auth (fail-closed) ---
const SECRET = "fake_assistant_secret_do_not_use_ABC123xyz";
delete process.env.MIGRAPILOT_ASSISTANT_SECRET;
ok(checkAssistantAuth(reqWith(`Bearer ${SECRET}`)).ok === false, "no configured secret → 401 (fail closed, config existence not leaked)");
process.env.MIGRAPILOT_ASSISTANT_SECRET = SECRET;
ok(checkAssistantAuth(reqWith()).ok === false, "missing Authorization header → 401");
ok(checkAssistantAuth(reqWith("Bearer ")).ok === false, "empty bearer token → 401");
ok(checkAssistantAuth(reqWith("Bearer wrong-secret")).ok === false, "wrong secret → 401");
ok(checkAssistantAuth(reqWith(`Basic ${SECRET}`)).ok === false, "non-Bearer scheme → 401");
ok(checkAssistantAuth(reqWith(`Bearer ${SECRET.slice(0, -1)}`)).ok === false, "near-miss (length-1) secret → 401");
ok(checkAssistantAuth(reqWith(`Bearer ${SECRET}`)).ok === true, "correct bearer secret → 200 (authorized)");
delete process.env.MIGRAPILOT_ASSISTANT_SECRET;

delete process.env.MIGRAPILOT_ABIGAIL_ASSISTANT_SECRET;
ok(checkAssistantAuthForEnv(reqWith(`Bearer ${SECRET}`), "MIGRAPILOT_ABIGAIL_ASSISTANT_SECRET").ok === false, "no configured Abigail secret → 401");
process.env.MIGRAPILOT_ABIGAIL_ASSISTANT_SECRET = SECRET;
ok(checkAssistantAuthForEnv(reqWith(`Bearer ${SECRET}`), "MIGRAPILOT_ABIGAIL_ASSISTANT_SECRET").ok === true, "correct Abigail bearer secret → 200 (authorized)");
delete process.env.MIGRAPILOT_ABIGAIL_ASSISTANT_SECRET;

// --- P2: assistant routes execute ZERO tools (static proof) ---
// Strip comments first so documentation mentioning "orchestrator"/"runTool" doesn't false-positive.
for (const rel of ["app/api/pilot/assistant/route.ts", "app/api/pilot/assistant/abigail/route.ts"]) {
  const raw = readFileSync(resolve(process.cwd(), rel), "utf8");
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
  const imports = [...code.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
  ok(/chatOnce\(/.test(code), `${rel}: uses chatOnce (single completion)`);
  ok(!imports.some((i) => /orchestrator|\/tools$|ops-action|ops-eligibility|approval-store|executor/.test(i)),
    `${rel}: imports only safe modules (no orchestrator/tools/ops/approval/executor): [${imports.join(", ")}]`);
  ok(!/\b(streamPilotRun|runAgentLoop|runTool)\s*\(/.test(code), `${rel}: calls no tool-loop function (streamPilotRun/runAgentLoop/runTool)`);
  ok(!/\btools\s*:/.test(code), `${rel}: offers NO tools to the model (no tools: passed to chatOnce)`);
  ok(/toolsExecuted:\s*false/.test(code) && /approvalCardsEmitted:\s*false/.test(code), `${rel}: asserts toolsExecuted:false + approvalCardsEmitted:false`);
}

// --- P3: request parser trims/limits history safely ---
const reqLib = readFileSync(resolve(process.cwd(), "lib/pilot/assistant-request.ts"), "utf8");
ok(/slice\(-8\)/.test(reqLib), "assistant-request limits history to the latest 8 items");
ok(/role !== "user" && role !== "assistant"/.test(reqLib), "assistant-request allows only user/assistant history roles");

console.log("");
if (fails.length) { console.error(`ASSISTANT VERIFY FAILED (${fails.length}):`); fails.forEach((f) => console.error("  FAIL  " + f)); process.exit(1); }
console.log(`ASSISTANT VERIFY OK — bearer auth 200/401 correct (fail-closed), assistant surfaces execute zero tools.`);
