"use client";

import { useState, useRef, useCallback } from "react";
import { api } from "~/trpc/react";
import { useRouter } from "next/navigation";

// ── Type helpers ───────────────────────────────────────────────────────────
type ImportStatus =
  | "IMPORTED"
  | "AUTO_CORRECTED"
  | "IMPORTED_WARNING"
  | "POSSIBLE_MATCH"
  | "LIKELY_DUPLICATE"
  | "CONFLICT"
  | "AUTO_RESOLVED_DUPLICATE";

type ConflictCluster = {
  id: string;
  type: "SYSTEMIC_DOI_COLLISION" | "SYSTEMIC_PMID_COLLISION" | "DUPLICATE_GROUP";
  sharedIdentifier: string;
  affectedRowIndices: number[];
  explanation: string;
  suggestedResolution: string;
};

type ProcessedRow = {
  rowIndex: number;
  finalStatus: ImportStatus;
  explanation: string;
  normalized: { title?: string | null; pmid?: string | null; doi?: string | null; authors?: string | null; pubYear?: number | null; firstAuthor?: string | null };
  corrections: { field: string; originalValue: string; correctedValue: string; reason: string }[];
  warnings: { field: string; severity: string; message: string; suggestion?: string }[];
};

type AnalysisResult = {
  totalRows: number;
  summary: {
    importedCount: number;
    autoCorrectedCount: number;
    importedWithWarningCount: number;
    possibleMatchCount: number;
    likelyDuplicateCount: number;
    conflictCount: number;
    autoResolvedDuplicateCount: number;
  };
  processedRows: ProcessedRow[];
  clusters: ConflictCluster[];
  fileName: string;
  existingArticleCount: number;
};

const STATUS_LABELS: Record<ImportStatus, string> = {
  IMPORTED:                "Clean",
  AUTO_RESOLVED_DUPLICATE: "Auto-Skipped",
  AUTO_CORRECTED:          "Auto-Fixed",
  IMPORTED_WARNING:        "Warning",
  POSSIBLE_MATCH:          "Similar",
  LIKELY_DUPLICATE:        "Duplicate",
  CONFLICT:                "Conflict",
};

// ── Icons (Pure SVG) ───────────────────────────────────────────────────────
const CrossIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <line x1="18" x2="6" y1="6" y2="18" /><line x1="6" x2="18" y1="6" y2="18" />
  </svg>
);

const CheckIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

// ── Step indicator ─────────────────────────────────────────────────────────
function StepIndicator({ step }: { step: 1 | 2 | 3 }) {
  const steps = ["Upload File", "Review Preview", "Confirm Complete"];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 0, marginBottom: 28, borderBottom: "1px solid var(--border-subtle)", paddingBottom: 16 }}>
      {steps.map((label, i) => {
        const num = i + 1;
        const done = num < step;
        const active = num === step;
        return (
          <div key={label} style={{ display: "flex", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{
                width: 24, height: 24, borderRadius: "var(--radius-max)",
                background: done || active ? "var(--text-primary)" : "var(--bg-deep)",
                border: `1.5px solid ${done || active ? "var(--text-primary)" : "var(--border-subtle)"}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 11, fontWeight: 700, color: done || active ? "var(--bg-deep)" : "var(--text-muted)",
                transition: "all 0.15s ease",
              }}>
                {done ? <CheckIcon /> : num}
              </div>
              <span style={{
                fontSize: 12.5, fontWeight: active ? 600 : 400,
                color: active ? "var(--text-primary)" : done ? "var(--text-secondary)" : "var(--text-muted)",
                textTransform: "uppercase", letterSpacing: "0.04em",
              }}>
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div style={{
                width: 32, height: 1, margin: "0 16px",
                background: done ? "var(--text-primary)" : "var(--border-subtle)",
              }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Upload zone ────────────────────────────────────────────────────────────
function UploadZone({ onFile }: { onFile: (file: File) => void }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith(".xlsx") || file.name.endsWith(".xls"))) {
      onFile(file);
    }
  }, [onFile]);

  return (
    <div
      className="upload-zone"
      style={{
        borderColor: dragging ? "var(--border-active)" : "var(--border-subtle)",
      }}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
      />
      <div style={{ fontSize: 13, color: "var(--text-primary)", fontWeight: 700, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.08em" }}>
        Select Dataset File
      </div>
      <div style={{ fontSize: 13.5, color: "var(--text-muted)", marginBottom: 16 }}>
        Drag and drop PubMed Excel export or click to browse (.xlsx)
      </div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
        Expected columns: PMID, Title, Authors, DOI, Journal, Pub Year
      </div>
    </div>
  );
}

// ── Summary bar ────────────────────────────────────────────────────────────
function SummaryBar({ summary, total }: { summary: AnalysisResult["summary"]; total: number }) {
  const greenCount = summary.importedCount + summary.autoCorrectedCount + summary.autoResolvedDuplicateCount;
  const yellowCount = summary.importedWithWarningCount + summary.possibleMatchCount;
  const redCount = summary.likelyDuplicateCount + summary.conflictCount;

  return (
    <div className="card" style={{ padding: "20px", marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <span className="label-uppercase" style={{ fontSize: 11, color: "var(--text-primary)" }}>
          Dataset Triage Summary — {total} Rows
        </span>
        <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
          Analysis complete
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
        {/* GREEN */}
        <div style={{ borderLeft: "3px solid var(--text-primary)", paddingLeft: 12 }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", color: "var(--text-muted)", fontWeight: 700 }}>
            Auto-Resolved (Green)
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "var(--text-primary)", margin: "4px 0" }}>
            {greenCount}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {summary.importedCount} clean · {summary.autoCorrectedCount} auto-fixed · {summary.autoResolvedDuplicateCount} skipped
          </div>
        </div>

        {/* YELLOW */}
        <div style={{ borderLeft: "3px solid var(--text-muted)", paddingLeft: 12 }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", color: "var(--text-muted)", fontWeight: 700 }}>
            Warnings / Soft Matches (Yellow)
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "var(--text-secondary)", margin: "4px 0" }}>
            {yellowCount}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {summary.importedWithWarningCount} metadata warnings · {summary.possibleMatchCount} similar titles
          </div>
        </div>

        {/* RED */}
        <div style={{ borderLeft: "3px solid var(--border-active)", paddingLeft: 12 }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", color: "var(--text-muted)", fontWeight: 700 }}>
            Action Required (Red)
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "var(--text-primary)", margin: "4px 0" }}>
            {redCount}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {summary.likelyDuplicateCount} duplicates · {summary.conflictCount} identifier collisions
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Preview row ────────────────────────────────────────────────────────────
function PreviewRow({ row }: { row: ProcessedRow }) {
  const [expanded, setExpanded] = useState(false);
  const badgeClass = `badge badge-${row.finalStatus.toLowerCase().replace(/_/g, "-")}`;
  const label = STATUS_LABELS[row.finalStatus];

  return (
    <>
      <tr
        className={`import-row-${row.finalStatus.toLowerCase().replace(/_/g, "-")}`}
        onClick={() => setExpanded(!expanded)}
        style={{ cursor: "pointer" }}
      >
        <td style={{ width: 40, paddingRight: 8 }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)", fontFamily: "monospace" }}>
            {row.rowIndex}
          </span>
        </td>
        <td style={{ maxWidth: 400 }}>
          <div className="truncate" style={{ color: "var(--text-primary)", fontWeight: 600, fontSize: 13.5 }}>
            {row.normalized.title ?? <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>No title in record</span>}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
            {row.normalized.firstAuthor ?? row.normalized.authors?.split(";")[0]?.trim() ?? "Unknown"}
            {row.normalized.pubYear && ` · ${row.normalized.pubYear}`}
          </div>
        </td>
        <td style={{ width: 100 }}>
          {row.normalized.pmid && (
            <span style={{ fontSize: 12, fontFamily: "monospace", color: "var(--text-muted)" }}>
              {row.normalized.pmid}
            </span>
          )}
        </td>
        <td style={{ width: 140 }}>
          <span className={badgeClass}>{label}</span>
        </td>
        <td style={{ width: 36, textAlign: "right" }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{expanded ? "▲" : "▼"}</span>
        </td>
      </tr>

      {expanded && (
        <tr>
          <td colSpan={5} style={{ background: "var(--bg-deep)", padding: "12px 24px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 13 }}>
              <div>
                <span style={{ color: "var(--text-muted)" }}>Explanation: </span>
                <span style={{ color: "var(--text-secondary)", whiteSpace: "pre-line" }}>{row.explanation}</span>
              </div>
              {row.corrections.length > 0 && (
                <div>
                  <div style={{ fontWeight: 600, color: "var(--text-primary)", marginBottom: 4 }}>Corrections:</div>
                  {row.corrections.map((c, idx) => (
                    <div key={idx} style={{ color: "var(--text-muted)", paddingLeft: 8 }}>
                      • {c.field}: &ldquo;{c.originalValue}&rdquo; was corrected to &ldquo;{c.correctedValue}&rdquo; ({c.reason})
                    </div>
                  ))}
                </div>
              )}
              {row.warnings.length > 0 && (
                <div>
                  <div style={{ fontWeight: 600, color: "var(--text-primary)", marginBottom: 4 }}>Quality Warnings:</div>
                  {row.warnings.map((w, idx) => (
                    <div key={idx} style={{ color: "var(--text-secondary)", paddingLeft: 8 }}>
                      • [{w.severity}] {w.field}: {w.message}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Main Import Wizard ─────────────────────────────────────────────────────
export function ImportWizard({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const router = useRouter();
  const utils = api.useUtils();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [file, setFile] = useState<File | null>(null);
  const [fileBase64, setFileBase64] = useState<string>("");
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [clusterResolutions, setClusterResolutions] = useState<Record<string, "FLAG_UNTRUSTED" | "SKIP_ALL" | "IMPORT_ANYWAY" | "IMPORT_ONE" | "OVERWRITE_DB">>({});
  const [filterStatus, setFilterStatus] = useState<string>("ALL");
  const [importConfirmed, setImportConfirmed] = useState(false);

  const calculateWillImport = () => {
    if (!analysisResult) return 0;
    let count =
      analysisResult.summary.importedCount +
      analysisResult.summary.autoCorrectedCount +
      analysisResult.summary.importedWithWarningCount +
      analysisResult.summary.possibleMatchCount;

    analysisResult.clusters?.forEach((cluster) => {
      const resolution = clusterResolutions[cluster.id];
      if (resolution === "IMPORT_ONE") {
        count += 1;
      } else if (resolution === "IMPORT_ANYWAY" || resolution === "FLAG_UNTRUSTED") {
        count += cluster.affectedRowIndices.length;
      }
    });
    return count;
  };

  const analyze = api.import.analyzeFile.useMutation({
    onSuccess: (result) => {
      const parsed = result as unknown as AnalysisResult;
      setAnalysisResult(parsed);

      const initial: Record<string, any> = {};
      parsed.clusters?.forEach((c) => {
        initial[c.id] = c.type === "DUPLICATE_GROUP" ? "IMPORT_ONE" : "FLAG_UNTRUSTED";
      });
      setClusterResolutions(initial);
      setStep(2);
    },
  });

  const confirm = api.import.confirmImport.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.article.list.invalidate(),
        utils.article.getCounts.invalidate({ projectId }),
        utils.project.getById.invalidate({ projectId }),
      ]);
      setStep(3);
      router.refresh();
    },
  });

  const handleFileSelectB64 = (selectedFile: File) => {
    setFile(selectedFile);
    const reader = new FileReader();
    reader.onload = (e) => {
      const arrayBuffer = e.target?.result as ArrayBuffer;
      const bytes = new Uint8Array(arrayBuffer);
      let binary = "";
      for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]!);
      setFileBase64(btoa(binary));
    };
    reader.readAsArrayBuffer(selectedFile);
  };

  const handleAnalyze = () => {
    if (!file || !fileBase64) return;
    analyze.mutate({
      projectId,
      fileBase64,
      fileName: file.name,
      fileSize: file.size,
    });
  };

  const handleConfirm = () => {
    if (!file || !fileBase64) return;
    const resolutionsArray = Object.entries(clusterResolutions).map(([clusterId, decision]) => ({
      clusterId,
      decision,
    }));

    confirm.mutate({
      projectId,
      fileBase64,
      fileName: file!.name,
      fileSize: file!.size,
      clusterResolutions: resolutionsArray,
    });
  };

  // Filter rows for display
  const displayRows = analysisResult?.processedRows.filter((row) =>
    filterStatus === "ALL"
      ? true
      : filterStatus === "AUTO_RESOLVED_DUPLICATE"
        ? row.finalStatus === "AUTO_RESOLVED_DUPLICATE"
        : row.finalStatus === filterStatus
  ) ?? [];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: step === 2 ? 1000 : 500,
          width: "100%",
          maxHeight: "calc(100vh - 48px)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div className="modal-header">
          <div>
            <div className="modal-title">Dataset Import Pipeline</div>
            <div className="modal-subtitle">Verify study metadata and resolve duplicate clusters</div>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose} style={{ color: "var(--text-muted)", cursor: "pointer", border: "none", background: "none" }}>
            <CrossIcon />
          </button>
        </div>

        <div style={{ padding: "24px", overflowY: "auto", flex: 1, display: "flex", flexDirection: "column" }}>
          <StepIndicator step={step} />

          {/* ── STEP 1: UPLOAD ── */}
          {step === 1 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <UploadZone onFile={handleFileSelectB64} />

              {file && (
                <div className="alert alert-info" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ fontWeight: 600, fontSize: 13.5, color: "var(--text-primary)" }}>{file.name}</span>
                    <span style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{(file.size / 1024).toFixed(1)} KB</span>
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={() => { setFile(null); setFileBase64(""); }} style={{ padding: "4px 8px" }}>
                    Remove
                  </button>
                </div>
              )}

              {analyze.error && (
                <div className="alert alert-error">{analyze.error.message}</div>
              )}

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 12 }}>
                <button className="btn btn-secondary btn-sm" onClick={onClose}>Cancel</button>
                <button
                  className="btn btn-primary btn-sm"
                  disabled={!file || !fileBase64 || analyze.isPending}
                  onClick={handleAnalyze}
                >
                  {analyze.isPending ? (
                    <><span className="spinner" style={{ borderTopColor: "var(--bg-deep)" }} /> Running Audit...</>
                  ) : (
                    "Analyze Dataset"
                  )}
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 2: PREVIEW ── */}
          {step === 2 && analysisResult && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <SummaryBar summary={analysisResult.summary} total={analysisResult.totalRows} />

              {/* Conflict Clusters Area */}
              {analysisResult.clusters && analysisResult.clusters.length > 0 && (
                <div>
                  <div className="label-uppercase" style={{ fontSize: 11, marginBottom: 12, color: "var(--text-primary)" }}>
                    Action Required — resolve {analysisResult.clusters.length} Conflict Cluster{analysisResult.clusters.length > 1 ? "s" : ""}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 14, maxHeight: 280, overflowY: "auto", paddingRight: 4 }}>
                    {analysisResult.clusters.map((cluster) => (
                      <div
                        key={cluster.id}
                        className="card"
                        style={{
                          padding: "16px",
                          background: "var(--bg-elevated)",
                          border: "1px solid var(--border-subtle)",
                          borderRadius: "var(--radius-max)",
                          display: "flex",
                          flexDirection: "column",
                          gap: 12,
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span className="badge" style={{
                              background: cluster.type === "DUPLICATE_GROUP" ? "var(--bg-deep)" : "var(--text-primary)",
                              color: cluster.type === "DUPLICATE_GROUP" ? "var(--text-primary)" : "var(--bg-deep)",
                              fontWeight: 700,
                              fontSize: "10px",
                              padding: "2px 6px",
                              borderRadius: "4px",
                            }}>
                              {cluster.type.replace(/_/g, " ")}
                            </span>
                            <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-primary)", fontFamily: "monospace" }}>
                              {cluster.sharedIdentifier}
                            </span>
                          </div>
                          <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                            {cluster.affectedRowIndices.length} rows affected
                          </span>
                        </div>

                        <p style={{ fontSize: "13px", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                          {cluster.explanation}
                        </p>

                        <div style={{
                          padding: "12px",
                          background: "var(--bg-deep)",
                          border: "1px solid var(--border-subtle)",
                          borderRadius: "var(--radius-max)",
                          display: "flex",
                          flexDirection: "column",
                          gap: 10,
                        }}>
                          <div style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", color: "var(--text-muted)", letterSpacing: "0.05em" }}>
                            Resolution Decision
                          </div>

                          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            {cluster.type === "DUPLICATE_GROUP" ? (
                              <>
                                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: "13px" }}>
                                  <input
                                    type="radio"
                                    name={`resolution-${cluster.id}`}
                                    checked={clusterResolutions[cluster.id] === "IMPORT_ONE"}
                                    onChange={() => setClusterResolutions(prev => ({ ...prev, [cluster.id]: "IMPORT_ONE" }))}
                                  />
                                  <span><strong>Import One (Recommended)</strong> — Keep only the first record, skip duplicates</span>
                                </label>
                                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: "13px" }}>
                                  <input
                                    type="radio"
                                    name={`resolution-${cluster.id}`}
                                    checked={clusterResolutions[cluster.id] === "SKIP_ALL"}
                                    onChange={() => setClusterResolutions(prev => ({ ...prev, [cluster.id]: "SKIP_ALL" }))}
                                  />
                                  <span><strong>Skip All</strong> — Do not import any copy of this paper</span>
                                </label>
                                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: "13px" }}>
                                  <input
                                    type="radio"
                                    name={`resolution-${cluster.id}`}
                                    checked={clusterResolutions[cluster.id] === "IMPORT_ANYWAY"}
                                    onChange={() => setClusterResolutions(prev => ({ ...prev, [cluster.id]: "IMPORT_ANYWAY" }))}
                                  />
                                  <span><strong>Import Anyway</strong> — Force import all rows as independent articles</span>
                                </label>
                              </>
                            ) : (
                              <>
                                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: "13px" }}>
                                  <input
                                    type="radio"
                                    name={`resolution-${cluster.id}`}
                                    checked={clusterResolutions[cluster.id] === "FLAG_UNTRUSTED"}
                                    onChange={() => setClusterResolutions(prev => ({ ...prev, [cluster.id]: "FLAG_UNTRUSTED" }))}
                                  />
                                  <span><strong>Flag &amp; Isolate (Recommended)</strong> — Preserve the identifier but mark as untrusted to isolate from future duplicates</span>
                                </label>
                                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: "13px" }}>
                                  <input
                                    type="radio"
                                    name={`resolution-${cluster.id}`}
                                    checked={clusterResolutions[cluster.id] === "SKIP_ALL"}
                                    onChange={() => setClusterResolutions(prev => ({ ...prev, [cluster.id]: "SKIP_ALL" }))}
                                  />
                                  <span><strong>Skip All</strong> — Do not import these rows</span>
                                </label>
                                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: "13px" }}>
                                  <input
                                    type="radio"
                                    name={`resolution-${cluster.id}`}
                                    checked={clusterResolutions[cluster.id] === "IMPORT_ANYWAY"}
                                    onChange={() => setClusterResolutions(prev => ({ ...prev, [cluster.id]: "IMPORT_ANYWAY" }))}
                                  />
                                  <span><strong>Import Anyway</strong> — Force import all rows as independent articles</span>
                                </label>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Preview List Area */}
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <div className="tab-list" style={{ flexWrap: "wrap" }}>
                    {[
                      { key: "ALL", label: "All Citations", count: analysisResult.totalRows },
                      { key: "AUTO_RESOLVED_DUPLICATE", label: "Auto-Skipped", count: analysisResult.summary.autoResolvedDuplicateCount },
                      { key: "CONFLICT", label: "Conflicts", count: analysisResult.summary.conflictCount },
                      { key: "LIKELY_DUPLICATE", label: "Duplicates", count: analysisResult.summary.likelyDuplicateCount },
                      { key: "IMPORTED_WARNING", label: "Warnings", count: analysisResult.summary.importedWithWarningCount },
                      { key: "AUTO_CORRECTED", label: "Auto-Fixed", count: analysisResult.summary.autoCorrectedCount },
                    ].map(({ key, label, count }) => count > 0 || key === "ALL" ? (
                      <button
                        key={key}
                        className={`tab-item ${filterStatus === key ? "active" : ""}`}
                        onClick={() => setFilterStatus(key)}
                        style={{ cursor: "pointer" }}
                      >
                        {label} <span className="tab-count">{count}</span>
                      </button>
                    ) : null)}
                  </div>
                </div>

                <div className="table-container" style={{ maxHeight: 240, overflowY: "auto" }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th style={{ width: 40 }}>#</th>
                        <th>Title & Authors</th>
                        <th style={{ width: 100 }}>PMID</th>
                        <th style={{ width: 130 }}>Classification</th>
                        <th style={{ width: 36 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {displayRows.map((row) => (
                        <PreviewRow
                          key={row.rowIndex}
                          row={row}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Import Verification Box */}
              <div className="card" style={{ padding: 16, background: "var(--bg-deep)", border: "1px solid var(--border-subtle)", marginTop: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "var(--text-primary)", marginBottom: 12, letterSpacing: "0.05em" }}>
                  Final Import Verification
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, fontSize: 12, marginBottom: 16 }}>
                  <div><span style={{ color: "var(--text-muted)" }}>Total Rows:</span> <strong style={{ color: "var(--text-primary)" }}>{analysisResult.totalRows}</strong></div>
                  <div><span style={{ color: "var(--text-muted)" }}>Will Import:</span> <strong style={{ color: "var(--text-primary)" }}>{calculateWillImport()}</strong></div>
                  <div><span style={{ color: "var(--text-muted)" }}>Auto-Resolved:</span> <strong style={{ color: "var(--text-primary)" }}>{analysisResult.summary.autoResolvedDuplicateCount}</strong></div>
                  <div><span style={{ color: "var(--text-muted)" }}>Warnings:</span> <strong style={{ color: "var(--text-primary)" }}>{analysisResult.summary.importedWithWarningCount}</strong></div>
                  <div><span style={{ color: "var(--text-muted)" }}>Possible Matches:</span> <strong style={{ color: "var(--text-primary)" }}>{analysisResult.summary.possibleMatchCount}</strong></div>
                  <div><span style={{ color: "var(--text-muted)" }}>Conflict Clusters:</span> <strong style={{ color: "var(--text-primary)" }}>{analysisResult.clusters?.length ?? 0}</strong></div>
                </div>

                {calculateWillImport() === 0 ? (
                  <div className="alert alert-warning" style={{ margin: 0, padding: 12, display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={{ fontWeight: 600 }}>All Articles Already Exist</span>
                    <span>All records in this file already exist in the project database. There are no new articles to import.</span>
                  </div>
                ) : (
                  <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer", fontSize: 13, color: "var(--text-secondary)" }}>
                    <input
                      type="checkbox"
                      checked={importConfirmed}
                      onChange={(e) => setImportConfirmed(e.target.checked)}
                      style={{ marginTop: 3 }}
                    />
                    <span>I confirm that I have reviewed the warning details and cluster resolutions, and want to proceed with importing these articles.</span>
                  </label>
                )}
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 12 }}>
                <button className="btn btn-secondary btn-sm" onClick={() => setStep(1)}>Back</button>
                <button
                  className="btn btn-primary btn-sm"
                  disabled={confirm.isPending || !importConfirmed || calculateWillImport() === 0}
                  onClick={handleConfirm}
                >
                  {confirm.isPending
                    ? <><span className="spinner" style={{ borderTopColor: "var(--bg-deep)" }} /> Importing...</>
                    : `Confirm Import & Commit`
                  }
                </button>
              </div>
              {confirm.error && <div className="alert alert-error" style={{ marginTop: 12 }}>{confirm.error.message}</div>}
            </div>
          )}

          {/* ── STEP 3: DONE ── */}
          {step === 3 && (
            <div style={{ textAlign: "center", padding: "16px 0" }}>
              <div style={{
                width: 44, height: 44, borderRadius: "var(--radius-max)",
                border: "1.5px solid var(--border-active)",
                display: "flex", alignItems: "center", justifyContent: "center",
                margin: "0 auto 20px", fontSize: 16, color: "var(--text-primary)",
                fontWeight: 800,
              }}>
                OK
              </div>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>
                Import Completed
              </h2>
              {confirm.data && (
                <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
                  Successfully committed <strong>{confirm.data.importedCount} articles</strong>.
                  {confirm.data.skippedCount > 0 && (
                    <> Skipped/Auto-Resolved <strong>{confirm.data.skippedCount}</strong> duplicate records.</>
                  )}
                </p>
              )}
              <button className="btn btn-primary btn-sm" onClick={onClose} style={{ marginTop: 24 }}>
                Open Workspace
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
