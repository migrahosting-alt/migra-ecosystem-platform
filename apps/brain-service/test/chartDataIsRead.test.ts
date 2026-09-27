import assert from 'node:assert/strict';
import test from 'node:test';
import JSZip from 'jszip';

import { parseChart, renderChart } from '../src/engine/rag/chartData.js';
import { extractPptx } from '../src/engine/rag/pptxText.js';

/**
 * A CHART IS DATA IN THE FILE, NOT A PICTURE TO BE GUESSED AT.
 *
 * 🚨 THE DEFECT. The product told a user "This deck contains charts, which cannot
 * be read as text." The disclosure was honest and the claim underneath it was
 * false: every chart carries its series, category labels and values in
 * `ppt/charts/chartN.xml`, with the last computed numbers in `<c:numCache>`. On
 * the real 31-slide deck, six charts were reported unreadable while their figures
 * sat in the package.
 *
 * WHY NOT VISION. Rasterising the slide and asking a model to read a bar chart
 * returns an approximation of a number that is already exact, and makes chart
 * reading depend on a GPU, a model qualification and a per-request inference.
 * These tests pin the deterministic path instead: exact values, stable across
 * runs, no model.
 *
 * The properties under test are the ones that make a wrong answer possible:
 * pairing a chart to the WRONG SLIDE, inventing a value where the data has a gap,
 * reporting a stored 0.35 as "0.35" where the slide says "35%", and claiming to
 * have read a chart whose values are not in the file at all.
 */

const numCache = (values: Array<number | ''>, formatCode?: string): string =>
  `<c:numRef><c:f>Sheet1!$B$2</c:f><c:numCache>` +
  (formatCode ? `<c:formatCode>${formatCode}</c:formatCode>` : '') +
  `<c:ptCount val="${values.length}"/>` +
  values.map((v, i) => (v === '' ? '' : `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`)).join('') +
  `</c:numCache></c:numRef>`;

const strCache = (values: string[]): string =>
  `<c:strRef><c:f>Sheet1!$A$2</c:f><c:strCache><c:ptCount val="${values.length}"/>` +
  values.map((v, i) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join('') +
  `</c:strCache></c:strRef>`;

const series = (name: string, cats: string[], vals: Array<number | ''>, formatCode?: string): string =>
  `<c:ser><c:tx>${strCache([name])}</c:tx>` +
  `<c:cat>${strCache(cats)}</c:cat><c:val>${numCache(vals, formatCode)}</c:val></c:ser>`;

const chartXml = (inner: string, title?: string): string =>
  `<?xml version="1.0"?><c:chartSpace xmlns:c="c" xmlns:a="a"><c:chart>` +
  (title ? `<c:title><c:tx><c:rich><a:p><a:r><a:t>${title}</a:t></a:r></a:p></c:rich></c:tx></c:title>` : '') +
  `<c:plotArea>${inner}</c:plotArea></c:chart></c:chartSpace>`;

test('🚨 exact values are read, with the float artefact removed', () => {
  /*
   * PowerPoint stores 2.2 as 2.2000000000000002. Printing that verbatim makes an
   * exact figure look like a sensor reading; rounding it away moves no real value.
   */
  const xml = chartXml(`<c:barChart><c:barDir val="col"/>` +
    series('Revenue', ['Q1', 'Q2'], [1.6, 2.2000000000000002]) + `</c:barChart>`);
  const p = parseChart(xml);
  assert.equal(p.ok, true);
  if (!p.ok) return;
  assert.deepEqual(p.chart.series[0]!.values, ['1.6', '2.2']);
  assert.deepEqual(p.chart.categories, ['Q1', 'Q2']);
});

test('🚨 a percentage is reported as the slide shows it, not as it is stored', () => {
  /*
   * The ONE format rule applied, because it changes what the number MEANS. A chart
   * showing 35% stores 0.35, and answering "0.35" where the slide says "35%" is a
   * wrong answer rather than a cosmetic difference.
   */
  const xml = chartXml(`<c:pieChart>` + series('Share', ['A', 'B'], [0.35, 0.65], '0.0%') + `</c:pieChart>`);
  const p = parseChart(xml);
  assert.equal(p.ok, true);
  if (!p.ok) return;
  assert.deepEqual(p.chart.series[0]!.values, ['35%', '65%']);
});

test('🚨 a gap in the data stays a gap — it never becomes zero', () => {
  /*
   * Charts legitimately skip periods. Filling a missing point with 0 invents a
   * data point that reads as a real low, which is the most damaging kind of
   * fabrication because it is numerically plausible.
   */
  const xml = chartXml(`<c:lineChart>` + series('Units', ['Jan', 'Feb', 'Mar'], [10, '', 30]) + `</c:lineChart>`);
  const p = parseChart(xml);
  assert.equal(p.ok, true);
  if (!p.ok) return;
  assert.deepEqual(p.chart.series[0]!.values, ['10', null, '30']);
  assert.match(renderChart(p.chart, 1), /Feb \| \(no value\)/);
});

test('🚨 a chart with references but NO cache is reported unread, with a reason', () => {
  /*
   * `<c:f>` alone is a formula pointing into a workbook. Claiming to have read it
   * would put invented numbers behind a citation — the worst available outcome.
   */
  const xml = chartXml(
    `<c:barChart><c:barDir val="col"/><c:ser><c:tx>${strCache(['S'])}</c:tx>` +
    `<c:cat><c:strRef><c:f>Sheet1!$A$2:$A$5</c:f></c:strRef></c:cat>` +
    `<c:val><c:numRef><c:f>Sheet1!$B$2:$B$5</c:f></c:numRef></c:val></c:ser></c:barChart>`,
  );
  const p = parseChart(xml);
  assert.equal(p.ok, false);
  if (p.ok) return;
  assert.match(p.reason, /not in this file/i);
});

test('an unfamiliar chart type is NAMED, not guessed at', () => {
  // A chart read as the wrong type gets its axes described backwards, which is
  // worse than declining to read it.
  const xml = chartXml(`<c:treemapChart>` + series('S', ['A'], [1]) + `</c:treemapChart>`);
  const p = parseChart(xml);
  assert.equal(p.ok, false);
  if (p.ok) return;
  assert.match(p.reason, /unsupported chart type \(treemapChart\)/);
});

test('bar and column are distinguished, because the reader sees a difference', () => {
  const col = parseChart(chartXml(`<c:barChart><c:barDir val="col"/>` + series('S', ['A'], [1]) + `</c:barChart>`));
  const bar = parseChart(chartXml(`<c:barChart><c:barDir val="bar"/>` + series('S', ['A'], [1]) + `</c:barChart>`));
  assert.equal(col.ok && col.chart.kind, 'column');
  assert.equal(bar.ok && bar.chart.kind, 'bar');
});

test('a scatter chart reads its x axis, so the numbers stay attributable', () => {
  // Scatter has no <c:cat>; its horizontal axis is <c:xVal>. Reporting values with
  // no labels would leave them unattributable.
  const xml = chartXml(
    `<c:scatterChart><c:ser><c:tx>${strCache(['Trend'])}</c:tx>` +
    `<c:xVal>${strCache(['1', '2'])}</c:xVal><c:yVal>${numCache([4, 9])}</c:yVal></c:ser></c:scatterChart>`,
  );
  const p = parseChart(xml);
  assert.equal(p.ok, true);
  if (!p.ok) return;
  assert.deepEqual(p.chart.categories, ['1', '2']);
  assert.deepEqual(p.chart.series[0]!.values, ['4', '9']);
});

test('multiple series render as a table with a header row', () => {
  /*
   * A table rather than prose, because retrieval chunks this text: "Q3 | 3.5"
   * survives chunking as a pair, while "revenue in Q3 was 3.5" can be cut between
   * the label and its number.
   */
  const xml = chartXml(`<c:lineChart>` +
    series('Plan', ['Q1', 'Q2'], [1, 2]) + series('Actual', ['Q1', 'Q2'], [3, 4]) + `</c:lineChart>`, 'Revenue');
  const p = parseChart(xml);
  assert.equal(p.ok, true);
  if (!p.ok) return;
  const rendered = renderChart(p.chart, 2);
  assert.match(rendered, /^Chart 2: Revenue \(line\)/m);
  assert.match(rendered, /^Category \| Plan \| Actual$/m);
  assert.match(rendered, /^Q2 \| 2 \| 4$/m);
});

test('XML entities are decoded, so a label is not read as markup', () => {
  const xml = chartVal('R&amp;D &lt;EU&gt;');
  const p = parseChart(xml);
  assert.equal(p.ok, true);
  if (!p.ok) return;
  assert.deepEqual(p.chart.categories, ['R&D <EU>']);
});

function chartVal(cat: string): string {
  return chartXml(`<c:barChart><c:barDir val="col"/>` + series('S', [cat], [1]) + `</c:barChart>`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Pairing a chart to its slide — the property that makes a citation trustworthy
// ─────────────────────────────────────────────────────────────────────────────

/** A deck where chart PART numbers deliberately disagree with slide numbers. */
async function deckWithCharts(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('ppt/presentation.xml',
    `<?xml version="1.0"?><p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst>` +
    `<p:sldId id="256" r:id="rA"/><p:sldId id="257" r:id="rB"/></p:sldIdLst></p:presentation>`);
  zip.file('ppt/_rels/presentation.xml.rels',
    `<?xml version="1.0"?><Relationships>` +
    `<Relationship Id="rA" Target="slides/slide1.xml"/>` +
    `<Relationship Id="rB" Target="slides/slide2.xml"/></Relationships>`);

  const slide = (chartRel: string) =>
    `<?xml version="1.0"?><p:sld xmlns:p="p" xmlns:a="a" xmlns:c="c" xmlns:r="r"><p:cSld><p:spTree>` +
    `<p:sp><p:nvSpPr><p:nvPr></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Body text</a:t></a:r></a:p></p:txBody></p:sp>` +
    `<p:graphicFrame><a:graphic><a:graphicData><c:chart r:id="${chartRel}"/></a:graphicData></a:graphic></p:graphicFrame>` +
    `</p:spTree></p:cSld></p:sld>`;

  zip.file('ppt/slides/slide1.xml', slide('rId9'));
  zip.file('ppt/slides/slide2.xml', slide('rId9'));
  /*
   * 🚨 THE TRAP. Slide 1 points at chart2.xml and slide 2 points at chart1.xml.
   * Pairing by number — chartN for slide N — would swap them, and a swapped figure
   * under a slide citation reads as evidence.
   */
  zip.file('ppt/slides/_rels/slide1.xml.rels',
    `<?xml version="1.0"?><Relationships><Relationship Id="rId9" Target="../charts/chart2.xml"/></Relationships>`);
  zip.file('ppt/slides/_rels/slide2.xml.rels',
    `<?xml version="1.0"?><Relationships><Relationship Id="rId9" Target="../charts/chart1.xml"/></Relationships>`);

  zip.file('ppt/charts/chart1.xml',
    chartXml(`<c:lineChart>` + series('S', ['X'], [111]) + `</c:lineChart>`, 'BELONGS TO SLIDE TWO'));
  zip.file('ppt/charts/chart2.xml',
    chartXml(`<c:barChart><c:barDir val="col"/>` + series('S', ['X'], [222]) + `</c:barChart>`, 'BELONGS TO SLIDE ONE'));
  return zip.generateAsync({ type: 'nodebuffer' });
}

test('🚨 a chart is attached to ITS OWN slide, resolved through the rels', async () => {
  const out = await extractPptx(await deckWithCharts());
  /*
   * No leading empty element: the text STARTS with the delimiter, so a lookahead
   * split yields [slide1, slide2]. The first version discarded the first element
   * and compared slide 2 against slide 1's expectation — the test was wrong and
   * the pairing was right, which is the failure worth being careful about.
   */
  const [one, two] = out.text.split(/(?=--- Slide )/);

  assert.match(one!, /BELONGS TO SLIDE ONE/, 'slide 1 got the wrong chart — paired by number');
  assert.match(one!, /222/);
  assert.match(two!, /BELONGS TO SLIDE TWO/, 'slide 2 got the wrong chart — paired by number');
  assert.match(two!, /111/);
  assert.ok(!one!.includes('111'), "slide 1 carries slide 2's figure");
});

test('🚨 hasUnreadCharts means "could not read one", not "has charts"', async () => {
  /*
   * It used to be set by the mere PRESENCE of a chart part, which made every
   * charted deck permanently unreadable-in-part while its figures sat in those
   * parts. The real 31-slide deck reported six unreadable charts on that basis.
   */
  const out = await extractPptx(await deckWithCharts());
  assert.equal(out.hasUnreadCharts, false, 'a deck whose charts were all read claims otherwise');
  assert.deepEqual(out.unreadCharts, []);
});

test('an unreadable chart names its slide and its reason, and does not fail the deck', async () => {
  const zip = await JSZip.loadAsync(await deckWithCharts());
  // Replace slide 1's chart with one whose values live only in a workbook.
  zip.file('ppt/charts/chart2.xml', chartXml(
    `<c:barChart><c:barDir val="col"/><c:ser><c:tx>${strCache(['S'])}</c:tx>` +
    `<c:val><c:numRef><c:f>Sheet1!$B$2</c:f></c:numRef></c:val></c:ser></c:barChart>`));
  const out = await extractPptx(await zip.generateAsync({ type: 'nodebuffer' }));

  assert.equal(out.hasUnreadCharts, true);
  assert.equal(out.unreadCharts.length, 1);
  assert.match(out.unreadCharts[0]!, /^Slide 1, chart 1: .*not in this file/i);
  // The rest of the deck still reads — 30 readable slides beat an exception.
  assert.match(out.text, /BELONGS TO SLIDE TWO/);
  assert.equal(out.slideCount, 2);
});

test('a malformed chart part does not throw away the whole deck', async () => {
  const zip = await JSZip.loadAsync(await deckWithCharts());
  zip.file('ppt/charts/chart2.xml', 'not xml at all <<<');
  const out = await extractPptx(await zip.generateAsync({ type: 'nodebuffer' }));

  assert.equal(out.slideCount, 2, 'the deck failed because one chart was broken');
  assert.equal(out.hasUnreadCharts, true);
  assert.match(out.unreadCharts.join(' '), /Slide 1/);
});
