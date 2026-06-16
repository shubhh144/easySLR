import { type Metadata } from "next";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { createCaller } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";
import { auth } from "~/server/auth";
import { CreateProjectModal } from "./_components/CreateProjectModal";
import { OrgSettings } from "./_components/OrgSettings";
import { OrgHeader } from "./_components/OrgHeader";

export const metadata: Metadata = { title: "Organization" };

function FolderIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 0-1.69.9L9.6 8.9A2 2 0 0 1 7.93 9.8H4a2 2 0 0 0-2 2V20a2 2 0 0 0 2 2Z"/>
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

function formatDate(d: Date) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default async function OrgPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { orgId } = await params;
  const { tab } = await searchParams;
  const session = await auth();
  if (!session) return null;

  const caller = createCaller(await createTRPCContext({ headers: await headers() }));

  let org;
  let projects;
  try {
    [org, projects] = await Promise.all([
      caller.organization.getById({ organizationId: orgId }),
      caller.project.listByOrg({ organizationId: orgId }),
    ]);
  } catch {
    notFound();
  }

  const currentUserId = session.user.id;
  const myMemberRecord = org.members.find((m) => m.userId === currentUserId);
  const isOwner = myMemberRecord?.role === "OWNER";
  const isSettingsTab = tab === "settings" && isOwner;

  // Check project creation access
  const { allowed: canCreate } = await caller.project.canCreateProject({ organizationId: orgId });

  return (
    <div>
      <OrgHeader
        orgId={orgId}
        initialName={org.name}
        isOwner={isOwner}
        canCreate={canCreate}
        projectsCount={projects.length}
        membersCount={org.members.length}
        isSettingsTab={isSettingsTab}
      />

      {/* Tabs */}
      {isOwner && (
        <div style={{ display: "flex", gap: 24, borderBottom: "1px solid var(--border-subtle)", marginBottom: 32 }}>
          <Link href={`/org/${orgId}`} style={{
            paddingBottom: 12,
            fontSize: 14,
            fontWeight: 600,
            textDecoration: "none",
            color: !isSettingsTab ? "var(--text-primary)" : "var(--text-muted)",
            borderBottom: !isSettingsTab ? "2px solid var(--border-active)" : "2px solid transparent",
            marginBottom: -1
          }}>
            Projects
          </Link>
          <Link href={`/org/${orgId}?tab=settings`} style={{
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
      )}

      {isSettingsTab ? (
        <OrgSettings orgId={orgId} currentUserId={currentUserId} />
      ) : projects.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <FolderIcon />
          </div>
          <h3>No Projects</h3>
          <p style={{ color: "var(--text-muted)" }}>
            {canCreate
              ? "Create a new project within this organization to begin importing research citations."
              : "Ask the organization owner to create a project and assign you to it."}
          </p>
          {canCreate && <CreateProjectModal orgId={orgId} buttonLabel="Create First Project" />}
        </div>
      ) : (
        <div className="grid-cards">
          {projects.map((project) => (
            <Link key={project.id} href={`/project/${project.id}`} style={{ textDecoration: "none" }}>
              <div className="card card-hover" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
                {/* Icon */}
                <div style={{
                  width: 36, height: 36, borderRadius: "var(--radius-max)",
                  background: "var(--bg-deep)",
                  border: "1px solid var(--border-subtle)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: "var(--text-primary)", marginBottom: 16,
                }}>
                  <FolderIcon />
                </div>

                <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)", marginBottom: 6 }}>
                  {project.name}
                </h3>

                {project.description && (
                  <p style={{
                    fontSize: 13, color: "var(--text-muted)", marginBottom: 20,
                    display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                    lineHeight: 1.5,
                  }}>
                    {project.description}
                  </p>
                )}

                <div style={{ flex: 1 }} />

                {/* Stats */}
                <div style={{ display: "flex", gap: 24, marginBottom: 16 }}>
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)" }}>
                      {project._count.articles}
                    </div>
                    <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>
                      Articles
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)" }}>
                      {project._count.members}
                    </div>
                    <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>
                      Members
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: "1px solid var(--border-subtle)", paddingTop: 14 }}>
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    Created {formatDate(project.createdAt)}
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: 5, color: "var(--text-primary)", fontSize: 13, fontWeight: 600 }}>
                    Open <ArrowRightIcon />
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
