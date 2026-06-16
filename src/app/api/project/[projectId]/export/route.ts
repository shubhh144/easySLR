import { type NextRequest } from "next/server";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { assertProjectAccess } from "~/server/api/auth-helpers";
import { TRPCError } from "@trpc/server";

export async function GET(
  req: NextRequest,
  props: { params: Promise<{ projectId: string }> }
) {
  const params = await props.params;
  const projectId = params.projectId;

  // 1. Verify Session
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  // 2. Verify Authorization Scope
  try {
    await assertProjectAccess(db, session.user.id, projectId);
  } catch (e) {
    if (e instanceof TRPCError) {
      if (e.code === "NOT_FOUND") {
        return new Response("Project Not Found", { status: 404 });
      }
      return new Response("Forbidden: " + e.message, { status: 403 });
    }
    return new Response("Internal Authorization Error", { status: 500 });
  }

  // 3. Fetch All Project Articles
  const articles = await db.article.findMany({
    where: { projectId },
    include: {
      reviewedBy: {
        select: {
          name: true,
          email: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // 4. Generate CSV String
  const headers = [
    "ID",
    "PMID",
    "DOI",
    "PMCID",
    "NIHMSID",
    "Title",
    "Authors",
    "First Author",
    "Journal",
    "Publication Year",
    "Priority",
    "Import Status",
    "Review Status",
    "Review Note",
    "Reviewed By Name",
    "Reviewed By Email",
    "Reviewed At",
    "Created At",
    "Updated At",
  ];

  const escapeCSV = (str: string | number | null | undefined): string => {
    if (str === null || str === undefined) return "";
    const value = String(str).replace(/"/g, '""');
    if (
      value.includes(",") ||
      value.includes('"') ||
      value.includes("\n") ||
      value.includes("\r")
    ) {
      return `"${value}"`;
    }
    return value;
  };

  const rows = articles.map((art) => [
    escapeCSV(art.id),
    escapeCSV(art.pmid),
    escapeCSV(art.doi),
    escapeCSV(art.pmcid),
    escapeCSV(art.nihmsId),
    escapeCSV(art.title),
    escapeCSV(art.authors),
    escapeCSV(art.firstAuthor),
    escapeCSV(art.journal),
    escapeCSV(art.pubYear),
    escapeCSV(art.priority),
    escapeCSV(art.importStatus),
    escapeCSV(art.reviewStatus),
    escapeCSV(art.reviewNote),
    escapeCSV(art.reviewedBy?.name),
    escapeCSV(art.reviewedBy?.email),
    escapeCSV(art.reviewedAt ? art.reviewedAt.toISOString() : ""),
    escapeCSV(art.createdAt.toISOString()),
    escapeCSV(art.updatedAt.toISOString()),
  ]);

  const csvContent = [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");

  // 5. Send CSV Attachment Response
  return new Response(csvContent, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="easyslr_project_${projectId}_export.csv"`,
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}
