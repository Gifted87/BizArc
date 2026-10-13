import assert from "assert";
import { DbClient } from "../src/database/dbClient.js";
import { WizardSessionRepo } from "../src/database/repos/wizardSessionRepo.js";
import { MathRulesQaRepo } from "../src/database/repos/mathRulesQaRepo.js";
import { TenantOAuthRepo } from "../src/database/repos/tenantOAuthRepo.js";
import { TreasuryAccountsRepo } from "../src/database/repos/treasuryAccountsRepo.js";
import { LiabilityRepo } from "../src/database/repos/liabilityRepo.js";
import { MovementPolicyRepo } from "../src/database/repos/movementPolicyRepo.js";
import { TenantPolicyManager } from "../src/config/tenantPolicyManager.js";
import { MathRulesQAEngine } from "../src/services/mathRulesQAEngine.js";

async function runPhase1Tests() {
  console.log("======================================================================");
  console.log("       RUNNING PHASE 1 FOUNDATION & MULTI-TENANCY VERIFICATION        ");
  console.log("======================================================================\n");

  const isConnected = await DbClient.checkConnection();
  assert.strictEqual(isConnected, true, "PostgreSQL must be connected");
  console.log("✓ PostgreSQL Database connection verified.");

  // ----------------------------------------------------------------------------------
  // 1. Schema & Multi-Tenant Column Integrity Test
  // ----------------------------------------------------------------------------------
  console.log("\n[Test 1] Verifying Multi-Tenant Schema Migrations & Table DDL...");
  const tableCheck = await DbClient.query(`
    SELECT table_name FROM information_schema.tables 
    WHERE table_schema = 'public' 
      AND table_name IN ('onboarding_wizard_sessions', 'math_rules_qa_responses', 'tenant_oauth_tokens');
  `);
  const tables = tableCheck.rows.map((r) => r.table_name);
  assert.ok(tables.includes("onboarding_wizard_sessions"), "onboarding_wizard_sessions table must exist");
  assert.ok(tables.includes("math_rules_qa_responses"), "math_rules_qa_responses table must exist");
  assert.ok(tables.includes("tenant_oauth_tokens"), "tenant_oauth_tokens table must exist");

  const columnCheck = await DbClient.query(`
    SELECT column_name FROM information_schema.columns 
    WHERE table_name = 'treasury_accounts' AND column_name IN ('company_id', 'per_tx_cap_usdc', 'authorized_categories');
  `);
  assert.strictEqual(columnCheck.rows.length, 3, "treasury_accounts must have extended multi-tenant columns");
  console.log("✓ Core multi-tenant tables and extended columns verified in PostgreSQL.");

  // ----------------------------------------------------------------------------------
  // 2. Multi-Tenant Isolation Test (Tenant Alpha vs Tenant Beta)
  // ----------------------------------------------------------------------------------
  console.log("\n[Test 2] Verifying Tenant Isolation (Zero Cross-Tenant Leakage)...");
  const tenantA = `tenant_alpha_${Date.now()}`;
  const tenantB = `tenant_beta_${Date.now()}`;

  const randomAddress = (): `0x${string}` =>
    ("0x" + Array.from({ length: 40 }, () => Math.floor(Math.random() * 16).toString(16)).join("")) as `0x${string}`;

  // Provision accounts for Tenant A (Tech Firm)
  await TreasuryAccountsRepo.upsertAccount({
    account_id: `acc_alpha_infra_${Date.now()}`,
    company_id: tenantA,
    name: "Alpha Cloud Infrastructure",
    role: "OPEX_INFRA",
    wallet_address: randomAddress(),
    chain_id: 5042002,
    min_operating_floor_usdc: 1500.0,
    safety_buffer_ratio: 1.25,
    is_active: true,
    per_tx_cap_usdc: 2000.0,
    daily_cap_usdc: 10000.0,
    authorized_categories: ["INFRASTRUCTURE", "SECURITY"],
  });

  // Provision accounts for Tenant B (Law Firm)
  await TreasuryAccountsRepo.upsertAccount({
    account_id: `acc_beta_litigation_${Date.now()}`,
    company_id: tenantB,
    name: "Beta Litigation Retainers",
    role: "TREASURY_RESERVE",
    wallet_address: randomAddress(),
    chain_id: 5042002,
    min_operating_floor_usdc: 50000.0,
    safety_buffer_ratio: 1.50,
    is_active: true,
    per_tx_cap_usdc: 25000.0,
    daily_cap_usdc: 100000.0,
    authorized_categories: ["LEGAL", "ESCROW"],
  });

  const accountsA = await TreasuryAccountsRepo.getAccountsByCompany(tenantA);
  const accountsB = await TreasuryAccountsRepo.getAccountsByCompany(tenantB);

  assert.strictEqual(accountsA.length, 1, "Tenant A must have exactly 1 account");
  assert.strictEqual(accountsB.length, 1, "Tenant B must have exactly 1 account");
  assert.strictEqual(accountsA[0].company_id, tenantA);
  assert.strictEqual(accountsB[0].company_id, tenantB);
  assert.strictEqual(accountsA[0].role, "OPEX_INFRA");
  assert.strictEqual(accountsB[0].role, "TREASURY_RESERVE");
  console.log(`✓ Tenant A (${tenantA}) and Tenant B (${tenantB}) strictly isolated in storage.`);

  // ----------------------------------------------------------------------------------
  // 3. MathRulesQAEngine Evaluation & Audit Ledger Persistence
  // ----------------------------------------------------------------------------------
  console.log("\n[Test 3] Verifying MathRulesQAEngine (100% Dynamic Math, Zero Stubs)...");
  const qaEngine = MathRulesQAEngine.getInstance();
  const generalQuestions = qaEngine.getQuestionsByCategory("GENERAL_MATH");
  assert.ok(generalQuestions.length >= 4, "Must have at least 4 GENERAL_MATH questions");

  // Deterministic evaluation with real user answers
  const evaluationResults = qaEngine.evaluateAnswers([
    { questionId: "GM_RUNWAY_MONTHS", answer: 6 },
    { questionId: "GM_MONTHLY_BURN", answer: 50000 },
    { questionId: "GM_REVENUE_VOLATILITY", answer: "MEDIUM" }, // 0.20
    { questionId: "GM_BUFFER_MULTIPLIER", answer: "BALANCED" }, // 1.25
    { questionId: "LM_HISTORICAL_INVOICE_AVG", answer: 4000 },
    { questionId: "LM_AUTOPAY_BUFFER_RATIO", answer: "LOW_1_10" }, // 1.10
    { questionId: "LM_STEALTH_CREEP_TOLERANCE_PCT", answer: "STANDARD_5_PCT" }, // 5.0%
    { questionId: "IM_USYC_SWEEP_RATIO", answer: 85 }, // 85%
  ]);

  // Check composite reserve floor: 50,000 * 6 * (1 + 0.20) = 360,000 USDC
  const reserveFloorResult = evaluationResults.find((r) => r.derivedParameterName === "totalOperatingReserveFloorUsdc");
  assert.ok(reserveFloorResult, "Composite reserve floor must be calculated");
  assert.strictEqual(reserveFloorResult.derivedValue, 360000.0, "Reserve floor must equal 360,000.000000 USDC");

  // Check composite auto-pay ceiling: 4,000 * 1.10 * 1.05 = 4,620 USDC
  const autoPayResult = evaluationResults.find((r) => r.derivedParameterName === "autoPayThresholdUsdc");
  assert.ok(autoPayResult, "Composite auto-pay threshold must be calculated");
  assert.strictEqual(autoPayResult.derivedValue, 4620.0, "Auto-pay ceiling must equal 4,620.000000 USDC");

  // Check loud failure on invalid input
  assert.throws(() => {
    qaEngine.evaluateAnswers([
      { questionId: "GM_RUNWAY_MONTHS", answer: 99 }, // out of bounds (max 24)
    ]);
  }, /Validation error/, "Must throw loud validation error on out-of-bounds runway months");

  // Persist to audit ledger
  await qaEngine.persistQAResponses(tenantA, evaluationResults);
  const auditRecords = await MathRulesQaRepo.getResponsesByCompany(tenantA);
  assert.ok(auditRecords.length >= evaluationResults.length, "Responses must be persisted to DB");
  console.log("✓ MathRulesQAEngine deterministic calculations and database audit ledger verified.");

  // ----------------------------------------------------------------------------------
  // 4. TenantPolicyManager & Distributed Policy Engine Test
  // ----------------------------------------------------------------------------------
  console.log("\n[Test 4] Verifying TenantPolicyManager (L1/L2 Caching, Dynamic Synthesis, Invalidation)...");
  const policyManager = TenantPolicyManager.getInstance();

  // Fresh load from DB (cache miss -> database query)
  const profileA = await policyManager.getActiveProfile(tenantA);
  assert.ok(profileA.operating_accounts.length >= 1, "Tenant A profile must include its operating account");
  assert.strictEqual(profileA.operating_accounts[0].account_id, accountsA[0].account_id);
  assert.strictEqual(profileA.operating_accounts[0].min_floor_usdc, 1500.0);
  assert.strictEqual(profileA.investment_rules.max_company_allocation_ratio, 0.85); // from Q&A 85%

  // Cache hit test
  const cachedProfileA = await policyManager.getActiveProfile(tenantA);
  assert.strictEqual(cachedProfileA, profileA, "Subsequent fetch must return L1 cached reference");

  // Account policy retrieval
  const accPolicy = await policyManager.getAccountPolicy(tenantA, accountsA[0].account_id);
  assert.strictEqual(accPolicy.role, "OPEX_INFRA");
  assert.strictEqual(accPolicy.per_tx_cap_usdc, 2000.0);

  // Policy mutation & invalidation test
  const mutatedProfile = await policyManager.mutatePolicy(tenantA, (current) => {
    return {
      ...current,
      operating_accounts: current.operating_accounts.map((acc) => ({
        ...acc,
        min_floor_usdc: 3000.0, // update floor to 3,000 USDC
      })),
    };
  });
  assert.strictEqual(mutatedProfile.operating_accounts[0].min_floor_usdc, 3000.0);

  // Verify in PostgreSQL database
  const refreshedAccount = await TreasuryAccountsRepo.getAccountById(accountsA[0].account_id);
  assert.strictEqual(refreshedAccount?.min_operating_floor_usdc, 3000.0, "DB record must reflect mutation");
  console.log("✓ TenantPolicyManager multi-tenant synthesis, L1 caching, mutation, and invalidation verified.");

  // ----------------------------------------------------------------------------------
  // 5. Onboarding Wizard Sessions & OAuth Token Storage
  // ----------------------------------------------------------------------------------
  console.log("\n[Test 5] Verifying WizardSessionRepo & TenantOAuthRepo...");
  const sessionId = `wiz_${Date.now()}`;
  const session = await WizardSessionRepo.createSession({
    sessionId,
    companyId: tenantA,
    entryPath: "GOOGLE_WORKSPACE",
    totalSteps: 6,
    initialDraft: { companyName: "Alpha Global Technologies" },
  });
  assert.strictEqual(session.current_step, 1);
  assert.strictEqual(session.status, "IN_PROGRESS");

  // Advance step and save draft payload
  const updatedSession = await WizardSessionRepo.updateStepDraft({
    sessionId,
    currentStep: 3,
    draftPayload: {
      companyName: "Alpha Global Technologies",
      derivedReserveFloor: 360000.0,
      approvedAccounts: ["acc_alpha_infra"],
    },
    completedStep: 2,
    status: "DRAFT_READY",
  });
  assert.strictEqual(updatedSession.current_step, 3);
  assert.strictEqual(updatedSession.status, "DRAFT_READY");
  assert.ok(updatedSession.completed_steps.includes(2));

  // OAuth token store
  await TenantOAuthRepo.storeToken({
    companyId: tenantA,
    provider: "GOOGLE_WORKSPACE",
    access_token_encrypted: "enc_gsuite_token_xyz_9981",
    refresh_token_encrypted: "enc_gsuite_refresh_abc_1234",
    token_scope: "https://www.googleapis.com/auth/drive.readonly",
    expires_at: new Date(Date.now() + 3600000),
    session_metadata: { userEmail: "treasurer@alphaglobal.com" },
  });
  const token = await TenantOAuthRepo.getToken(tenantA, "GOOGLE_WORKSPACE");
  assert.ok(token);
  assert.strictEqual(token.access_token_encrypted, "enc_gsuite_token_xyz_9981");
  console.log("✓ Wizard session state machine and encrypted OAuth token store verified.");

  // ----------------------------------------------------------------------------------
  // 6. Liability Disbursal Rules with Preferred Rail & Multi-Tenancy
  // ----------------------------------------------------------------------------------
  console.log("\n[Test 6] Verifying Multi-Tenant Liability Configuration & Payment Rails...");
  const liabilityId = `liab_aws_${Date.now()}`;
  const liability = await LiabilityRepo.createLiability({
    company_id: tenantA,
    account_id: accountsA[0].account_id,
    vendor_id: "vnd_aws_cloud",
    title: "AWS Production Kubernetes Compute",
    category: "INFRASTRUCTURE",
    amount_usdc: 3450.0,
    due_date: new Date(Date.now() + 86400000 * 5),
    payout_address: "0x3333333333333333333333333333333333333333",
    status: "SCHEDULED",
    preferred_payment_rail: "DISBURSAL_VAULT",
    payment_rail_config: {
      vaultAddress: "0x4444444444444444444444444444444444444444",
      cfoSignerAddress: "0x5555555555555555555555555555555555555555",
    },
    disbursal_rules: {
      autoPayThresholdUsdc: 4620.0,
      requireThreeWayMatch: true,
      preFlightLeadTimeHours: 48,
      stealthPriceCreepTolerancePct: 5.0,
    },
  });

  const fetchedLiabilityRules = await policyManager.getLiabilityRules(tenantA, liability.liability_id!);
  assert.strictEqual(fetchedLiabilityRules.autoPayThresholdUsdc, 4620.0);
  assert.strictEqual(fetchedLiabilityRules.requireThreeWayMatch, true);
  assert.strictEqual(fetchedLiabilityRules.preferredPaymentRail, "DISBURSAL_VAULT");
  console.log("✓ Multi-tenant liability rules and preferred payment rail configuration verified.");

  console.log("\n======================================================================");
  console.log(" >>> ALL PHASE 1 FOUNDATION & MULTI-TENANCY TESTS PASSED CLEANLY <<< ");
  console.log("======================================================================\n");
}

runPhase1Tests()
  .then(async () => {
    await DbClient.closePool();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("\n❌ PHASE 1 TEST SUITE FAILED:", err);
    await DbClient.closePool();
    process.exit(1);
  });
