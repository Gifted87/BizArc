import { AccountIntelligenceService } from "../src/services/accountIntelligenceService.js";
import { DbClient } from "../src/database/dbClient.js";
import { TreasuryAccountsRepo } from "../src/database/repos/treasuryAccountsRepo.js";
import { LiabilityRepo } from "../src/database/repos/liabilityRepo.js";
import { AuditLogRepo } from "../src/database/repos/auditLogRepo.js";
import { PolicyLoader } from "../src/config/policyLoader.js";

/**
 * INDEPENDENT REAL-WORLD AUDIT SUITE FOR D6 -> D8:
 * Account Intelligence Layer & Dynamic Solvency Analytics
 *
 * Verifies live get_account_intelligence tool responses, tripartite balance
 * reconciliation, dynamic liability aggregation, real-time recalculation upon
 * state mutation, payroll protection walls, and multi-account waterfall planning.
 *
 * Executed against live PostgreSQL 'bizarc' database.
 */
async function runIndependentD8Audit() {
  console.log("================================================================================");
  console.log(" INDEPENDENT REAL-WORLD AUDIT: D6 -> D8 ACCOUNT INTELLIGENCE & WATERFALL LAYER ");
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
  console.log("\n[Setup] Cleaning database tables for independent D8 audit...");
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
      wallet_address: `0x${acc.account_id.length.toString().padStart(40, "8")}` as `0x${string}`,
      chain_id: 5042002,
      min_operating_floor_usdc: acc.min_floor_usdc,
      safety_buffer_ratio: acc.safety_multiplier,
      is_active: true,
    });
  }

  const intelService = new AccountIntelligenceService();

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. AUDIT: SEED REALISTIC FINANCIAL DATA & QUERY ACCOUNT INTELLIGENCE
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n[Audit 1] Invoking get_account_intelligence with Live Financial State");

  // Liability 1: Datadog APM due in 4 days -> $150.00 USDC
  await LiabilityRepo.createLiability({
    account_id: "acc_engineering",
    vendor_id: "vendor_datadog",
    title: "Datadog APM Monthly",
    category: "INFRASTRUCTURE",
    amount_usdc: 150.0,
    due_date: new Date(Date.now() + 4 * 86400 * 1000),
    payout_address: "0x1111111111111111111111111111111111111111",
    status: "SCHEDULED",
  });

  // Liability 2: AWS Elastic Compute due in 10 days (in 14d evaluation window) -> $250.00 USDC
  await LiabilityRepo.createLiability({
    account_id: "acc_engineering",
    vendor_id: "vendor_aws",
    title: "AWS Cluster Compute",
    category: "INFRASTRUCTURE",
    amount_usdc: 250.0,
    due_date: new Date(Date.now() + 10 * 86400 * 1000),
    payout_address: "0x2222222222222222222222222222222222222222",
    status: "SCHEDULED",
  });

  // Liability 3: Cancelled subscription -> $75.00 USDC (MUST BE EXCLUDED)
  await LiabilityRepo.createLiability({
    account_id: "acc_engineering",
    vendor_id: "vendor_sentry",
    title: "Sentry Error Monitoring (Terminated)",
    category: "SUBSCRIPTION",
    amount_usdc: 75.0,
    due_date: new Date(Date.now() + 2 * 86400 * 1000),
    payout_address: "0x3333333333333333333333333333333333333333",
    status: "CANCELLED",
  });

  // Record an audit log entry
  await AuditLogRepo.appendAuditLog({
    account_id: "acc_engineering",
    action_type: "AUTONOMOUS_SWEEP",
    amount_usdc: 200.0,
    is_autonomous: true,
    reason: "Surplus cash swept to USYC",
    pre_state_snapshot: { liquid: "1000.000000" },
    post_state_snapshot: { liquid: "800.000000", usyc: "200.000000" },
    actor_agent: "LedgerWitnessAgent",
  });

  // Query live intelligence
  const intel = await intelService.getAccountIntelligence("acc_engineering", {
    overrideLiquidBalance: 800.0,
    overrideInvestedUsyc: 200.0,
  });

  // Verify tripartite balances
  assertEqual(intel.balances.liquidUsdc, "800.000000", "Liquid USDC balance confirmed at 800.000000");
  assertEqual(intel.balances.investedUsycUsdcEquivalent, "200.000000", "Invested USYC balance confirmed at 200.000000");
  assertEqual(intel.balances.totalEffectiveUsdc, "1000.000000", "Total effective balance confirmed at 1000.000000");

  // Verify dynamic liabilities
  assertEqual(intel.liabilities.dueNext7DaysUsdc, "150.000000", "7-day liabilities include only Datadog ($150)");
  assertEqual(intel.liabilities.dueNext30DaysUsdc, "400.000000", "30-day liabilities include Datadog + AWS ($400)");
  assertEqual(intel.liabilities.items.length, 2, "Active items exclude cancelled subscription");

  // Verify solvency arithmetic:
  // RequiredReserve = (400 * 1.20) + 50 = 530.000000
  // SafeToInvest = max(0, 800 - 530 - 10) = 260.000000
  // Free Cash = 800 - 530 = 270.000000
  // Free Capital = 1000 - 530 = 470.000000
  assertEqual(intel.solvencyMetrics.requiredReserveUsdc, "530.000000", "Required target reserve is exactly 530.000000");
  assertEqual(intel.solvencyMetrics.safeToInvestUsdc, "260.000000", "SafeToInvest is exactly 260.000000 (after 10 USDC hysteresis)");
  assertEqual(intel.solvencyMetrics.unencumberedFreeCashUsdc, "270.000000", "Unencumbered free cash is exactly 270.000000");
  assertEqual(intel.solvencyMetrics.freeCapitalTotalUsdc, "470.000000", "Free capital total is exactly 470.000000");
  assertEqual(intel.solvencyMetrics.isSolvent, true, "Account is confirmed solvent (1000 >= 530)");

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. AUDIT: DYNAMIC RECALCULATION ON DATABASE MUTATION
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n[Audit 2] Dynamic Recalculation on Inbound Obligation Mutation");

  // Ingest unexpected emergency invoice ($300 USDC due in 6 days)
  await LiabilityRepo.createLiability({
    account_id: "acc_engineering",
    vendor_id: "vendor_security_audit",
    title: "Smart Contract Emergency Security Audit",
    category: "INFRASTRUCTURE",
    amount_usdc: 300.0,
    due_date: new Date(Date.now() + 6 * 86400 * 1000),
    payout_address: "0x4444444444444444444444444444444444444444",
    status: "SCHEDULED",
  });

  const updatedIntel = await intelService.getAccountIntelligence("acc_engineering", {
    overrideLiquidBalance: 800.0,
    overrideInvestedUsyc: 200.0,
  });

  // Required reserve now: (700 * 1.20) + 50 = 890.000000
  // Since liquid is 800 < 890, SafeToInvest drops to 0.000000
  assertEqual(updatedIntel.liabilities.dueNext30DaysUsdc, "700.000000", "Dynamic 30-day liabilities updated to 700.000000");
  assertEqual(updatedIntel.solvencyMetrics.requiredReserveUsdc, "890.000000", "Required reserve dynamically recalculated to 890.000000");
  assertEqual(updatedIntel.solvencyMetrics.safeToInvestUsdc, "0.000000", "SafeToInvest immediately locked to 0.000000");
  assertEqual(updatedIntel.solvencyMetrics.unencumberedFreeCashUsdc, "0.000000", "Unencumbered free cash is 0 when required reserve exceeds liquid");
  assertEqual(updatedIntel.solvencyMetrics.freeCapitalTotalUsdc, "110.000000", "Total free capital remains positive (1000 - 890 = 110.000000)");

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. AUDIT: PAYROLL PROTECTION WALL
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n[Audit 3] Payroll Protection Wall (Zero-Drain Invariant)");
  const payrollIntel = await intelService.getAccountIntelligence("acc_payroll", {
    overrideLiquidBalance: 150000.0,
    overrideInvestedUsyc: 0.0,
  });

  assertEqual(payrollIntel.metadata.excludeFromWaterfall, true, "Payroll excludeFromWaterfall is STRICTLY TRUE");
  assertEqual(payrollIntel.solvencyMetrics.safeToInvestUsdc, "0.000000", "Payroll SafeToInvest is STRICTLY LOCKED to 0.000000");

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. AUDIT: PORTFOLIO-WIDE INTELLIGENCE AGGREGATION
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n[Audit 4] Portfolio-Wide Intelligence Aggregation");
  const allAccounts = await intelService.getAllAccountsIntelligence();
  assertEqual(allAccounts.length, 4, "getAllAccountsIntelligence returns all 4 registered corporate accounts");
  const hasPayroll = allAccounts.some((a) => a.metadata.accountId === "acc_payroll");
  const hasEngineering = allAccounts.some((a) => a.metadata.accountId === "acc_engineering");
  assert(hasPayroll && hasEngineering, "Portfolio intelligence includes both operational and protected accounts");

  // ─────────────────────────────────────────────────────────────────────────────
  // 6. AUDIT: MULTI-ACCOUNT WATERFALL LIQUIDITY PLANNING
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n[Audit 5] Multi-Account Waterfall Planning ($5,000 Invoice Draw)");
  const waterfallPlan = await intelService.getWaterfallCandidateAccounts(5000.0, {
    acc_engineering: { liquidUsdc: 2500.0, investedUsyc: 1000.0 }, // free capital ~ $2,610
    acc_general_treasury: { liquidUsdc: 25000.0, investedUsyc: 10000.0 }, // large free capital
    acc_marketing: { liquidUsdc: 1500.0, investedUsyc: 500.0 }, // free capital ~ $1,950
    acc_payroll: { liquidUsdc: 100000.0, investedUsyc: 0.0 }, // $100k! MUST BE EXCLUDED!
  });

  assertEqual(waterfallPlan.isFullyFundable, true, "Waterfall confirmed $5,000 invoice is fully fundable");
  assert(
    !waterfallPlan.eligibleAccounts.some((a) => a.metadata.accountId === "acc_payroll"),
    "Payroll was STRICTLY EXCLUDED from waterfall candidate accounts"
  );

  const totalAllocated = waterfallPlan.allocationPlan.reduce((sum, a) => sum + a.allocateAmountUsdc, 0);
  assertEqual(totalAllocated, 5000.0, "Allocated sum exactly equals requested $5,000.000000");

  // ─────────────────────────────────────────────────────────────────────────────
  // 7. AUDIT: WATERFALL SHORTFALL & INSOLVENCY DETECTION
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n[Audit 6] Waterfall Insolvency Detection ($1,000,000 Excess Demand)");
  const hugeDemandPlan = await intelService.getWaterfallCandidateAccounts(1000000.0, {
    acc_engineering: { liquidUsdc: 1000.0 },
    acc_general_treasury: { liquidUsdc: 2000.0 },
  });

  assertEqual(hugeDemandPlan.isFullyFundable, false, "Waterfall correctly caught insolvency for $1M draw");
  assert(hugeDemandPlan.shortfallUsdc !== undefined, "Shortfall amount is explicitly computed");

  // ─────────────────────────────────────────────────────────────────────────────
  // SUMMARY
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(80));
  console.log(`  INDEPENDENT D8 AUDIT COMPLETE: ${pass} passed, ${fail} failed`);
  if (failures.length > 0) {
    console.error("  FAILURES:");
    failures.forEach((f) => console.error(`    ✗ ${f}`));
  } else {
    console.log("  >>> ALL D6->D8 ACCOUNT INTELLIGENCE SCENARIOS CONFIRMED PASSING <<<");
  }
  console.log("=".repeat(80));

  process.exit(fail > 0 ? 1 : 0);
}

runIndependentD8Audit().catch((err) => {
  console.error("[FATAL D8 AUDIT ERROR]", err);
  process.exit(1);
});
