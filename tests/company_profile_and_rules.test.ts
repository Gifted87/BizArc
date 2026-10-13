import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { McpAppConnector } from "../src/connectors/mcpAppConnector.js";
import { CompanyProfileRepo } from "../src/database/repos/companyProfileRepo.js";
import { EnterpriseOnboardingService } from "../src/services/enterpriseOnboardingService.js";
import { PolicyComplianceLlmAgent } from "../src/agents/policyComplianceLlmAgent.js";
import { TreasurySentinelService } from "../src/services/treasurySentinelService.js";
import { DynamicRecordsService } from "../src/records/dynamicRecordsService.js";
import { DbClient } from "../src/database/dbClient.js";
import { TreasuryAccountsRepo } from "../src/database/repos/treasuryAccountsRepo.js";
import { MasterJournalRepo } from "../src/database/repos/masterJournalRepo.js";
import { AuditLogRepo } from "../src/database/repos/auditLogRepo.js";
import { UniversalOpenAiCompatibleEngine } from "../src/llm/llmEngine.js";

describe("Company Profile, MCP Ingestion, Dual Rules, Dynamic Records & SPRS Audit", () => {
  const mcp = new McpAppConnector();
  const onboarding = new EnterpriseOnboardingService();
  const dynamicRecords = new DynamicRecordsService();
  const sentinelService = new TreasurySentinelService();
  const llmEngine = new UniversalOpenAiCompatibleEngine();
  const complianceAgent = new PolicyComplianceLlmAgent(llmEngine);

  before(async () => {
    await DbClient.query("DELETE FROM account_liabilities WHERE account_id = 'acc_engineering'");
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

    mcp.setGoogleTransport({
      async callTool(name: string, args: Record<string, any>) {
        if (name === "gmail_search_messages") return { messageIds: ["msg_g1"] };
        if (name === "gmail_get_message") {
          return {
            id: "msg_g1",
            bodyText: `Invoice from Amazon Web Services (AWS)\nInvoice Number: INV-2026-AWS-01\nAmount Due: $15,000.00\nDue Date: 2026-10-31\nCost Center: Cloud Infrastructure Compute\nPayout Address: 0xaaaa111111111111111111111111111111111101\nPO Reference: PO-2026-AWS-INFRA`,
          };
        }
        if (name === "gdrive_search_files") return { files: [{ id: "f_g1", name: "AWS Enterprise Agreement 2026.pdf" }] };
        if (name === "gdrive_download_file") {
          return {
            text: `ENTERPRISE MASTER SERVICES AGREEMENT\nCounterparty: Amazon Web Services (AWS)\nEffective Date: 2026-01-01\nRenewal Date: 2026-12-31\nMonthly Minimum Commitment: $15,000.00\nCost Center: Cloud Infrastructure Compute`,
          };
        }
        return {};
      },
    });

    mcp.setMicrosoftTransport({
      async callTool(name: string, args: Record<string, any>) {
        if (name === "onedrive_search_files") {
          return {
            files: [
              { id: "f_ms_excel", name: "Budget_Schedule_2026.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
              { id: "f_ms_contract", name: "Microsoft_Enterprise_Agreement.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
            ],
          };
        }
        if (name === "excel_read_range") {
          return {
            values: [
              ["Invoice ID", "Vendor", "Amount", "Due Date", "Cost Center", "Payout Address"],
              ["INV-2026-MS-01", "Microsoft Azure", 7450.0, "2026-10-25", "Enterprise Active Directory", "0xffff555555555555555555555555555555555501"],
            ],
          };
        }
        if (name === "onedrive_download_file") {
          return {
            text: `MICROSOFT ENTERPRISE AGREEMENT\nCounterparty: Microsoft Corporation\nEffective Date: 2026-01-01\nRenewal Date: 2026-12-31\nMonthly Minimum Commitment: $7,450.00\nCost Center: Enterprise Active Directory`,
          };
        }
        return {};
      },
    });
  });

  after(async () => {
    await DbClient.closePool();
  });

  it("Test 1: MCP Connection gathers company data through Google Apps and Microsoft Apps", async () => {
    const googleData = await mcp.fetchGoogleAppsFinancialData();
    assert.ok(googleData.invoices.length >= 1, "Should fetch invoices from Google Drive / Gmail MCP");
    assert.ok(googleData.contracts.length >= 1, "Should fetch contracts from Google Drive MCP");

    const msData = await mcp.fetchMicrosoftAppsFinancialData();
    assert.ok(msData.invoices.length >= 1, "Should fetch invoices from Microsoft 365 Excel MCP");
    assert.ok(msData.contracts.length >= 1, "Should fetch contracts from Microsoft 365 OneDrive MCP");

    const aggregate = await mcp.aggregateAllCompanyAppData();
    assert.ok(aggregate.connectedApps.includes("Google Workspace (Drive, Gmail MCP)"));
    assert.ok(aggregate.connectedApps.includes("Microsoft 365 (OneDrive, Excel MCP)"));
    assert.ok(aggregate.totalCommittedMonthlySpendUsdc > 0);
  });

  it("Test 2: Company Profile creation from ingested and connected data during onboarding", async () => {
    const profile = await onboarding.createCompanyProfileFromConnectedData({
      companyId: "corp_nexus_technologies",
      companyName: "Nexus Technologies Inc.",
      businessDescription: "Enterprise cloud infrastructure SaaS company",
      includeMcpApps: true,
    });

    assert.equal(profile.company_id, "corp_nexus_technologies");
    assert.equal(profile.company_name, "Nexus Technologies Inc.");
    assert.ok(profile.connected_apps.length >= 2);
    assert.ok(profile.discovered_cost_centers.length >= 2);
    assert.equal(profile.activation_status, "PENDING_ACTIVATION");

    // Verify stored in PostgreSQL company_profiles table
    const dbProfile = await CompanyProfileRepo.getProfileById("corp_nexus_technologies");
    assert.ok(dbProfile);
    assert.equal(dbProfile?.company_name, "Nexus Technologies Inc.");

    // Update activation status
    const activated = await CompanyProfileRepo.updateActivationStatus("corp_nexus_technologies", "ACTIVATED");
    assert.equal(activated?.activation_status, "ACTIVATED");
  });

  it("Test 3: The Two Types of Rules — Mathematical Rules vs Declared Policies", async () => {
    const profile = await CompanyProfileRepo.getProfileById("corp_nexus_technologies");
    assert.ok(profile);

    const mathRules = profile.inferred_policies.mathematicalRules;
    const declaredPolicies = profile.inferred_policies.declaredPolicies;

    // Verify Mathematical Rules (Tier A)
    assert.ok(mathRules);
    assert.equal(mathRules.operatingCashFloors.acc_engineering, 50.0);
    assert.equal(mathRules.safetyBufferMultipliers.standardOpex, 1.20);
    assert.equal(mathRules.spendingHardCaps.dailyHardCapUsdc, 5000.0);
    assert.equal(mathRules.spendingHardCaps.singleTxHumanGateThresholdUsdc, 500.0);
    assert.equal(mathRules.precisionDecimals, 6);

    // Verify Declared Policies (Tier B)
    assert.ok(declaredPolicies);
    assert.ok(declaredPolicies.costCenterRules.length >= 2);
    assert.equal(declaredPolicies.anomalyTolerances.maxPriceHikePercentage, 15.0);
    assert.equal(declaredPolicies.anomalyTolerances.flagUnregisteredVendors, true);
    assert.equal(declaredPolicies.anomalyTolerances.requireThreeWayMatch, true);

    // Human Edits Both Mathematical & Declared Policies (Living & Editable Invariant)
    const updated = await CompanyProfileRepo.updatePolicies("corp_nexus_technologies", {
      mathematicalRules: {
        spendingHardCaps: {
          dailyHardCapUsdc: 10000.0, // Human CFO increases daily cap from $5000 to $10,000
          singleTxHumanGateThresholdUsdc: 750.0, // Human CFO raises single tx gate from $500 to $750
        },
      },
      declaredPolicies: {
        anomalyTolerances: {
          maxPriceHikePercentage: 10.0, // Human CFO tightens tolerance from 15% to 10%
          flagUnregisteredVendors: true,
          requireThreeWayMatch: true,
        },
      },
    });

    assert.ok(updated);
    assert.equal(updated?.inferred_policies.mathematicalRules.spendingHardCaps.dailyHardCapUsdc, 10000.0);
    assert.equal(updated?.inferred_policies.mathematicalRules.spendingHardCaps.singleTxHumanGateThresholdUsdc, 750.0);
    assert.equal(updated?.inferred_policies.declaredPolicies.anomalyTolerances.maxPriceHikePercentage, 10.0);
  });

  it("Test 4: The Dynamic Records — Record 1, Record 2 & Parallel Tripartite Balance ($B_L + B_Y = B_E$)", async () => {
    // Calculate Dynamic Safe to Invest (Dynamic Record 2) with explicit liquid and invested balances
    const record = await dynamicRecords.calculateSafeToInvest(
      "acc_engineering",
      7 * 86400,
      "15.000000",
      20000000n, // $20.000000 USDC
      80000000n  // $80.000000 USYC
    );

    assert.equal(record.accountId, "acc_engineering");
    assert.equal(record.tripartiteBalance.liquidCashUsdc, "20.000000");
    assert.equal(record.tripartiteBalance.investedYieldUsdc, "80.000000");

    // Verify Parallel Tripartite Balance:
    // When $20 is liquid and $80 is invested in USYC, Available Balance MUST show $100
    const tripartite = await dynamicRecords.getTripartiteBalance("acc_engineering", 20000000n, 80000000n);
    assert.equal(tripartite.liquidCashUsdc, "20.000000");
    assert.equal(tripartite.investedYieldUsdc, "80.000000");
    assert.equal(tripartite.availableBalanceUsdc, "100.000000"); // 20 + 80 = 100
  });

  it("Test 5: The Rule Enforcement Process — Operator submits reason-bearing intent, Enforcer issues PERMIT", async () => {
    const evaluation = await complianceAgent.evaluateIntent({
      proposedAction: "SWEEP_TO_USYC",
      accountId: "acc_engineering",
      amountUsdc: "5.000000",
      declaredReason: "Sweep surplus operational liquidity above $15 target reserve to USYC yield fund.",
    });

    assert.equal(evaluation.decision, "PERMIT");
    assert.ok(evaluation.clearanceCode?.startsWith("CLEAR-"));
  });

  it("Test 6: The Permission Process (SPRS) — Outside the rules escalates to rich SPRS with binary options", async () => {
    // 1. Compliance Agent escalates when amount exceeds per-transaction cap
    const complianceEvaluation = await complianceAgent.evaluateIntent({
      proposedAction: "DISBURSAL_PAYMENT",
      accountId: "acc_engineering",
      amountUsdc: "30000.000000",
      declaredReason: "Monthly mission-critical cloud compute infrastructure renewal for engineering.",
    });

    assert.equal(complianceEvaluation.decision, "ESCALATE_TO_SPRS");
    assert.ok(complianceEvaluation.sprsRequestId?.startsWith("SPRS_"));

    // 2. Sentinel Service generates rich StandardizedPermissionRequest with binary options
    const sentinelEval = await sentinelService.evaluateAccount("acc_engineering", 6000.0);
    assert.equal(sentinelEval.branch, "OUTSIDE_RULES");
    assert.equal(sentinelEval.action, "SPRS_REQUIRED");
    assert.ok(sentinelEval.sprs);

    const sprs = sentinelEval.sprs;
    assert.equal(sprs.action, "HIGH_VALUE_SWEEP_EXEMPTION");
    assert.ok(sprs.reason.includes("exceeds autonomous limit"));
    assert.ok(sprs.affectedAccounts.length >= 1);
    assert.equal(sprs.affectedAccounts[0].accountId, "acc_engineering");

    // Verify Binary Options: APPROVE vs REJECT
    assert.ok(sprs.options.some((o) => o.action === "APPROVE"));
    assert.ok(sprs.options.some((o) => o.action === "REJECT"));
  });

  it("Test 7: Dual Audit Logging — Account Agent Log (timed actions per account) & Central Master Journal", async () => {
    // 1. Account Agent Audit Log (timed actions per account)
    const auditEntry = await AuditLogRepo.appendAuditLog({
      account_id: "acc_engineering",
      actor_agent: "TreasurySentinelAgent",
      action_type: "AUTONOMOUS_SWEEP_EXECUTED",
      amount_usdc: 5.0,
      is_autonomous: true,
      reason: "Surplus cash swept to Central USYC Vault inside rules.",
      pre_state_snapshot: { liquidUsdc: 20.0, investedUsyc: 80.0 },
      post_state_snapshot: { liquidUsdc: 15.0, investedUsyc: 85.0 },
    });
    assert.ok(Number(auditEntry.log_id) > 0);
    assert.equal(auditEntry.actor_agent, "TreasurySentinelAgent");

    // 2. Central Master System Journal (sequential hash chain across all accounts)
    const journalEntry = await MasterJournalRepo.appendEntry({
      account_id: "acc_engineering",
      action_type: "AUTONOMOUS_SWEEP",
      debit_account: "Asset:Investments:USYC:acc_engineering",
      credit_account: "Asset:Cash:USDC:acc_engineering",
      amount_usdc: 5.0,
      document_ref: `ARC:TX:0xarc_sweep_${Date.now()}`,
    });
    assert.ok(journalEntry.current_hash.length === 64);

    const isChainValid = await MasterJournalRepo.verifyChainIntegrity();
    if (!isChainValid.valid) {
      console.error("verifyChainIntegrity failure:", isChainValid);
    }
    assert.equal(isChainValid.valid, true);
  });
});
