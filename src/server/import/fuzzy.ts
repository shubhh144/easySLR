/**
 * FUZZY MATCHING MODULE
 *
 * Stage 4 of the Import Intelligence Pipeline — soft signal only.
 *
 * CRITICAL CONSTRAINT — READ THIS FIRST:
 * Fuzzy matching in this system is ONLY used to generate POSSIBLE_MATCH status.
 * It NEVER:
 *   - Auto-resolves any ambiguity
 *   - Overrides a decision made by exact identifier matching
 *   - Merges, deletes, or modifies any record
 *   - Changes LIKELY_DUPLICATE or CONFLICT decisions
 *
 * It ONLY:
 *   - Adds a soft "Similar article exists" badge to a cleanly imported row
 *   - Provides the researcher with additional context
 *
 * Why fuzzy matching at all:
 * A researcher who imports the same article twice from different databases
 * (e.g., PubMed and Scopus) with slightly different metadata would never know
 * without fuzzy matching. The article would silently exist twice in the project.
 * POSSIBLE_MATCH prevents silent data quality degradation.
 *
 * Why Jaro-Winkler for title similarity:
 * Jaro-Winkler is good for short-to-medium strings with character-level differences
 * (typos, truncations). It gives a prefix bonus — titles that share a common
 * beginning score higher. This matches how researchers often abbreviate titles.
 *
 * Alternative considered: Levenshtein distance
 * Not chosen because it gives equal weight to all edits. A title that has one extra
 * word at the end ("...a systematic review" vs "...a systematic review and meta-analysis")
 * would score poorly on Levenshtein but high on Jaro-Winkler. Academic titles
 * often have subtitle additions, making Jaro-Winkler more appropriate.
 *
 * Alternative considered: Cosine similarity with TF-IDF
 * Not chosen because it requires a corpus to compute IDF weights. For a small
 * import batch, TF-IDF is both overkill and produces worse results on short texts
 * than Jaro-Winkler.
 */

import {
  IMPORT_THRESHOLDS,
  type ExistingArticle,
  type FuzzyCandidate,
  type FuzzyMatchResult,
  type MatchedRecord,
  type NormalizedRow,
} from "./types";

// ─── JARO-WINKLER IMPLEMENTATION ─────────────────────────────────────────────

/**
 * Compute the Jaro similarity between two strings.
 * The Jaro similarity is 0 for completely different strings and 1 for identical strings.
 *
 * Algorithm:
 * 1. Find matching characters (within a matching window = floor(max_len/2) - 1)
 * 2. Count transpositions (matched characters in different order)
 * 3. Jaro = (matches/s1 + matches/s2 + (matches-transpositions/2)/matches) / 3
 *
 * Why we implement this ourselves (not use a library):
 * This function is called for every row × every candidate — potentially thousands
 * of times per import. A dependency adds bundle weight and obscures the logic.
 * The implementation is ~40 lines and is independently testable.
 * In an interview, you can explain exactly how it works.
 */
function jaro(s1: string, s2: string): number {
  if (s1 === s2) return 1;
  if (s1.length === 0 || s2.length === 0) return 0;

  const matchWindow = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;
  const s1Matches = new Array<boolean>(s1.length).fill(false);
  const s2Matches = new Array<boolean>(s2.length).fill(false);

  let matches = 0;
  let transpositions = 0;

  // Find matching characters
  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, s2.length);

    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0;

  // Count transpositions
  let k = 0;
  for (let i = 0; i < s1.length; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }

  return (
    (matches / s1.length +
      matches / s2.length +
      (matches - transpositions / 2) / matches) /
    3
  );
}

/**
 * Compute Jaro-Winkler similarity.
 * Adds a prefix bonus (p) to the Jaro score for strings that share a common prefix.
 * p = 0.1 is the standard value (cannot exceed 0.25 per the original paper).
 *
 * Why the prefix bonus matters for academic titles:
 * "Remote monitoring after cardiac surgery" and
 * "Remote monitoring after cardiac surgery: a pilot study"
 * share a long common prefix. Jaro-Winkler correctly identifies these as very similar.
 */
function jaroWinkler(s1: string, s2: string, p = 0.1): number {
  const jaroScore = jaro(s1, s2);

  // Find common prefix length (up to 4 characters per Winkler's recommendation)
  let prefixLen = 0;
  for (let i = 0; i < Math.min(4, s1.length, s2.length); i++) {
    if (s1[i] === s2[i]) prefixLen++;
    else break;
  }

  return jaroScore + prefixLen * p * (1 - jaroScore);
}

// ─── TITLE SIMILARITY ────────────────────────────────────────────────────────

/**
 * Compute title similarity using Jaro-Winkler on normalized lowercase titles.
 *
 * Normalization before comparison:
 * 1. Lowercase (titles may have different capitalization conventions)
 * 2. Remove punctuation that doesn't affect meaning (colons, commas, periods)
 * 3. Collapse whitespace
 *
 * Why normalize: "Digital adherence tools for diabetes care: a randomized trial"
 * vs "Digital Adherence Tools for Diabetes Care" should match.
 * Without lowercasing, Jaro-Winkler would penalize the capital letters.
 *
 * Returns 0 if either title is null.
 */
export function computeTitleSimilarity(
  titleA: string | null,
  titleB: string | null,
): number {
  if (!titleA || !titleB) return 0;

  const normalize = (t: string): string =>
    t
      .toLowerCase()
      .replace(/[^\w\s]/g, " ") // Replace punctuation with spaces
      .replace(/\s+/g, " ")     // Collapse whitespace
      .trim();

  return jaroWinkler(normalize(titleA), normalize(titleB));
}

// ─── AUTHOR OVERLAP (JACCARD COEFFICIENT) ────────────────────────────────────

/**
 * Compute author overlap using Jaccard coefficient on normalized author tokens.
 *
 * Jaccard coefficient = |intersection| / |union|
 * Range: 0.0 (no overlap) to 1.0 (identical sets)
 *
 * Author normalization:
 * 1. Split on semicolons
 * 2. For each author: lowercase, remove punctuation
 * 3. Normalize to "lastname firstinitial" format where possible
 *    "Smith J" → "smith j"
 *    "John Smith" → harder (can't reliably detect first vs last name)
 *    → We use the full normalized string and match on that
 *
 * Why Jaccard and not Jaro-Winkler for authors:
 * Authors is a SET of names, not a string. The same author list in different
 * order should match perfectly. Jaccard measures set overlap correctly.
 * Jaro-Winkler operates on strings and would penalize ordering differences.
 *
 * Why we don't normalize first/last name order:
 * "Smith J" vs "J. Smith" vs "John Smith" are all valid formats for the same person.
 * Full normalization would require a name parser. Instead, we use simple token
 * overlap — if enough tokens match, the authors likely overlap.
 *
 * Returns 0 if either authors string is null.
 */
export function computeAuthorOverlap(
  authorsA: string | null,
  authorsB: string | null,
): number {
  if (!authorsA || !authorsB) return 0;

  const normalizeAuthor = (a: string): string =>
    a
      .toLowerCase()
      .replace(/[^a-z\s]/g, "") // Remove non-alpha (dots, commas)
      .replace(/\s+/g, " ")
      .trim();

  const parseAuthors = (authors: string): Set<string> => {
    const parts = authors.split(";").map((a) => normalizeAuthor(a)).filter(Boolean);
    return new Set(parts);
  };

  const setA = parseAuthors(authorsA);
  const setB = parseAuthors(authorsB);

  if (setA.size === 0 || setB.size === 0) return 0;

  const intersection = [...setA].filter((a) => setB.has(a));
  const union = new Set([...setA, ...setB]);

  return intersection.length / union.size;
}

// ─── POSSIBLE MATCH DETECTION ─────────────────────────────────────────────────

/**
 * Determine if a row is a POSSIBLE_MATCH against a candidate.
 *
 * A POSSIBLE_MATCH requires ALL of the following:
 * 1. Title similarity ≥ FUZZY_POSSIBLE_MATCH_TITLE (0.85)
 *    AND
 * 2. At least one corroborating signal:
 *    - Author overlap ≥ FUZZY_POSSIBLE_MATCH_AUTHOR (0.5)
 *    - OR year matches (within buffer)
 *
 * Why both conditions are required:
 * Title alone is not enough — many papers share similar titles:
 *   "Systematic review of exercise interventions for X"
 *   "Systematic review of exercise interventions for Y"
 * Title similarity here would be ~0.88 but these are completely different papers.
 * Requiring a corroborating signal dramatically reduces false positives.
 *
 * Why we don't require BOTH author AND year:
 * A paper may appear from two databases with slightly different author lists
 * (one uses full names, another uses initials). We want to catch this case.
 * Requiring either author overlap OR year match gives us flexibility.
 */
function isPossibleMatch(
  titleSimilarity: number,
  authorOverlap: number,
  yearMatch: boolean,
): boolean {
  const titleThresholdMet = titleSimilarity >= IMPORT_THRESHOLDS.FUZZY_POSSIBLE_MATCH_TITLE;
  const authorCorroborates = authorOverlap >= IMPORT_THRESHOLDS.FUZZY_POSSIBLE_MATCH_AUTHOR;
  const yearCorroborates = yearMatch;

  return titleThresholdMet && (authorCorroborates || yearCorroborates);
}

// ─── MAIN FUZZY MATCH FUNCTION ────────────────────────────────────────────────

/**
 * Run fuzzy matching for a row against all existing articles.
 * Returns candidates that meet the POSSIBLE_MATCH threshold.
 *
 * This function is ONLY called when exact identifier matching found NO match.
 * If exact matching found a match, fuzzy matching is skipped entirely.
 *
 * Why skip when exact match found:
 * If PMID or DOI matched, we already have the correct classification
 * (LIKELY_DUPLICATE or CONFLICT). Running fuzzy matching would add noise
 * and potentially contradict the exact match result. Exact always wins.
 *
 * Performance note:
 * This is O(n) where n = number of existing articles. For 1000 articles,
 * that's 1000 Jaro-Winkler comparisons per row. For a 100-row import batch,
 * that's 100,000 comparisons — acceptable for synchronous execution.
 * For 10,000+ article projects, this should move to an async job.
 */
export function findPossibleMatches(
  row: NormalizedRow,
  existingArticles: ExistingArticle[],
): FuzzyMatchResult {
  const candidates: FuzzyCandidate[] = [];

  for (const article of existingArticles) {
    const titleSimilarity = computeTitleSimilarity(row.title, article.title);

    // Early exit: if title similarity is below threshold, don't compute other signals
    // This is an optimization — Jaro-Winkler is the most expensive computation
    if (titleSimilarity < IMPORT_THRESHOLDS.FUZZY_POSSIBLE_MATCH_TITLE) continue;

    const authorOverlap = computeAuthorOverlap(row.authors, article.authors);
    const yearMatch = !!(
      row.pubYear &&
      article.pubYear &&
      Math.abs(row.pubYear - article.pubYear) <= IMPORT_THRESHOLDS.YEAR_MATCH_BUFFER
    );

    // Check if this meets the POSSIBLE_MATCH threshold
    if (!isPossibleMatch(titleSimilarity, authorOverlap, yearMatch)) continue;

    // Compute journal similarity (cheap string comparison)
    const journalTokens = (s: string | null): Set<string> =>
      new Set(
        (s ?? "")
          .toLowerCase()
          .split(/\s+/)
          .filter((t) => t.length > 2),
      );

    const jA = journalTokens(row.journal);
    const jB = journalTokens(article.journal);
    const jIntersection = [...jA].filter((t) => jB.has(t));
    const journalSimilarity =
      jA.size === 0 && jB.size === 0
        ? 0
        : jIntersection.length / Math.sqrt(jA.size * jB.size);

    // Combined soft score: weighted sum of signals
    // Used ONLY for ranking candidates — never for auto-resolution
    const combinedScore =
      titleSimilarity * 0.55 +
      authorOverlap * 0.25 +
      (yearMatch ? 1 : 0) * 0.15 +
      journalSimilarity * 0.05;

    const matchedRecord: MatchedRecord = {
      articleId: article.id,
      pmid: article.pmid,
      doi: article.doi,
      title: article.title,
      authors: article.authors,
      pubYear: article.pubYear,
      journal: article.journal,
    };

    candidates.push({
      matchedRecord,
      titleSimilarity,
      authorOverlap,
      yearMatch,
      journalSimilarity,
      combinedScore,
    });
  }

  // Sort by combined score descending — best match first
  candidates.sort((a, b) => b.combinedScore - a.combinedScore);

  return {
    bestMatch: candidates[0] ?? null,
    allCandidates: candidates,
  };
}
