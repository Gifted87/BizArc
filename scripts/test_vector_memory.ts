import { VectorMemoryService } from "../src/memory/vectorMemoryService.js";
import { DbClient } from "../src/database/dbClient.js";

async function main() {
  console.log("[Test] Testing VectorMemoryService with PostgreSQL pgvector...");
  const service = new VectorMemoryService();
  await service.seedEnterpriseTruth();
  console.log("[Test] Enterprise documents seeded successfully into pgvector.");

  const results = await service.queryRelevantMemory(
    "Amazon Web Services cloud compute invoice payment address",
    ["msas", "erp_pos"],
    3
  );

  console.log(`[Test] Retrieved ${results.length} relevant memory matches:`);
  for (const r of results) {
    console.log(` - [${r.collection}] ${r.title} (similarity: ${r.similarity.toFixed(4)})`);
  }

  if (results.length === 0) {
    throw new Error("No memory results found");
  }

  console.log("[Test] pgvector HNSW query verified successfully!");
  await DbClient.closePool();
}

main().catch(async (err) => {
  console.error("[Test] Error:", err);
  await DbClient.closePool();
  process.exit(1);
});
