import { PolicyLoader } from "../src/config/policyLoader.js";
import { TreasuryAccountsRepo } from "../src/database/repos/treasuryAccountsRepo.js";
import { LiabilityRepo } from "../src/database/repos/liabilityRepo.js";
import { MasterJournalRepo } from "../src/database/repos/masterJournalRepo.js";
import { YieldOptimizerService } from "../src/services/yieldOptimizerService.js";
import { CentralTreasuryYieldVaultService } from "../src/contracts/centralTreasuryYieldVaultService.js";
import { DbClient } from "../src/database/dbClient.js";

async function runAuditTests() {
  console.log("==================================================");
  console.log("  D0 REAL WORLD AUDIT TESTS (E2E against DB)");
  console.log("==================================================");

  let pass = 0;
  let fail = 0;
  
  function assert(condition: boolean, label: string) {
    if (condition) {
      console.log(`  ✓ ${label}`);
      pass++;
    } else {
      console.error(`  ✗ FAIL: ${label}`);
      fail++;
    }
  }

  // 1. Setup Phase
  console.log("\n[Setup] Initializing Database & Clearing Tables...");
  await DbClient.query("TRUNCATE TABLE master_system_journal CASCADE");
  await DbClient.query("TRUNCATE TABLE account_liabilities CASCADE");
  await DbClient.query("TRUNCATE TABLE account_agent_audit_log CASCADE");
  await DbClient.query("TRUNCATE TABLE treasury_accounts CASCADE");

  const { profile } = PolicyLoader.getActiveProfile();
  
  // Create mock CentralTreasuryYieldVaultService
  const vaultAddr = "0xVAULT0000000000000000000000000000000001" as `0x${string}`;
  const vaultService = new CentralTreasuryYieldVaultService(vaultAddr);
  const optimizer = new YieldOptimizerService(vaultService);

  // Insert Accounts
  console.log("[Setup] Provisioning Accounts from Policy...");
  for (const acc of profile.operating_accounts) {
    await TreasuryAccountsRepo.upsertAccount({
      account_id: acc.account_id,
      name: acc.name,
      role: acc.role,
      wallet_address: `0x${acc.account_id.length.toString().padStart(40, "1")}` as `0x${string}`,
      chain_id: 5042002,
      min_operating_floor_usdc: acc.min_floor_usdc,
      safety_buffer_ratio: acc.safety_multiplier,
      is_active: true
    });
  }

  const engAcc = profile.operating_accounts.find((a) => a.account_id === "acc_engineering");
  if (!engAcc) throw new Error("Missing acc_engineering in profile");

  const payrollAcc = profile.operating_accounts.find((a) => a.account_id === "acc_payroll");
  if (!payrollAcc) throw new Error("Missing acc_payroll in profile");

  // 2. Test Scenario A: Safe to Invest Sweep
  console.log("\n[Test Scenario A] Revenue arrives → Sweep Triggered & Journaled");
  // Add a liability for engineering account within window
  await LiabilityRepo.createLiability({
    account_id: engAcc.account_id,
    vendor_id: "vendor_1",
    title: "Server Hosting",
    category: "INFRASTRUCTURE",
    amount_usdc: 100, // $100 liability
    due_date: new Date(Date.now() + 5 * 86400 * 1000), // Due in 5 days
    payout_address: "0x1111111111111111111111111111111111111111",
    status: "SCHEDULED"
  });

  // Evaluate with $500 balance
  const resA = await optimizer.evaluateAccount(engAcc.account_id, 500);
  const expectedTargetRes = (100 * engAcc.safety_multiplier) + engAcc.min_floor_usdc; // 100 * 1.2 + 50 = 170
  
  assert(Math.abs(resA.targetReserve - expectedTargetRes) < 0.01, `Target reserve correctly calculated: $${resA.targetReserve}`);
  assert(resA.action === "SWEEP", `Action is SWEEP`);
  assert(resA.safeToInvest === 320, `SafeToInvest is exactly 320 (500 - 170 - 10)`);
  assert(!!resA.encodedTx, `Encoded Tx generated for vault call`);

  // Verify DB Journaling
  const logsA = await DbClient.query("SELECT * FROM master_system_journal ORDER BY sequence_id DESC LIMIT 1");
  assert(logsA.rows.length === 1, "Journal entry was created");
  assert(logsA.rows[0].action_type === "AUTONOMOUS_SWEEP", "Journal entry action type is AUTONOMOUS_SWEEP");
  assert(Number(logsA.rows[0].amount_usdc) === 320, "Journal entry amount matches SafeToInvest");

  // 3. Test Scenario B: Balance Drops → Recall
  console.log("\n[Test Scenario B] Balance drops → Recall Triggered & Journaled");
  const resB = await optimizer.evaluateAccount(engAcc.account_id, 100); // 100 < 170 - 5 (recall band) -> 100 < 165 -> RECALL
  assert(resB.action === "RECALL", "Action is RECALL");
  assert(resB.actionAmountUsdc === 70, `Recall amount is exactly $70 to hit target reserve (170 - 100)`);
  
  const logsB = await DbClient.query("SELECT * FROM master_system_journal ORDER BY sequence_id DESC LIMIT 1");
  assert(logsB.rows[0].action_type === "AUTONOMOUS_RECALL", "Journal entry action type is AUTONOMOUS_RECALL");

  // 4. Test Scenario C: Payroll account is protected
  console.log("\n[Test Scenario C] Payroll protected account avoids sweep");
  const resC = await optimizer.evaluateAccount(payrollAcc.account_id, 500000);
  assert(resC.action === "NONE", "Payroll account returned NONE action despite huge balance");
  assert(resC.safeToInvest === 0, "SafeToInvest overridden to 0 for protected account");

  console.log("\n==================================================");
  console.log(`  SUMMARY: ${pass} passed, ${fail} failed`);
  console.log("==================================================");
  
  process.exit(fail > 0 ? 1 : 0);
}

runAuditTests().catch(console.error);
