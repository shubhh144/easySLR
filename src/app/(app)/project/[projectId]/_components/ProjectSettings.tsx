"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "~/trpc/react";

export function ProjectSettings({ projectId, currentUserId }: { projectId: string; currentUserId: string }) {
  const router = useRouter();
  const utils = api.useUtils();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"MANAGER" | "REVIEWER">("REVIEWER");
  const [confirmName, setConfirmName] = useState("");
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showClearModal, setShowClearModal] = useState(false);
  const [deleteBatchId, setDeleteBatchId] = useState<string | null>(null);

  // Fetch import history
  const { data: batches, refetch: refetchBatches } = api.import.listBatches.useQuery({ projectId });

  // Fetch project details
  const { data: project, isLoading: projectLoading } = api.project.getById.useQuery({ projectId });

  // Fetch settings counts
  const { data: counts, refetch: refetchCounts } = api.project.getCountsForSettings.useQuery({ projectId });

  // Fetch organization to check owners list and list eligible members to add
  const { data: org } = api.organization.getById.useQuery(
    { organizationId: project?.organizationId ?? "" },
    { enabled: !!project?.organizationId }
  );

  // Mutations
  const addProjectMember = api.project.addMember.useMutation({
    onSuccess: () => {
      setEmail("");
      setRole("REVIEWER");
      void utils.project.getById.invalidate({ projectId });
    },
  });

  const removeProjectMember = api.project.removeMember.useMutation({
    onSuccess: () => {
      void utils.project.getById.invalidate({ projectId });
    },
  });

  const clearProjectData = api.project.clearData.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.article.list.invalidate(),
        utils.article.getCounts.invalidate({ projectId }),
        utils.project.getById.invalidate({ projectId }),
      ]);
      setShowClearModal(false);
      alert("Project screening data has been cleared.");
      window.location.href = `/project/${projectId}`;
    },
  });

  const deleteProject = api.project.delete.useMutation({
    onSuccess: () => {
      if (project) {
        window.location.href = `/org/${project.organizationId}`;
      }
    },
  });

  if (projectLoading || !project) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "40px 0" }}>
        <div className="spinner" />
      </div>
    );
  }

  // Auth check
  const myProjectMember = project.members.find((m) => m.userId === currentUserId);
  const isOrgOwner = org?.members.find((m) => m.userId === currentUserId)?.role === "OWNER";
  const isCreator = project.createdById === currentUserId;
  const isProjectManager = myProjectMember?.role === "MANAGER" || isCreator || isOrgOwner;



  // Get eligible org members who are NOT yet in the project
  const currentProjectUserIds = new Set(project.members.map((m) => m.userId));
  const eligibleOrgMembers = org?.members.filter((m) => !currentProjectUserIds.has(m.userId)) ?? [];

  const handleAddMember = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    addProjectMember.mutate({ projectId, email, role });
  };

  const handleRemoveMember = (userId: string, userName: string) => {
    if (confirm(`Are you sure you want to remove ${userName} from this project?`)) {
      removeProjectMember.mutate({ projectId, userId });
    }
  };

  const handleClearData = (e: React.FormEvent) => {
    e.preventDefault();
    clearProjectData.mutate({ projectId });
  };

  const handleDeleteProject = (e: React.FormEvent) => {
    e.preventDefault();
    if (confirmName !== project.name) return;
    deleteProject.mutate({ projectId, confirmName });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
      {/* 1. Project Member Management */}
      <div className="card" style={{ padding: 24 }}>
        <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Project Team</h3>
        <p style={{ color: "var(--text-muted)", fontSize: 13.5, marginBottom: 20 }}>
          Manage who can screen articles in this project.
        </p>

        <div className="table-container" style={{ marginBottom: 24 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                {isProjectManager && <th style={{ textAlign: "right" }}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {project.members.map((member) => (
                <tr key={member.id}>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{
                        width: 28, height: 28, borderRadius: "var(--radius-max)",
                        background: "var(--bg-deep)", border: "1px solid var(--border-subtle)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 11, fontWeight: 700,
                      }}>
                        {(member.user.name?.[0] ?? member.user.email?.[0] ?? "?").toUpperCase()}
                      </div>
                      <span style={{ fontWeight: 600 }}>{member.user.name ?? "Project Member"}</span>
                      {member.userId === project.createdById && (
                        <span className="badge" style={{ fontSize: 9, padding: "2px 6px" }}>Creator</span>
                      )}
                    </div>
                  </td>
                  <td><span style={{ color: "var(--text-muted)" }}>{member.user.email}</span></td>
                  <td>
                    <span className="badge" style={{ textTransform: "uppercase" }}>
                      {member.role}
                    </span>
                  </td>
                  {isProjectManager && (
                    <td style={{ textAlign: "right" }}>
                      {member.userId !== project.createdById && member.userId !== currentUserId && (
                        <button
                          onClick={() => handleRemoveMember(member.userId, member.user.name ?? member.user.email ?? "")}
                          className="btn btn-ghost btn-sm"
                          disabled={removeProjectMember.isPending}
                          style={{ color: "var(--text-muted)", border: "none", cursor: "pointer" }}
                        >
                          Remove
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Add Project Member form */}
        {isProjectManager && (
          eligibleOrgMembers.length > 0 ? (
            <form onSubmit={handleAddMember} style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 20 }}>
              <h4 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-secondary)" }}>
                Add Team Member
              </h4>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
                <div className="field" style={{ flex: 1, minWidth: 220 }}>
                  <label className="label">Select organization member <span style={{ color: "#FF453A" }}>*</span></label>
                  <select
                    className="input"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  >
                    <option value="">-- Select member --</option>
                    {eligibleOrgMembers.map((m) => (
                      <option key={m.id} value={m.user.email ?? ""}>
                        {m.user.name ? `${m.user.name} (${m.user.email})` : m.user.email}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field" style={{ width: 140 }}>
                  <label className="label">Project Role</label>
                  <select
                    className="input"
                    value={role}
                    onChange={(e) => setRole(e.target.value as "MANAGER" | "REVIEWER")}
                  >
                    <option value="REVIEWER">Reviewer</option>
                    <option value="MANAGER">Manager</option>
                  </select>
                </div>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={!email || addProjectMember.isPending}
                  style={{ height: 40 }}
                >
                  {addProjectMember.isPending ? "Adding..." : "Add Member"}
                </button>
              </div>
              {addProjectMember.error && (
                <div className="alert alert-error" style={{ marginTop: 12 }}>
                  {addProjectMember.error.message}
                </div>
              )}
            </form>
          ) : (
            <p style={{ color: "var(--text-muted)", fontSize: 13, borderTop: "1px solid var(--border-subtle)", paddingTop: 20 }}>
              All organization members are already added to this project.
            </p>
          )
        )}
      </div>

      {/* 2. Import History */}
      <div className="card" style={{ padding: 24 }}>
        <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Import History</h3>
        <p style={{ color: "var(--text-muted)", fontSize: 13.5, marginBottom: 20 }}>
          View and manage datasets imported into this project.
        </p>

        {!batches || batches.length === 0 ? (
          <p style={{ color: "var(--text-muted)", fontSize: 13.5 }}>No datasets have been imported yet.</p>
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>File Name</th>
                  <th>Uploaded By</th>
                  <th>Date</th>
                  <th>Articles Imported</th>
                  {isProjectManager && <th style={{ textAlign: "right" }}>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {batches.map((batch) => (
                  <tr key={batch.id}>
                    <td><strong style={{ color: "var(--text-primary)" }}>{batch.fileName}</strong></td>
                    <td><span style={{ color: "var(--text-secondary)" }}>{batch.uploadedBy.name ?? batch.uploadedBy.email}</span></td>
                    <td><span style={{ color: "var(--text-muted)" }}>{new Date(batch.createdAt).toLocaleDateString()}</span></td>
                    <td>
                      <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>
                        {batch.importedCount}
                      </span>
                      <span style={{ color: "var(--text-muted)" }}> / {batch.totalRows} rows</span>
                    </td>
                    {isProjectManager && (
                      <td style={{ textAlign: "right" }}>
                        <button
                          onClick={() => setDeleteBatchId(batch.id)}
                          className="btn btn-ghost btn-sm"
                          style={{ color: "var(--text-primary)", border: "none", cursor: "pointer", padding: "4px 8px" }}
                        >
                          Delete Batch
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 3. Clear Project Data */}
      {isProjectManager && (
        <div className="card" style={{ padding: 24 }}>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)", marginBottom: 6 }}>
            Clear Project Data
          </h3>
          <p style={{ color: "var(--text-muted)", fontSize: 13.5, marginBottom: 20 }}>
            Deletes all imported articles, import batches, and review decisions. The project itself and its members list are preserved.
          </p>

          <button
            onClick={() => setShowClearModal(true)}
            className="btn btn-secondary"
            style={{ borderColor: "var(--border-subtle)", color: "var(--text-primary)" }}
          >
            Clear Project Data...
          </button>
        </div>
      )}

      {/* 3. Delete Project (Org Owners only) */}
      {isOrgOwner && (
        <div className="card" style={{ padding: 24, border: "1px solid var(--border-subtle)" }}>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)", marginBottom: 6 }}>
            Delete Project
          </h3>
          <p style={{ color: "var(--text-muted)", fontSize: 13.5, marginBottom: 20 }}>
            Permanently delete this project and all its screening databases. This action is irreversible.
          </p>

          <button
            onClick={() => setShowDeleteModal(true)}
            className="btn btn-danger"
            style={{ borderColor: "var(--border-subtle)", color: "var(--text-primary)" }}
          >
            Delete Project...
          </button>
        </div>
      )}

      {/* Clear Data Modal */}
      {showClearModal && (
        <div className="modal-backdrop" onClick={() => setShowClearModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <div className="modal-header">
              <div>
                <div className="modal-title" style={{ color: "var(--text-primary)" }}>Clear Project Data</div>
                <div className="modal-subtitle">Reset screening database</div>
              </div>
              <button
                className="btn btn-ghost btn-icon"
                onClick={() => setShowClearModal(false)}
                style={{ color: "var(--text-muted)" }}
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleClearData}>
              <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div className="alert alert-error" style={{ margin: 0 }}>
                  <strong>Warning:</strong> This will delete:
                  <ul style={{ paddingLeft: 16, marginTop: 6, fontSize: 13 }}>
                    <li>All imported articles ({counts?.articlesCount ?? 0})</li>
                    <li>All import batches ({counts?.batchesCount ?? 0})</li>
                    <li>All audit trails, row results, and decisions</li>
                  </ul>
                  <div style={{ marginTop: 10 }}>This action is irreversible and the project screening data will be completely wiped.</div>
                </div>
                {clearProjectData.error && (
                  <div className="alert alert-error" style={{ margin: 0 }}>
                    {clearProjectData.error.message}
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowClearModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={clearProjectData.isPending}
                  style={{ borderColor: "var(--border-subtle)" }}
                >
                  {clearProjectData.isPending ? "Clearing..." : "Clear Data"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Project Modal */}
      {showDeleteModal && (
        <div className="modal-backdrop" onClick={() => setShowDeleteModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <div className="modal-header">
              <div>
                <div className="modal-title" style={{ color: "var(--text-primary)" }}>Delete Project</div>
                <div className="modal-subtitle">Confirm permanent deletion</div>
              </div>
              <button
                className="btn btn-ghost btn-icon"
                onClick={() => setShowDeleteModal(false)}
                style={{ color: "var(--text-muted)" }}
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleDeleteProject}>
              <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div className="alert alert-error" style={{ margin: 0 }}>
                  <strong>Warning:</strong> This will delete:
                  <ul style={{ paddingLeft: 16, marginTop: 6, fontSize: 13 }}>
                    <li>The project <strong>{project.name}</strong></li>
                    <li>All team memberships ({counts?.membersCount ?? 0})</li>
                    <li>All articles ({counts?.articlesCount ?? 0}) and import logs</li>
                  </ul>
                  <div style={{ marginTop: 10 }}>This action cannot be undone.</div>
                </div>

                <div className="field">
                  <label className="label">
                    Type <strong>{project.name}</strong> to confirm: <span style={{ color: "#FF453A" }}>*</span>
                  </label>
                  <input
                    type="text"
                    className="input"
                    placeholder={project.name}
                    value={confirmName}
                    onChange={(e) => setConfirmName(e.target.value)}
                    required
                    autoFocus
                  />
                </div>
                {deleteProject.error && (
                  <div className="alert alert-error" style={{ margin: 0 }}>
                    {deleteProject.error.message}
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowDeleteModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={confirmName !== project.name || deleteProject.isPending}
                  style={{
                    background: confirmName === project.name ? "var(--text-primary)" : "var(--bg-elevated)",
                    color: confirmName === project.name ? "var(--bg-deep)" : "var(--text-muted)",
                    borderColor: "var(--border-subtle)"
                  }}
                >
                  {deleteProject.isPending ? "Deleting..." : "Permanently Delete"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Batch Modal */}
      {deleteBatchId && (
        <DeleteBatchModal
          projectId={projectId}
          batchId={deleteBatchId}
          onClose={() => setDeleteBatchId(null)}
          onSuccess={() => {
            void utils.article.list.invalidate();
            void utils.article.getCounts.invalidate({ projectId });
            void utils.project.getById.invalidate({ projectId });
            void refetchBatches();
            setDeleteBatchId(null);
          }}
        />
      )}
    </div>
  );
}

function DeleteBatchModal({
  projectId,
  batchId,
  onClose,
  onSuccess,
}: {
  projectId: string;
  batchId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [confirmText, setConfirmText] = useState("");
  const utils = api.useUtils();
  
  // Fetch impact details
  const { data: impact, isLoading } = api.import.getBatchImpact.useQuery({ batchId });
  const deleteBatch = api.import.deleteBatch.useMutation({
    onSuccess: () => {
      onSuccess();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!impact || (confirmText !== impact.fileName && confirmText !== "DELETE")) return;
    deleteBatch.mutate({
      projectId,
      batchId,
      confirmText,
    });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <div className="modal-header">
          <div>
            <div className="modal-title" style={{ color: "var(--text-primary)" }}>Delete Import Batch</div>
            <div className="modal-subtitle">Confirm batch removal and impact review</div>
          </div>
          <button
            className="btn btn-ghost btn-icon"
            onClick={onClose}
            style={{ color: "var(--text-muted)" }}
          >
            ✕
          </button>
        </div>
        
        {isLoading || !impact ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "40px 0" }}>
            <div className="spinner" />
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div className="alert alert-error" style={{ margin: 0 }}>
                <strong>Warning:</strong> Deleting this batch will permanently remove:
                <ul style={{ paddingLeft: 16, marginTop: 6, fontSize: 13, display: "flex", flexDirection: "column", gap: 4 }}>
                  <li>Articles imported by this file: <strong>{impact.totalArticles}</strong></li>
                  <li>Completed reviews: <strong>{impact.reviewedArticles}</strong></li>
                  <li>Review notes: <strong>{impact.reviewNotesCount}</strong></li>
                  <li>
                    Decision Breakdown: 
                    <span style={{ marginLeft: 6 }}>
                      Inclusions ({impact.includes}) · Exclusions ({impact.excludes}) · Maybes ({impact.maybes})
                    </span>
                  </li>
                </ul>
                <div style={{ marginTop: 10 }}>This action is irreversible. All screening progress on these articles will be lost.</div>
              </div>

              <div className="field">
                <label className="label">
                  Type <strong>{impact.fileName}</strong> or <strong>DELETE</strong> to confirm: <span style={{ color: "#FF453A" }}>*</span>
                </label>
                <input
                  type="text"
                  className="input"
                  placeholder="Filename or DELETE"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              
              {deleteBatch.error && (
                <div className="alert alert-error" style={{ margin: 0 }}>
                  {deleteBatch.error.message}
                </div>
              )}
            </div>
            
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={(confirmText !== impact.fileName && confirmText !== "DELETE") || deleteBatch.isPending}
                style={{
                  background: (confirmText === impact.fileName || confirmText === "DELETE") ? "var(--text-primary)" : "var(--bg-elevated)",
                  color: (confirmText === impact.fileName || confirmText === "DELETE") ? "var(--bg-deep)" : "var(--text-muted)",
                  borderColor: "var(--border-subtle)",
                }}
              >
                {deleteBatch.isPending ? "Deleting..." : "Permanently Delete"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
