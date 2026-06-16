import { PrismaAdapter } from "@auth/prisma-adapter";
import { type DefaultSession, type NextAuthConfig } from "next-auth";
import EmailProvider from "next-auth/providers/email";
import GoogleProvider from "next-auth/providers/google";

import { db } from "~/server/db";

declare module "next-auth" {
  interface Session extends DefaultSession {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}

export const authConfig = {
  trustHost: true,
  providers: [
    // ── Email magic link ──────────────────────────────────────────────────────
    EmailProvider({
      server: process.env.EMAIL_SERVER || "smtp://localhost:1025",
      from: process.env.EMAIL_FROM || "EasySLR <noreply@easyslr.dev>",
    }),

    // ── Google OAuth ──────────────────────────────────────────────────────────
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? [
          GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          }),
        ]
      : []),
  ],

  adapter: {
    ...PrismaAdapter(db),
    async createUser(user) {
      // Prevent automatic account creation via OAuth/Email for uninvited users.
      // Since invited or registered users already exist in the database,
      // any attempt to trigger createUser indicates an uninvited/random login attempt.
      const error = new Error("AccessDenied");
      (error as any).code = "AccessDenied";
      throw error;
    },
  },

  // Use JWT session strategy for Credentials provider compatibility
  // (PrismaAdapter defaults to database sessions, but Credentials requires JWT)
  session: { strategy: "jwt" },

  callbacks: {
    async signIn({ user }) {
      if (!user.email) return false;
      const existingUser = await db.user.findUnique({
        where: { email: user.email },
        include: {
          orgMemberships: true,
        },
      });
      if (existingUser && existingUser.orgMemberships.length > 0) {
        return true;
      }

      // If the user exists in the DB but has no memberships, they are not invited.
      // Clean up the User record if it has no memberships (to avoid leaving orphaned records
      // if NextAuth's adapter just created it).
      if (existingUser) {
        try {
          await db.user.delete({
            where: { id: existingUser.id },
          });
        } catch (e) {
          console.error("Failed to clean up uninvited user record:", e);
        }
      }

      return "/auth/signin?error=AccessDenied";
    },
    // JWT callback: embed user.id into the token on sign-in
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    // Session callback: expose user.id from the token to the session
    session({ session, token }) {
      if (token.id) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },

  pages: {
    signIn: "/auth/signin",
    error: "/auth/signin",
  },
} satisfies NextAuthConfig;
