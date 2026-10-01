import { AccountIntelligenceService } from "../src/services/accountIntelligenceService.js";
import { DbClient } from "../src/database/dbClient.js";
import { TreasuryAccountsRepo } from "../src/database/repos/treasuryAccountsRepo.js";
import { LiabilityRepo } from "../src/database/repos/liabilityRepo.js";
import { AuditLogRepo } from "../src/database/repos/auditLogRepo.js";
import { PolicyLoader } from "../src/config/policyLoader.js";

async function runD8Tests() {
  console.log("==================================================");
  console.log("  D6 -> D8: Account Intelligence Layer Audit");
  console.log("==================================================");

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

  // ──────────────────────────────────────────────────────────
  // 1. SETUP & DB RESET
  // ──────────────────────────────────────────────────────────
  console.log("\n[Setup] Cleaning DB tables for fresh account intelligence audit...");
  await DbClient.query("TRUNCATE TABLE master_system_journal CASCADE");
  await DbClient.query("TRUNCATE TABLE account_agent_audit_log CASCADE");
  await DbClient.query("TRUNCATE TABLE account_liabilities CASCADE");
  await DbClient.query("TRUNCATE TABLE treasury_accounts CASCADE");

  const { profile } = PolicyLoader.getActiveProfile();
  for (const acc of profile.operating_accounts) {
    await TreasuryAccountsRepo.upsertAccount({
      account_id: acc.account_id,
      name: acc.name,
      role: acc.role,
      wallet_address: `0x${acc.account_id.length.toString().padStart(40, "3")}` as `0x${string}`,
      chain_id: 5042002,
      min_operating_floor_usdc: acc.min_floor_usdc,
      safety_buffer_ratio: acc.safety_multiplier,
      is_active: true,
    });
  }

  const intelService = new AccountIntelligenceService();

  // ──────────────────────────────────────────────────────────
  // 2. SEED REALISTIC OPERATIONAL DATA FOR acc_engineering
  // ──────────────────────────────────────────────────────────
  console.log("\n[Setup] Seeding liabilities and audit logs for acc_engineering...");

  // Liability 1: Due in 3 days (in 7d and 30d window) -> $150 USDC
  await LiabilityRepo.createLiability({
    account_id: "acc_engineering",
    vendor_id: "vendor_datadog",
    title: "Datadog APM & Logs Monitoring",
    category: "INFRASTRUCTURE",
    amount_usdc: 150.0,
    due_date: new Date(Date.now() + 3 * 86400 * 1000),
    payout_address: "0x1111111111111111111111111111111111111111",
    status: "SCHEDULED",
  });

  // Liability 2: Due in 12 days (in 30d window, not in 7d window) -> $250 USDC
  await LiabilityRepo.createLiability({
    account_id: "acc_engineering",
    vendor_id: "vendor_aws",
    title: "AWS Elastic Kubernetes Service",
    category: "INFRASTRUCTURE",
    amount_usdc: 250.0,
    due_date: new Date(Date.now() + 12 * 86400 * 1000),
    payout_address: "0x2222222222222222222222222222222222222222",
    status: "SCHEDULED",
  });

  // Liability 3: Cancelled subscription -> $50 USDC (should NOT be included in active liability calculations)
  await LiabilityRepo.createLiability({
    account_id: "acc_engineering",
    vendor_id: "vendor_sentry",
    title: "Sentry Error Tracking (Cancelled)",
    category: "SUBSCRIPTION",
    amount_usdc: 50.0,
    due_date: new Date(Date.now() + 5 * 86400 * 1000),
    payout_address: "0x3333333333333333333333333333333333333333",
    status: "CANCELLED",
  });

  // Audit Log Entry
  await AuditLogRepo.appendAuditLog({
    account_id: "acc_engineering",
    action_type: "AUTONOMOUS_SWEEP",
    amount_usdc: 120.0,
    is_autonomous: true,
    reason: "Surplus yield sweep to central USYC vault",
    pre_state_snapshot: { liquid: 400.0 },
    post_state_snapshot: { liquid: 280.0, invested: 120.0 },
    actor_agent: "LedgerWitnessAgent",
    tx_hash: "0xdeadbeef11111111111111111111111111111111111111111111111111111111",
  });

  // ──────────────────────────────────────────────────────────
  // 3. TEST: get_account_intelligence SCHEMA & METRICS
  // ──────────────────────────────────────────────────────────
  console.log("\n[Test 1] Invoking get_account_intelligence for acc_engineering");

  // acc_engineering: minFloor=50, safetyMultiplier=1.20, evaluationWindow=14d
  // Active liabilities within 14d: 150 + 250 = 400
  // TargetReserve = (400 * 1.20) + 50 = 480 + 50 = 530 USDC
  // Assume balances: liquid = 800 USDC, invested = 200 USYC -> total effective = 1000 USDC
  // SafeToInvest = max(0, 800 - (530 + 10 invest_hysteresis)) = 800 - 540 = 260 USDC
  // UnencumberedFreeCash = max(0, 800 - 530) = 270 USDC
  // FreeCapitalTotal = max(0, 1000 - 530) = 470 USDC
  const intel = await intelService.getAccountIntelligence("acc_engineering", {
    overrideLiquidBalance: 800.0,
    overrideInvestedUsyc: 200.0,
  });

  // Metadata assertions
  assertEqual(intel.metadata.accountId, "acc_engineering", "Metadata: accountId matches");
  assertEqual(intel.metadata.role, "OPEX_DEV", "Metadata: role matches OPEX_DEV");
  assertEqual(intel.metadata.minOperatingFloorUsdc, 50, "Metadata: min operating floor is 50 USDC");
  assertEqual(intel.metadata.safetyBufferRatio, 1.2, "Metadata: safety buffer ratio is 1.20");
  assertEqual(intel.metadata.excludeFromWaterfall, false, "Metadata: excludeFromWaterfall is false");

  // Balances assertions
  assertEqual(intel.balances.liquidUsdc, "800.000000", "Balances: liquidUsdc is 800.000000");
  assertEqual(intel.balances.investedUsycUsdcEquivalent, "200.000000", "Balances: investedUsyc is 200.000000");
  assertEqual(intel.balances.totalEffectiveUsdc, "1000.000000", "Balances: totalEffectiveUsdc is 1000.000000");

  // Liabilities assertions
  assertEqual(intel.liabilities.dueNext7DaysUsdc, "150.000000", "Liabilities: dueNext7Days is 150.000000 (Datadog)");
  assertEqual(intel.liabilities.dueNext30DaysUsdc, "400.000000", "Liabilities: dueNext30Days is 400.000000 (Datadog + AWS)");
  assertEqual(intel.liabilities.items.length, 2, "Liabilities: exactly 2 active items (cancelled excluded)");

  // Solvency & Reserve assertions
  assertEqual(intel.solvencyMetrics.requiredReserveUsdc, "530.000000", "Solvency: requiredReserve is exactly 530.000000");
  assertEqual(intel.solvencyMetrics.safeToInvestUsdc, "260.000000", "Solvency: safeToInvest is exactly 260.000000 (800 - 540)");
  assertEqual(intel.solvencyMetrics.unencumberedFreeCashUsdc, "270.000000", "Solvency: unencumberedFreeCash is exactly 270.000000 (800 - 530)");
  assertEqual(intel.solvencyMetrics.freeCapitalTotalUsdc, "470.000000", "Solvency: freeCapitalTotal is exactly 470.000000 (1000 - 530)");
  assert(intel.solvencyMetrics.isSolvent, "Solvency: isSolvent is TRUE (1000 >= 530)");
  assert(intel.solvencyMetrics.timeHorizonSeconds > 0 && intel.solvencyMetrics.timeHorizonSeconds <= 3 * 86400, "Solvency: timeHorizonSeconds accurately reflects 3-day earliest deadline");

  // Audit History assertions
  assertEqual(intel.recentAuditHistory.length, 1, "Audit: exactly 1 recent audit log record");
  assertEqual(intel.recentAuditHistory[0].action, "AUTONOMOUS_SWEEP", "Audit: action matches AUTONOMOUS_SWEEP");
  assertEqual(intel.recentAuditHistory[0].actorAgent, "LedgerWitnessAgent", "Audit: actor matches LedgerWitnessAgent");

  // ──────────────────────────────────────────────────────────
  // 4. TEST: PAYROLL ACCOUNT PROTECTION
  // ──────────────────────────────────────────────────────────
  console.log("\n[Test 2] Payroll Account Protection in Account Intelligence");

  const payrollIntel = await intelService.getAccountIntelligence("acc_payroll", {
    overrideLiquidBalance: 50000.0,
    overrideInvestedUsyc: 0.0,
  });

  assertEqual(payrollIntel.metadata.excludeFromWaterfall, true, "Payroll: excludeFromWaterfall is TRUE");
  assertEqual(payrollIntel.solvencyMetrics.safeToInvestUsdc, "0.000000", "Payroll: safeToInvest is strictly suppressed to 0.000000");

  // ──────────────────────────────────────────────────────────
  // 5. TEST: ALL ACCOUNTS PORTFOLIO AGGREGATION
  // ──────────────────────────────────────────────────────────
  console.log("\n[Test 3] Portfolio-Wide Intelligence Aggregation");

  const allAccounts = await intelService.getAllAccountsIntelligence({
    acc_engineering: { liquidUsdc: 800.0, investedUsyc: 200.0 },
    acc_payroll: { liquidUsdc: 50000.0, investedUsyc: 0.0 },
    acc_marketing: { liquidUsdc: 1500.0, investedUsyc: 500.0 },
    acc_general_treasury: { liquidUsdc: 25000.0, investedUsyc: 10000.0 },
  });

  assertEqual(allAccounts.length, 4, "getAllAccountsIntelligence returns all 4 registered corporate accounts");
  const foundPayroll = allAccounts.find((a) => a.metadata.accountId === "acc_payroll");
  assert(!!foundPayroll && foundPayroll.metadata.excludeFromWaterfall, "Portfolio includes protected payroll account");

  // ──────────────────────────────────────────────────────────
  // 6. TEST: WATERFALL CANDIDATE PLANNING (For Disbursals)
  // ──────────────────────────────────────────────────────────
  console.log("\n[Test 4] Multi-Account Waterfall Planning for AWS Invoice ($5,000)");

  // acc_engineering: total effective = 1000, requiredReserve = 530 -> free capital = 470 USDC
  // acc_growth: minFloor = 50, safetyMultiplier = 1.15, liabilities = 0 -> requiredReserve = 50 -> free capital = 2000 - 50 = 1950 USDC
  // acc_general_treasury: minFloor = 500, safetyMultiplier = 1.10, liabilities = 0 -> requiredReserve = 500 -> free capital = 35000 - 500 = 34500 USDC
  // acc_payroll: excluded!
  const waterfallPlan = await intelService.getWaterfallCandidateAccounts(5000.0, {
    acc_engineering: { liquidUsdc: 800.0, investedUsyc: 200.0 },
    acc_payroll: { liquidUsdc: 50000.0, investedUsyc: 0.0 },
    acc_marketing: { liquidUsdc: 1500.0, investedUsyc: 500.0 },
    acc_general_treasury: { liquidUsdc: 25000.0, investedUsyc: 10000.0 },
  });

  assert(waterfallPlan.isFullyFundable, "Waterfall: $5,000 invoice is fully fundable");
  assertEqual(waterfallPlan.eligibleAccounts.length, 3, "Waterfall: exactly 3 accounts eligible (payroll correctly excluded)");
  assert(
    !waterfallPlan.eligibleAccounts.some((a) => a.metadata.accountId === "acc_payroll"),
    "Waterfall: payroll is STRICTLY excluded from candidate pool"
  );

  // Check allocation plan: primary largest free capital funds first
  const allocatedSum = waterfallPlan.allocationPlan.reduce((acc, p) => acc + p.allocateAmountUsdc, 0);
  assertEqual(allocatedSum, 5000.0, "Waterfall: allocated sum exactly equals requested $5,000");

  console.log("\n[Test 5] Waterfall Shortfall Detection");
  const impossibleDemand = await intelService.getWaterfallCandidateAccounts(1000000.0, {
    acc_engineering: { liquidUsdc: 800.0, investedUsyc: 200.0 },
    acc_payroll: { liquidUsdc: 50000.0, investedUsyc: 0.0 },
    acc_marketing: { liquidUsdc: 1500.0, investedUsyc: 500.0 },
    acc_general_treasury: { liquidUsdc: 25000.0, investedUsyc: 10000.0 },
  });

  assert(!impossibleDemand.isFullyFundable, "Waterfall: $1,000,000 exceeds available free capital and reports isFullyFundable = false");

  // ──────────────────────────────────────────────────────────
  // SUMMARY
  // ──────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(50));
  console.log(`  RESULTS: ${pass} passed, ${fail} failed`);
  if (failures.length > 0) {
    console.error("  FAILURES:");
    failures.forEach((f) => console.error(`    ✗ ${f}`));
  } else {
    console.log("  >>> ALL D6->D8 ACCOUNT INTELLIGENCE TESTS PASSED <<<");
  }
  console.log("=".repeat(50));

  process.exit(fail > 0 ? 1 : 0);
}

runD8Tests().catch((err) => {
  console.error("[FATAL]", err);
  process.exit(1);
});
