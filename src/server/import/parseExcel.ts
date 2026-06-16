/**
 * EXCEL PARSER
 *
 * Reads an Excel (.xlsx) file and converts it to RawRow objects
 * that the import engine can process.
 *
 * What this does:
 * 1. Parse the Excel file using SheetJS (xlsx library)
 * 2. Map column headers to our expected field names
 * 3. Convert each data row to a RawRow with rowIndex assigned
 * 4. Return all RawRows — NO validation happens here
 *
 * Why parsing is completely separate from validation:
 * The parser's job is mechanical — extract data from Excel.
 * The engine's job is intelligent — validate and classify.
 * Keeping them separate means: if we add CSV support later,
 * we only write a new parser, not a new engine.
 *
 * Why SheetJS (xlsx library):
 * - Industry standard for Excel parsing in Node.js
 * - Handles .xlsx (OOXML), .xls (legacy BIFF), and .csv
 * - Returns clean JavaScript objects we can type-check
 * - No native dependencies — pure JavaScript, works on Lambda
 *
 * Alternative considered: exceljs
 * More feature-rich but heavier. We only need reading, not writing.
 * SheetJS is the right tool for read-only Excel parsing.
 */

import * as XLSX from "xlsx";
import { type RawRow } from "./types";

/**
 * Column name mapping: Excel header → our internal field name.
 * PubMed export column names are inconsistent — this map handles variations.
 *
 * Why a map instead of relying on exact column names:
 * Different PubMed export versions or configurations may use slightly different
 * column headers. The map handles common variations so the import doesn't
 * break if a header has slightly different casing or spacing.
 */
const COLUMN_MAP: Record<string, keyof Omit<RawRow, "rowIndex">> = {
  // PMID variations
  pmid: "pmid",
  "pubmed id": "pmid",
  "pubmed_id": "pmid",

  // Title variations
  title: "title",

  // Authors variations
  authors: "authors",
  author: "authors",

  // Citation
  citation: "citation",

  // First Author
  "first author": "firstAuthor",
  "first_author": "firstAuthor",
  firstauthor: "firstAuthor",

  // Journal
  "journal/book": "journal",
  journal: "journal",
  "journal book": "journal",

  // Publication Year
  "publication year": "pubYear",
  "publication_year": "pubYear",
  "pub year": "pubYear",
  year: "pubYear",

  // Create Date
  "create date": "createDate",
  "create_date": "createDate",
  createdate: "createDate",

  // PMCID
  pmcid: "pmcid",
  "pmc id": "pmcid",

  // NIHMS ID
  "nihms id": "nihmsId",
  "nihms_id": "nihmsId",
  nihmsid: "nihmsId",

  // DOI
  doi: "doi",
};

/**
 * Normalize a column header for lookup in COLUMN_MAP.
 * Converts to lowercase and strips extra whitespace.
 */
function normalizeHeader(header: string): string {
  return header.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Parse an Excel file buffer into an array of RawRows.
 *
 * @param buffer - The raw file buffer (from file upload or fs.readFile)
 * @returns Array of RawRow objects, one per data row in the Excel file
 * @throws Error if the file cannot be parsed or has no recognizable headers
 */
export function parseExcelBuffer(buffer: Buffer): RawRow[] {
  // Parse the Excel file
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    cellDates: false,    // Keep dates as strings — we handle date parsing ourselves
    raw: false,          // Apply number format (so years come as "2024" not "2024.0")
  });

  // Use the first sheet
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error("Excel file has no sheets.");
  }

  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new Error(`Sheet "${sheetName}" not found.`);
  }

  // Convert sheet to array of arrays (raw values)
  // header: 1 means first row is NOT treated as headers — we handle that manually
  const rawData = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
    header: 1,
    defval: null,
    blankrows: false,
  });

  if (rawData.length < 2) {
    throw new Error("Excel file has no data rows (only headers or empty).");
  }

  // First row is the header row
  const headerRow = rawData[0] as (string | null)[];

  // Map header indices to field names
  const headerMap: Record<number, keyof Omit<RawRow, "rowIndex">> = {};

  for (let i = 0; i < headerRow.length; i++) {
    const header = headerRow[i];
    if (!header) continue;
    const normalizedHeader = normalizeHeader(String(header));
    const fieldName = COLUMN_MAP[normalizedHeader];
    if (fieldName) {
      headerMap[i] = fieldName;
    }
  }

  if (Object.keys(headerMap).length === 0) {
    throw new Error(
      "No recognized column headers found. Expected PubMed-style columns: PMID, Title, Authors, DOI, etc.",
    );
  }

  // Convert data rows to RawRow objects
  // rowIndex is 1-based and corresponds to the Excel row number (row 1 is headers)
  const rows: RawRow[] = [];

  for (let rowIdx = 1; rowIdx < rawData.length; rowIdx++) {
    const dataRow = rawData[rowIdx] as (string | number | null)[];

    // Skip completely empty rows
    const hasAnyValue = dataRow.some((cell) => cell !== null && cell !== "");
    if (!hasAnyValue) continue;

    const rawRow: RawRow = {
      rowIndex: rowIdx + 1, // +1 because Excel row 1 is headers, row 2 is first data row
      pmid: null,
      title: null,
      authors: null,
      citation: null,
      firstAuthor: null,
      journal: null,
      pubYear: null,
      createDate: null,
      pmcid: null,
      nihmsId: null,
      doi: null,
    };

    for (const [colIdxStr, fieldName] of Object.entries(headerMap)) {
      const colIdx = parseInt(colIdxStr, 10);
      const cellValue = dataRow[colIdx] ?? null;

      // Convert to appropriate type for the field
      if (cellValue !== null && cellValue !== "") {
        // pubYear can be a number or string — keep as-is for normalize.ts to handle
        // Everything else we convert to string
        if (fieldName === "pubYear") {
          rawRow.pubYear = typeof cellValue === "number" ? cellValue : String(cellValue);
        } else {
          rawRow[fieldName] = String(cellValue) as never;
        }
      }
    }

    rows.push(rawRow);
  }

  return rows;
}
