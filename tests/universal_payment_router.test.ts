import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { UniversalPaymentRouter } from "../src/payments/universalPaymentRouter.js";
import { MovementPolicyRepo } from "../src/database/repos/movementPolicyRepo.js";
import { RecurringProposalRepo } from "../src/database/repos/recurringProposalRepo.js";
import { MasterJournalRepo } from "../src/database/repos/masterJournalRepo.js";
import { TreasuryAccountsRepo } from "../src/database/repos/treasuryAccountsRepo.js";
import { VendorMasterRepo } from "../src/database/repos/vendorMasterRepo.js";
import { DynamicRecordsService } from "../src/records/dynamicRecordsService.js";
import { DbClient } from "../src/database/dbClient.js";

describe("Universal Payment Router: Movement Policy, 4 Payment Rails & Recurring Governance", () => {
  const router = new UniversalPaymentRouter();
  const dynamicRecords = new DynamicRecordsService();

  before(async () => {
    // Clean previous test records
    await DbClient.query("DELETE FROM recurring_liability_proposals WHERE account_id = 'acc_engineering';");
    await DbClient.query("DELETE FROM account_liabilities WHERE account_id = 'acc_engineering';");
    await DbClient.query("DELETE FROM vendor_master_registry WHERE vendor_id IN ('vendor_cloud_aws', 'vendor_github', 'vendor_market_data');");

    // Seed accounts
    await TreasuryAccountsRepo.upsertAccount({
      account_id: "acc_engineering",
      name: "Engineering Operations",
      role: "OPEX_DEV",
      wallet_address: "0x1111111111111111111111111111111111111101",
      chain_id: 5042002,
      min_operating_floor_usdc: 50.0,
      safety_buffer_ratio: 1.2,
      is_active: true,
    });

    await TreasuryAccountsRepo.upsertAccount({
      account_id: "acc_general_treasury",
      name: "Central Treasury Reserve",
      role: "TREASURY_RESERVE",
      wallet_address: "0x3333333333333333333333333333333333333303",
      chain_id: 5042002,
      min_operating_floor_usdc: 250.0,
      safety_buffer_ratio: 1.2,
      is_active: true,
    });

    await TreasuryAccountsRepo.upsertAccount({
      account_id: "acc_payroll",
      name: "Corporate Payroll Escrow",
      role: "PAYROLL",
      wallet_address: "0x2222222222222222222222222222222222222202",
      chain_id: 5042002,
      min_operating_floor_usdc: 100.0,
      safety_buffer_ratio: 1.25,
      is_active: true,
    });

    // Seed Movement Policy
    await MovementPolicyRepo.upsertPolicy({
      policy_id: "default_movement_policy",
      name: "Standard Corporate Inter-Account Movement Policy",
      priority_order: ["acc_engineering", "acc_general_treasury"],
      protected_accounts: ["acc_payroll"],
      cross_account_borrowing_enabled: true,
      max_borrowing_ratio: 0.50,
      human_approval_threshold_usdc: 1000.0,
    });

    // Seed Verified Vendor Master
    await VendorMasterRepo.registerVendor({
      vendor_id: "vendor_cloud_aws",
      name: "Amazon Web Services",
      verified_payout_address: "0x4444444444444444444444444444444444444444",
      verified_by_admin: "CHIEF_RISK_OFFICER",
      last_verified_at: new Date(),
      change_lock: true,
    });

    await VendorMasterRepo.registerVendor({
      vendor_id: "vendor_github",
      name: "GitHub Enterprise",
      verified_payout_address: "0x5555555555555555555555555555555555555555",
      verified_by_admin: "CHIEF_RISK_OFFICER",
      last_verified_at: new Date(),
      change_lock: true,
    });
  });

  after(async () => {
    await DbClient.closePool();
  });

  it("Test 1: Multi-Account Funding strictly consults Movement Policy and protects Payroll", async () => {
    // Primary account has only $40, total bill is $100.
    // Movement policy should pull $40 from acc_engineering and $60 from acc_general_treasury.
    // acc_payroll ($5,000) must NEVER be touched.
    const allocation = await MovementPolicyRepo.computeMultiAccountFunding({
      primaryAccountId: "acc_engineering",
      totalAmountUsdc: 100.0,
      accountBalances: {
        acc_engineering: 40.0,
        acc_general_treasury: 500.0,
        acc_payroll: 5000.0, // Large balance, but strictly protected
      },
    });

    assert.equal(allocation.totalAllocatedUsdc, 100.0);
    assert.equal(allocation.unmetShortfallUsdc, 0);
    assert.equal(allocation.allocations.length, 2);

    // Primary allocation
    assert.equal(allocation.allocations[0].accountId, "acc_engineering");
    assert.equal(allocation.allocations[0].amountUsdc, 40.0);
    assert.equal(allocation.allocations[0].isPrimary, true);

    // Secondary waterfall allocation
    assert.equal(allocation.allocations[1].accountId, "acc_general_treasury");
    assert.equal(allocation.allocations[1].amountUsdc, 60.0);
    assert.equal(allocation.allocations[1].isPrimary, false);

    // Verify Payroll was NEVER allocated
    assert.ok(
      !allocation.allocations.some((a) => a.accountId === "acc_payroll"),
      "Payroll account must be strictly protected from waterfall draws"
    );
  });

  it("Test 2: Recurring Liabilities Lifecycle — Agent Proposals require Human Approval Gate", async () => {
    // 1. Agent detects a new recurring SaaS subscription ($250/mo) and submits proposal
    const agentProposal = await RecurringProposalRepo.submitProposal({
      actionType: "ADD",
      accountId: "acc_engineering",
      vendorId: "vendor_github",
      proposedBy: "LiabilityRadarAgent",
      details: {
        title: "GitHub Copilot Enterprise Seats",
        category: "SUBSCRIPTION",
        amountUsdc: "250.000000",
        payoutAddress: "0x5555555555555555555555555555555555555555",
        frequencyCron: "0 0 1 * *", // Monthly on the 1st
        dueDateIso: new Date(Date.now() + 86400 * 14 * 1000).toISOString(),
        rationale: "Detected new invoice with recurring 30-day terms from GitHub.",
      },
    });

    assert.equal(agentProposal.status, "PENDING_HUMAN_APPROVAL");
    assert.ok(agentProposal.sprs_request_id?.startsWith("SPRS_"));

    // Verify it is NOT yet active in Dynamic Record 1
    const pendingLiabilities = await dynamicRecords.getLiabilities("acc_engineering");
    assert.ok(
      !pendingLiabilities.some((l) => l.vendorTitle === "GitHub Copilot Enterprise Seats"),
      "Agent proposal must NOT be active before human approval"
    );

    // 2. Human CFO reviews and approves the proposal
    const approvedProposal = await RecurringProposalRepo.approveProposal(
      agentProposal.proposal_id,
      "Approved by CFO for engineering team."
    );
    assert.equal(approvedProposal.status, "APPROVED");

    // 3. Verify it is NOW enacted and active in Dynamic Record 1
    const activeLiabilities = await dynamicRecords.getLiabilities("acc_engineering");
    const found = activeLiabilities.find((l) => l.vendorTitle === "GitHub Copilot Enterprise Seats");
    assert.ok(found);
    assert.equal(found?.amountUsdc, "250.000000");

    // 4. Human directly adds a recurring liability (auto-committed)
    const humanProposal = await RecurringProposalRepo.submitProposal({
      actionType: "ADD",
      accountId: "acc_engineering",
      vendorId: "vendor_cloud_aws",
      proposedBy: "HUMAN",
      isHumanInitiated: true,
      details: {
        title: "AWS Cloud Support Retainer",
        amountUsdc: "500.000000",
        payoutAddress: "0x4444444444444444444444444444444444444444",
        frequencyCron: "0 0 1 * *",
        dueDateIso: new Date(Date.now() + 86400 * 30 * 1000).toISOString(),
      },
    });
    assert.equal(humanProposal.status, "APPROVED");
  });

  it("Test 3: Rail 1 Execution — DisbursalVault on Arc L1 with Idempotency & Allowlist", async () => {
    const result = await router.routeAndExecute({
      intent: {
        intentId: `DISB_RAIL1_${Date.now()}`,
        primaryAccountId: "acc_engineering",
        vendorId: "vendor_cloud_aws",
        vendorName: "Amazon Web Services",
        amountUsdc: 450.0, // Below $500 threshold
        payoutAddress: "0x4444444444444444444444444444444444444444",
        declaredReason: "Monthly cloud infrastructure hosting fee.",
        invoiceId: "INV_AWS_2026_10",
        poReference: "PO_AWS_INFRA_01",
      },
      accountBalances: {
        acc_engineering: 500.0,
      },
      overrideRail: "DISBURSAL_VAULT",
    });

    if (!result.success) {
      console.error("Test 3 Error:", result);
    }
    assert.equal(result.success, true);
    assert.equal(result.status, "EXECUTED");
    assert.equal(result.rail, "DISBURSAL_VAULT");
    assert.ok(result.txHash?.startsWith("0x"));
    assert.equal(result.txHash?.length, 66, "Transaction hash must be a valid 32-byte hex string (66 chars)");
    assert.ok(result.idempotencyKey);
    assert.ok(result.journalSequenceId);
  });

  it("Test 4: Rail 2 Execution — Modular Smart Account (ERC-4337 Session Key)", async () => {
    const result = await router.routeAndExecute({
      intent: {
        intentId: `DISB_RAIL2_${Date.now()}`,
        primaryAccountId: "acc_engineering",
        vendorId: "vendor_github",
        vendorName: "GitHub Enterprise",
        amountUsdc: 250.0,
        payoutAddress: "0x5555555555555555555555555555555555555555",
        declaredReason: "Automated recurring developer tooling subscription via Session Key.",
      },
      accountBalances: {
        acc_engineering: 300.0,
      },
      overrideRail: "MODULAR_SESSION_KEY",
    });

    if (!result.success) {
      console.error("Test 4 Error:", result);
    }
    assert.equal(result.success, true);
    assert.equal(result.status, "EXECUTED");
    assert.equal(result.rail, "MODULAR_SESSION_KEY");
    assert.ok(result.sessionKeyId);
    assert.ok(result.txHash?.startsWith("0x"));
    assert.equal(result.txHash?.length, 66, "UserOp hash must be a valid 32-byte hex string");
    assert.ok(result.journalSequenceId);
  });

  it("Test 5: Rail 3 Execution — ERC-3009 Gasless Transfer With Authorization", async () => {
    const result = await router.routeAndExecute({
      intent: {
        intentId: `DISB_RAIL3_${Date.now()}`,
        primaryAccountId: "acc_engineering",
        vendorId: "vendor_cloud_aws",
        vendorName: "Amazon Web Services",
        amountUsdc: 150.0,
        payoutAddress: "0x4444444444444444444444444444444444444444",
        declaredReason: "Pre-signed deterministic quarterly retainer execution.",
      },
      accountBalances: {
        acc_engineering: 200.0,
      },
      overrideRail: "ERC3009_AUTHORIZATION",
    });

    if (!result.success) {
      console.error("Test 5 Error:", result);
    }
    assert.equal(result.success, true);
    assert.equal(result.status, "EXECUTED");
    assert.equal(result.rail, "ERC3009_AUTHORIZATION");
    assert.ok(result.authorizationNonce);
    assert.ok(result.txHash?.startsWith("0x"));
    assert.equal(result.txHash?.length, 66, "ERC-3009 transaction hash must be 32 bytes");
    assert.ok(result.journalSequenceId);
  });

  it("Test 6: Rail 4 Execution — Circle Gateway Nanopayments & x402 Protocol", async () => {
    const result = await router.routeAndExecute({
      intent: {
        intentId: `DISB_RAIL4_${Date.now()}`,
        primaryAccountId: "acc_engineering",
        vendorId: "vendor_market_data",
        vendorName: "Arc Market Data Provider",
        amountUsdc: 0.05, // 5 cents micropayment
        serviceUrl: "https://api.marketdata.arc/v1/feed",
        declaredReason: "Real-time automated oracle data feed lookup via HTTP 402.",
      },
      accountBalances: {
        acc_engineering: 100.0,
      },
      overrideRail: "GATEWAY_X402",
    });

    assert.equal(result.success, true);
    assert.equal(result.status, "EXECUTED");
    assert.equal(result.rail, "GATEWAY_X402");
    assert.ok(result.gatewaySettlementRef?.startsWith("gw_nano_"));
    assert.ok(result.txHash?.startsWith("0x"));
    assert.equal(result.txHash?.length, 66, "Gateway settlement tx hash must be 32 bytes");
    assert.ok(result.journalSequenceId);
  });

  it("Test 7: Security Guardrail — Block Payee Substitution Attack across all rails", async () => {
    // Attacker modifies invoice payout address
    const result = await router.routeAndExecute({
      intent: {
        intentId: `DISB_ATTACK_${Date.now()}`,
        primaryAccountId: "acc_engineering",
        vendorId: "vendor_cloud_aws",
        vendorName: "Amazon Web Services",
        amountUsdc: 100.0,
        payoutAddress: "0x9999999999999999999999999999999999999999", // Does NOT match Vendor Master
        declaredReason: "Legitimate-looking cloud bill with altered payment address.",
      },
      accountBalances: {
        acc_engineering: 200.0,
      },
      overrideRail: "DISBURSAL_VAULT",
    });

    assert.equal(result.success, false);
    assert.equal(result.status, "REJECTED_BY_POLICY");
    assert.ok(result.error?.includes("PAYEE SUBSTITUTION DETECTED (Rule 3)"));
  });

  it("Test 8: Cryptographic Double-Entry Ledger Verification across all 4 rails", async () => {
    const isChainValid = await MasterJournalRepo.verifyChainIntegrity();
    assert.equal(isChainValid.valid, true, "Master journal hash chain must remain unbroken across all 4 rails");
    assert.ok(isChainValid.totalEntries >= 4);
  });

  it("Test 9: Live Account Balance Dynamic Resolution (No Caller-Passed Dict)", async () => {
    // Router should automatically read balances from DynamicRecordsService
    const result = await router.routeAndExecute({
      intent: {
        intentId: `DISB_DYNAMIC_BAL_${Date.now()}`,
        primaryAccountId: "acc_engineering",
        vendorId: "vendor_cloud_aws",
        vendorName: "Amazon Web Services",
        amountUsdc: 50.0,
        payoutAddress: "0x4444444444444444444444444444444444444444",
        declaredReason: "Autonomous disbursal with dynamically fetched account balances.",
      },
      // Notice: accountBalances is omitted!
      overrideRail: "DISBURSAL_VAULT",
    });

    assert.equal(result.success, true);
    assert.equal(result.status, "EXECUTED");
    assert.ok(result.txHash);
  });

  it("Test 10: Multi-Account Funding Records Balanced Intercompany Due-To / Due-From Vouchers", async () => {
    // Primary has only $30, bill is $80. $30 from acc_engineering, $50 from acc_general_treasury.
    const result = await router.routeAndExecute({
      intent: {
        intentId: `DISB_MULTI_LOAN_${Date.now()}`,
        primaryAccountId: "acc_engineering",
        vendorId: "vendor_cloud_aws",
        vendorName: "Amazon Web Services",
        amountUsdc: 80.0,
        payoutAddress: "0x4444444444444444444444444444444444444444",
        declaredReason: "Cross-account funding requiring balanced intercompany loan entries.",
      },
      accountBalances: {
        acc_engineering: 30.0,
        acc_general_treasury: 500.0,
      },
      overrideRail: "DISBURSAL_VAULT",
    });

    assert.equal(result.success, true);
    assert.equal(result.status, "EXECUTED");
    assert.equal(result.allocations?.length, 2);

    // Verify Master System Journal recorded Due-To and Due-From entries
    const journalEntries = await MasterJournalRepo.getEntriesByAccount("acc_engineering", 10);
    const dueToEntry = journalEntries.find((e) => e.action_type === "INTERCOMPANY_LOAN_DUE_TO");
    assert.ok(dueToEntry, "Primary account must have an INTERCOMPANY_LOAN_DUE_TO journal entry");
    assert.equal(Number(dueToEntry?.amount_usdc), 50.0);

    const treasuryEntries = await MasterJournalRepo.getEntriesByAccount("acc_general_treasury", 10);
    const dueFromEntry = treasuryEntries.find((e) => e.action_type === "INTERCOMPANY_LOAN_DUE_FROM");
    assert.ok(dueFromEntry, "Secondary account must have an INTERCOMPANY_LOAN_DUE_FROM journal entry");
    assert.equal(Number(dueFromEntry?.amount_usdc), 50.0);
  });

  it("Test 11: Persistent PostgreSQL ERC-3009 Nonce Replay Prevention", async () => {
    const fixedNonce = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as `0x${string}`;
    const result1 = await router.routeAndExecute({
      intent: {
        intentId: `DISB_REPLAY_1_${Date.now()}`,
        primaryAccountId: "acc_engineering",
        vendorId: "vendor_cloud_aws",
        vendorName: "Amazon Web Services",
        amountUsdc: 25.0,
        payoutAddress: "0x4444444444444444444444444444444444444444",
        declaredReason: "First execution with fixed nonce.",
      },
      accountBalances: { acc_engineering: 100.0 },
      overrideRail: "ERC3009_AUTHORIZATION",
    });
    assert.equal(result1.success, true);

    // Now attempt replay attack using the exact same nonce
    const { Erc3009AuthorizationRail } = await import("../src/payments/rails/erc3009AuthorizationRail.js");
    const freshRailInstance = new Erc3009AuthorizationRail();
    const replayResult = await freshRailInstance.execute(
      {
        intentId: `DISB_REPLAY_ATTACK_${Date.now()}`,
        primaryAccountId: "acc_engineering",
        vendorId: "vendor_cloud_aws",
        vendorName: "Amazon Web Services",
        amountUsdc: 25.0,
        payoutAddress: "0x4444444444444444444444444444444444444444",
        declaredReason: "Replay attack with previously executed nonce.",
      },
      [{ accountId: "acc_engineering", amountUsdc: 25.0, isPrimary: true }],
      { nonce: result1.authorizationNonce }
    );

    assert.equal(replayResult.success, false);
    assert.equal(replayResult.status, "REJECTED_BY_POLICY");
    assert.ok(replayResult.error?.includes("already been executed"));
  });
});

