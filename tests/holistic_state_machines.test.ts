import test from "node:test";
import assert from "node:assert/strict";
import { TreasuryDaemon } from "../src/daemon/treasuryDaemon.js";
import { TreasuryStateMachineOrchestrator } from "../src/orchestration/treasuryStateMachineOrchestrator.js";
import { SystemHttpServer } from "../src/ingress/systemHttpServer.js";
import { TreasuryAccountsRepo } from "../src/database/repos/treasuryAccountsRepo.js";
import { LiabilityRepo } from "../src/database/repos/liabilityRepo.js";
import { VendorMasterRepo } from "../src/database/repos/vendorMasterRepo.js";
import { MasterJournalRepo } from "../src/database/repos/masterJournalRepo.js";
import { PermissionRequestRepo } from "../src/database/repos/permissionRequestRepo.js";
import { AuthorizationGate } from "../src/security/authorizationGate.js";

test("Holistic 5 State Machines & Physical Triggers Suite", async (t) => {
  const orchestrator = new TreasuryStateMachineOrchestrator();
  const testCompanyId = `test_corp_${Date.now()}`;
  const opsAccountId = `acc_${testCompanyId}_ops`;
  const payrollAccountId = `acc_${testCompanyId}_payroll`;

  // Pre-seed test operating and payroll accounts
  await TreasuryAccountsRepo.upsertAccount({
    account_id: opsAccountId,
    company_id: testCompanyId,
    name: "Core Operations Account",
    role: "OPEX_DEV",
    wallet_address: "0x1111111111111111111111111111111111111111",
    chain_id: 5042002,
    min_operating_floor_usdc: 500,
    safety_buffer_ratio: 0.2,
    is_active: true,
  });

  await TreasuryAccountsRepo.upsertAccount({
    account_id: payrollAccountId,
    company_id: testCompanyId,
    name: "Dedicated Payroll Account",
    role: "PAYROLL",
    wallet_address: "0x2222222222222222222222222222222222222222",
    chain_id: 5042002,
    min_operating_floor_usdc: 10000,
    safety_buffer_ratio: 0.2,
    is_active: true,
  });

  await t.test("Machine 1: Onboarding State Machine (Unbroken Session to Activation)", async () => {
    const onboarding = orchestrator.onboardingMachine;

    // Step 1: Start Onboarding Session
    const startRes = await onboarding.startOnboarding({
      companyId: testCompanyId,
      entryPath: "MANUAL",
      companyName: "Acme Autonomous Corp",
    });
    assert.strictEqual(startRes.success, true);
    const sessionId = startRes.instanceId;

    // Step 2: Submit Math Rules Q&A Answers
    const step2Res = await onboarding.submitStep(sessionId, 2, {
      answers: [
        { questionId: "Q1_OPERATING_RESERVE", numericValue: 5000 },
        { questionId: "Q2_INVESTMENT_TOLERANCE", stringValue: "MODERATE" },
      ],
    });
    assert.strictEqual(step2Res.success, true);

    // Step 4: Configure Accounts
    const step4Res = await onboarding.submitStep(sessionId, 4, {
      accounts: [
        { accountId: opsAccountId, name: "Core Operations", role: "OPEX_DEV", targetReserveUsdc: 5000 },
        { accountId: payrollAccountId, name: "Payroll", role: "PAYROLL", targetReserveUsdc: 20000 },
      ],
    });
    assert.strictEqual(step4Res.success, true);

    // Step 5: Attach Liabilities with Payment Rails
    const step5Res = await onboarding.submitStep(sessionId, 5, {
      liabilities: [
        {
          title: "AWS Cloud Infrastructure",
          accountId: opsAccountId,
          vendorId: "aws",
          amountUsdc: 450,
          dueDate: new Date(Date.now() + 86400000).toISOString(),
          paymentRail: "DISBURSAL_VAULT",
        },
      ],
    });
    assert.strictEqual(step5Res.success, true);

    // Step 6: Atomic Activation Commit
    const activateRes = await onboarding.activateOrganization(sessionId);
    assert.strictEqual(activateRes.success, true);
    assert.strictEqual(activateRes.currentState, "COMPLETED_OPERATIONAL");
  });

  await t.test("Machine 2: Inbound Webhook, 3-Way Match & Payee Lock Verification", async () => {
    // 1. Legitimate Invoice Ingestion
    const invoiceRes = await orchestrator.onInboundInvoice({
      companyId: testCompanyId,
      vendorId: "github_enterprise",
      vendorName: "GitHub Enterprise",
      invoiceId: `INV_GH_${Date.now()}`,
      amountUsdc: 210,
      dueDate: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      payoutAddress: "0x3333333333333333333333333333333333333333",
      poReference: "PO_GH_2026",
    });
    assert.strictEqual(invoiceRes.success, true);
    assert.strictEqual(invoiceRes.currentState, "STAGED_SCHEDULED");

    // 2. Payee Substitution Attack Attempt
    const spoofedRes = await orchestrator.onInboundInvoice({
      companyId: testCompanyId,
      vendorId: "github_enterprise",
      invoiceId: `INV_GH_ATTACK_${Date.now()}`,
      amountUsdc: 210,
      dueDate: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      payoutAddress: "0xdeaddeaddeaddeaddeaddeaddeaddeaddeaddead", // Malicious address
    });
    assert.strictEqual(spoofedRes.success, false);
    assert.strictEqual(spoofedRes.currentState, "PAYEE_MISMATCH_REJECTED");
  });

  await t.test("Machine 3: Balance Mutation & Parallel Tripartite Record", async () => {
    const mutationRes = await orchestrator.onBalanceMutation({
      accountId: opsAccountId,
      amountUsdc: 15000,
      currentLiquidBalanceUsdc: 15000,
      origin: "EXTERNAL_REVENUE",
      forceImmediate: true,
    });

    if (!mutationRes.success) {
      console.error("Machine 3 Mutation Error:", mutationRes.error);
    }
    assert.strictEqual(mutationRes.success, true);
    assert.ok(["SURPLUS_SWEEP_EXECUTED", "HYSTERESIS_SUPPRESSED"].includes(mutationRes.currentState));

    // Protected Account Check: Payroll accounts must NEVER be swept
    const payrollMutationRes = await orchestrator.onBalanceMutation({
      accountId: payrollAccountId,
      amountUsdc: 50000,
      currentLiquidBalanceUsdc: 50000,
      origin: "PAYROLL_FUNDING",
      forceImmediate: true,
    });
    assert.strictEqual(payrollMutationRes.success, true);
    assert.strictEqual(payrollMutationRes.currentState, "PROTECTED_ACCOUNT_IGNORED");
  });

  await t.test("Machine 4: Scheduled Liability Disbursal with Fiat Offramp Terminal Rail", async () => {
    // Register verified vendor in VendorMasterRepo
    await VendorMasterRepo.registerVendor({
      vendor_id: "traditional_landlord",
      name: "Corporate Landlord LLC",
      verified_payout_address: "0x4444444444444444444444444444444444444444",
      verified_by_admin: "ADMIN_SEED",
      last_verified_at: new Date(),
      change_lock: true,
    });

    // Stage a fiat offramp liability (Circle Mint / Fedwire payout)
    const fiatLiab = await LiabilityRepo.createLiability({
      account_id: opsAccountId,
      company_id: testCompanyId,
      vendor_id: "traditional_landlord",
      title: "Corporate Headquarters Rent",
      category: "SAAS",
      amount_usdc: 300,
      due_date: new Date(Date.now() - 3600000), // Due now
      payout_address: "0x4444444444444444444444444444444444444444",
      status: "SCHEDULED",
      preferred_payment_rail: "FIAT_OFFRAMP",
    });

    const disbursalRes = await orchestrator.onDueLiabilityDisbursal(fiatLiab);
    if (!disbursalRes.success) {
      console.log("Subtest 4 Disbursal Error:", disbursalRes.error, disbursalRes.data, disbursalRes.unbrokenChainLog);
    }
    assert.strictEqual(disbursalRes.success, true);
    assert.strictEqual(disbursalRes.currentState, "WITNESSED_AND_SETTLED");
    assert.strictEqual(disbursalRes.data.rail, "FIAT_OFFRAMP");
  });

  await t.test("Machine 5: Ad-Hoc Discretionary Outflow & SPRS Escalation", async () => {
    // 1. Large Discretionary Payment Escalated to Human SPRS
    const largeAdHoc = await orchestrator.onAdHocPaymentRequest({
      companyId: testCompanyId,
      amountUsdc: 2500,
      reason: "Emergency server hardware migration",
      category: "INFRASTRUCTURE",
    });

    if (largeAdHoc.currentState !== "SPRS_APPROVAL_REQUIRED") {
      console.log("Subtest 5 AdHoc Error:", largeAdHoc.error, largeAdHoc.unbrokenChainLog);
    }

    assert.strictEqual(largeAdHoc.success, false);
    assert.strictEqual(largeAdHoc.currentState, "SPRS_APPROVAL_REQUIRED");
    assert.ok(largeAdHoc.data?.sprsRequestId);

    // 2. Admin Decision: Human attempt to approve SPRS without signature must fail
    await assert.rejects(
      async () => {
        await orchestrator.handleSprsDecision({
          requestId: largeAdHoc.data.sprsRequestId,
          decision: "APPROVE",
        });
      },
      /Cryptographic adminSignature is required to approve SPRS/
    );

    // 3. Human Officer approves with authentic cryptographic EIP-712 signature matching SPRS
    const sprsRecord = await PermissionRequestRepo.getRequestById(largeAdHoc.data.sprsRequestId);
    const adminSig = await AuthorizationGate.createAdminSignature({
      permissionRequestId: largeAdHoc.data.sprsRequestId,
      actionType: sprsRecord!.action_type,
      accountId: opsAccountId,
      amountUsdc: Number(sprsRecord!.amount_usdc).toFixed(6),
    });

    const approvalRes = await orchestrator.handleSprsDecision({
      requestId: largeAdHoc.data.sprsRequestId,
      decision: "APPROVE",
      adminSignature: adminSig,
    });
    assert.strictEqual(approvalRes.success, true);
    assert.strictEqual(approvalRes.status, "APPROVE");
  });

  await t.test("Holistic Physical Ingress HTTP Server & Treasury Daemon Lifecycle", async () => {
    const daemon = new TreasuryDaemon({
      httpPort: 0, // Ephemeral free port
      enableBlockchainListener: false,
      enableScheduler: false,
    });

    const runInfo = await daemon.start();
    assert.strictEqual(runInfo.status, "RUNNING");
    const testPort = runInfo.httpPort;

    // Ping Public Physical Ingress HTTP Endpoint (Health Check requires no auth)
    const res = await fetch(`http://localhost:${testPort}/api/health`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.status, "HEALTHY");

    // Unauthenticated request to sensitive endpoint must return 401 UNAUTHORIZED
    const unauthRes = await fetch(`http://localhost:${testPort}/api/treasury/overview?companyId=${testCompanyId}`);
    assert.strictEqual(unauthRes.status, 401);
    const unauthBody = await unauthRes.json();
    assert.strictEqual(unauthBody.error, "UNAUTHORIZED");

    // Authenticated request to Treasury Overview via Bearer Token succeeds (200 OK)
    const overviewRes = await fetch(`http://localhost:${testPort}/api/treasury/overview?companyId=${testCompanyId}`, {
      headers: {
        Authorization: "Bearer bizarc_auth_token_live_2026",
      },
    });
    assert.strictEqual(overviewRes.status, 200);
    const overviewBody = await overviewRes.json();
    assert.ok(Array.isArray(overviewBody.overview));

    // Testing SPRS decision via HTTP: approval without signature rejected with 400 SIGNATURE_REQUIRED
    const testSprsId = `SPRS_HTTP_TEST_${Date.now()}`;
    const sprsMissingSigRes = await fetch(`http://localhost:${testPort}/api/sprs/${testSprsId}/decision`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer bizarc_auth_token_live_2026",
      },
      body: JSON.stringify({ decision: "APPROVE" }),
    });
    assert.strictEqual(sprsMissingSigRes.status, 400);
    const sprsMissingSigBody = await sprsMissingSigRes.json();
    assert.strictEqual(sprsMissingSigBody.error, "SIGNATURE_REQUIRED");

    await daemon.stop();
  });
});
