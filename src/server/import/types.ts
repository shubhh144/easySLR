/**
 * IMPORT INTELLIGENCE LAYER — TYPE DEFINITIONS
 *
 * This file is the single source of truth for all data shapes in the import pipeline.
 * Every other import file imports from here. No type is defined more than once.
 *
 * Design principle: Types flow in one direction through the pipeline.
 *   RawRow → NormalizedRow → ValidatedRow → ProcessedRow → ImportResult
 *
 * Why types before code: TypeScript enforces the contract between pipeline stages.
 * A mismatch between what normalize.ts produces and what validate.ts expects is a
 * compile error, not a runtime crash in production.
 */

// ─── STAGE 0: RAW INPUT ───────────────────────────────────────────────────────

/**
 * The raw shape of one Excel row, exactly as parsed by SheetJS.
 * Every field is unknown until normalized — values may be strings, numbers,
 * null, undefined, or unexpected types (e.g., year as a word string).
 *
 * Why all fields are string | number | null:
 * SheetJS parses cell values based on Excel cell type. A numeric cell like
 * Publication Year comes back as a number. A text cell comes back as a string.
 * A blank cell comes back as undefined (we normalize to null).
 */
export interface RawRow {
  rowIndex: number; // 1-based row number in the Excel file (for UI display)
  pmid: string | number | null;
  title: string | null;
  authors: string | null;
  citation: string | null;
  firstAuthor: string | null;
  journal: string | null;
  pubYear: string | number | null; // May be "Twenty twenty", 2024, "2024", etc.
  createDate: string | null;
  pmcid: string | null;
  nihmsId: string | null;
  doi: string | null;
}

// ─── STAGE 1: NORMALIZED ROW ─────────────────────────────────────────────────

/**
 * A row after Stage 1 (normalization). All fields are now in canonical form.
 * The pipeline stages downstream can trust these types without re-checking.
 *
 * Key invariants after normalization:
 * - pmid: trimmed string or null (never has whitespace, never "unknown")
 * - doi: lowercase, no "DOI:" prefix, starts with "10." if present
 * - pubYear: integer or null (never a word string)
 * - authors/firstAuthor: trimmed, sentinel values ("Unknown") replaced with null
 *
 * Why keep the original values:
 * We store what was auto-corrected so the UI can show the researcher exactly
 * what changed. Transparency builds trust.
 */
export interface NormalizedRow {
  rowIndex: number;
  pmid: string | null;
  title: string | null;
  authors: string | null;
  citation: string | null;
  firstAuthor: string | null;
  journal: string | null;
  pubYear: number | null;
  createDate: string | null;
  pmcid: string | null;
  nihmsId: string | null;
  doi: string | null;

  // Track what was changed during normalization
  corrections: Correction[];
}

// ─── STAGE 2: VALIDATED ROW ──────────────────────────────────────────────────

/**
 * A row after Stage 2 (field validation). Contains:
 * - All normalized fields (inherited)
 * - Field-level warnings (missing title, future year, etc.)
 * - Inferred fields (year from Citation, firstAuthor from Authors)
 *
 * The validated row still has status IMPORTED — duplicate/conflict detection
 * runs in later stages and may escalate the status.
 */
export interface ValidatedRow extends NormalizedRow {
  warnings: Warning[];
  inferred: InferredField[];
}

// ─── STAGE 3: PROCESSED ROW (FINAL OUTPUT) ───────────────────────────────────

/**
 * The final output of the full pipeline for one row.
 * This is what gets stored in the ImportLog and returned to the UI.
 *
 * finalStatus is the authoritative classification.
 * It can only escalate, never de-escalate:
 *   IMPORTED → AUTO_CORRECTED → IMPORTED_WARNING → POSSIBLE_MATCH → LIKELY_DUPLICATE → CONFLICT
 */
export interface ProcessedRow {
  rowIndex: number;

  // Original values as they came from Excel
  original: RawRow;

  // Values after normalization and inference
  normalized: NormalizedRow;

  // All changes made during normalization
  corrections: Correction[];

  // All quality issues found during validation
  warnings: Warning[];

  // Fields inferred from other fields (year from Citation, etc.)
  inferred: InferredField[];

  // Duplicate/conflict detection result (null if no match found)
  identityResult: IdentityResult | null;

  // The authoritative final classification
  finalStatus: ImportStatus;

  // Which rule assigned the final status
  decidingRule: string;

  // Human-readable explanation of the final status
  explanation: string;
}

// ─── STATUS ENUM ─────────────────────────────────────────────────────────────

/**
 * The six possible outcomes for an imported row.
 *
 * Severity order (lowest to highest):
 *   IMPORTED < AUTO_CORRECTED < IMPORTED_WARNING < POSSIBLE_MATCH < LIKELY_DUPLICATE < CONFLICT
 *
 * Why no REJECTED: Every row has enough information to be useful. We import with
 * warnings instead of rejecting, because silent rejection loses researcher data.
 * The assignment says handle invalidity "in a way you consider appropriate" —
 * this approach maximizes data preservation while maintaining quality signals.
 */
export type ImportStatus =
  | "IMPORTED"           // Clean row, no issues
  | "AUTO_CORRECTED"     // Had fixable issues (whitespace, DOI prefix, year-as-text)
  | "IMPORTED_WARNING"   // Has non-blocking quality issues (missing title, future year)
  | "POSSIBLE_MATCH"     // Fuzzy similarity detected, imported but flagged passively
  | "LIKELY_DUPLICATE"   // Strong match found, surfaced for researcher confirmation
  | "CONFLICT"           // Authoritative identifiers contradict — requires human decision
  | "AUTO_RESOLVED_DUPLICATE"; // Exact duplicate automatically resolved without manual intervention

// ─── SUPPORTING TYPES ────────────────────────────────────────────────────────

/**
 * A single auto-correction that was applied during normalization.
 * Stored so the UI can show: "This field was changed from X to Y."
 *
 * Why we store this: Researchers must trust the system. Showing them exactly
 * what was auto-corrected (and why) builds confidence in the import result.
 */
export interface Correction {
  field: string;         // Which field was corrected
  originalValue: string; // What the original value was
  correctedValue: string; // What it was changed to
  reason: string;        // Human-readable reason for the correction
}

/**
 * A quality warning attached to a row.
 * Warnings do not prevent import — they surface issues for researcher awareness.
 *
 * severity controls how prominently the warning is shown in the UI:
 *   INFO    → small grey indicator, no action needed
 *   LOW     → subtle yellow indicator
 *   MEDIUM  → orange indicator, researcher should verify
 *   HIGH    → red indicator, researcher must verify before relying on this record
 */
export interface Warning {
  field: string;
  severity: "INFO" | "LOW" | "MEDIUM" | "HIGH";
  message: string;
  suggestion?: string; // Optional: tell the researcher what to do
}

/**
 * A field that was inferred from another field's value.
 * Example: pubYear inferred from Citation string "Methods Today. 2020;7(3)"
 *
 * Stored separately from corrections so the UI can clearly distinguish:
 * - Correction = "we fixed a problem with your data"
 * - Inference  = "we filled in missing data from another field"
 */
export interface InferredField {
  field: string;        // Which field was inferred
  value: string | number; // The inferred value
  source: string;       // Which field it was inferred from
  confidence: "HIGH" | "MEDIUM" | "LOW"; // How confident is the inference
}

// ─── IDENTITY RESOLUTION ─────────────────────────────────────────────────────

/**
 * The result of comparing this row against existing articles (in the project DB
 * or in the same import batch).
 *
 * When identityResult is null: no match was found → status stays IMPORTED.
 * When identityResult is present: a match was found → status escalates based on
 * matchType and conflictType.
 */
export interface IdentityResult {
  // The matched record
  matchedRecord: MatchedRecord;

  // Whether the match was found in the batch (same file) or in the project DB
  matchSource: "BATCH" | "PROJECT_DB";

  // The type of match that was found
  matchType: MatchType;

  // If matchType indicates a conflict, what kind of conflict is it?
  conflictType: ConflictType | null;

  // The specific signals computed during identity resolution
  signals: IdentitySignals;

  // Whether the engine can auto-resolve this without human input
  autoResolvable: boolean;

  // Human-readable explanation for the UI
  explanation: string;
}

/**
 * The minimal fields of the record that matched (from DB or batch).
 * Used by the UI to render the side-by-side comparison panel.
 */
export interface MatchedRecord {
  rowIndex?: number;   // Present if match is from same batch (batch-level match)
  articleId?: string;  // Present if match is from project DB
  pmid: string | null;
  doi: string | null;
  title: string | null;
  authors: string | null;
  pubYear: number | null;
  journal: string | null;
}

/**
 * The raw signals computed during identity resolution.
 * These feed into both auto-resolution logic and the UI similarity display.
 *
 * Why store signals separately:
 * The UI shows researchers these exact numbers ("Title similarity: 4%").
 * Storing them means we don't re-compute anything — we just read from storage.
 */
export interface IdentitySignals {
  pmidMatch: boolean;
  doiMatch: boolean;
  pmcidMatch: boolean;
  nihmsIdMatch: boolean;
  titleSimilarity: number;   // 0.0–1.0
  authorOverlap: number;     // 0.0–1.0 (Jaccard similarity)
  yearMatch: boolean;
  journalSimilarity: number; // 0.0–1.0
}

/**
 * The type of identifier match that triggered the identity result.
 * Exact matches always take precedence over fuzzy matches.
 */
export type MatchType =
  | "PMID_EXACT"       // PMID matches exactly — strongest signal
  | "DOI_EXACT"        // DOI matches exactly (after normalization)
  | "PMCID_EXACT"      // PMCID matches exactly
  | "NIHMS_EXACT"      // NIHMS ID matches exactly
  | "FUZZY_MULTI"      // Multiple soft signals align (title + author + year)
  | "FUZZY_TITLE_ONLY"; // Title alone is similar (weakest — only POSSIBLE_MATCH)

/**
 * The type of conflict when two authoritative identifiers contradict.
 * Used to generate specific, actionable UI messages.
 */
export type ConflictType =
  | "PMID_DOI_MISMATCH"   // PMID matches one record, DOI matches another
  | "PMID_TITLE_MISMATCH" // PMID matches but title is very different (possible wrong PMID)
  | "DOI_TITLE_MISMATCH"; // DOI matches but title is very different

// ─── BATCH INDEX ─────────────────────────────────────────────────────────────

/**
 * An index built from all rows in a single import batch BEFORE any DB check.
 * This is how we detect duplicates WITHIN the same uploaded file.
 *
 * Why a batch index is necessary:
 * If Row 1 and Row 16 both have PMID 38910016, and the project DB is empty,
 * record-level deduplication alone would insert both rows successfully because
 * neither exists in the DB when the other is being processed. The batch index
 * catches internal duplicates before any DB operation.
 */
export interface BatchIndex {
  // Maps normalized PMID → array of row indices that share this PMID
  byPmid: Map<string, number[]>;

  // Maps normalized DOI → array of row indices that share this DOI
  byDoi: Map<string, number[]>;

  // Maps normalized PMCID → array of row indices
  byPmcid: Map<string, number[]>;

  // Maps normalized NIHMS ID → array of row indices
  byNihmsId: Map<string, number[]>;
}

// ─── EXISTING ARTICLE (FROM PROJECT DB) ──────────────────────────────────────

/**
 * A minimal projection of an existing Article from the project database.
 * We only fetch the fields needed for identity resolution — not the full article.
 *
 * Why a minimal projection:
 * For large projects (1000+ articles), fetching full articles for deduplication
 * would be expensive. We fetch only the identifier fields used in matching.
 */
export interface ExistingArticle {
  id: string;
  pmid: string | null;
  doi: string | null;
  pmcid: string | null;
  nihmsId: string | null;
  title: string | null;
  authors: string | null;
  pubYear: number | null;
  journal: string | null;
  importNotes?: any;
}

// ─── IMPORT RESULT (FINAL BATCH SUMMARY) ─────────────────────────────────────

/**
 * The complete output of processing an entire import batch.
 * This is what gets stored in the ImportLog and returned to the UI.
 *
 * split into imported/autoCorrected/warnings/etc for easy UI rendering.
 * The rows arrays reference the same ProcessedRow objects — no duplication.
 */
export interface ImportBatchResult {
  totalRows: number;
  processedRows: ProcessedRow[];

  // Grouped views for the UI summary
  imported: ProcessedRow[];            // finalStatus = IMPORTED
  autoCorrected: ProcessedRow[];       // finalStatus = AUTO_CORRECTED
  importedWithWarning: ProcessedRow[]; // finalStatus = IMPORTED_WARNING
  possibleMatches: ProcessedRow[];     // finalStatus = POSSIBLE_MATCH
  likelyDuplicates: ProcessedRow[];    // finalStatus = LIKELY_DUPLICATE
  conflicts: ProcessedRow[];           // finalStatus = CONFLICT
  autoResolvedDuplicates: ProcessedRow[]; // finalStatus = AUTO_RESOLVED_DUPLICATE

  // Grouped conflict clusters for the UI preview & resolution
  clusters: ConflictCluster[];

  summary: ImportSummary;
}

export interface ImportSummary {
  importedCount: number;
  autoCorrectedCount: number;
  importedWithWarningCount: number;
  possibleMatchCount: number;
  likelyDuplicateCount: number;
  conflictCount: number;
  autoResolvedDuplicateCount: number;
  totalSuccessfullyImported: number; // imported + autoCorrected + importedWithWarning + possibleMatch
}

export interface ConflictCluster {
  id: string; // e.g. cluster-doi-xxx or cluster-pmid-yyy
  type: "SYSTEMIC_DOI_COLLISION" | "SYSTEMIC_PMID_COLLISION" | "DUPLICATE_GROUP";
  sharedIdentifier: string;
  affectedRowIndices: number[]; // indices of rows grouped into this cluster
  explanation: string;
  suggestedResolution: string;
}

// ─── FUZZY MATCHING (SOFT SIGNALS ONLY) ──────────────────────────────────────

/**
 * The result of fuzzy matching one row against candidate records.
 * Fuzzy matching is ONLY used for POSSIBLE_MATCH detection.
 *
 * Critical constraint: fuzzy matching NEVER auto-resolves, merges, or
 * overrides any decision made by exact identifier matching.
 * It is purely additive — it can only add a POSSIBLE_MATCH soft warning
 * to a row that has no exact identifier match.
 */
export interface FuzzyMatchResult {
  // null if no similar record found
  bestMatch: FuzzyCandidate | null;
  // All candidates above the POSSIBLE_MATCH threshold (for transparency)
  allCandidates: FuzzyCandidate[];
}

export interface FuzzyCandidate {
  matchedRecord: MatchedRecord;
  titleSimilarity: number;   // Jaro-Winkler score 0.0–1.0
  authorOverlap: number;     // Jaccard coefficient 0.0–1.0
  yearMatch: boolean;
  journalSimilarity: number; // Token overlap 0.0–1.0
  // Combined soft score (weighted sum of above signals)
  // Used ONLY for ranking candidates — never for auto-resolution
  combinedScore: number;
}

// ─── THRESHOLDS (EXPLICIT CONSTANTS — NOT MAGIC NUMBERS) ─────────────────────

/**
 * All decision thresholds in one place, with explicit names and comments.
 *
 * Why explicit constants instead of inline numbers:
 * - Searchable: grep for FUZZY_POSSIBLE_MATCH_THRESHOLD
 * - Changeable: update the threshold in one place, all rules update
 * - Testable: tests can import and reference these constants
 * - Explainable: each constant has a comment explaining why it's set to that value
 *
 * Interview answer: "I put all thresholds in a named constant object because
 * thresholds are policy decisions, not code decisions. When a researcher says
 * 'too many false positives', I can adjust one number and every rule updates."
 */
export const IMPORT_THRESHOLDS = {
  /**
   * Title similarity above this → POSSIBLE_MATCH (soft badge, no action required).
   * Set at 0.85 because below this, different papers with similar keywords
   * produce false positives (e.g., "Systematic review of X" vs "Systematic review of Y").
   */
  FUZZY_POSSIBLE_MATCH_TITLE: 0.85,

  /**
   * Author overlap above this (combined with title) → strengthens POSSIBLE_MATCH.
   * Jaccard coefficient. 0.5 means >50% of authors overlap.
   */
  FUZZY_POSSIBLE_MATCH_AUTHOR: 0.5,

  /**
   * Publication year difference within this range → years "match" for fuzzy purposes.
   * 1 year buffer allows for epub-ahead-of-print scenarios.
   */
  YEAR_MATCH_BUFFER: 1,

  /**
   * If title similarity < this AND PMID matches → PMID_TITLE_MISMATCH conflict.
   * Low threshold (0.30) because we only flag when titles are substantially different,
   * not just slightly different phrasing.
   */
  CONFLICT_TITLE_MISMATCH_THRESHOLD: 0.30,

  /**
   * Publication year more than this many years in the future → HIGH severity warning.
   * 1 year buffer for epub-ahead-of-print publications.
   */
  FUTURE_YEAR_WARNING_BUFFER: 1,

  /**
   * Publication year more than this many years in the future → HIGH severity warning.
   * Beyond 1 year buffer, it's very likely a data entry error.
   */
  FUTURE_YEAR_HIGH_SEVERITY_BUFFER: 5,

  /**
   * Number of rows sharing the same identifier (PMID/DOI) but with conflicting metadata
   * at which we declare a Systemic Collision.
   */
  SYSTEMIC_COLLISION_THRESHOLD: 5,
} as const;

