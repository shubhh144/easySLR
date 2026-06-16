"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "~/trpc/react";

export function OrgSettings({ orgId, currentUserId }: { orgId: string; currentUserId: string }) {
  const router = useRouter();
  const utils = api.useUtils();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<"OWNER" | "MEMBER">("MEMBER");
  const [confirmName, setConfirmName] = useState("");
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  // Fetch organization details (which includes members)
  const { data: org, isLoading } = api.organization.getById.useQuery({ organizationId: orgId });

  // TRPC mutations
  const invite = api.organization.inviteMember.useMutation({
    onSuccess: () => {
      setEmail("");
      setName("");
      setRole("MEMBER");
      void utils.organization.getById.invalidate({ organizationId: orgId });
    },
  });

  const remove = api.organization.removeMember.useMutation({
    onSuccess: () => {
      void utils.organization.getById.invalidate({ organizationId: orgId });
    },
  });

  const deleteOrg = api.organization.delete.useMutation({
    onSuccess: () => {
      window.location.href = "/dashboard";
    },
  });

  if (isLoading || !org) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "40px 0" }}>
        <div className="spinner" />
      </div>
    );
  }

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !name.trim()) return;
    invite.mutate({ organizationId: orgId, email: email.trim(), name: name.trim(), role });
  };

  const handleRemove = (userId: string, userName: string) => {
    if (confirm(`Are you sure you want to remove ${userName || "this member"} from the organization? This will also remove them from all projects in this organization.`)) {
      remove.mutate({ organizationId: orgId, userId });
    }
  };

  const handleDeleteOrg = (e: React.FormEvent) => {
    e.preventDefault();
    if (confirmName !== org.name) return;
    deleteOrg.mutate({ organizationId: orgId, confirmName });
  };

  // Check if current user is owner
  const isOwner = org.members.find((m) => m.userId === currentUserId)?.role === "OWNER";

  if (!isOwner) {
    return (
      <div className="card" style={{ padding: 24, textAlign: "center" }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--text-primary)" }}>Access Denied</h3>
        <p style={{ color: "var(--text-muted)", marginTop: 8 }}>Only organization owners can access organization settings.</p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
      {/* 1. Member Management */}
      <div className="card" style={{ padding: 24 }}>
        <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Members</h3>
        <p style={{ color: "var(--text-muted)", fontSize: 13.5, marginBottom: 20 }}>
          Manage access to this organization and invite new researchers.
        </p>

        {/* Member list */}
        <div className="table-container" style={{ marginBottom: 24 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {org.members.map((member) => (
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
                      <span style={{ fontWeight: 600 }}>{member.user.name ?? "Invited User"}</span>
                      {member.userId === currentUserId && (
                        <span className="badge" style={{ fontSize: 9, padding: "2px 6px" }}>You</span>
                      )}
                    </div>
                  </td>
                  <td><span style={{ color: "var(--text-muted)" }}>{member.user.email}</span></td>
                  <td>
                    <span className="badge" style={{ textTransform: "uppercase" }}>
                      {member.role}
                    </span>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {member.userId !== currentUserId && (
                      <button
                        onClick={() => handleRemove(member.userId, member.user.name ?? member.user.email ?? "")}
                        className="btn btn-ghost btn-sm"
                        disabled={remove.isPending}
                        style={{ color: "var(--text-muted)", border: "none", cursor: "pointer" }}
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Invite Form */}
        <form onSubmit={handleInvite} style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 20 }}>
          <h4 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-secondary)" }}>
            Invite Member
          </h4>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
            <div className="field" style={{ flex: 1, minWidth: 200 }}>
              <label className="label">Full Name <span style={{ color: "#FF453A" }}>*</span></label>
              <input
                type="text"
                className="input"
                placeholder="e.g. Dr. Ross Geller"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 200 }}>
              <label className="label">Email address <span style={{ color: "#FF453A" }}>*</span></label>
              <input
                type="email"
                className="input"
                placeholder="colleague@university.edu"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="field" style={{ width: 120 }}>
              <label className="label">Role</label>
              <select
                className="input"
                value={role}
                onChange={(e) => setRole(e.target.value as "OWNER" | "MEMBER")}
                style={{ paddingRight: 24 }}
              >
                <option value="MEMBER">Member</option>
                <option value="OWNER">Owner</option>
              </select>
            </div>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!email.trim() || !name.trim() || invite.isPending}
              style={{ height: 40 }}
            >
              {invite.isPending ? "Inviting..." : "Invite"}
            </button>
          </div>
          {invite.error && (
            <div className="alert alert-error" style={{ marginTop: 12 }}>
              {invite.error.message}
            </div>
          )}
        </form>
      </div>

      {/* 2. Destructive Actions / Delete Organization */}
      <div className="card" style={{ padding: 24, border: "1px solid var(--border-subtle)" }}>
        <h3 style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)", marginBottom: 6 }}>
          Delete Organization
        </h3>
        <p style={{ color: "var(--text-muted)", fontSize: 13.5, marginBottom: 20 }}>
          Permanently delete this organization, all projects, and screening databases. This action is irreversible.
        </p>

        <button
          onClick={() => setShowDeleteModal(true)}
          className="btn btn-danger"
          style={{ borderColor: "var(--border-subtle)", color: "var(--text-primary)" }}
        >
          Delete Organization...
        </button>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className="modal-backdrop" onClick={() => setShowDeleteModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <div className="modal-header">
              <div>
                <div className="modal-title" style={{ color: "var(--text-primary)" }}>Delete Organization</div>
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
            <form onSubmit={handleDeleteOrg}>
              <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div className="alert alert-error" style={{ margin: 0 }}>
                  <strong>Warning:</strong> This will delete:
                  <ul style={{ paddingLeft: 16, marginTop: 6, fontSize: 13 }}>
                    <li>The organization <strong>{org.name}</strong></li>
                    <li>All child projects ({org._count.projects})</li>
                    <li>All articles, reviews, batches, and conflict data inside those projects</li>
                  </ul>
                  <div style={{ marginTop: 10 }}>This action cannot be undone.</div>
                </div>

                <div className="field">
                  <label className="label">
                    Type <strong>{org.name}</strong> to confirm: <span style={{ color: "#FF453A" }}>*</span>
                  </label>
                  <input
                    type="text"
                    className="input"
                    placeholder={org.name}
                    value={confirmName}
                    onChange={(e) => setConfirmName(e.target.value)}
                    required
                    autoFocus
                  />
                </div>
                {deleteOrg.error && (
                  <div className="alert alert-error" style={{ margin: 0 }}>
                    {deleteOrg.error.message}
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
                  disabled={confirmName !== org.name || deleteOrg.isPending}
                  style={{
                    background: confirmName === org.name ? "var(--text-primary)" : "var(--bg-deep)",
                    color: confirmName === org.name ? "var(--bg-deep)" : "var(--text-muted)",
                    borderColor: "var(--border-subtle)"
                  }}
                >
                  {deleteOrg.isPending ? "Deleting..." : "Permanently Delete"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
