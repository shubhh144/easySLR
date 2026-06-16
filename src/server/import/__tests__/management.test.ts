import { vi } from "vitest";

// Mock env module to bypass validation on missing DATABASE_URL
vi.mock("~/env", () => {
  return {
    env: {
      DATABASE_URL: "postgresql://mock:mock@localhost:5432/mock",
      NODE_ENV: "test",
    },
  };
});

// Mock auth module before importing anything else to prevent next-auth/next/server dependency issues in test environment
vi.mock("~/server/auth", () => {
  return {
    auth: vi.fn(),
    handlers: {},
    signIn: vi.fn(),
    signOut: vi.fn(),
  };
});

import { describe, it, expect } from "vitest";
import { TRPCError } from "@trpc/server";
import { organizationRouter } from "../../api/routers/organization";
import { projectRouter } from "../../api/routers/project";
import { importRouter } from "../../api/routers/import";
import { articleRouter } from "../../api/routers/article";

// Helper to create mocked TRPC context
function createMockCtx(
  userId: string,
  orgRole: "OWNER" | "MEMBER" | null,
  projectRole: "MANAGER" | "REVIEWER" | null
) {
  const dbMock = {
    organization: {
      findUnique: vi.fn().mockImplementation(async ({ where }) => {
        return { id: where.id || "org_1", name: "Test Org", slug: "test-org" };
      }),
      findUniqueOrThrow: vi.fn().mockImplementation(async ({ where }) => {
        return {
          id: where.id || "org_1",
          name: "Test Org",
          slug: "test-org",
          members: [
            { id: "mem_owner", userId: "owner_id", role: "OWNER", user: { email: "owner@test.com" } },
            { id: "mem_member", userId: "member_id", role: "MEMBER", user: { email: "member@test.com" } },
          ],
          _count: { projects: 3 },
        };
      }),
      delete: vi.fn(),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockImplementation(async ({ data }) => ({ id: "org_1", ...data })),
    },
    organizationMember: {
      findUnique: vi.fn().mockImplementation(async ({ where }) => {
        const targetUserId = where.organizationId_userId.userId;
        if (targetUserId === userId && orgRole) {
          return { id: `om_${targetUserId}`, organizationId: "org_1", userId: targetUserId, role: orgRole };
        }
        return null;
      }),
      count: vi.fn().mockResolvedValue(2),
      delete: vi.fn(),
    },
    project: {
      findUnique: vi.fn().mockImplementation(async ({ where }) => {
        return {
          id: where.id,
          organizationId: "org_1",
          name: "Test Project",
          createdById: "creator_id",
          members: projectRole ? [{ id: "pm_1", projectId: where.id, userId, role: projectRole }] : [],
        };
      }),
      findUniqueOrThrow: vi.fn().mockImplementation(async ({ where }) => {
        return {
          id: where.id,
          organizationId: "org_1",
          name: "Test Project",
          createdById: "creator_id",
          members: projectRole
            ? [
                { id: "pm_1", projectId: where.id, userId, role: projectRole, user: { name: "User", email: "user@test.com" } },
              ]
            : [],
          _count: { articles: 5, members: 2 },
        };
      }),
      findMany: vi.fn().mockResolvedValue([{ id: "proj_1" }]),
      delete: vi.fn(),
    },
    projectMember: {
      delete: vi.fn(),
      deleteMany: vi.fn(),
      count: vi.fn().mockResolvedValue(1),
    },
    article: {
      deleteMany: vi.fn(),
      count: vi.fn().mockResolvedValue(1),
    },
    importBatch: {
      deleteMany: vi.fn(),
      count: vi.fn().mockResolvedValue(1),
      delete: vi.fn(),
    },
    importRowResult: {
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn().mockImplementation(async (callback) => {
      return callback(dbMock);
    }),
  } as any;

  return {
    session: {
      user: {
        id: userId,
        name: "Test User",
        email: "test@example.com",
      },
      expires: "2026-06-14T14:10:45Z",
    },
    db: dbMock,
    headers: new Headers(),
  };
}

describe("Organization Settings Router - Management Actions", () => {
  it("allows Organization Owner to delete organization with matching name", async () => {
    const ctx = createMockCtx("owner_id", "OWNER", null);
    const caller = organizationRouter.createCaller(ctx);

    const result = await caller.delete({
      organizationId: "org_1",
      confirmName: "Test Org",
    });

    expect(result.success).toBe(true);
    expect(ctx.db.organization.delete).toHaveBeenCalledWith({
      where: { id: "org_1" },
    });
  });

  it("denies Organization Member from deleting organization", async () => {
    const ctx = createMockCtx("member_id", "MEMBER", null);
    const caller = organizationRouter.createCaller(ctx);

    await expect(
      caller.delete({
        organizationId: "org_1",
        confirmName: "Test Org",
      })
    ).rejects.toThrow(TRPCError);
  });

  it("throws error if organization delete name confirmation mismatches", async () => {
    const ctx = createMockCtx("owner_id", "OWNER", null);
    const caller = organizationRouter.createCaller(ctx);

    await expect(
      caller.delete({
        organizationId: "org_1",
        confirmName: "Wrong Name",
      })
    ).rejects.toThrow("Organization name confirmation does not match");
  });

  it("allows Organization Owner to remove member and cleans up project memberships", async () => {
    const ctx = createMockCtx("owner_id", "OWNER", null);
    const caller = organizationRouter.createCaller(ctx);

    const result = await caller.removeMember({
      organizationId: "org_1",
      userId: "member_id",
    });

    expect(result.success).toBe(true);
    expect(ctx.db.projectMember.deleteMany).toHaveBeenCalledWith({
      where: {
        projectId: { in: ["proj_1"] },
        userId: "member_id",
      },
    });
    expect(ctx.db.organizationMember.delete).toHaveBeenCalledWith({
      where: {
        organizationId_userId: {
          organizationId: "org_1",
          userId: "member_id",
        },
      },
    });
  });

  it("allows Organization Owner to update organization name and regenerates slug", async () => {
    const ctx = createMockCtx("owner_id", "OWNER", null);
    const caller = organizationRouter.createCaller(ctx);

    const result = await caller.update({
      organizationId: "org_1",
      name: "Updated Org Name",
    });

    expect(result.id).toBe("org_1");
    expect(result.name).toBe("Updated Org Name");
    expect(result.slug).toBe("updated-org-name");
    expect(ctx.db.organization.update).toHaveBeenCalledWith({
      where: { id: "org_1" },
      data: { name: "Updated Org Name", slug: "updated-org-name" },
    });
  });

  it("denies Organization Member from updating organization name", async () => {
    const ctx = createMockCtx("member_id", "MEMBER", null);
    const caller = organizationRouter.createCaller(ctx);

    await expect(
      caller.update({
        organizationId: "org_1",
        name: "New Org Name",
      })
    ).rejects.toThrow(TRPCError);
  });
});

describe("Project Settings Router - Management Actions", () => {
  it("allows Organization Owner to delete project with matching name", async () => {
    const ctx = createMockCtx("owner_id", "OWNER", null);
    const caller = projectRouter.createCaller(ctx);

    const result = await caller.delete({
      projectId: "proj_1",
      confirmName: "Test Project",
    });

    expect(result.success).toBe(true);
    expect(ctx.db.project.delete).toHaveBeenCalledWith({
      where: { id: "proj_1" },
    });
  });

  it("denies Project Manager (who is not Org Owner) from deleting project", async () => {
    const ctx = createMockCtx("manager_id", "MEMBER", "MANAGER");
    const caller = projectRouter.createCaller(ctx);

    // Project Manager only is restricted per customer feedback!
    await expect(
      caller.delete({
        projectId: "proj_1",
        confirmName: "Test Project",
      })
    ).rejects.toThrow(TRPCError);
  });

  it("allows Project Manager to clear project screening data", async () => {
    const ctx = createMockCtx("manager_id", "MEMBER", "MANAGER");
    const caller = projectRouter.createCaller(ctx);

    const result = await caller.clearData({
      projectId: "proj_1",
    });

    expect(result.success).toBe(true);
    expect(ctx.db.article.deleteMany).toHaveBeenCalledWith({
      where: { projectId: "proj_1" },
    });
    expect(ctx.db.importBatch.deleteMany).toHaveBeenCalledWith({
      where: { projectId: "proj_1" },
    });
  });

  it("denies Project Reviewer from clearing project screening data", async () => {
    const ctx = createMockCtx("reviewer_id", "MEMBER", "REVIEWER");
    const caller = projectRouter.createCaller(ctx);

    await expect(
      caller.clearData({
        projectId: "proj_1",
      })
    ).rejects.toThrow(TRPCError);
  });

  it("allows Project Manager to remove project member", async () => {
    const ctx = createMockCtx("manager_id", "MEMBER", "MANAGER");
    const caller = projectRouter.createCaller(ctx);

    const result = await caller.removeMember({
      projectId: "proj_1",
      userId: "reviewer_id",
    });

    expect(result.success).toBe(true);
    expect(ctx.db.projectMember.delete).toHaveBeenCalledWith({
      where: {
        projectId_userId: {
          projectId: "proj_1",
          userId: "reviewer_id",
        },
      },
    });
  });
});

describe("Import Router - Management Actions (Delete Batch)", () => {
  it("allows Project Manager to get batch impact summary", async () => {
    const ctx = createMockCtx("manager_id", "MEMBER", "MANAGER");
    ctx.db.importBatch.findUnique = vi.fn().mockResolvedValue({
      id: "batch_1",
      fileName: "batch.xlsx",
      projectId: "proj_1",
    });
    ctx.db.article.findMany = vi.fn().mockResolvedValue([
      { id: "art_1", reviewStatus: "INCLUDED", reviewNote: "Note A" },
      { id: "art_2", reviewStatus: "EXCLUDED", reviewNote: "" },
      { id: "art_3", reviewStatus: "PENDING", reviewNote: null },
    ]);

    const caller = importRouter.createCaller(ctx);
    const result = await caller.getBatchImpact({ batchId: "batch_1" });

    expect(result.fileName).toBe("batch.xlsx");
    expect(result.totalArticles).toBe(3);
    expect(result.reviewedArticles).toBe(2);
    expect(result.reviewNotesCount).toBe(1);
    expect(result.includes).toBe(1);
    expect(result.excludes).toBe(1);
    expect(result.maybes).toBe(0);
  });

  it("allows Project Manager to delete import batch with matching filename", async () => {
    const ctx = createMockCtx("manager_id", "MEMBER", "MANAGER");
    ctx.db.importBatch.findUnique = vi.fn().mockResolvedValue({
      id: "batch_1",
      fileName: "batch.xlsx",
      projectId: "proj_1",
    });
    ctx.db.importRowResult.findMany = vi.fn().mockResolvedValue([
      { articleId: "art_1" },
      { articleId: "art_2" },
    ]);

    const caller = importRouter.createCaller(ctx);
    const result = await caller.deleteBatch({
      batchId: "batch_1",
      projectId: "proj_1",
      confirmText: "batch.xlsx",
    });

    expect(result.success).toBe(true);
    expect(ctx.db.article.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["art_1", "art_2"] } },
    });
    expect(ctx.db.importBatch.delete).toHaveBeenCalledWith({
      where: { id: "batch_1" },
    });
  });

  it("allows Project Manager to delete import batch with literal 'DELETE'", async () => {
    const ctx = createMockCtx("manager_id", "MEMBER", "MANAGER");
    ctx.db.importBatch.findUnique = vi.fn().mockResolvedValue({
      id: "batch_1",
      fileName: "batch.xlsx",
      projectId: "proj_1",
    });
    ctx.db.importRowResult.findMany = vi.fn().mockResolvedValue([
      { articleId: "art_1" },
    ]);

    const caller = importRouter.createCaller(ctx);
    const result = await caller.deleteBatch({
      batchId: "batch_1",
      projectId: "proj_1",
      confirmText: "DELETE",
    });

    expect(result.success).toBe(true);
  });

  it("throws error if delete batch confirmation text mismatches", async () => {
    const ctx = createMockCtx("manager_id", "MEMBER", "MANAGER");
    ctx.db.importBatch.findUnique = vi.fn().mockResolvedValue({
      id: "batch_1",
      fileName: "batch.xlsx",
      projectId: "proj_1",
    });

    const caller = importRouter.createCaller(ctx);
    await expect(
      caller.deleteBatch({
        batchId: "batch_1",
        projectId: "proj_1",
        confirmText: "wrong_filename.xlsx",
      })
    ).rejects.toThrow("Confirmation text does not match");
  });

  it("denies Project Reviewer from deleting import batch", async () => {
    const ctx = createMockCtx("reviewer_id", "MEMBER", "REVIEWER");
    const caller = importRouter.createCaller(ctx);

    await expect(
      caller.deleteBatch({
        batchId: "batch_1",
        projectId: "proj_1",
        confirmText: "DELETE",
      })
    ).rejects.toThrow(TRPCError);
  });
});

describe("Article Router - Management Actions (Delete Articles)", () => {
  it("allows Project Manager to delete articles", async () => {
    const ctx = createMockCtx("manager_id", "MEMBER", "MANAGER");
    ctx.db.article.findUniqueOrThrow = vi.fn().mockResolvedValue({
      id: "art_1",
      projectId: "proj_1",
    });
    ctx.db.article.deleteMany = vi.fn().mockResolvedValue({ count: 1 });

    const caller = articleRouter.createCaller(ctx);
    const result = await caller.deleteMany({
      articleIds: ["art_1"],
    });

    expect(result.count).toBe(1);
    expect(ctx.db.article.deleteMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["art_1"] },
        projectId: "proj_1",
      },
    });
  });

  it("denies Project Reviewer from deleting articles", async () => {
    const ctx = createMockCtx("reviewer_id", "MEMBER", "REVIEWER");
    ctx.db.article.findUniqueOrThrow = vi.fn().mockResolvedValue({
      id: "art_1",
      projectId: "proj_1",
    });

    const caller = articleRouter.createCaller(ctx);
    await expect(
      caller.deleteMany({
        articleIds: ["art_1"],
      })
    ).rejects.toThrow(TRPCError);
  });

  it("allows Organization Owner to delete articles even if not a project member", async () => {
    const ctx = createMockCtx("owner_id", "OWNER", null);
    ctx.db.article.findUniqueOrThrow = vi.fn().mockResolvedValue({
      id: "art_1",
      projectId: "proj_1",
    });
    ctx.db.article.deleteMany = vi.fn().mockResolvedValue({ count: 1 });

    const caller = articleRouter.createCaller(ctx);
    const result = await caller.deleteMany({
      articleIds: ["art_1"],
    });

    expect(result.count).toBe(1);
  });

  it("prevents cross-project deletion by filtering target articles to the verified project", async () => {
    const ctx = createMockCtx("manager_id", "MEMBER", "MANAGER");
    ctx.db.article.findUniqueOrThrow = vi.fn().mockResolvedValue({
      id: "art_1",
      projectId: "proj_1",
    });
    ctx.db.article.deleteMany = vi.fn().mockResolvedValue({ count: 1 });

    const caller = articleRouter.createCaller(ctx);
    const result = await caller.deleteMany({
      articleIds: ["art_1", "art_2"], // art_2 might belong to another project
    });

    expect(result.count).toBe(1);
    expect(ctx.db.article.deleteMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["art_1", "art_2"] },
        projectId: "proj_1", // strictly scoped to proj_1 to prevent deleting art_2 from other projects
      },
    });
  });

  it("safely returns 0 count when article list is empty without database operations", async () => {
    const ctx = createMockCtx("manager_id", "MEMBER", "MANAGER");
    ctx.db.article.findUniqueOrThrow = vi.fn();
    ctx.db.article.deleteMany = vi.fn();

    const caller = articleRouter.createCaller(ctx);
    const result = await caller.deleteMany({
      articleIds: [],
    });

    expect(result.count).toBe(0);
    expect(ctx.db.article.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(ctx.db.article.deleteMany).not.toHaveBeenCalled();
  });
});

