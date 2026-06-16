/**
 * DUPLICATE & CONFLICT DETECTOR
 *
 * Stages 3b and 3c of the Import Intelligence Pipeline.
 *
 * What this does:
 * 1. Checks a normalized row against existing articles in the project database
 * 2. Classifies the relationship as: no match, LIKELY_DUPLICATE, or CONFLICT
 * 3. Returns a typed IdentityResult describing exactly what was found and why
 *
 * Key design constraints:
 * - Only exact identifier matching is used here (PMID, DOI, PMCID, NIHMS ID)
 * - Fuzzy matching is handled separately in fuzzy.ts and can only produce POSSIBLE_MATCH
 * - All decisions are deterministic: same inputs always produce same outputs
 * - Every decision has a named rule that fired (for auditability)
 *
 * The identifier trust hierarchy:
 *   PMID (1.00) > DOI (0.95) > PMCID (0.90) > NIHMS ID (0.85)
 *
 * This hierarchy reflects real-world data provenance:
 * - PMID: assigned by the National Library of Medicine after human review
 * - DOI: registered with Crossref by the publisher at publication time
 * - PMCID: assigned by PubMed Central (more restricted scope than PMID)
 * - NIHMS: submission tracking number (internal NIH system, least globally unique)
 *
 * Interview answer on trust hierarchy:
 * "The trust hierarchy is not arbitrary — it reflects who assigned each identifier
 * and how likely they are to be globally unique and correctly assigned. PMID is
 * assigned by the NLM after human review. A PMID collision is almost always a data
 * entry error. A NIHMS ID collision might occur naturally in some edge cases."
 */

import {
  IMPORT_THRESHOLDS,
  type ConflictType,
  type ExistingArticle,
  type IdentityResult,
  type IdentitySignals,
  type MatchedRecord,
  type MatchType,
  type NormalizedRow,
} from "./types";
import { computeTitleSimilarity, computeAuthorOverlap } from "./fuzzy";

// ─── SIGNAL COMPUTATION ───────────────────────────────────────────────────────

/**
 * Compute all identity signals between an incoming row and a candidate article.
 * These signals feed into both the LIKELY_DUPLICATE and CONFLICT classification logic.
 *
 * Note on year matching: We use a 1-year buffer to account for epub-ahead-of-print
 * articles, where the online publication year may differ from the print year by 1.
 */
function isIdentifierUntrusted(
  candidate: ExistingArticle | MatchedRecord,
  type: "pmid" | "doi",
): boolean {
  if (!("importNotes" in candidate) || !candidate.importNotes) return false;

  let notes = candidate.importNotes;
  if (typeof notes === "string") {
    try {
      notes = JSON.parse(notes);
    } catch {
      return false;
    }
  }

  if (notes && typeof notes === "object" && !Array.isArray(notes) && Array.isArray((notes as any).untrustedIdentifiers)) {
    return (notes as any).untrustedIdentifiers.includes(type);
  }

  return false;
}

export function computeIdentitySignals(
  row: NormalizedRow,
  candidate: ExistingArticle | MatchedRecord,
): IdentitySignals {
  const isPmidUntrusted = isIdentifierUntrusted(candidate, "pmid");
  const isDoiUntrusted = isIdentifierUntrusted(candidate, "doi");

  const pmidMatch = !isPmidUntrusted && !!(row.pmid && candidate.pmid && row.pmid === candidate.pmid);
  const doiMatch = !isDoiUntrusted && !!(row.doi && candidate.doi && row.doi === candidate.doi);

  // PMCID and NIHMS ID match (only present on ExistingArticle from DB)
  const pmcidMatch = !!(
    row.pmcid &&
    "pmcid" in candidate &&
    candidate.pmcid &&
    row.pmcid === candidate.pmcid
  );
  const nihmsIdMatch = !!(
    row.nihmsId &&
    "nihmsId" in candidate &&
    candidate.nihmsId &&
    row.nihmsId === candidate.nihmsId
  );

  const titleSimilarity = computeTitleSimilarity(row.title, candidate.title);
  const authorOverlap = computeAuthorOverlap(row.authors, candidate.authors);

  // Year match with buffer for epub-ahead-of-print
  const yearMatch = !!(
    row.pubYear &&
    candidate.pubYear &&
    Math.abs(row.pubYear - candidate.pubYear) <= IMPORT_THRESHOLDS.YEAR_MATCH_BUFFER
  );

  // Journal similarity (simple normalized token overlap)
  const journalSimilarity = computeJournalSimilarity(row.journal, candidate.journal);

  return {
    pmidMatch,
    doiMatch,
    pmcidMatch,
    nihmsIdMatch,
    titleSimilarity,
    authorOverlap,
    yearMatch,
    journalSimilarity,
  };
}

/**
 * Simple journal name similarity using normalized token overlap.
 * Journals are often abbreviated differently across databases:
 *   "Journal of Digital Health" vs "J Digit Health" → should match
 *
 * We use simple lowercased token overlap rather than full normalization because:
 * 1. Journal matching is only used as a corroborating signal, never primary
 * 2. Full abbreviation normalization would require a lookup table of 50,000+ journals
 * 3. Simple overlap is transparent and explainable
 */
function computeJournalSimilarity(
  journalA: string | null,
  journalB: string | null,
): number {
  if (!journalA || !journalB) return 0;

  const STOP_WORDS = new Set([
    "the", "of", "and", "in", "for", "a", "an",
    "journal", "review", "international", "science", "research",
  ]);

  const tokenize = (s: string): Set<string> =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((t) => t.length > 1 && !STOP_WORDS.has(t)),
    );

  const tokensA = tokenize(journalA);
  const tokensB = tokenize(journalB);

  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  const intersection = [...tokensA].filter((t) => tokensB.has(t));
  return intersection.length / Math.sqrt(tokensA.size * tokensB.size);
}

// ─── CONFLICT CLASSIFICATION ──────────────────────────────────────────────────

/**
 * Determine if a match is a CONFLICT (two authoritative identifiers disagree)
 * or a clean LIKELY_DUPLICATE (identifiers agree).
 *
 * Conflict rules:
 *
 * PMID_DOI_MISMATCH: PMID matches the candidate, but DOI also exists in this row
 * and it does NOT match the candidate's DOI.
 *   → Two authoritative identifiers point to different conclusions.
 *   → Cannot auto-resolve. Human must decide which identifier is wrong.
 *
 * PMID_TITLE_MISMATCH: PMID matches the candidate, but title similarity is very low.
 *   → Possible wrong PMID. The article with this PMID has a completely different title.
 *   → Should be flagged but treated as LIKELY_DUPLICATE (not hard CONFLICT)
 *     because title data is user-entered and less authoritative.
 *
 * DOI_TITLE_MISMATCH: DOI matches the candidate, but title similarity is very low.
 *   → Possible wrong DOI or article title was significantly changed after publication.
 *   → Surface as LIKELY_DUPLICATE with strong warning.
 *
 * Returns null if no conflict is detected (it's a clean duplicate).
 */
function detectConflictType(
  signals: IdentitySignals,
  row: NormalizedRow,
  candidate: ExistingArticle | MatchedRecord,
): ConflictType | null {
  // PMID_DOI_MISMATCH: PMID matches but incoming row's DOI exists and conflicts with candidate's DOI
  if (signals.pmidMatch && !signals.doiMatch && row.doi && candidate.doi && row.doi !== candidate.doi) {
    return "PMID_DOI_MISMATCH";
  }

  // PMID_TITLE_MISMATCH: PMID matches but title is completely different
  if (
    signals.pmidMatch &&
    signals.titleSimilarity < IMPORT_THRESHOLDS.CONFLICT_TITLE_MISMATCH_THRESHOLD &&
    row.title &&
    candidate.title
  ) {
    return "PMID_TITLE_MISMATCH";
  }

  // DOI_TITLE_MISMATCH: DOI matches but title is completely different
  if (
    signals.doiMatch &&
    signals.titleSimilarity < IMPORT_THRESHOLDS.CONFLICT_TITLE_MISMATCH_THRESHOLD &&
    row.title &&
    candidate.title
  ) {
    return "DOI_TITLE_MISMATCH";
  }

  return null; // No conflict — clean match
}

/**
 * Determine the primary match type from signals.
 * This determines which identifier "won" in the match.
 *
 * Priority order follows the identifier trust hierarchy:
 * PMID > DOI > PMCID > NIHMS_ID
 */
function determineMatchType(signals: IdentitySignals): MatchType | null {
  if (signals.pmidMatch) return "PMID_EXACT";
  if (signals.doiMatch) return "DOI_EXACT";
  if (signals.pmcidMatch) return "PMCID_EXACT";
  if (signals.nihmsIdMatch) return "NIHMS_EXACT";
  return null; // No exact match
}

// ─── IDENTITY RESULT BUILDER ──────────────────────────────────────────────────

/**
 * Build a human-readable explanation for the identity result.
 * This is what researchers read in the import preview UI.
 *
 * Good explanations are:
 * - Specific: name the actual values that matched/conflicted
 * - Actionable: tell the researcher what to do
 * - Honest: explain why the system can't auto-resolve (when applicable)
 */
function buildExplanation(
  matchType: MatchType,
  conflictType: ConflictType | null,
  signals: IdentitySignals,
  row: NormalizedRow,
  candidate: ExistingArticle | MatchedRecord,
  matchSource: "BATCH" | "PROJECT_DB",
): string {
  const source = matchSource === "BATCH" ? "this import batch" : "this project";
  const candidateRef =
    "rowIndex" in candidate && candidate.rowIndex !== undefined
      ? `Row ${candidate.rowIndex}`
      : "articleId" in candidate && candidate.articleId
        ? `article ${candidate.articleId}`
        : "an existing record";

  if (conflictType === "PMID_DOI_MISMATCH") {
    return [
      `PMID ${row.pmid} already exists in ${source} (${candidateRef}),`,
      `but the DOIs are different:`,
      `  Existing → ${candidate.doi ?? "none"}`,
      `  This row → ${row.doi ?? "none"}`,
      `Title similarity: ${Math.round(signals.titleSimilarity * 100)}%.`,
      `One of these records likely has an incorrect PMID.`,
      `This row has NOT been imported. Please review both records and take action.`,
    ].join("\n");
  }

  if (conflictType === "PMID_TITLE_MISMATCH") {
    return [
      `PMID ${row.pmid} already exists in ${source} (${candidateRef})`,
      `but the titles are very different (${Math.round(signals.titleSimilarity * 100)}% similar).`,
      `Existing title: "${candidate.title ?? "unknown"}"`,
      `This row title: "${row.title ?? "unknown"}"`,
      `The PMID may be incorrect. Please verify on PubMed.`,
    ].join("\n");
  }

  if (conflictType === "DOI_TITLE_MISMATCH") {
    return [
      `DOI ${row.doi} already exists in ${source} (${candidateRef})`,
      `but the titles are very different (${Math.round(signals.titleSimilarity * 100)}% similar).`,
      `This may indicate the DOI was incorrectly copied. Please verify.`,
    ].join("\n");
  }

  // Clean duplicate — which identifier matched?
  if (matchType === "PMID_EXACT") {
    return `PMID ${row.pmid} already exists in ${source} (${candidateRef}). This appears to be a duplicate.`;
  }
  if (matchType === "DOI_EXACT") {
    return `DOI ${row.doi} already exists in ${source} (${candidateRef}). This appears to be a duplicate.`;
  }
  if (matchType === "PMCID_EXACT") {
    return `PMCID ${row.pmcid} already exists in ${source} (${candidateRef}). This appears to be a duplicate.`;
  }
  if (matchType === "NIHMS_EXACT") {
    return `NIHMS ID ${row.nihmsId} already exists in ${source} (${candidateRef}). This appears to be a duplicate.`;
  }

  return "Match found with an existing record.";
}

// ─── MAIN IDENTITY RESOLUTION FUNCTION ────────────────────────────────────────

/**
 * Compare a normalized row against a single candidate article (from DB or batch).
 * Returns an IdentityResult if there's a match, null if no match.
 *
 * This function is called:
 * 1. For each row against each existing project article (DB check)
 * 2. For each row against the first occurrence of its identifier in the batch
 *
 * @param row - The normalized row being evaluated
 * @param candidate - The candidate article to compare against
 * @param matchSource - Whether the candidate is from the same batch or the project DB
 */
export function resolveIdentity(
  row: NormalizedRow,
  candidate: ExistingArticle | MatchedRecord,
  matchSource: "BATCH" | "PROJECT_DB",
): IdentityResult | null {
  const signals = computeIdentitySignals(row, candidate);
  const matchType = determineMatchType(signals);

  // No exact identifier match → return null (no identity result)
  // Fuzzy matching is handled separately in fuzzy.ts
  if (!matchType) return null;

  const conflictType = detectConflictType(signals, row, candidate);

  // A conflict is auto-resolvable only if it's actually a clean duplicate
  // (both PMID and DOI match → definitely the same article)
  const autoResolvable =
    conflictType === null &&
    (matchType === "PMID_EXACT" || matchType === "DOI_EXACT");

  const matchedRecord: MatchedRecord = {
    rowIndex: "rowIndex" in candidate ? candidate.rowIndex : undefined,
    articleId: "id" in candidate ? candidate.id : undefined,
    pmid: candidate.pmid,
    doi: candidate.doi,
    title: candidate.title,
    authors: candidate.authors,
    pubYear: candidate.pubYear,
    journal: candidate.journal,
  };

  const explanation = buildExplanation(
    matchType,
    conflictType,
    signals,
    row,
    candidate,
    matchSource,
  );

  return {
    matchedRecord,
    matchSource,
    matchType,
    conflictType,
    signals,
    autoResolvable,
    explanation,
  };
}

/**
 * Check a normalized row against all existing articles in the project database.
 * Returns the first match found (highest priority match first: PMID > DOI > PMCID > NIHMS).
 *
 * Why we return the first match only:
 * In a well-maintained database, a row will match at most one existing article
 * (because we enforce uniqueness on PMID and DOI at import time). Multiple matches
 * would indicate a data integrity issue — surface the first one.
 *
 * @param row - The normalized row being checked
 * @param existingArticles - All articles already in the project (fetched before import)
 */
export function checkAgainstProjectDb(
  row: NormalizedRow,
  existingArticles: ExistingArticle[],
): IdentityResult | null {
  let bestResult: IdentityResult | null = null;

  for (const article of existingArticles) {
    const result = resolveIdentity(row, article, "PROJECT_DB");
    if (result) {
      if (result.autoResolvable) {
        return result; // Clean duplicate wins immediately
      }
      if (!bestResult) {
        bestResult = result; // Keep the first conflict/likely duplicate
      }
    }
  }

  if (bestResult) return bestResult;

  // 2. Fallback: Check for title and author duplicates to prevent duplicate insertions
  // of rows without identifiers (or where existing DB entries lack identifiers).
  for (const article of existingArticles) {
    const rowHasNoIds = !row.pmid && !row.doi;
    const articleHasNoIds = !article.pmid && !article.doi;

    if (rowHasNoIds || articleHasNoIds) {
      const titleSim = computeTitleSimilarity(row.title, article.title);
      const authorOverlap = computeAuthorOverlap(row.authors, article.authors);

      // Require high title similarity and author overlap to qualify as an exact duplicate
      if (titleSim >= 0.98 && (authorOverlap >= 0.90 || !row.authors || !article.authors)) {
        return {
          matchedRecord: {
            articleId: article.id,
            pmid: article.pmid,
            doi: article.doi,
            title: article.title,
            authors: article.authors,
            pubYear: article.pubYear,
            journal: article.journal,
          },
          matchSource: "PROJECT_DB",
          matchType: "FUZZY_MULTI",
          conflictType: null,
          signals: {
            pmidMatch: false,
            doiMatch: false,
            pmcidMatch: false,
            nihmsIdMatch: false,
            titleSimilarity: titleSim,
            authorOverlap,
            yearMatch: true,
            journalSimilarity: 1,
          },
          autoResolvable: true,
          explanation: `Matches existing article on title and authors without conflicting identifiers. Marked as duplicate to prevent redundant import.`,
        };
      }
    }
  }

  return null;
}
