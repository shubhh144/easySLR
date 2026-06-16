/**
 * AUTHORIZATION HELPERS
 *
 * These functions are called at the start of every protected tRPC procedure
 * that operates on an organization or project resource.
 *
 * Design: Per-procedure authorization (not middleware)
 * Each procedure explicitly calls the appropriate assertXxx function.
 * This is verbose but unambiguous — you can read any procedure and immediately
 * know what access level is required without tracing through middleware chains.
 *
 * Why not middleware-level auth:
 * tRPC middleware applies to ALL procedures in a router or globally.
 * Authorization requirements differ per procedure:
 *   - getProject: any org member with project access
 *   - deleteProject: OWNER only
 *   - importArticles: MANAGER or above
 *   - getArticles: any project member
 * Middleware can't cleanly express these different requirements without
 * becoming a complex authorization DSL. Explicit per-procedure checks are
 * simpler, more readable, and easier to audit.
 *
 * Interview answer: "Authorization is a business rule, not a cross-cutting
 * concern in this system. Each endpoint has a specific access requirement.
 * I enforce it at the start of each procedure so the requirement is
 * co-located with the code that uses it — readable, auditable, testable."
 */

import { TRPCError } from "@trpc/server";
import { type db as DbType } from "~/server/db";

type Db = typeof DbType;

// ─── ORGANIZATION ACCESS ──────────────────────────────────────────────────────

/**
 * Assert that the current user is a member of the organization.
 * Returns the membership record if access is granted.
 * Throws FORBIDDEN if not a member.
 *
 * Usage: const membership = await assertOrgAccess(ctx.db, ctx.session.user.id, orgId);
 */
export async function assertOrgAccess(
  db: Db,
  userId: string,
  organizationId: string,
) {
  const membership = await db.organizationMember.findUnique({
    where: {
      organizationId_userId: { organizationId, userId },
    },
  });

  if (!membership) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not have access to this organization.",
    });
  }

  return membership;
}

/**
 * Assert that the current user is an OWNER of the organization.
 * Throws FORBIDDEN if they are only a MEMBER.
 */
export async function assertOrgOwner(
  db: Db,
  userId: string,
  organizationId: string,
) {
  const membership = await assertOrgAccess(db, userId, organizationId);

  if (membership.role !== "OWNER") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only organization owners can perform this action.",
    });
  }

  return membership;
}

/**
 * Assert that the user is allowed to create a project in the organization.
 * Allowed if they are:
 * 1. An Org Owner
 * 2. OR a Project Manager in at least one project under this org
 * 3. OR not a member of any project under this org yet (new org member)
 */
export async function assertCanCreateProject(
  db: Db,
  userId: string,
  organizationId: string,
) {
  // Check org membership
  const orgMembership = await db.organizationMember.findUnique({
    where: {
      organizationId_userId: { organizationId, userId },
    },
  });

  if (!orgMembership) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not have access to this organization.",
    });
  }

  if (orgMembership.role === "OWNER") {
    return;
  }

  // Check project memberships
  const memberships = await db.projectMember.findMany({
    where: {
      userId,
      project: { organizationId },
    },
    select: {
      role: true,
    },
  });

  // If they are in projects but not a MANAGER in any of them, block them
  if (memberships.length > 0 && !memberships.some((m) => m.role === "MANAGER")) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Reviewers are not allowed to create projects.",
    });
  }
}

// ─── PROJECT ACCESS ───────────────────────────────────────────────────────────

/**
 * Assert that the current user has access to the project.
 * A user has project access if they are:
 * 1. A member of the project (ProjectMember record exists)
 * 2. OR the creator of the project
 * 3. OR an OWNER of the parent organization
 *
 * Returns the project if access is granted.
 * Throws FORBIDDEN if no access.
 *
 * Why check org OWNER: Organization owners should be able to access all projects
 * without being explicitly added to each one. This mirrors real-world admin access.
 */
export async function assertProjectAccess(
  db: Db,
  userId: string,
  projectId: string,
) {
  const project = await db.project.findUnique({
    where: { id: projectId },
    include: {
      members: {
        where: { userId },
      },
    },
  });

  if (!project) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Project not found.",
    });
  }

  // Check if direct project member
  const isProjectMember = project.members.length > 0;
  // Check if project creator
  const isCreator = project.createdById === userId;

  if (!isProjectMember && !isCreator) {
    // Check if org owner (org owners get access to all projects)
    const orgMembership = await db.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: project.organizationId,
          userId,
        },
      },
    });

    if (!orgMembership || orgMembership.role !== "OWNER") {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "You do not have access to this project.",
      });
    }
  }

  return project;
}

/**
 * Assert that the current user has MANAGER role in the project.
 * Used for write operations: importing articles, managing project settings.
 */
export async function assertProjectManager(
  db: Db,
  userId: string,
  projectId: string,
) {
  const project = await db.project.findUnique({
    where: { id: projectId },
    include: {
      members: {
        where: { userId },
      },
    },
  });

  if (!project) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Project not found." });
  }

  const member = project.members[0];
  const isCreator = project.createdById === userId;

  // Creators always have manager-level access
  if (isCreator) return project;

  if (!member || member.role !== "MANAGER") {
    // Check if org owner — org owners can do everything
    const orgMembership = await db.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: project.organizationId,
          userId,
        },
      },
    });

    if (!orgMembership || orgMembership.role !== "OWNER") {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Only project managers can perform this action.",
      });
    }
  }

  return project;
}
