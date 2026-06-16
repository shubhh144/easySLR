import { createCallerFactory, createTRPCRouter } from "~/server/api/trpc";
import { organizationRouter } from "~/server/api/routers/organization";
import { projectRouter } from "~/server/api/routers/project";
import { importRouter } from "~/server/api/routers/import";
import { articleRouter } from "~/server/api/routers/article";
import { authRouter } from "~/server/api/routers/auth";

/**
 * The root tRPC router.
 * All sub-routers are mounted here.
 *
 * Procedure namespaces:
 *   api.auth.*          — Owner registration, verification
 *   api.organization.*  — org CRUD, member management
 *   api.project.*       — project CRUD, project membership
 *   api.import.*        — file analysis, import confirmation, batch history
 *   api.article.*       — article list, review decisions, counts
 */
export const appRouter = createTRPCRouter({
  auth: authRouter,
  organization: organizationRouter,
  project: projectRouter,
  import: importRouter,
  article: articleRouter,
});

export type AppRouter = typeof appRouter;

export const createCaller = createCallerFactory(appRouter);
