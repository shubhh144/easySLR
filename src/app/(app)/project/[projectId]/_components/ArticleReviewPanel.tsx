"use client";

import { useState, useEffect } from "react";
import { api } from "~/trpc/react";

type ImportStatus = "IMPORTED" | "AUTO_CORRECTED" | "IMPORTED_WARNING" | "POSSIBLE_MATCH" | "LIKELY_DUPLICATE" | "CONFLICT";
type ReviewStatus = "PENDING" | "INCLUDED" | "EXCLUDED" | "MAYBE";
type Priority = "HIGH" | "MEDIUM" | "LOW";

type Warning = {
  field: string;
  severity: string;
  message: string;
  suggestion?: string;
};

type Correction = {
  field: string;
  originalValue: string;
  correctedValue: string;
  reason?: string;
};

type Article = {
  id: string;
  title: string | null;
  authors: string | null;
  firstAuthor: string | null;
  journal: string | null;
  pubYear: number | null;
  pmid: string | null;
  doi: string | null;
  importStatus: ImportStatus;
  reviewStatus: ReviewStatus;
  reviewNote: string | null;
  priority: Priority;
  importWarnings: unknown; // Json array of Warning
  importNotes: unknown; // Json object containing corrections, decidingRule, etc.
  reviewedAt: Date | null;
  reviewedBy: { name: string | null; email: string | null } | null;
};

export function ArticleReviewPanel({
  articleId,
  onClose,
  onSaveSuccess,
}: {
  articleId: string;
  onClose: () => void;
  onSaveSuccess: () => void;
}) {
  const utils = api.useUtils();
  const { data: article, isLoading } = api.article.getById.useQuery({ articleId });
  const mutation = api.article.makeDecision.useMutation({
    onSuccess: () => {
      void utils.article.list.invalidate();
      void utils.article.getCounts.invalidate();
      onSaveSuccess();
    },
  });

  const [decision, setDecision] = useState<ReviewStatus>("PENDING");
  const [priority, setPriority] = useState<Priority>("MEDIUM");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (article) {
      setDecision(article.reviewStatus);
      setPriority(article.priority);
      setNote(article.reviewNote ?? "");
    }
  }, [article]);

  if (isLoading || !article) {
    return (
      <div className="review-drawer-backdrop" onClick={onClose}>
        <div className="review-drawer" onClick={(e) => e.stopPropagation()} style={{ justifyContent: "center", alignItems: "center" }}>
          <div className="spinner" style={{ width: 24, height: 24 }} />
        </div>
      </div>
    );
  }

  const handleSave = () => {
    mutation.mutate({
      articleId,
      decision,
      priority,
      note: note.trim() || undefined,
    });
  };

  // Parse JSON fields
  const warnings = (article.importWarnings as Warning[]) ?? [];
  const notesObj = article.importNotes as {
    decidingRule?: string;
    corrections?: Correction[];
    claimedPmid?: string;
    identityResult?: {
      explanation?: string;
    };
  } | null;
  const corrections = notesObj?.corrections ?? [];
  const claimedPmid = notesObj?.claimedPmid;

  return (
    <div className="review-drawer-backdrop" onClick={onClose}>
      <div className="review-drawer" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header" style={{ padding: "20px 24px" }}>
          <div>
            <div className="label-uppercase" style={{ marginBottom: 4 }}>Article Review</div>
            <div className="modal-title" style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.4 }}>
              {article.title ?? "Untitled Citation"}
            </div>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose} style={{ color: "var(--text-muted)", cursor: "pointer", border: "none", background: "none" }}>
            ✕
          </button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "24px", display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Metadata Grid */}
          <div>
            <div className="label-uppercase" style={{ marginBottom: 8 }}>Bibliographic Metadata</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10, fontSize: 13.5 }}>
              {article.authors && (
                <div>
                  <span style={{ color: "var(--text-muted)" }}>Authors: </span>
                  <span style={{ color: "var(--text-secondary)" }}>{article.authors}</span>
                </div>
              )}
              {article.journal && (
                <div>
                  <span style={{ color: "var(--text-muted)" }}>Journal: </span>
                  <span style={{ color: "var(--text-secondary)" }}>{article.journal}</span>
                </div>
              )}
              {article.pubYear && (
                <div>
                  <span style={{ color: "var(--text-muted)" }}>Year: </span>
                  <span style={{ color: "var(--text-secondary)" }}>{article.pubYear}</span>
                </div>
              )}
              {article.pmid && (
                <div>
                  <span style={{ color: "var(--text-muted)" }}>PMID: </span>
                  <a href={`https://pubmed.ncbi.nlm.nih.gov/${article.pmid}/`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--text-primary)", textDecoration: "underline" }}>
                    {article.pmid}
                  </a>
                </div>
              )}
              {article.doi && (
                <div>
                  <span style={{ color: "var(--text-muted)" }}>DOI: </span>
                  <a href={`https://doi.org/${article.doi}`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--text-primary)", textDecoration: "underline" }}>
                    {article.doi}
                  </a>
                </div>
              )}
            </div>
          </div>

          <div className="separator" />

          {/* Import Quality Audit */}
          <div>
            <div className="label-uppercase" style={{ marginBottom: 8 }}>Import Audit Report</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ color: "var(--text-muted)", fontSize: 13 }}>Import Classification:</span>
                <span className={`badge badge-${article.importStatus.toLowerCase().replace(/_/g, '-')}`}>
                  {article.importStatus.replace(/_/g, ' ')}
                </span>
              </div>

              {/* Warnings List */}
              {warnings.length > 0 && (
                <div style={{ background: "var(--bg-base)", padding: 12, border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-max)", marginTop: 6 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)", marginBottom: 6 }}>Quality Warnings</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5 }}>
                    {warnings.map((w, idx) => (
                      <div key={idx} style={{ color: "var(--text-secondary)" }}>
                        • <strong>{w.field}</strong>: {w.message}
                        {w.suggestion && <span style={{ color: "var(--text-muted)" }}> (Suggestion: {w.suggestion})</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Auto-corrections List */}
              {corrections.length > 0 && (
                <div style={{ background: "var(--bg-base)", padding: 12, border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-max)", marginTop: 6 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)", marginBottom: 6 }}>Auto-corrections Applied</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5 }}>
                    {corrections.map((c, idx) => (
                      <div key={idx} style={{ color: "var(--text-secondary)" }}>
                        • <strong>{c.field}</strong>: &ldquo;{c.originalValue}&rdquo; was corrected to &ldquo;{c.correctedValue}&rdquo;
                        {c.reason && <span style={{ color: "var(--text-muted)" }}> ({c.reason})</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Identity conflict description */}
              {claimedPmid && (
                <div className="alert alert-error" style={{ padding: 10, fontSize: 12, marginTop: 6 }}>
                  Claimed PMID was <strong>{claimedPmid}</strong>. This was imported with a blank PMID to prevent database unique constraint conflicts.
                </div>
              )}
            </div>
          </div>

          <div className="separator" />

          {/* Screening Workflow Decisions */}
          <div>
            <div className="label-uppercase" style={{ marginBottom: 10 }}>Screening Decision</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
              {[
                { key: "INCLUDED", label: "Include", activeStyle: { background: "var(--text-primary)", color: "var(--bg-deep)" } },
                { key: "EXCLUDED", label: "Exclude", activeStyle: { background: "var(--bg-deep)", border: "1.5px solid var(--border-active)" } },
                { key: "MAYBE", label: "Maybe", activeStyle: { background: "var(--bg-elevated)", border: "1.5px solid var(--border-active)" } },
                { key: "PENDING", label: "Pending", activeStyle: { color: "var(--text-muted)", border: "1.5px dashed var(--border-subtle)" } },
              ].map(({ key, label, activeStyle }) => {
                const isActive = decision === key;
                return (
                  <button
                    key={key}
                    className="btn btn-sm"
                    onClick={() => setDecision(key as ReviewStatus)}
                    style={
                      isActive
                        ? { ...activeStyle, fontWeight: 700 }
                        : { border: "1px solid var(--border-subtle)", background: "transparent", color: "var(--text-muted)" }
                    }
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {/* Priority Selector */}
            <div className="field" style={{ marginBottom: 14 }}>
              <label className="label">Article Priority</label>
              <div style={{ display: "flex", gap: 8 }}>
                {(["HIGH", "MEDIUM", "LOW"] as Priority[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    className="btn btn-sm"
                    onClick={() => setPriority(p)}
                    style={
                      priority === p
                        ? { background: "var(--text-primary)", color: "var(--bg-deep)", fontWeight: 700 }
                        : { border: "1px solid var(--border-subtle)", background: "transparent", color: "var(--text-muted)" }
                    }
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            {/* Note Editor */}
            <div className="field">
              <label className="label">Review notes / Justification</label>
              <textarea
                className="input"
                placeholder="Specify reasons for inclusion, exclusion, or general study design notes..."
                value={note}
                onChange={(e) => setNote(e.target.value)}
                style={{ fontSize: 13.5 }}
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="modal-footer" style={{ padding: "16px 24px" }}>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={mutation.isPending}>
            {mutation.isPending && <span className="spinner" style={{ borderTopColor: "var(--bg-deep)" }} />}
            Save Review
          </button>
        </div>
      </div>
    </div>
  );
}
