/**
 * FIELD VALIDATION ENGINE
 *
 * Stage 2 of the Import Intelligence Pipeline.
 *
 * What this does:
 * Takes a NormalizedRow (clean canonical form from Stage 1) and applies semantic
 * validation rules. Returns a ValidatedRow with warnings attached.
 *
 * What this does NOT do:
 * - It does not normalize data (that was Stage 1)
 * - It does not check for duplicates (that's Stage 3+)
 * - It does not reject rows — it attaches warnings and lets the engine decide status
 *
 * Design principle: No hard rejections.
 * Every row is returned. Only warnings are attached. Status escalation is the
 * engine's responsibility. This keeps validation logic focused on "what's wrong"
 * not "what to do about it."
 *
 * Warning severity:
 *   INFO   → No action needed. Purely informational.
 *   LOW    → Researcher may want to verify, but can proceed.
 *   MEDIUM → Researcher should verify before relying on this field.
 *   HIGH   → Researcher must verify — high risk of bad data.
 */

import {
  IMPORT_THRESHOLDS,
  type InferredField,
  type NormalizedRow,
  type ValidatedRow,
  type Warning,
} from "./types";
import {
  inferJournalFromCitation,
  inferYearFromCitation,
  inferYearFromCreateDate,
} from "./normalize";

// ─── INDIVIDUAL VALIDATION RULES ─────────────────────────────────────────────

/**
 * Rule: Title presence check.
 *
 * Why HIGH severity: Title is the primary field researchers use to make
 * include/exclude decisions. A titleless article cannot be screened.
 * However, we still import it — the article may be identifiable by PMID/DOI,
 * and rejecting it would silently lose a record the researcher expects to see.
 *
 * Suggestion: We give the researcher a concrete action (look up the PMID).
 * Generic "please verify" suggestions are useless — specific suggestions are helpful.
 */
function validateTitle(row: NormalizedRow): Warning[] {
  if (!row.title || row.title.trim() === "") {
    const suggestion = row.pmid
      ? `Look up PMID ${row.pmid} on PubMed (https://pubmed.ncbi.nlm.nih.gov/${row.pmid}) to retrieve the title.`
      : row.doi
        ? `Look up DOI ${row.doi} to retrieve the title.`
        : "No identifier available to look up the title.";

    return [
      {
        field: "title",
        severity: "HIGH",
        message: "Title is missing. Articles without titles cannot be screened effectively.",
        suggestion,
      },
    ];
  }
  return [];
}

/**
 * Rule: Authors presence check.
 *
 * Why MEDIUM severity: Author information is important for identifying papers
 * and detecting duplicates, but a titleless article without authors is still
 * identifiable by PMID/DOI. Missing authors is a quality issue, not a fatal error.
 *
 * Why not HIGH: Systematic reviews sometimes include articles with no named authors
 * (corporate authorship, anonymous guidelines). Missing authors is more common
 * than missing titles.
 */
function validateAuthors(row: NormalizedRow): Warning[] {
  if (!row.authors) {
    return [
      {
        field: "authors",
        severity: "MEDIUM",
        message: "Authors field is missing or empty.",
        suggestion: row.pmid
          ? `Verify on PubMed: https://pubmed.ncbi.nlm.nih.gov/${row.pmid}`
          : undefined,
      },
    ];
  }
  return [];
}

/**
 * Rule: Publication year range check.
 *
 * Three cases:
 * 1. Year is missing → MEDIUM warning (we don't know when this was published)
 * 2. Year is plausibly in the future (within FUTURE_YEAR_WARNING_BUFFER) → LOW warning
 *    (epub-ahead-of-print articles are indexed before their official pub date)
 * 3. Year is far in the future (beyond FUTURE_YEAR_HIGH_SEVERITY_BUFFER) → HIGH warning
 *    (almost certainly a data entry error)
 *
 * Why not reject future years:
 * Automatic rejection silently removes records the researcher expects to see.
 * A 2035 publication year is almost certainly wrong, but the researcher must
 * decide whether to keep or discard it — not the system.
 */
function validatePubYear(row: NormalizedRow): Warning[] {
  const warnings: Warning[] = [];
  const currentYear = new Date().getFullYear();

  if (row.pubYear === null) {
    warnings.push({
      field: "pubYear",
      severity: "MEDIUM",
      message: "Publication year is missing.",
      suggestion: row.citation
        ? `Year may be extractable from Citation: "${row.citation}"`
        : undefined,
    });
    return warnings;
  }

  const yearsInFuture = row.pubYear - currentYear;

  if (yearsInFuture > IMPORT_THRESHOLDS.FUTURE_YEAR_HIGH_SEVERITY_BUFFER) {
    warnings.push({
      field: "pubYear",
      severity: "HIGH",
      message: `Publication year ${row.pubYear} is ${yearsInFuture} years in the future. This is likely a data entry error.`,
      suggestion: "Verify the publication year. A common error is typing the wrong decade (e.g., 2035 instead of 2025).",
    });
  } else if (yearsInFuture > IMPORT_THRESHOLDS.FUTURE_YEAR_WARNING_BUFFER) {
    warnings.push({
      field: "pubYear",
      severity: "MEDIUM",
      message: `Publication year ${row.pubYear} is ${yearsInFuture} year(s) in the future.`,
      suggestion: "This may be an epub-ahead-of-print article. Verify if the publication date is correct.",
    });
  }
  // If yearsInFuture <= FUTURE_YEAR_WARNING_BUFFER: within acceptable range, no warning

  return warnings;
}

/**
 * Rule: Publication year consistency check.
 * Cross-validates Publication Year field against Citation and Create Date.
 *
 * Why cross-validate: A researcher copying from multiple sources may have
 * the correct year in Citation but an incorrect year in the Year field.
 * This rule catches such inconsistencies and flags them.
 *
 * Example:
 * - Publication Year field: 2022
 * - Citation: "Methods Today. 2020;7(3):44-47" → Citation year: 2020
 * - Difference: 2 years → flag MEDIUM warning
 *
 * We use a 1-year buffer for epub-ahead-of-print scenarios.
 */
function validateYearConsistency(row: NormalizedRow): Warning[] {
  if (row.pubYear === null) return []; // Already handled by validatePubYear

  const citationYear = inferYearFromCitation(row.citation);
  const createDateYear = inferYearFromCreateDate(row.createDate);

  const warnings: Warning[] = [];

  if (citationYear !== null && Math.abs(row.pubYear - citationYear) > 1) {
    warnings.push({
      field: "pubYear",
      severity: "MEDIUM",
      message: `Publication year (${row.pubYear}) differs from year in Citation (${citationYear}) by ${Math.abs(row.pubYear - citationYear)} year(s).`,
      suggestion: `Citation field suggests the year is ${citationYear}. Verify which is correct.`,
    });
  }

  if (
    createDateYear !== null &&
    citationYear === null && // Only check Create Date if Citation year isn't available
    Math.abs(row.pubYear - createDateYear) > 1
  ) {
    warnings.push({
      field: "pubYear",
      severity: "LOW",
      message: `Publication year (${row.pubYear}) differs from year in Create Date (${createDateYear}).`,
      suggestion: `Create Date suggests the year is ${createDateYear}. Create Date is less reliable than Citation.`,
    });
  }

  return warnings;
}

/**
 * Rule: PMID presence check.
 *
 * Why INFO severity (not higher):
 * Non-PubMed articles (conference papers, book chapters, grey literature)
 * legitimately have no PMID. This is a data fact, not a quality problem.
 * We note it so the researcher is aware this article isn't PubMed-indexed.
 *
 * Design decision: INFO not LOW because no researcher action is needed.
 * The article is still identifiable by DOI (if present).
 */
function validatePmid(row: NormalizedRow): Warning[] {
  if (!row.pmid && !row.doi) {
    // Both identifiers missing — more serious
    return [
      {
        field: "pmid",
        severity: "MEDIUM",
        message: "Neither PMID nor DOI is present. This article has no standard identifier.",
        suggestion: "Verify the source of this record. Articles without identifiers are difficult to track and verify.",
      },
    ];
  }
  if (!row.pmid && row.doi) {
    // DOI is present as backup identifier — info only
    return [
      {
        field: "pmid",
        severity: "INFO",
        message: "PMID is not present. This article may not be indexed in PubMed.",
        suggestion: undefined,
      },
    ];
  }
  return [];
}

/**
 * Rule: Citation presence check.
 *
 * Why LOW severity: Citation is a formatted display string. It's cosmetically
 * important (researchers read it) but the article is fully identifiable without it.
 * LOW severity because a researcher who notices it may want to add it manually.
 */
function validateCitation(row: NormalizedRow): Warning[] {
  if (!row.citation) {
    return [
      {
        field: "citation",
        severity: "LOW",
        message: "Citation field is missing.",
        suggestion: undefined,
      },
    ];
  }
  return [];
}

/**
 * Rule: DOI format validation (post-normalization).
 *
 * After normalization, a DOI should start with "10." if present.
 * This check is defensive — normalizeDoi() returns null for invalid DOIs,
 * so this rule catches cases where normalization couldn't parse the DOI.
 *
 * Note: We check raw.doi here because if normalization set doi to null but
 * raw.doi was present, it means the DOI was invalid.
 */
function validateDoi(row: NormalizedRow, rawDoi: string | null): Warning[] {
  // If raw DOI was present but normalization returned null → invalid DOI
  if (rawDoi && !row.doi) {
    return [
      {
        field: "doi",
        severity: "MEDIUM",
        message: `DOI "${rawDoi}" could not be parsed. It may be malformed.`,
        suggestion: "Verify the DOI format. A valid DOI starts with '10.' followed by the registrant code.",
      },
    ];
  }
  return [];
}

// ─── FIELD INFERENCE (STAGE 2 AUGMENTATION) ──────────────────────────────────

/**
 * Build a list of fields that were inferred from other fields.
 * This is distinct from corrections (which changed existing values) — inferences
 * fill in missing values from available data.
 *
 * We run these after normalization so we're working with clean data.
 */
function computeInferences(row: NormalizedRow): InferredField[] {
  const inferred: InferredField[] = [];

  // Infer year from Citation if year is still null after normalization
  if (row.pubYear === null) {
    const citationYear = inferYearFromCitation(row.citation);
    if (citationYear !== null) {
      inferred.push({
        field: "pubYear",
        value: citationYear,
        source: "citation",
        confidence: "HIGH",
      });
    } else {
      const createDateYear = inferYearFromCreateDate(row.createDate);
      if (createDateYear !== null) {
        inferred.push({
          field: "pubYear",
          value: createDateYear,
          source: "createDate",
          confidence: "MEDIUM",
        });
      }
    }
  }

  // Infer journal from Citation if journal is null
  if (!row.journal && row.citation) {
    const journalFromCitation = inferJournalFromCitation(row.citation);
    if (journalFromCitation) {
      inferred.push({
        field: "journal",
        value: journalFromCitation,
        source: "citation",
        confidence: "MEDIUM",
      });
    }
  }

  return inferred;
}

// ─── MAIN VALIDATION FUNCTION ─────────────────────────────────────────────────

/**
 * Validate a single normalized row.
 * Runs all validation rules and returns a ValidatedRow with warnings and inferences.
 *
 * @param row - The normalized row from Stage 1
 * @param rawDoi - The original raw DOI before normalization (for DOI validation)
 * @returns ValidatedRow with all warnings and inferences attached
 */
export function validateRow(row: NormalizedRow, rawDoi: string | null = null): ValidatedRow {
  const warnings: Warning[] = [
    ...validateTitle(row),
    ...validateAuthors(row),
    ...validatePubYear(row),
    ...validateYearConsistency(row),
    ...validatePmid(row),
    ...validateCitation(row),
    ...validateDoi(row, rawDoi),
  ];

  const inferred = computeInferences(row);

  return {
    ...row,
    warnings,
    inferred,
  };
}

/**
 * Determine if a ValidatedRow's warnings warrant an IMPORTED_WARNING status
 * (vs IMPORTED or AUTO_CORRECTED).
 *
 * We escalate to IMPORTED_WARNING if there's at least one MEDIUM or HIGH warning.
 * INFO and LOW warnings don't escalate status — they're shown subtly in the UI.
 *
 * This keeps the warning system meaningful: HIGH warnings are genuinely important,
 * not drowned out by noise from INFO warnings.
 */
export function warrantWarningStatus(warnings: Warning[]): boolean {
  return warnings.some(
    (w) => w.severity === "MEDIUM" || w.severity === "HIGH",
  );
}
