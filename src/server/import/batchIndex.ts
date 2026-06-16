/**
 * BATCH INDEX BUILDER
 *
 * Stage 3a of the Import Intelligence Pipeline.
 *
 * What this does:
 * Scans ALL rows in the import batch BEFORE any DB check and builds lookup maps
 * (indexes) from identifiers to row indices. This lets us detect duplicates
 * WITHIN the same uploaded file in O(1) per lookup.
 *
 * Why this must run before DB checks:
 * If Row 1 and Row 17 both have PMID 38910016 and the project DB is empty,
 * record-level deduplication alone would successfully insert BOTH rows — because
 * when Row 1 is processed, Row 17 doesn't exist in the DB yet, and vice versa.
 * The batch index catches this before any row touches the database.
 *
 * Time complexity: O(n) to build, O(1) per lookup.
 * Space complexity: O(n) for n rows.
 */

import { type BatchIndex, type NormalizedRow } from "./types";

/**
 * Build a BatchIndex from all normalized rows.
 *
 * The index maps each identifier value to the list of row indices that share it.
 * If a value maps to more than one row index, those rows are batch-level duplicates.
 *
 * Only non-null identifiers are indexed — null means "no identifier", not a value.
 */
export function buildBatchIndex(rows: NormalizedRow[]): BatchIndex {
  const byPmid = new Map<string, number[]>();
  const byDoi = new Map<string, number[]>();
  const byPmcid = new Map<string, number[]>();
  const byNihmsId = new Map<string, number[]>();

  for (const row of rows) {
    // Index by PMID
    if (row.pmid) {
      const existing = byPmid.get(row.pmid) ?? [];
      existing.push(row.rowIndex);
      byPmid.set(row.pmid, existing);
    }

    // Index by DOI (already normalized/lowercased by normalize.ts)
    if (row.doi) {
      const existing = byDoi.get(row.doi) ?? [];
      existing.push(row.rowIndex);
      byDoi.set(row.doi, existing);
    }

    // Index by PMCID
    if (row.pmcid) {
      const existing = byPmcid.get(row.pmcid) ?? [];
      existing.push(row.rowIndex);
      byPmcid.set(row.pmcid, existing);
    }

    // Index by NIHMS ID
    if (row.nihmsId) {
      const existing = byNihmsId.get(row.nihmsId) ?? [];
      existing.push(row.rowIndex);
      byNihmsId.set(row.nihmsId, existing);
    }
  }

  return { byPmid, byDoi, byPmcid, byNihmsId };
}

/**
 * Given a row and a batch index, find the first earlier row that shares
 * an exact identifier with this row.
 *
 * Returns the conflicting row index if found, null otherwise.
 * We look for "earlier" rows (lower rowIndex) to establish a "first wins" policy:
 * the first occurrence of a PMID/DOI in the batch is kept; later occurrences
 * are flagged as batch-level duplicates.
 *
 * Why "first wins": It's deterministic and researcher-intuitive.
 * The researcher uploaded the file in order; the first occurrence is the "original."
 */
export function findBatchDuplicate(
  row: NormalizedRow,
  index: BatchIndex,
): { field: "pmid" | "doi" | "pmcid" | "nihmsId"; conflictingRowIndex: number } | null {
  // Check PMID (highest priority identifier)
  if (row.pmid) {
    const rows = index.byPmid.get(row.pmid) ?? [];
    const earlier = rows.filter((r) => r < row.rowIndex);
    if (earlier.length > 0) {
      return { field: "pmid", conflictingRowIndex: earlier[0]! };
    }
  }

  // Check DOI
  if (row.doi) {
    const rows = index.byDoi.get(row.doi) ?? [];
    const earlier = rows.filter((r) => r < row.rowIndex);
    if (earlier.length > 0) {
      return { field: "doi", conflictingRowIndex: earlier[0]! };
    }
  }

  // Check PMCID
  if (row.pmcid) {
    const rows = index.byPmcid.get(row.pmcid) ?? [];
    const earlier = rows.filter((r) => r < row.rowIndex);
    if (earlier.length > 0) {
      return { field: "pmcid", conflictingRowIndex: earlier[0]! };
    }
  }

  // Check NIHMS ID (lowest priority — least unique identifier)
  if (row.nihmsId) {
    const rows = index.byNihmsId.get(row.nihmsId) ?? [];
    const earlier = rows.filter((r) => r < row.rowIndex);
    if (earlier.length > 0) {
      return { field: "nihmsId", conflictingRowIndex: earlier[0]! };
    }
  }

  return null;
}
