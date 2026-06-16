"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "~/trpc/react";

export function CreateOrgModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");

  const createOrg = api.organization.create.useMutation({
    onSuccess: (org) => {
      router.push(`/org/${org.id}`);
      router.refresh();
      onClose();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    createOrg.mutate({ name: name.trim() });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="modal-title">Create Organization</div>
            <div className="modal-subtitle">Group your research projects under an organization</div>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose} style={{ color: "var(--text-muted)" }}>
            ✕
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="field">
              <label className="label">Organization name</label>
              <input
                className="input"
                placeholder="e.g. Johns Hopkins Research Lab"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                required
              />
              <span className="field-hint">Your team&apos;s projects will live under this organization.</span>
            </div>
            {createOrg.error && (
              <div className="alert alert-error">{createOrg.error.message}</div>
            )}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!name.trim() || createOrg.isPending}
            >
              {createOrg.isPending ? <span className="spinner" style={{ borderTopColor: "#fff" }} /> : null}
              Create Organization
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
