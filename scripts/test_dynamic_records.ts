import { DynamicRecordsService } from "../src/records/dynamicRecordsService.js";
import { DbClient } from "../src/database/dbClient.js";

async function main() {
  console.log("[Test] Testing DynamicRecordsService...");
  const records = new DynamicRecordsService();

  // Seed test operating account in treasury_accounts
  await DbClient.query(`
    INSERT INTO treasury_accounts (account_id, name, role, wallet_address, min_operating_floor_usdc)
    VALUES ('OPEX_DEV', 'Dev Ops Pool', 'OPEX_DEV', '0x9999999999999999999999999999999999999999', 500.000000)
    ON CONFLICT (account_id) DO NOTHING;
  `);

  // 1. Add Dynamic Liability (Record 1)
  const lia = await records.upsertLiability({
    accountId: "OPEX_DEV",
    vendorId: "VEND-AWS-01",
    title: "AWS Cloud Services Bill - October 2026",
    amountUsdc: "12500.000000",
    payoutAddress: "0x1111111111111111111111111111111111111111",
    dueDate: new Date(Date.now() + 3 * 86400 * 1000), // Due in 3 days
    frequency: "MONTHLY",
    documentHash: "0x7fa26a310c812d87e0ef6b7bfa9c3e981f211320ef2294101e1dc59c4059a4bb",
    poReference: "PO-2026-AWS-01",
    status: "SCHEDULED",
  });
  console.log(`[Test] Upserted Liability: ${lia.liabilityId}, ${lia.title}, Amount: ${lia.amountUsdc} USDC`);

  // 2. Fetch Tripartite Balance
  const tripartite = await records.getTripartiteBalance("OPEX_DEV", 100000000000n, 50000000000n);
  console.log(`[Test] Tripartite Balance:`);
  console.log(` - Liquid: ${tripartite.liquidCashUsdc} USDC`);
  console.log(` - Invested: ${tripartite.investedYieldUsdc} USDC`);
  console.log(` - Available: ${tripartite.availableBalanceUsdc} USDC`);
  console.log(` - Invariant check: ${tripartite.invariantSatisfied}`);

  // 3. Calculate Safe-to-Invest (Record 2)
  const sti = await records.calculateSafeToInvest("OPEX_DEV", 7 * 86400, "20000.000000", 100000000000n, 50000000000n);
  console.log(`[Test] Dynamic Safe-to-Invest (Record 2):`);
  console.log(` - Upcoming Liabilities (within 7d): ${sti.upcomingLiabilitiesTotalUsdc} USDC`);
  console.log(` - Target Reserve: ${sti.targetReserveUsdc} USDC`);
  console.log(` - Safe-to-Invest: ${sti.safeToInvestUsdc} USDC`);
  console.log(` - Status: ${sti.status}`);

  // 100,000 Liquid - (12,500 AWS + 20,000 Reserve) = 67,500.000000 USDC Safe to Invest
  if (sti.safeToInvestUsdc !== "67500.000000") {
    throw new Error(`Expected safe to invest 67500.000000, got ${sti.safeToInvestUsdc}`);
  }

  console.log("[Test] Dynamic Records & Invariants verified successfully!");
  await DbClient.closePool();
}

main().catch(async (err) => {
  console.error("[Test] Error:", err);
  await DbClient.closePool();
  process.exit(1);
});
