#!/usr/bin/env node
/**
 * MigraAI Engine — deterministic vision-eval fixture generator.
 *
 * A vision model can only be *qualified* against known ground truth. Rather than
 * scrape unstable screenshots, we author each fixture here (SVG, with the exact
 * text/structure we control), rasterize it to PNG with ImageMagick, and emit an
 * eval set that carries the SAME ground truth. One source of truth → reproducible
 * scoring, no committed binary blobs (PNGs are generated + gitignored).
 *
 * Dimensions covered: OCR, UI understanding, code understanding, diagram
 * reasoning, chart reasoning, and screenshot reasoning.
 *
 * Criteria are synonym GROUPS: a group is satisfied if ANY of its substrings
 * appears (case-insensitive) in the model's answer; a fixture's score is the
 * fraction of groups satisfied. `exactText` (OCR) is a hard gate — the strings
 * must appear verbatim. The benchmark applies the SAME production bar as the
 * other registries; nothing here lowers it.
 *
 * Usage: node scripts/gen-vision-fixtures.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'eval', 'vision-fixtures');
const EVAL_SET = join(HERE, '..', 'eval', 'migraai-vision-eval-set.json');

const W = 820;
const H = 600;
const frame = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
  `<rect width="${W}" height="${H}" fill="#ffffff"/>${body}</svg>`;
const text = (x, y, s, { size = 30, fill = '#111', mono = false, weight = 'normal', pre = false } = {}) =>
  `<text x="${x}" y="${y}" font-family="${mono ? 'DejaVu Sans Mono' : 'DejaVu Sans'}" font-size="${size}" ` +
  `font-weight="${weight}" fill="${fill}"${pre ? ' xml:space="preserve"' : ''}>${escapeXml(s)}</text>`;
const rect = (x, y, w, h, { fill = 'none', stroke = '#333', sw = 2, rx = 0 } = {}) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" rx="${rx}"/>`;
const line = (x1, y1, x2, y2, { stroke = '#333', sw = 2 } = {}) =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${sw}"/>` +
  `<polygon points="${x2},${y2} ${x2 - 8},${y2 - 5} ${x2 - 8},${y2 + 5}" fill="${stroke}"/>`; // arrowhead →

function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Fixtures (SVG + prompt + ground truth) ───────────────────────────────────
const FIXTURES = [
  {
    id: 'ocr-invoice',
    dimension: 'ocr',
    prompt: 'Read this document image and state the invoice number and the amount due exactly as shown.',
    svg: frame(
      text(60, 120, 'INVOICE #MG-4471', { size: 44, weight: 'bold' }) +
        text(60, 220, 'Bill To: Acme Robotics', { size: 34 }) +
        text(60, 300, 'Amount Due: $1,284.50', { size: 40, weight: 'bold' }) +
        text(60, 380, 'Due Date: 2026-08-15', { size: 34 }),
    ),
    criteria: [['MG-4471'], ['1,284.50', '1284.50'], ['acme']],
    exactText: ['MG-4471', '1,284.50'],
  },
  {
    id: 'ui-login',
    dimension: 'ui',
    prompt:
      'This is a UI screenshot. What screen is it, which input fields are present, and what is the primary button label?',
    svg: frame(
      rect(160, 70, 500, 470, { stroke: '#ccc', sw: 2, rx: 12, fill: '#fafafa' }) +
        text(210, 140, 'Sign in to MigraHosting', { size: 34, weight: 'bold' }) +
        text(210, 210, 'Email', { size: 26, fill: '#555' }) +
        rect(210, 225, 400, 46, { stroke: '#888', rx: 6 }) +
        text(210, 315, 'Password', { size: 26, fill: '#555' }) +
        rect(210, 330, 400, 46, { stroke: '#888', rx: 6 }) +
        rect(210, 415, 400, 52, { fill: '#2563eb', stroke: '#2563eb', rx: 8 }) +
        text(350, 449, 'Sign In', { size: 28, fill: '#ffffff', weight: 'bold' }) +
        text(210, 510, 'Forgot password?', { size: 24, fill: '#2563eb' }),
    ),
    criteria: [['sign in', 'login', 'log in'], ['email'], ['password'], ['forgot']],
  },
  {
    id: 'code-bug',
    dimension: 'code',
    prompt: 'This image shows a JavaScript function. Explain what it does and identify any bug.',
    svg: frame(
      rect(40, 50, 740, 500, { fill: '#1e1e1e', stroke: '#1e1e1e', rx: 8 }) +
        [
          'function sumItems(items) {',
          '  let total = 0;',
          '  for (let i = 0; i <= items.length; i++) {',
          '    total += items[i];',
          '  }',
          '  return total;',
          '}',
        ]
          .map((ln, i) => text(70, 120 + i * 44, ln, { size: 26, mono: true, fill: '#e6e6e6', pre: true }))
          .join(''),
    ),
    // Must recognize it sums an array AND flag the off-by-one boundary bug.
    criteria: [
      ['sum', 'total', 'add', 'adds'],
      ['bug', 'error', 'incorrect', 'off-by-one', 'off by one', 'out of'],
      ['<=', 'length', 'index', 'undefined', 'nan', 'one too many', 'beyond', 'boundary'],
    ],
  },
  {
    id: 'diagram-flow',
    dimension: 'diagram',
    prompt: 'Describe the process in this flowchart from start to end, including the decision branch(es).',
    svg: frame(
      // Start → Validate → decision → Approve / Reject
      rect(60, 60, 200, 60, { rx: 30, fill: '#eef' }) + text(105, 98, 'Start', { size: 28 }) +
        line(160, 120, 160, 160) +
        rect(60, 160, 200, 60, { fill: '#eef' }) + text(85, 198, 'Validate Input', { size: 24 }) +
        line(160, 220, 160, 260) +
        `<polygon points="160,260 280,320 160,380 40,320" fill="#ffe" stroke="#333" stroke-width="2"/>` +
        text(120, 328, 'Valid?', { size: 24 }) +
        line(280, 320, 420, 320) + text(300, 305, 'Yes', { size: 20, fill: '#080' }) +
        rect(420, 290, 180, 60, { fill: '#efe' }) + text(465, 328, 'Approve', { size: 26 }) +
        line(160, 380, 160, 440) + text(175, 415, 'No', { size: 20, fill: '#a00' }) +
        rect(60, 440, 200, 60, { fill: '#fee' }) + text(120, 478, 'Reject', { size: 26 }),
    ),
    criteria: [['start'], ['validate'], ['approve'], ['reject'], ['decision', 'valid', 'branch', 'if', 'yes', 'no']],
  },
  {
    id: 'chart-bars',
    dimension: 'chart',
    prompt:
      'This bar chart shows quarterly revenue. Which quarter is highest and roughly what value does it reach?',
    svg: frame(
      text(260, 60, 'Quarterly Revenue', { size: 32, weight: 'bold' }) +
        line(120, 500, 700, 500) + line(120, 120, 120, 500) +
        // bars: Q1=10 Q2=25 Q3=15 Q4=30 (scale: 12px per unit, baseline y=500)
        rect(160, 380, 90, 120, { fill: '#60a5fa', stroke: '#333' }) + text(185, 470, '10', { size: 24, fill: '#fff' }) + text(180, 535, 'Q1', { size: 26 }) +
        rect(290, 200, 90, 300, { fill: '#60a5fa', stroke: '#333' }) + text(315, 470, '25', { size: 24, fill: '#fff' }) + text(310, 535, 'Q2', { size: 26 }) +
        rect(420, 320, 90, 180, { fill: '#60a5fa', stroke: '#333' }) + text(445, 470, '15', { size: 24, fill: '#fff' }) + text(440, 535, 'Q3', { size: 26 }) +
        rect(550, 140, 90, 360, { fill: '#2563eb', stroke: '#333' }) + text(575, 470, '30', { size: 24, fill: '#fff' }) + text(570, 535, 'Q4', { size: 26 }),
    ),
    criteria: [['q4'], ['30'], ['highest', 'largest', 'most', 'tallest', 'maximum', 'peak']],
  },
  {
    id: 'screenshot-error',
    dimension: 'screenshot',
    prompt: 'This is an application screenshot. What went wrong, and what actions can the user take?',
    svg: frame(
      rect(140, 130, 540, 320, { fill: '#fbfbfb', stroke: '#bbb', sw: 2, rx: 10 }) +
        rect(140, 130, 540, 56, { fill: '#dc2626', stroke: '#dc2626', rx: 10 }) +
        text(170, 168, 'Deployment Failed', { size: 28, fill: '#fff', weight: 'bold' }) +
        text(175, 260, 'Error: port 3377 already in use', { size: 28 }) +
        rect(360, 360, 130, 52, { fill: '#2563eb', stroke: '#2563eb', rx: 8 }) + text(400, 394, 'Retry', { size: 26, fill: '#fff' }) +
        rect(520, 360, 130, 52, { fill: '#eee', stroke: '#999', rx: 8 }) + text(555, 394, 'Cancel', { size: 26 }),
    ),
    criteria: [['error', 'failed', 'fail'], ['3377', 'port'], ['retry'], ['cancel']],
  },
];

mkdirSync(OUT, { recursive: true });
const setEntries = [];
for (const fx of FIXTURES) {
  const svgPath = join(OUT, `${fx.id}.svg`);
  const pngPath = join(OUT, `${fx.id}.png`);
  writeFileSync(svgPath, fx.svg);
  execFileSync('convert', ['-background', 'white', svgPath, pngPath]);
  setEntries.push({
    id: fx.id,
    dimension: fx.dimension,
    image: `vision-fixtures/${fx.id}.png`,
    prompt: fx.prompt,
    criteria: fx.criteria,
    ...(fx.exactText ? { exactText: fx.exactText } : {}),
  });
  console.log(`✓ ${fx.id} (${fx.dimension}) → ${pngPath}`);
}

writeFileSync(
  EVAL_SET,
  JSON.stringify(
    {
      note: 'Deterministic MigraAI vision-qualification set. Generated by scripts/gen-vision-fixtures.mjs. Criteria are synonym groups (any-match, case-insensitive); exactText is a hard OCR gate. No secrets — synthetic fixtures only.',
      dimensions: ['ocr', 'ui', 'code', 'diagram', 'chart', 'screenshot'],
      fixtures: setEntries,
    },
    null,
    2,
  ) + '\n',
);
console.log(`\nWrote eval set → ${EVAL_SET} (${setEntries.length} fixtures)`);
