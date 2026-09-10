/**
 * A WORKBOOK, AS EVIDENCE.
 *
 * ---------------------------------------------------------------------------
 * 🚨 WHY THIS IS NOT `renderCellText`
 *
 * The consumer already renders cells — for its CLASSIFIER, which decides
 * whether a column is quantitative and may be totalled. That renderer tidies:
 * it puts a number through `Number(n.toPrecision(12))` so that 0.1275 * 100
 * stops being 12.750000000000002. Exactly right for arithmetic.
 *
 * Exactly wrong for evidence. Evidence is matched against an answer token for
 * token, so a value that re-renders even slightly differently from the file is
 * a value the grounding gate cannot find — and the user is told their
 * spreadsheet does not say the thing it plainly says. `1.10` tidies to `1.1`;
 * an eighteen-digit account number tidies to a rounded one.
 *
 * So a number is emitted as the LITERAL the sheet stores, which the reader has
 * already preserved on the cell. Not a second opinion about what the file
 * contains — a different question asked of the same reading.
 *
 * ---------------------------------------------------------------------------
 * 🚨 DATES ARE THE EXCEPTION, AND FOR THE SAME REASON
 *
 * Excel stores a date as a day count. The literal is exact and useless: nobody
 * grounds "dated 1 September" in `46266`. The reader has already decided which
 * cells are date-FORMATTED — read from the file, never guessed from the value,
 * because every date serial is also a perfectly ordinary number.
 */

import { type WorkbookCell, type WorkbookSheet } from './readWorkbook.js';
import { excelSerialToIso } from './serialDate.js';

export interface WorkbookText {
  /** Sheet-labelled, tab-separated. */
  text: string;
  /**
   * 🚨 False when the cap cut the workbook short.
   *
   * Carried out to the evidence layer, where it becomes the caveat on any
   * answer drawn from it. A truncated sheet must never read as a whole one —
   * "the spreadsheet lists three suppliers" is a different sentence when there
   * were four and the reader stopped at three.
   */
  complete: boolean;
  /** Sheet names in workbook order, including any that were cut off. */
  sheets: string[];
}

/**
 * The most cells worth turning into text.
 *
 * A spreadsheet is the attachment type most likely to be enormous, and the
 * failure of no cap is not a slow answer — it is one source crowding every
 * other out of the model's context.
 */
const MAX_CELLS = 20_000;

export function workbookText(
  sheets: readonly WorkbookSheet[],
  opts: { maxCells?: number } = {},
): WorkbookText {
  let budget = opts.maxCells ?? MAX_CELLS;
  const out: string[] = [];
  const names: string[] = [];

  for (const sheet of sheets) {
    names.push(sheet.name);
    // A heading even for an empty sheet: "Sheet2 has nothing in it" is a fact an
    // answer may need, and an omitted sheet reads as one never opened.
    out.push(`## ${sheet.name}`);

    for (const row of sheet.rows) {
      if (budget <= 0) break;
      const cells: string[] = [];
      for (const cell of row) {
        if (budget <= 0) break;
        cells.push(cellText(cell));
        budget -= 1;
      }
      // Trailing empties carry nothing. The reader has already padded the gaps
      // INSIDE a row, so column positions are intact.
      while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
      out.push(cells.join('\t'));
    }
    if (budget <= 0) break;
  }

  while (out.length > 0 && out[out.length - 1] === '') out.pop();
  return { text: out.join('\n'), complete: budget > 0, sheets: names };
}

function cellText(cell: WorkbookCell): string {
  if (cell.number === undefined) return cell.text;

  if (cell.format === 'date') {
    const iso = excelSerialToIso(cell.number);
    // A serial that is not a plausible date falls back to its own digits rather
    // than inventing a date.
    if (iso) return iso;
  }
  if (cell.format === 'percent') {
    /*
     * The sheet stores 0.1275 and DISPLAYS 12.75%. Emitting the stored fraction
     * would make "a 12.75% fee" ungroundable against a file that shows exactly
     * that — the one case where the literal is not what the document says.
     */
    return `${trimFloatNoise(cell.number * 100)}%`;
  }
  if (cell.format === 'currency' && cell.currencySymbol) {
    // The symbol the sheet actually formats with — never a default, which would
    // relabel a euro column as dollars.
    return `${cell.currencySymbol}${cell.text}`;
  }
  // 🚨 The literal. See the note at the top of the file.
  return cell.text;
}

/**
 * Only for values this module COMPUTED (a percentage), never for one the file
 * stored. 0.1275 * 100 is 12.750000000000002 in binary floating point, and that
 * is an artefact of the multiplication, not something the sheet says.
 */
function trimFloatNoise(n: number): string {
  return String(Number(n.toPrecision(12)));
}
