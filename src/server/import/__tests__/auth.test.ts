import { vi } from "vitest";

// Mock env
vi.mock("~/env", () => {
  return {
    env: {
      DATABASE_URL: "postgresql://mock:mock@localhost:5432/mock",
      NODE_ENV: "test",
    },
  };
});

// Mock auth module
vi.mock("~/server/auth", () => {
  return {
    auth: vi.fn(),
    handlers: {},
    signIn: vi.fn(),
    signOut: vi.fn(),
  };
});

// Mock nodemailer using vi.hoisted to ensure correct initialization order
const { mockSendMail } = vi.hoisted(() => {
  return {
    mockSendMail: vi.fn().mockResolvedValue({ messageId: "mock-id" }),
  };
});

vi.mock("nodemailer", () => {
  return {
    default: {
      createTransport: vi.fn().mockReturnValue({
        sendMail: mockSendMail,
      }),
    },
  };
});

import { describe, it, expect, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";
import { authRouter } from "../../api/routers/auth";

describe("Auth Router - Invitation-First Owner Registration", () => {
  let dbMock: any;
  let ctx: any;

  beforeEach(() => {
    vi.clearAllMocks();
    dbMock = {
      user: {
        findUnique: vi.fn(),
        create: vi.fn(),
      },
      pendingRegistration: {
        deleteMany: vi.fn(),
        create: vi.fn(),
        findUnique: vi.fn(),
        delete: vi.fn(),
      },
      organization: {
        findUnique: vi.fn(),
        create: vi.fn(),
      },
      organizationMember: {
        create: vi.fn(),
      },
      $transaction: vi.fn().mockImplementation(async (callback) => {
        return callback(dbMock);
      }),
    };

    ctx = {
      db: dbMock,
      session: null,
    };
  });

  describe("registerOwner procedure", () => {
    it("throws BAD_REQUEST error if email is already in use by an active user or invitee", async () => {
      // Mock active user exists
      dbMock.user.findUnique.mockResolvedValue({ id: "user_1", email: "exists@easyslr.test" });

      const caller = authRouter.createCaller(ctx);
      await expect(
        caller.registerOwner({
          name: "Test Owner",
          email: "exists@easyslr.test",
          organizationName: "Test Org",
        })
      ).rejects.toThrowError(
        new TRPCError({
          code: "BAD_REQUEST",
          message: "This email is already associated with an active account or invitation. Please sign in directly.",
        })
      );
    });

    it("clears old pending registrations, saves new registration request, and sends email", async () => {
      dbMock.user.findUnique.mockResolvedValue(null);
      dbMock.pendingRegistration.create.mockResolvedValue({ id: "pr_1" });

      const caller = authRouter.createCaller(ctx);
      const res = await caller.registerOwner({
        name: "Test Owner",
        email: "new@easyslr.test",
        organizationName: "Test Lab",
        institution: "JHU",
      });

      expect(res).toEqual({ success: true });
      expect(dbMock.pendingRegistration.deleteMany).toHaveBeenCalledWith({
        where: { email: "new@easyslr.test" },
      });
      expect(dbMock.pendingRegistration.create).toHaveBeenCalled();
      expect(mockSendMail).toHaveBeenCalled();
    });
  });

  describe("verifyRegistration procedure", () => {
    it("throws error if token is invalid or registration not found", async () => {
      dbMock.pendingRegistration.findUnique.mockResolvedValue(null);

      const caller = authRouter.createCaller(ctx);
      await expect(
        caller.verifyRegistration({ token: "invalid-token" })
      ).rejects.toThrowError(
        new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid or expired verification link.",
        })
      );
    });

    it("throws error and deletes record if verification link is expired", async () => {
      // Mock expired registration (created yesterday)
      const expiredDate = new Date(Date.now() - 3600 * 1000); // 1 hour ago
      dbMock.pendingRegistration.findUnique.mockResolvedValue({
        id: "pr_1",
        email: "test@easyslr.test",
        expires: expiredDate,
      });

      const caller = authRouter.createCaller(ctx);
      await expect(
        caller.verifyRegistration({ token: "expired-token" })
      ).rejects.toThrowError(
        new TRPCError({
          code: "BAD_REQUEST",
          message: "Verification link has expired. Please register again.",
        })
      );
      expect(dbMock.pendingRegistration.delete).toHaveBeenCalledWith({
        where: { id: "pr_1" },
      });
    });

    it("provisions user, organization, owner membership, and deletes pending record in transaction", async () => {
      const futureDate = new Date(Date.now() + 3600 * 1000); // 1 hour from now
      dbMock.pendingRegistration.findUnique.mockResolvedValue({
        id: "pr_1",
        email: "test@easyslr.test",
        name: "Test Owner",
        organizationName: "Jenkins Lab",
        expires: futureDate,
      });
      dbMock.organization.findUnique.mockResolvedValue(null); // Slug unique on first try
      dbMock.user.create.mockResolvedValue({ id: "u_1", email: "test@easyslr.test" });
      dbMock.organization.create.mockResolvedValue({ id: "org_1", slug: "jenkins-lab" });

      const caller = authRouter.createCaller(ctx);
      const res = await caller.verifyRegistration({ token: "valid-token" });

      expect(res).toEqual({ success: true, email: "test@easyslr.test" });
      expect(dbMock.user.create).toHaveBeenCalledWith({
        data: {
          email: "test@easyslr.test",
          name: "Test Owner",
          emailVerified: expect.any(Date),
        },
      });
      expect(dbMock.organization.create).toHaveBeenCalledWith({
        data: {
          name: "Jenkins Lab",
          slug: "jenkins-lab",
        },
      });
      expect(dbMock.organizationMember.create).toHaveBeenCalledWith({
        data: {
          organizationId: "org_1",
          userId: "u_1",
          role: "OWNER",
        },
      });
      expect(dbMock.pendingRegistration.delete).toHaveBeenCalledWith({
        where: { id: "pr_1" },
      });
    });
  });
});
