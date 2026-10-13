/**
 * D16 -> D17 -> D18 -> D19 -> D19d7 -> D19d20.B Real-World Integration Test
 * ===========================================================================
 * Comprehensive verification of the Autonomous Disbursal Execution Chain:
 *
 * D16: PolicyComplianceAgent (The Governance Gatekeeper & Enforcer)
 *   - Mathematical Rules (floors, daily caps) & Declared Policies.
 *   - Reason-Bearing Intent verification.
 *   - Tri-State Decisions: PERMIT, DENY, ESCALATE_TO_SPRS.
 *
 * D17: AuthorizationGate.authorizeTransactionIntent()
 *   - Human SPRS approval with cryptographic receipt hash & audit logging.
 *
 * D18: DisbursalRouterService.stageFunds()
 *   - Automatic USYC recall when needed + staging funds to DisbursalVault.
 *   - Double-entry staging vouchers in master system journal.
 *
 * D19: DisbursalVault.executePayment()
 *   - Calldata encoding, Keccak-256 idempotency key, settlement txHash.
 *
 * D19d7: LedgerWitnessService
 *   - Master system journal hash chaining & immutable account audit trail.
 *
 * D19d20.B: ErpReconciliationService
 *   - Document-linked Payment Entry to ERPNext and Odoo.
 *   - Three-Way Match verification.
 *   - Checkpoint persistence in erp_sync_state.
 *
 * ToolRegistry Integration:
 *   - qualify_disbursal_route, authorize_transaction_intent, execute_disbursal_route.
 *
 * Zero stubs. Zero mocks. Real PostgreSQL & viem cryptographic primitives.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { DbClient } from "../src/database/dbClient.js";
import { TreasuryAccountsRepo } from "../src/database/repos/treasuryAccountsRepo.js";
import { VendorMasterRepo } from "../src/database/repos/vendorMasterRepo.js";
import { LiabilityRepo } from "../src/database/repos/liabilityRepo.js";
import { PermissionRequestRepo } from "../src/database/repos/permissionRequestRepo.js";
import { MasterJournalRepo } from "../src/database/repos/masterJournalRepo.js";
import { ErpSyncRepo } from "../src/database/repos/erpSyncRepo.js";
import { DynamicRecordsService } from "../src/records/dynamicRecordsService.js";
import { DisbursalRouterService } from "../src/services/disbursalRouterService.js";
import { UnifiedAssetAggregatorService } from "../src/services/unifiedAssetAggregatorService.js";
import { LedgerWitnessService } from "../src/services/ledgerWitnessService.js";
import { CentralTreasuryYieldVaultService } from "../src/contracts/centralTreasuryYieldVaultService.js";
import { DisbursalVaultService } from "../src/contracts/disbursalVaultService.js";
import { ErpReconciliationService } from "../src/services/erpReconciliationService.js";
import { PolicyComplianceLlmAgent } from "../src/agents/policyComplianceLlmAgent.js";
import { AuthorizationGate } from "../src/security/authorizationGate.js";
import { ToolRegistry } from "../src/tools/toolRegistry.js";

describe("D16 -> D17 -> D18 -> D19 -> D19d7 -> D19d20.B: Autonomous Disbursal Execution Chain", () => {
  const timestamp = Date.now();
  const testEngineeringAccount = `acc_chain_eng_${timestamp}`;
  const testMarketingAccount = `acc_chain_mkt_${timestamp}`;
  const testPayrollAccount = `acc_chain_pay_${timestamp}`;

  const hexSuffix = timestamp.toString(16).slice(-8);
  const engWallet = `0xaaaaaaaaaaaaaaaaaaaaaaaaaaaa${hexSuffix}` as `0x${string}`;
  const mktWallet = `0xbbbbbbbbbbbbbbbbbbbbbbbbbbbb${hexSuffix}` as `0x${string}`;
  const payWallet = `0xcccccccccccccccccccccccccccc${hexSuffix}` as `0x${string}`;

  const testVendorId = `vendor_chain_cloud_${timestamp}`;
  const testVendorPayoutAddress = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as `0x${string}`;
  const testVendorUnverifiedAddress = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as `0x${string}`;

  let dynamicRecords: DynamicRecordsService;
  let aggregator: UnifiedAssetAggregatorService;
  let witnessService: LedgerWitnessService;
  let vaultService: CentralTreasuryYieldVaultService;
  let disbursalVault: DisbursalVaultService;
  let erpReconciliation: ErpReconciliationService;
  let disbursalRouter: DisbursalRouterService;
  let policyAgent: PolicyComplianceLlmAgent;
  let toolRegistry: ToolRegistry;

  before(async () => {
    // 0. Pre-clean any lingering accounts from prior aborted runs
    await DbClient.query("DELETE FROM dynamic_safe_to_invest WHERE account_id LIKE 'acc_chain_%';");
    await DbClient.query("DELETE FROM master_system_journal WHERE account_id LIKE 'acc_chain_%';");
    await DbClient.query("DELETE FROM account_agent_audit_log WHERE account_id LIKE 'acc_chain_%';");
    await DbClient.query("DELETE FROM account_liabilities WHERE account_id LIKE 'acc_chain_%';");
    await DbClient.query("DELETE FROM erp_sync_state WHERE account_id LIKE 'acc_chain_%';");
    await DbClient.query("DELETE FROM treasury_accounts WHERE account_id LIKE 'acc_chain_%';");

    // 1. Seed test treasury accounts
    await TreasuryAccountsRepo.upsertAccount({
      account_id: testEngineeringAccount,
      name: "Chain Engineering Ops",
      role: "OPEX_DEV",
      wallet_address: engWallet,
      chain_id: 5042,
      min_operating_floor_usdc: 10.0,
      safety_buffer_ratio: 1.1,
      is_active: true,
    });

    await TreasuryAccountsRepo.upsertAccount({
      account_id: testMarketingAccount,
      name: "Chain Marketing Ops",
      role: "OPEX_GROWTH",
      wallet_address: mktWallet,
      chain_id: 5042,
      min_operating_floor_usdc: 10.0,
      safety_buffer_ratio: 1.1,
      is_active: true,
    });

    await TreasuryAccountsRepo.upsertAccount({
      account_id: testPayrollAccount,
      name: "Chain Payroll Escrow",
      role: "PAYROLL",
      wallet_address: payWallet,
      chain_id: 5042,
      min_operating_floor_usdc: 100.0,
      safety_buffer_ratio: 1.5,
      is_active: true,
    });

    // 2. Register verified vendor in Vendor Master (Rule 3)
    await VendorMasterRepo.registerVendor({
      vendor_id: testVendorId,
      name: "Chain Infrastructure AWS",
      verified_payout_address: testVendorPayoutAddress,
      verified_by_admin: "cfo@bizarc.io",
      last_verified_at: new Date(),
      change_lock: true,
    });

    // 3. Initialize Services
    dynamicRecords = new DynamicRecordsService();
    aggregator = new UnifiedAssetAggregatorService({ dynamicRecords });
    witnessService = new LedgerWitnessService();
    vaultService = new CentralTreasuryYieldVaultService("0x4444444444444444444444444444444444444444");
    disbursalVault = new DisbursalVaultService("0x5555555555555555555555555555555555555555");
    erpReconciliation = new ErpReconciliationService();
    disbursalRouter = new DisbursalRouterService({
      aggregator,
      dynamicRecords,
      vaultService,
      disbursalVault,
      witnessService,
      erpReconciliation,
    });
    policyAgent = new PolicyComplianceLlmAgent();
    toolRegistry = new ToolRegistry(
      undefined,
      dynamicRecords,
      undefined,
      policyAgent,
      undefined,
      undefined,
      witnessService,
      vaultService,
      aggregator,
      disbursalRouter,
      erpReconciliation
    );
  });

  after(async () => {
    // Cleanup created test records
    await DbClient.query("DELETE FROM erp_sync_state WHERE account_id = $1;", [testEngineeringAccount]);
    await DbClient.query("DELETE FROM master_system_journal WHERE account_id IN ($1, $2, $3);", [
      testEngineeringAccount,
      testMarketingAccount,
      testPayrollAccount,
    ]);
    await DbClient.query("DELETE FROM account_agent_audit_log WHERE account_id IN ($1, $2, $3);", [
      testEngineeringAccount,
      testMarketingAccount,
      testPayrollAccount,
    ]);
    await DbClient.query("DELETE FROM account_liabilities WHERE account_id IN ($1, $2, $3);", [
      testEngineeringAccount,
      testMarketingAccount,
      testPayrollAccount,
    ]);
    await DbClient.query("DELETE FROM dynamic_safe_to_invest WHERE account_id IN ($1, $2, $3);", [
      testEngineeringAccount,
      testMarketingAccount,
      testPayrollAccount,
    ]);
    await DbClient.query("DELETE FROM vendor_master_registry WHERE vendor_id = $1;", [testVendorId]);
    await DbClient.query("DELETE FROM treasury_accounts WHERE account_id IN ($1, $2, $3);", [
      testEngineeringAccount,
      testMarketingAccount,
      testPayrollAccount,
    ]);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. D16: PolicyComplianceAgent & AuthorizationGate
  // ─────────────────────────────────────────────────────────────────────────────

  it("D16-1: Permitted inside-the-rules action receives Layer 1 clearance code and token", async () => {
    const authResult = await AuthorizationGate.requestAuthorization({
      actionType: "DISBURSAL_SETTLEMENT",
      accountId: testEngineeringAccount,
      amountUsdc: "25.000000",
      declaredReason: "Monthly AWS cloud computing and container clusters (PO-AWS-2026-01).",
      recipientAddress: testVendorPayoutAddress,
    });

    assert.equal(authResult.isAuthorized, true);
    assert.equal(authResult.layer, "ENFORCER_AGENT");
    assert.ok(authResult.clearanceCode?.startsWith("CLEAR-"));
  });

  it("D16-2: Payee substitution attempt (Rule 3) is strictly DENIED", async () => {
    const authResult = await AuthorizationGate.requestAuthorization({
      actionType: "DISBURSAL_SETTLEMENT",
      accountId: testEngineeringAccount,
      amountUsdc: "25.000000",
      declaredReason: "Rogue payout to unverified third-party address.",
      recipientAddress: testVendorUnverifiedAddress,
    });

    assert.equal(authResult.isAuthorized, false);
    assert.ok(authResult.reason.includes("PAYEE SUBSTITUTION DETECTED"));
  });

  it("D16-3: Payroll account misuse is strictly DENIED", async () => {
    const authResult = await AuthorizationGate.requestAuthorization({
      actionType: "DISBURSAL_SETTLEMENT",
      accountId: testPayrollAccount,
      amountUsdc: "100.000000",
      declaredReason: "Attempt to pay SaaS vendor from payroll account.",
      recipientAddress: testVendorPayoutAddress,
    });

    assert.equal(authResult.isAuthorized, false);
    assert.ok(authResult.reason.includes("HARD INVARIANT VIOLATION"));
  });

  it("D16-4: High-value payment (> $500 cap) escalates to Layer 2 Human SPRS", async () => {
    const authResult = await AuthorizationGate.requestAuthorization({
      actionType: "DISBURSAL_SETTLEMENT",
      accountId: testEngineeringAccount,
      amountUsdc: "1500.000000",
      declaredReason: "Annual enterprise server reservation requiring executive clearance.",
      recipientAddress: testVendorPayoutAddress,
    });

    assert.equal(authResult.isAuthorized, false);
    assert.equal(authResult.layer, "HUMAN");
    assert.ok(authResult.sprsRequestId?.startsWith("SPRS_"));

    // Verify SPRS record created in database
    const sprsRecord = await PermissionRequestRepo.getRequestById(authResult.sprsRequestId!);
    assert.ok(sprsRecord);
    assert.equal(sprsRecord.status, "PENDING");
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. D17: Authorize Transaction Intent
  // ─────────────────────────────────────────────────────────────────────────────

  it("D17-1: Corporate admin authorizes pending SPRS, recording authorization receipt hash", async () => {
    // Generate SPRS first
    const authResult = await AuthorizationGate.requestAuthorization({
      actionType: "DISBURSAL_SETTLEMENT",
      accountId: testEngineeringAccount,
      amountUsdc: "800.000000",
      declaredReason: "Critical GPU cluster expansion for model fine-tuning (PO-GPU-99).",
      recipientAddress: testVendorPayoutAddress,
    });

    assert.ok(authResult.sprsRequestId);

    // Human CFO signs off with authentic EIP-712 signature
    const adminSignature = await AuthorizationGate.createAdminSignature({
      permissionRequestId: authResult.sprsRequestId!,
      actionType: "DISBURSAL_SETTLEMENT",
      accountId: testEngineeringAccount,
      amountUsdc: "800.000000",
    });

    const authReceipt = await AuthorizationGate.authorizeTransactionIntent({
      permissionRequestId: authResult.sprsRequestId!,
      approverEmail: "cfo@bizarc.io",
      adminSignature,
      executionPayload: { targetContract: disbursalVault.getAddress() },
    });

    assert.equal(authReceipt.status, "AUTHORIZED");
    assert.ok(authReceipt.authorizationReceiptHash.startsWith("0x"));

    // Confirm SPRS is marked APPROVED in database
    const updatedSprs = await PermissionRequestRepo.getRequestById(authResult.sprsRequestId!);
    assert.equal(updatedSprs?.status, "APPROVED");

    // Verify AuthorizationGate now recognizes it as authorized under Layer 2
    const verifyResult = await AuthorizationGate.verifyAuthorization({
      actionType: "DISBURSAL_SETTLEMENT",
      accountId: testEngineeringAccount,
      amountUsdc: "800.000000",
      sprsRequestId: authResult.sprsRequestId,
    });

    assert.equal(verifyResult.isAuthorized, true);
    assert.equal(verifyResult.layer, "HUMAN");
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. D18: Stage Funds into DisbursalVault
  // ─────────────────────────────────────────────────────────────────────────────

  it("D18-1: Staging funds moves capital into DisbursalVault with double-entry journal vouchers", async () => {
    const qualification = await disbursalRouter.qualifyDisbursalRoute({
      invoiceId: "INV-STAGE-001",
      vendorId: testVendorId,
      payoutAddress: testVendorPayoutAddress,
      amountUsdc: "45.000000",
      category: "INFRASTRUCTURE",
      declaredReason: "Compute capacity invoice staging test.",
      balanceOverrides: {
        [testEngineeringAccount]: { liquidUsdc: 100, investedUsyc: 50 },
      },
    });

    assert.equal(qualification.isQualified, true);

    const staged = await disbursalRouter.stageFunds(qualification);

    assert.equal(staged.status, "FUNDS_STAGED");
    assert.equal(staged.totalStagedUsdc, "45.000000");
    assert.equal(staged.allocations.length, 1);
    assert.equal(staged.allocations[0].accountId, testEngineeringAccount);

    // Verify double-entry staging voucher was posted to master journal
    const entries = await MasterJournalRepo.getEntriesByAccount(testEngineeringAccount);
    const stageEntry = entries.find((e) => e.document_ref.includes("INV-STAGE-001"));
    assert.ok(stageEntry, "Staging journal voucher must exist in master system journal");
    assert.equal(stageEntry.amount_usdc, 45.0);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. D19, D19d7, D19d20.B: Disbursal Execution & Dual Reconciliation
  // ─────────────────────────────────────────────────────────────────────────────

  it("D19-1: executeDisbursalRoute completes full settlement with DisbursalVault, LedgerWitness, and ERP sync", async () => {
    const qualification = await disbursalRouter.qualifyDisbursalRoute({
      invoiceId: "INV-EXEC-999",
      vendorId: testVendorId,
      payoutAddress: testVendorPayoutAddress,
      amountUsdc: "30.000000",
      category: "INFRASTRUCTURE",
      declaredReason: "Routine cloud billing PO-CLOUD-2026.",
      balanceOverrides: {
        [testEngineeringAccount]: { liquidUsdc: 200, investedUsyc: 100 },
      },
    });

    assert.equal(qualification.isQualified, true);

    // Execute route
    const execution = await disbursalRouter.executeDisbursalRoute({
      qualification,
    });

    // D19 Onchain Settlement & Idempotency
    assert.equal(execution.status, "SETTLED");
    assert.equal(execution.idempotencyKey, qualification.idempotencyKey);
    assert.ok(execution.txHash?.startsWith("0x"));
    assert.ok(execution.encodedCalldata?.startsWith("0x"));

    // D19d7 Ledger Witnessing
    assert.ok(execution.journalSequenceId);
    assert.ok(execution.journalHash);
    const journalEntries = await MasterJournalRepo.getEntriesByAccount(testEngineeringAccount);
    const disbursalVoucher = journalEntries.find((e) => e.document_ref === "DISB_DOC_INV-EXEC-999");
    assert.ok(disbursalVoucher, "Disbursal voucher must be written by LedgerWitness");
    assert.equal(disbursalVoucher.amount_usdc, 30.0);

    // D19d20.B ERP Reconciliation Syncer
    assert.ok(execution.erpSync);
    assert.equal(execution.erpSync.status, "SYNCED");
    assert.equal(execution.erpSync.threeWayMatchVerified, true);
    assert.ok(execution.erpSync.erpNextDocName);
    assert.ok(execution.erpSync.odooPaymentId);

    // Verify PostgreSQL erp_sync_state checkpoint
    const syncRes = await DbClient.query("SELECT * FROM erp_sync_state WHERE account_id = $1;", [testEngineeringAccount]);
    const syncRecords = syncRes.rows;
    const checkpoint = syncRecords.find((r: any) => r.sync_id.includes("INV-EXEC-999"));
    assert.ok(checkpoint, "ERP sync checkpoint record must be persisted in database");
    assert.equal(checkpoint.status, "SYNCED");
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. ToolRegistry Disbursal Tools Execution
  // ─────────────────────────────────────────────────────────────────────────────

  it("ToolRegistry: qualify_disbursal_route and execute_disbursal_route tools execute successfully", async () => {
    // 1. qualify_disbursal_route
    const qualifyRes = await toolRegistry.executeTool("qualify_disbursal_route", {
      invoiceId: "INV-TOOL-001",
      vendorId: testVendorId,
      payoutAddress: testVendorPayoutAddress,
      amountUsdc: "15.000000",
      category: "INFRASTRUCTURE",
      declaredReason: "Docker registry annual subscription PO-DOC-1.",
      balanceOverrides: {
        [testEngineeringAccount]: { liquidUsdc: 150, investedUsyc: 50 },
      },
    });

    assert.equal(qualifyRes.success, true);
    assert.ok(qualifyRes.data);
    const qual = qualifyRes.data;
    assert.equal(qual.isQualified, true);

    // 2. execute_disbursal_route
    const execRes = await toolRegistry.executeTool("execute_disbursal_route", {
      qualification: qual,
    });

    assert.equal(execRes.success, true);
    assert.equal(execRes.data.status, "SETTLED");
    assert.ok(execRes.data.txHash);
    assert.equal(execRes.data.erpSync.status, "SYNCED");
  });
});
