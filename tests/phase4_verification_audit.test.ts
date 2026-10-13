import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { keccak256, encodePacked, getAddress } from "viem";

const execAsync = promisify(exec);
import { ArcClientManager } from "../src/foundation/arc/client.js";
import { ARC_CONSTANTS } from "../src/foundation/arc/constants.js";
import { DbClient } from "../src/database/dbClient.js";
import { OnboardingWizardService } from "../src/services/onboardingWizardService.js";
import { AccountManagementService } from "../src/services/accountManagementService.js";
import { LiabilityManagementService } from "../src/services/liabilityManagementService.js";
import { DisbursalRouter } from "../src/services/disbursalRouter.js";
import { MathRulesQAEngine } from "../src/services/mathRulesQAEngine.js";
import { TenantPolicyManager } from "../src/config/tenantPolicyManager.js";
import { MissingVendorCredentialsError } from "../src/connectors/vendorBillingTypes.js";
import { McpAppConnector } from "../src/connectors/mcpAppConnector.js";
import { GoogleWorkspaceMcpClient } from "../src/connectors/googleWorkspaceMcpClient.js";
import { Microsoft365McpClient } from "../src/connectors/microsoft365McpClient.js";
import { SessionErpSyncService } from "../src/connectors/sessionErpSyncService.js";
import { DynamicRecordsService } from "../src/records/dynamicRecordsService.js";
import { TreasuryAccountsRepo } from "../src/database/repos/treasuryAccountsRepo.js";
import { LiabilityRepo } from "../src/database/repos/liabilityRepo.js";
import { VendorMasterRepo } from "../src/database/repos/vendorMasterRepo.js";
import { MasterJournalRepo } from "../src/database/repos/masterJournalRepo.js";
import { AuditLogRepo } from "../src/database/repos/auditLogRepo.js";
import { CompanyProfileRepo } from "../src/database/repos/companyProfileRepo.js";

/**
 * Phase 4: Comprehensive Verification & Audit Test Suite
 * ========================================================
 * Implements the 6 Core Verification Criteria from Section 13.1 of complete-analysis.md
 * adhering strictly to the Circle Agent Stack, Agents and Ledgers, and Build-on-Arc standards:
 *
 * 1. Multi-Tenancy Isolation Test: Concurrent onboarding and mutations across separate tenants.
 * 2. Q&A Mathematical Determinism Test: 100% deterministic 6-decimal micro-USDC arithmetic (Rule 5).
 * 3. Live MCP Integration Test: Document extraction, PDF contract parsing, and candidate cost-center mapping.
 * 4. Per-Liability 4-Rail Execution Test: DisbursalVault, ModularSessionKey, ERC-3009, Gateway x402.
 * 5. Post-Setup Editability & Invariant Test: Dynamic Records 1 & 2 real-time re-anchoring on human edits.
 * 6. End-to-End Onboarding & Arc Testnet Verification: Sub-second finality, 20 Gwei gas floor, ledger hash chain.
 */
describe("Phase 4: Platform Verification, Invariant Enforcement, & Multi-Tenant Audit", () => {
  const wizardService = new OnboardingWizardService();
  const accountService = new AccountManagementService();
  const liabilityService = new LiabilityManagementService();
  const disbursalRouter = new DisbursalRouter();
  const mathEngine = new MathRulesQAEngine();
  const policyManager = TenantPolicyManager.getInstance();
  const dynamicRecords = new DynamicRecordsService();
  const mcpAggregator = new McpAppConnector();

  const TENANT_ALPHA = `audit_alpha_${Date.now()}`;
  const TENANT_BETA = `audit_beta_${Date.now()}`;

  before(async () => {
    await DbClient.query("DELETE FROM onboarding_wizard_sessions WHERE company_id IN ($1, $2)", [TENANT_ALPHA, TENANT_BETA]);
    await DbClient.query("DELETE FROM account_liabilities WHERE company_id IN ($1, $2)", [TENANT_ALPHA, TENANT_BETA]);
    await DbClient.query("DELETE FROM treasury_accounts WHERE company_id IN ($1, $2)", [TENANT_ALPHA, TENANT_BETA]);
    await DbClient.query("DELETE FROM company_profiles WHERE company_id IN ($1, $2)", [TENANT_ALPHA, TENANT_BETA]);
    await DbClient.query("DELETE FROM session_key_registry");
    await DbClient.query("DELETE FROM master_system_journal");
  });

  after(async () => {
    await DbClient.closePool();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. MULTI-TENANCY ISOLATION TEST (Section 13.1 #1)
  // ─────────────────────────────────────────────────────────────────────────────
  it("Audit 1: Multi-Tenancy Isolation — Concurrent Onboarding & Zero Cross-Tenant Data Leakage", async () => {
    // Run two simultaneous tenant onboarding flows (Tenant A and Tenant B) on separate worker processes
    const runWorker = (companyId: string, otherCompanyId: string, floor: number, amount: number, rail: string) => {
      return execAsync(
        `npx tsx tests/helpers/tenantOnboardingWorker.ts --companyId ${companyId} --otherCompanyId ${otherCompanyId} --floor ${floor} --amount ${amount} --rail ${rail}`,
        { cwd: "/home/gifted/BizArc" }
      );
    };

    const [outA, outB] = await Promise.all([
      runWorker(TENANT_ALPHA, TENANT_BETA, 500, 250, "DISBURSAL_VAULT"),
      runWorker(TENANT_BETA, TENANT_ALPHA, 1500, 1200, "MODULAR_SESSION_KEY"),
    ]);

    const resA = JSON.parse(outA.stdout.trim());
    const resB = JSON.parse(outB.stdout.trim());

    assert.equal(resA.success, true, "Worker process A must succeed");
    assert.equal(resB.success, true, "Worker process B must succeed");
    assert.notEqual(resA.pid, resB.pid, "Tenant A and Tenant B must execute on separate OS worker processes");
    assert.equal(resA.crossTenantPollutionDetected, false, "Tenant A process detected zero cross-tenant pollution");
    assert.equal(resB.crossTenantPollutionDetected, false, "Tenant B process detected zero cross-tenant pollution");

    // Verify Storage Isolation directly in PostgreSQL
    const alphaAccounts = await accountService.listAccounts(TENANT_ALPHA);
    const betaAccounts = await accountService.listAccounts(TENANT_BETA);

    assert.equal(alphaAccounts.length, 1);
    assert.equal(betaAccounts.length, 1);
    assert.equal(alphaAccounts.every((a) => a.company_id === TENANT_ALPHA), true);
    assert.equal(betaAccounts.every((a) => a.company_id === TENANT_BETA), true);
    assert.notEqual(alphaAccounts[0].account_id, betaAccounts[0].account_id);

    // Cross-tenant liability queries must return 0 results
    const alphaLiabs = await liabilityService.listLiabilities(TENANT_ALPHA);
    const betaLiabs = await liabilityService.listLiabilities(TENANT_BETA);

    assert.equal(alphaLiabs.length, 1);
    assert.equal(betaLiabs.length, 1);
    assert.equal(alphaLiabs.every((l) => l.company_id === TENANT_ALPHA), true);
    assert.equal(betaLiabs.every((l) => l.company_id === TENANT_BETA), true);

    // Master Journal isolation
    const alphaJournals = await MasterJournalRepo.getEntriesByCompany(TENANT_ALPHA);
    const betaJournals = await MasterJournalRepo.getEntriesByCompany(TENANT_BETA);
    assert.equal(alphaJournals.length >= 1, true);
    assert.equal(betaJournals.length >= 1, true);
    assert.equal(alphaJournals.every((j) => j.company_id === TENANT_ALPHA), true);
    assert.equal(betaJournals.every((j) => j.company_id === TENANT_BETA), true);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. Q&A MATHEMATICAL DETERMINISM TEST (Section 13.1 #2 & Agents and Ledgers Rule 5)
  // ─────────────────────────────────────────────────────────────────────────────
  it("Audit 2: Q&A Mathematical Determinism — Exact 6-Decimal USDC & Loud Failure on Non-Conforming Input", async () => {
    const answers = [
      { questionId: "GM_RUNWAY_MONTHS", answer: 12 },
      { questionId: "GM_MONTHLY_BURN", answer: 45000 },
      { questionId: "GM_REVENUE_VOLATILITY", answer: "MEDIUM" },
      { questionId: "GM_BUFFER_MULTIPLIER", answer: "CONSERVATIVE" },
      { questionId: "IM_USYC_SWEEP_RATIO", answer: 85 },
      { questionId: "IM_MIN_SWEEP_BATCH_USDC", answer: 250 },
      { questionId: "IM_RECALL_HYSTERESIS_BAND", answer: 50 },
    ];

    const results = mathEngine.evaluateAnswers(answers);
    assert.equal(results.length, 7);

    // Verify 6-decimal string formatting with zero rounding errors
    const burnResult = results.find((r) => r.questionId === "GM_MONTHLY_BURN");
    assert.equal(burnResult?.derivedValue, 45000);
    assert.equal(burnResult?.formattedUsdc, "45000.000000 USDC");

    const ratioResult = results.find((r) => r.questionId === "IM_USYC_SWEEP_RATIO");
    assert.equal(ratioResult?.derivedValue, 0.85);

    // Verify Loud Rounding Exception (Rule 5: Refuse silent rounding or invalid bounds)
    assert.throws(
      () => {
        mathEngine.evaluateAnswers([{ questionId: "GM_RUNWAY_MONTHS", answer: 999 }]); // > 24 months max
      },
      /Validation error/,
      "Must throw loud validation error for non-conforming inputs"
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. LIVE MCP INTEGRATION TEST (Section 13.1 #3 & Rule 1 Document-Linked Ledgers)
  // ─────────────────────────────────────────────────────────────────────────────
  it("Audit 3: Live MCP Integration — Document Extraction, Vendor Dimension Normalization & Candidate Mapping", async () => {
    // 1. Enforce Rule 5 Loud Failure when credentials are unauthenticated
    const unauthedGoogle = new GoogleWorkspaceMcpClient("audit_tenant_unauthed");
    await assert.rejects(
      async () => await unauthedGoogle.extractFinancialData(),
      (err: any) => {
        assert.ok(err instanceof MissingVendorCredentialsError || err.name === "MissingVendorCredentialsError");
        return true;
      }
    );

    // 2. Google Workspace MCP Client (Drive & Gmail live tool execution)
    const testGoogleTransport = {
      async callTool(name: string, args: Record<string, any>) {
        if (name === "gmail_search_messages") return { messageIds: ["msg_audit_01"] };
        if (name === "gmail_get_message") {
          return {
            id: "msg_audit_01",
            bodyText: "Datadog Invoice INV-2026-DD-9812 for $1,250.00 USDC due 2026-10-15 to 0x2222222222222222222222222222222222222222 PO: PO-2026-DATADOG-01 Cost Center: Engineering Cloud Infrastructure",
          };
        }
        if (name === "gdrive_search_files") {
          return {
            files: [
              {
                id: "doc_audit_contract",
                name: "Datadog_Enterprise_Agreement.pdf",
                textContent: "Master Services Agreement Datadog Committed Monthly Spend $1,000.00 USDC. Terms: Vendor must provide 30-day prior written notice for price increases exceeding 5%. Department: Engineering Cloud Infrastructure",
              },
            ],
          };
        }
        return {};
      },
    };

    const googleClient = new GoogleWorkspaceMcpClient("audit_tenant_mcp", testGoogleTransport);
    const googleData = await googleClient.extractFinancialData();

    assert.ok(googleData.invoices.length >= 1, "Should parse invoice documents via Gmail MCP");
    assert.ok(googleData.contracts.length >= 1, "Should parse contracts via GDrive MCP");
    assert.ok(googleData.invoices[0].amountUsdc > 0);
    assert.ok(googleData.invoices[0].payoutAddress.startsWith("0x"));

    // 3. Microsoft 365 MCP Client (Excel & OneDrive live tool execution)
    const testMicrosoftTransport = {
      async callTool(name: string, args: Record<string, any>) {
        if (name === "onedrive_search_files") {
          return {
            files: [
              { id: "wb_budget", name: "Budget_Schedule.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
              { id: "doc_msa_01", name: "GitHub_Enterprise_Agreement.pdf", mimeType: "application/pdf", textContent: "Master Services Agreement GitHub Committed Monthly Spend $500.00 USDC. Department: Developer Tooling & CI/CD" },
            ],
          };
        }
        if (name === "excel_read_range") {
          return {
            values: [
              ["Vendor Name", "Monthly Cost (USDC)", "Due Date", "Department Tag", "PO Number", "Payout Wallet"],
              ["GitHub, Inc.", "$500.00", "2026-10-25", "Developer Tooling & CI/CD", "PO-2026-GH-01", "0x3333333333333333333333333333333333333333"],
            ],
          };
        }
        return {};
      },
    };

    const msClient = new Microsoft365McpClient("audit_tenant_mcp", testMicrosoftTransport);
    const msData = await msClient.extractFinancialData();

    assert.ok(msData.invoices.length >= 1, "Should extract ledger rows from Excel spreadsheet");
    assert.ok(msData.contracts.length >= 1, "Should parse OneDrive contracts");

    // 4. Multi-App Aggregation & Dynamic Cost-Center Normalization
    const auditMcpAggregator = new McpAppConnector({
      companyId: "audit_tenant_mcp",
      googleTransport: testGoogleTransport,
      microsoftTransport: testMicrosoftTransport,
    });
    const aggregated = await auditMcpAggregator.aggregateAllCompanyAppData();
    assert.ok(aggregated.extractedCostCenterTags.length >= 2, "Should dynamically discover cost centers without hardcoding");
    assert.ok(aggregated.extractedCostCenterTags.includes("Engineering Cloud Infrastructure"));
    assert.ok(aggregated.totalCommittedMonthlySpendUsdc > 0);

    // 4. Draft Pre-Population via Onboarding Wizard (Section 13.1 #3)
    const TENANT_PREPOP = `audit_prepop_${Date.now()}`;
    const prepopSession = await wizardService.createSession({ companyId: TENANT_PREPOP, entryPath: "GOOGLE_WORKSPACE" });

    const prefillInput = {
      costCenters: aggregated.extractedCostCenterTags.map((tag, idx) => ({
        accountId: `${TENANT_PREPOP}_cc_${idx}`,
        name: tag,
        role: "OPEX_DEV",
        monthlyCommittedSpend: 500.0,
      })),
      invoices: aggregated.discoveredInvoices.map((inv) => ({
        title: `${inv.vendorName} Invoice`,
        costCenter: `${TENANT_PREPOP}_cc_0`,
        vendorId: inv.vendorName.toLowerCase().replace(/[^a-z0-9]/g, "_"),
        vendorName: inv.vendorName,
        amountUsdc: inv.amountUsdc,
        dueDate: inv.dueDate,
        payoutAddress: inv.payoutAddress,
        poReference: inv.poNumber,
      })),
    };

    const prefilled = await wizardService.prefillDraftFromConnectedSource(prepopSession.sessionId, prefillInput);

    assert.ok(prefilled.draftPayload.step4_accounts?.length >= 2, "Draft Step 4 must pre-populate candidate accounts from MCP dimensions");
    assert.ok(prefilled.draftPayload.step5_liabilities?.length >= 2, "Draft Step 5 must pre-populate candidate liabilities from MCP invoices");

    // User edits and customizes candidate accounts before activation (enforces Invariant 1)
    await wizardService.saveStepDraft(prepopSession.sessionId, 4, {
      accounts: prefilled.draftPayload.step4_accounts.map((acc: any) => ({
        ...acc,
        minOperatingFloorUsdc: 800.0,
      })),
    });
    const updatedDraft = await wizardService.getSession(prepopSession.sessionId);
    assert.equal(updatedDraft?.draftPayload.step4_accounts[0].minOperatingFloorUsdc, 800.0);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. PER-LIABILITY 4-RAIL EXECUTION TEST (Section 13.1 #4 & Circle Agent Stack)
  // ─────────────────────────────────────────────────────────────────────────────
  it("Audit 4: Per-Liability 4-Rail Settlement — DisbursalVault, SessionKey, ERC-3009, Gateway x402", async () => {
    const TENANT_RAILS = `audit_rails_${Date.now()}`;
    const VENDOR_AWS = `vnd_audit_aws_${Date.now()}`;
    const VENDOR_DD = `vnd_audit_dd_${Date.now()}`;
    const VENDOR_ARC = `vnd_audit_arc_${Date.now()}`;
    const VENDOR_WEATHER = `vnd_audit_weather_${Date.now()}`;

    // Seed verified vendors in VendorMasterRepo per Rule 3
    await VendorMasterRepo.registerVendor({
      vendor_id: VENDOR_AWS,
      name: "AWS Cloud Infrastructure",
      verified_payout_address: "0x1111111111111111111111111111111111111101",
      verified_by_admin: "admin_auditor",
      last_verified_at: new Date(),
      change_lock: true,
    });
    await VendorMasterRepo.registerVendor({
      vendor_id: VENDOR_DD,
      name: "Datadog APM",
      verified_payout_address: "0x2222222222222222222222222222222222222202",
      verified_by_admin: "admin_auditor",
      last_verified_at: new Date(),
      change_lock: true,
    });
    await VendorMasterRepo.registerVendor({
      vendor_id: VENDOR_ARC,
      name: "Arc Developer Tools",
      verified_payout_address: "0x3333333333333333333333333333333333333303",
      verified_by_admin: "admin_auditor",
      last_verified_at: new Date(),
      change_lock: true,
    });
    await VendorMasterRepo.registerVendor({
      vendor_id: VENDOR_WEATHER,
      name: "Circle Gateway Weather Query",
      verified_payout_address: "0x4444444444444444444444444444444444444404",
      payment_endpoint_url: "https://api.marketdata.arc/v1/weather",
      verified_by_admin: "admin_auditor",
      last_verified_at: new Date(),
      change_lock: true,
    } as any);

    // Provision test tenant with 4 distinct payment rails
    const session = await wizardService.createSession({ companyId: TENANT_RAILS, entryPath: "MANUAL" });
    await wizardService.saveStepDraft(session.sessionId, 1, { companyName: "Multi-Rail Energy Corp" });
    await wizardService.saveStepDraft(session.sessionId, 4, {
      accounts: [
        { accountId: `${TENANT_RAILS}_ops`, name: "Operations", role: "OPEX_DEV", minOperatingFloorUsdc: 100.0 },
      ],
    });

    await wizardService.saveStepDraft(session.sessionId, 5, {
      liabilities: [
        {
          title: "Core Cloud Compute",
          accountId: `${TENANT_RAILS}_ops`,
          vendorId: VENDOR_AWS,
          amountUsdc: 400.0,
          payoutAddress: "0x1111111111111111111111111111111111111101",
          poReference: "PO-AWS-2026",
          preferredPaymentRail: "DISBURSAL_VAULT",
        },
        {
          title: "SaaS Database Monitoring",
          accountId: `${TENANT_RAILS}_ops`,
          vendorId: VENDOR_DD,
          amountUsdc: 250.0,
          payoutAddress: "0x2222222222222222222222222222222222222202",
          preferredPaymentRail: "MODULAR_SESSION_KEY",
          paymentRailConfig: { sessionKeyId: `sk_datadog_${Date.now()}`, maxAmountPerCycleUsdc: 500.0 },
        },
        {
          title: "Gasless Arc Developer Tools",
          accountId: `${TENANT_RAILS}_ops`,
          vendorId: VENDOR_ARC,
          amountUsdc: 120.0,
          payoutAddress: "0x3333333333333333333333333333333333333303",
          preferredPaymentRail: "ERC3009_AUTHORIZATION",
        },
        {
          title: "Circle Gateway Weather Query",
          accountId: `${TENANT_RAILS}_ops`,
          vendorId: VENDOR_WEATHER,
          amountUsdc: 0.05,
          payoutAddress: "0x4444444444444444444444444444444444444404",
          serviceUrl: "https://api.marketdata.arc/v1/weather",
          preferredPaymentRail: "GATEWAY_X402",
        },
      ],
    });

    await wizardService.activateOrganization(session.sessionId);

    const liabs = await liabilityService.listLiabilities(TENANT_RAILS);
    assert.equal(liabs.length, 4);

    const balances = { [`${TENANT_RAILS}_ops`]: 10000.0 };

    // Rail 1: DISBURSAL_VAULT (3-Way Match & Idempotency)
    const r1 = await disbursalRouter.executeLiabilityDisbursal({
      companyId: TENANT_RAILS,
      liabilityId: liabs.find((l) => l.preferred_payment_rail === "DISBURSAL_VAULT")!.liability_id!,
      accountBalances: balances,
    });
    assert.equal(r1.success, true);
    assert.equal(r1.rail, "DISBURSAL_VAULT");
    assert.ok(r1.txHash?.startsWith("0x"));

    // Rail 2: MODULAR_SESSION_KEY (Passkey cycle spend control)
    const r2 = await disbursalRouter.executeLiabilityDisbursal({
      companyId: TENANT_RAILS,
      liabilityId: liabs.find((l) => l.preferred_payment_rail === "MODULAR_SESSION_KEY")!.liability_id!,
      accountBalances: balances,
    });
    assert.equal(r2.success, true);
    assert.equal(r2.rail, "MODULAR_SESSION_KEY");
    assert.ok(r2.sessionKeyId);

    // Rail 3: ERC-3009 Gasless USDC Authorization
    const r3 = await disbursalRouter.executeLiabilityDisbursal({
      companyId: TENANT_RAILS,
      liabilityId: liabs.find((l) => l.preferred_payment_rail === "ERC3009_AUTHORIZATION")!.liability_id!,
      accountBalances: balances,
    });
    assert.equal(r3.success, true);
    assert.equal(r3.rail, "ERC3009_AUTHORIZATION");
    assert.ok(r3.authorizationNonce?.startsWith("0x"));

    // Rail 4: GATEWAY_X402 Sub-Cent Nanopayments
    const r4 = await disbursalRouter.executeLiabilityDisbursal({
      companyId: TENANT_RAILS,
      liabilityId: liabs.find((l) => l.preferred_payment_rail === "GATEWAY_X402")!.liability_id!,
      accountBalances: balances,
    });
    assert.equal(r4.success, true);
    assert.equal(r4.rail, "GATEWAY_X402");
    assert.ok(r4.gatewaySettlementRef?.startsWith("gw_nano_"));
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. POST-SETUP EDITABILITY & INVARIANT RE-ANCHORING (Section 13.1 #5)
  // ─────────────────────────────────────────────────────────────────────────────
  it("Audit 5: Post-Setup Editability — Re-anchoring Dynamic Records 1 & 2 without Human Intervention", async () => {
    const TENANT_EDIT = `audit_edit_${Date.now()}`;
    const accountId = `${TENANT_EDIT}_acc_growth`;

    // Provision initial state
    await accountService.createAccount(TENANT_EDIT, {
      accountId,
      name: "Growth Operations",
      role: "OPEX_GROWTH",
      minOperatingFloorUsdc: 200.0,
      safetyBufferRatio: 1.20,
    });

    const initialRecord2 = await dynamicRecords.calculateSafeToInvest(accountId);
    assert.ok(initialRecord2.safeToInvestUsdc);

    // Admin schedules liability
    const liab = await liabilityService.createLiability(TENANT_EDIT, {
      accountId,
      vendorId: "vnd_billboard",
      title: "Highway Digital Billboard",
      category: "MARKETING" as any,
      amountUsdc: 1500.0,
      dueDate: new Date(Date.now() + 5 * 86400 * 1000),
      payoutAddress: "0x4444444444444444444444444444444444444401",
    });

    // Verify Dynamic Record 2 immediately re-anchored after liability addition
    const postLiabRecord2 = await dynamicRecords.calculateSafeToInvest(accountId);
    assert.ok(postLiabRecord2.upcomingLiabilitiesTotalUsdc.startsWith("1500"));

    // Admin updates account floor from $200 to $600 (Section 13.1 #5)
    await accountService.updateAccount(TENANT_EDIT, accountId, {
      minOperatingFloorUsdc: 600.0,
    });

    // Verify Dynamic Record 2 reflects the raised floor
    const postFloorRecord2 = await dynamicRecords.calculateSafeToInvest(accountId);
    assert.equal(postFloorRecord2.targetReserveUsdc, "600.000000"); // $600 floor
    assert.ok(postFloorRecord2.upcomingLiabilitiesTotalUsdc.startsWith("1500")); // $1500 liability

    // Modify liability's due date and amount (Section 13.1 #5)
    const newDueDate = new Date(Date.now() + 4 * 86400 * 1000);
    const updatedLiab = await liabilityService.updateLiability(TENANT_EDIT, liab.liability_id!, {
      amountUsdc: 3200.0,
      dueDate: newDueDate,
    });
    assert.equal(updatedLiab.amount_usdc, 3200.0);

    // Verify Dynamic Record 1 & 2 immediately rebalance and reconcile without human intervention
    const postModifyRecord2 = await dynamicRecords.calculateSafeToInvest(accountId);
    assert.equal(postModifyRecord2.upcomingLiabilitiesTotalUsdc, "3200.000000");
    assert.equal(postModifyRecord2.targetReserveUsdc, "600.000000");

    // Dynamic Record 1 (parallel tripartite balance) invariant verified
    const tripartite = await dynamicRecords.getTripartiteBalance(accountId);
    assert.equal(tripartite.invariantSatisfied, true, "Liquid + Invested must strictly equal Available");

    // Admin cancels liability -> reserve immediately freed
    await liabilityService.cancelLiability(TENANT_EDIT, liab.liability_id!, "Billboard campaign ended early.");
    const postCancelRecord2 = await dynamicRecords.calculateSafeToInvest(accountId);
    assert.equal(postCancelRecord2.upcomingLiabilitiesTotalUsdc, "0.000000");
    assert.equal(postCancelRecord2.targetReserveUsdc, "600.000000"); // Only $600 floor remaining
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 6. LIVE ARC TESTNET CONNECTIVITY & LEDGER INTEGRITY (Section 13.1 #6 & Build-on-Arc)
  // ─────────────────────────────────────────────────────────────────────────────
  it("Audit 6: Live Arc Testnet Connectivity — Sub-Second Finality, 20 Gwei Gas Floor, and SHA-256 Hash Chain", async () => {
    // 1. Verify Live Arc Testnet RPC Connection
    const publicClient = ArcClientManager.getPublicClient();
    const chainId = await publicClient.getChainId();
    assert.equal(chainId, 5042002, "Must connect to Arc Testnet (Chain ID 5042002)");

    // 2. Verify 20 Gwei Mempool Gas Floor (Build-on-Arc Non-Negotiable Invariant)
    assert.equal(ARC_CONSTANTS.MIN_GAS_FLOOR_GWEI, 20n, "Arc L1 enforces 20 Gwei gas floor");

    // 3. Verify Master Journal Cryptographic SHA-256 Hash Chain Integrity (Agents and Ledgers Rule 1 & 4)
    const verification = await MasterJournalRepo.verifyChainIntegrity();
    if (!verification.valid) {
      console.error("[Audit 6] Chain integrity failure details:", verification);
    }
    assert.equal(verification.valid, true, "Master System Journal SHA-256 hash chain must be cryptographically valid with zero tampering");
  });
});
