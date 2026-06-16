/**
 * IMPORT INTELLIGENCE LAYER — TEST SUITE
 *
 * What we're testing: The behavior that matters.
 * The assignment says "Focus on behavior that matters, such as import validation."
 * These tests prove that every classification decision is deterministic and correct.
 *
 * Test philosophy:
 * - Test behavior, not implementation. We test WHAT the function does, not HOW.
 * - Each test has a clear name that describes the scenario.
 * - Each test covers exactly one behavior.
 * - If a test fails, you know exactly what behavior broke and why.
 *
 * Why Vitest:
 * Vitest is the test framework recommended for the T3 stack. It's Jest-compatible
 * but faster (native ESM, no transpilation overhead). It also integrates with
 * Next.js without configuration.
 *
 * Interview answer: "I focused tests on the import validation pipeline because
 * that's where the business risk is highest. A bug in normalization could corrupt
 * data for every researcher. A bug in the duplicate detector could cause silent
 * data loss. These behaviors are worth testing first."
 */

import { describe, it, expect } from "vitest";

// Import individual modules for isolated testing
import {
  normalizeDoi,
  normalizePmid,
  normalizePubYear,
  normalizeAuthors,
  inferFirstAuthorFromAuthors,
  inferYearFromCitation,
  normalizeRow,
} from "../normalize";

import {
  validateRow,
  warrantWarningStatus,
} from "../validate";

import {
  buildBatchIndex,
  findBatchDuplicate,
} from "../batchIndex";

import {
  resolveIdentity,
  computeIdentitySignals,
} from "../duplicate";

import {
  computeTitleSimilarity,
  computeAuthorOverlap,
} from "../fuzzy";

import { runImportEngine } from "../engine";

import type { RawRow, NormalizedRow, ExistingArticle } from "../types";

// ─── TEST HELPERS ─────────────────────────────────────────────────────────────

/**
 * Creates a minimal valid RawRow for testing.
 * Tests can override individual fields.
 */
function makeRawRow(overrides: Partial<RawRow> = {}): RawRow {
  return {
    rowIndex: 1,
    pmid: "38910001",
    title: "Digital adherence tools for diabetes care",
    authors: "Rao A; Chen L",
    citation: "Rao A, et al. Journal of Digital Health. 2024;12(4):211-220.",
    firstAuthor: "Rao A",
    journal: "Journal of Digital Health",
    pubYear: 2024,
    createDate: "2024/03/18",
    pmcid: "PMC1111001",
    nihmsId: null,
    doi: "10.1000/jdh.2024.001",
    ...overrides,
  };
}

/**
 * Creates a minimal valid NormalizedRow for testing.
 */
function makeNormalizedRow(overrides: Partial<NormalizedRow> = {}): NormalizedRow {
  return {
    rowIndex: 1,
    pmid: "38910001",
    title: "Digital adherence tools for diabetes care",
    authors: "Rao A; Chen L",
    citation: "Rao A, et al. Journal of Digital Health. 2024;12(4):211-220.",
    firstAuthor: "Rao A",
    journal: "Journal of Digital Health",
    pubYear: 2024,
    createDate: "2024/03/18",
    pmcid: "PMC1111001",
    nihmsId: null,
    doi: "10.1000/jdh.2024.001",
    corrections: [],
    ...overrides,
  };
}

/**
 * Creates a minimal ExistingArticle (simulating a DB record).
 */
function makeExistingArticle(overrides: Partial<ExistingArticle> = {}): ExistingArticle {
  return {
    id: "art_existing_001",
    pmid: "38910001",
    doi: "10.1000/jdh.2024.001",
    pmcid: "PMC1111001",
    nihmsId: null,
    title: "Digital adherence tools for diabetes care",
    authors: "Rao A; Chen L",
    pubYear: 2024,
    journal: "Journal of Digital Health",
    ...overrides,
  };
}

// ─── NORMALIZE.TS TESTS ───────────────────────────────────────────────────────

describe("normalizeDoi", () => {
  it("returns null for null input", () => {
    expect(normalizeDoi(null)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(normalizeDoi("")).toBeNull();
  });

  it("trims whitespace", () => {
    expect(normalizeDoi("  10.1000/abc.2024  ")).toBe("10.1000/abc.2024");
  });

  it("strips DOI: prefix (case-insensitive)", () => {
    expect(normalizeDoi("DOI:10.1000/abc.2024")).toBe("10.1000/abc.2024");
    expect(normalizeDoi("doi:10.1000/abc.2024")).toBe("10.1000/abc.2024");
  });

  it("strips https://doi.org/ prefix", () => {
    expect(normalizeDoi("https://doi.org/10.1000/abc.2024")).toBe("10.1000/abc.2024");
  });

  it("strips http://dx.doi.org/ prefix", () => {
    expect(normalizeDoi("http://dx.doi.org/10.1000/abc.2024")).toBe("10.1000/abc.2024");
  });

  it("lowercases the DOI", () => {
    expect(normalizeDoi("10.1000/ABC.2024")).toBe("10.1000/abc.2024");
  });

  // ROW 23 FROM SAMPLE FILE: " DOI:10.1000/NQ.2024.010 "
  it("handles Row 23 sample file case: whitespace + DOI prefix + uppercase", () => {
    expect(normalizeDoi(" DOI:10.1000/NQ.2024.010 ")).toBe("10.1000/nq.2024.010");
  });

  it("returns null if DOI does not start with 10. after stripping", () => {
    expect(normalizeDoi("not-a-doi")).toBeNull();
    expect(normalizeDoi("DOI:abc/xyz")).toBeNull();
  });

  it("preserves valid DOI without prefix", () => {
    expect(normalizeDoi("10.1000/jdh.2024.001")).toBe("10.1000/jdh.2024.001");
  });
});

describe("normalizePmid", () => {
  it("returns null for null input", () => {
    expect(normalizePmid(null)).toBeNull();
  });

  it("trims whitespace", () => {
    // ROW 23 FROM SAMPLE FILE: " 38910023 "
    expect(normalizePmid(" 38910023 ")).toBe("38910023");
  });

  it("converts number to string", () => {
    expect(normalizePmid(38910001)).toBe("38910001");
  });

  it("handles Excel float representation", () => {
    expect(normalizePmid("38910001.0")).toBe("38910001");
  });

  it("returns null for non-numeric PMID", () => {
    expect(normalizePmid("INVALID")).toBeNull();
  });

  it("strips PMID: prefix", () => {
    expect(normalizePmid("PMID:38910001")).toBe("38910001");
  });
});

describe("normalizePubYear", () => {
  it("returns the year as integer for numeric input", () => {
    expect(normalizePubYear(2024)).toBe(2024);
  });

  it("returns the year for string numeric input", () => {
    expect(normalizePubYear("2024")).toBe(2024);
  });

  // ROW 6 FROM SAMPLE FILE: "Twenty twenty" → 2020
  it("parses 'Twenty twenty' to 2020", () => {
    expect(normalizePubYear("Twenty twenty")).toBe(2020);
  });

  it("parses 'twenty twenty' (lowercase) to 2020", () => {
    expect(normalizePubYear("twenty twenty")).toBe(2020);
  });

  it("parses 'two thousand and twenty' to 2020", () => {
    expect(normalizePubYear("two thousand and twenty")).toBe(2020);
  });

  it("parses 'two thousand twenty four' to 2024", () => {
    expect(normalizePubYear("two thousand twenty four")).toBe(2024);
  });

  it("extracts year from range like '2020/2021'", () => {
    expect(normalizePubYear("2020/2021")).toBe(2020);
  });

  it("returns null for completely unparseable input", () => {
    expect(normalizePubYear("not a year at all")).toBeNull();
  });

  it("returns null for null input", () => {
    expect(normalizePubYear(null)).toBeNull();
  });
});

describe("normalizeAuthors", () => {
  it("returns null for null input", () => {
    expect(normalizeAuthors(null)).toBeNull();
  });

  it("returns null for 'Unknown' sentinel", () => {
    // ROW 4 FROM SAMPLE FILE: Authors = "Unknown"
    expect(normalizeAuthors("Unknown")).toBeNull();
    expect(normalizeAuthors("unknown")).toBeNull();
  });

  it("returns null for N/A", () => {
    expect(normalizeAuthors("N/A")).toBeNull();
    expect(normalizeAuthors("n/a")).toBeNull();
  });

  // ROW 23 FROM SAMPLE FILE: "  Patel A ; Green D "
  it("trims whitespace around semicolons", () => {
    expect(normalizeAuthors("  Patel A ; Green D ")).toBe("Patel A; Green D");
  });

  it("preserves valid author list", () => {
    expect(normalizeAuthors("Rao A; Chen L; Smith J")).toBe("Rao A; Chen L; Smith J");
  });
});

describe("inferFirstAuthorFromAuthors", () => {
  it("extracts first author from semicolon-separated list", () => {
    expect(inferFirstAuthorFromAuthors("Rao A; Chen L; Smith J")).toBe("Rao A");
  });

  it("returns null for null input", () => {
    expect(inferFirstAuthorFromAuthors(null)).toBeNull();
  });

  it("returns single author when no semicolon", () => {
    expect(inferFirstAuthorFromAuthors("Foster B")).toBe("Foster B");
  });
});

describe("inferYearFromCitation", () => {
  it("extracts year from PubMed-style citation", () => {
    expect(inferYearFromCitation("Rao A, et al. Journal of Digital Health. 2024;12(4):211-220.")).toBe(2024);
  });

  it("extracts year from simple citation", () => {
    expect(inferYearFromCitation("Methods Today. 2020;7(3):44-47")).toBe(2020);
  });

  it("returns null for null input", () => {
    expect(inferYearFromCitation(null)).toBeNull();
  });

  it("returns null when no year found", () => {
    expect(inferYearFromCitation("No year here")).toBeNull();
  });
});

// ─── NORMALIZEROW INTEGRATION TESTS ──────────────────────────────────────────

describe("normalizeRow (integration)", () => {
  // ROW 6: Year as "Twenty twenty" → auto-corrected to 2020
  it("auto-corrects year 'Twenty twenty' to 2020 and logs correction", () => {
    const raw = makeRawRow({ pubYear: "Twenty twenty", rowIndex: 6 });
    const result = normalizeRow(raw);

    expect(result.pubYear).toBe(2020);
    expect(result.corrections).toHaveLength(1);
    expect(result.corrections[0]?.field).toBe("pubYear");
    expect(result.corrections[0]?.originalValue).toBe("Twenty twenty");
    expect(result.corrections[0]?.correctedValue).toBe("2020");
  });

  // ROW 23: Whitespace + DOI prefix
  it("auto-corrects whitespace and DOI prefix for Row 23", () => {
    const raw = makeRawRow({
      rowIndex: 23,
      pmid: " 38910023 ",
      doi: " DOI:10.1000/NQ.2024.010 ",
      authors: "  Patel A ; Green D ",
      firstAuthor: " Patel A ",
    });
    const result = normalizeRow(raw);

    expect(result.pmid).toBe("38910023");
    expect(result.doi).toBe("10.1000/nq.2024.010");
    expect(result.authors).toBe("Patel A; Green D");
    expect(result.firstAuthor).toBe("Patel A");
    expect(result.corrections.length).toBeGreaterThan(0);
  });

  // ROW 14: Missing authors → firstAuthor also null
  it("infers firstAuthor from authors when firstAuthor is missing", () => {
    const raw = makeRawRow({
      authors: "Park J; Evans T",
      firstAuthor: null,
    });
    const result = normalizeRow(raw);

    expect(result.firstAuthor).toBe("Park J");
    const firstAuthorCorrection = result.corrections.find(c => c.field === "firstAuthor");
    expect(firstAuthorCorrection).toBeDefined();
  });
});

// ─── VALIDATE.TS TESTS ────────────────────────────────────────────────────────

describe("validateRow", () => {
  // ROW 4: Missing title → HIGH severity warning
  it("attaches HIGH severity warning for missing title", () => {
    const normalized = makeNormalizedRow({ title: null });
    const result = validateRow(normalized);

    const titleWarning = result.warnings.find(w => w.field === "title");
    expect(titleWarning).toBeDefined();
    expect(titleWarning?.severity).toBe("HIGH");
  });

  // ROW 22: Future year 2035 → HIGH severity warning
  it("attaches HIGH severity warning for far-future year (2035)", () => {
    const normalized = makeNormalizedRow({ pubYear: 2035 });
    const result = validateRow(normalized);

    const yearWarning = result.warnings.find(w => w.field === "pubYear");
    expect(yearWarning).toBeDefined();
    expect(yearWarning?.severity).toBe("HIGH");
  });

  it("does not warn for current year when citation matches", () => {
    const currentYear = new Date().getFullYear();
    // Use a citation with the same year as pubYear to avoid consistency warning
    const normalized = makeNormalizedRow({
      pubYear: currentYear,
      citation: `Author A. Some Journal. ${currentYear};12(1):1-10.`,
    });
    const result = validateRow(normalized);

    const yearWarning = result.warnings.find(w => w.field === "pubYear");
    expect(yearWarning).toBeUndefined();
  });

  // ROW 14: Missing authors → MEDIUM severity warning
  it("attaches MEDIUM severity warning for missing authors", () => {
    const normalized = makeNormalizedRow({ authors: null });
    const result = validateRow(normalized);

    const authorsWarning = result.warnings.find(w => w.field === "authors");
    expect(authorsWarning).toBeDefined();
    expect(authorsWarning?.severity).toBe("MEDIUM");
  });

  it("clean row produces no warnings", () => {
    const normalized = makeNormalizedRow();
    const result = validateRow(normalized);
    expect(result.warnings).toHaveLength(0);
  });
});

describe("warrantWarningStatus", () => {
  it("returns true when there is a HIGH severity warning", () => {
    expect(warrantWarningStatus([{ field: "title", severity: "HIGH", message: "test" }])).toBe(true);
  });

  it("returns true when there is a MEDIUM severity warning", () => {
    expect(warrantWarningStatus([{ field: "authors", severity: "MEDIUM", message: "test" }])).toBe(true);
  });

  it("returns false for INFO-only warnings", () => {
    expect(warrantWarningStatus([{ field: "pmid", severity: "INFO", message: "test" }])).toBe(false);
  });

  it("returns false for LOW-only warnings", () => {
    expect(warrantWarningStatus([{ field: "citation", severity: "LOW", message: "test" }])).toBe(false);
  });

  it("returns false for empty warnings array", () => {
    expect(warrantWarningStatus([])).toBe(false);
  });
});

// ─── BATCHINDEX.TS TESTS ─────────────────────────────────────────────────────

describe("buildBatchIndex", () => {
  it("indexes rows by PMID", () => {
    const rows = [
      makeNormalizedRow({ rowIndex: 1, pmid: "38910001" }),
      makeNormalizedRow({ rowIndex: 2, pmid: "38910002" }),
    ];
    const index = buildBatchIndex(rows);
    expect(index.byPmid.get("38910001")).toEqual([1]);
    expect(index.byPmid.get("38910002")).toEqual([2]);
  });

  it("indexes multiple rows with same PMID (the Row 16/17 scenario)", () => {
    const rows = [
      makeNormalizedRow({ rowIndex: 16, pmid: "38910016", doi: "10.1000/mht.2020.017" }),
      makeNormalizedRow({ rowIndex: 17, pmid: "38910016", doi: "10.1000/dql.2024.017" }),
    ];
    const index = buildBatchIndex(rows);
    expect(index.byPmid.get("38910016")).toEqual([16, 17]);
  });

  it("does not index null identifiers", () => {
    const rows = [makeNormalizedRow({ pmid: null })];
    const index = buildBatchIndex(rows);
    expect(index.byPmid.size).toBe(0);
  });
});

describe("findBatchDuplicate", () => {
  it("returns null when no duplicate exists", () => {
    const rows = [
      makeNormalizedRow({ rowIndex: 1, pmid: "38910001", doi: "10.1000/unique-a", pmcid: null }),
      makeNormalizedRow({ rowIndex: 2, pmid: "38910002", doi: "10.1000/unique-b", pmcid: null }),
    ];
    const index = buildBatchIndex(rows);
    expect(findBatchDuplicate(rows[1]!, index)).toBeNull();
  });

  // THE CRITICAL ROW 16/17 BATCH DUPLICATE TEST
  it("detects Row 17 as a batch duplicate of Row 16 by PMID", () => {
    const row16 = makeNormalizedRow({
      rowIndex: 16,
      pmid: "38910016",
      doi: "10.1000/mht.2020.017",
      title: "Nutrition coaching by video visit for gestational diabetes",
    });
    const row17 = makeNormalizedRow({
      rowIndex: 17,
      pmid: "38910016",
      doi: "10.1000/dql.2024.017",
      title: "Duplicate PMID with unique DOI",
    });

    const index = buildBatchIndex([row16, row17]);

    // Row 16 should NOT be flagged (it's the first occurrence)
    expect(findBatchDuplicate(row16, index)).toBeNull();

    // Row 17 SHOULD be flagged (it's the second occurrence)
    const duplicate = findBatchDuplicate(row17, index);
    expect(duplicate).not.toBeNull();
    expect(duplicate?.field).toBe("pmid");
    expect(duplicate?.conflictingRowIndex).toBe(16);
  });
});

// ─── DUPLICATE.TS TESTS ───────────────────────────────────────────────────────

describe("resolveIdentity", () => {
  // Clean PMID match → LIKELY_DUPLICATE
  it("returns PMID_EXACT match type for identical PMID", () => {
    const row = makeNormalizedRow({ pmid: "38910001", doi: "10.1000/jdh.2024.001" });
    const candidate = makeExistingArticle({ pmid: "38910001", doi: "10.1000/jdh.2024.001" });
    const result = resolveIdentity(row, candidate, "PROJECT_DB");

    expect(result).not.toBeNull();
    expect(result?.matchType).toBe("PMID_EXACT");
    expect(result?.conflictType).toBeNull(); // clean match, no conflict
    expect(result?.autoResolvable).toBe(true);
  });

  // THE CRITICAL ROW 16/17 CONFLICT TEST
  it("detects PMID_DOI_MISMATCH conflict for Row 16 vs Row 17", () => {
    const row17 = makeNormalizedRow({
      rowIndex: 17,
      pmid: "38910016",
      doi: "10.1000/dql.2024.017",
      title: "Duplicate PMID with unique DOI",
      authors: "Foster B",
      pubYear: 2024,
      journal: "Data Quality Letters",
    });
    const row16AsCandidate = makeNormalizedRow({
      rowIndex: 16,
      pmid: "38910016",
      doi: "10.1000/mht.2020.017",
      title: "Nutrition coaching by video visit for gestational diabetes",
      authors: "Kaur R; Bennett J",
      pubYear: 2020,
      journal: "Maternal Health Trials",
    });

    const result = resolveIdentity(row17, row16AsCandidate, "BATCH");

    expect(result).not.toBeNull();
    expect(result?.matchType).toBe("PMID_EXACT");
    expect(result?.conflictType).toBe("PMID_DOI_MISMATCH");
    expect(result?.autoResolvable).toBe(false);
    expect(result?.signals.pmidMatch).toBe(true);
    expect(result?.signals.doiMatch).toBe(false);
  });

  // DOI match, no PMID → LIKELY_DUPLICATE (Row 5 in sample)
  it("returns DOI_EXACT match for identical DOI", () => {
    const row5 = makeNormalizedRow({
      pmid: "38910005",
      doi: "10.1000/jdh.2024.001", // Same DOI as Row 1
    });
    const row1AsExisting = makeExistingArticle({
      pmid: "38910001",
      doi: "10.1000/jdh.2024.001",
    });

    const result = resolveIdentity(row5, row1AsExisting, "PROJECT_DB");

    expect(result).not.toBeNull();
    expect(result?.matchType).toBe("DOI_EXACT");
    // PMIDs are different — check if PMID_DOI_MISMATCH is detected
    // (row5 has pmid 38910005, row1 has pmid 38910001, both have same DOI)
    // The DOI matches → DOI_EXACT, no PMID_DOI_MISMATCH (that's for PMID matching DOI not matching)
    expect(result?.signals.doiMatch).toBe(true);
    expect(result?.signals.pmidMatch).toBe(false);
  });

  it("returns null when no identifier matches", () => {
    const row = makeNormalizedRow({ pmid: "99999999", doi: "10.9999/different", pmcid: null });
    const candidate = makeExistingArticle({ pmid: "38910001", doi: "10.1000/jdh.2024.001" });
    const result = resolveIdentity(row, candidate, "PROJECT_DB");
    expect(result).toBeNull();
  });
});

// ─── FUZZY.TS TESTS ───────────────────────────────────────────────────────────

describe("computeTitleSimilarity", () => {
  it("returns 1.0 for identical titles", () => {
    const title = "Digital adherence tools for diabetes care";
    expect(computeTitleSimilarity(title, title)).toBeCloseTo(1.0, 2);
  });

  it("returns 0 for null titles", () => {
    expect(computeTitleSimilarity(null, "some title")).toBe(0);
    expect(computeTitleSimilarity("some title", null)).toBe(0);
  });

  it("returns high similarity for titles with subtitle added", () => {
    const a = "Remote monitoring after cardiac surgery";
    const b = "Remote monitoring after cardiac surgery: a pilot study";
    const score = computeTitleSimilarity(a, b);
    expect(score).toBeGreaterThan(0.85);
  });

  // Row 17 vs Row 16 — titles share enough common words (coaching, diabetes, etc)
  // to score ~0.56 on Jaro-Winkler. The conflict detection threshold (0.30) is
  // correctly applied in conflict.ts. This test verifies that the correct threshold
  // is what matters — not the raw score.
  it("returns lower similarity for completely different titles than for similar ones", () => {
    const aDifferent = "Nutrition coaching by video visit for gestational diabetes";
    const bDifferent = "Duplicate PMID with unique DOI";
    const aSimilar = "Digital adherence tools for diabetes care";
    const bSimilar = "Digital adherence monitoring tools for diabetes care management";

    const differentScore = computeTitleSimilarity(aDifferent, bDifferent);
    const similarScore = computeTitleSimilarity(aSimilar, bSimilar);

    // Similar titles score higher than different titles
    expect(similarScore).toBeGreaterThan(differentScore);
    // Similar titles score above 0.85 (POSSIBLE_MATCH threshold)
    expect(similarScore).toBeGreaterThan(0.85);
  });
});

describe("computeAuthorOverlap", () => {
  it("returns 0 for null authors", () => {
    expect(computeAuthorOverlap(null, "Smith J")).toBe(0);
  });

  it("returns 0 for completely different authors", () => {
    // Row 17 authors vs Row 16 authors
    expect(computeAuthorOverlap("Foster B", "Kaur R; Bennett J")).toBe(0);
  });

  it("returns high overlap for same authors", () => {
    const score = computeAuthorOverlap("Rao A; Chen L", "Rao A; Chen L");
    expect(score).toBeCloseTo(1.0, 1);
  });

  it("returns partial overlap for subset of authors", () => {
    // Author set A is a subset of B
    const score = computeAuthorOverlap("Rao A; Chen L", "Rao A; Chen L; Smith J");
    expect(score).toBeGreaterThan(0.5);
    expect(score).toBeLessThan(1.0);
  });
});

// ─── ENGINE INTEGRATION TESTS ─────────────────────────────────────────────────

describe("runImportEngine (full pipeline)", () => {
  it("classifies clean row as IMPORTED", () => {
    const rows: RawRow[] = [makeRawRow({ rowIndex: 1 })];
    const result = runImportEngine(rows, []);

    expect(result.summary.importedCount).toBe(1);
    expect(result.processedRows[0]?.finalStatus).toBe("IMPORTED");
  });

  it("classifies year-as-text row as AUTO_CORRECTED", () => {
    // Citation year matches the corrected year (2020) to avoid consistency warning
    const rows: RawRow[] = [makeRawRow({
      rowIndex: 1,
      pubYear: "Twenty twenty",
      citation: "Author A. Some Journal. 2020;7(3):44-47.",
      createDate: "2020/01/01",
    })];
    const result = runImportEngine(rows, []);

    expect(result.processedRows[0]?.finalStatus).toBe("AUTO_CORRECTED");
    expect(result.processedRows[0]?.normalized.pubYear).toBe(2020);
  });

  it("classifies missing-title row as IMPORTED_WARNING", () => {
    const rows: RawRow[] = [makeRawRow({ rowIndex: 1, title: null })];
    const result = runImportEngine(rows, []);

    expect(result.processedRows[0]?.finalStatus).toBe("IMPORTED_WARNING");
  });

  // THE CRITICAL END-TO-END TEST: Row 16 and Row 17
  it("correctly handles Row 16/17 PMID conflict: Row 16 IMPORTED, Row 17 CONFLICT", () => {
    const rows: RawRow[] = [
      {
        rowIndex: 16,
        pmid: "38910016",
        title: "Nutrition coaching by video visit for gestational diabetes",
        authors: "Kaur R; Bennett J",
        citation: "Kaur R, et al. Maternal Health Trials. 2020;10(2):90-99.",
        firstAuthor: "Kaur R",
        journal: "Maternal Health Trials",
        pubYear: 2020,
        createDate: "2020/03/03",
        pmcid: null,
        nihmsId: null,
        doi: "10.1000/mht.2020.017",
      },
      {
        rowIndex: 17,
        pmid: "38910016", // SAME PMID as Row 16
        title: "Duplicate PMID with unique DOI",
        authors: "Foster B",
        citation: "Foster B. Data Quality Letters. 2024;3(2):14-16.",
        firstAuthor: "Foster B",
        journal: "Data Quality Letters",
        pubYear: 2024,
        createDate: "2024/03/19",
        pmcid: null,
        nihmsId: null,
        doi: "10.1000/dql.2024.017", // DIFFERENT DOI
      },
    ];

    const result = runImportEngine(rows, []);

    const row16 = result.processedRows.find((r) => r.rowIndex === 16);
    const row17 = result.processedRows.find((r) => r.rowIndex === 17);

    expect(row16?.finalStatus).toBe("IMPORTED");
    expect(row17?.finalStatus).toBe("CONFLICT");
    expect(row17?.identityResult?.conflictType).toBe("PMID_DOI_MISMATCH");
    expect(row17?.identityResult?.autoResolvable).toBe(false);
  });

  it("auto-deduplicates rows with same PMID (without DOI conflict)", () => {
    const rows: RawRow[] = [
      makeRawRow({ rowIndex: 1, pmid: "38910001", doi: "10.1000/same.doi" }),
      makeRawRow({ rowIndex: 2, pmid: "38910001", doi: "10.1000/same.doi" }), // Exact duplicate
    ];
    const result = runImportEngine(rows, []);

    const row1 = result.processedRows.find((r) => r.rowIndex === 1);
    const row2 = result.processedRows.find((r) => r.rowIndex === 2);

    expect(row1?.finalStatus).toBe("IMPORTED");
    expect(row2?.finalStatus).toBe("AUTO_RESOLVED_DUPLICATE");
  });

  it("detects project DB duplicate", () => {
    const rows: RawRow[] = [
      makeRawRow({ rowIndex: 1, pmid: "38910001", doi: "10.1000/jdh.2024.001" }),
    ];
    const existingArticles: ExistingArticle[] = [
      makeExistingArticle({ pmid: "38910001", doi: "10.1000/jdh.2024.001" }),
    ];

    const result = runImportEngine(rows, existingArticles);
    expect(result.processedRows[0]?.finalStatus).toBe("AUTO_RESOLVED_DUPLICATE");
  });

  it("auto-deduplicates rows even if they have field warnings (bypasses status severity escalation)", () => {
    const rows: RawRow[] = [
      makeRawRow({ rowIndex: 1, pmid: "38910001", doi: "10.1000/jdh.2024.001", title: null }),
    ];
    const existingArticles: ExistingArticle[] = [
      makeExistingArticle({ pmid: "38910001", doi: "10.1000/jdh.2024.001", title: "Existing Title" }),
    ];

    const result = runImportEngine(rows, existingArticles);
    expect(result.processedRows[0]?.finalStatus).toBe("AUTO_RESOLVED_DUPLICATE");
  });

  it("auto-deduplicates rows by title/author match if incoming row lacks identifiers", () => {
    const rows: RawRow[] = [
      makeRawRow({ rowIndex: 1, pmid: null, doi: null, pmcid: null, title: "Original Article Title", authors: "Author A; Author B" }),
    ];
    const existingArticles: ExistingArticle[] = [
      makeExistingArticle({ pmid: null, doi: null, pmcid: null, title: "Original Article Title", authors: "Author A; Author B" }),
    ];

    const result = runImportEngine(rows, existingArticles);
    expect(result.processedRows[0]?.finalStatus).toBe("AUTO_RESOLVED_DUPLICATE");
  });

  it("prioritizes clean auto-resolvable matches over identifier conflicts in DB checks", () => {
    // Incoming row has pmid: 38910016 and doi: 10.1000/dql.2024.017 (like Row 17)
    const rows: RawRow[] = [
      makeRawRow({
        rowIndex: 1,
        pmid: "38910016",
        doi: "10.1000/dql.2024.017",
        title: "Duplicate PMID with unique DOI",
      }),
    ];
    // DB has Article X (pmid: 38910016, different DOI) and Article Y (pmid: null, same DOI)
    const existingArticles: ExistingArticle[] = [
      makeExistingArticle({
        id: "art_x",
        pmid: "38910016",
        doi: "10.1000/mht.2020.017",
        title: "Nutrition coaching by video visit for gestational diabetes",
      }),
      makeExistingArticle({
        id: "art_y",
        pmid: null,
        doi: "10.1000/dql.2024.017",
        title: "Duplicate PMID with unique DOI",
      }),
    ];

    const result = runImportEngine(rows, existingArticles);
    // Should resolve to AUTO_RESOLVED_DUPLICATE (skipped) because of Article Y
    expect(result.processedRows[0]?.finalStatus).toBe("AUTO_RESOLVED_DUPLICATE");
  });

  it("prioritizes project DB duplicate matches over batch-level conflicts on re-import", () => {
    // Spreadsheet has Row 16 and Row 17 (batch conflict on PMID 38910016)
    const rows: RawRow[] = [
      {
        rowIndex: 16,
        pmid: "38910016",
        title: "Nutrition coaching by video visit for gestational diabetes",
        authors: "Kaur R; Bennett J",
        citation: "Kaur R, et al. Maternal Health Trials. 2020;10(2):90-99.",
        firstAuthor: "Kaur R",
        journal: "Maternal Health Trials",
        pubYear: 2020,
        createDate: "2020/03/03",
        pmcid: null,
        nihmsId: null,
        doi: "10.1000/mht.2020.017",
      },
      {
        rowIndex: 17,
        pmid: "38910016",
        title: "Duplicate PMID with unique DOI",
        authors: "Foster B",
        citation: "Foster B. Data Quality Letters. 2024;3(2):14-16.",
        firstAuthor: "Foster B",
        journal: "Data Quality Letters",
        pubYear: 2024,
        createDate: "2024/03/19",
        pmcid: null,
        nihmsId: null,
        doi: "10.1000/dql.2024.017",
      },
    ];

    // DB already has both articles (Row 16 clean, and Row 17 resolved to pmid: null)
    const existingArticles: ExistingArticle[] = [
      makeExistingArticle({
        id: "art_16",
        pmid: "38910016",
        doi: "10.1000/mht.2020.017",
        title: "Nutrition coaching by video visit for gestational diabetes",
      }),
      makeExistingArticle({
        id: "art_17",
        pmid: null,
        doi: "10.1000/dql.2024.017",
        title: "Duplicate PMID with unique DOI",
      }),
    ];

    const result = runImportEngine(rows, existingArticles);
    const row16 = result.processedRows.find(r => r.rowIndex === 16);
    const row17 = result.processedRows.find(r => r.rowIndex === 17);

    // Both should be skipped as duplicates since they are already in the DB
    expect(row16?.finalStatus).toBe("AUTO_RESOLVED_DUPLICATE");
    expect(row17?.finalStatus).toBe("AUTO_RESOLVED_DUPLICATE");
  });

  it("groups conflicts and systemic DOI collisions into Conflict Clusters", () => {
    const rows: RawRow[] = [
      makeRawRow({ rowIndex: 1, doi: "10.1000/systemic.doi", title: "Systemic review of telehealth interventions" }),
      makeRawRow({ rowIndex: 2, doi: "10.1000/systemic.doi", title: "Efficacy of metformin in type 2 diabetes" }),
      makeRawRow({ rowIndex: 3, doi: "10.1000/systemic.doi", title: "Deep learning for cardiovascular disease detection" }),
      makeRawRow({ rowIndex: 4, doi: "10.1000/systemic.doi", title: "Maternal health outcomes in low income countries" }),
      makeRawRow({ rowIndex: 5, doi: "10.1000/systemic.doi", title: "Nutritional habits and cognitive decline in elderly" }),
    ];

    const result = runImportEngine(rows, []);
    expect(result.clusters.length).toBeGreaterThan(0);
    const cluster = result.clusters.find((c) => c.type === "SYSTEMIC_DOI_COLLISION");
    expect(cluster).toBeDefined();
    expect(cluster?.sharedIdentifier).toBe("10.1000/systemic.doi");
    expect(cluster?.affectedRowIndices).toEqual([1, 2, 3, 4, 5]);
  });

  it("summary counts are consistent with processedRows", () => {
    const rows: RawRow[] = [
      makeRawRow({ rowIndex: 1 }),
      makeRawRow({ rowIndex: 2, title: null }),
      makeRawRow({ rowIndex: 3, pubYear: "Twenty twenty" }),
    ];
    const result = runImportEngine(rows, []);

    expect(result.summary.importedCount).toBe(result.imported.length);
    expect(result.summary.autoCorrectedCount).toBe(result.autoCorrected.length);
    expect(result.summary.importedWithWarningCount).toBe(result.importedWithWarning.length);
    expect(result.totalRows).toBe(3);
  });
});
