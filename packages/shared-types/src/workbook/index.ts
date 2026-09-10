/**
 * THE WORKBOOK READER — one authority, two consumers.
 *
 * ---------------------------------------------------------------------------
 * 🚨 WHY THIS MOVED OUT OF THE CONSUMER APP
 *
 * The reader was built for the consumer's table lane, where a sheet becomes the
 * same ParsedTable a CSV becomes. Then the Brain needed to read a spreadsheet
 * too — a .xlsx arriving as a mail attachment — and the shortest path was a
 * second reader inside the Brain.
 *
 * Two readers is the wrong number. They would agree on the day they were
 * written and disagree the first time either learned something: a new number
 * format, a workbook whose first sheet is `sheet3.xml`, a shared string split
 * across styled runs. The product would then say one thing about a file when
 * you upload it and another about the same file when you email it.
 *
 * So the READER is shared and the two lanes keep what is genuinely theirs: the
 * consumer classifies cells for arithmetic, the Brain renders them as evidence.
 */

export {
  readWorkbook, WorkbookError,
  type Workbook, type WorkbookCell, type WorkbookSheet, type NumberFormat,
} from './readWorkbook.js';
export { looksLikeZip, ZipError } from './zipReader.js';
export { workbookText, type WorkbookText } from './workbookText.js';
export { excelSerialToIso } from './serialDate.js';
