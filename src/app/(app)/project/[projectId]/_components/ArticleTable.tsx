"use client";

import { useState, useCallback, useEffect } from "react";
import { api } from "~/trpc/react";
import { ArticleReviewPanel } from "./ArticleReviewPanel";

type ImportStatus = "IMPORTED" | "AUTO_CORRECTED" | "IMPORTED_WARNING" | "POSSIBLE_MATCH" | "LIKELY_DUPLICATE" | "CONFLICT";
type ReviewStatus = "PENDING" | "INCLUDED" | "EXCLUDED" | "MAYBE";
type Priority = "HIGH" | "MEDIUM" | "LOW";

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
  priority: Priority;
  reviewedAt: Date | null;
  reviewNote?: string | null;
  reviewedBy?: { name: string | null; email: string | null } | null;
};

// ── Icons (Pure SVG, no emojis) ─────────────────────────────────────────────
const SortIcon = ({ active, direction }: { active: boolean; direction: "asc" | "desc" }) => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ opacity: active ? 1 : 0.3, transition: "opacity 0.15s" }}>
    {active && direction === "asc" ? (
      <path d="m18 15-6-6-6 6" />
    ) : active && direction === "desc" ? (
      <path d="m6 9 6 6 6-6" />
    ) : (
      <path d="m7 15 5 5 5-5M7 9l5-5 5 5" />
    )}
  </svg>
);

const CheckIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

export function ArticleTable({
  projectId,
  importStatMap,
  reviewStatMap,
  isProjectManager,
}: {
  projectId: string;
  importStatMap: Record<string, number>;
  reviewStatMap: Record<string, number>;
  isProjectManager: boolean;
}) {
  const utils = api.useUtils();

  // Filters & State
  const [reviewFilter, setReviewFilter] = useState<ReviewStatus | undefined>(undefined);
  const [importFilter, setImportFilter] = useState<ImportStatus | undefined>(undefined);
  const [priorityFilter, setPriorityFilter] = useState<Priority | undefined>(undefined);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");

  // Sorting
  const [sortBy, setSortBy] = useState<"title" | "priority" | "pubYear" | "journal" | "reviewStatus" | undefined>(undefined);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Review Side Panel
  const [activeArticleId, setActiveArticleId] = useState<string | null>(null);

  // Column Visibility Controls
  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>({
    title: true,
    status: true,
    priority: true,
    authors: true,
    year: true,
    journal: true,
    doi: true,
    pmid: true,
  });
  const [colDropdownOpen, setColDropdownOpen] = useState(false);

  // Queries
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, refetch } =
    api.article.list.useInfiniteQuery(
      {
        projectId,
        reviewStatus: reviewFilter,
        importStatus: importFilter,
        priority: priorityFilter,
        search: search || undefined,
        sortBy,
        sortDirection,
        limit: 50,
      },
      {
        getNextPageParam: (lastPage) => lastPage.nextCursor,
      }
    );

  const allArticles = data?.pages.flatMap((p) => p.articles) ?? [];

  // Mutations
  const bulkDecisionMutation = api.article.bulkDecision.useMutation({
    onSuccess: () => {
      void utils.article.list.invalidate();
      void utils.article.getCounts.invalidate();
      setSelectedIds(new Set());
    },
  });

  const deleteArticlesMutation = api.article.deleteMany.useMutation({
    onSuccess: () => {
      void utils.article.list.invalidate();
      void utils.article.getCounts.invalidate({ projectId });
      setSelectedIds(new Set());
    },
  });

  const handleDeleteArticles = () => {
    if (selectedIds.size === 0) return;
    if (confirm(`Are you sure you want to permanently delete the ${selectedIds.size} selected article(s) from this project?`)) {
      deleteArticlesMutation.mutate({
        articleIds: Array.from(selectedIds),
      });
    }
  };

  const handleSearch = useCallback(() => {
    setSearch(searchInput);
  }, [searchInput]);

  const handleSort = (field: typeof sortBy) => {
    if (sortBy === field) {
      // Toggle direction
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(field);
      setSortDirection("desc");
    }
  };

  const handleExportCSV = () => {
    window.location.href = `/api/project/${projectId}/export`;
  };

  // Selection helpers
  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedIds(new Set(allArticles.map((a) => a.id)));
    } else {
      setSelectedIds(new Set());
    }
  };

  const handleSelectRow = (e: React.ChangeEvent<HTMLInputElement>, id: string) => {
    e.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (e.target.checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  };

  const handleBulkDecision = (decision?: ReviewStatus, priority?: Priority) => {
    if (selectedIds.size === 0) return;
    bulkDecisionMutation.mutate({
      articleIds: Array.from(selectedIds),
      decision,
      priority,
    });
  };

  // Tabs definitions
  const reviewTabs: { key: ReviewStatus | undefined; label: string }[] = [
    { key: undefined, label: "All Reviews" },
    { key: "PENDING", label: "Pending" },
    { key: "INCLUDED", label: "Included" },
    { key: "EXCLUDED", label: "Excluded" },
    { key: "MAYBE", label: "Maybe" },
  ];

  const importTabs: { key: ImportStatus | undefined; label: string }[] = [
    { key: undefined, label: "All Audit" },
    { key: "CONFLICT", label: "Conflicts" },
    { key: "LIKELY_DUPLICATE", label: "Duplicates" },
    { key: "IMPORTED_WARNING", label: "Warnings" },
    { key: "AUTO_CORRECTED", label: "Auto-Fixed" },
  ];

  const priorityTabs: { key: Priority | undefined; label: string }[] = [
    { key: undefined, label: "All Priority" },
    { key: "HIGH", label: "High" },
    { key: "MEDIUM", label: "Medium" },
    { key: "LOW", label: "Low" },
  ];

  return (
    <div>
      {/* Search and Filters Bar */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 20 }}>
        {/* Row 1: Search, Column Visibility Dropdown */}
        <div style={{ display: "flex", gap: 12, width: "100%", flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ display: "flex", gap: 6, flex: 1, minWidth: 280 }}>
            <input
              className="input"
              style={{ padding: "8px 14px", height: 38 }}
              placeholder="Search title, authors..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            />
            <button className="btn btn-secondary btn-sm" onClick={handleSearch} style={{ height: 38 }}>
              Search
            </button>
            {search && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setSearch("");
                  setSearchInput("");
                }}
                style={{ height: 38 }}
              >
                Clear
              </button>
            )}
          </div>

          {/* Export and Column Controls */}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="btn btn-secondary btn-sm"
              style={{ height: 38, cursor: "pointer" }}
              disabled={allArticles.length === 0}
              onClick={handleExportCSV}
            >
              Export CSV
            </button>
            <div style={{ position: "relative" }}>
              <button
                className="btn btn-secondary btn-sm"
                style={{ height: 38, cursor: "pointer" }}
                onClick={() => setColDropdownOpen(!colDropdownOpen)}
              >
                Columns
              </button>
              {colDropdownOpen && (
                <div
                  style={{
                    position: "absolute",
                    right: 0,
                    top: 42,
                    zIndex: 40,
                    background: "var(--bg-elevated)",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: "var(--radius-max)",
                    padding: 12,
                    width: 180,
                    boxShadow: "0 10px 30px rgba(0,0,0,0.6)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  <div className="label-uppercase" style={{ fontSize: 10, borderBottom: "1px solid var(--border-subtle)", paddingBottom: 6 }}>Toggle Columns</div>
                  {Object.keys(visibleColumns).map((col) => (
                    <label key={col} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={visibleColumns[col]!}
                        onChange={(e) =>
                          setVisibleColumns((prev) => ({
                            ...prev,
                            [col]: e.target.checked,
                          }))
                        }
                        style={{ accentColor: "var(--text-primary)" }}
                      />
                      <span style={{ textTransform: "capitalize" }}>{col}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Row 2: Tabs Filter Panels */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {/* Review Filter */}
          <div className="tab-list">
            {reviewTabs.map(({ key, label }) => {
              const count = key ? (reviewStatMap[key] ?? 0) : Object.values(reviewStatMap).reduce((a, b) => a + b, 0);
              return (
                <button
                  key={label}
                  className={`tab-item ${reviewFilter === key ? "active" : ""}`}
                  onClick={() => setReviewFilter(key)}
                  style={{ cursor: "pointer" }}
                >
                  {label}
                  {count > 0 && <span className="tab-count">{count}</span>}
                </button>
              );
            })}
          </div>

          {/* Priority Filter */}
          <div className="tab-list">
            {priorityTabs.map(({ key, label }) => (
              <button
                key={label}
                className={`tab-item ${priorityFilter === key ? "active" : ""}`}
                onClick={() => setPriorityFilter(key)}
                style={{ cursor: "pointer" }}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Import Quality Filter */}
          {Object.values(importStatMap).some((c) => c > 0) && (
            <div className="tab-list">
              {importTabs.map(({ key, label }) => {
                const count = key ? (importStatMap[key] ?? 0) : undefined;
                if (key && count === 0) return null;
                return (
                  <button
                    key={label}
                    className={`tab-item ${importFilter === key ? "active" : ""}`}
                    onClick={() => setImportFilter(key)}
                    style={{ cursor: "pointer" }}
                  >
                    {label}
                    {count !== undefined && count > 0 && <span className="tab-count">{count}</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Bulk Actions Panel (Displays only if row selection exists) */}
      {selectedIds.size > 0 && (
        <div
          className="alert alert-info bulk-actions-panel"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 16,
            borderRadius: "var(--radius-max)",
            padding: "10px 16px",
            background: "var(--bg-elevated)",
            borderColor: "var(--border-active)",
            animation: "slide-up 150ms ease-out",
          }}
        >
          <div style={{ fontSize: 13.5, color: "var(--text-primary)", fontWeight: 600 }}>
            {selectedIds.size} article{selectedIds.size > 1 ? "s" : ""} selected
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 11, textTransform: "uppercase", color: "var(--text-muted)", fontWeight: 700 }}>Bulk Actions:</span>
            <button className="btn btn-secondary btn-sm" onClick={() => handleBulkDecision("INCLUDED")} style={{ padding: "4px 10px" }}>Include</button>
            <button className="btn btn-secondary btn-sm" onClick={() => handleBulkDecision("EXCLUDED")} style={{ padding: "4px 10px" }}>Exclude</button>
            <button className="btn btn-secondary btn-sm" onClick={() => handleBulkDecision("MAYBE")} style={{ padding: "4px 10px" }}>Maybe</button>
            <div style={{ height: 16, width: 1, background: "var(--border-subtle)" }} />
            <button className="btn btn-secondary btn-sm" onClick={() => handleBulkDecision(undefined, "HIGH")} style={{ padding: "4px 10px" }}>Set High</button>
            <button className="btn btn-secondary btn-sm" onClick={() => handleBulkDecision(undefined, "MEDIUM")} style={{ padding: "4px 10px" }}>Set Med</button>
            <button className="btn btn-secondary btn-sm" onClick={() => handleBulkDecision(undefined, "LOW")} style={{ padding: "4px 10px" }}>Set Low</button>
            <div style={{ height: 16, width: 1, background: "var(--border-subtle)" }} />
            {isProjectManager && (
              <>
                <button className="btn btn-danger btn-sm" onClick={handleDeleteArticles} style={{ padding: "4px 10px" }}>Delete</button>
                <div style={{ height: 16, width: 1, background: "var(--border-subtle)" }} />
              </>
            )}
            <button className="btn btn-ghost btn-sm" onClick={() => setSelectedIds(new Set())} style={{ padding: "4px 10px", color: "var(--text-primary)" }}>Clear</button>
          </div>
        </div>
      )}

      {/* Main Dense Table Grid */}
      {isLoading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 80 }}>
          <div className="spinner" style={{ width: 24, height: 24 }} />
        </div>
      ) : allArticles.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
            </svg>
          </div>
          <h3>No Citations</h3>
          <p>{search ? `No articles match query "${search}"` : "Import a dataset to begin reviewing academic papers."}</p>
        </div>
      ) : (
        <>
          <div className="table-container table-sticky-col">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 40, textAlign: "center" }}>
                    <input
                      type="checkbox"
                      checked={selectedIds.size === allArticles.length && allArticles.length > 0}
                      onChange={handleSelectAll}
                      style={{ cursor: "pointer", accentColor: "var(--text-primary)" }}
                    />
                  </th>
                  {visibleColumns.title && (
                    <th onClick={() => handleSort("title")} style={{ cursor: "pointer", userSelect: "none" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        Title <SortIcon active={sortBy === "title"} direction={sortDirection} />
                      </div>
                    </th>
                  )}
                  {visibleColumns.status && (
                    <th onClick={() => handleSort("reviewStatus")} style={{ width: 100, cursor: "pointer", userSelect: "none" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        Status <SortIcon active={sortBy === "reviewStatus"} direction={sortDirection} />
                      </div>
                    </th>
                  )}
                  {visibleColumns.priority && (
                    <th onClick={() => handleSort("priority")} style={{ width: 100, cursor: "pointer", userSelect: "none" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        Priority <SortIcon active={sortBy === "priority"} direction={sortDirection} />
                      </div>
                    </th>
                  )}
                  {visibleColumns.authors && <th style={{ width: 140 }}>Authors</th>}
                  {visibleColumns.year && (
                    <th onClick={() => handleSort("pubYear")} style={{ width: 80, cursor: "pointer", userSelect: "none" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        Year <SortIcon active={sortBy === "pubYear"} direction={sortDirection} />
                      </div>
                    </th>
                  )}
                  {visibleColumns.journal && (
                    <th onClick={() => handleSort("journal")} style={{ width: 130, cursor: "pointer", userSelect: "none" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        Journal <SortIcon active={sortBy === "journal"} direction={sortDirection} />
                      </div>
                    </th>
                  )}
                  {visibleColumns.doi && <th style={{ width: 130 }}>DOI</th>}
                  {visibleColumns.pmid && <th style={{ width: 100 }}>PMID</th>}
                </tr>
              </thead>
              <tbody>
                {allArticles.map((article) => {
                  const isSelected = selectedIds.has(article.id);
                  const statusLabel = article.reviewStatus === "PENDING" ? "Pending" : article.reviewStatus === "INCLUDED" ? "Included" : article.reviewStatus === "EXCLUDED" ? "Excluded" : "Maybe";
                  const statusClass = article.reviewStatus.toLowerCase();
                  const priorityClass = article.priority.toLowerCase();

                  return (
                    <tr
                      key={article.id}
                      className={isSelected ? "selected" : ""}
                      onClick={() => setActiveArticleId(article.id)}
                      style={{ cursor: "pointer" }}
                    >
                      <td style={{ textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => handleSelectRow(e, article.id)}
                          style={{ cursor: "pointer", accentColor: "var(--text-primary)" }}
                        />
                      </td>
                      {visibleColumns.title && (
                        <td style={{ fontWeight: 500, color: "var(--text-primary)" }}>
                          <div
                            style={{
                              display: "-webkit-box",
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: "vertical",
                              overflow: "hidden",
                              lineHeight: 1.4,
                              maxWidth: 380,
                            }}
                          >
                            {article.title ?? <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>Untitled Citation</span>}
                          </div>
                        </td>
                      )}
                      {visibleColumns.status && (
                        <td>
                          <span className={`badge badge-${statusClass}`}>{statusLabel}</span>
                        </td>
                      )}
                      {visibleColumns.priority && (
                        <td>
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 700,
                              textTransform: "uppercase",
                              letterSpacing: "0.06em",
                              color: article.priority === "HIGH" ? "var(--text-primary)" : article.priority === "MEDIUM" ? "var(--text-secondary)" : "var(--text-muted)",
                              borderBottom: article.priority === "HIGH" ? "1px solid var(--border-active)" : "none",
                              paddingBottom: 2,
                            }}
                          >
                            {article.priority}
                          </span>
                        </td>
                      )}
                      {visibleColumns.authors && (
                        <td style={{ color: "var(--text-secondary)", fontSize: 13 }}>
                          <div className="truncate" style={{ maxWidth: 130 }} title={article.authors ?? ""}>
                            {article.firstAuthor ?? article.authors?.split(";")[0]?.trim() ?? "—"}
                          </div>
                        </td>
                      )}
                      {visibleColumns.year && <td style={{ fontFamily: "monospace" }}>{article.pubYear ?? "—"}</td>}
                      {visibleColumns.journal && (
                        <td>
                          <div className="truncate" style={{ maxWidth: 120 }} title={article.journal ?? ""}>
                            {article.journal ?? "—"}
                          </div>
                        </td>
                      )}
                      {visibleColumns.doi && (
                        <td>
                          <div className="truncate" style={{ maxWidth: 120 }} title={article.doi ?? ""}>
                            {article.doi ? (
                              <a href={`https://doi.org/${article.doi}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: "var(--text-muted)", textDecoration: "underline" }}>
                                {article.doi}
                              </a>
                            ) : (
                              "—"
                            )}
                          </div>
                        </td>
                      )}
                      {visibleColumns.pmid && (
                        <td>
                          {article.pmid ? (
                            <a href={`https://pubmed.ncbi.nlm.nih.gov/${article.pmid}/`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ fontFamily: "monospace", color: "var(--text-muted)" }}>
                              {article.pmid}
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination Load More */}
          {hasNextPage && (
            <div style={{ textAlign: "center", marginTop: 24 }}>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => void fetchNextPage()}
                disabled={isFetchingNextPage}
              >
                {isFetchingNextPage ? <span className="spinner" /> : "Load More Citations"}
              </button>
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text-muted)", marginTop: 12, alignItems: "center" }}>
            <div>
              {selectedIds.size > 0 ? `${selectedIds.size} of ` : ""}
              {allArticles.length} citation{allArticles.length !== 1 ? "s" : ""} rendered
            </div>
          </div>
        </>
      )}

      {/* Slide-over Review Drawer */}
      {activeArticleId && (
        <ArticleReviewPanel
          articleId={activeArticleId}
          onClose={() => setActiveArticleId(null)}
          onSaveSuccess={() => {
            setActiveArticleId(null);
            void refetch();
          }}
        />
      )}
    </div>
  );
}
