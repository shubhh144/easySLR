"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "~/trpc/react";
import { CreateProjectModal } from "./CreateProjectModal";

// ── Icons (Pure SVG) ───────────────────────────────────────────────────────
const EditPencilIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ opacity: 0.6, cursor: "pointer", transition: "opacity 0.2s" }}
  >
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);

const CheckIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="3"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const CrossIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="3"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <line x1="18" x2="6" y1="6" y2="18" />
    <line x1="6" x2="18" y1="6" y2="18" />
  </svg>
);

export function OrgHeader({
  orgId,
  initialName,
  isOwner,
  projectsCount,
  membersCount,
  isSettingsTab,
}: {
  orgId: string;
  initialName: string;
  isOwner: boolean;
  projectsCount: number;
  membersCount: number;
  isSettingsTab: boolean;
}) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(initialName);
  const [inputVal, setInputVal] = useState(initialName);
  const inputRef = useRef<HTMLInputElement>(null);

  const updateOrg = api.organization.update.useMutation({
    onSuccess: (data) => {
      setName(data.name);
      setIsEditing(false);
      router.refresh();
    },
  });

  useEffect(() => {
    setName(initialName);
  }, [initialName]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleStartEdit = () => {
    setInputVal(name);
    setIsEditing(true);
  };

  const handleSave = () => {
    const trimmed = inputVal.trim();
    if (!trimmed || trimmed === name || updateOrg.isPending) {
      setIsEditing(false);
      return;
    }
    updateOrg.mutate({ organizationId: orgId, name: trimmed });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSave();
    } else if (e.key === "Escape") {
      setIsEditing(false);
    }
  };

  return (
    <div
      className="page-header"
      style={{
        marginBottom: 24,
        borderBottom: "1px solid var(--border-subtle)",
        paddingBottom: 24,
      }}
    >
      <div>
        {/* Breadcrumb */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <Link
            href="/dashboard"
            style={{ color: "var(--text-muted)", fontSize: 13, textDecoration: "none" }}
          >
            Dashboard
          </Link>
          <span style={{ color: "var(--text-muted)", fontSize: 12 }}>/</span>
          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{name}</span>
        </div>

        {/* Title Heading with Edit Pencil */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {isEditing ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                ref={inputRef}
                type="text"
                className="input"
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={updateOrg.isPending}
                style={{
                  fontSize: 24,
                  fontWeight: 700,
                  height: 38,
                  padding: "4px 10px",
                  background: "var(--bg-elevated)",
                  color: "var(--text-primary)",
                  border: "1px solid var(--border-active)",
                  borderRadius: "var(--radius-max)",
                  width: "100%",
                  maxWidth: 400,
                }}
                placeholder="Organization name"
                required
              />
              <button
                onClick={handleSave}
                className="btn btn-primary btn-icon"
                disabled={!inputVal.trim() || updateOrg.isPending}
                style={{ width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}
                title="Save Changes"
              >
                <CheckIcon />
              </button>
              <button
                onClick={() => setIsEditing(false)}
                className="btn btn-secondary btn-icon"
                disabled={updateOrg.isPending}
                style={{ width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}
                title="Cancel"
              >
                <CrossIcon />
              </button>
            </div>
          ) : (
            <h1
              className="page-title"
              style={{
                fontSize: 32,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                gap: 12,
                margin: 0,
              }}
            >
              <span>{name}</span>
              {isOwner && (
                <button
                  onClick={handleStartEdit}
                  style={{
                    background: "none",
                    border: "none",
                    padding: 4,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                  }}
                  title="Rename Organization"
                  className="edit-pencil-btn"
                >
                  <EditPencilIcon />
                </button>
              )}
            </h1>
          )}
        </div>

        {/* Subtitle Stats */}
        <p className="page-subtitle" style={{ marginTop: 6, marginBottom: 0 }}>
          {projectsCount} Project{projectsCount !== 1 ? "s" : ""} · {membersCount} Member
          {membersCount !== 1 ? "s" : ""}
        </p>

        {updateOrg.error && (
          <div className="alert alert-error" style={{ marginTop: 12, marginBottom: 0 }}>
            {updateOrg.error.message}
          </div>
        )}
      </div>

      {!isSettingsTab && isOwner && <CreateProjectModal orgId={orgId} />}
    </div>
  );
}
