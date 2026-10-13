import { describe, it, after } from "node:test";
import assert from "node:assert";
import { DbClient } from "../src/database/dbClient.js";
import { DynamicRecordsService } from "../src/records/dynamicRecordsService.js";
import { PredictiveRefunderService, REDEMPTION_LEAD_TIME } from "../src/services/predictiveRefunderService.js";
import { TreasurySentinelService } from "../src/services/treasurySentinelService.js";
import { PolicyLoader } from "../src/config/policyLoader.js";
import { MasterJournalRepo } from "../src/database/repos/masterJournalRepo.js";
import { AuditLogRepo } from "../src/database/repos/auditLogRepo.js";
import { ToolRegistry } from "../src/tools/toolRegistry.js";
import { AuthorizationGate } from "../src/security/authorizationGate.js";
import { TreasuryAccountsRepo } from "../src/database/repos/treasuryAccountsRepo.js";
import { VendorMasterRepo } from "../src/database/repos/vendorMasterRepo.js";

describe("DAG Nodes D10.9, D10D16, D13, D13D7: Treasury Sentinel & Predictive Refunder", () => {
  const testAccountId = `acc_pred_${Date.now().toString(36)}`;
  const payrollAccountId = `acc_payroll_${Date.now().toString(36)}`;
  const testVendorId = `vend_cloud_${Date.now().toString(36)}`;
  const testWallet = `0x11${Date.now().toString(16).padEnd(38, "1")}` as `0x${string}`;
  const payrollWallet = `0x22${Date.now().toString(16).padEnd(38, "2")}` as `0x${string}`;
  const vendorWallet = `0x33${Date.now().toString(16).padEnd(38, "3")}` as `0x${string}`;
  const dynamicRecords = new DynamicRecordsService();
  const predictiveRefunder = new PredictiveRefunderService();
  const sentinel = new TreasurySentinelService();
  const toolRegistry = new ToolRegistry();

  it("Setup: Register test accounts, active profile and vendor master", async () => {
    // 1. Insert operating account
    await TreasuryAccountsRepo.upsertAccount({
      account_id: testAccountId,
      name: "Predictive Cloud Operations",
      role: "OPEX_DEV",
      chain_id: 5042002,
      wallet_address: testWallet,
      min_operating_floor_usdc: 1000.0,
      safety_buffer_ratio: 1.20,
      is_active: true,
    });

    // 2. Insert protected payroll account
    await TreasuryAccountsRepo.upsertAccount({
      account_id: payrollAccountId,
      name: "Protected Corporate Payroll",
      role: "PAYROLL",
      chain_id: 5042002,
      wallet_address: payrollWallet,
      min_operating_floor_usdc: 20000.0,
      safety_buffer_ratio: 1.50,
      is_active: true,
    });

    // 3. Insert vendor master
    await VendorMasterRepo.registerVendor({
      vendor_id: testVendorId,
      name: "Global Cloud Infrastructure",
      verified_payout_address: vendorWallet,
      verified_by_admin: "CFO_HUMAN",
      last_verified_at: new Date(),
      change_lock: true,
    });

    // 4. Initialize dynamic tripartite balances (Record 2)
    // Operating account: $2,000 Liquid, $50,000 Invested USYC -> $52,000 Available
    await dynamicRecords.calculateSafeToInvest(
      testAccountId,
      7 * 86400,
      "1000.000000",
      2000000000n,  // 2,000.000000 USDC
      50000000000n  // 50,000.000000 USDC
    );

    const trip = await dynamicRecords.getTripartiteBalance(testAccountId);
    assert.strictEqual(trip.liquidCashUsdc, "2000.000000");
    assert.strictEqual(trip.investedYieldUsdc, "50000.000000");
    assert.strictEqual(trip.availableBalanceUsdc, "52000.000000");
    assert.strictEqual(trip.invariantSatisfied, true);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // D10.9 & D10D16 TESTS: Treasury Sentinel Reason-Bearing Intent & Enforcer
  // ─────────────────────────────────────────────────────────────────────────────

  it("Test 1: D10.9 & D10D16: Autonomous surplus sweep inside limits submits Reason-Bearing Intent and receives Layer 1 clearance", async () => {
    // When liquid balance has large surplus ($8,000 liquid, target reserve $1,000)
    // Safe to invest = ~7,000 USDC -> Sentinel submits ReasonBearingIntent to Enforcer
    const evalResult = await sentinel.evaluateAccount(testAccountId, 8000.0);

    assert.strictEqual(evalResult.action, "SWEEP");
    assert.strictEqual(evalResult.branch, "INSIDE_RULES");
    assert.strictEqual(evalResult.witnessed, true);
    assert.ok(evalResult.clearanceCode, "Clearance code must be issued by Enforcer Agent");
    assert.ok(evalResult.clearanceCode?.startsWith("CLEAR-"), "Clearance code must follow #CLEAR standard");
    assert.ok(evalResult.encodedTx, "Onchain sweep transaction must be encoded");
  });

  it("Test 2: D10.9 & D10D16: High-value sweep exceeding limit escalates to Human SPRS with declaredReason", async () => {
    // Liquid balance $50,000 -> Surplus ~$49,000, which exceeds standard autonomous limit (default $5,000 or $25,000)
    const evalResult = await sentinel.evaluateAccount(testAccountId, 50000.0);

    assert.strictEqual(evalResult.action, "SPRS_REQUIRED");
    assert.strictEqual(evalResult.branch, "OUTSIDE_RULES");
    assert.ok(evalResult.sprs, "SPRS payload must be formulated");
    assert.strictEqual(evalResult.sprs?.status, "PENDING");
    assert.ok(evalResult.sprs?.reason.includes("exceeds autonomous limit"), "Reason must cite limit breach");
    assert.strictEqual(evalResult.sprs?.options.length, 2, "SPRS must offer binary options (APPROVE / REJECT)");
  });

  it("Test 3: D10.9 & D10D16: Protected payroll account rejects sweeps with hard invariant error", async () => {
    const evalResult = await sentinel.evaluateAccount(payrollAccountId, 45000.0);
    assert.strictEqual(evalResult.action, "NONE");
    assert.strictEqual(evalResult.branch, "PROTECTED_ACCOUNT");
    assert.ok(evalResult.reason.includes("strict corporate protection"));
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // D13 TESTS: PredictiveRefunderService Scanning, Lead Time, and Shortfall
  // ─────────────────────────────────────────────────────────────────────────────

  it("Test 4: D13: Parameterized Lead Time and Weekend Buffer (+48h) calculation", () => {
    // Weekday: Wednesday 2026-10-07
    const wednesday = new Date("2026-10-07T12:00:00Z");
    assert.strictEqual(predictiveRefunder.isWeekend(wednesday), false);
    const weekdayLead = predictiveRefunder.getEffectiveLeadTimeSeconds(
      wednesday,
      REDEMPTION_LEAD_TIME.BATCH_SETTLEMENT_TIER
    );
    assert.strictEqual(weekdayLead, 86400); // 24 hours

    // Weekend: Saturday 2026-10-10
    const saturday = new Date("2026-10-10T12:00:00Z");
    assert.strictEqual(predictiveRefunder.isWeekend(saturday), true);
    const weekendLead = predictiveRefunder.getEffectiveLeadTimeSeconds(
      saturday,
      REDEMPTION_LEAD_TIME.BATCH_SETTLEMENT_TIER
    );
    assert.strictEqual(
      weekendLead,
      86400 + REDEMPTION_LEAD_TIME.WEEKEND_BUFFER_SECONDS // 86400 + 172800 = 259200 (72h)
    );
  });

  it("Test 5: D13: Autonomous Scanning detects scheduled liabilities within lead time window", async () => {
    const now = new Date();
    // Liability 1: Due in 4 hours (within 24h lead time) - SCHEDULED
    const dueSoonDate = new Date(now.getTime() + 4 * 3600 * 1000);
    const lia1 = await dynamicRecords.upsertLiability({
      accountId: testAccountId,
      vendorId: testVendorId,
      title: "Quarterly Cloud Infrastructure Compute",
      amountUsdc: "15000.000000",
      payoutAddress: vendorWallet,
      dueDate: dueSoonDate,
      documentHash: "0xhash_inv_cloud_q3",
      status: "SCHEDULED",
    });

    // Liability 2: Due in 14 days (outside 24h lead time) - SCHEDULED
    const dueFarDate = new Date(now.getTime() + 14 * 86400 * 1000);
    await dynamicRecords.upsertLiability({
      accountId: testAccountId,
      vendorId: testVendorId,
      title: "Annual Security Audit Retainer",
      amountUsdc: "25000.000000",
      payoutAddress: vendorWallet,
      dueDate: dueFarDate,
      documentHash: "0xhash_inv_audit_annual",
      status: "SCHEDULED",
    });

    // Liability 3: Due in 2 hours but already DISBURSED
    const duePastDate = new Date(now.getTime() + 2 * 3600 * 1000);
    await dynamicRecords.upsertLiability({
      accountId: testAccountId,
      vendorId: testVendorId,
      title: "Prior Month Hosting Surcharge",
      amountUsdc: "500.000000",
      payoutAddress: vendorWallet,
      dueDate: duePastDate,
      documentHash: "0xhash_inv_hosting_prior",
      status: "DISBURSED",
    });

    // Scan with 24h lead time
    const upcoming = await predictiveRefunder.scanUpcomingLiabilities({
      accountId: testAccountId,
      baseLeadTimeSeconds: REDEMPTION_LEAD_TIME.BATCH_SETTLEMENT_TIER,
      referenceTime: now,
    });

    assert.strictEqual(upcoming.length, 1, "Only active scheduled liability due within lead time must be returned");
    assert.strictEqual(upcoming[0].liabilityId, lia1.liabilityId);
    assert.strictEqual(upcoming[0].amountUsdc, "15000.000000");
  });

  it("Test 6: D13: Net Shortfall Calculation and USYC Liquidity Check", async () => {
    // Operating account has $2,000 Liquid Cash and $15,000 liability due
    // Net Shortfall = max(0, 15,000 - 2,000) = 13,000.000000 USDC
    const upcoming = await predictiveRefunder.scanUpcomingLiabilities({
      accountId: testAccountId,
    });

    const assessment = await predictiveRefunder.assessAccountShortfall({
      accountId: testAccountId,
      upcomingLiabilities: upcoming,
      liveLiquidRaw: 2000000000n, // $2,000.000000
      liveInvestedRaw: 50000000000n, // $50,000.000000
    });

    assert.strictEqual(assessment.totalDueUsdc, "15000.000000");
    assert.strictEqual(assessment.liquidCashUsdc, "2000.000000");
    assert.strictEqual(assessment.shortfallUsdc, "13000.000000");
    assert.strictEqual(assessment.requiresRecall, true);
    assert.strictEqual(assessment.canCoverFromUsyc, true);

    // Verify solvency deficit detection if USYC balance is insufficient
    const deficitAssessment = await predictiveRefunder.assessAccountShortfall({
      accountId: testAccountId,
      upcomingLiabilities: upcoming,
      liveLiquidRaw: 2000000000n,
      liveInvestedRaw: 5000000000n, // Only $5,000 in USYC vs $13,000 shortfall
    });
    assert.strictEqual(deficitAssessment.canCoverFromUsyc, false);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // D13D7 TESTS: Predictive Refunder to Ledger Witness Cryptographic Integration
  // ─────────────────────────────────────────────────────────────────────────────

  it("Test 7: D13D7: Full Autonomous Predictive Recall Execution with Hash-Chained Master Journal & Tripartite Invariant", async () => {
    const shortfallRaw = 13000000000n; // 13,000.000000 USDC
    const recallResult = await predictiveRefunder.executePredictiveRecall({
      accountId: testAccountId,
      shortfallRaw,
      reason: "Autonomous pre-funding: $13,000 shortfall detected for quarterly cloud compute liability due in 4h.",
      liveLiquidRaw: 2000000000n,
      liveInvestedRaw: 50000000000n,
    });

    assert.strictEqual(recallResult.status, "EXECUTED");
    assert.strictEqual(recallResult.shortfallUsdc, "13000.000000");
    assert.ok(recallResult.clearanceCode, "Must receive clearance code from Layer 1 Enforcer");
    assert.ok(recallResult.encodedTx, "Must encode CentralTreasuryYieldVault.recallForAccount");
    assert.ok(recallResult.journalSequenceId, "Must write to Master Journal");
    assert.ok(recallResult.journalHash, "Must produce SHA-256 journal hash");

    // Verify Parallel Tripartite Balance post-recall
    // Pre: Liquid 2,000, Invested 50,000, Available 52,000
    // Post: Liquid 15,000, Invested 37,000, Available 52,000 (Exact Invariant Maintained!)
    assert.strictEqual(recallResult.postBalance.liquidCashUsdc, "15000.000000");
    assert.strictEqual(recallResult.postBalance.investedYieldUsdc, "37000.000000");
    assert.strictEqual(recallResult.postBalance.availableBalanceUsdc, "52000.000000");
    assert.strictEqual(recallResult.postBalance.invariantSatisfied, true);

    // Verify Master Journal Entry (D13D7)
    const journalEntries = await MasterJournalRepo.getEntriesByAccount(testAccountId);
    const recallEntry = journalEntries.find((e) => e.action_type === "PREDICTIVE_RECALL_SETTLED");
    assert.ok(recallEntry, "Journal entry for PREDICTIVE_RECALL_SETTLED must exist");
    assert.strictEqual(recallEntry?.debit_account, `Asset:Cash:USDC:${testAccountId}`);
    assert.strictEqual(recallEntry?.credit_account, `Asset:Investments:USYC:${testAccountId}`);
    assert.strictEqual(recallEntry?.amount_usdc, 13000);
    assert.ok(recallEntry?.current_hash, "Journal entry must have SHA-256 hash");

    // Verify Account Agent Audit Log Entry (D13D7)
    const auditLogs = await AuditLogRepo.getAuditLogsByAccount(testAccountId);
    const recallLog = auditLogs.find((l) => l.action_type === "PREDICTIVE_RECALL_SETTLED");
    assert.ok(recallLog, "Account audit log for PREDICTIVE_RECALL_SETTLED must exist");
    assert.strictEqual(recallLog?.is_autonomous, true);
    assert.strictEqual(recallLog?.post_state_snapshot.clearanceCode, recallResult.clearanceCode);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TOOL REGISTRY INTEGRATION TESTS
  // ─────────────────────────────────────────────────────────────────────────────

  it("Test 8: ToolRegistry handles scan_predictive_liabilities and execute_predictive_recall", async () => {
    // 1. Tool execution: scan_predictive_liabilities
    const scanToolRes = await toolRegistry.executeTool("scan_predictive_liabilities", {
      accountId: testAccountId,
      leadTimeSeconds: 86400,
    });
    assert.strictEqual(scanToolRes.success, true);
    assert.ok(scanToolRes.data.upcomingLiabilitiesCount >= 1);

    // 2. Tool execution: execute_predictive_recall
    const recallToolRes = await toolRegistry.executeTool("execute_predictive_recall", {
      accountId: testAccountId,
      shortfallUsdc: "1000.000000",
      reason: "Supplemental pre-funding via agent tool invocation.",
    });
    assert.strictEqual(recallToolRes.success, true);
    assert.strictEqual(recallToolRes.data.status, "EXECUTED");
    assert.strictEqual(recallToolRes.data.shortfallUsdc, "1000.000000");
  });

  after(async () => {
    await DbClient.closePool();
  });
});
