// Objective scoring for task 3: run each model's function against the nine stated cases.
const NOW = new Date('2026-10-21T07:00:00.000Z');
const CASES = [
  ['120', 120_000], ['0', 0],
  ['Wed, 21 Oct 2026 07:28:00 GMT', 600_000],
  ['Wed, 21 Oct 2026 06:00:00 GMT', undefined],
  ['not-a-number', undefined], ['-5', undefined],
  [null, undefined], ['', undefined], ['99999999', 600_000],
];

const impls = {
  '14b': function parseRetryAfter(value, now, maxMs) {
    if (!value) return undefined;
    let delayMs;
    const delaySeconds = parseInt(value, 10);
    if (!isNaN(delaySeconds)) {
      delayMs = delaySeconds * 1000;
      if (delayMs < 0) return undefined;
      return Math.min(delayMs, maxMs);
    }
    const date = new Date(value);
    if (isNaN(date.getTime())) return undefined;
    delayMs = date.getTime() - now.getTime();
    if (delayMs <= 0) return undefined;
    return Math.min(delayMs, maxMs);
  },
  '7b': function parseRetryAfter(value, now, maxMs) {
    if (value == null || value.trim() === '') return undefined;
    const delaySeconds = parseInt(value, 10);
    if (!isNaN(delaySeconds)) {
      const delayMs = delaySeconds * 1000;
      return Math.max(0, Math.min(delayMs, maxMs));
    }
    const date = new Date(value);
    if (date.toString() === 'Invalid Date' || date <= now) return undefined;
    const retryAfterMs = date.getTime() - now.getTime();
    return Math.max(0, Math.min(retryAfterMs, maxMs));
  },
};

for (const [name, fn] of Object.entries(impls)) {
  let pass = 0;
  console.log(`\n  ${name}:`);
  for (const [input, expected] of CASES) {
    let got, err;
    try { got = fn(input, NOW, 600_000); } catch (e) { err = e.message; }
    const ok = !err && got === expected;
    if (ok) pass += 1;
    console.log(`    ${ok ? 'PASS' : 'FAIL'}  ${JSON.stringify(input).padEnd(34)} expected=${String(expected).padEnd(8)} got=${err ? 'THREW ' + err : String(got)}`);
  }
  console.log(`    → ${pass}/${CASES.length} cases pass`);
}
