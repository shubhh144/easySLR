/**
 * ARTICLE ROUTER
 *
 * Handles: listing articles in a project, getting a single article,
 * making include/exclude decisions, getting article details with import audit.
 */

import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { assertProjectAccess, assertProjectManager } from "~/server/api/auth-helpers";

export const articleRouter = createTRPCRouter({
  /**
   * List articles in a project with filtering and pagination.
   *
   * Filters: reviewStatus, importStatus, search (title/authors)
   * Pagination: cursor-based (using createdAt + id for stability)
   *
   * Why cursor-based pagination:
   * Researchers work through articles sequentially. Offset pagination breaks
   * when articles are added mid-review (the 51st article shifts to page 2).
   * Cursor pagination is stable — the cursor points to a specific article,
   * not a position number.
   */
  list: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        // Filters
        reviewStatus: z
          .enum(["PENDING", "INCLUDED", "EXCLUDED", "MAYBE"])
          .optional(),
        importStatus: z
          .enum([
            "IMPORTED",
            "AUTO_CORRECTED",
            "IMPORTED_WARNING",
            "POSSIBLE_MATCH",
            "LIKELY_DUPLICATE",
            "CONFLICT",
          ])
          .optional(),
        priority: z.enum(["HIGH", "MEDIUM", "LOW"]).optional(),
        search: z.string().optional(), // search in title and authors
        // Sorting
        sortBy: z.enum(["title", "priority", "pubYear", "journal", "reviewStatus"]).optional(),
        sortDirection: z.enum(["asc", "desc"]).default("desc"),
        // Pagination
        cursor: z.string().optional(), // articleId cursor
        limit: z.number().min(1).max(100).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(ctx.db, ctx.session.user.id, input.projectId);

      let orderBy: Record<string, string>[] = [{ createdAt: "desc" }, { id: "desc" }];
      if (input.sortBy) {
        orderBy = [{ [input.sortBy]: input.sortDirection }, { id: "desc" }];
      }

      const articles = await ctx.db.article.findMany({
        where: {
          projectId: input.projectId,
          ...(input.reviewStatus && { reviewStatus: input.reviewStatus }),
          ...(input.importStatus && { importStatus: input.importStatus }),
          ...(input.priority && { priority: input.priority }),
          ...(input.search && {
            OR: [
              { title: { contains: input.search, mode: "insensitive" } },
              { authors: { contains: input.search, mode: "insensitive" } },
              { firstAuthor: { contains: input.search, mode: "insensitive" } },
            ],
          }),
        },
        include: {
          reviewedBy: { select: { name: true, email: true } },
        },
        orderBy,
        take: input.limit + 1, // fetch one extra to determine if there's a next page
        ...(input.cursor && {
          cursor: { id: input.cursor },
          skip: 1,
        }),
      });

      let nextCursor: string | undefined;
      if (articles.length > input.limit) {
        const next = articles.pop(); // remove the extra item
        nextCursor = next?.id;
      }

      return { articles, nextCursor };
    }),

  /**
   * Get a single article with its full import audit record.
   */
  getById: protectedProcedure
    .input(z.object({ articleId: z.string() }))
    .query(async ({ ctx, input }) => {
      const article = await ctx.db.article.findUniqueOrThrow({
        where: { id: input.articleId },
        include: {
          reviewedBy: { select: { name: true, email: true } },
          importRowResult: true,
        },
      });

      await assertProjectAccess(ctx.db, ctx.session.user.id, article.projectId);
      return article;
    }),

  /**
   * Make a review decision on an article (include, exclude, maybe, reset to pending, update note or priority).
   */
  makeDecision: protectedProcedure
    .input(
      z.object({
        articleId: z.string(),
        decision: z.enum(["INCLUDED", "EXCLUDED", "MAYBE", "PENDING"]).optional(),
        note: z.string().max(2000).optional(),
        priority: z.enum(["HIGH", "MEDIUM", "LOW"]).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const article = await ctx.db.article.findUniqueOrThrow({
        where: { id: input.articleId },
      });

      await assertProjectAccess(ctx.db, ctx.session.user.id, article.projectId);

      return ctx.db.article.update({
        where: { id: input.articleId },
        data: {
          ...(input.decision && { reviewStatus: input.decision }),
          ...(input.note !== undefined && { reviewNote: input.note }),
          ...(input.priority && { priority: input.priority }),
          ...(input.decision && {
            reviewedById: input.decision === "PENDING" ? null : ctx.session.user.id,
            reviewedAt: input.decision === "PENDING" ? null : new Date(),
          }),
        },
      });
    }),

  /**
   * Get summary counts for a project's article table.
   * Used to render the filter tabs with counts (Pending: 12, Included: 3, etc.)
   */
  getCounts: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(ctx.db, ctx.session.user.id, input.projectId);

      const [reviewCounts, importCounts, priorityCounts] = await Promise.all([
        ctx.db.article.groupBy({
          by: ["reviewStatus"],
          where: { projectId: input.projectId },
          _count: { id: true },
        }),
        ctx.db.article.groupBy({
          by: ["importStatus"],
          where: { projectId: input.projectId },
          _count: { id: true },
        }),
        ctx.db.article.groupBy({
          by: ["priority"],
          where: { projectId: input.projectId },
          _count: { id: true },
        }),
      ]);

      return { reviewCounts, importCounts, priorityCounts };
    }),

  /**
   * Apply a decision or priority to multiple articles in bulk.
   */
  bulkDecision: protectedProcedure
    .input(
      z.object({
        articleIds: z.array(z.string()),
        decision: z.enum(["INCLUDED", "EXCLUDED", "MAYBE", "PENDING"]).optional(),
        priority: z.enum(["HIGH", "MEDIUM", "LOW"]).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.articleIds.length === 0) return { count: 0 };

      const firstArticle = await ctx.db.article.findUniqueOrThrow({
        where: { id: input.articleIds[0] },
      });
      await assertProjectAccess(ctx.db, ctx.session.user.id, firstArticle.projectId);

      const updateData: Record<string, any> = {};
      if (input.decision) {
        updateData.reviewStatus = input.decision;
        updateData.reviewedById = input.decision === "PENDING" ? null : ctx.session.user.id;
        updateData.reviewedAt = input.decision === "PENDING" ? null : new Date();
      }
      if (input.priority) {
        updateData.priority = input.priority;
      }

      const result = await ctx.db.article.updateMany({
        where: {
          id: { in: input.articleIds },
          projectId: firstArticle.projectId,
        },
        data: updateData,
      });

      return { count: result.count };
    }),

  /**
   * Permanently delete multiple articles.
   * Requires PROJECT MANAGER or ORG OWNER role.
   */
  deleteMany: protectedProcedure
    .input(
      z.object({
        articleIds: z.array(z.string()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.articleIds.length === 0) return { count: 0 };

      const firstArticle = await ctx.db.article.findUniqueOrThrow({
        where: { id: input.articleIds[0] },
      });
      await assertProjectManager(ctx.db, ctx.session.user.id, firstArticle.projectId);

      const result = await ctx.db.article.deleteMany({
        where: {
          id: { in: input.articleIds },
          projectId: firstArticle.projectId,
        },
      });

      return { count: result.count };
    }),
});
