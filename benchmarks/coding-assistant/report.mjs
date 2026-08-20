// Aggregate the benchmark evidence into one comparison.
//
// Mechanical facts are reported as facts. Judgement (plan quality, explanation
// quality) is NOT invented here — the rubric produces an indicator from the
// transcript, and the transcript is kept so a human can disagree with it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TASKS } from './run.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RESULTS = path.join(HERE, 'results');
const TOOLS = ['migrapilot', 'claude-code', 'codex', 'copilot'];

const read = (tool, task) => {
  const f = path.join(RESULTS, `${tool}__${task}.json`);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
};
const transcript = (tool, task) => {
  const f = path.join(RESULTS, `${tool}__${task}.transcript.txt`);
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
};

/** Human reads, recorded and attributed. The keyword matcher that used to live
 * here scored a flawless review 0/3, so it was removed rather than dressed up. */
const JUDGEMENT = (() => {
  const f = path.join(RESULTS, 'judgement.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
})();

/** Objective correctness: hidden suite green, and nothing out of scope. */
function verdict(task, r) {
  if (!r) return 'NOT RUN';
  if (r.errors?.length && !r.hidden) return 'ERROR';
  if (task.rubric?.forbidAnyEdit) {
    const edited = r.scope.files.filter((f) => !f.startsWith('.'));
    // The review task ships ONE dirty file by design; more means it edited code.
    return edited.length <= 1 ? 'ok (no edits)' : `EDITED ${edited.length} files`;
  }
  if (!r.hidden) return r.errors?.length ? 'ERROR' : 'n/a';
  // A NO-OP IS NOT A PASS. The refactor oracle pins behaviour, so a tool that
  // changed nothing satisfies it trivially — MigraPilot scored PASS on t5 having
  // refused to plan and edited zero files. Doing the work is part of the verdict.
  if (r.scope.files.length === 0) return 'NO-OP (changed nothing)';
  const green = r.hidden.fail === 0 && r.visibleAfter.fail === 0;
  return green ? 'PASS' : `FAIL (hidden ${r.hidden.pass}/${r.hidden.pass + r.hidden.fail})`;
}

const lines = [];
lines.push('# MigraPilot capability benchmark — results\n');
lines.push('Same repository state, same prompt, hidden verification the tool never saw.\n');

for (const task of TASKS) {
  lines.push(`\n## ${task.id} — ${task.title}\n`);
  lines.push('| Tool | Verdict | Time | Visible | Hidden | Files | Ran tests | Touched tests |');
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const tool of TOOLS) {
    const r = read(tool, task.id);
    if (!r) { lines.push(`| ${tool} | NOT RUN | — | — | — | — | — | — |`); continue; }
    if (r.invalid) { lines.push(`| ${tool} | **COULD NOT RUN** — ${r.invalid} | — | — | — | — | — | — |`); continue; }
    const v = r.visibleAfter, h = r.hidden;
    lines.push(
      `| ${tool} | ${verdict(task, r)} | ${Math.round(r.wallMs / 1000)}s |`
      + ` ${v.pass}/${v.pass + v.fail} | ${h ? `${h.pass}/${h.pass + h.fail}` : 'n/a'} |`
      + ` ${r.scope.files.length} | ${r.ranTestsItself ? 'yes' : 'no'} | ${r.scope.touchedTests ? 'yes' : 'no'} |`,
    );
  }
  const judged = JUDGEMENT[task.id];
  if (judged) {
    lines.push(`\nAnswer quality — read by a human (${JUDGEMENT._reader}):\n`);
    for (const tool of TOOLS) {
      const j = judged[tool];
      if (j) lines.push(`- **${tool}** — ${j.correct ? 'correct' : 'not correct'}: ${j.note}`);
    }
  }
  const mp = read('migrapilot', task.id);
  if (mp?.capabilities?.length) lines.push(`\nMigraPilot capabilities exercised: \`${mp.capabilities.join('` `')}\``);
}

const out = path.join(RESULTS, 'REPORT.md');
fs.writeFileSync(out, `${lines.join('\n')}\n`);
console.log(lines.join('\n'));
