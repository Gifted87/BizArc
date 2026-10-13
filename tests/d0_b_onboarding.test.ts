import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { EnterpriseOnboardingService as OnboardingAgent, EnterpriseIntakePayload } from "../src/services/enterpriseOnboardingService.js";
import { TreasuryAccountsRepo } from "../src/database/repos/treasuryAccountsRepo.js";
import { VendorMasterRepo } from "../src/database/repos/vendorMasterRepo.js";
import { LiabilityRepo } from "../src/database/repos/liabilityRepo.js";
import { MasterJournalRepo } from "../src/database/repos/masterJournalRepo.js";
import { AuditLogRepo } from "../src/database/repos/auditLogRepo.js";
import { DbClient } from "../src/database/dbClient.js";

describe("D0.B OnboardingAgent & D0-D3 Foundation Real-World Audit", () => {
  const pool = DbClient.getPool();
  let onboardingAgent: OnboardingAgent;

  before(async () => {
    await pool.query("DELETE FROM account_agent_audit_log;");
    await pool.query("DELETE FROM master_system_journal;");
    await pool.query("DELETE FROM permission_requests;");
    await pool.query("DELETE FROM account_liabilities;");
    await pool.query("DELETE FROM dynamic_safe_to_invest;");
    await pool.query("DELETE FROM company_profiles;");
    await pool.query("DELETE FROM vendor_master_registry;");
    await pool.query("DELETE FROM erp_sync_state;");
    await pool.query("DELETE FROM treasury_accounts;");

    onboardingAgent = new OnboardingAgent();
  });

  after(async () => {
    await DbClient.closePool();
  });

  it("Test 1: Persona and Segregation of Duties", () => {
    assert.equal(onboardingAgent.persona, "OnboardingAgent");
    assert.equal(onboardingAgent.erc8004Id, 100);
    assert.equal(onboardingAgent.canSignTransactions, true);
    assert.equal(onboardingAgent.canWriteLedger, false); // Defers ledger entries to witness/repos
  });

  it("Test 2: Phase 1 Entity & ERP Discovery", async () => {
    const intake: EnterpriseIntakePayload = {
      companyName: "Acme Global Technologies Inc.",
      primaryAdminEmail: "cfo@acmeglobal.com",
      erpSource: "ODDO",
      costCenters: [
        { id: "acc_engineering", name: "Engineering & Cloud Infrastructure", role: "OPEX_DEV" },
        { id: "acc_marketing", name: "Growth & Acquisition", role: "OPEX_GROWTH" },
        { id: "acc_payroll", name: "Corporate Payroll Escrow", role: "PAYROLL" },
        { id: "acc_general_treasury", name: "Treasury Liquidity Reserve", role: "TREASURY_RESERVE" },
      ],
      erpSuppliers: [
        {
          supplierId: "vnd_aws",
          name: "Amazon Web Services",
          payoutAddress: "0x1111111111111111111111111111111111111111",
          taxId: "US-987654321",
          contactEmail: "billing@aws.amazon.com",
          authorizedCategory: "INFRASTRUCTURE",
        },
        {
          supplierId: "vnd_datadog",
          name: "Datadog Observability",
          payoutAddress: "0x2222222222222222222222222222222222222222",
          taxId: "US-123456789",
          contactEmail: "invoicing@datadog.com",
          authorizedCategory: "DEVELOPER_TOOLS",
        },
      ],
      erpInvoices: [
        {
          invoiceNumber: "INV-AWS-2026-10",
          supplierId: "vnd_aws",
          costCenter: "acc_engineering",
          amountUsdc: 2500.0,
          dueDate: new Date(Date.now() + 10 * 86400000), // 10 days out
          purchaseOrderNumber: "PO-ENG-001",
          deliveryReceiptProof: "GRN-DELIVERY-CERTIFIED-AWS-10", // 3-way match fulfilled
        },
        {
          invoiceNumber: "INV-DD-2026-10",
          supplierId: "vnd_datadog",
          costCenter: "acc_engineering",
          amountUsdc: 300.0,
          dueDate: new Date(Date.now() + 5 * 86400000), // 5 days out
          purchaseOrderNumber: "PO-ENG-002",
          // Missing delivery receipt proof -> Rule 2 will flag UNMATCHED_DISPUTED
        },
      ],
    };

    const discovered = await onboardingAgent.ingestIntakePayload(intake);

    assert.equal(discovered.companyName, "Acme Global Technologies Inc.");
    assert.equal(discovered.erpSource, "ODDO");
    assert.equal(discovered.costCenters.length, 4);

    const eng = discovered.costCenters.find((c) => c.accountId === "acc_engineering");
    assert.ok(eng);
    assert.equal(eng?.monthlyCommittedLiabilitiesUsdc, 2800.0);
    assert.equal(eng?.highestSingleBillUsdc, 2500.0);
    assert.equal(eng?.discoveredVendors.length, 2);
  });

  it("Test 3: Phase 2 Suggested Policy Proposal Generation (Human Invariant)", async () => {
    const intake: EnterpriseIntakePayload = {
      companyName: "Acme Global Technologies Inc.",
      primaryAdminEmail: "cfo@acmeglobal.com",
      costCenters: [
        { id: "acc_engineering", name: "Engineering", role: "OPEX_DEV" },
        { id: "acc_payroll", name: "Payroll Escrow", role: "PAYROLL" },
      ],
      erpInvoices: [
        {
          invoiceNumber: "INV-1",
          supplierId: "vnd_aws",
          costCenter: "acc_engineering",
          amountUsdc: 4000.0,
          dueDate: new Date(),
        },
      ],
    };

    const discovered = await onboardingAgent.ingestIntakePayload(intake);
    const proposal = onboardingAgent.generatePolicyProposal(discovered);

    // Strict Invariant: The agent ONLY suggests; the human operator must commit.
    assert.equal(proposal.status, "SUGGESTION_PENDING_HUMAN_COMMIT");
    assert.equal(proposal.companyName, "Acme Global Technologies Inc.");
    assert.ok(proposal.rationales.length > 0);

    const engPolicy = proposal.profile.operating_accounts.find((a) => a.account_id === "acc_engineering");
    assert.ok(engPolicy);
    assert.equal(engPolicy?.exclude_from_waterfall_draws, false);
    assert.ok(engPolicy!.min_floor_usdc >= 50.0);

    const payrollPolicy = proposal.profile.operating_accounts.find((a) => a.account_id === "acc_payroll");
    assert.ok(payrollPolicy);
    assert.equal(payrollPolicy?.exclude_from_waterfall_draws, true); // Hard payroll lock
    assert.equal(payrollPolicy?.max_autonomous_sweep_limit, 0.0); // Never sweep payroll

    // Check Declared Policies
    assert.ok(proposal.profile.declared_policies);
    assert.equal(proposal.profile.declared_policies?.anomaly_tolerances?.max_price_hike_percentage, 15.0);
    assert.equal(proposal.profile.declared_policies?.tax_holdback_percentage, 15.0);
  });

  it("Test 4: Phase 3 & 4 Account Provisioning, Real DB Seeding & Ledger Genesis", async () => {
    const intake: EnterpriseIntakePayload = {
      companyName: "Nexus Enterprise Ltd.",
      primaryAdminEmail: "treasurer@nexus.io",
      costCenters: [
        { id: "acc_engineering", name: "Engineering Operations", role: "OPEX_DEV" },
        { id: "acc_payroll", name: "Payroll Escrow", role: "PAYROLL" },
      ],
      erpSuppliers: [
        {
          supplierId: "vnd_aws",
          name: "AWS EMEA",
          payoutAddress: "0x1234567890123456789012345678901234567890",
          taxId: "EU-12345",
          authorizedCategory: "INFRASTRUCTURE",
        },
      ],
      erpInvoices: [
        {
          invoiceNumber: "INV-NEXUS-001",
          supplierId: "vnd_aws",
          costCenter: "acc_engineering",
          amountUsdc: 1500.0,
          dueDate: new Date(Date.now() + 86400000 * 7),
          purchaseOrderNumber: "PO-NEXUS-01",
          deliveryReceiptProof: "GRN-NEXUS-PROVEN",
        },
        {
          invoiceNumber: "INV-NEXUS-002",
          supplierId: "vnd_aws",
          costCenter: "acc_engineering",
          amountUsdc: 800.0,
          dueDate: new Date(Date.now() + 86400000 * 14),
          purchaseOrderNumber: "PO-NEXUS-02",
          // No delivery receipt -> UNMATCHED_DISPUTED
        },
      ],
    };

    const discovered = await onboardingAgent.ingestIntakePayload(intake);
    const proposal = onboardingAgent.generatePolicyProposal(discovered);

    // Commit policy and provision
    const result = await onboardingAgent.provisionAccountsAndLedger({
      profile: discovered,
      committedPolicy: proposal.profile,
    });

    // 1. Verify PostgreSQL Accounts
    assert.equal(result.accountsCreated.length, 2);
    const dbEng = await TreasuryAccountsRepo.getAccountById("acc_engineering");
    assert.ok(dbEng);
    assert.equal(dbEng?.name, "Engineering Operations");
    assert.equal(dbEng?.role, "OPEX_DEV");

    // 2. Verify Vendor Master
    assert.equal(result.vendorsRegistered.length, 1);
    const dbVendor = await VendorMasterRepo.getVendorById("vnd_aws");
    assert.ok(dbVendor);
    assert.equal(dbVendor?.name, "AWS EMEA");
    assert.equal(dbVendor?.verified_payout_address, "0x1234567890123456789012345678901234567890");

    // 3. Verify Three-Way Match Statuses on Liabilities (Rule 1 & Rule 2)
    assert.equal(result.liabilitiesScheduled.length, 2);
    const matchedInv = result.liabilitiesScheduled.find((l) => l.title === "Invoice INV-NEXUS-001");
    const unmatchedInv = result.liabilitiesScheduled.find((l) => l.title === "Invoice INV-NEXUS-002");

    assert.equal(matchedInv?.status, "SCHEDULED"); // 3-way match passed
    assert.equal(unmatchedInv?.status, "UNMATCHED_DISPUTED"); // missing delivery proof

    // 4. Verify Genesis Block in Master System Journal
    const journalEntries = await MasterJournalRepo.getEntriesByAccount("SYSTEM_GENESIS");
    assert.ok(journalEntries.length >= 1);
    assert.equal(journalEntries[0].action_type, "GENESIS_INITIALIZATION");
    assert.equal(journalEntries[0].current_hash.length, 64);

    // 5. Verify Onboarding Audit Log
    const auditLogs = await AuditLogRepo.getAuditLogsByAccount("acc_engineering");
    assert.ok(auditLogs.length >= 1);
    assert.equal(auditLogs[0].action_type, "BUSINESS_ONBOARDING_COMPLETED");
  });

  it("Test 5: Phase 6 Spending Guardrails Terminal Handoff (Circle Agent Policy)", () => {
    const costCenters = [
      {
        accountId: "acc_engineering",
        name: "Engineering",
        role: "OPEX_DEV" as const,
        walletAddress: "0x1111111111111111111111111111111111111101" as `0x${string}`,
        monthlyCommittedLiabilitiesUsdc: 5000,
        highestSingleBillUsdc: 2000,
        discoveredVendors: ["vnd_aws"],
      },
      {
        accountId: "acc_payroll",
        name: "Payroll",
        role: "PAYROLL" as const,
        walletAddress: "0x2222222222222222222222222222222222222202" as `0x${string}`,
        monthlyCommittedLiabilitiesUsdc: 25000,
        highestSingleBillUsdc: 5000,
        discoveredVendors: [],
      },
    ];

    const handoff = onboardingAgent.generateSpendingGuardrailsCommands(costCenters);

    assert.equal(handoff.commands.length, 2);
    assert.ok(handoff.securityNotice.includes("CRITICAL SECURITY INVARIANT: OTPs are password-equivalent"));

    for (const cmd of handoff.commands) {
      // Verify monotonic invariant: perTx <= daily <= weekly <= monthly
      assert.ok(cmd.perTxCap <= cmd.dailyCap);
      assert.ok(cmd.dailyCap <= cmd.weeklyCap);
      assert.ok(cmd.weeklyCap <= cmd.monthlyCap);

      // Verify exact Circle CLI syntax per agent-wallet-policy
      assert.ok(cmd.command.startsWith("circle wallet limit set --address"));
      assert.ok(cmd.command.includes("--chain ARC"));
      assert.ok(cmd.command.includes(`--per-tx ${cmd.perTxCap}`));
      assert.ok(cmd.command.includes(`--daily ${cmd.dailyCap}`));
    }
  });

  it("Test 6: Phase 7 Initial Funding & Activation Status", async () => {
    const fundingStatus = await onboardingAgent.verifyInitialFunding("acc_engineering", 5.0);
    assert.equal(fundingStatus.accountId, "acc_engineering");
    assert.equal(typeof fundingStatus.isFunded, "boolean");
    assert.ok(["ACTIVATED", "AWAITING_DEPOSIT"].includes(fundingStatus.status));
  });
});
