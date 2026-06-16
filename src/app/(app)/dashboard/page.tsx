import { type Metadata } from "next";
import { auth } from "~/server/auth";
import { createCaller } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";
import { headers } from "next/headers";
import Link from "next/link";

export const metadata: Metadata = { title: "Dashboard" };

function StatBlock({ value, label, color }: { value: number | string; label: string; color?: string }) {
  return (
    <div className="stat-block">
      <span className="stat-value" style={color ? { color } : undefined}>{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

function BuildingIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="16" height="20" x="4" y="2" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M12 14h.01"/><path d="M16 10h.01"/><path d="M16 14h.01"/><path d="M8 10h.01"/><path d="M8 14h.01"/>
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>
    </svg>
  );
}

export default async function DashboardPage() {
  const session = await auth();
  if (!session) return null;

  const caller = createCaller(
    await createTRPCContext({ headers: await headers() })
  );
  const orgs = await caller.organization.listMine();

  const firstName = session.user.name?.split(" ")[0] ?? "Researcher";

  return (
    <div>
      {/* Header */}
      <div className="page-header" style={{ marginBottom: 32, borderBottom: "1px solid var(--border-subtle)", paddingBottom: 24 }}>
        <div>
          <h1 className="page-title">Welcome, {firstName}</h1>
          <p className="page-subtitle">
            {orgs.length === 0
              ? "Create an organization to start managing reviews."
              : `Accessing ${orgs.length} organization${orgs.length !== 1 ? "s" : ""} across ${orgs.reduce((a, o) => a + o._count.projects, 0)} projects`
            }
          </p>
        </div>
      </div>

      {orgs.length === 0 ? (
        /* ── Empty State ── */
        <div
          className="empty-state"
          style={{
            background: "var(--bg-elevated)",
            padding: "80px 32px",
          }}
        >
          <div className="empty-state-icon">
            <BuildingIcon />
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>
            No Organizations
          </h2>
          <p style={{ color: "var(--text-muted)", marginBottom: 24, maxWidth: 380, margin: "0 auto 24px" }}>
            Organizations group your research team and projects. Create one in the sidebar to begin importing systematic reviews.
          </p>
        </div>
      ) : (
        /* ── Org Grid ── */
        <div className="grid-cards">
          {orgs.map((org) => (
            <Link key={org.id} href={`/org/${org.id}`} style={{ textDecoration: "none" }}>
              <div className="card card-hover" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
                {/* Org header */}
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16 }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: "var(--radius-max)",
                    background: "var(--bg-deep)",
                    border: "1px solid var(--border-subtle)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: "var(--text-primary)",
                  }}>
                    <BuildingIcon />
                  </div>
                  <span style={{
                    fontSize: 10.5, fontWeight: 700, textTransform: "uppercase",
                    letterSpacing: "0.06em", color: "var(--text-muted)",
                    padding: "3px 8px", background: "var(--bg-elevated)",
                    border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-max)",
                    marginLeft: "auto",
                  }}>
                    {org.myRole}
                  </span>
                </div>

                <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)", marginBottom: 4 }}>
                  {org.name}
                </h3>
                <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 20 }}>
                  /{org.slug}
                </p>

                {/* Stats */}
                <div style={{ display: "flex", gap: 24, marginTop: "auto" }}>
                  <StatBlock value={org._count.projects} label="Projects" />
                  <StatBlock value={org._count.members} label="Members" />
                </div>

                {/* CTA */}
                <div style={{
                  display: "flex", alignItems: "center", gap: 6,
                  marginTop: 20, color: "var(--text-primary)", fontSize: 13, fontWeight: 600,
                }}>
                  View Projects <ArrowRightIcon />
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
