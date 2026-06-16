/**
 * PROJECT ROUTER
 *
 * Handles: create project, get project, list projects in an org,
 * add/remove project members, update project settings.
 *
 * Authorization:
 * - createProject: org member
 * - getProject / listProjects: project access (member, creator, or org owner)
 * - addMember / removeMember: project MANAGER or org OWNER
 * - deleteProject: org OWNER only
 */

import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import {
  assertOrgAccess,
  assertOrgOwner,
  assertProjectAccess,
  assertProjectManager,
} from "~/server/api/auth-helpers";

export const projectRouter = createTRPCRouter({
  /**
   * Create a new project within an organization.
   * The creating user becomes a MANAGER automatically.
   *
   * Why auto-add as MANAGER (not OWNER):
   * Project roles are MANAGER/REVIEWER — there's no "project owner" concept.
   * The creator is tracked via createdById field for display purposes.
   * Authorization for elevated actions falls back to org OWNER.
   */
  create: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        name: z.string().min(1).max(200),
        description: z.string().max(1000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertOrgOwner(ctx.db, ctx.session.user.id, input.organizationId);

      const project = await ctx.db.$transaction(async (tx) => {
        const project = await tx.project.create({
          data: {
            organizationId: input.organizationId,
            name: input.name,
            description: input.description,
            createdById: ctx.session.user.id,
          },
        });

        // Auto-add creator as MANAGER
        await tx.projectMember.create({
          data: {
            projectId: project.id,
            userId: ctx.session.user.id,
            role: "MANAGER",
          },
        });

        return project;
      });

      return project;
    }),

  /**
   * Get a single project with its member list and article counts.
   */
  getById: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(ctx.db, ctx.session.user.id, input.projectId);

      return ctx.db.project.findUniqueOrThrow({
        where: { id: input.projectId },
        include: {
          members: {
            include: {
              user: { select: { id: true, name: true, email: true, image: true } },
            },
          },
          _count: {
            select: {
              articles: true,
              importBatches: true,
            },
          },
        },
      });
    }),

  /**
   * List all projects in an organization that the current user has access to.
   * Org OWNERs see all projects. Others see only projects they're a member of.
   */
  listByOrg: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .query(async ({ ctx, input }) => {
      const membership = await assertOrgAccess(
        ctx.db,
        ctx.session.user.id,
        input.organizationId,
      );

      // Org owners see all projects
      if (membership.role === "OWNER") {
        return ctx.db.project.findMany({
          where: { organizationId: input.organizationId },
          include: {
            _count: { select: { articles: true, members: true } },
            createdBy: { select: { name: true, email: true } },
          },
          orderBy: { createdAt: "desc" },
        });
      }

      // Non-owners only see projects they're a member of or created
      return ctx.db.project.findMany({
        where: {
          organizationId: input.organizationId,
          OR: [
            { members: { some: { userId: ctx.session.user.id } } },
            { createdById: ctx.session.user.id },
          ],
        },
        include: {
          _count: { select: { articles: true, members: true } },
          createdBy: { select: { name: true, email: true } },
        },
        orderBy: { createdAt: "desc" },
      });
    }),

  /**
   * Add a member to a project.
   * Requires MANAGER role or org OWNER.
   */
  addMember: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        email: z.string().email(),
        role: z.enum(["MANAGER", "REVIEWER"]).default("REVIEWER"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const project = await assertProjectManager(
        ctx.db,
        ctx.session.user.id,
        input.projectId,
      );

      // The invited user must already be an org member
      const user = await ctx.db.user.findUnique({ where: { email: input.email } });
      if (!user) {
        throw new Error(`No user with email ${input.email} found. They must sign up first.`);
      }

      // Check they're an org member
      const orgMembership = await ctx.db.organizationMember.findUnique({
        where: {
          organizationId_userId: {
            organizationId: project.organizationId,
            userId: user.id,
          },
        },
      });

      if (!orgMembership) {
        throw new Error(`${input.email} must be a member of the organization first.`);
      }

      return ctx.db.projectMember.upsert({
        where: { projectId_userId: { projectId: input.projectId, userId: user.id } },
        create: { projectId: input.projectId, userId: user.id, role: input.role },
        update: { role: input.role },
      });
    }),

  /**
   * Update project metadata (name, description).
   * Requires MANAGER role.
   */
  update: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        name: z.string().min(1).max(200).optional(),
        description: z.string().max(1000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectManager(ctx.db, ctx.session.user.id, input.projectId);

      return ctx.db.project.update({
        where: { id: input.projectId },
        data: {
          ...(input.name && { name: input.name }),
          ...(input.description !== undefined && { description: input.description }),
        },
      });
    }),

  /**
   * Delete a project and all its articles.
   * Org OWNER only — this is a destructive operation.
   * Requires typing the exact project name for safety.
   */
  delete: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        confirmName: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const project = await assertProjectAccess(
        ctx.db,
        ctx.session.user.id,
        input.projectId,
      );
      await assertOrgOwner(ctx.db, ctx.session.user.id, project.organizationId);

      if (project.name !== input.confirmName) {
        throw new Error("Project name confirmation does not match.");
      }

      await ctx.db.project.delete({ where: { id: input.projectId } });
      return { success: true };
    }),

  /**
   * Clear all articles, batches, results and decisions from a project.
   * Keeps the project definition intact.
   * Project MANAGER or Org OWNER only.
   */
  clearData: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertProjectManager(ctx.db, ctx.session.user.id, input.projectId);

      await ctx.db.$transaction(async (tx) => {
        // Delete ImportRowResult records associated with this project's batches
        await tx.importRowResult.deleteMany({
          where: { batch: { projectId: input.projectId } },
        });

        // Delete ImportBatch records associated with this project
        await tx.importBatch.deleteMany({
          where: { projectId: input.projectId },
        });

        // Delete Article records associated with this project
        await tx.article.deleteMany({
          where: { projectId: input.projectId },
        });
      }, {
        timeout: 60000, // 60 seconds timeout to prevent transaction expiry during cascade delete on remote DB
      });

      return { success: true };
    }),

  /**
   * Remove a member from a project.
   * Project MANAGER or Org OWNER only.
   */
  removeMember: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        userId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectManager(ctx.db, ctx.session.user.id, input.projectId);

      await ctx.db.projectMember.delete({
        where: {
          projectId_userId: {
            projectId: input.projectId,
            userId: input.userId,
          },
        },
      });

      return { success: true };
    }),

  /**
   * Get counts of articles, batches, and members for settings preview.
   * Project access required.
   */
  getCountsForSettings: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(ctx.db, ctx.session.user.id, input.projectId);

      const [articlesCount, batchesCount, membersCount] = await Promise.all([
        ctx.db.article.count({ where: { projectId: input.projectId } }),
        ctx.db.importBatch.count({ where: { projectId: input.projectId } }),
        ctx.db.projectMember.count({ where: { projectId: input.projectId } }),
      ]);

      return {
        articlesCount,
        batchesCount,
        membersCount,
      };
    }),
});
