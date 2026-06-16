/**
 * IMPORT ROUTER
 *
 * The server-side API for the Import Intelligence Layer.
 * This router is the bridge between the import engine (pure functions) and the database.
 *
 * Procedures:
 * - analyzeFile: Parse and run the engine on an uploaded file. Returns the full
 *   ImportBatchResult WITHOUT writing anything to the DB. This powers the import
 *   preview page — the researcher sees the full analysis before confirming.
 *
 * - confirmImport: Take an analyzed batch and write the confirmed articles to the DB.
 *   Accepts researcher decisions for CONFLICT and LIKELY_DUPLICATE rows.
 *   This is the only procedure that writes Article records.
 *
 * - resolveConflict: Resolve a single CONFLICT row after initial import.
 *   Used from the article table's conflict resolution UI.
 *
 * - listBatches: Get the import history for a project.
 *
 * - getBatch: Get the full details of a single import batch (for the audit log view).
 *
 * Why split analyzeFile and confirmImport:
 * This is the "preview before commit" pattern. The researcher uploads the file,
 * sees exactly what the engine will do (which rows have conflicts, which were
 * auto-corrected, etc.), then clicks Confirm to actually write to the database.
 *
 * This prevents two failure modes:
 * 1. Silent bad data: researcher doesn't know what was imported
 * 2. Failed partial imports: if DB write fails halfway, no data is corrupted
 *    (because nothing was written yet)
 *
 * Interview answer: "I separate analysis from commit because the import preview
 * is the researcher's chance to catch issues before they enter the database.
 * Running the engine is cheap and stateless. Writing to the DB is permanent.
 * Keeping them separate lets researchers review and reject without side effects."
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { type Prisma } from "../../../../generated/prisma";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { assertProjectAccess, assertProjectManager } from "~/server/api/auth-helpers";
import { parseExcelBuffer } from "~/server/import/parseExcel";
import { runImportEngine } from "~/server/import/engine";
import type {
  ExistingArticle,
  ImportBatchResult,
  ProcessedRow,
} from "~/server/import/types";

// ─── INPUT SCHEMAS ────────────────────────────────────────────────────────────

/**
 * A researcher's decision for a CONFLICT or LIKELY_DUPLICATE row.
 */
const RowResolutionSchema = z.object({
  rowIndex: z.number(),
  decision: z.enum(["SKIP", "IMPORT", "IMPORT_ANYWAY"]),
  // If decision is "IMPORT" with corrections, the researcher may have edited the PMID
  correctedPmid: z.string().optional(),
  correctedDoi: z.string().optional(),
});

// ─── HELPER: CONVERT PROCESSED ROW TO ARTICLE CREATE DATA ─────────────────────

/**
 * Convert a ProcessedRow into the data shape needed to create an Article.
 *
 * For CONFLICT articles: null out the PMID to preserve the @@unique([projectId, pmid])
 * constraint. Store the claimed PMID in importNotes.
 *
 * Why null out PMID for CONFLICT:
 * Our schema requires @@unique([projectId, pmid]). If Row 16 is imported with PMID
 * 38910016, and Row 17 (CONFLICT) is also imported with PMID 38910016, we'd violate
 * the constraint. The CONFLICT article is stored with pmid=null and its claimed PMID
 * is preserved in importNotes for researcher reference.
 */
function processedRowToArticleData(
  row: ProcessedRow,
  projectId: string,
  isConflict: boolean,
  untrustedIdentifiers?: ("doi" | "pmid")[],
) {
  const normalized = row.normalized;
  const isPmidUntrusted = untrustedIdentifiers?.includes("pmid");

  return {
    projectId,
    pmid: (isConflict || isPmidUntrusted) ? null : normalized.pmid,
    doi: normalized.doi,
    pmcid: normalized.pmcid,
    nihmsId: normalized.nihmsId,
    title: normalized.title,
    authors: normalized.authors,
    firstAuthor: normalized.firstAuthor,
    journal: normalized.journal,
    pubYear: normalized.pubYear,
    citation: normalized.citation,
    createDate: normalized.createDate,
    importStatus: row.finalStatus === "AUTO_RESOLVED_DUPLICATE" 
      ? "LIKELY_DUPLICATE" 
      : row.finalStatus as any,
    importWarnings: row.warnings as unknown as Prisma.InputJsonValue,
    importNotes: {
      decidingRule: row.decidingRule,
      corrections: row.corrections,
      inferred: row.inferred,
      identityResult: row.identityResult,
      ...(isConflict && normalized.pmid
        ? { claimedPmid: normalized.pmid }
        : {}),
      ...(untrustedIdentifiers && untrustedIdentifiers.length > 0
        ? { untrustedIdentifiers }
        : {}),
    } as unknown as Prisma.InputJsonValue,
  };
}

// ─── ROUTER ───────────────────────────────────────────────────────────────────

export const importRouter = createTRPCRouter({
  /**
   * Analyze an uploaded Excel file without writing anything to the DB.
   * Returns the full ImportBatchResult for the import preview UI.
   */
  analyzeFile: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        fileBase64: z.string(), // base64-encoded .xlsx file
        fileName: z.string(),
        fileSize: z.number(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectManager(ctx.db, ctx.session.user.id, input.projectId);

      // Decode the base64 file to a Buffer
      const buffer = Buffer.from(input.fileBase64, "base64");

      // Parse the Excel file
      let rawRows;
      try {
        rawRows = parseExcelBuffer(buffer);
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Failed to parse Excel file.",
        });
      }

      if (rawRows.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "The uploaded file has no data rows.",
        });
      }

      // Fetch existing articles for deduplication
      const existingArticles: ExistingArticle[] = await ctx.db.article.findMany({
        where: { projectId: input.projectId },
        select: {
          id: true,
          pmid: true,
          doi: true,
          pmcid: true,
          nihmsId: true,
          title: true,
          authors: true,
          pubYear: true,
          journal: true,
          importNotes: true,
        },
      });

      // Run the import engine (pure, no side effects)
      const result = runImportEngine(rawRows, existingArticles);

      // Return the full result — client renders the preview from this
      return {
        ...result,
        fileName: input.fileName,
        fileSize: input.fileSize,
        existingArticleCount: existingArticles.length,
      };
    }),

  /**
   * Confirm the import — write articles and the audit log to the database.
   */
  confirmImport: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        fileBase64: z.string(),
        fileName: z.string(),
        fileSize: z.number(),
        clusterResolutions: z.array(
          z.object({
            clusterId: z.string(),
            decision: z.enum([
              "FLAG_UNTRUSTED",
              "SKIP_ALL",
              "IMPORT_ANYWAY",
              "IMPORT_ONE",
              "OVERWRITE_DB",
            ]),
          }),
        ).default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectManager(ctx.db, ctx.session.user.id, input.projectId);

      const buffer = Buffer.from(input.fileBase64, "base64");
      let rawRows;
      try {
        rawRows = parseExcelBuffer(buffer);
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Failed to parse Excel file.",
        });
      }

      // Re-fetch existing articles
      const existingArticles: ExistingArticle[] = await ctx.db.article.findMany({
        where: { projectId: input.projectId },
        select: {
          id: true,
          pmid: true,
          doi: true,
          pmcid: true,
          nihmsId: true,
          title: true,
          authors: true,
          pubYear: true,
          journal: true,
          importNotes: true,
        },
      });

      // Re-run engine (deterministic — same result as analyzeFile)
      const result = runImportEngine(rawRows, existingArticles);

      // Map cluster resolutions to row-level decisions
      const rowResolutions = new Map<
        number,
        {
          decision: "SKIP" | "IMPORT" | "IMPORT_ANYWAY";
          untrustedIdentifiers?: ("doi" | "pmid")[];
        }
      >();

      for (const res of input.clusterResolutions) {
        const cluster = result.clusters.find((c) => c.id === res.clusterId);
        if (!cluster) continue;

        for (const rowIndex of cluster.affectedRowIndices) {
          if (res.decision === "SKIP_ALL") {
            rowResolutions.set(rowIndex, { decision: "SKIP" });
          } else if (res.decision === "FLAG_UNTRUSTED") {
            rowResolutions.set(rowIndex, {
              decision: "IMPORT",
              untrustedIdentifiers: cluster.type === "SYSTEMIC_DOI_COLLISION" ? ["doi"] : ["pmid"],
            });
          } else if (res.decision === "IMPORT_ONE") {
            const isFirst = cluster.affectedRowIndices[0] === rowIndex;
            rowResolutions.set(rowIndex, { decision: isFirst ? "IMPORT" : "SKIP" });
          } else if (res.decision === "IMPORT_ANYWAY" || res.decision === "OVERWRITE_DB") {
            rowResolutions.set(rowIndex, { decision: "IMPORT_ANYWAY" });
          }
        }
      }

      // Separate rows by what action to take
      const toImport: { row: ProcessedRow; untrusted?: ("doi" | "pmid")[] }[] = [];
      const toSkip: { row: ProcessedRow; resolutionType: "SKIPPED" | "AUTO_RESOLVED" }[] = [];

      for (const row of result.processedRows) {
        const resolution = rowResolutions.get(row.rowIndex);

        if (row.finalStatus === "AUTO_RESOLVED_DUPLICATE") {
          toSkip.push({ row, resolutionType: "AUTO_RESOLVED" });
          continue;
        }

        if (
          row.finalStatus === "IMPORTED" ||
          row.finalStatus === "AUTO_CORRECTED" ||
          row.finalStatus === "IMPORTED_WARNING" ||
          row.finalStatus === "POSSIBLE_MATCH"
        ) {
          // Auto-imported rows
          toImport.push({ row });
        } else if (
          row.finalStatus === "LIKELY_DUPLICATE" ||
          row.finalStatus === "CONFLICT"
        ) {
          // Manual review rows
          if (!resolution || resolution.decision === "SKIP") {
            toSkip.push({ row, resolutionType: "SKIPPED" });
          } else {
            toImport.push({
              row,
              untrusted: resolution.untrustedIdentifiers,
            });
          }
        }
      }

      // Write everything in a single transaction
      const batch = await ctx.db.$transaction(async (tx) => {
        // 1. Create the ImportBatch record
        const batch = await tx.importBatch.create({
          data: {
            projectId: input.projectId,
            userId: ctx.session.user.id,
            fileName: input.fileName,
            fileSize: input.fileSize,
            totalRows: result.totalRows,
            importedCount: toImport.length,
            autoCorrectedCount: result.summary.autoCorrectedCount,
            importedWithWarningCount: result.summary.importedWithWarningCount,
            possibleMatchCount: result.summary.possibleMatchCount,
            likelyDuplicateCount: result.summary.likelyDuplicateCount,
            conflictCount: result.summary.conflictCount,
            status: "COMPLETED",
          },
        });

        // 2. Create articles and link row results for imported rows
        for (const item of toImport) {
          const row = item.row;
          const isConflict = row.finalStatus === "CONFLICT" || !!item.untrusted?.length;

          let article;
          try {
            article = await tx.article.create({
              data: processedRowToArticleData(row, input.projectId, isConflict, item.untrusted),
            });
          } catch (e) {
            console.warn(`Skipped row ${row.rowIndex}: unique constraint violation`);
            continue;
          }

          // 3. Create ImportRowResult (audit record)
          await tx.importRowResult.create({
            data: {
              batchId: batch.id,
              articleId: article.id,
              rowIndex: row.rowIndex,
              finalStatus: row.finalStatus === "AUTO_RESOLVED_DUPLICATE" 
                ? "LIKELY_DUPLICATE" 
                : row.finalStatus as any,
              decidingRule: row.decidingRule,
              originalData: row.original as never,
              corrections: row.corrections as never,
              warnings: row.warnings as never,
              inferred: row.inferred as never,
              identityResult: row.identityResult
                ? (row.identityResult as never)
                : undefined,
              explanation: row.explanation,
              resolution:
                row.finalStatus === "LIKELY_DUPLICATE" || row.finalStatus === "CONFLICT"
                  ? "IMPORT_ANYWAY"
                  : undefined,
              resolvedById:
                row.finalStatus === "CONFLICT" || row.finalStatus === "LIKELY_DUPLICATE"
                  ? ctx.session.user.id
                  : undefined,
              resolvedAt:
                row.finalStatus === "CONFLICT" || row.finalStatus === "LIKELY_DUPLICATE"
                  ? new Date()
                  : undefined,
            },
          });
        }

        // 4. Create ImportRowResult (skipped rows)
        for (const item of toSkip) {
          const row = item.row;
          await tx.importRowResult.create({
            data: {
              batchId: batch.id,
              articleId: undefined,
              rowIndex: row.rowIndex,
              finalStatus: row.finalStatus === "AUTO_RESOLVED_DUPLICATE" 
                ? "LIKELY_DUPLICATE" 
                : row.finalStatus as any,
              decidingRule: row.decidingRule,
              originalData: row.original as never,
              corrections: row.corrections as never,
              warnings: row.warnings as never,
              inferred: row.inferred as never,
              identityResult: row.identityResult
                ? (row.identityResult as never)
                : undefined,
              explanation: row.explanation,
              resolution: item.resolutionType === "AUTO_RESOLVED" ? "SKIPPED" : "SKIPPED",
              resolvedById: ctx.session.user.id,
              resolvedAt: new Date(),
            },
          });
        }

        return batch;
      });

      return {
        batchId: batch.id,
        importedCount: toImport.length,
        skippedCount: toSkip.length,
      };
    }),

  /**
   * List import batches for a project (import history).
   */
  listBatches: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(ctx.db, ctx.session.user.id, input.projectId);

      return ctx.db.importBatch.findMany({
        where: { projectId: input.projectId },
        include: {
          uploadedBy: { select: { name: true, email: true } },
        },
        orderBy: { createdAt: "desc" },
      });
    }),

  /**
   * Get a single batch with all row results (for the import audit log).
   */
  getBatch: protectedProcedure
    .input(z.object({ batchId: z.string() }))
    .query(async ({ ctx, input }) => {
      const batch = await ctx.db.importBatch.findUniqueOrThrow({
        where: { id: input.batchId },
        include: {
          rowResults: {
            orderBy: { rowIndex: "asc" },
            include: {
              article: {
                select: { id: true, title: true, importStatus: true },
              },
            },
          },
          uploadedBy: { select: { name: true, email: true } },
        },
      });

      // Authorization: check user has access to the project this batch belongs to
      await assertProjectAccess(ctx.db, ctx.session.user.id, batch.projectId);

      return batch;
    }),

  /**
   * Get the impact summary of deleting a batch.
   * Calculates total articles created by the batch, reviewed articles, review notes,
   * and counts of Include, Exclude, and Maybe decisions.
   */
  getBatchImpact: protectedProcedure
    .input(z.object({ batchId: z.string() }))
    .query(async ({ ctx, input }) => {
      const batch = await ctx.db.importBatch.findUnique({
        where: { id: input.batchId },
        select: { id: true, fileName: true, projectId: true },
      });

      if (!batch) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Import batch not found.",
        });
      }

      // Authorization check
      await assertProjectAccess(ctx.db, ctx.session.user.id, batch.projectId);

      // Find all articles that were imported as part of this batch
      const articles = await ctx.db.article.findMany({
        where: {
          importRowResult: { batchId: input.batchId },
        },
        select: {
          id: true,
          reviewStatus: true,
          reviewNote: true,
        },
      });

      const totalArticles = articles.length;
      const reviewedArticles = articles.filter((a) => a.reviewStatus !== "PENDING").length;
      const reviewNotesCount = articles.filter((a) => !!a.reviewNote).length;

      const includes = articles.filter((a) => a.reviewStatus === "INCLUDED").length;
      const excludes = articles.filter((a) => a.reviewStatus === "EXCLUDED").length;
      const maybes = articles.filter((a) => a.reviewStatus === "MAYBE").length;

      return {
        fileName: batch.fileName,
        totalArticles,
        reviewedArticles,
        reviewNotesCount,
        includes,
        excludes,
        maybes,
      };
    }),

  /**
   * Delete an import batch and all its associated articles.
   * Requires PROJECT MANAGER or ORG OWNER permissions.
   * Requires typing filename or "DELETE" for safety.
   */
  deleteBatch: protectedProcedure
    .input(
      z.object({
        batchId: z.string(),
        projectId: z.string(),
        confirmText: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectManager(ctx.db, ctx.session.user.id, input.projectId);

      const batch = await ctx.db.importBatch.findUnique({
        where: { id: input.batchId },
        select: { id: true, fileName: true, projectId: true },
      });

      if (!batch) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Import batch not found.",
        });
      }

      if (batch.projectId !== input.projectId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Batch does not belong to this project.",
        });
      }

      if (input.confirmText !== batch.fileName && input.confirmText !== "DELETE") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Confirmation text does not match the batch file name or 'DELETE'.",
        });
      }

      await ctx.db.$transaction(async (tx) => {
        // Find all articles linked to this batch's row results
        const rowResults = await tx.importRowResult.findMany({
          where: { batchId: input.batchId },
          select: { articleId: true },
        });

        const articleIds = rowResults
          .map((r) => r.articleId)
          .filter((id): id is string => !!id);

        // Delete the articles (which cascades to reviews)
        if (articleIds.length > 0) {
          await tx.article.deleteMany({
            where: { id: { in: articleIds } },
          });
        }

        // Delete the batch (which cascades to ImportRowResult audit records)
        await tx.importBatch.delete({
          where: { id: input.batchId },
        });
      });

      return { success: true };
    }),
});
