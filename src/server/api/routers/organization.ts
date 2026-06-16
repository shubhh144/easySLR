/**
 * ORGANIZATION ROUTER
 *
 * Handles: create org, get org, list user's orgs, invite members, remove members.
 *
 * Authorization:
 * - createOrg: any authenticated user (creates and becomes OWNER)
 * - getOrg / listMyOrgs: org member only
 * - inviteMember / removeMember: OWNER only
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { assertOrgAccess, assertOrgOwner } from "~/server/api/auth-helpers";

/**
 * Generate a URL-safe slug from an organization name.
 * "Johns Hopkins Lab" → "johns-hopkins-lab"
 * Used in URLs: /org/johns-hopkins-lab/projects
 */
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 50);
}

export const organizationRouter = createTRPCRouter({
  /**
   * Create a new organization.
   * The creating user becomes the OWNER automatically.
   *
   * Why create membership in the same transaction:
   * If we created the org and then crashed before creating the membership,
   * we'd have an org with no owner — impossible to manage. A transaction
   * ensures both records are created or neither is.
   */
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(2).max(100),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const baseSlug = generateSlug(input.name);

      // Ensure slug is unique by appending a counter if needed
      let slug = baseSlug;
      let counter = 1;
      while (await ctx.db.organization.findUnique({ where: { slug } })) {
        slug = `${baseSlug}-${counter}`;
        counter++;
      }

      // Create org + owner membership in a transaction
      const org = await ctx.db.$transaction(async (tx) => {
        const org = await tx.organization.create({
          data: { name: input.name, slug },
        });
        await tx.organizationMember.create({
          data: {
            organizationId: org.id,
            userId: ctx.session.user.id,
            role: "OWNER",
          },
        });
        return org;
      });

      return org;
    }),

  /**
   * Get a single organization by ID.
   * Requires org membership.
   */
  getById: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertOrgAccess(ctx.db, ctx.session.user.id, input.organizationId);

      return ctx.db.organization.findUniqueOrThrow({
        where: { id: input.organizationId },
        include: {
          members: {
            include: { user: { select: { id: true, name: true, email: true, image: true } } },
          },
          _count: { select: { projects: true } },
        },
      });
    }),

  /**
   * List all organizations the current user belongs to.
   * Used for the org switcher in the sidebar.
   */
  listMine: protectedProcedure.query(async ({ ctx }) => {
    const memberships = await ctx.db.organizationMember.findMany({
      where: { userId: ctx.session.user.id },
      include: {
        organization: {
          include: {
            _count: { select: { projects: true, members: true } },
          },
        },
      },
      orderBy: { joinedAt: "asc" },
    });

    return memberships.map((m) => ({
      ...m.organization,
      myRole: m.role,
    }));
  }),

  /**
   * Invite a user to an organization by email.
   * OWNER only.
   *
   * If the user doesn't have an account yet, we create a placeholder User record
   * so the membership can be created. NextAuth will populate the rest when they sign in.
   *
   * Why not send an actual email here: Email delivery is a separate concern
   * (use a job queue in production). For this assignment we create the membership
   * directly — in production this would be an invitation record with an expiry.
   */
  inviteMember: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        email: z.string().email(),
        name: z.string().min(2).max(100),
        role: z.enum(["OWNER", "MEMBER"]).default("MEMBER"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertOrgOwner(ctx.db, ctx.session.user.id, input.organizationId);

      // Find or create the user by email
      let user = await ctx.db.user.findUnique({ where: { email: input.email } });
      if (!user) {
        user = await ctx.db.user.create({
          data: {
            email: input.email,
            name: input.name,
          },
        });
      } else {
        // If user already exists but doesn't have a name set, update it
        if (!user.name) {
          user = await ctx.db.user.update({
            where: { id: user.id },
            data: { name: input.name },
          });
        }
      }

      // Create membership (upsert to avoid duplicate error)
      const membership = await ctx.db.organizationMember.upsert({
        where: {
          organizationId_userId: {
            organizationId: input.organizationId,
            userId: user.id,
          },
        },
        create: {
          organizationId: input.organizationId,
          userId: user.id,
          role: input.role,
        },
        update: { role: input.role },
      });

      return membership;
    }),

  /**
   * Remove a member from an organization.
   * OWNER only. Cannot remove yourself if you're the only owner.
   */
  removeMember: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        userId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertOrgOwner(ctx.db, ctx.session.user.id, input.organizationId);

      // Prevent removing the last owner
      if (input.userId === ctx.session.user.id) {
        const ownerCount = await ctx.db.organizationMember.count({
          where: { organizationId: input.organizationId, role: "OWNER" },
        });
        if (ownerCount <= 1) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Cannot remove the last owner. Transfer ownership first.",
          });
        }
      }

      await ctx.db.$transaction(async (tx) => {
        // Find all projects in this organization
        const projectIds = await tx.project.findMany({
          where: { organizationId: input.organizationId },
          select: { id: true },
        }).then((projects) => projects.map((p) => p.id));

        // Delete project memberships for these projects for this user
        if (projectIds.length > 0) {
          await tx.projectMember.deleteMany({
            where: {
              projectId: { in: projectIds },
              userId: input.userId,
            },
          });
        }

        // Delete the organization membership
        await tx.organizationMember.delete({
          where: {
            organizationId_userId: {
              organizationId: input.organizationId,
              userId: input.userId,
            },
          },
        });
      });

      return { success: true };
    }),

  /**
   * Delete an organization and all its projects/members.
   * OWNER only — this is a destructive operation.
   * Requires typing the exact organization name for safety.
   */
  delete: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        confirmName: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertOrgOwner(ctx.db, ctx.session.user.id, input.organizationId);

      const org = await ctx.db.organization.findUniqueOrThrow({
        where: { id: input.organizationId },
      });

      if (org.name !== input.confirmName) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Organization name confirmation does not match.",
        });
      }

      await ctx.db.organization.delete({
        where: { id: input.organizationId },
      });

      return { success: true };
    }),

  /**
   * Update an organization's metadata (e.g. name).
   * Regenerates slug to match the new name and keeps it unique.
   * OWNER only.
   */
  update: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        name: z.string().min(2).max(100),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertOrgOwner(ctx.db, ctx.session.user.id, input.organizationId);

      const baseSlug = generateSlug(input.name);
      let slug = baseSlug;
      let counter = 1;
      while (
        await ctx.db.organization.findFirst({
          where: {
            slug,
            id: { not: input.organizationId },
          },
        })
      ) {
        slug = `${baseSlug}-${counter}`;
        counter++;
      }

      return ctx.db.organization.update({
        where: { id: input.organizationId },
        data: { name: input.name, slug },
      });
    }),
});

