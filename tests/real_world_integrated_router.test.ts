import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { keccak256, stringToHex } from "viem";
import { DbClient } from "../src/database/dbClient.js";
import { EnterpriseOnboardingService } from "../src/services/enterpriseOnboardingService.js";
import { CompanyProfileRepo } from "../src/database/repos/companyProfileRepo.js";
import { TreasuryAccountsRepo } from "../src/database/repos/treasuryAccountsRepo.js";
import { VendorMasterRepo } from "../src/database/repos/vendorMasterRepo.js";
import { MovementPolicyRepo } from "../src/database/repos/movementPolicyRepo.js";
import { MasterJournalRepo } from "../src/database/repos/masterJournalRepo.js";
import { ErpSyncRepo } from "../src/database/repos/erpSyncRepo.js";
import { PermissionRequestRepo } from "../src/database/repos/permissionRequestRepo.js";
import { DynamicRecordsService } from "../src/records/dynamicRecordsService.js";
import { UniversalPaymentRouter } from "../src/payments/universalPaymentRouter.js";
import { DisbursalRouterAgent } from "../src/agents/disbursalRouterLlmAgent.js";
import { ToolRegistry } from "../src/tools/toolRegistry.js";

describe("Real-World Integrated Treasury & Universal Payment Router Audit", () => {
  const onboardingService = new EnterpriseOnboardingService();
  const dynamicRecords = new DynamicRecordsService();
  const router = new UniversalPaymentRouter();
  const companyId = "comp_realworld_enterprise";
  const companyName = "Nexus Global Technologies Ltd";

  before(async () => {
    // Clean test slate
    await DbClient.query("DELETE FROM master_system_journal;");
    await DbClient.query("DELETE FROM account_agent_audit_log WHERE account_id LIKE 'acc_nexus_%';");
    await DbClient.query("DELETE FROM permission_requests WHERE request_id LIKE 'SPRS_%';");
    await DbClient.query("DELETE FROM erp_sync_state WHERE account_id LIKE 'acc_nexus_%';");
    await DbClient.query("DELETE FROM erc3009_authorizations WHERE intent_id LIKE 'DISB_%';");
    await DbClient.query("DELETE FROM session_key_registry WHERE account_id LIKE 'acc_nexus_%';");
    await DbClient.query("DELETE FROM dynamic_safe_to_invest WHERE account_id LIKE 'acc_nexus_%';");
    await DbClient.query("DELETE FROM account_liabilities WHERE account_id LIKE 'acc_nexus_%';");
    await DbClient.query("DELETE FROM movement_policies WHERE policy_id LIKE 'movement_policy_nexus%';");
    await DbClient.query("DELETE FROM vendor_master_registry WHERE vendor_id IN ('vendor_aws_real', 'vendor_github_real', 'vendor_x402_oracle');");
    await DbClient.query("DELETE FROM treasury_accounts WHERE account_id LIKE 'acc_nexus_%';");
    await DbClient.query("DELETE FROM company_profiles WHERE company_id = $1;", [companyId]);
  });

  after(async () => {
    await DbClient.closePool();
  });

  it("Step 1: Enterprise Onboarding Integration — Ground Truth, Profiles & Movement Policy Genesis", async () => {
    // 1. Ingest enterprise data through connected MCP Apps & ERP
    const profileResult = await onboardingService.createCompanyProfileFromConnectedData({
      companyId,
      companyName,
      businessDescription: "Global AI and Autonomous Infrastructure Operator on Arc L1",
    });

    assert.equal(profileResult.company_id, companyId);
    assert.equal(profileResult.activation_status, "PENDING_ACTIVATION");
    assert.ok(profileResult.connected_apps.length >= 3);

    // 2. Synthesize policy proposal from discovered cost centers
    const discoveredProfile = {
      companyName,
      adminEmail: "cfo@nexusglobal.com",
      erpSource: "ERPNEXT",
      discoveredAt: new Date().toISOString(),
      costCenters: [
        {
          costCenterId: "cc_engineering",
          accountId: "acc_nexus_engineering",
          name: "Engineering Core Ops",
          role: "OPEX_DEV" as const,
          monthlyCommittedLiabilitiesUsdc: 2500.0,
          highestSingleBillUsdc: 2000.0,
        },
        {
          costCenterId: "cc_treasury",
          accountId: "acc_nexus_treasury",
          name: "Central Treasury Reserve",
          role: "TREASURY_RESERVE" as const,
          monthlyCommittedLiabilitiesUsdc: 0.0,
          highestSingleBillUsdc: 5000.0,
        },
        {
          costCenterId: "cc_payroll",
          accountId: "acc_nexus_payroll",
          name: "Executive & Employee Payroll Escrow",
          role: "PAYROLL" as const,
          monthlyCommittedLiabilitiesUsdc: 15000.0,
          highestSingleBillUsdc: 15000.0,
        },
      ],
      discoveredSuppliers: [
        {
          supplierId: "vendor_aws_real",
          name: "Amazon Web Services Inc",
          payoutAddress: "0x4444444444444444444444444444444444444444" as `0x${string}`,
          authorizedCategory: "INFRASTRUCTURE",
        },
        {
          supplierId: "vendor_github_real",
          name: "GitHub Enterprise",
          payoutAddress: "0x5555555555555555555555555555555555555555" as `0x${string}`,
          authorizedCategory: "DEV_TOOLS",
        },
        {
          supplierId: "vendor_x402_oracle",
          name: "Arc Decentralized Oracle Provider",
          payoutAddress: "0x7777777777777777777777777777777777777777" as `0x${string}`,
          authorizedCategory: "DATA_FEED",
        },
      ],
      discoveredLiabilities: [
        {
          invoiceNumber: "INV-AWS-REAL-01",
          supplierId: "vendor_aws_real",
          amountUsdc: "1500.000000",
          dueDate: new Date(Date.now() + 86400 * 10 * 1000).toISOString(),
          costCenter: "acc_nexus_engineering",
          purchaseOrderNumber: "PO-AWS-2026-01",
          deliveryReceiptProof: "GRN-AWS-DELIVERY-CONFIRMED-01",
        },
      ],
    };

    const suggestedPolicy = onboardingService.generatePolicyProposal(discoveredProfile);
    assert.equal(suggestedPolicy.status, "SUGGESTION_PENDING_HUMAN_COMMIT");

    // 3. Human Operator approves and commits policy -> provisions accounts, registers vendors, seeds Movement Policy
    const committedResult = await onboardingService.provisionAccountsAndLedger({
      profile: discoveredProfile,
      committedPolicy: suggestedPolicy.profile,
    });

    assert.equal(committedResult.accountsCreated.length, 3);
    assert.equal(committedResult.vendorsRegistered.length, 3);

    // Register x402 payment endpoint on vendor master for Rail 4 verification
    await DbClient.query(
      `UPDATE vendor_master_registry 
       SET payment_endpoint_url = 'https://api.marketdata.arc/v1/feed', payout_rail = 'GATEWAY_X402'
       WHERE vendor_id = 'vendor_x402_oracle';`
    );

    // Verify Movement Policy was initialized with strict payroll shielding
    const movementPolicy = await MovementPolicyRepo.getPolicyById(
      `movement_policy_${companyName.toLowerCase().replace(/\s+/g, "_")}`
    );
    assert.ok(movementPolicy, "Enterprise Movement Policy must be seeded during onboarding");
    assert.ok(movementPolicy?.protected_accounts.includes("acc_nexus_payroll"), "acc_nexus_payroll must be protected");
    assert.ok(movementPolicy?.priority_order.includes("acc_nexus_engineering"));
  });

  it("Step 2: Dynamic Records Synthesis — Tripartite Invariant ($B_L + B_Y = B_E$) & Safe-to-Invest", async () => {
    // Feed initial seed balances: Engineering $500 liquid, Treasury $10,000 liquid, Payroll $20,000 liquid
    const engineeringTripartite = await dynamicRecords.getTripartiteBalance("acc_nexus_engineering", 500_000_000n, 100_000_000n);
    assert.equal(engineeringTripartite.liquidCashUsdc, "500.000000");
    assert.equal(engineeringTripartite.investedYieldUsdc, "100.000000");
    assert.equal(engineeringTripartite.availableBalanceUsdc, "600.000000");
    assert.equal(engineeringTripartite.invariantSatisfied, true);

    const safeToInvest = await dynamicRecords.calculateSafeToInvest("acc_nexus_engineering", 7 * 86400, "100.000000", 500_000_000n, 100_000_000n);
    assert.ok(safeToInvest.recordId);
    assert.ok(safeToInvest.targetReserveUsdc === "100.000000");
  });

  it("Step 3: Invariant 1 — Movement Policy Enforces Cost-Center Boundaries & Shields Payroll", async () => {
    // Attempt 1: Illegal drain of Payroll account for engineering bills is strictly blocked
    const illegalPayrollResult = await router.routeAndExecute({
      intent: {
        intentId: `DISB_ILLEGAL_PAYROLL_${Date.now()}`,
        primaryAccountId: "acc_nexus_payroll",
        vendorId: "vendor_aws_real",
        vendorName: "Amazon Web Services Inc",
        amountUsdc: 500.0,
        payoutAddress: "0x4444444444444444444444444444444444444444",
        category: "INFRASTRUCTURE",
        declaredReason: "Attempted illegal draw from payroll account for cloud bill.",
      },
    });

    assert.equal(illegalPayrollResult.success, false);
    assert.equal(illegalPayrollResult.status, "REJECTED_BY_POLICY");
    assert.ok(illegalPayrollResult.error?.includes("Non-payroll draws are strictly prohibited"));

    // Attempt 2: Multi-account waterfall draw pulls from Engineering ($200) and Treasury ($300), protecting Payroll ($20,000)
    const waterfallResult = await router.routeAndExecute({
      intent: {
        intentId: `DISB_WATERFALL_TEST_${Date.now()}`,
        primaryAccountId: "acc_nexus_engineering",
        vendorId: "vendor_aws_real",
        vendorName: "Amazon Web Services Inc",
        amountUsdc: 500.0,
        payoutAddress: "0x4444444444444444444444444444444444444444",
        declaredReason: "Waterfall draw across operating accounts to fund cloud infrastructure.",
        invoiceId: "INV-AWS-WATERFALL-01",
        poReference: "PO-AWS-2026-01",
      },
      accountBalances: {
        acc_nexus_engineering: 200.0,
        acc_nexus_treasury: 10000.0,
        acc_nexus_payroll: 20000.0, // Large balance, but strictly protected
      },
      overrideRail: "DISBURSAL_VAULT",
    });

    assert.equal(waterfallResult.success, true);
    assert.equal(waterfallResult.status, "EXECUTED");
    assert.equal(waterfallResult.allocations.length, 2);

    // Primary allocation from Engineering
    assert.equal(waterfallResult.allocations[0].accountId, "acc_nexus_engineering");
    assert.equal(waterfallResult.allocations[0].amountUsdc, 200.0);

    // Secondary allocation from Treasury
    assert.equal(waterfallResult.allocations[1].accountId, "acc_nexus_treasury");
    assert.equal(waterfallResult.allocations[1].amountUsdc, 300.0);

    // Zero draw from Payroll
    assert.ok(!waterfallResult.allocations.some((a) => a.accountId === "acc_nexus_payroll"), "Payroll must remain completely shielded");

    // Verify balanced Intercompany Loan Vouchers (Due To / Due From)
    const journalEntries = await MasterJournalRepo.getEntriesByAccount("acc_nexus_engineering", 10);
    const dueTo = journalEntries.find((e) => e.action_type === "INTERCOMPANY_LOAN_DUE_TO");
    assert.ok(dueTo, "Must record INTERCOMPANY_LOAN_DUE_TO for primary account");
    assert.equal(Number(dueTo?.amount_usdc), 300.0);

    const treasuryEntries = await MasterJournalRepo.getEntriesByAccount("acc_nexus_treasury", 10);
    const dueFrom = treasuryEntries.find((e) => e.action_type === "INTERCOMPANY_LOAN_DUE_FROM");
    assert.ok(dueFrom, "Must record INTERCOMPANY_LOAN_DUE_FROM for loaning account");
    assert.equal(Number(dueFrom?.amount_usdc), 300.0);
  });

  it("Step 4: Invariant 2 — Three-Way Match Verification on Rails 1, 2, and 3", async () => {
    // 4A: Missing Purchase Order (PO) reference -> REJECTED
    const missingPoResult = await router.routeAndExecute({
      intent: {
        intentId: `DISB_3WAY_NO_PO_${Date.now()}`,
        primaryAccountId: "acc_nexus_engineering",
        vendorId: "vendor_aws_real",
        vendorName: "Amazon Web Services Inc",
        amountUsdc: 150.0,
        payoutAddress: "0x4444444444444444444444444444444444444444",
        invoiceId: "INV-AWS-DISCREPANT-01",
        requireThreeWayMatch: true,
        declaredReason: "Invoice submitted without Purchase Order.",
      },
      accountBalances: { acc_nexus_engineering: 500.0 },
      overrideRail: "DISBURSAL_VAULT",
    });

    assert.equal(missingPoResult.success, false);
    assert.equal(missingPoResult.status, "REJECTED_BY_POLICY");
    assert.ok(missingPoResult.error?.includes("lacks approved Purchase Order reference"));

    // 4B: PO provided, but Goods Receipt delivery confirmation missing -> REJECTED
    const missingDeliveryResult = await router.routeAndExecute({
      intent: {
        intentId: `DISB_3WAY_NO_DELIVERY_${Date.now()}`,
        primaryAccountId: "acc_nexus_engineering",
        vendorId: "vendor_aws_real",
        vendorName: "Amazon Web Services Inc",
        amountUsdc: 150.0,
        payoutAddress: "0x4444444444444444444444444444444444444444",
        invoiceId: "INV-AWS-UNDELIVERED-01",
        poReference: "PO-AWS-2026-01",
        requireThreeWayMatch: true,
        declaredReason: "Invoice with PO but no delivery confirmation telemetry.",
      },
      accountBalances: { acc_nexus_engineering: 500.0 },
      overrideRail: "DISBURSAL_VAULT",
    });

    assert.equal(missingDeliveryResult.success, false);
    assert.equal(missingDeliveryResult.status, "REJECTED_BY_POLICY");
    assert.ok(missingDeliveryResult.error?.includes("Milestone delivery proof is unverified"));

    // 4C: Full Three-Way Match: PO, Invoice, and Delivery Proof confirmed -> EXECUTED
    const validMatchResult = await router.routeAndExecute({
      intent: {
        intentId: `DISB_3WAY_AUTHENTIC_${Date.now()}`,
        primaryAccountId: "acc_nexus_engineering",
        vendorId: "vendor_aws_real",
        vendorName: "Amazon Web Services Inc",
        amountUsdc: 150.0,
        payoutAddress: "0x4444444444444444444444444444444444444444",
        invoiceId: "INV-AWS-VERIFIED-01",
        poReference: "PO-AWS-2026-01",
        deliveryProofHash: "0xgrn_sha256_delivered_telemetry_proof_9999",
        requireThreeWayMatch: true,
        declaredReason: "Fully authenticated 3-way match invoice release.",
      },
      accountBalances: { acc_nexus_engineering: 500.0 },
      overrideRail: "DISBURSAL_VAULT",
    });

    assert.equal(validMatchResult.success, true);
    assert.equal(validMatchResult.status, "EXECUTED");
    assert.ok(validMatchResult.txHash);
  });

  it("Step 5: Invariant 3 — Payee Substitution Defense across all rails (EVM & x402 URLs)", async () => {
    // 5A: Attacker modifies EVM wallet payout address on invoice -> REJECTED
    const evmAttackResult = await router.routeAndExecute({
      intent: {
        intentId: `DISB_EVM_ATTACK_${Date.now()}`,
        primaryAccountId: "acc_nexus_engineering",
        vendorId: "vendor_aws_real",
        vendorName: "Amazon Web Services Inc",
        amountUsdc: 100.0,
        payoutAddress: "0xAttackerCompromisedAddress8888888888888888888888",
        declaredReason: "Phishing invoice attempting payee substitution.",
      },
      accountBalances: { acc_nexus_engineering: 500.0 },
      overrideRail: "DISBURSAL_VAULT",
    });

    assert.equal(evmAttackResult.success, false);
    assert.equal(evmAttackResult.status, "REJECTED_BY_POLICY");
    assert.ok(evmAttackResult.error?.includes("PAYEE SUBSTITUTION DETECTED (Rule 3)"));

    // 5B: Attacker provides malicious / spoofed x402 endpoint URL -> REJECTED
    const x402AttackResult = await router.routeAndExecute({
      intent: {
        intentId: `DISB_X402_ATTACK_${Date.now()}`,
        primaryAccountId: "acc_nexus_engineering",
        vendorId: "vendor_x402_oracle",
        vendorName: "Arc Decentralized Oracle Provider",
        amountUsdc: 0.05,
        serviceUrl: "https://evil-phishing-oracle.com/v1/feed", // Does NOT match registered vendor endpoint
        declaredReason: "Micropayment request to unauthorized x402 URL.",
      },
      accountBalances: { acc_nexus_engineering: 500.0 },
      overrideRail: "GATEWAY_X402",
    });

    assert.equal(x402AttackResult.success, false);
    assert.equal(x402AttackResult.status, "REJECTED_BY_POLICY");
    assert.ok(x402AttackResult.error?.includes("PAYEE SUBSTITUTION DETECTED (Rule 3)"));
  });

  it("Step 6: Invariant 4 — Human Escalation (SPRS) on Configured Threshold Breaches", async () => {
    // 6A: Payment of $5,000 exceeds autonomous single-tx gate ($500) on Rail 1 -> Pauses for SPRS
    const highValueDisbursal = await router.routeAndExecute({
      intent: {
        intentId: `DISB_SPRS_GATE_${Date.now()}`,
        primaryAccountId: "acc_nexus_engineering",
        vendorId: "vendor_aws_real",
        vendorName: "Amazon Web Services Inc",
        amountUsdc: 5000.0, // Exceeds $500 threshold
        payoutAddress: "0x4444444444444444444444444444444444444444",
        declaredReason: "Annual reserve cloud infrastructure capacity wire.",
        invoiceId: "INV-AWS-ANNUAL-WIRE",
      },
      accountBalances: { acc_nexus_engineering: 10000.0 },
      overrideRail: "DISBURSAL_VAULT",
    });

    assert.equal(highValueDisbursal.success, false);
    assert.equal(highValueDisbursal.status, "ESCALATE_TO_SPRS");
    assert.ok(highValueDisbursal.sprsRequestId);

    // Verify Standardized Permission Request persisted to PostgreSQL
    const pendingRequest = await PermissionRequestRepo.getRequestById(highValueDisbursal.sprsRequestId!);
    assert.ok(pendingRequest);
    assert.equal(pendingRequest?.status, "PENDING");
    assert.equal(Number(pendingRequest?.amount_usdc), 5000.0);

    // 6B: CFO provides valid EIP-712 admin authorization signature -> EXECUTED
    const adminSignature = "0x284a16fac870b20977a4569502b4fa26e47608253cc4fb287a95696cff4c2b9a79fa4f5263a03d0140227fd6449195d2df551c50406df5cfae5066917c06eb6e1b" as `0x${string}`;
    const approvedDisbursal = await router.routeAndExecute({
      intent: {
        intentId: `DISB_SPRS_APPROVED_${Date.now()}`,
        primaryAccountId: "acc_nexus_engineering",
        vendorId: "vendor_aws_real",
        vendorName: "Amazon Web Services Inc",
        amountUsdc: 5000.0,
        payoutAddress: "0x4444444444444444444444444444444444444444",
        declaredReason: "Annual reserve cloud infrastructure capacity wire.",
        invoiceId: "INV-AWS-ANNUAL-WIRE",
      },
      accountBalances: { acc_nexus_engineering: 10000.0 },
      adminSignature,
      overrideRail: "DISBURSAL_VAULT",
    });

    assert.equal(approvedDisbursal.success, true);
    assert.equal(approvedDisbursal.status, "EXECUTED");
    assert.ok(approvedDisbursal.txHash);
  });

  it("Step 7: Invariant 5 — Loud Rounding Rejection (Rule 5: Zero Floating-Point Tolerance)", async () => {
    // Attempt payment with 7 decimal places -> STRICTLY REJECTED
    const roundingResult = await router.routeAndExecute({
      intent: {
        intentId: `DISB_ROUNDING_ATTACK_${Date.now()}`,
        primaryAccountId: "acc_nexus_engineering",
        vendorId: "vendor_aws_real",
        vendorName: "Amazon Web Services Inc",
        amountUsdc: 100.1234567, // 7 decimal places
        payoutAddress: "0x4444444444444444444444444444444444444444",
        declaredReason: "Payment with micro-unit precision overflow.",
      },
      accountBalances: { acc_nexus_engineering: 500.0 },
      overrideRail: "DISBURSAL_VAULT",
    });

    assert.equal(roundingResult.success, false);
    assert.equal(roundingResult.status, "REJECTED_BY_POLICY");
    assert.ok(roundingResult.error?.includes("LOUD ROUNDING REJECTED (Rule 5)"));
  });

  it("Step 8: Invariant 6 — Universal Double-Entry Journaling & ERPNext/Odoo Staging", async () => {
    // 8A: Execute micro-payment via Rail 4 (Circle Gateway & x402)
    const microResult = await router.routeAndExecute({
      intent: {
        intentId: `DISB_MICRO_X402_${Date.now()}`,
        primaryAccountId: "acc_nexus_engineering",
        vendorId: "vendor_x402_oracle",
        vendorName: "Arc Decentralized Oracle Provider",
        amountUsdc: 0.01, // 1 cent
        serviceUrl: "https://api.marketdata.arc/v1/feed",
        declaredReason: "Sub-cent programmatic oracle query via x402.",
      },
      accountBalances: { acc_nexus_engineering: 500.0 },
      overrideRail: "GATEWAY_X402",
    });

    assert.equal(microResult.success, true);
    assert.equal(microResult.status, "EXECUTED");
    assert.ok(microResult.gatewaySettlementRef);
    assert.ok(microResult.journalSequenceId);

    // 8B: Verify unbroken cryptographic SHA-256 hash chaining across both $5,000 wire and $0.01 micropayment
    const chainVerification = await MasterJournalRepo.verifyChainIntegrity();
    assert.equal(chainVerification.valid, true, "Master journal hash chain must remain cryptographically unbroken");
    assert.ok(chainVerification.totalEntries >= 4);

    // 8C: Verify automated staging to ERPNext / Odoo sync state queue
    const erpSyncs = await ErpSyncRepo.getSyncStatesBySystem("ERPNEXT");
    assert.ok(erpSyncs.length >= 2, "Both large wire and micropayments must be staged to ERP sync state");
    const stagedMicro = erpSyncs.find((s) => s.sync_id.includes(microResult.intentId));
    assert.ok(stagedMicro, "Micro-payment must be staged to ERPNext");
    assert.equal(stagedMicro?.status, "SYNCED");
    assert.equal(stagedMicro?.entity_type, "PAYMENT_ENTRY");
  });

  it("Step 9: Agent Swarm ReAct Loop Integration — DisbursalRouterAgent executes route_universal_payment tool", async () => {
    const registry = new ToolRegistry();
    const result = await registry.executeTool("route_universal_payment", {
      primaryAccountId: "acc_nexus_engineering",
      vendorId: "vendor_github_real",
      vendorName: "GitHub Enterprise",
      amountUsdc: 250.0,
      payoutAddress: "0x5555555555555555555555555555555555555555",
      rail: "MODULAR_SESSION_KEY",
      reason: "Automated recurring developer tooling via Modular Session Key rail.",
    });

    assert.equal(result.success, true);
    assert.equal(result.data.status, "EXECUTED");
    assert.equal(result.data.rail, "MODULAR_SESSION_KEY");
    assert.ok(result.data.sessionKeyId);
    assert.ok(result.data.txHash);
    assert.ok(result.data.journalSequenceId);
  });
});
