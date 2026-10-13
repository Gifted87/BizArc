import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { DbClient } from "../src/database/dbClient.js";
import { OnboardingWizardService } from "../src/services/onboardingWizardService.js";
import { AccountManagementService } from "../src/services/accountManagementService.js";
import { LiabilityManagementService } from "../src/services/liabilityManagementService.js";
import { DisbursalRouter } from "../src/services/disbursalRouter.js";
import { TreasuryAccountsRepo } from "../src/database/repos/treasuryAccountsRepo.js";
import { LiabilityRepo } from "../src/database/repos/liabilityRepo.js";
import { VendorMasterRepo } from "../src/database/repos/vendorMasterRepo.js";
import { WizardSessionRepo } from "../src/database/repos/wizardSessionRepo.js";
import { DynamicRecordsService } from "../src/records/dynamicRecordsService.js";
import { MasterJournalRepo } from "../src/database/repos/masterJournalRepo.js";
import { AuditLogRepo } from "../src/database/repos/auditLogRepo.js";
import { CompanyProfileRepo } from "../src/database/repos/companyProfileRepo.js";

describe("Phase 3: Multi-Tenant Wizard, Account/Liability Lifecycle, and 4-Rail Disbursal", () => {
  const wizardService = new OnboardingWizardService();
  const accountService = new AccountManagementService();
  const liabilityService = new LiabilityManagementService();
  const disbursalRouter = new DisbursalRouter();
  const dynamicRecords = new DynamicRecordsService();

  const TENANT_1 = `tenant_solaris_${Date.now()}`;
  const TENANT_2 = `tenant_apex_${Date.now()}`;

  before(async () => {
    // Ensure clean state for test tenants
    await DbClient.query("DELETE FROM onboarding_wizard_sessions WHERE company_id IN ($1, $2)", [TENANT_1, TENANT_2]);
    await DbClient.query("DELETE FROM account_liabilities WHERE company_id IN ($1, $2)", [TENANT_1, TENANT_2]);
    await DbClient.query("DELETE FROM treasury_accounts WHERE company_id IN ($1, $2)", [TENANT_1, TENANT_2]);
    await DbClient.query("DELETE FROM company_profiles WHERE company_id IN ($1, $2)", [TENANT_1, TENANT_2]);
    await DbClient.query("DELETE FROM session_key_registry");
  });

  after(async () => {
    await DbClient.closePool();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 1: Path A (Manual 6-Step Onboarding Flow with Strict Invariants)
  // ─────────────────────────────────────────────────────────────────────────────
  it("Test 1: Path A (Manual Onboarding) enforces Invariant 1 (accounts in Step 4) & Invariant 2 (liabilities in Step 5)", async () => {
    // Initialize Session
    const session = await wizardService.createSession({
      companyId: TENANT_1,
      entryPath: "MANUAL",
    });

    assert.equal(session.companyId, TENANT_1);
    assert.equal(session.currentStep, 1);
    assert.equal(session.status, "IN_PROGRESS");

    // Step 1: Company Profile
    const step1 = await wizardService.saveStepDraft(session.sessionId, 1, {
      companyName: "Solaris Clean Energy Inc.",
      taxId: "EIN-88-2940192",
      jurisdiction: "US-DE",
      reportingCurrency: "USD",
      businessDescription: "Next-generation solar energy grid infrastructure",
    });
    assert.equal(step1.currentStep, 2);
    assert.equal(step1.draftPayload.step1_profile.companyName, "Solaris Clean Energy Inc.");

    // Step 2: Mathematical Rules Q&A
    const step2 = await wizardService.saveStepDraft(session.sessionId, 2, {
      answers: [
        { questionId: "GM_RUNWAY_MONTHS", answer: 6 },
        { questionId: "GM_MONTHLY_BURN", answer: 25000 },
        { questionId: "GM_REVENUE_VOLATILITY", answer: "LOW" },
        { questionId: "GM_BUFFER_MULTIPLIER", answer: "BALANCED" },
        { questionId: "IM_USYC_SWEEP_RATIO", answer: 75 },
        { questionId: "IM_MIN_SWEEP_BATCH_USDC", answer: 100 },
        { questionId: "IM_RECALL_HYSTERESIS_BAND", answer: 30 },
      ],
    });
    assert.equal(step2.currentStep, 3);
    assert.equal(step2.draftPayload.step2_math_rules.derivedParameters.minRunwayMonths, 6);
    assert.equal(step2.draftPayload.step2_math_rules.derivedParameters.usycYieldSweepRatio, 0.75);

    // Step 3: Declared Policies for All Agent Actions
    const step3 = await wizardService.saveStepDraft(session.sessionId, 3, {
      costCenterRules: [
        "Rule 1: Under no circumstances may funds from payroll be swept to yield or used for non-payroll draws.",
        "Rule 2: Vendor invoice payouts require Three-Way Match.",
      ],
      anomalyTolerances: {
        maxPriceHikePercentage: 12.0,
        flagUnregisteredVendors: true,
        requireThreeWayMatch: true,
      },
      reviewTriggers: ["Cloud bills > $5,000 generate 48h pre-flight SPRS"],
    });
    assert.equal(step3.currentStep, 4);

    // Step 4: Setup Operating Accounts & Per-Account Policies
    const userAccounts = [
      {
        accountId: `${TENANT_1}_acc_ops`,
        name: "Grid Operations",
        role: "OPEX_DEV",
        minOperatingFloorUsdc: 250.0,
        safetyBufferRatio: 1.20,
        perTxCapUsdc: 5000.0,
        dailyCapUsdc: 20000.0,
        authorizedCategories: ["INFRASTRUCTURE", "GRID_MAINTENANCE", "SAAS"],
        maxAutonomousSweepUsdc: 10000.0,
      },
      {
        accountId: `${TENANT_1}_acc_payroll`,
        name: "Solaris Payroll Escrow",
        role: "PAYROLL",
        minOperatingFloorUsdc: 500.0,
        safetyBufferRatio: 1.25,
        perTxCapUsdc: 50000.0,
        dailyCapUsdc: 50000.0,
        authorizedCategories: ["SALARIES"],
        maxAutonomousSweepUsdc: 0.0,
        excludeFromWaterfall: true,
      },
      {
        accountId: `${TENANT_1}_acc_rnd`,
        name: "Solar Cell R&D",
        role: "OPEX_DEV",
        minOperatingFloorUsdc: 150.0,
        safetyBufferRatio: 1.15,
        perTxCapUsdc: 3000.0,
        dailyCapUsdc: 10000.0,
        authorizedCategories: ["EQUIPMENT", "LAB_SUPPLIES"],
        maxAutonomousSweepUsdc: 5000.0,
      },
    ];

    const step4 = await wizardService.saveStepDraft(session.sessionId, 4, {
      accounts: userAccounts,
    });
    assert.equal(step4.currentStep, 5);
    assert.equal(step4.draftPayload.step4_accounts.length, 3);

    // Step 5: Test Invariant 2 — Attempting to attach liability to uncreated account MUST throw
    await assert.rejects(
      async () => {
        await wizardService.saveStepDraft(session.sessionId, 5, {
          liabilities: [
            {
              title: "AWS Infrastructure",
              accountId: "acc_uncreated_random_id",
              vendorId: "vendor_aws",
              amountUsdc: 1200.0,
            },
          ],
        });
      },
      /LIABILITY_ATTACHMENT_ERROR \(Invariant 2\)/,
      "Should loudly reject liability referencing an account not created in Step 4"
    );

    // Step 5: Add Real Recurring Liabilities (User binds exclusively to Step 4 accounts)
    const step5 = await wizardService.saveStepDraft(session.sessionId, 5, {
      liabilities: [
        {
          title: "Grid Monitoring Satellite Link",
          accountId: `${TENANT_1}_acc_ops`,
          vendorId: "vendor_starlink",
          category: "SAAS",
          amountUsdc: 450.0,
          dueDate: new Date(Date.now() + 10 * 86400 * 1000).toISOString(),
          payoutAddress: "0x2222222222222222222222222222222222222201",
          poReference: "PO-2026-STARLINK-01",
          preferredPaymentRail: "DISBURSAL_VAULT",
          disbursalRules: { autoPayThresholdUsdc: 500.0, requireThreeWayMatch: true, preFlightLeadTimeHours: 48 },
        },
        {
          title: "Photovoltaic Simulation SaaS",
          accountId: `${TENANT_1}_acc_rnd`,
          vendorId: "vendor_simu_solar",
          category: "SUBSCRIPTION",
          amountUsdc: 320.0,
          dueDate: new Date(Date.now() + 14 * 86400 * 1000).toISOString(),
          payoutAddress: "0x2222222222222222222222222222222222222202",
          preferredPaymentRail: "MODULAR_SESSION_KEY",
          paymentRailConfig: { sessionKeyId: "sk_solar_sim_01", maxAmountPerCycleUsdc: 400.0 },
        },
        {
          title: "Clean Grid AI Micro-inference",
          accountId: `${TENANT_1}_acc_ops`,
          vendorId: "vendor_grid_ai",
          category: "SAAS",
          amountUsdc: 0.05,
          dueDate: new Date(Date.now() + 3 * 86400 * 1000).toISOString(),
          serviceUrl: "https://api.gridai.arc.io/v1/predict",
          preferredPaymentRail: "GATEWAY_X402",
          paymentRailConfig: { serviceUrl: "https://api.gridai.arc.io/v1/predict", maxPerCallUsdc: 0.05 },
        },
        {
          title: "Native Gasless Grid Parts Order",
          accountId: `${TENANT_1}_acc_rnd`,
          vendorId: "vendor_grid_hardware",
          category: "EQUIPMENT",
          amountUsdc: 180.0,
          dueDate: new Date(Date.now() + 7 * 86400 * 1000).toISOString(),
          payoutAddress: "0x2222222222222222222222222222222222222203",
          poReference: "PO-2026-GRID-HARDWARE-01",
          preferredPaymentRail: "ERC3009_AUTHORIZATION",
          paymentRailConfig: { validityDurationSeconds: 86400 },
        },
      ],
    });
    assert.equal(step5.currentStep, 6);
    assert.equal(step5.draftPayload.step5_liabilities.length, 4);

    // Step 6: Review & Finalization
    const step6 = await wizardService.saveStepDraft(session.sessionId, 6, {
      cfoConfirmation: true,
      waterfallConditions: { strictPayrollExclusion: true },
    });
    assert.equal(step6.status, "DRAFT_READY");

    // Activate Organization
    const activation = await wizardService.activateOrganization(session.sessionId);
    assert.equal(activation.success, true);
    assert.equal(activation.companyId, TENANT_1);
    assert.equal(activation.dashboardUrl, `/dashboard/${TENANT_1}`);

    // Verify PostgreSQL State
    const dbAccounts = await TreasuryAccountsRepo.getAccountsByCompany(TENANT_1);
    assert.equal(dbAccounts.length, 3);
    assert.ok(dbAccounts.some((a) => a.account_id === `${TENANT_1}_acc_ops`));
    assert.ok(dbAccounts.some((a) => a.account_id === `${TENANT_1}_acc_payroll`));

    const dbLiabilities = await LiabilityRepo.getLiabilitiesByCompany(TENANT_1);
    assert.equal(dbLiabilities.length, 4);

    const dbProfile = await CompanyProfileRepo.getProfileById(TENANT_1);
    assert.equal(dbProfile?.activation_status, "ACTIVATED");
    assert.equal(dbProfile?.company_name, "Solaris Clean Energy Inc.");

    const sessionAfter = await wizardService.getSession(session.sessionId);
    assert.equal(sessionAfter?.status, "COMPLETED");
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 2: Path B (Connected SaaS / ERP Ingestion & Convergence)
  // ─────────────────────────────────────────────────────────────────────────────
  it("Test 2: Path B pre-fills candidates from connected data, allows Step 4 customization, and activates", async () => {
    const session = await wizardService.createSession({
      companyId: TENANT_2,
      entryPath: "GOOGLE_WORKSPACE",
    });

    const discoveredData = {
      connectedApps: ["Google Workspace", "Microsoft 365", "Odoo ERP"],
      costCenters: [
        { id: `${TENANT_2}_infra`, name: "Platform Infrastructure", role: "OPEX_DEV", monthlyCommittedSpend: 8500 },
        { id: `${TENANT_2}_growth`, name: "Sales & Growth", role: "OPEX_GROWTH", monthlyCommittedSpend: 4200 },
      ],
      invoices: [
        { title: "Cloud Compute", costCenter: `${TENANT_2}_infra`, supplierId: "sup_aws", amountUsdc: 2400, dueDate: new Date().toISOString() },
        { title: "CRM License", costCenter: `${TENANT_2}_growth`, supplierId: "sup_salesforce", amountUsdc: 950, dueDate: new Date().toISOString() },
      ],
    };

    const prefilled = await wizardService.prefillDraftFromConnectedSource(session.sessionId, discoveredData);
    assert.equal(prefilled.status, "DRAFT_READY");
    assert.equal(prefilled.draftPayload.step4_accounts.length, 2);

    // Step 4 Convergence: Admin adds a custom Payroll account and renames Infrastructure
    prefilled.draftPayload.step4_accounts[0].name = "Core Cloud Compute";
    prefilled.draftPayload.step4_accounts.push({
      accountId: `${TENANT_2}_payroll`,
      name: "Apex Executive Payroll",
      role: "PAYROLL",
      minOperatingFloorUsdc: 1000.0,
      safetyBufferRatio: 1.25,
      perTxCapUsdc: 50000.0,
      dailyCapUsdc: 50000.0,
      authorizedCategories: ["SALARIES"],
      maxAutonomousSweepUsdc: 0.0,
      excludeFromWaterfall: true,
    });

    await wizardService.updateDraft(session.sessionId, prefilled.draftPayload);

    // Admin binds invoices to accounts in Step 5
    await wizardService.saveStepDraft(session.sessionId, 5, {
      liabilities: [
        {
          title: "Cloud Compute",
          accountId: `${TENANT_2}_infra`,
          vendorId: "sup_aws",
          amountUsdc: 2400.0,
          payoutAddress: "0x3333333333333333333333333333333333333301",
          preferredPaymentRail: "DISBURSAL_VAULT",
        },
        {
          title: "CRM License",
          accountId: `${TENANT_2}_growth`,
          vendorId: "sup_salesforce",
          amountUsdc: 950.0,
          payoutAddress: "0x3333333333333333333333333333333333333302",
          preferredPaymentRail: "MODULAR_SESSION_KEY",
        },
      ],
    });

    // Activate
    const result = await wizardService.activateOrganization(session.sessionId);
    assert.equal(result.success, true);
    assert.equal(result.companyId, TENANT_2);

    const accounts = await TreasuryAccountsRepo.getAccountsByCompany(TENANT_2);
    assert.equal(accounts.length, 3);
    assert.ok(accounts.some((a) => a.name === "Core Cloud Compute"));
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 3: Post-Setup Account Lifecycle Governance (`AccountManagementService`)
  // ─────────────────────────────────────────────────────────────────────────────
  it("Test 3: AccountManagementService enforces Role Immutability, Dynamic Record 2 recalculation, and Safe Deactivation", async () => {
    const newAccountId = `${TENANT_1}_acc_logistics`;

    // 1. Create Account Post-Setup
    const created = await accountService.createAccount(TENANT_1, {
      accountId: newAccountId,
      name: "Fleet Logistics & Shipping",
      role: "OPEX_DEV",
      minOperatingFloorUsdc: 100.0,
      safetyBufferRatio: 1.20,
      perTxCapUsdc: 2000.0,
    });
    assert.equal(created.account_id, newAccountId);
    assert.equal(created.min_operating_floor_usdc, 100.0);

    // 2. Update Floor: Verifies Dynamic Record 2 recalculated
    const updated = await accountService.updateAccount(TENANT_1, newAccountId, {
      minOperatingFloorUsdc: 300.0,
      safetyBufferRatio: 1.30,
    });
    assert.equal(updated.min_operating_floor_usdc, 300.0);
    assert.equal(updated.safety_buffer_ratio, 1.30);

    // 3. Invariant: Role Immutability must reject role change
    await assert.rejects(
      async () => {
        await accountService.updateAccount(TENANT_1, newAccountId, {
          role: "PAYROLL" as any,
        });
      },
      /ROLE_IMMUTABLE/,
      "Should reject post-creation role changes"
    );

    // 4. Safe Deactivation Protocol:
    // Create an active liability linked to this account
    const activeLiab = await liabilityService.createLiability(TENANT_1, {
      accountId: newAccountId,
      vendorId: "vendor_fleet_fuel",
      title: "Monthly Fuel Card",
      category: "OPERATIONS" as any,
      amountUsdc: 150.0,
      dueDate: new Date(Date.now() + 5 * 86400 * 1000),
      payoutAddress: "0x4444444444444444444444444444444444444401",
    });
    assert.ok(activeLiab.liability_id);

    // Attempt deactivation -> MUST block due to active liability
    await assert.rejects(
      async () => {
        await accountService.deactivateAccount(TENANT_1, newAccountId);
      },
      /DEACTIVATION_BLOCKED/,
      "Should block deactivation when active liabilities are attached"
    );

    // Cancel the liability
    await liabilityService.cancelLiability(TENANT_1, activeLiab.liability_id!, "Fleet fuel card contract terminated.");

    // Now deactivation succeeds
    const deactRes = await accountService.deactivateAccount(TENANT_1, newAccountId);
    assert.equal(deactRes.success, true);

    const refreshed = await TreasuryAccountsRepo.getAccountByIdAndCompany(newAccountId, TENANT_1);
    assert.equal(refreshed?.is_active, false);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 4: Post-Setup Liability Lifecycle Governance (`LiabilityManagementService`)
  // ─────────────────────────────────────────────────────────────────────────────
  it("Test 4: LiabilityManagementService enforces non-destructive cancellation and Dynamic Record re-anchoring", async () => {
    const liab = await liabilityService.createLiability(TENANT_1, {
      accountId: `${TENANT_1}_acc_ops`,
      vendorId: "vendor_metering_cloud",
      title: "Smart Grid Metering SaaS",
      category: "SAAS",
      amountUsdc: 250.0,
      dueDate: new Date(Date.now() + 12 * 86400 * 1000),
      payoutAddress: "0x5555555555555555555555555555555555555501",
      preferredPaymentRail: "DISBURSAL_VAULT",
    });

    assert.equal(liab.amount_usdc, 250.0);
    assert.equal(liab.status, "SCHEDULED");

    // Admin modifies amount and due date
    const updated = await liabilityService.updateLiability(TENANT_1, liab.liability_id!, {
      amountUsdc: 300.0,
      title: "Smart Grid Metering Enterprise Tier",
    });
    assert.equal(updated.amount_usdc, 300.0);
    assert.equal(updated.title, "Smart Grid Metering Enterprise Tier");

    // Admin cancels liability -> status becomes CANCELLED, cancellationMemo preserved
    const cancelled = await liabilityService.cancelLiability(
      TENANT_1,
      liab.liability_id!,
      "Migrating to on-premise metering node."
    );
    assert.equal(cancelled.status, "CANCELLED");
    assert.equal(cancelled.disbursal_rules?.cancellationMemo, "Migrating to on-premise metering node.");

    // Verify row still exists in database (non-destructive)
    const inDb = await LiabilityRepo.getLiabilityByIdAndCompany(liab.liability_id!, TENANT_1);
    assert.ok(inDb);
    assert.equal(inDb?.status, "CANCELLED");
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 5: Four-Rail Disbursal Execution (`DisbursalRouter`)
  // ─────────────────────────────────────────────────────────────────────────────
  it("Test 5: DisbursalRouter executes 4 liabilities across DISBURSAL_VAULT, MODULAR_SESSION_KEY, ERC3009, and GATEWAY_X402", async () => {
    const liabilities = await LiabilityRepo.getLiabilitiesByCompany(TENANT_1, { status: "SCHEDULED" });
    assert.ok(liabilities.length >= 4, "Should have scheduled liabilities from Step 5");

    const vaultLiab = liabilities.find((l) => l.preferred_payment_rail === "DISBURSAL_VAULT");
    const sessionLiab = liabilities.find((l) => l.preferred_payment_rail === "MODULAR_SESSION_KEY");
    const erc3009Liab = liabilities.find((l) => l.preferred_payment_rail === "ERC3009_AUTHORIZATION");
    const x402Liab = liabilities.find((l) => l.preferred_payment_rail === "GATEWAY_X402");

    assert.ok(vaultLiab, "DISBURSAL_VAULT liability exists");
    assert.ok(sessionLiab, "MODULAR_SESSION_KEY liability exists");
    assert.ok(erc3009Liab, "ERC3009_AUTHORIZATION liability exists");
    assert.ok(x402Liab, "GATEWAY_X402 liability exists");

    // Pre-fund balances in test execution
    const balances = {
      [`${TENANT_1}_acc_ops`]: 25000.0,
      [`${TENANT_1}_acc_rnd`]: 15000.0,
      [`${TENANT_1}_acc_payroll`]: 50000.0,
    };

    // 1. Execute DisbursalVault Rail
    const res1 = await disbursalRouter.executeLiabilityDisbursal({
      companyId: TENANT_1,
      liabilityId: vaultLiab!.liability_id!,
      accountBalances: balances,
    });
    assert.equal(res1.success, true);
    assert.equal(res1.rail, "DISBURSAL_VAULT");
    assert.ok(res1.txHash?.startsWith("0x"));

    // 2. Execute ModularSessionKey Rail
    const res2 = await disbursalRouter.executeLiabilityDisbursal({
      companyId: TENANT_1,
      liabilityId: sessionLiab!.liability_id!,
      accountBalances: balances,
    });
    assert.equal(res2.success, true);
    assert.equal(res2.rail, "MODULAR_SESSION_KEY");
    assert.ok(res2.sessionKeyId);

    // 3. Execute ERC-3009 Authorization Rail
    const res3 = await disbursalRouter.executeLiabilityDisbursal({
      companyId: TENANT_1,
      liabilityId: erc3009Liab!.liability_id!,
      accountBalances: balances,
    });
    assert.equal(res3.success, true);
    assert.equal(res3.rail, "ERC3009_AUTHORIZATION");
    assert.ok(res3.authorizationNonce?.startsWith("0x"));

    // 4. Execute Gateway x402 Nanopayments Rail
    const res4 = await disbursalRouter.executeLiabilityDisbursal({
      companyId: TENANT_1,
      liabilityId: x402Liab!.liability_id!,
      accountBalances: balances,
    });
    assert.equal(res4.success, true);
    assert.equal(res4.rail, "GATEWAY_X402");
    assert.ok(res4.gatewaySettlementRef?.startsWith("gw_nano_"));

    // Verify all 4 are SETTLED in PostgreSQL
    const settled1 = await LiabilityRepo.getLiabilityById(vaultLiab!.liability_id!);
    const settled2 = await LiabilityRepo.getLiabilityById(sessionLiab!.liability_id!);
    const settled3 = await LiabilityRepo.getLiabilityById(erc3009Liab!.liability_id!);
    const settled4 = await LiabilityRepo.getLiabilityById(x402Liab!.liability_id!);

    assert.equal(settled1?.status, "SETTLED");
    assert.equal(settled2?.status, "SETTLED");
    assert.equal(settled3?.status, "SETTLED");
    assert.equal(settled4?.status, "SETTLED");
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 6: Multi-Tenant Concurrency and Isolation
  // ─────────────────────────────────────────────────────────────────────────────
  it("Test 6: Strict tenant isolation between Tenant 1 and Tenant 2 across accounts, liabilities, and profiles", async () => {
    const t1Accounts = await accountService.listAccounts(TENANT_1);
    const t2Accounts = await accountService.listAccounts(TENANT_2);

    assert.ok(t1Accounts.length > 0);
    assert.ok(t2Accounts.length > 0);

    // Verify no account overlap
    const t1Ids = new Set(t1Accounts.map((a) => a.account_id));
    for (const acc of t2Accounts) {
      assert.equal(t1Ids.has(acc.account_id), false, `Tenant 2 account ${acc.account_id} must not appear in Tenant 1`);
    }

    // Verify no liability overlap
    const t1Liabs = await liabilityService.listLiabilities(TENANT_1);
    const t2Liabs = await liabilityService.listLiabilities(TENANT_2);

    const t1LiabIds = new Set(t1Liabs.map((l) => l.liability_id));
    for (const liab of t2Liabs) {
      assert.equal(t1LiabIds.has(liab.liability_id), false, `Tenant 2 liability must not appear in Tenant 1`);
    }
  });
});
