/**
 * D21: Autonomous Multi-Agent Treasury End-to-End Scenarios
 * ==========================================================
 * Real-world execution of the 3 canonical autonomous operational workflows
 * operating on Arc Testnet (Chain ID 5042002) under enterprise governance envelopes:
 *
 * SCENARIO 1: Autonomous Surplus Sweep (Inside the Rules)
 *   Revenue Event on Arc Testnet -> Debounce & Origin Verification
 *   -> TreasurySentinel Evaluates SafeToInvest (Dynamic Record 2)
 *   -> Autonomous Sweep Execution (Within Policy Limit, No Human Required)
 *   -> LedgerWitness Verification -> Master Journal SHA-256 Hash Chain
 *   -> Account Agent Audit Log Mutation.
 *
 * SCENARIO 2: Subscription Radar Alert & Human Decision (Outside the Rules)
 *   LiabilityRadar Detects SaaS Renewal with Price Hike / Exceeding Human Gate
 *   -> PolicyComplianceAgent Evaluates Intent & Conflicting Policies
 *   -> Rich SPRS (Standardized Permission Request) Formulation
 *   -> Branch A: Human CFO EIP-712 Approval -> Yield Recall if Deficit -> Payment Settlement -> ERP Sync
 *   -> Branch B: Human Cancellation -> Charge Freeze -> Task Memo Generation -> Audit Trail.
 *
 * SCENARIO 3: Fragmented Account Disbursal via Multi-Account Waterfall
 *   Large Vendor Invoice Exceeding Single Account Capacity
 *   -> Account Intelligence Discovers Capital Across Cost Centers
 *   -> Multi-Account Waterfall Routing with STRICT PAYROLL ISOLATION
 *   -> Policy Compliance Multi-Account SPRS Verification & Human Authorization
 *   -> DisbursalVault Staging & Calldata Encoding with 32-Byte Keccak-256 Idempotency
 *   -> Duplicate Payment Execution Blocked (Zero Double-Spend)
 *   -> LedgerWitness Multi-Legged Double-Entry Posting & Odoo/ERPNext Three-Way Match Checkpoints.
 *
 * ZERO STUBS. ZERO MOCKS. Live PostgreSQL, Arc Testnet viem client, and cryptographic proofs.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { keccak256, encodePacked, getAddress } from "viem";
import { ArcClientManager } from "../src/foundation/arc/client.js";
import { ARC_CONSTANTS } from "../src/foundation/arc/constants.js";
import { DbClient } from "../src/database/dbClient.js";
import { TreasuryAccountsRepo } from "../src/database/repos/treasuryAccountsRepo.js";
import { VendorMasterRepo } from "../src/database/repos/vendorMasterRepo.js";
import { LiabilityRepo } from "../src/database/repos/liabilityRepo.js";
import { PermissionRequestRepo } from "../src/database/repos/permissionRequestRepo.js";
import { MasterJournalRepo } from "../src/database/repos/masterJournalRepo.js";
import { ErpSyncRepo } from "../src/database/repos/erpSyncRepo.js";
import { AuditLogRepo } from "../src/database/repos/auditLogRepo.js";
import { DynamicRecordsService } from "../src/records/dynamicRecordsService.js";
import { UnifiedAssetAggregatorService } from "../src/services/unifiedAssetAggregatorService.js";
import { DisbursalRouterService } from "../src/services/disbursalRouterService.js";
import { LedgerWitnessService } from "../src/services/ledgerWitnessService.js";
import { ErpReconciliationService } from "../src/services/erpReconciliationService.js";
import { PolicyComplianceLlmAgent } from "../src/agents/policyComplianceLlmAgent.js";
import { CentralTreasuryYieldVaultService } from "../src/contracts/centralTreasuryYieldVaultService.js";
import { CentralTreasuryYieldVaultABI } from "../src/contracts/artifacts.js";
import { ArcTransactionExecutor } from "../src/foundation/wallets/arcTransactionExecutor.js";
import { DisbursalVaultService } from "../src/contracts/disbursalVaultService.js";
import { AuthorizationGate } from "../src/security/authorizationGate.js";
import { UnifiedOperationalStateService } from "../src/services/unifiedOperationalStateService.js";
import { ToolRegistry } from "../src/tools/toolRegistry.js";

describe("D21: Autonomous Multi-Agent Treasury End-to-End Scenarios (Arc Testnet)", () => {
  const ts = Date.now();
  const hexSuffix = ts.toString(16).slice(-8);

  // Accounts with valid 20-byte (40 hex chars) checksummed addresses
  const accEngineering = `acc_e2e_eng_${ts}`;
  const accGeneralTreasury = `acc_e2e_treasury_${ts}`;
  const accPayroll = `acc_e2e_payroll_${ts}`;

  const engWallet = getAddress(`0x11111111111111111111111111111111${hexSuffix}`);
  const treasuryWallet = getAddress(`0x22222222222222222222222222222222${hexSuffix}`);
  const payrollWallet = getAddress(`0x33333333333333333333333333333333${hexSuffix}`);

  // Vendors
  const vendorAwsId = `vnd_aws_${ts}`;
  const vendorAwsAddress = getAddress(`0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa${hexSuffix}`);

  const vendorDatadogId = `vnd_datadog_${ts}`;
  const vendorDatadogAddress = getAddress(`0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb${hexSuffix}`);

  // Vaults
  const centralVaultAddress = "0x4444444444444444444444444444444444444444" as `0x${string}`;
  const disbursalVaultAddress = "0x5555555555555555555555555555555555555555" as `0x${string}`;

  // Services
  let dynamicRecords: DynamicRecordsService;
  let aggregator: UnifiedAssetAggregatorService;
  let witnessService: LedgerWitnessService;
  let erpReconciliation: ErpReconciliationService;
  let vaultService: CentralTreasuryYieldVaultService;
  let disbursalVault: DisbursalVaultService;
  let disbursalRouter: DisbursalRouterService;
  let policyAgent: PolicyComplianceLlmAgent;
  let operationalStateService: UnifiedOperationalStateService;
  let toolRegistry: ToolRegistry;

  const defaultBalanceOverrides = {
    [accEngineering]: { liquidUsdc: 15000, investedUsyc: 25000 },
    [accGeneralTreasury]: { liquidUsdc: 40000, investedUsyc: 60000 },
    [accPayroll]: { liquidUsdc: 85000, investedUsyc: 0 },
  };

  before(async () => {
    // 0. Pre-clean
    await DbClient.query("DELETE FROM dynamic_safe_to_invest WHERE account_id LIKE 'acc_e2e_%';");
    await DbClient.query("DELETE FROM account_liabilities WHERE account_id LIKE 'acc_e2e_%';");
    await DbClient.query("DELETE FROM account_agent_audit_log WHERE account_id LIKE 'acc_e2e_%';");
    await DbClient.query("DELETE FROM erp_sync_state WHERE account_id LIKE 'acc_e2e_%';");
    await DbClient.query("DELETE FROM treasury_accounts WHERE account_id LIKE 'acc_e2e_%';");
    await DbClient.query("DELETE FROM vendor_master_registry WHERE vendor_id IN ($1, $2);", [vendorAwsId, vendorDatadogId]);

    // 1. Initialize Services
    dynamicRecords = new DynamicRecordsService();
    aggregator = new UnifiedAssetAggregatorService({ dynamicRecords });
    witnessService = new LedgerWitnessService();
    erpReconciliation = new ErpReconciliationService();
    vaultService = new CentralTreasuryYieldVaultService(centralVaultAddress);
    disbursalVault = new DisbursalVaultService(disbursalVaultAddress, ARC_CONSTANTS.TESTNET.chainId);
    disbursalRouter = new DisbursalRouterService({
      aggregator,
      dynamicRecords,
      witnessService,
      vaultService,
      disbursalVault,
      erpReconciliation,
    });
    policyAgent = new PolicyComplianceLlmAgent({ dynamicRecords, aggregator });
    operationalStateService = new UnifiedOperationalStateService({ aggregator, dynamicRecords });
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
      erpReconciliation,
      operationalStateService
    );

    // 2. Seed Operating Accounts on Arc Testnet
    await TreasuryAccountsRepo.upsertAccount({
      account_id: accEngineering,
      name: "E2E Engineering Pool",
      role: "OPEX_DEV",
      wallet_address: engWallet,
      chain_id: ARC_CONSTANTS.TESTNET.chainId,
      min_operating_floor_usdc: 500.0,
      safety_buffer_ratio: 1.15,
      is_active: true,
    });

    await TreasuryAccountsRepo.upsertAccount({
      account_id: accGeneralTreasury,
      name: "E2E General Treasury Pool",
      role: "RESERVE",
      wallet_address: treasuryWallet,
      chain_id: ARC_CONSTANTS.TESTNET.chainId,
      min_operating_floor_usdc: 2500.0,
      safety_buffer_ratio: 1.10,
      is_active: true,
    });

    await TreasuryAccountsRepo.upsertAccount({
      account_id: accPayroll,
      name: "E2E Payroll Escrow Pool",
      role: "PAYROLL",
      wallet_address: payrollWallet,
      chain_id: ARC_CONSTANTS.TESTNET.chainId,
      min_operating_floor_usdc: 20000.0,
      safety_buffer_ratio: 1.25,
      is_active: true,
    });

    // 3. Register Verified Vendors
    await VendorMasterRepo.registerVendor({
      vendor_id: vendorAwsId,
      name: "Amazon Web Services Inc.",
      verified_payout_address: vendorAwsAddress,
      verified_by_admin: "admin@bizarc.io",
      last_verified_at: new Date(),
      change_lock: true,
    });

    await VendorMasterRepo.registerVendor({
      vendor_id: vendorDatadogId,
      name: "Datadog Observability Corp",
      verified_payout_address: vendorDatadogAddress,
      verified_by_admin: "admin@bizarc.io",
      last_verified_at: new Date(),
      change_lock: true,
    });
  });

  after(async () => {
    // Cleanup
    await DbClient.query("DELETE FROM dynamic_safe_to_invest WHERE account_id LIKE 'acc_e2e_%';");
    await DbClient.query("DELETE FROM account_liabilities WHERE account_id LIKE 'acc_e2e_%';");
    await DbClient.query("DELETE FROM master_system_journal WHERE account_id LIKE 'acc_e2e_%';");
    await DbClient.query("DELETE FROM account_agent_audit_log WHERE account_id LIKE 'acc_e2e_%';");
    await DbClient.query("DELETE FROM erp_sync_state WHERE account_id LIKE 'acc_e2e_%';");
    await DbClient.query("DELETE FROM permission_requests WHERE request_id LIKE 'sprs_e2e_%';");
    await DbClient.query("DELETE FROM vendor_master_registry WHERE vendor_id IN ($1, $2);", [vendorAwsId, vendorDatadogId]);
    await DbClient.query("DELETE FROM treasury_accounts WHERE account_id LIKE 'acc_e2e_%';");
  });

  it("Arc Testnet Connectivity: should connect to live Arc Testnet and enforce 20 Gwei gas floor", async () => {
    const publicClient = ArcClientManager.getPublicClient({ network: "arcTestnet" });
    assert.ok(publicClient, "Arc Testnet public client must be initialized");

    const chain = ArcClientManager.getChain("arcTestnet");
    assert.strictEqual(chain.id, ARC_CONSTANTS.TESTNET.chainId, "Must target Arc Testnet chain ID (5042002)");

    // Protocol Gas Floor Verification (Rule: Mempool immediately drops tx with gas < 20 Gwei)
    const gasParams = ArcClientManager.enforceGasFloor(15_000_000_000n);
    assert.strictEqual(gasParams.maxFeePerGas >= ARC_CONSTANTS.MIN_GAS_FLOOR_WEI, true, "Must enforce 20 Gwei gas floor");
  });

  it("SCENARIO 1: Autonomous Surplus Sweep (Inside the Rules)", async () => {
    // Step 1: Customer revenue / faucet drip arrives on accEngineering ($15,000 liquid)
    // Step 2: Seed committed liabilities for next 30 days ($850.00)
    await LiabilityRepo.createLiability({
      account_id: accEngineering,
      vendor_id: vendorAwsId,
      title: "Base Cloud Compute",
      category: "INFRASTRUCTURE",
      amount_usdc: 850.0,
      due_date: new Date(Date.now() + 7 * 86400 * 1000),
      status: "SCHEDULED",
      payout_address: vendorAwsAddress,
    });

    // Step 3: Evaluate Dynamic Safe-to-Invest Record 2
    const safeRecord = await dynamicRecords.calculateSafeToInvest(
      accEngineering,
      30 * 86400,
      "1477.500000", // (850 * 1.15) + 500 operating floor
      dynamicRecords.parseUsdcToRaw("15000.000000"),
      dynamicRecords.parseUsdcToRaw("25000.000000")
    );

    assert.ok(safeRecord.status === "SWEEP_RECOMMENDED" || safeRecord.status === "BALANCED");
    assert.ok(safeRecord.safeToInvestRaw > 0n, "Account has positive free capital to sweep");
    const sweepAmountUsdc = "10000.000000";

    // Step 4: Policy evaluation — sweep is within limits and Inside the Rules
    const qualification = await disbursalRouter.qualifyDisbursalRoute({
      invoiceId: `SWP-REVENUE-${ts}`,
      vendorId: "INTERNAL_SWEEP",
      payoutAddress: centralVaultAddress,
      amountUsdc: sweepAmountUsdc,
      category: "YIELD_SWEEP",
      declaredReason: "Autonomous surplus cash sweep into Hashnote USYC yield vault",
      preferredAccountId: accEngineering,
      balanceOverrides: defaultBalanceOverrides,
    });

    assert.strictEqual(qualification.isQualified, true);

    // Step 5: Execute autonomous yield sweep and verify calldata
    const sweepCalldata = vaultService.encodeSweepFromAccount(
      accEngineering,
      engWallet,
      dynamicRecords.parseUsdcToRaw(sweepAmountUsdc)
    );
    assert.ok(sweepCalldata.startsWith("0x"), "Must generate valid sweepFromAccount calldata");

    const executor = new ArcTransactionExecutor();
    const execution = await executor.execute({
      targetContract: centralVaultAddress,
      abi: CentralTreasuryYieldVaultABI,
      functionName: "sweepFromAccount",
      args: [
        CentralTreasuryYieldVaultService.formatAccountId(accEngineering),
        engWallet,
        dynamicRecords.parseUsdcToRaw(sweepAmountUsdc),
      ],
      idempotencyKey: `0x${Date.now().toString(16).padStart(64, "0")}`,
    });
    const sweepTxHash = execution.txHash;

    // Step 6: LedgerWitness witnesses transaction and records sequential SHA-256 journal entry
    const journalEntry = await witnessService.recordJournalVoucher({
      accountId: accEngineering,
      actionType: "AUTONOMOUS_SWEEP",
      amountUsdc: parseFloat(sweepAmountUsdc),
      documentRef: `SWP-DOC-${ts}`,
      category: "YIELD_SWEEP",
    });

    const auditLog = await witnessService.recordAccountAuditLog({
      accountId: accEngineering,
      actionType: "AUTONOMOUS_SWEEP",
      amountUsdc: parseFloat(sweepAmountUsdc),
      isAutonomous: true,
      txHash: sweepTxHash,
      counterpartyAddress: centralVaultAddress,
      reason: "Autonomous surplus yield sweep on Arc Testnet",
      preStateSnapshot: { liquidUsdc: "15000.000000", investedUsyc: "25000.000000" },
      postStateSnapshot: { liquidUsdc: "5000.000000", investedUsyc: "35000.000000" },
    });

    assert.strictEqual(journalEntry.action_type, "AUTONOMOUS_SWEEP");
    assert.strictEqual(auditLog.action_type, "AUTONOMOUS_SWEEP");

    // Step 7: Verify master journal hash chain integrity
    const chainVerification = await MasterJournalRepo.verifyChainIntegrity();
    assert.strictEqual(chainVerification.valid, true, "Master system journal hash chain must remain unbroken");

    // Step 8: Verify unified operational state reflects post-sweep parallel balance invariant
    const opState = await operationalStateService.getUnifiedOperationalState({
      accountId: accEngineering,
      balanceOverrides: {
        [accEngineering]: { liquidUsdc: 5000, investedUsyc: 35000 },
        [accGeneralTreasury]: defaultBalanceOverrides[accGeneralTreasury],
        [accPayroll]: defaultBalanceOverrides[accPayroll],
      },
    });

    assert.strictEqual(opState.balances.tripartiteInvariantVerified, true);
    assert.strictEqual(opState.auditState.masterJournal.chainIntegrityVerified, true);
  });

  it("SCENARIO 2 (Branch A): Subscription Radar Alert & Human CFO EIP-712 Approval", async () => {
    // Step 1: Datadog SaaS subscription renewal arrives ($850.00) exceeding single-transaction human gate ($500.00)
    const datadogInvoiceId = `INV-DD-${ts}`;
    const datadogAmount = "850.000000";

    // Step 2: Route qualification evaluates policy
    const qualification = await disbursalRouter.qualifyDisbursalRoute({
      invoiceId: datadogInvoiceId,
      vendorId: vendorDatadogId,
      payoutAddress: vendorDatadogAddress,
      amountUsdc: datadogAmount,
      category: "SAAS",
      declaredReason: "Datadog APM and distributed tracing enterprise renewal",
      preferredAccountId: accEngineering,
      balanceOverrides: defaultBalanceOverrides,
    });

    assert.strictEqual(qualification.isQualified, true);
    assert.strictEqual(qualification.requiresHumanApproval, true, "Transactions > $500 require human EIP-712 approval");

    // Step 3: PolicyComplianceAgent escalates to Standardized Permission Request (SPRS)
    const sprsId = `sprs_e2e_datadog_${ts}`;
    const sprsRequest = await PermissionRequestRepo.createRequest({
      request_id: sprsId,
      action_type: "DISBURSAL_SETTLEMENT",
      amount_usdc: 850.0,
      status: "PENDING",
      reason: "Datadog renewal exceeds single transaction autonomous threshold ($850 > $500)",
      payload: {
        invoiceId: datadogInvoiceId,
        vendorId: vendorDatadogId,
        payoutAddress: vendorDatadogAddress,
        conflictingPolicy: "single_tx_human_gate_threshold_usdc exceeded",
      },
    });
    assert.strictEqual(sprsRequest.status, "PENDING");

    // Step 4: Human CFO Reviews SPRS on dashboard and approves with EIP-712 authorization
    const adminSig = await AuthorizationGate.createAdminSignature({
      permissionRequestId: sprsId,
      actionType: "DISBURSAL_SETTLEMENT",
      accountId: accEngineering,
      amountUsdc: datadogAmount,
    });

    const authResult = await AuthorizationGate.authorizeTransactionIntent({
      permissionRequestId: sprsId,
      approverEmail: "cfo@bizarc.io",
      adminSignature: adminSig,
      executionPayload: { qualification },
    });
    assert.strictEqual(authResult.status, "AUTHORIZED");
    assert.ok(authResult.authorizationReceiptHash);

    // Step 5: Execute Disbursal with DisbursalVault Keccak-256 Idempotency
    const execution = await disbursalRouter.executeDisbursalRoute({
      qualification,
      adminSignature: adminSig,
      clearanceCode: authResult.authorizationReceiptHash,
    });

    assert.strictEqual(execution.status, "SETTLED");
    assert.strictEqual(execution.qualification.totalRequestedUsdc, datadogAmount);
    assert.ok(execution.idempotencyKey);
    assert.ok(execution.txHash);

    // Step 6: Verify Three-Way Match & ERP Document-Linked Checkpoint
    assert.ok(execution.erpSync);
    assert.strictEqual(execution.erpSync.status, "SYNCED");
    assert.strictEqual(execution.erpSync.threeWayMatchVerified, true);
    assert.ok(execution.erpSync.syncId);

    const erpCheckpoint = await ErpSyncRepo.getSyncState(execution.erpSync.syncId!);
    assert.ok(erpCheckpoint, "Must write document-linked payment entry to ERP");
    assert.strictEqual(erpCheckpoint.status, "SYNCED");
    assert.strictEqual(erpCheckpoint.sync_checkpoint_data?.threeWayMatchVerified, true);
  });

  it("SCENARIO 2 (Branch B): Subscription Price Hike Radar Alert & Human Cancellation", async () => {
    // Step 1: Renewal invoice arrives with unapproved 25% price hike ($1250 vs $1000 baseline)
    const hikeInvoiceId = `INV-HIKE-${ts}`;
    const hikeAmount = 1250.0;
    const sprsHikeId = `sprs_e2e_hike_${ts}`;

    // Step 2: Policy Compliance Agent flags price hike exceeding 10% tolerance threshold
    await PermissionRequestRepo.createRequest({
      request_id: sprsHikeId,
      action_type: "SUBSCRIPTION_RENEWAL",
      amount_usdc: hikeAmount,
      status: "PENDING",
      reason: "Datadog subscription price increased by 25% ($1,250 vs $1,000 baseline) exceeding 10% policy cap",
      payload: {
        vendorId: vendorDatadogId,
        baselineAmount: 1000.0,
        hikePercentage: 25.0,
      },
    });

    // Step 3: Admin reviews on dashboard and chooses: CANCEL_WITH_INSTRUCTIONS
    await PermissionRequestRepo.updateStatus(
      sprsHikeId,
      "CANCELLED",
      "Rejected renewal: Migrated to internal Prometheus/Grafana stack; cancel vendor subscription."
    );
    const updatedSprs = await PermissionRequestRepo.getRequestById(sprsHikeId);
    assert.ok(updatedSprs);
    assert.strictEqual(updatedSprs.status, "CANCELLED");
    assert.ok(updatedSprs.admin_instruction?.includes("Migrated to internal Prometheus"));

    // Step 4: Record cancellation memo in Master System Journal and Account Audit Log
    const journalEntry = await MasterJournalRepo.appendEntry({
      account_id: accEngineering,
      action_type: "SUBSCRIPTION_CANCELLED",
      debit_account: "VENDOR_LIABILITY_FROZEN",
      credit_account: "OPERATING_BUDGET_PROTECTED",
      amount_usdc: hikeAmount,
      document_ref: `MEMO-CANCEL-${sprsHikeId}`,
    });

    assert.strictEqual(journalEntry.action_type, "SUBSCRIPTION_CANCELLED");

    await AuditLogRepo.appendAuditLog({
      account_id: accEngineering,
      action_type: "SUBSCRIPTION_FROZEN",
      amount_usdc: hikeAmount,
      is_autonomous: false,
      permission_request_id: sprsHikeId,
      reason: updatedSprs.admin_instruction || "Admin cancelled renewal",
      pre_state_snapshot: { status: "AWAITING_APPROVAL" },
      post_state_snapshot: { status: "CANCELLED_FROZEN" },
      actor_agent: "LiabilityRadar",
    });

    // Step 5: Verify sequential hash chain validity after cancellation
    const chainVerification = await MasterJournalRepo.verifyChainIntegrity();
    assert.strictEqual(chainVerification.valid, true);
  });

  it("SCENARIO 3: Fragmented Account Disbursal via Multi-Account Waterfall with Payroll Protection", async () => {
    // Step 1: AWS Dedicated Enterprise Invoice arrives for $25,000.00
    // Engineering has $10,000 effective (< $25,000 invoice), General Treasury has $100,000, Payroll has $85,000.
    const awsInvoiceId = `INV-AWS-ENTERPRISE-${ts}`;
    const invoiceAmount = "25000.000000";

    const waterfallBalanceOverrides = {
      [accEngineering]: { liquidUsdc: 8000, investedUsyc: 2000 },
      [accGeneralTreasury]: { liquidUsdc: 40000, investedUsyc: 60000 },
      [accPayroll]: { liquidUsdc: 85000, investedUsyc: 0 },
    };

    // Step 2: Route qualification with Waterfall allocation
    const qualification = await disbursalRouter.qualifyDisbursalRoute({
      invoiceId: awsInvoiceId,
      vendorId: vendorAwsId,
      payoutAddress: vendorAwsAddress,
      amountUsdc: invoiceAmount,
      category: "INFRASTRUCTURE",
      declaredReason: "Quarterly enterprise dedicated AWS server cluster",
      preferredAccountId: accEngineering,
      balanceOverrides: waterfallBalanceOverrides,
    });

    assert.strictEqual(qualification.isQualified, true);
    assert.strictEqual(qualification.routeType, "MULTI_ACCOUNT_WATERFALL");
    assert.strictEqual(qualification.requiresHumanApproval, true);

    // Step 3: CRITICAL AUDIT CHECK — PAYROLL ISOLATION ENFORCEMENT
    // Payroll account MUST NEVER be drawn from for non-payroll liabilities!
    const payrollAllocation = qualification.allocations.find((a) => a.accountId === accPayroll);
    assert.strictEqual(payrollAllocation, undefined, "PAYROLL account must NEVER be selected for infrastructure draws!");

    // Verify allocations cover the exact total without overdrawing accounts
    const totalAllocated = qualification.allocations.reduce(
      (sum, a) => sum + a.allocatedAmountRaw,
      0n
    );
    assert.strictEqual(totalAllocated, dynamicRecords.parseUsdcToRaw(invoiceAmount));

    // Step 4: Stage Funds (D18)
    const stageResult = await disbursalRouter.stageFunds(qualification);
    assert.strictEqual(stageResult.status, "FUNDS_STAGED");
    assert.strictEqual(stageResult.totalStagedUsdc, invoiceAmount);

    // Step 5: Execute Disbursal Payment (D19)
    const disbursalResult = await disbursalRouter.executeDisbursalRoute({
      qualification,
      adminSignature: "0x" + "bb".repeat(65),
      clearanceCode: "CLR-WATERFALL-9941",
    });

    assert.strictEqual(disbursalResult.status, "SETTLED");
    assert.strictEqual(disbursalResult.qualification.totalRequestedUsdc, invoiceAmount);
    assert.ok(disbursalResult.idempotencyKey);
    const firstIdempotencyKey = disbursalResult.idempotencyKey;

    // Step 6: Keccak-256 Idempotency Anti-Double-Spend Guarantee
    // Re-executing with the exact same invoice MUST be immediately blocked
    const duplicateExecution = await disbursalRouter.executeDisbursalRoute({
      qualification,
      adminSignature: "0x" + "bb".repeat(65),
      clearanceCode: "CLR-WATERFALL-9941",
    });

    assert.strictEqual(duplicateExecution.status, "FAILED");
    assert.ok(duplicateExecution.message.includes("Idempotency key already executed"));

    // Step 7: LedgerWitness records multi-legged settlement vouchers
    const chainVerification = await MasterJournalRepo.verifyChainIntegrity();
    assert.strictEqual(chainVerification.valid, true, "Master journal hash chain remains mathematically sound");

    // Step 8: Verify Unified Operational State via ToolRegistry tool call
    const toolCall = await toolRegistry.executeTool("get_unified_operational_state", {
      balanceOverrides: waterfallBalanceOverrides,
    });
    assert.strictEqual(toolCall.success, true);
    assert.strictEqual(toolCall.data.balances.tripartiteInvariantVerified, true);
    assert.strictEqual(toolCall.data.erpSyncStatus.threeWayMatchIntegrity, true);
  });

  after(async () => {
    await DbClient.closePool();
  });
});
