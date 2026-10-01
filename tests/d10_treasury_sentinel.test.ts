import { TreasurySentinelAgent, BalanceMutationEvent } from "../src/agents/treasurySentinelAgent.js";
import { LedgerWitnessAgent } from "../src/agents/ledgerWitnessAgent.js";
import { AccountIntelligenceService } from "../src/services/accountIntelligenceService.js";
import { CentralTreasuryYieldVaultService } from "../src/contracts/centralTreasuryYieldVaultService.js";
import { DbClient } from "../src/database/dbClient.js";
import { TreasuryAccountsRepo } from "../src/database/repos/treasuryAccountsRepo.js";
import { LiabilityRepo } from "../src/database/repos/liabilityRepo.js";
import { PermissionRequestRepo } from "../src/database/repos/permissionRequestRepo.js";
import { AuditLogRepo } from "../src/database/repos/auditLogRepo.js";
import { MasterJournalRepo } from "../src/database/repos/masterJournalRepo.js";
import { PolicyLoader } from "../src/config/policyLoader.js";

/**
 * COMPREHENSIVE REAL-WORLD TEST SUITE FOR D10:
 * TreasurySentinelAgent (Yield Optimizer & Dynamic Liquidity Operator)
 *
 * Verifies D10.1 (Event Ingestion), D10.2 (Debouncing), D10.3 (Internal Filtering),
 * D10.4 (Account Locking), D10.5 (Liquidity Horizon), D10.6 (TargetReserve),
 * D10.7 (SafeToInvest), D10.8 (Hysteresis), and D10.9 (Policy Compliance: Inside vs Outside Rules).
 *
 * Executed against live PostgreSQL 'bizarc' database.
 */
async function runD10Tests() {
  console.log("================================================================================");
  console.log("   D10 REAL-WORLD AUDIT: TreasurySentinelAgent (Autonomous Yield & Liquidity)   ");
  console.log("================================================================================");

  let pass = 0;
  let fail = 0;
  const failures: string[] = [];

  function assert(condition: boolean, label: string) {
    if (condition) {
      console.log(`  ✓ ${label}`);
      pass++;
    } else {
      console.error(`  ✗ FAIL: ${label}`);
      fail++;
      failures.push(label);
    }
  }

  function assertEqual<T>(actual: T, expected: T, label: string) {
    if (actual === expected) {
      console.log(`  ✓ ${label}`);
      pass++;
    } else {
      console.error(`  ✗ FAIL: ${label} -> expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      fail++;
      failures.push(label);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. SETUP & REAL DATABASE CLEANUP
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n[Setup] Cleaning database tables for fresh D10 Sentinel audit...");
  await DbClient.query("TRUNCATE TABLE master_system_journal CASCADE");
  await DbClient.query("TRUNCATE TABLE account_agent_audit_log CASCADE");
  await DbClient.query("TRUNCATE TABLE permission_requests CASCADE");
  await DbClient.query("TRUNCATE TABLE account_liabilities CASCADE");
  await DbClient.query("TRUNCATE TABLE treasury_accounts CASCADE");

  const { profile } = PolicyLoader.getActiveProfile();
  for (const acc of profile.operating_accounts) {
    await TreasuryAccountsRepo.upsertAccount({
      account_id: acc.account_id,
      name: acc.name,
      role: acc.role,
      wallet_address: `0x${acc.account_id.length.toString().padStart(40, "5")}` as `0x${string}`,
      chain_id: 5042002,
      min_operating_floor_usdc: acc.min_floor_usdc,
      safety_buffer_ratio: acc.safety_multiplier,
      is_active: true,
    });
  }

  const VAULT_ADDRESS = "0x5555555555555555555555555555555555555555" as `0x${string}`;
  const vaultService = new CentralTreasuryYieldVaultService(VAULT_ADDRESS);
  const witnessAgent = new LedgerWitnessAgent();
  const intelService = new AccountIntelligenceService(undefined, vaultService);

  const sentinelAgent = new TreasurySentinelAgent({
    intelService,
    vaultService,
    witnessAgent,
    debounceMs: 50, // fast debounce for tests
    vaultAddress: VAULT_ADDRESS,
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. AUDIT: AGENT PERSONA & CAPABILITIES (ERC-8004)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n[Test 1] TreasurySentinelAgent Persona & Segregation of Duties");
  assertEqual(sentinelAgent.persona, "TreasurySentinelAgent", "Persona confirmed as TreasurySentinelAgent");
  assertEqual(sentinelAgent.erc8004Id, 101, "ERC-8004 Onchain Agent Identity is registered as ID 101");
  assertEqual(sentinelAgent.canSignTransactions, true, "canSignTransactions is TRUE (signs/executes sweep & recall calls)");
  assertEqual(sentinelAgent.canWriteLedger, false, "canWriteLedger is FALSE (strictly defers ledger writes to LedgerWitness)");

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. AUDIT: D10.3 INTERNAL SETTLEMENT FILTERING (FEEDBACK LOOP PROTECTION)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n[Test 2] D10.3 Internal Settlement Filtering (Infinite Loop Prevention)");

  // Scenario A: Recall from USYC back to operating wallet
  const internalRecallEvent: BalanceMutationEvent = {
    accountId: "acc_engineering",
    amountUsdc: 250.0,
    currentLiquidBalanceUsdc: 600.0,
    origin: "USYC_RECALL",
    from: VAULT_ADDRESS,
  };
  const recallRes = await sentinelAgent.onBalanceMutation(internalRecallEvent);
  assertEqual(recallRes.action, "NONE", "Internal USYC recall ignored from triggering sweep");
  assertEqual(recallRes.branch, "FILTERED_INTERNAL", "Branch tagged as FILTERED_INTERNAL");

  // Scenario B: Internal settlement transfer
  const internalSettlementEvent: BalanceMutationEvent = {
    accountId: "acc_engineering",
    amountUsdc: 100.0,
    currentLiquidBalanceUsdc: 700.0,
    origin: "INTERNAL_SETTLEMENT",
  };
  const settleRes = await sentinelAgent.onBalanceMutation(internalSettlementEvent);
  assertEqual(settleRes.action, "NONE", "Internal settlement ignored");
  assertEqual(settleRes.branch, "FILTERED_INTERNAL", "Branch tagged as FILTERED_INTERNAL");

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. AUDIT: D10.4 CONCURRENCY ACCOUNT LOCK MANAGER
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n[Test 3] D10.4 Concurrency Account Lock Manager");
  const lockAcquired = sentinelAgent.acquireAccountLock("acc_engineering");
  assert(lockAcquired, "Acquired lock on acc_engineering");
  assertEqual(sentinelAgent.isAccountLocked("acc_engineering"), true, "Account reports locked");

  // Second acquisition attempt MUST fail
  const secondAttempt = sentinelAgent.acquireAccountLock("acc_engineering");
  assertEqual(secondAttempt, false, "Concurrent lock acquisition on locked account is rejected");

  sentinelAgent.releaseAccountLock("acc_engineering");
  assertEqual(sentinelAgent.isAccountLocked("acc_engineering"), false, "Account lock released");

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. AUDIT: PAYROLL PROTECTION LOCK
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n[Test 4] Corporate Payroll Protection Lock");
  const payrollEvent: BalanceMutationEvent = {
    accountId: "acc_payroll",
    amountUsdc: 50000.0,
    currentLiquidBalanceUsdc: 150000.0,
    origin: "EXTERNAL_REVENUE",
    forceImmediate: true,
  };
  const payrollRes = await sentinelAgent.onBalanceMutation(payrollEvent);
  assertEqual(payrollRes.action, "NONE", "Payroll account returned action NONE");
  assertEqual(payrollRes.safeToInvestUsdc, 0, "SafeToInvest is strictly locked to 0 on payroll account");
  assertEqual(payrollRes.branch, "PROTECTED_ACCOUNT", "Branch tagged as PROTECTED_ACCOUNT");

  // ─────────────────────────────────────────────────────────────────────────────
  // 6. AUDIT: D10.5 - D10.8 LIQUIDITY HORIZON, TARGET RESERVE, HYSTERESIS & SWEEP
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n[Test 5] Dynamic Liquidity Horizon, TargetReserve & Autonomous Sweep (Inside Rules)");

  // Seed liabilities for acc_engineering in PostgreSQL:
  // Liability 1: Datadog ($150 USDC due in 3 days)
  await LiabilityRepo.createLiability({
    account_id: "acc_engineering",
    vendor_id: "vendor_datadog",
    title: "Datadog APM Monthly",
    category: "INFRASTRUCTURE",
    amount_usdc: 150.0,
    due_date: new Date(Date.now() + 3 * 86400 * 1000),
    payout_address: "0x1111111111111111111111111111111111111111",
    status: "SCHEDULED",
  });

  // TargetReserve calculation:
  // Horizon = 14 days (opPolicy). Sum liabilities = 150.0.
  // Safety multiplier = 1.20, min operating floor = 50.0 USDC.
  // TargetReserve = (150 * 1.20) + 50 = 180 + 50 = 230.000000 USDC.
  // Hysteresis band = 10 USDC. Min sweep = 10 USDC.
  // Liquid balance = 800.000000 USDC.
  // SafeToInvest = max(0, 800 - (230 + 10)) = 560.000000 USDC.

  const revenueEvent: BalanceMutationEvent = {
    accountId: "acc_engineering",
    amountUsdc: 400.0,
    currentLiquidBalanceUsdc: 800.0,
    origin: "EXTERNAL_REVENUE",
    forceImmediate: true,
  };

  const sweepRes = await sentinelAgent.onBalanceMutation(revenueEvent);

  assertEqual(sweepRes.action, "SWEEP", "Sentinel triggered autonomous SWEEP");
  assertEqual(sweepRes.branch, "INSIDE_RULES", "Branch is INSIDE_RULES");
  assertEqual(sweepRes.targetReserveUsdc, 230.0, "TargetReserve calculated as exactly 230.000000 USDC");
  assertEqual(sweepRes.safeToInvestUsdc, 560.0, "SafeToInvest calculated as exactly 560.000000 USDC");
  assertEqual(sweepRes.actionAmountUsdc, 560.0, "Action amount matches SafeToInvest");
  assert(Boolean(sweepRes.encodedTx), "Encoded smart contract transaction generated for sweep");
  assertEqual(sweepRes.witnessed, true, "Sweep witnessed by LedgerWitnessAgent");

  // Verify that LedgerWitnessAgent recorded to master journal & audit log
  const journalEntries = await MasterJournalRepo.getEntriesByAccount("acc_engineering");
  const sweepJournal = journalEntries.find((j) => j.action_type === "AUTONOMOUS_SWEEP");
  assert(Boolean(sweepJournal), "Master journal voucher created for autonomous sweep");
  assertEqual(sweepJournal?.amount_usdc, 560.0, "Master journal amount matches 560.0 USDC");

  const auditLogs = await AuditLogRepo.getAuditLogsByAccount("acc_engineering");
  const sweepLog = auditLogs.find((l) => l.action_type === "AUTONOMOUS_SWEEP");
  assert(Boolean(sweepLog), "Audit log entry created for autonomous sweep");

  // ─────────────────────────────────────────────────────────────────────────────
  // 7. AUDIT: D10.8 HYSTERESIS BAND SUPPRESSION (MICRO-SWEEP SUPPRESSION)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n[Test 6] D10.8 Hysteresis Band: Micro-Sweep Suppression");

  // Liquid balance is $235 USDC (TargetReserve is $230).
  // SafeToInvest = max(0, 235 - (230 + 10)) = 0 < min_sweep ($10)
  const smallBalanceEvent: BalanceMutationEvent = {
    accountId: "acc_engineering",
    amountUsdc: 5.0,
    currentLiquidBalanceUsdc: 235.0,
    origin: "EXTERNAL_REVENUE",
    forceImmediate: true,
  };
  const microRes = await sentinelAgent.onBalanceMutation(smallBalanceEvent);
  assertEqual(microRes.action, "NONE", "Micro-sweep suppressed by hysteresis band");
  assertEqual(microRes.branch, "BELOW_HYSTERESIS", "Branch tagged as BELOW_HYSTERESIS");

  // ─────────────────────────────────────────────────────────────────────────────
  // 8. AUDIT: DEFICIT RECALL DETECTION
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n[Test 7] Deficit Recall Detection (Balance Drops Below Target Reserve)");

  // Liquid balance drops to $150 USDC (TargetReserve is $230, recall hysteresis is $10 -> threshold $220)
  // Deficit = 230 - 150 = 80 USDC
  const dropEvent: BalanceMutationEvent = {
    accountId: "acc_engineering",
    amountUsdc: 85.0,
    currentLiquidBalanceUsdc: 150.0,
    origin: "DISBURSAL",
    forceImmediate: true,
  };
  const recallDetectRes = await sentinelAgent.onBalanceMutation(dropEvent);
  assertEqual(recallDetectRes.action, "RECALL", "Sentinel detected liquidity deficit and triggered RECALL");
  assertEqual(recallDetectRes.actionAmountUsdc, 80.0, "Recall amount is exactly 80.000000 USDC (230 - 150)");
  assert(Boolean(recallDetectRes.encodedTx), "Encoded recall transaction generated for Vault");

  // ─────────────────────────────────────────────────────────────────────────────
  // 9. AUDIT: D10.9 POLICY COMPLIANCE - OUTSIDE RULES & HUMAN GATE (SPRS)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n[Test 8] D10.9 Policy Compliance: Outside Rules (High-Value Sweep Human Gate)");

  // Massive revenue inflow ($25,000 USDC)
  // Liquid balance = $25,000. TargetReserve = $230.
  // SafeToInvest = $25,000 - 240 = $24,760 USDC.
  // Policy single-tx limit is $5,000. $24,760 > $5,000 -> OUTSIDE RULES!
  const highRevenueEvent: BalanceMutationEvent = {
    accountId: "acc_engineering",
    amountUsdc: 25000.0,
    currentLiquidBalanceUsdc: 25000.0,
    origin: "EXTERNAL_REVENUE",
    forceImmediate: true,
  };

  const highSweepRes = await sentinelAgent.onBalanceMutation(highRevenueEvent);

  assertEqual(highSweepRes.action, "SPRS_REQUIRED", "High-value sweep halted for SPRS Human Gate");
  assertEqual(highSweepRes.branch, "OUTSIDE_RULES", "Branch tagged as OUTSIDE_RULES");
  assert(Boolean(highSweepRes.sprs), "Standardized Permission Request generated");
  assertEqual(highSweepRes.sprs?.action, "HIGH_VALUE_SWEEP_EXEMPTION", "SPRS action is HIGH_VALUE_SWEEP_EXEMPTION");
  assertEqual(highSweepRes.sprs?.options.length, 2, "Binary options: APPROVE and REJECT");

  // Verify SPRS record in PostgreSQL
  const sprsInDb = await PermissionRequestRepo.getRequestById(highSweepRes.sprs!.requestId);
  assert(Boolean(sprsInDb), "SPRS successfully persisted to PostgreSQL permission_requests table");
  assertEqual(sprsInDb?.status, "PENDING", "SPRS status is PENDING");

  // ─────────────────────────────────────────────────────────────────────────────
  // 10. AUDIT: HUMAN GATE APPROVAL FLOW FOR HIGH-VALUE SWEEP
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n[Test 9] Human Gate Approval Flow (Admin Approves High-Value Sweep)");

  const approveRes = await sentinelAgent.resolveSweepDecision({
    requestId: highSweepRes.sprs!.requestId,
    decision: "APPROVE",
    adminInstructions: "Treasury Committee approved high-value surplus allocation to USYC.",
  });

  assertEqual(approveRes.status, "APPROVED", "SPRS decision recorded as APPROVED");
  assertEqual(approveRes.actionExecuted, true, "Sweep action executed post-approval");
  assert(Boolean(approveRes.encodedTx), "Encoded sweep transaction generated");

  // Verify DB state updated
  const updatedSprs = await PermissionRequestRepo.getRequestById(highSweepRes.sprs!.requestId);
  assertEqual(updatedSprs?.status, "APPROVED", "PostgreSQL SPRS status confirmed APPROVED");

  const approvedVoucher = await MasterJournalRepo.getEntriesByAccount("acc_engineering");
  const hasApprovedSweep = approvedVoucher.some((j) => j.document_ref.includes(highSweepRes.sprs!.requestId));
  assert(hasApprovedSweep, "Approved sweep recorded into Master System Journal");

  // ─────────────────────────────────────────────────────────────────────────────
  // 11. AUDIT: HUMAN GATE REJECTION FLOW (ADMIN REJECTS SWEEP)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n[Test 10] Human Gate Rejection Flow (Admin Rejects Sweep)");

  // Another high revenue event
  const rejectCandidateEvent: BalanceMutationEvent = {
    accountId: "acc_engineering",
    amountUsdc: 15000.0,
    currentLiquidBalanceUsdc: 15000.0,
    origin: "EXTERNAL_REVENUE",
    forceImmediate: true,
  };
  const rejectCandidateRes = await sentinelAgent.onBalanceMutation(rejectCandidateEvent);
  const rejectRequestId = rejectCandidateRes.sprs!.requestId;

  const rejectRes = await sentinelAgent.resolveSweepDecision({
    requestId: rejectRequestId,
    decision: "REJECT",
    adminInstructions: "Anticipating large tax liability tomorrow. Keep cash liquid.",
  });

  assertEqual(rejectRes.status, "REJECTED", "SPRS decision recorded as REJECTED");
  assertEqual(rejectRes.actionExecuted, false, "Sweep action NOT executed (retained in liquid wallet)");

  const rejectedSprsDb = await PermissionRequestRepo.getRequestById(rejectRequestId);
  assertEqual(rejectedSprsDb?.status, "REJECTED", "PostgreSQL SPRS status confirmed REJECTED");

  // ─────────────────────────────────────────────────────────────────────────────
  // 12. AUDIT: D10.2 DEBOUNCING OF RAPID SUCCESSIVE EVENTS
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n[Test 11] D10.2 Debounce Engine: Multiple Rapid Consecutive Events");

  const fastSentinel = new TreasurySentinelAgent({
    intelService,
    vaultService,
    witnessAgent,
    debounceMs: 150, // 150ms debounce
    vaultAddress: VAULT_ADDRESS,
  });

  // Fire 3 rapid consecutive events for acc_engineering
  fastSentinel.onBalanceMutation({
    accountId: "acc_engineering",
    amountUsdc: 50.0,
    currentLiquidBalanceUsdc: 500.0,
    origin: "EXTERNAL_REVENUE",
  });

  fastSentinel.onBalanceMutation({
    accountId: "acc_engineering",
    amountUsdc: 50.0,
    currentLiquidBalanceUsdc: 550.0,
    origin: "EXTERNAL_REVENUE",
  });

  const finalDebouncedPromise = fastSentinel.onBalanceMutation({
    accountId: "acc_engineering",
    amountUsdc: 50.0,
    currentLiquidBalanceUsdc: 600.0, // Final settled balance
    origin: "EXTERNAL_REVENUE",
  });

  const debouncedResult = await finalDebouncedPromise;
  assertEqual(debouncedResult.liquidBalanceUsdc, 600.0, "Debounced result evaluated final settled balance ($600 USDC)");
  assertEqual(debouncedResult.action, "SWEEP", "Debounced evaluation triggered single consolidated sweep");

  // ─────────────────────────────────────────────────────────────────────────────
  // SUMMARY
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(80));
  console.log(`  D10 REAL-WORLD AUDIT COMPLETE: ${pass} passed, ${fail} failed`);
  if (failures.length > 0) {
    console.error("  FAILURES:");
    failures.forEach((f) => console.error(`    ✗ ${f}`));
  } else {
    console.log("  >>> ALL D10 TREASURY SENTINEL AGENT AUDIT SCENARIOS CONFIRMED PASSING <<<");
  }
  console.log("=".repeat(80));

  process.exit(fail > 0 ? 1 : 0);
}

runD10Tests().catch((err) => {
  console.error("[FATAL D10 AUDIT ERROR]", err);
  process.exit(1);
});
