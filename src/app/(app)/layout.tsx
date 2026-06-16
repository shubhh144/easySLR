import { redirect } from "next/navigation";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { AppShell } from "./_components/AppShell";
import { signOut } from "next-auth/react";

function AlertTriangleIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--text-muted)" }}>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
      <line x1="12" x2="12" y1="9" y2="13"/>
      <line x1="12" x2="12.01" y1="17" y2="17"/>
    </svg>
  );
}

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user) {
    redirect("/auth/signin");
  }

  // Check if this authenticated user belongs to any organization
  const membershipCount = await db.organizationMember.count({
    where: { userId: session.user.id },
  });

  const hasOrg = membershipCount > 0;

  if (!hasOrg) {
    return (
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        width: "100vw",
        background: "var(--bg-base)",
        padding: "24px",
      }}>
        <div className="card" style={{ maxWidth: 480, width: "100%", padding: "40px 32px", textAlign: "center" }}>
          <div style={{
            width: 48, height: 48, borderRadius: "var(--radius-max)",
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-subtle)",
            display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 24px",
          }}>
            <AlertTriangleIcon />
          </div>
          
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "var(--text-primary)", marginBottom: 8, letterSpacing: "-0.02em" }}>
            Invitation Required
          </h1>
          
          <p style={{ fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.6, marginBottom: 24 }}>
            You have successfully authenticated as <strong style={{ color: "var(--text-primary)" }}>{session.user.email}</strong>, but your email has not been invited to any active laboratories.
          </p>

          <div style={{
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-max)",
            padding: "16px",
            textAlign: "left",
            fontSize: 13,
            color: "var(--text-secondary)",
            lineHeight: 1.5,
            marginBottom: 24,
          }}>
            To access EasySLR, contact your **Organization Owner** or **Principal Investigator** to invite you to their workspace. Once invited, refresh this page.
          </div>

          <form action="/api/auth/signout" method="POST" style={{ marginBottom: 24 }}>
            <button type="submit" className="btn btn-secondary" style={{ width: "100%", height: 40, cursor: "pointer", fontWeight: 600 }}>
              Sign Out
            </button>
          </form>

          <p style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
            Want to register a new laboratory instead? <a href="/auth/signup" style={{ color: "var(--text-primary)", fontWeight: 600, textDecoration: "underline" }}>Register Workspace</a>
          </p>
        </div>
      </div>
    );
  }

  return <AppShell user={session.user}>{children}</AppShell>;
}
