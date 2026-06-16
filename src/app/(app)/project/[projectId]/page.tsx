import { type Metadata } from "next";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { createCaller } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";
import { auth } from "~/server/auth";
import { ArticleTable } from "./_components/ArticleTable";
import { ProjectSettings } from "./_components/ProjectSettings";
import { ProjectHeader } from "./_components/ProjectHeader";

export const metadata: Metadata = { title: "Project" };

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { projectId } = await params;
  const { tab } = await searchParams;
  const session = await auth();
  if (!session) return null;

  const ctx = await createTRPCContext({ headers: await headers() });
  const caller = createCaller(ctx);

  let project;
  let counts;
  try {
    [project, counts] = await Promise.all([
      caller.project.getById({ projectId }),
      caller.article.getCounts({ projectId }),
    ]);
  } catch {
    notFound();
  }

  const currentUserId = session.user.id;
  const myProjectMember = project.members.find((m) => m.userId === currentUserId);
  const isCreator = project.createdById === currentUserId;

  // Fetch org membership to check if OWNER
  const myOrgMemberRecord = await ctx.db.organizationMember.findUnique({
    where: {
      organizationId_userId: {
        organizationId: project.organizationId,
        userId: currentUserId,
      },
    },
  });
  const isOrgOwner = myOrgMemberRecord?.role === "OWNER";
  const isProjectManager = myProjectMember?.role === "MANAGER" || isCreator || isOrgOwner;
  const isSettingsTab = tab === "settings";

  // Compute review progress
  const reviewStatMap = Object.fromEntries(
    counts.reviewCounts.map((c) => [c.reviewStatus, c._count.id])
  );
  const total = Object.values(reviewStatMap).reduce((a, b) => a + b, 0);
  const decided = (reviewStatMap["INCLUDED"] ?? 0) + (reviewStatMap["EXCLUDED"] ?? 0);
  const progress = total > 0 ? Math.round((decided / total) * 100) : 0;

  // Compute import status counts
  const importStatMap = Object.fromEntries(
    counts.importCounts.map((c) => [c.importStatus, c._count.id])
  );
  const conflictCount = importStatMap["CONFLICT"] ?? 0;

  return (
    <div>
      <ProjectHeader
        projectId={projectId}
        organizationId={project.organizationId}
        initialName={project.name}
        description={project.description}
        isProjectManager={isProjectManager}
        isSettingsTab={isSettingsTab}
      />

      {/* Tabs */}
      <div style={{ display: "flex", gap: 24, borderBottom: "1px solid var(--border-subtle)", marginBottom: 32 }}>
        <Link href={`/project/${projectId}`} style={{
          paddingBottom: 12,
          fontSize: 14,
          fontWeight: 600,
          textDecoration: "none",
          color: !isSettingsTab ? "var(--text-primary)" : "var(--text-muted)",
          borderBottom: !isSettingsTab ? "2px solid var(--border-active)" : "2px solid transparent",
          marginBottom: -1
        }}>
          Articles
        </Link>
        <Link href={`/project/${projectId}?tab=settings`} style={{
          paddingBottom: 12,
          fontSize: 14,
          fontWeight: 600,
          textDecoration: "none",
          color: isSettingsTab ? "var(--text-primary)" : "var(--text-muted)",
          borderBottom: isSettingsTab ? "2px solid var(--border-active)" : "2px solid transparent",
          marginBottom: -1
        }}>
          Settings
        </Link>
      </div>

      {isSettingsTab ? (
        <ProjectSettings projectId={projectId} currentUserId={currentUserId} />
      ) : (
        <>
          {/* Stats row */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 16, marginBottom: 32 }}>
            {[
              { label: "Total Articles",  value: total,                          color: "var(--text-primary)" },
              { label: "Pending Review",  value: reviewStatMap["PENDING"] ?? 0,  color: "var(--text-secondary)" },
              { label: "Included",        value: reviewStatMap["INCLUDED"] ?? 0, color: "var(--text-primary)" },
              { label: "Excluded",        value: reviewStatMap["EXCLUDED"] ?? 0, color: "var(--text-muted)" },
              { label: "Conflicts",       value: conflictCount,                  color: conflictCount > 0 ? "var(--text-primary)" : "var(--text-muted)" },
            ].map((s) => (
              <div key={s.label} className="card" style={{ padding: "20px" }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: s.color, letterSpacing: -0.5 }}>
                  {s.value}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, marginTop: 4 }}>
                  {s.label}
                </div>
              </div>
            ))}
          </div>

          {/* Progress bar */}
          {total > 0 && (
            <div className="card" style={{ marginBottom: 32, padding: "20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" }}>Screening Completion</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>{progress}%</span>
              </div>
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${progress}%` }} />
              </div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8 }}>
                {decided} of {total} articles screened
              </div>
            </div>
          )}

          {/* Conflict alert */}
          {conflictCount > 0 && (
            <div className="alert alert-error" style={{ marginBottom: 24 }}>
              <div>
                <strong>{conflictCount} conflict{conflictCount > 1 ? "s" : ""} detected.</strong>
                {" "}These articles have conflicting identifiers and could not be automatically resolved. Use the conflict filter in the table to review them.
              </div>
            </div>
          )}

          {/* Article table */}
          <ArticleTable projectId={projectId} importStatMap={importStatMap} reviewStatMap={reviewStatMap} isProjectManager={isProjectManager} />
        </>
      )}
    </div>
  );
}
