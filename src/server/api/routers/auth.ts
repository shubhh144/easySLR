import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import crypto from "crypto";
import nodemailer from "nodemailer";

// Simple helper to create a URL-safe slug from the lab name
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 50);
}

// Nodemailer transport setup
function getTransporter() {
  const connectionString = process.env.EMAIL_SERVER || "smtp://localhost:1025";
  return nodemailer.createTransport(connectionString);
}

export const authRouter = createTRPCRouter({
  /**
   * Register a new Owner and their Lab.
   * Creates a PendingRegistration record and sends a verification link.
   */
  registerOwner: publicProcedure
    .input(
      z.object({
        name: z.string().min(2).max(100),
        email: z.string().email(),
        institution: z.string().max(100).optional(),
        organizationName: z.string().min(2).max(100),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // 1. Check if email already exists in User table (could be active or placeholder invitee)
      const existingUser = await ctx.db.user.findUnique({
        where: { email: input.email },
      });
      if (existingUser) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This email is already associated with an active account or invitation. Please sign in directly.",
        });
      }

      // 2. Clear out any previous pending registration for this email
      await ctx.db.pendingRegistration.deleteMany({
        where: { email: input.email },
      });

      // 3. Generate token and expiry
      const token = crypto.randomUUID();
      const expires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

      // 4. Save pending registration
      await ctx.db.pendingRegistration.create({
        data: {
          email: input.email,
          name: input.name,
          institution: input.institution || null,
          organizationName: input.organizationName,
          token,
          expires,
        },
      });

      // 5. Send email
      const verifyUrl = `${process.env.NEXTAUTH_URL ?? "http://localhost:3000"}/auth/verify-registration?token=${token}`;
      const mailOptions = {
        from: process.env.EMAIL_FROM ?? "EasySLR <noreply@easyslr.dev>",
        to: input.email,
        subject: "Verify your EasySLR Laboratory Registration",
        text: `Hello ${input.name},\n\nThank you for registering your lab "${input.organizationName}" on EasySLR.\n\nPlease click the link below to verify your email address and activate your laboratory workspace:\n\n${verifyUrl}\n\nThis link is valid for 24 hours.\n\nBest regards,\nThe EasySLR Team`,
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 6px;">
            <h2 style="color: #111;">Verify your EasySLR Laboratory</h2>
            <p>Hello ${input.name},</p>
            <p>Thank you for registering your lab <strong>${input.organizationName}</strong> on EasySLR.</p>
            <p>Please click the button below to verify your email address and activate your workspace:</p>
            <div style="margin: 24px 0;">
              <a href="${verifyUrl}" style="background-color: #000; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 4px; font-weight: bold; display: inline-block;">Verify & Activate Workspace</a>
            </div>
            <p style="font-size: 12px; color: #666;">If the button above does not work, copy and paste this link into your browser:</p>
            <p style="font-size: 12px; color: #666;"><a href="${verifyUrl}">${verifyUrl}</a></p>
            <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
            <p style="font-size: 12px; color: #999;">This link is valid for 24 hours. If you did not request this, you can safely ignore this email.</p>
          </div>
        `,
      };

      try {
        const transporter = getTransporter();
        await transporter.sendMail(mailOptions);
        console.log(`[Email] Registration verification email sent to ${input.email} (token: ${token})`);
      } catch (err) {
        console.error("Failed to send verification email:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to dispatch verification email. Please verify SMTP connection settings.",
        });
      }

      return { success: true };
    }),

  /**
   * Verify registration, create User, Organization, and OWNER membership.
   */
  verifyRegistration: publicProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // 1. Find the registration request
      const pending = await ctx.db.pendingRegistration.findUnique({
        where: { token: input.token },
      });

      if (!pending) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid or expired verification link.",
        });
      }

      if (pending.expires < new Date()) {
        try {
          await ctx.db.pendingRegistration.delete({ where: { id: pending.id } });
        } catch (e) {}
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Verification link has expired. Please register again.",
        });
      }

      // 2. Generate organization slug
      const baseSlug = generateSlug(pending.organizationName);
      let slug = baseSlug;
      let counter = 1;
      while (await ctx.db.organization.findUnique({ where: { slug } })) {
        slug = `${baseSlug}-${counter}`;
        counter++;
      }

      // 3. Run Transaction
      await ctx.db.$transaction(async (tx) => {
        // Create the user
        const user = await tx.user.create({
          data: {
            email: pending.email,
            name: pending.name,
            emailVerified: new Date(),
          },
        });

        // Create the organization
        const org = await tx.organization.create({
          data: {
            name: pending.organizationName,
            slug,
          },
        });

        // Create the owner membership
        await tx.organizationMember.create({
          data: {
            organizationId: org.id,
            userId: user.id,
            role: "OWNER",
          },
        });

        // Clean up pending registration
        await tx.pendingRegistration.delete({
          where: { id: pending.id },
        });
      });

      return { success: true, email: pending.email };
    }),
});
