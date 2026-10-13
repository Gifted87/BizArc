/**
 * D20: Unified Operational State Integration Test Suite
 * =======================================================
 * Validates DAG Node D20 synthesizing the 8 foundational dimensions:
 * 1. Liquid Balances (BL)
 * 2. Tokenized USYC Invested Balances (BY)
 * 3. Total Effective Purchasing Power & Tripartite Invariant (BE = BL + BY)
 * 4. Liabilities Dynamic Record 1 (Upcoming 30d, overdue, category breakdown)
 * 5. Safe-to-Invest Dynamic Record 2 (Evaluation horizon, reserve floors, hysteresis)
 * 6. ERP Sync Status (ERPNext, Odoo, Three-Way Match integrity)
 * 7. Master Journal & Audit State (SHA-256 hash-chain verification, autonomous vs human)
 * 8. Transaction & Policy Governance State (24h spend cap, SPRS, authorized intents, locks)
 *
 * Plus ToolRegistry integration: executeTool("get_unified_operational_state")
 *
 * Zero stubs. Zero mocks. Real PostgreSQL & viem cryptographic verification.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { DbClient } from "../src/database/dbClient.js";
import { TreasuryAccountsRepo } from "../src/database/repos/treasuryAccountsRepo.js";
import { VendorMasterRepo } from "../src/database/repos/vendorMasterRepo.js";
import { LiabilityRepo } from "../src/database/repos/liabilityRepo.js";
import { PermissionRequestRepo } from "../src/database/repos/permissionRequestRepo.js";
import { MasterJournalRepo } from "../src/database/repos/masterJournalRepo.js";
import { ErpSyncRepo } from "../src/database/repos/erpSyncRepo.js";
import { AuditLogRepo } from "../src/database/repos/auditLogRepo.js";
import { AccountLockManager } from "../src/foundation/events/lockManager.js";
import { UnifiedOperationalStateService } from "../src/services/unifiedOperationalStateService.js";
import { ToolRegistry } from "../src/tools/toolRegistry.js";

describe("D20: Unified Operational State Real-World Integration", () => {
  const ts = Date.now();
  const testAcc1 = `acc_d20_ops_${ts}`;
  const testAcc2 = `acc_d20_rsv_${ts}`;
  const wallet1 = `0x${crypto.randomBytes(20).toString("hex")}`;
  const wallet2 = `0x${crypto.randomBytes(20).toString("hex")}`;
  const vendorId = `vnd_d20_${ts}`;
  const vendorPayoutAddr = `0x${crypto.randomBytes(20).toString("hex")}`;
  let liabilityId1: string;
  let liabilityId2: string;
  let sprsRequestId: string;

  let stateService: UnifiedOperationalStateService;
  let toolRegistry: ToolRegistry;

  before(async () => {
    stateService = new UnifiedOperationalStateService();
    toolRegistry = new ToolRegistry();

    // 0. Pre-clean
    await DbClient.query("DELETE FROM dynamic_safe_to_invest WHERE account_id LIKE 'acc_d20_%';");
    await DbClient.query("DELETE FROM master_system_journal WHERE account_id LIKE 'acc_d20_%';");
    await DbClient.query("DELETE FROM account_agent_audit_log WHERE account_id LIKE 'acc_d20_%';");
    await DbClient.query("DELETE FROM account_liabilities WHERE account_id LIKE 'acc_d20_%';");
    await DbClient.query("DELETE FROM erp_sync_state WHERE account_id LIKE 'acc_d20_%';");
    await DbClient.query("DELETE FROM treasury_accounts WHERE account_id LIKE 'acc_d20_%';");

    // 1. Seed Treasury Accounts
    await TreasuryAccountsRepo.upsertAccount({
      account_id: testAcc1,
      name: "D20 Operations Account",
      role: "OPERATING" as any,
      wallet_address: wallet1 as `0x${string}`,
      chain_id: 5042,
      min_operating_floor_usdc: 1000,
      safety_buffer_ratio: 0.2,
      is_active: true,
    });

    await TreasuryAccountsRepo.upsertAccount({
      account_id: testAcc2,
      name: "D20 Reserve Account",
      role: "RESERVE" as any,
      wallet_address: wallet2 as `0x${string}`,
      chain_id: 5042,
      min_operating_floor_usdc: 2500,
      safety_buffer_ratio: 0.15,
      is_active: true,
    });

    // 2. Seed Vendor Master
    await VendorMasterRepo.registerVendor({
      vendor_id: vendorId,
      name: "D20 Cloud Infrastructure Corp",
      verified_payout_address: vendorPayoutAddr as `0x${string}`,
      verified_by_admin: "admin@bizarc.io",
      last_verified_at: new Date(),
      change_lock: true,
    });

    // 3. Seed Liabilities (Record 1)
    const dueSoon = new Date(Date.now() + 5 * 86400 * 1000);
    const overdue = new Date(Date.now() - 2 * 86400 * 1000);

    const liab1 = await LiabilityRepo.createLiability({
      account_id: testAcc1,
      vendor_id: vendorId,
      title: "Monthly Dedicated Servers",
      category: "INFRASTRUCTURE",
      amount_usdc: 750.0,
      due_date: dueSoon,
      status: "SCHEDULED",
      payout_address: vendorPayoutAddr,
    });
    liabilityId1 = liab1.liability_id;

    const liab2 = await LiabilityRepo.createLiability({
      account_id: testAcc1,
      vendor_id: vendorId,
      title: "Past Due Fiber Transit",
      category: "TELECOM",
      amount_usdc: 200.0,
      due_date: overdue,
      status: "SCHEDULED",
      payout_address: vendorPayoutAddr,
    });
    liabilityId2 = liab2.liability_id;

    // 4. Seed ERP Sync Records (D20.B)
    await ErpSyncRepo.upsertSyncState({
      sync_id: `sync_erpnext_${ts}`,
      system_type: "ERPNEXT",
      account_id: testAcc1,
      entity_type: "PAYMENT_ENTRY",
      last_sync_timestamp: new Date(),
      last_synced_document_id: `PE-ERPNEXT-${ts}`,
      status: "SYNCED",
      sync_checkpoint_data: {
        invoiceId: `INV-ERPNEXT-${ts}`,
        txHash: `0x${crypto.randomBytes(32).toString("hex")}`,
        threeWayMatchVerified: true,
      },
    });

    await ErpSyncRepo.upsertSyncState({
      sync_id: `sync_odoo_${ts}`,
      system_type: "ODOO",
      account_id: testAcc1,
      entity_type: "PAYMENT_ENTRY",
      last_sync_timestamp: new Date(),
      last_synced_document_id: `PAY-ODOO-${ts}`,
      status: "SYNCED",
      sync_checkpoint_data: {
        invoiceId: `INV-ODOO-${ts}`,
        odooPaymentId: 8842,
        threeWayMatchVerified: true,
      },
    });

    // 5. Seed Master System Journal vouchers & Hash Chaining
    const voucherHash1 = `0x${crypto.randomBytes(32).toString("hex")}`;
    const voucherHash2 = `0x${crypto.randomBytes(32).toString("hex")}`;

    await MasterJournalRepo.appendEntry({
      account_id: testAcc1,
      action_type: "SWEEP_TO_YIELD",
      debit_account: "USYC_VAULT",
      credit_account: testAcc1,
      amount_usdc: 3000.0,
      document_ref: `rcpt_swp_${ts}`,
    });

    await MasterJournalRepo.appendEntry({
      account_id: testAcc1,
      action_type: "DISBURSAL_PAYMENT",
      debit_account: "DISBURSAL_VAULT",
      credit_account: testAcc1,
      amount_usdc: 750.0,
      document_ref: `rcpt_disb_${ts}`,
    });

    // 6. Seed Account Agent Audit Log entries
    await AuditLogRepo.appendAuditLog({
      account_id: testAcc1,
      action_type: "YIELD_SWEEP",
      amount_usdc: 3000.0,
      is_autonomous: true,
      tx_hash: voucherHash1,
      reason: "Autonomous yield sweep executed inside policy",
      pre_state_snapshot: { liquidUsdc: "10000.000000" },
      post_state_snapshot: { liquidUsdc: "7000.000000", investedUsyc: "3000.000000" },
      actor_agent: "TreasurySentinel",
    });

    await AuditLogRepo.appendAuditLog({
      account_id: testAcc1,
      action_type: "DISBURSAL_EXECUTION",
      amount_usdc: 750.0,
      is_autonomous: false,
      tx_hash: voucherHash2,
      reason: "Human-approved server payment",
      pre_state_snapshot: { liquidUsdc: "7000.000000" },
      post_state_snapshot: { liquidUsdc: "6250.000000" },
      actor_agent: "DisbursalRouter",
    });

    // 7. Seed Pending SPRS
    sprsRequestId = `sprs_${ts}`;
    await PermissionRequestRepo.createRequest({
      request_id: sprsRequestId,
      action_type: "VENDOR_PAYMENT",
      amount_usdc: 1500.0,
      status: "PENDING",
      reason: "Quarterly security penetration testing",
      payload: {
        vendor_id: vendorId,
        conflicting_policy: "Single-transaction limit threshold exceeded ($1500 > $500)",
      },
    });
  });

  after(async () => {
    // Cleanup seeded test fixtures
    await DbClient.query(`DELETE FROM account_liabilities WHERE account_id IN ($1, $2);`, [testAcc1, testAcc2]);
    await DbClient.query(`DELETE FROM erp_sync_state WHERE account_id IN ($1, $2);`, [testAcc1, testAcc2]);
    await DbClient.query(`DELETE FROM account_agent_audit_log WHERE account_id IN ($1, $2);`, [testAcc1, testAcc2]);
    await DbClient.query(`DELETE FROM master_system_journal WHERE account_id IN ($1, $2);`, [testAcc1, testAcc2]);
    await DbClient.query(`DELETE FROM dynamic_safe_to_invest WHERE account_id IN ($1, $2);`, [testAcc1, testAcc2]);
    await DbClient.query(`DELETE FROM permission_requests WHERE request_id = $1;`, [sprsRequestId]);
    await DbClient.query(`DELETE FROM vendor_master_registry WHERE vendor_id = $1;`, [vendorId]);
    await DbClient.query(`DELETE FROM treasury_accounts WHERE account_id IN ($1, $2);`, [testAcc1, testAcc2]);
  });

  it("1. should compute balance dimensions and verify the Tripartite Invariant (BL + BY = BE)", async () => {
    const balanceOverrides = {
      [testAcc1]: { liquidUsdc: "5000.000000", investedUsyc: "10000.000000" },
      [testAcc2]: { liquidUsdc: "2500.000000", investedUsyc: "5000.000000" },
    };

    const state = await stateService.getUnifiedOperationalState({ balanceOverrides });

    assert.ok(state.timestamp, "State must have an ISO timestamp");
    assert.strictEqual(state.currency, "USDC");
    assert.ok(state.activeProfile, "Active profile should be defined");

    // Tripartite Invariant check
    assert.strictEqual(state.balances.tripartiteInvariantVerified, true, "Tripartite invariant must hold");
    const sum = state.balances.totalLiquidRaw + state.balances.totalInvestedRaw;
    assert.strictEqual(sum, state.balances.totalEffectiveRaw, "Liquid + Invested must equal Effective raw");

    // Solvency Health
    assert.strictEqual(state.balances.solvencyHealth.isSolvent, true, "Company should be solvent");
    assert.ok(state.balances.solvencyHealth.healthRatio >= 1.0, "Health ratio must be >= 1.0");

    // Verify account inclusion
    const acc1State = state.balances.accounts.find((a) => a.accountId === testAcc1);
    assert.ok(acc1State, "Test Account 1 must be present in accounts breakdown");
    assert.strictEqual(acc1State.liquidUsdc, "5000.000000");
    assert.strictEqual(acc1State.investedUsyc, "10000.000000");
    assert.strictEqual(acc1State.totalEffectiveUsdc, "15000.000000");
  });

  const defaultOverrides = {
    [testAcc1]: { liquidUsdc: 5000, investedUsyc: 10000 },
    [testAcc2]: { liquidUsdc: 2500, investedUsyc: 5000 },
  };

  it("2. should correctly evaluate Liabilities (Dynamic Record 1) with overdue flags and category breakdown", async () => {
    const state = await stateService.getUnifiedOperationalState({
      accountId: testAcc1,
      balanceOverrides: defaultOverrides,
      horizonDays: 30,
    });

    const liabilities = state.liabilities;
    assert.ok(liabilities.totalLiabilitiesCount >= 2, "Must include the 2 seeded liabilities");
    assert.ok(liabilities.activeScheduledCount >= 2, "Active scheduled liabilities count should match");

    // Category breakdown should contain INFRASTRUCTURE and TELECOM
    assert.ok("INFRASTRUCTURE" in liabilities.categoryBreakdown, "INFRASTRUCTURE category must be present");
    assert.strictEqual(liabilities.categoryBreakdown["INFRASTRUCTURE"], "750.000000");

    assert.ok("TELECOM" in liabilities.categoryBreakdown, "TELECOM category must be present");
    assert.strictEqual(liabilities.categoryBreakdown["TELECOM"], "200.000000");

    // Overdue liability verification
    const overdueItem = liabilities.upcomingItems.find((item) => item.liabilityId === liabilityId2);
    assert.ok(overdueItem, "Overdue liability must be in upcoming items");
    assert.strictEqual(overdueItem.isOverdue, true, "Overdue flag must be true");
    assert.strictEqual(overdueItem.amountUsdc, "200.000000");

    const upcomingItem = liabilities.upcomingItems.find((item) => item.liabilityId === liabilityId1);
    assert.ok(upcomingItem, "Upcoming liability must be in upcoming items");
    assert.strictEqual(upcomingItem.isOverdue, false, "Upcoming liability must not be marked overdue");
  });

  it("3. should calculate Safe-to-Invest Horizon (Dynamic Record 2) with hysteresis bands", async () => {
    const balanceOverrides = {
      [testAcc1]: { liquidUsdc: 8000, investedUsyc: 12000 },
    };

    const state = await stateService.getUnifiedOperationalState({
      accountId: testAcc1,
      balanceOverrides,
      horizonDays: 30,
    });

    const horizon = state.safeToInvestHorizon;
    assert.strictEqual(horizon.evaluationHorizonDays, 30);
    assert.ok(horizon.hysteresis.investHysteresisBandUsdc >= 0, "Invest hysteresis band must be non-negative");
    assert.ok(horizon.hysteresis.recallHysteresisBandUsdc >= 0, "Recall hysteresis band must be non-negative");
    assert.ok(horizon.hysteresis.minSweepAmountUsdc >= 0, "Min sweep amount must be non-negative");

    const accRecord = horizon.accountRecords.find((r) => r.accountId === testAcc1);
    assert.ok(accRecord, "Account record must exist in safeToInvest horizon");
    assert.strictEqual(accRecord.status, "SAFE_TO_INVEST", "Excess liquid funds should yield SAFE_TO_INVEST");
    assert.ok(accRecord.safeToInvestRaw > 0n, "Safe to invest raw must be greater than zero");
  });

  it("4. should report ERP Sync Status (D20.B) and Three-Way Match integrity", async () => {
    const state = await stateService.getUnifiedOperationalState({
      accountId: testAcc1,
      balanceOverrides: defaultOverrides,
    });

    const erp = state.erpSyncStatus;
    assert.strictEqual(erp.overallStatus, "SYNCED");
    assert.strictEqual(erp.threeWayMatchIntegrity, true, "Three-way match integrity must be true");
    assert.strictEqual(erp.unreconciledCount, 0, "No unreconciled checkpoints should exist");

    assert.strictEqual(erp.erpNext.status, "CONNECTED");
    assert.ok(erp.erpNext.lastDocName?.startsWith("PE-ERPNEXT-"), "Last synced doc name should match ERPNext seed");

    assert.strictEqual(erp.odoo.status, "CONNECTED");
    assert.strictEqual(erp.odoo.lastPaymentId, 8842, "Odoo last payment ID should match 8842");

    assert.ok(erp.recentCheckpoints.length >= 2, "Checkpoints list must contain both ERP systems");
  });

  it("5. should verify Master System Journal SHA-256 hash chain and audit state (D7 / D19d7)", async () => {
    const state = await stateService.getUnifiedOperationalState({
      accountId: testAcc1,
      balanceOverrides: defaultOverrides,
      includeAuditHistoryLimit: 10,
    });

    const audit = state.auditState;
    // Master System Journal
    assert.ok(audit.masterJournal.totalVouchersCount >= 2, "Should have at least 2 vouchers");
    assert.strictEqual(audit.masterJournal.chainIntegrityVerified, true, "Hash chain integrity must be verified");
    assert.ok(audit.masterJournal.headBlockHash.length === 64, "Head block hash should be a 64-char SHA256 hex");

    // Audit Log
    assert.ok(audit.auditLog.totalAuditEntries >= 2, "Should have at least 2 audit entries");
    assert.ok(audit.auditLog.autonomousActionsCount >= 1, "Should record autonomous action");
    assert.ok(audit.auditLog.humanSupervisedActionsCount >= 1, "Should record human supervised action");

    const autonomousEvent = audit.auditLog.recentAuditEvents.find((e) => e.isAutonomous);
    assert.ok(autonomousEvent, "Autonomous event must be recorded");
    assert.strictEqual(autonomousEvent.actionType, "YIELD_SWEEP");
  });

  it("6. should report Transaction State with spending limits, SPRS, and account locks (D16 / D17 / D19)", async () => {
    // Acquire a temporary concurrency lock on testAcc1
    const lockAcquired = AccountLockManager.acquireLock(testAcc1, "D20 testing concurrency state");
    assert.strictEqual(lockAcquired, true, "Should acquire lock");

    try {
      const state = await stateService.getUnifiedOperationalState({
        balanceOverrides: defaultOverrides,
      });

      const tx = state.transactionState;
      assert.ok(parseFloat(tx.spendingLimits.dailyHardCapUsdc) > 0, "Daily hard cap should be positive");
      assert.ok(parseFloat(tx.spendingLimits.dailyRemainingUsdc) <= parseFloat(tx.spendingLimits.dailyHardCapUsdc));

      // Pending SPRS
      assert.ok(tx.pendingSprs.count >= 1, "Should have at least 1 pending SPRS");
      const foundSprs = tx.pendingSprs.requests.find((r) => r.requestId === sprsRequestId);
      assert.ok(foundSprs, "Seeded SPRS must be present");
      assert.strictEqual(foundSprs.amountUsdc, 1500.0);
      assert.ok(foundSprs.conflictingPolicy?.includes("Single-transaction limit threshold exceeded"));

      // Concurrency Locks
      assert.ok(tx.activeAccountLocks.includes(testAcc1), "testAcc1 should be listed in active account locks");
    } finally {
      AccountLockManager.releaseLock(testAcc1);
    }
  });

  it("7. should execute get_unified_operational_state via ToolRegistry tool call", async () => {
    const result = await toolRegistry.executeTool("get_unified_operational_state", {
      accountId: testAcc1,
      horizonDays: 14,
      balanceOverrides: {
        [testAcc1]: { liquidUsdc: "12000.000000", investedUsyc: "6000.000000" },
      },
    });

    assert.strictEqual(result.success, true, "ToolRegistry tool call must succeed");
    assert.ok(result.data, "Tool result must contain data payload");

    const state = result.data;
    assert.strictEqual(state.currency, "USDC");
    assert.strictEqual(state.safeToInvestHorizon.evaluationHorizonDays, 14);
    assert.strictEqual(state.balances.accounts.length, 1);
    assert.strictEqual(state.balances.accounts[0].accountId, testAcc1);
    assert.strictEqual(state.balances.accounts[0].totalEffectiveUsdc, "18000.000000");
    assert.strictEqual(state.erpSyncStatus.overallStatus, "SYNCED");
    assert.strictEqual(state.auditState.masterJournal.chainIntegrityVerified, true);
  });

  after(async () => {
    await DbClient.closePool();
  });
});
