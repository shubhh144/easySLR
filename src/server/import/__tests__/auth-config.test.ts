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

// Mock next-auth entirely
vi.mock("next-auth", () => ({
  default: vi.fn(),
}));
vi.mock("next-auth/providers/email", () => ({
  default: vi.fn(),
}));
vi.mock("next-auth/providers/google", () => ({
  default: vi.fn(),
}));

vi.mock("@auth/prisma-adapter", () => ({
  PrismaAdapter: vi.fn().mockReturnValue({}), // Returns empty object mock so spread works
}));

// Mock the db export using vi.hoisted to prevent initialization order errors
const { mockUserFindUnique, mockUserDelete } = vi.hoisted(() => {
  return {
    mockUserFindUnique: vi.fn(),
    mockUserDelete: vi.fn(),
  };
});

vi.mock("~/server/db", () => {
  return {
    db: {
      user: {
        findUnique: mockUserFindUnique,
        delete: mockUserDelete,
      },
    },
  };
});

import { describe, it, expect, beforeEach } from "vitest";
import { authConfig } from "../../auth/config";

describe("NextAuth Config - signIn Callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return false if user has no email", async () => {
    const signInFn = authConfig.callbacks.signIn as any;
    const result = await signInFn({ user: {} });
    expect(result).toBe(false);
  });

  it("should permit sign-in if user exists and has organization memberships", async () => {
    mockUserFindUnique.mockResolvedValue({
      id: "u_1",
      email: "invited@easyslr.test",
      orgMemberships: [{ id: "m_1", organizationId: "org_1" }],
    });

    const signInFn = authConfig.callbacks.signIn as any;
    const result = await signInFn({ user: { email: "invited@easyslr.test" } });

    expect(result).toBe(true);
    expect(mockUserFindUnique).toHaveBeenCalledWith({
      where: { email: "invited@easyslr.test" },
      include: { orgMemberships: true },
    });
    expect(mockUserDelete).not.toHaveBeenCalled();
  });

  it("should deny sign-in, redirect, and delete the user record if user has 0 memberships", async () => {
    mockUserFindUnique.mockResolvedValue({
      id: "u_2",
      email: "random@easyslr.test",
      orgMemberships: [],
    });

    const signInFn = authConfig.callbacks.signIn as any;
    const result = await signInFn({ user: { email: "random@easyslr.test" } });

    expect(result).toBe("/auth/signin?error=AccessDenied");
    expect(mockUserFindUnique).toHaveBeenCalledWith({
      where: { email: "random@easyslr.test" },
      include: { orgMemberships: true },
    });
    expect(mockUserDelete).toHaveBeenCalledWith({
      where: { id: "u_2" },
    });
  });

  it("should deny sign-in and redirect if user does not exist in the database", async () => {
    mockUserFindUnique.mockResolvedValue(null);

    const signInFn = authConfig.callbacks.signIn as any;
    const result = await signInFn({ user: { email: "unknown@easyslr.test" } });

    expect(result).toBe("/auth/signin?error=AccessDenied");
    expect(mockUserFindUnique).toHaveBeenCalledWith({
      where: { email: "unknown@easyslr.test" },
      include: { orgMemberships: true },
    });
    expect(mockUserDelete).not.toHaveBeenCalled();
  });
});

describe("NextAuth Config - adapter.createUser", () => {
  it("should throw an AccessDenied error when trying to create an uninvited user", async () => {
    const adapter = authConfig.adapter as any;
    expect(adapter).toBeDefined();
    expect(adapter.createUser).toBeDefined();

    await expect(
      adapter.createUser({ email: "random@easyslr.test", name: "Random User" })
    ).rejects.toThrow("AccessDenied");
  });
});
