/**
 * IMPORT RULE ENGINE — ORCHESTRATOR
 *
 * The final stage of the Import Intelligence Pipeline.
 *
 * What this does:
 * Takes all normalized rows, the batch index, and existing project articles,
 * then runs every stage of the pipeline in the correct order, producing a
 * final ImportBatchResult with a ProcessedRow for every input row.
 *
 * Pipeline execution order (MUST NOT be changed):
 * 1. Normalize raw row → NormalizedRow
 * 2. Validate fields → ValidatedRow (warnings attached)
 * 3. Check batch index → detect within-file duplicates FIRST
 * 4. Check project DB → detect cross-import duplicates
 * 5. If no exact match found → run fuzzy matching for POSSIBLE_MATCH
 * 6. Assign final status based on all signals (status can only escalate)
 * 7. Build ProcessedRow with full audit trail
 *
 * The "status escalation" rule:
 * Status moves in one direction only:
 *   IMPORTED → AUTO_CORRECTED → IMPORTED_WARNING → POSSIBLE_MATCH → LIKELY_DUPLICATE → CONFLICT
 *
 * If a row has corrections (auto-corrected) AND warnings (missing title), the
 * final status is IMPORTED_WARNING (higher severity wins). We never de-escalate.
 *
 * Why the engine is separate from the individual stage files:
 * Each stage file (normalize.ts, validate.ts, etc.) is independently testable
 * without knowing about the others. The engine wires them together.
 * This separation of concerns means: changing one stage doesn't require modifying
 * the other stages. Only the engine wires changes together.
 *
 * Interview answer:
 * "I separated the pipeline into individual pure functions and a single orchestrator.
 * Each stage is independently testable. The orchestrator is the only file with
 * knowledge of the full pipeline — making it the single place to reason about
 * the end-to-end flow."
 */

import {
  type ExistingArticle,
  type ImportBatchResult,
  type ImportStatus,
  type ImportSummary,
  type NormalizedRow,
  type ProcessedRow,
  type RawRow,
  type ValidatedRow,
  type ConflictCluster,
  IMPORT_THRESHOLDS,
} from "./types";
import { normalizeRow } from "./normalize";
import { validateRow, warrantWarningStatus } from "./validate";
import { buildBatchIndex, findBatchDuplicate } from "./batchIndex";
import {
  checkAgainstProjectDb,
  resolveIdentity,
} from "./duplicate";
import { findPossibleMatches, computeTitleSimilarity } from "./fuzzy";

// ─── STATUS ESCALATION LOGIC ──────────────────────────────────────────────────

/**
 * Severity ranking for import statuses.
 * Used to enforce "status can only escalate" rule.
 * Higher number = higher severity.
 */
const STATUS_SEVERITY: Record<ImportStatus, number> = {
  IMPORTED: 0,
  AUTO_RESOLVED_DUPLICATE: 1,
  AUTO_CORRECTED: 2,
  IMPORTED_WARNING: 3,
  POSSIBLE_MATCH: 4,
  LIKELY_DUPLICATE: 5,
  CONFLICT: 6,
};

/**
 * Escalate status to the higher severity of the two.
 * Used when a row has multiple issues (corrections AND warnings).
 */
function escalateStatus(current: ImportStatus, candidate: ImportStatus): ImportStatus {
  return STATUS_SEVERITY[candidate] > STATUS_SEVERITY[current] ? candidate : current;
}

// ─── INITIAL STATUS FROM VALIDATION ──────────────────────────────────────────

/**
 * Determine the initial import status based on normalization corrections
 * and field validation warnings.
 *
 * This runs BEFORE duplicate/conflict detection.
 * Duplicate/conflict detection may escalate this further.
 */
function getInitialStatus(validated: ValidatedRow): {
  status: ImportStatus;
  decidingRule: string;
} {
  const hasCorrections = validated.corrections.length > 0;
  const hasHighSeverityWarnings = warrantWarningStatus(validated.warnings);

  if (hasHighSeverityWarnings) {
    return { status: "IMPORTED_WARNING", decidingRule: "field-validation" };
  }
  if (hasCorrections) {
    return { status: "AUTO_CORRECTED", decidingRule: "normalization" };
  }
  return { status: "IMPORTED", decidingRule: "clean" };
}

// ─── EXPLANATION BUILDER ──────────────────────────────────────────────────────

/**
 * Generate the final explanation string for a processed row.
 * This is what gets shown in the import preview UI and stored in the audit log.
 *
 * We build this from the final status, corrections, and warnings
 * so the researcher gets a complete picture in one place.
 */
function buildFinalExplanation(
  status: ImportStatus,
  validated: ValidatedRow,
  identityExplanation: string | null,
): string {
  const parts: string[] = [];

  switch (status) {
    case "IMPORTED":
      parts.push("Record is valid and has been imported successfully.");
      break;
    case "AUTO_RESOLVED_DUPLICATE":
      parts.push("Record is an exact duplicate of an existing article and has been auto-resolved (skipped).");
      if (identityExplanation) parts.push(identityExplanation);
      break;
    case "AUTO_CORRECTED":
      parts.push("Record was auto-corrected and imported.");
      for (const c of validated.corrections) {
        parts.push(`  • ${c.field}: "${c.originalValue}" → "${c.correctedValue}" (${c.reason})`);
      }
      break;
    case "IMPORTED_WARNING":
      parts.push("Record was imported with quality warnings.");
      for (const w of validated.warnings) {
        if (w.severity === "MEDIUM" || w.severity === "HIGH") {
          parts.push(`  • [${w.severity}] ${w.field}: ${w.message}`);
          if (w.suggestion) parts.push(`    → ${w.suggestion}`);
        }
      }
      if (validated.corrections.length > 0) {
        parts.push("Auto-corrections applied:");
        for (const c of validated.corrections) {
          parts.push(`  • ${c.field}: "${c.originalValue}" → "${c.correctedValue}"`);
        }
      }
      break;
    case "POSSIBLE_MATCH":
      parts.push("Record was imported. A similar article was found in this project.");
      if (identityExplanation) parts.push(identityExplanation);
      break;
    case "LIKELY_DUPLICATE":
      parts.push("Record appears to be a duplicate of an existing article.");
      if (identityExplanation) parts.push(identityExplanation);
      break;
    case "CONFLICT":
      parts.push("Record has conflicting identifiers and could not be auto-resolved.");
      if (identityExplanation) parts.push(identityExplanation);
      break;
  }

  return parts.join("\n");
}

// ─── SINGLE ROW PROCESSOR ─────────────────────────────────────────────────────

/**
 * Process a single row through the complete pipeline.
 * Returns a ProcessedRow with all signals, decisions, and explanations.
 */
function processRow(
  raw: RawRow,
  allNormalizedRows: NormalizedRow[],
  batchIndex: ReturnType<typeof buildBatchIndex>,
  existingArticles: ExistingArticle[],
  systemicPmids: Set<string>,
  systemicDois: Set<string>,
): ProcessedRow {
  // ── STAGE 1: NORMALIZE ────────────────────────────────────────────────────
  const normalized = normalizeRow(raw);

  // ── STAGE 2: VALIDATE ─────────────────────────────────────────────────────
  const validated = validateRow(normalized, typeof raw.doi === "string" ? raw.doi : null);

  // ── INITIAL STATUS from normalization + validation ────────────────────────
  let { status, decidingRule } = getInitialStatus(validated);

  let identityResult = null;

  // Check systemic collision first
  const hasSystemicPmid = normalized.pmid && systemicPmids.has(normalized.pmid);
  const hasSystemicDoi = normalized.doi && systemicDois.has(normalized.doi);

  if (hasSystemicPmid || hasSystemicDoi) {
    status = "CONFLICT";
    decidingRule = hasSystemicPmid ? "systemic-pmid-collision" : "systemic-doi-collision";

    const sharedId = hasSystemicPmid ? normalized.pmid! : normalized.doi!;
    const otherRow = allNormalizedRows.find(
      (r) => r.rowIndex !== raw.rowIndex && (hasSystemicPmid ? r.pmid === sharedId : r.doi === sharedId),
    );

    identityResult = {
      matchedRecord: {
        rowIndex: otherRow?.rowIndex,
        pmid: hasSystemicPmid ? sharedId : null,
        doi: hasSystemicDoi ? sharedId : null,
        title: otherRow?.title ?? null,
        authors: otherRow?.authors ?? null,
        pubYear: otherRow?.pubYear ?? null,
        journal: otherRow?.journal ?? null,
      },
      matchSource: "BATCH" as const,
      matchType: hasSystemicPmid ? ("PMID_EXACT" as const) : ("DOI_EXACT" as const),
      conflictType: "PMID_DOI_MISMATCH" as const,
      signals: {
        pmidMatch: !!hasSystemicPmid,
        doiMatch: !!hasSystemicDoi,
        pmcidMatch: false,
        nihmsIdMatch: false,
        titleSimilarity: 0,
        authorOverlap: 0,
        yearMatch: false,
        journalSimilarity: 0,
      },
      autoResolvable: false,
      explanation: `This record is part of a systemic collision on identifier "${sharedId}". It cannot be auto-resolved due to conflicting titles.`,
    };
  }

  // ── STAGE 3b: PROJECT DB DUPLICATE CHECK ─────────────────────────────────
  if (!identityResult) {
    identityResult = checkAgainstProjectDb(normalized, existingArticles);

    if (identityResult) {
      const newStatus: ImportStatus = identityResult.conflictType
        ? "CONFLICT"
        : identityResult.autoResolvable
          ? "AUTO_RESOLVED_DUPLICATE"
          : "LIKELY_DUPLICATE";

      if (newStatus === "AUTO_RESOLVED_DUPLICATE") {
        status = "AUTO_RESOLVED_DUPLICATE";
        decidingRule = `db-${identityResult.conflictType ?? "duplicate"}`;
      } else if (escalateStatus(status, newStatus) !== status) {
        status = newStatus;
        decidingRule = `db-${identityResult.conflictType ?? "duplicate"}`;
      }
    }
  }

  // ── STAGE 3a: BATCH-LEVEL DUPLICATE CHECK ─────────────────────────────────
  if (!identityResult) {
    const batchDuplicate = findBatchDuplicate(normalized, batchIndex);

    if (batchDuplicate) {
      const conflictingRow = allNormalizedRows.find(
        (r) => r.rowIndex === batchDuplicate.conflictingRowIndex,
      );

      if (conflictingRow) {
        identityResult = resolveIdentity(normalized, conflictingRow, "BATCH");

        if (identityResult) {
          const newStatus: ImportStatus = identityResult.conflictType
            ? "CONFLICT"
            : identityResult.autoResolvable
              ? "AUTO_RESOLVED_DUPLICATE"
              : "LIKELY_DUPLICATE";

          if (newStatus === "AUTO_RESOLVED_DUPLICATE") {
            status = "AUTO_RESOLVED_DUPLICATE";
            decidingRule = `batch-${identityResult.conflictType ?? "duplicate"}`;
          } else if (escalateStatus(status, newStatus) !== status) {
            status = newStatus;
            decidingRule = `batch-${identityResult.conflictType ?? "duplicate"}`;
          }
        }
      }
    }
  }

  // ── STAGE 4: FUZZY MATCHING (only if no exact match found) ───────────────
  if (!identityResult) {
    const fuzzyResult = findPossibleMatches(normalized, existingArticles);

    if (fuzzyResult.bestMatch) {
      const newStatus: ImportStatus = "POSSIBLE_MATCH";
      if (escalateStatus(status, newStatus) !== status) {
        status = newStatus;
        decidingRule = "fuzzy-title-author";
      }

      identityResult = {
        matchedRecord: fuzzyResult.bestMatch.matchedRecord,
        matchSource: "PROJECT_DB" as const,
        matchType: "FUZZY_MULTI" as const,
        conflictType: null,
        signals: {
          pmidMatch: false,
          doiMatch: false,
          pmcidMatch: false,
          nihmsIdMatch: false,
          titleSimilarity: fuzzyResult.bestMatch.titleSimilarity,
          authorOverlap: fuzzyResult.bestMatch.authorOverlap,
          yearMatch: fuzzyResult.bestMatch.yearMatch,
          journalSimilarity: fuzzyResult.bestMatch.journalSimilarity,
        },
        autoResolvable: false,
        explanation: [
          `A similar article was found in this project.`,
          `Title similarity: ${Math.round(fuzzyResult.bestMatch.titleSimilarity * 100)}%`,
          `Author overlap: ${Math.round(fuzzyResult.bestMatch.authorOverlap * 100)}%`,
          `Year match: ${fuzzyResult.bestMatch.yearMatch ? "Yes" : "No"}`,
          `This record has been imported. No action required unless you believe this is a duplicate.`,
        ].join("\n"),
      };
    }
  }

  // ── STAGE 5: BUILD FINAL EXPLANATION ─────────────────────────────────────
  const explanation = buildFinalExplanation(
    status,
    validated,
    identityResult?.explanation ?? null,
  );

  return {
    rowIndex: raw.rowIndex,
    original: raw,
    normalized,
    corrections: validated.corrections,
    warnings: validated.warnings,
    inferred: validated.inferred,
    identityResult,
    finalStatus: status,
    decidingRule,
    explanation,
  };
}

// ─── MAIN ENGINE FUNCTION ─────────────────────────────────────────────────────

export function runImportEngine(
  rawRows: RawRow[],
  existingArticles: ExistingArticle[],
): ImportBatchResult {
  const allNormalizedRows: NormalizedRow[] = rawRows.map(normalizeRow);
  const batchIndex = buildBatchIndex(allNormalizedRows);

  // ── PRE-SCAN: DATASET-LEVEL ANOMALY DETECTION (SYSTEMIC COLLISIONS) ───────
  const pmidCounts = new Map<string, NormalizedRow[]>();
  const doiCounts = new Map<string, NormalizedRow[]>();

  for (const row of allNormalizedRows) {
    if (row.pmid) {
      if (!pmidCounts.has(row.pmid)) pmidCounts.set(row.pmid, []);
      pmidCounts.get(row.pmid)!.push(row);
    }
    if (row.doi) {
      if (!doiCounts.has(row.doi)) doiCounts.set(row.doi, []);
      doiCounts.get(row.doi)!.push(row);
    }
  }

  const systemicPmids = new Set<string>();
  const systemicDois = new Set<string>();
  const clusters: ConflictCluster[] = [];

  const SYSTEMIC_THRESHOLD = IMPORT_THRESHOLDS.SYSTEMIC_COLLISION_THRESHOLD;

  // Analyze DOI collisions
  for (const [doi, rows] of doiCounts.entries()) {
    const firstRow = rows[0];
    if (!firstRow) continue;

    const matchingDbArticles = existingArticles.filter((a) => a.doi === doi);
    const totalCount = rows.length + matchingDbArticles.length;

    if (totalCount >= SYSTEMIC_THRESHOLD) {
      const firstTitle = firstRow.title || (matchingDbArticles[0]?.title ?? "");
      const titlesDiffer =
        rows.some((r) => computeTitleSimilarity(r.title, firstTitle) < 0.9) ||
        matchingDbArticles.some((a) => computeTitleSimilarity(a.title, firstTitle) < 0.9);

      if (titlesDiffer) {
        systemicDois.add(doi);
        const clusterId = `cluster-doi-${doi.replace(/[^a-zA-Z0-9]/g, "-")}`;
        clusters.push({
          id: clusterId,
          type: "SYSTEMIC_DOI_COLLISION",
          sharedIdentifier: doi,
          affectedRowIndices: rows.map((r) => r.rowIndex),
          explanation: `Systemic DOI Collision: ${rows.length} rows in the uploaded file share the DOI "${doi}" but have different titles and authors. This indicates a potential spreadsheet column alignment error or an issue-level DOI overwrite.`,
          suggestedResolution: "Strip this DOI to preserve record independence, or reject and fix the spreadsheet.",
        });
      }
    }
  }

  // Analyze PMID collisions
  for (const [pmid, rows] of pmidCounts.entries()) {
    const firstRow = rows[0];
    if (!firstRow) continue;

    const matchingDbArticles = existingArticles.filter((a) => a.pmid === pmid);
    const totalCount = rows.length + matchingDbArticles.length;

    if (totalCount >= SYSTEMIC_THRESHOLD) {
      const firstTitle = firstRow.title || (matchingDbArticles[0]?.title ?? "");
      const titlesDiffer =
        rows.some((r) => computeTitleSimilarity(r.title, firstTitle) < 0.9) ||
        matchingDbArticles.some((a) => computeTitleSimilarity(a.title, firstTitle) < 0.9);

      if (titlesDiffer) {
        systemicPmids.add(pmid);
        const clusterId = `cluster-pmid-${pmid}`;
        clusters.push({
          id: clusterId,
          type: "SYSTEMIC_PMID_COLLISION",
          sharedIdentifier: pmid,
          affectedRowIndices: rows.map((r) => r.rowIndex),
          explanation: `Systemic PMID Collision: ${rows.length} rows in the uploaded file share the PMID "${pmid}" but have different titles. This indicates a malformed export or cell shift.`,
          suggestedResolution: "Strip this PMID to preserve record independence, or reject and fix the spreadsheet.",
        });
      }
    }
  }

  // ── STEP 3: Process each row ──────────────────────────────────────────────
  const processedRows: ProcessedRow[] = rawRows.map((raw) =>
    processRow(raw, allNormalizedRows, batchIndex, existingArticles, systemicPmids, systemicDois),
  );

  // ── STEP 4: Group regular conflicts and duplicates into clusters ─────────
  const duplicateGroups = new Map<string, ProcessedRow[]>();
  const batchDuplicateGroups = new Map<string, ProcessedRow[]>();

  for (const row of processedRows) {
    const isSystemic =
      row.decidingRule === "systemic-pmid-collision" ||
      row.decidingRule === "systemic-doi-collision";
    if (isSystemic) continue;

    if (row.finalStatus === "LIKELY_DUPLICATE") {
      const match = row.identityResult?.matchedRecord;
      if (match) {
        if (row.identityResult?.matchSource === "PROJECT_DB" && match.articleId) {
          if (!duplicateGroups.has(match.articleId)) duplicateGroups.set(match.articleId, []);
          duplicateGroups.get(match.articleId)!.push(row);
        } else if (row.identityResult?.matchSource === "BATCH" && match.rowIndex !== undefined) {
          const key = `batch-dup-${match.pmid || match.doi || match.rowIndex}`;
          if (!batchDuplicateGroups.has(key)) batchDuplicateGroups.set(key, []);
          batchDuplicateGroups.get(key)!.push(row);
        }
      }
    } else if (row.finalStatus === "CONFLICT") {
      const match = row.identityResult?.matchedRecord;
      const key = `conflict-${match?.pmid || match?.doi || row.rowIndex}`;
      if (!batchDuplicateGroups.has(key)) batchDuplicateGroups.set(key, []);
      batchDuplicateGroups.get(key)!.push(row);
    }
  }

  // Convert duplicateGroups (DB duplicates) to clusters
  for (const [articleId, rows] of duplicateGroups.entries()) {
    const firstRow = rows[0];
    if (!firstRow || !firstRow.identityResult) continue;
    const match = firstRow.identityResult.matchedRecord;
    clusters.push({
      id: `cluster-db-dup-${articleId}`,
      type: "DUPLICATE_GROUP",
      sharedIdentifier: match.pmid || match.doi || articleId,
      affectedRowIndices: rows.map((r) => r.rowIndex),
      explanation: `${rows.length} rows in the file duplicate the existing database article "${match.title}" (ID: ${articleId}).`,
      suggestedResolution: "Skip these duplicates or overwrite with the new spreadsheet metadata.",
    });
  }

  // Convert batchDuplicateGroups (internal duplicates/conflicts) to clusters
  for (const [key, rows] of batchDuplicateGroups.entries()) {
    const firstRow = rows[0];
    if (!firstRow || !firstRow.identityResult) continue;
    const match = firstRow.identityResult.matchedRecord;
    const isConflict = firstRow.finalStatus === "CONFLICT";

    clusters.push({
      id: `cluster-batch-${key}`,
      type: isConflict ? "SYSTEMIC_PMID_COLLISION" : "DUPLICATE_GROUP",
      sharedIdentifier: match.pmid || match.doi || key,
      affectedRowIndices: rows.map((r) => r.rowIndex),
      explanation: isConflict
        ? `Row ${firstRow.rowIndex} has conflicting identifiers (PMID and DOI mismatch against another record).`
        : `${rows.length} rows in the file are duplicates of the same article within the file itself.`,
      suggestedResolution: isConflict
        ? "Verify the identifiers on PubMed/Crossref or cancel the import."
        : "Import only one copy and skip the duplicate rows.",
    });
  }

  // ── STEP 5: Group results by status ──────────────────────────────────────
  const imported = processedRows.filter((r) => r.finalStatus === "IMPORTED");
  const autoCorrected = processedRows.filter((r) => r.finalStatus === "AUTO_CORRECTED");
  const importedWithWarning = processedRows.filter((r) => r.finalStatus === "IMPORTED_WARNING");
  const possibleMatches = processedRows.filter((r) => r.finalStatus === "POSSIBLE_MATCH");
  const likelyDuplicates = processedRows.filter((r) => r.finalStatus === "LIKELY_DUPLICATE");
  const conflicts = processedRows.filter((r) => r.finalStatus === "CONFLICT");
  const autoResolvedDuplicates = processedRows.filter(
    (r) => r.finalStatus === "AUTO_RESOLVED_DUPLICATE",
  );

  const totalSuccessfullyImported =
    imported.length + autoCorrected.length + importedWithWarning.length + possibleMatches.length;

  const summary: ImportSummary = {
    importedCount: imported.length,
    autoCorrectedCount: autoCorrected.length,
    importedWithWarningCount: importedWithWarning.length,
    possibleMatchCount: possibleMatches.length,
    likelyDuplicateCount: likelyDuplicates.length,
    conflictCount: conflicts.length,
    autoResolvedDuplicateCount: autoResolvedDuplicates.length,
    totalSuccessfullyImported,
  };

  return {
    totalRows: rawRows.length,
    processedRows,
    imported,
    autoCorrected,
    importedWithWarning,
    possibleMatches,
    likelyDuplicates,
    conflicts,
    autoResolvedDuplicates,
    clusters,
    summary,
  };
}
