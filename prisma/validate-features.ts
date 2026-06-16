import { PrismaClient } from "../generated/prisma/index.js";
import { appRouter } from "../src/server/api/root.js";

const db = new PrismaClient();

async function main() {
  console.log("=== STARTING FEATURE VALIDATION ===");

  // 1. Find the owner user and the Hopkins Lab organization
  const owner = await db.user.findUnique({
    where: { email: "owner@easyslr.test" },
  });
  if (!owner) {
    throw new Error("Owner user not found. Please run seed first.");
  }

  const org = await db.organization.findUnique({
    where: { slug: "hopkins-lab" },
  });
  if (!org) {
    throw new Error("Organization 'hopkins-lab' not found.");
  }

  console.log(`Using owner: ${owner.name} (${owner.email})`);
  console.log(`Using organization: ${org.name} (id: ${org.id})`);

  // Create mock tRPC context for the owner
  const mockCtx = {
    db,
    session: {
      user: {
        id: owner.id,
        email: owner.email,
        name: owner.name,
      },
      expires: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    },
    headers: new Headers(),
  };

  const caller = appRouter.createCaller(mockCtx);

  // === FEATURE 1: Organization Invite Member Flow ===
  console.log("\n--- Testing Feature 1: Org Member Invitation ---");
  const inviteEmail = `colleague_${Date.now()}@easyslr.test`;
  const inviteName = "Dr. Joey Tribbiani";
  
  console.log(`Inviting ${inviteName} (${inviteEmail}) to organization...`);
  const inviteResult = await caller.organization.inviteMember({
    organizationId: org.id,
    email: inviteEmail,
    name: inviteName,
    role: "MEMBER",
  });
  console.log("Invitation procedure succeeded:", JSON.stringify(inviteResult, null, 2));

  // Verify database record
  const invitedUser = await db.user.findUnique({
    where: { email: inviteEmail },
    include: {
      orgMemberships: true,
    },
  });
  if (!invitedUser || invitedUser.name !== inviteName) {
    throw new Error("Failed to verify invited user in database.");
  }
  const hasOrgMembership = invitedUser.orgMemberships.some(m => m.organizationId === org.id);
  if (!hasOrgMembership) {
    throw new Error("Invited user is not associated with the organization.");
  }
  console.log("✓ Verified: Invited member successfully created in database with correct name and org membership.");

  // === FEATURE 2: Add Org Member to Project ===
  console.log("\n--- Testing Feature 2: Add Member to Project ---");
  const cancerProj = await db.project.findFirst({
    where: { organizationId: org.id, name: "Cancer Research" },
  });
  if (!cancerProj) {
    throw new Error("Cancer Research project not found.");
  }
  console.log(`Adding invited member to project '${cancerProj.name}' as REVIEWER...`);
  const projectMemberResult = await caller.project.addMember({
    projectId: cancerProj.id,
    email: inviteEmail,
    role: "REVIEWER",
  });
  console.log("Project membership addition succeeded:", JSON.stringify(projectMemberResult, null, 2));

  // Verify in database
  const projMembership = await db.projectMember.findUnique({
    where: {
      projectId_userId: {
        projectId: cancerProj.id,
        userId: invitedUser.id,
      },
    },
  });
  if (!projMembership || projMembership.role !== "REVIEWER") {
    throw new Error("Failed to verify project membership in database.");
  }
  console.log("✓ Verified: Project member successfully added with correct role (REVIEWER).");

  // === FEATURE 3: Delete Batch Confirmation Modal ===
  console.log("\n--- Testing Feature 3: Delete Import Batch ---");
  const batch = await db.importBatch.findFirst({
    where: { projectId: cancerProj.id },
  });
  if (!batch) {
    throw new Error("Import batch for Cancer Research not found.");
  }
  console.log(`Found batch: ${batch.fileName} (id: ${batch.id})`);
  
  // Get impact
  const impact = await caller.import.getBatchImpact({ batchId: batch.id });
  console.log("Batch impact retrieved:", JSON.stringify(impact, null, 2));
  if (impact.totalArticles === 0) {
    throw new Error("Batch has 0 articles, cannot test deletion.");
  }

  // Delete batch using filename as confirmation
  console.log(`Deleting batch using confirmation text '${batch.fileName}'...`);
  const deleteBatchResult = await caller.import.deleteBatch({
    projectId: cancerProj.id,
    batchId: batch.id,
    confirmText: batch.fileName,
  });
  console.log("Delete batch succeeded:", JSON.stringify(deleteBatchResult, null, 2));

  // Verify deletion in database
  const deletedBatch = await db.importBatch.findUnique({ where: { id: batch.id } });
  if (deletedBatch) {
    throw new Error("Import batch still exists in database after delete.");
  }
  const rowResultsCount = await db.importRowResult.count({ where: { batchId: batch.id } });
  if (rowResultsCount > 0) {
    throw new Error("Import row results still exist in database.");
  }
  console.log("✓ Verified: Import batch and row results successfully deleted.");

  // === FEATURE 4: Clear Project Data ===
  console.log("\n--- Testing Feature 4: Clear Project Data ---");
  const diabetesProj = await db.project.findFirst({
    where: { organizationId: org.id, name: "Diabetes Research" },
  });
  if (!diabetesProj) {
    throw new Error("Diabetes Research project not found.");
  }
  console.log(`Clearing screening data for project '${diabetesProj.name}' (id: ${diabetesProj.id})...`);
  const clearResult = await caller.project.clearData({
    projectId: diabetesProj.id,
  });
  console.log("Clear data procedure succeeded:", JSON.stringify(clearResult, null, 2));

  // Verify in database
  const diabetesArticlesCount = await db.article.count({ where: { projectId: diabetesProj.id } });
  const diabetesBatchesCount = await db.importBatch.count({ where: { projectId: diabetesProj.id } });
  if (diabetesArticlesCount !== 0 || diabetesBatchesCount !== 0) {
    throw new Error(`Data not cleared. Articles: ${diabetesArticlesCount}, Batches: ${diabetesBatchesCount}`);
  }
  
  // Project itself must still exist
  const stillExists = await db.project.findUnique({ where: { id: diabetesProj.id } });
  if (!stillExists) {
    throw new Error("Project itself was deleted during clearData.");
  }
  console.log("✓ Verified: Project screening data completely cleared while preserving the project definition.");

  console.log("\n=== ALL FEATURES VALIDATED SUCCESSFULLY ===");
}

main()
  .catch((e) => {
    console.error("❌ Feature validation failed!");
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
