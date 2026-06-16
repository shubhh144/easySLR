/**
 * SEED SCRIPT — Development only
 *
 * Populates the database with Hopkins Lab organization, Cancer/Diabetes Research projects,
 * three role-based test users (owner, manager, reviewer), and sample articles with audit trails.
 *
 * Usage:  npm run db:seed
 * Reset:  npm run db:reset-demo
 */

import { PrismaClient } from "../generated/prisma/index.js";

const db = new PrismaClient();

async function main() {
  // ── Production Safeguard ────────────────────────────────────────────────
  const databaseUrl = process.env.DATABASE_URL ?? "";
  const isProduction =
    (process.env.NODE_ENV === "production" ||
      databaseUrl.includes("aws") ||
      databaseUrl.includes("rds") ||
      databaseUrl.includes("supabase") ||
      databaseUrl.includes("prod")) &&
    !process.argv.includes("--force");

  if (isProduction) {
    console.error("❌ CRITICAL ERROR: Seeding and database resets are blocked in production environments!");
    console.error("💡 If you are seeding a development/testing Supabase database, run: npm run db:seed -- --force");
    process.exit(1);
  }

  // ── 1. Handle Wiping / Resetting ──────────────────────────────────────────
  if (process.argv.includes("--reset")) {
    console.log("🧹 Wiping local development database...");
    
    // Delete in correct order to resolve foreign keys
    await db.importRowResult.deleteMany({});
    await db.importBatch.deleteMany({});
    await db.article.deleteMany({});
    await db.projectMember.deleteMany({});
    await db.project.deleteMany({});
    await db.organizationMember.deleteMany({});
    await db.organization.deleteMany({});
    await db.session.deleteMany({});
    await db.account.deleteMany({});
    await db.user.deleteMany({});
    
    console.log("✓ Database wiped successfully.\n");
  }

  console.log("🌱 Seeding development database for EasySLR authorization testing...");

  // ── 2. Create Users ──────────────────────────────────────────────────────
  const owner = await db.user.upsert({
    where: { email: "owner@easyslr.test" },
    update: {},
    create: {
      email: "owner@easyslr.test",
      name: "Dr. Rachel Green (Owner)",
      emailVerified: new Date(),
    },
  });

  const manager = await db.user.upsert({
    where: { email: "manager@easyslr.test" },
    update: {},
    create: {
      email: "manager@easyslr.test",
      name: "Dr. Ross Geller (Manager)",
      emailVerified: new Date(),
    },
  });

  const reviewer = await db.user.upsert({
    where: { email: "reviewer@easyslr.test" },
    update: {},
    create: {
      email: "reviewer@easyslr.test",
      name: "Monica Geller (Reviewer)",
      emailVerified: new Date(),
    },
  });

  console.log("✓ Test users seeded (Owner, Manager, Reviewer)");


  // ── 4. Create Organization ────────────────────────────────────────────────
  const org = await db.organization.create({
    data: {
      name: "Hopkins Lab",
      slug: "hopkins-lab",
    },
  });

  // Assign Org Owner
  await db.organizationMember.create({
    data: {
      organizationId: org.id,
      userId: owner.id,
      role: "OWNER",
    },
  });

  // Assign Managers and Reviewers as Regular Org Members
  await db.organizationMember.create({
    data: {
      organizationId: org.id,
      userId: manager.id,
      role: "MEMBER",
    },
  });

  await db.organizationMember.create({
    data: {
      organizationId: org.id,
      userId: reviewer.id,
      role: "MEMBER",
    },
  });

  console.log(`✓ Organization '${org.name}' created with roles assigned`);

  // ── 5. Create Projects ────────────────────────────────────────────────────
  const cancerProj = await db.project.create({
    data: {
      organizationId: org.id,
      name: "Cancer Research",
      description: "Evaluating immunotherapies and targeted therapies for BRAF-mutant melanoma.",
      createdById: owner.id,
    },
  });

  const diabetesProj = await db.project.create({
    data: {
      organizationId: org.id,
      name: "Diabetes Research",
      description: "Reviewing SGLT2 inhibitors and GLP-1 receptor agonists clinical outcomes.",
      createdById: owner.id,
    },
  });

  console.log("✓ Projects created: 'Cancer Research' & 'Diabetes Research'");

  // ── 6. Assign Project Memberships ─────────────────────────────────────────
  // Manager memberships
  await db.projectMember.create({
    data: { projectId: cancerProj.id, userId: manager.id, role: "MANAGER" },
  });
  await db.projectMember.create({
    data: { projectId: diabetesProj.id, userId: manager.id, role: "MANAGER" },
  });

  // Reviewer memberships
  await db.projectMember.create({
    data: { projectId: cancerProj.id, userId: reviewer.id, role: "REVIEWER" },
  });
  await db.projectMember.create({
    data: { projectId: diabetesProj.id, userId: reviewer.id, role: "REVIEWER" },
  });

  console.log("✓ Project roles assigned (Managers & Reviewers linked to projects)");

  // ── 7. Seed Sample Articles & Import History ──────────────────────────────
  // We seed an ImportBatch for Cancer Research
  const cancerBatch = await db.importBatch.create({
    data: {
      projectId: cancerProj.id,
      userId: manager.id,
      fileName: "melanoma_clinical_trials_2024.xlsx",
      fileSize: 15420,
      totalRows: 2,
      importedCount: 2,
      autoCorrectedCount: 0,
      importedWithWarningCount: 0,
      possibleMatchCount: 0,
      likelyDuplicateCount: 0,
      conflictCount: 0,
      status: "COMPLETED",
    },
  });

  const cancerArt1 = await db.article.create({
    data: {
      projectId: cancerProj.id,
      pmid: "38910001",
      doi: "10.1200/JCO.2023.01.001",
      title: "Immunotherapy advances in metastatic melanoma",
      authors: "Smith J, Doe A, Miller K",
      firstAuthor: "Smith J",
      journal: "Journal of Clinical Oncology",
      pubYear: 2023,
      priority: "HIGH",
      reviewStatus: "PENDING",
    },
  });

  const cancerArt2 = await db.article.create({
    data: {
      projectId: cancerProj.id,
      pmid: "38910002",
      doi: "10.1200/JCO.2023.01.002",
      title: "Targeted therapy vs immunotherapy in BRAF-mutant melanoma",
      authors: "Johnson R, Davis L, Garcia M",
      firstAuthor: "Johnson R",
      journal: "Journal of Clinical Oncology",
      pubYear: 2023,
      priority: "MEDIUM",
      reviewStatus: "INCLUDED",
      reviewedById: reviewer.id,
      reviewedAt: new Date(),
    },
  });

  // Seed ImportRowResults for audit logs
  await db.importRowResult.create({
    data: {
      batchId: cancerBatch.id,
      articleId: cancerArt1.id,
      rowIndex: 1,
      finalStatus: "IMPORTED",
      decidingRule: "CLEAN_IMPORT",
      originalData: { title: cancerArt1.title, pmid: cancerArt1.pmid },
      explanation: "Row passed all data-integrity checks and was imported cleanly.",
    },
  });

  await db.importRowResult.create({
    data: {
      batchId: cancerBatch.id,
      articleId: cancerArt2.id,
      rowIndex: 2,
      finalStatus: "IMPORTED",
      decidingRule: "CLEAN_IMPORT",
      originalData: { title: cancerArt2.title, pmid: cancerArt2.pmid },
      explanation: "Row passed all data-integrity checks and was imported cleanly.",
    },
  });

  // We seed an ImportBatch for Diabetes Research
  const diabetesBatch = await db.importBatch.create({
    data: {
      projectId: diabetesProj.id,
      userId: manager.id,
      fileName: "diabetes_sglt2_glp1_trials.xlsx",
      fileSize: 18240,
      totalRows: 2,
      importedCount: 2,
      autoCorrectedCount: 0,
      importedWithWarningCount: 0,
      possibleMatchCount: 0,
      likelyDuplicateCount: 0,
      conflictCount: 0,
      status: "COMPLETED",
    },
  });

  const diabetesArt1 = await db.article.create({
    data: {
      projectId: diabetesProj.id,
      pmid: "38920001",
      doi: "10.1056/NEJMoa1705722",
      title: "SGLT2 inhibitors and cardiovascular outcomes in type 2 diabetes",
      authors: "Neal B, Perkovic V, Mahaffey KW",
      firstAuthor: "Neal B",
      journal: "New England Journal of Medicine",
      pubYear: 2017,
      priority: "HIGH",
      reviewStatus: "PENDING",
    },
  });

  const diabetesArt2 = await db.article.create({
    data: {
      projectId: diabetesProj.id,
      pmid: "38920002",
      doi: "10.1056/NEJMoa2032183",
      title: "GLP-1 receptor agonists in obesity and diabetes management",
      authors: "Wilding JPH, Batterham RL, Calanna S",
      firstAuthor: "Wilding JPH",
      journal: "New England Journal of Medicine",
      pubYear: 2021,
      priority: "LOW",
      reviewStatus: "EXCLUDED",
      reviewedById: reviewer.id,
      reviewedAt: new Date(),
    },
  });

  // Seed Row Results
  await db.importRowResult.create({
    data: {
      batchId: diabetesBatch.id,
      articleId: diabetesArt1.id,
      rowIndex: 1,
      finalStatus: "IMPORTED",
      decidingRule: "CLEAN_IMPORT",
      originalData: { title: diabetesArt1.title, pmid: diabetesArt1.pmid },
      explanation: "Row passed all data-integrity checks and was imported cleanly.",
    },
  });

  await db.importRowResult.create({
    data: {
      batchId: diabetesBatch.id,
      articleId: diabetesArt2.id,
      rowIndex: 2,
      finalStatus: "IMPORTED",
      decidingRule: "CLEAN_IMPORT",
      originalData: { title: diabetesArt2.title, pmid: diabetesArt2.pmid },
      explanation: "Row passed all data-integrity checks and was imported cleanly.",
    },
  });

  console.log("✓ Sample articles and import batches seeded for both projects");

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚀  Seed complete! Your sandboxed testing environment is ready.

    Hopkins Lab Organization ID: ${org.slug}
    
    Users & Test Logins:
    1. Org Owner:   owner@easyslr.test
    2. Manager:     manager@easyslr.test
    3. Reviewer:    reviewer@easyslr.test
    
    To log in, run the local dev server and open:
    http://localhost:3000/auth/signin
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  `);
}

main()
  .catch((e) => {
    console.error("❌ Seeding failed!");
    console.error(e);
  })
  .finally(() => db.$disconnect());
