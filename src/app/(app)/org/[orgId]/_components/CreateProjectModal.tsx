"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "~/trpc/react";

export function CreateProjectModal({
  orgId,
  buttonLabel = "New Project",
}: {
  orgId: string;
  buttonLabel?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const create = api.project.create.useMutation({
    onSuccess: (project) => {
      router.push(`/project/${project.id}`);
      router.refresh();
      setOpen(false);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    create.mutate({ organizationId: orgId, name: name.trim(), description: description.trim() || undefined });
  };

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn btn-primary">
        + {buttonLabel}
      </button>

      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <div className="modal-title">New Project</div>
                <div className="modal-subtitle">Create a new systematic review project</div>
              </div>
              <button className="btn btn-ghost btn-icon" onClick={() => setOpen(false)} style={{ color: "var(--text-muted)" }}>✕</button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                <div className="field">
                  <label className="label">Project name <span style={{ color: "#FF453A" }}>*</span></label>
                  <input
                    className="input"
                    placeholder="e.g. Digital Health Interventions for Diabetes 2024"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoFocus
                    required
                  />
                </div>
                <div className="field">
                  <label className="label">Description <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>(optional)</span></label>
                  <textarea
                    className="input"
                    placeholder="Brief description of your research question or scope..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                  />
                </div>
                {create.error && <div className="alert alert-error">{create.error.message}</div>}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={!name.trim() || create.isPending}>
                  {create.isPending && <span className="spinner" style={{ borderTopColor: "#fff" }} />}
                  Create Project
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
