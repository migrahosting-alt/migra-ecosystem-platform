/**
 * Reading the CHARTS in a deck — from their data, not from a picture of them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🚨 A PPTX CHART IS NOT AN IMAGE, AND TREATING IT AS ONE WAS THE WHOLE PROBLEM.
 *
 * The product told a user "This deck contains charts, which cannot be read as
 * text." That disclosure was honest and the underlying claim was false: every
 * chart carries its own series, category labels and numeric values in
 * `ppt/charts/chartN.xml`, and PowerPoint keeps the last computed values in
 * `<c:numCache>` right beside the formula reference. The numbers were in the file
 * the entire time.
 *
 * WHY THIS IS NOT A VISION PROBLEM. Rasterising a slide and asking a vision model
 * to read a bar chart gives an approximation of a number that is already exact in
 * the file, and it would make chart reading depend on a GPU, a model
 * qualification, and a per-request inference. Reading the XML is deterministic,
 * exact, needs no model, and cannot drift between runs — the difference between
 * "revenue was about 3.5" and "revenue was 3.5".
 *
 * ── WHAT THIS DELIBERATELY DOES NOT DO ──
 *
 * It does not emulate Excel number formatting. It applies exactly one format rule
 * — PERCENTAGES — because that one changes what the number MEANS: a chart showing
 * 35% stores 0.35, and reporting "0.35" where the slide says "35%" is a wrong
 * answer, not a cosmetic difference. Thousands separators, currency symbols and
 * decimal places are cosmetic and are left alone rather than half-emulated.
 *
 * It does not invent values. A chart whose data lives only in an external
 * workbook, or whose type this does not understand, is reported as UNREAD with a
 * reason — per chart, never as a blanket flag over the deck. "Six charts, five
 * read, one unreadable because it references an external workbook" is an answer;
 * "this deck contains charts" is not.
 */

/** One series: its name, and one value per category. */
export interface ChartSeries {
  /** The series name as the deck shows it, or a positional fallback. */
  name: string;
  /** Rendered values, aligned to `categories` by index. `null` = a gap in the data. */
  values: Array<string | null>;
}

export interface ChartReading {
  /** The chart's own title, when it has one. */
  title?: string;
  /** `bar`, `column`, `line`, `pie`, … or `unknown` when the type is unfamiliar. */
  kind: string;
  categories: string[];
  series: ChartSeries[];
}

export type ChartParse =
  | { ok: true; chart: ChartReading }
  /**
   * WHY A REASON AND NOT A BOOLEAN. The product has to tell a user which charts it
   * could not read and why, and "unreadable" covers cases with opposite remedies:
   * an external workbook the deck does not contain, versus a chart type nobody has
   * taught this to read yet.
   */
  | { ok: false; reason: string };

/** Chart-type elements, mapped to words a reader would recognise. */
const KINDS: Array<[RegExp, string]> = [
  [/<c:bar3DChart\b/, 'bar'],
  [/<c:barChart\b/, 'bar'],
  [/<c:line3DChart\b/, 'line'],
  [/<c:lineChart\b/, 'line'],
  [/<c:pie3DChart\b/, 'pie'],
  [/<c:ofPieChart\b/, 'pie'],
  [/<c:pieChart\b/, 'pie'],
  [/<c:doughnutChart\b/, 'doughnut'],
  [/<c:area3DChart\b/, 'area'],
  [/<c:areaChart\b/, 'area'],
  [/<c:scatterChart\b/, 'scatter'],
  [/<c:bubbleChart\b/, 'bubble'],
  [/<c:radarChart\b/, 'radar'],
  [/<c:stockChart\b/, 'stock'],
  [/<c:surface3DChart\b/, 'surface'],
  [/<c:surfaceChart\b/, 'surface'],
];

const unescapeXml = (s: string): string =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');

/** Every `<c:pt idx="n"><c:v>…` in a cache, indexed by `idx`. */
function cachePoints(cacheXml: string): Map<number, string> {
  const out = new Map<number, string>();
  for (const m of cacheXml.matchAll(/<c:pt[^>]*idx="(\d+)"[^>]*>\s*<c:v>([\s\S]*?)<\/c:v>/g)) {
    out.set(Number(m[1]), unescapeXml(m[2]!.trim()));
  }
  return out;
}

/**
 * A number as a person would read it, not as a float prints.
 *
 * `2.2000000000000002` is what the file holds for 2.2 — a binary artefact of the
 * value PowerPoint stored, not a precise measurement. Printing it verbatim makes
 * an exact figure look like a sensor reading, so it is round-tripped through 14
 * significant digits, which removes the artefact without moving any real value.
 */
function renderNumber(raw: string, formatCode: string | undefined): string | null {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const isPercent = !!formatCode && formatCode.includes('%');
  const value = isPercent ? n * 100 : n;
  const cleaned = Number.parseFloat(value.toPrecision(14));
  return isPercent ? `${cleaned}%` : String(cleaned);
}

/** The first `<c:tx>` string in a series block — its name. */
function seriesName(serXml: string, position: number): string {
  const tx = /<c:tx>([\s\S]*?)<\/c:tx>/.exec(serXml)?.[1];
  const cached = tx ? [...cachePoints(tx).values()][0] : undefined;
  // A positional fallback, because an unnamed series still has to be referable.
  return cached && cached.length ? cached : `Series ${position}`;
}

/**
 * Category labels for a series.
 *
 * Scatter and bubble charts have no `<c:cat>` — their horizontal axis is
 * `<c:xVal>` — so that is read instead rather than reporting a chart with values
 * and no labels, which would leave the numbers unattributable.
 */
function categoriesOf(serXml: string): string[] {
  const block =
    /<c:cat>([\s\S]*?)<\/c:cat>/.exec(serXml)?.[1] ??
    /<c:xVal>([\s\S]*?)<\/c:xVal>/.exec(serXml)?.[1];
  if (!block) return [];
  const points = cachePoints(block);
  if (points.size === 0) return [];
  const count = Math.max(...points.keys()) + 1;
  return Array.from({ length: count }, (_, i) => points.get(i) ?? '');
}

/** Numeric values for a series, aligned to its categories. */
function valuesOf(serXml: string, categoryCount: number): Array<string | null> {
  const block =
    /<c:val>([\s\S]*?)<\/c:val>/.exec(serXml)?.[1] ??
    /<c:yVal>([\s\S]*?)<\/c:yVal>/.exec(serXml)?.[1];
  if (!block) return [];
  const formatCode = /<c:formatCode>([\s\S]*?)<\/c:formatCode>/.exec(block)?.[1];
  const points = cachePoints(block);
  if (points.size === 0) return [];
  const count = Math.max(categoryCount, Math.max(...points.keys()) + 1);
  return Array.from({ length: count }, (_, i) => {
    const raw = points.get(i);
    // A missing point is a GAP, not a zero. Charts legitimately skip periods, and
    // filling one with 0 invents a data point that would be read as a real low.
    return raw === undefined || raw === '' ? null : renderNumber(raw, formatCode);
  });
}

/**
 * Parse one `ppt/charts/chartN.xml`.
 *
 * 🚨 READ FROM THE CACHE, AND SAY SO WHEN THERE IS NONE. `<c:numCache>` holds the
 * values as last computed; `<c:f>` alone is a formula pointing into a workbook.
 * A chart with references but no cache cannot be read from this file, and
 * pretending otherwise would put invented numbers behind a citation.
 */
export function parseChart(xml: string): ChartParse {
  const kind = KINDS.find(([re]) => re.test(xml))?.[1];
  const serBlocks = [...xml.matchAll(/<c:ser>([\s\S]*?)<\/c:ser>/g)].map((m) => m[1]!);

  if (serBlocks.length === 0) {
    return { ok: false, reason: 'the chart part contains no data series' };
  }
  if (!kind) {
    /*
     * The type is named rather than guessed. A chart read as the wrong type gets
     * its axes described backwards, which is worse than declining to read it.
     */
    const seen = /<c:(\w+Chart)\b/.exec(xml)?.[1];
    return { ok: false, reason: `unsupported chart type${seen ? ` (${seen})` : ''}` };
  }

  // The chart's own title, not an axis title: the first c:title before any axis.
  const titleBlock = /<c:title>([\s\S]*?)<\/c:title>/.exec(xml)?.[1];
  const title = titleBlock
    ? [...titleBlock.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => unescapeXml(m[1]!)).join('').trim()
    : '';

  const categories = categoriesOf(serBlocks[0]!);
  const series: ChartSeries[] = [];
  for (const [i, ser] of serBlocks.entries()) {
    const values = valuesOf(ser, categories.length);
    if (values.length === 0) continue;
    series.push({ name: seriesName(ser, i + 1), values });
  }

  if (series.length === 0) {
    return {
      ok: false,
      reason: 'the chart stores only formula references, so its values are not in this file',
    };
  }

  // Horizontal bars and vertical columns are the same element; only barDir separates
  // them, and calling a column chart a bar chart misdescribes what the reader sees.
  const barDir = /<c:barDir[^>]*val="(col|bar)"/.exec(xml)?.[1];
  const resolvedKind = kind === 'bar' && barDir === 'col' ? 'column' : kind;

  return {
    ok: true,
    chart: { ...(title ? { title } : {}), kind: resolvedKind, categories, series },
  };
}

/**
 * A chart as lines of text a model can read and quote.
 *
 * Rendered as a LABELLED TABLE rather than prose. The retrieval layer chunks this
 * text and a model answers from it, so "Q3 | 3.5" survives chunking as a pair
 * while "revenue in Q3 was 3.5 and in Q4 was 5.8" degrades into a sentence that
 * can be cut between the label and its number.
 *
 * The `Chart` prefix is deliberate: without it a model cannot distinguish figures
 * that were plotted from figures written in the slide's body text, and a reader
 * asking "what does the chart show" deserves the chart.
 */
export function renderChart(chart: ChartReading, position: number): string {
  const head = `Chart ${position}${chart.title ? `: ${chart.title}` : ''} (${chart.kind})`;
  const lines = [head];

  const multi = chart.series.length > 1;
  if (multi) lines.push(['Category', ...chart.series.map((s) => s.name)].join(' | '));

  const rows = Math.max(chart.categories.length, ...chart.series.map((s) => s.values.length));
  for (let i = 0; i < rows; i += 1) {
    const label = chart.categories[i] ?? `Item ${i + 1}`;
    const cells = chart.series.map((s) => s.values[i] ?? '(no value)');
    lines.push([label, ...cells].join(' | '));
  }

  // A single unnamed series needs no column header; a named one is worth stating
  // because it is often the unit ("Revenue (USD m)").
  if (!multi && chart.series[0] && !/^Series \d+$/.test(chart.series[0].name)) {
    lines.splice(1, 0, `Series: ${chart.series[0].name}`);
  }
  return lines.join('\n');
}
