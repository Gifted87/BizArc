import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { SystemHttpServer, DEFAULT_API_KEY } from "../src/ingress/systemHttpServer.js";
import { TreasuryStateMachineOrchestrator } from "../src/orchestration/treasuryStateMachineOrchestrator.js";
import { TreasuryAccountsRepo } from "../src/database/repos/treasuryAccountsRepo.js";
import { PermissionRequestRepo } from "../src/database/repos/permissionRequestRepo.js";
import { VendorMasterRepo } from "../src/database/repos/vendorMasterRepo.js";
import { MasterJournalRepo } from "../src/database/repos/masterJournalRepo.js";
import { AuthorizationGate } from "../src/security/authorizationGate.js";

test("Twelve API Categories Comprehensive Test Suite", async (t) => {
  const orchestrator = new TreasuryStateMachineOrchestrator();
  const server = new SystemHttpServer(orchestrator, 0); // Port 0 allocates an ephemeral free port
  const port = await server.start();
  const baseUrl = `http://localhost:${port}`;

  const testCompanyId = `test_corp_${Date.now()}`;
  const opsAccountId = `acc_${testCompanyId}_ops`;
  let sessionToken = "";

  // Helper for making authenticated HTTP requests
  async function apiRequest(path: string, options: { method?: string; body?: any; token?: string; apiKey?: string } = {}) {
    const method = options.method || "GET";
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (options.token) {
      headers["Authorization"] = `Bearer ${options.token}`;
    } else if (options.apiKey !== undefined) {
      if (options.apiKey) headers["x-api-key"] = options.apiKey;
    } else {
      headers["Authorization"] = `Bearer ${DEFAULT_API_KEY}`;
    }

    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }

  try {
    // Pre-seed test primary account with unique deterministic wallet address
    const opsWallet = `0x${crypto.randomBytes(20).toString("hex")}` as `0x${string}`;
    await TreasuryAccountsRepo.upsertAccount({
      account_id: opsAccountId,
      company_id: testCompanyId,
      name: "Primary Ops Account",
      role: "OPEX_DEV",
      wallet_address: opsWallet,
      chain_id: 5042002,
      min_operating_floor_usdc: 500,
      safety_buffer_ratio: 0.2,
      is_active: true,
    });

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. CATEGORY 11: AUTHENTICATION, SESSIONS & ROLES APIS
  // ─────────────────────────────────────────────────────────────────────────────
  await t.test("Category 11: Authentication, Sessions & Roles APIs", async () => {
    // 1a. Unauthenticated request to protected endpoint rejected with 401
    const unauth = await apiRequest("/api/accounts", { token: "", apiKey: "" });
    assert.strictEqual(unauth.status, 401);
    assert.strictEqual(unauth.data.error, "UNAUTHORIZED");

    // 1b. Public session exchange with valid master API key generates session token
    const sessRes = await apiRequest("/api/auth/session", {
      method: "POST",
      body: {
        apiKey: DEFAULT_API_KEY,
        companyId: testCompanyId,
        operatorId: "officer_alice",
        role: "TREASURY_OFFICER",
      },
      token: "", // public endpoint
    });

    assert.strictEqual(sessRes.status, 200);
    assert.strictEqual(sessRes.data.success, true);
    assert.ok(sessRes.data.session.token.startsWith("session_sec_"));
    assert.strictEqual(sessRes.data.session.user.companyId, testCompanyId);
    assert.strictEqual(sessRes.data.session.user.operatorId, "officer_alice");
    assert.ok(sessRes.data.session.user.permissions.includes("SPRS_DECIDE"));
    sessionToken = sessRes.data.session.token;

    // 1c. Authenticate with newly issued session token via GET /api/auth/me
    const meRes = await apiRequest("/api/auth/me", { token: sessionToken });
    assert.strictEqual(meRes.status, 200);
    assert.strictEqual(meRes.data.success, true);
    assert.strictEqual(meRes.data.user.operatorId, "officer_alice");
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. CATEGORY 1: ACCOUNT LIFECYCLE & MANAGEMENT APIS
  // ─────────────────────────────────────────────────────────────────────────────
  await t.test("Category 1: Account Lifecycle & Management APIs", async () => {
    const payrollAccountId = `acc_${testCompanyId}_payroll`;

    // 2a. POST /api/accounts: Create new corporate sub-account
    const createRes = await apiRequest("/api/accounts", {
      method: "POST",
      body: {
        companyId: testCompanyId,
        accountId: payrollAccountId,
        name: "Corporate Payroll Account",
        role: "PAYROLL",
        minOperatingFloorUsdc: 10000,
        safetyBufferRatio: 1.25,
        perTxCapUsdc: 5000,
        dailyCapUsdc: 25000,
        excludeFromWaterfall: true,
      },
      token: sessionToken,
    });
    assert.strictEqual(createRes.status, 201);
    assert.strictEqual(createRes.data.success, true);
    assert.strictEqual(createRes.data.data.account_id, payrollAccountId);
    assert.strictEqual(createRes.data.data.role, "PAYROLL");

    // 2b. GET /api/accounts: List accounts for company
    const listRes = await apiRequest(`/api/accounts?companyId=${testCompanyId}`, { token: sessionToken });
    assert.strictEqual(listRes.status, 200);
    assert.strictEqual(listRes.data.success, true);
    assert.ok(listRes.data.count >= 2);

    // 2c. GET /api/accounts/:id: Account detail + intelligence
    const getRes = await apiRequest(`/api/accounts/${payrollAccountId}?companyId=${testCompanyId}`, { token: sessionToken });
    assert.strictEqual(getRes.status, 200);
    assert.strictEqual(getRes.data.success, true);
    assert.strictEqual(getRes.data.data.account.name, "Corporate Payroll Account");

    // 2d. PUT /api/accounts/:id: Update account settings
    const putRes = await apiRequest(`/api/accounts/${payrollAccountId}`, {
      method: "PUT",
      body: {
        companyId: testCompanyId,
        name: "Corporate Payroll & Tax Account",
        minOperatingFloorUsdc: 12000,
      },
      token: sessionToken,
    });
    assert.strictEqual(putRes.status, 200);
    assert.strictEqual(putRes.data.success, true);
    assert.strictEqual(putRes.data.data.name, "Corporate Payroll & Tax Account");

    // 2e. POST /api/accounts/transfer: Inter-account fund transfer
    const transferRes = await apiRequest("/api/accounts/transfer", {
      method: "POST",
      body: {
        companyId: testCompanyId,
        fromAccountId: opsAccountId,
        toAccountId: payrollAccountId,
        amountUsdc: 250, // Inside autonomous limit (< 500)
        reason: "Operational float rebalancing",
      },
      token: sessionToken,
    });
    assert.strictEqual(transferRes.status, 200);
    assert.strictEqual(transferRes.data.success, true);
    assert.strictEqual(transferRes.data.status, "COMPLETED");
    assert.ok(transferRes.data.transferId.startsWith("TRANSFER_"));

    // 2f. DELETE /api/accounts/:id: Deactivate account
    const delRes = await apiRequest(`/api/accounts/${payrollAccountId}?companyId=${testCompanyId}`, {
      method: "DELETE",
      token: sessionToken,
    });
    assert.strictEqual(delRes.status, 200);
    assert.strictEqual(delRes.data.success, true);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. CATEGORY 2: SPRS, GOVERNANCE & EIP-712 SIGNING APIS
  // ─────────────────────────────────────────────────────────────────────────────
  await t.test("Category 2: SPRS, Governance & EIP-712 Signing APIs", async () => {
    const sprsId = `SPRS_TEST_${Date.now()}`;
    const sprsApproveId = `SPRS_TEST_APPROVE_${Date.now()}`;

    // Seed 2 pending SPRS requests
    await PermissionRequestRepo.createRequest({
      request_id: sprsId,
      action_type: "OUTFLOW_DISBURSAL",
      amount_usdc: 15000,
      reason: "Quarterly Enterprise Server Hardware Settlement",
      status: "PENDING",
      payload: {
        companyId: testCompanyId,
        accountId: opsAccountId,
        actionType: "OUTFLOW_DISBURSAL",
        nonce: 1,
      },
    });

    await PermissionRequestRepo.createRequest({
      request_id: sprsApproveId,
      action_type: "TAX_WITHHOLDING",
      amount_usdc: 7500,
      reason: "Federal Payroll Tax Remittance",
      status: "PENDING",
      payload: {
        companyId: testCompanyId,
        accountId: opsAccountId,
        actionType: "TAX_WITHHOLDING",
        nonce: 2,
      },
    });

    // 3a. GET /api/sprs/pending: List pending permission requests
    const pendingRes = await apiRequest("/api/sprs/pending", { token: sessionToken });
    assert.strictEqual(pendingRes.status, 200);
    assert.strictEqual(pendingRes.data.success, true);
    assert.ok(pendingRes.data.count >= 2);

    // 3b. GET /api/sprs: Filter by status
    const allSprsRes = await apiRequest("/api/sprs?status=PENDING", { token: sessionToken });
    assert.strictEqual(allSprsRes.status, 200);
    assert.ok(allSprsRes.data.data.some((r: any) => r.request_id === sprsId));

    // 3c. GET /api/sprs/:id: Detail
    const detailRes = await apiRequest(`/api/sprs/${sprsId}`, { token: sessionToken });
    assert.strictEqual(detailRes.status, 200);
    assert.strictEqual(detailRes.data.data.request_id, sprsId);

    // 3d. GET /api/sprs/:id/signing-payload: EIP-712 typed data structure
    const payloadRes = await apiRequest(`/api/sprs/${sprsId}/signing-payload`, { token: sessionToken });
    assert.strictEqual(payloadRes.status, 200);
    assert.strictEqual(payloadRes.data.success, true);
    assert.strictEqual(payloadRes.data.typedData.primaryType, "ActionAuthorization");
    assert.strictEqual(payloadRes.data.typedData.domain.name, "BizArc Authorization Gate");
    assert.strictEqual(payloadRes.data.typedData.domain.chainId, "5042002");
    assert.strictEqual(payloadRes.data.typedData.message.permissionRequestId, sprsId);

    // 3e. POST /api/sprs/:id/sign: Protected server signing endpoint
    const signRes = await apiRequest(`/api/sprs/${sprsApproveId}/sign`, {
      method: "POST",
      body: {},
      token: sessionToken,
    });
    assert.strictEqual(signRes.status, 200);
    assert.strictEqual(signRes.data.success, true);
    assert.ok(signRes.data.adminSignature.startsWith("0x"));
    assert.strictEqual(signRes.data.adminSignature.length, 132);
    const adminSignature = signRes.data.adminSignature;

    // 3f. POST /api/sprs/:id/decision with CANCEL_WITH_INSTRUCTIONS
    const cancelRes = await apiRequest(`/api/sprs/${sprsId}/decision`, {
      method: "POST",
      body: {
        decision: "CANCEL_WITH_INSTRUCTIONS",
        adminInstruction: "Hold payment pending vendor revised credit memo.",
      },
      token: sessionToken,
    });
    assert.strictEqual(cancelRes.status, 200);
    assert.strictEqual(cancelRes.data.success, true);
    assert.strictEqual(cancelRes.data.status, "CANCELLED");
    assert.strictEqual(cancelRes.data.adminInstruction, "Hold payment pending vendor revised credit memo.");

    // Verify status updated in DB
    const cancelledDb = await PermissionRequestRepo.getRequestById(sprsId);
    assert.strictEqual(cancelledDb?.status, "CANCELLED");

    // 3g. POST /api/sprs/:id/decision with APPROVE (authenticated EIP-712 signature)
    const approveRes = await apiRequest(`/api/sprs/${sprsApproveId}/decision`, {
      method: "POST",
      body: {
        decision: "APPROVE",
        adminSignature,
      },
      token: sessionToken,
    });
    assert.strictEqual(approveRes.status, 200);
    assert.strictEqual(approveRes.data.success, true);
    assert.strictEqual(approveRes.data.status, "APPROVE");
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. CATEGORY 3: OPERATIONAL STATE, LEDGER & HASH-CHAIN VERIFICATION APIS
  // ─────────────────────────────────────────────────────────────────────────────
  await t.test("Category 3: Operational State, Ledger & Hash-Chain Verification APIs", async () => {
    // 4a. GET /api/operational-state: Unified 5-dimension operational state
    const opRes = await apiRequest(`/api/operational-state?accountId=${opsAccountId}`, { token: sessionToken });
    assert.strictEqual(opRes.status, 200);
    assert.strictEqual(opRes.data.success, true);
    assert.ok(opRes.data.data.balances !== undefined);
    assert.ok(opRes.data.data.liabilities !== undefined);
    assert.ok(opRes.data.data.safeToInvestHorizon !== undefined);
    assert.ok(opRes.data.data.erpSyncStatus !== undefined);
    assert.ok(opRes.data.data.auditState !== undefined);

    // 4b. GET /api/treasury/overview: Typed company overview
    const overviewRes = await apiRequest(`/api/treasury/overview?companyId=${testCompanyId}`, { token: sessionToken });
    assert.strictEqual(overviewRes.status, 200);
    assert.strictEqual(overviewRes.data.success, true);
    assert.ok(overviewRes.data.overview.totalLiquidUsdc !== undefined);
    assert.ok(overviewRes.data.overview.totalInvestedUsyc !== undefined);
    assert.strictEqual(overviewRes.data.overview.tripartiteInvariantVerified, true);
    assert.ok(Array.isArray(overviewRes.data.overview.accounts));

    // 4c. GET /api/journal: Master journal vouchers
    const journalRes = await apiRequest(`/api/journal?companyId=${testCompanyId}`, { token: sessionToken });
    assert.strictEqual(journalRes.status, 200);
    assert.strictEqual(journalRes.data.success, true);
    assert.ok(Array.isArray(journalRes.data.data));

    // 4d. GET /api/journal/latest: Latest hash-linked voucher
    const latestRes = await apiRequest(`/api/journal/latest?companyId=${testCompanyId}`, { token: sessionToken });
    assert.strictEqual(latestRes.status, 200);
    assert.strictEqual(latestRes.data.success, true);

    // 4e. GET /api/journal/verify: SHA-256 hash chain cryptographic integrity verification
    const verifyRes = await apiRequest("/api/journal/verify", { token: sessionToken });
    assert.strictEqual(verifyRes.status, 200);
    assert.strictEqual(verifyRes.data.success, true);
    assert.strictEqual(verifyRes.data.verification.valid, true);

    // 4f. GET /api/audit-logs: Tamper-evident audit trail
    const auditRes = await apiRequest(`/api/audit-logs?accountId=${opsAccountId}`, { token: sessionToken });
    assert.strictEqual(auditRes.status, 200);
    assert.strictEqual(auditRes.data.success, true);
    assert.ok(Array.isArray(auditRes.data.data));
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. CATEGORY 4: LIABILITIES & INVOICE SETTLEMENT APIS
  // ─────────────────────────────────────────────────────────────────────────────
  await t.test("Category 4: Liabilities & Invoice Settlement APIs", async () => {
    let createdLiabilityId = "";

    // 5a. POST /api/liabilities: Create recurring liability
    const createRes = await apiRequest("/api/liabilities", {
      method: "POST",
      body: {
        companyId: testCompanyId,
        accountId: opsAccountId,
        vendorId: "vendor_cloud_host",
        title: "Dedicated Cloud Server Cluster",
        category: "INFRASTRUCTURE",
        amountUsdc: 1200,
        dueDate: new Date(Date.now() + 7 * 86400000).toISOString(),
        preferredPaymentRail: "DISBURSAL_VAULT",
      },
      token: sessionToken,
    });
    assert.strictEqual(createRes.status, 201);
    assert.strictEqual(createRes.data.success, true);
    createdLiabilityId = createRes.data.data.liabilityId || createRes.data.data.liability_id;

    // 5b. GET /api/liabilities: List liabilities
    const listRes = await apiRequest(`/api/liabilities?companyId=${testCompanyId}`, { token: sessionToken });
    assert.strictEqual(listRes.status, 200);
    assert.strictEqual(listRes.data.success, true);
    assert.ok(listRes.data.data.some((l: any) => (l.liabilityId || l.liability_id) === createdLiabilityId));

    // 5c. GET /api/liabilities/:id: Read detail
    const getRes = await apiRequest(`/api/liabilities/${createdLiabilityId}?companyId=${testCompanyId}`, { token: sessionToken });
    assert.strictEqual(getRes.status, 200);
    assert.strictEqual(getRes.data.success, true);
    assert.strictEqual(getRes.data.data.title, "Dedicated Cloud Server Cluster");

    // 5d. POST /api/liabilities/:id/payment-method: Configure rail (Rail 5 - Fiat Fedwire)
    const methodRes = await apiRequest(`/api/liabilities/${createdLiabilityId}/payment-method`, {
      method: "POST",
      body: {
        companyId: testCompanyId,
        vendorId: "vendor_cloud_host",
        preferredRail: "FIAT_PAYOUT",
        preferredSubMethod: "FEDWIRE",
        fiatDetails: {
          accountHolderName: "Cloud Host Inc",
          ibanOrAccountNumber: "US99BANK00001234567890",
          routingOrSwift: "021000021",
          bankName: "JPMorgan Chase",
          bankCountry: "USA",
        },
      },
      token: sessionToken,
    });
    assert.strictEqual(methodRes.status, 200);
    assert.strictEqual(methodRes.data.success, true);

    // 5e. GET /api/liabilities/:id/payment-method: Fetch configured rail
    const getMethodRes = await apiRequest(`/api/liabilities/${createdLiabilityId}/payment-method?companyId=${testCompanyId}&vendorId=vendor_cloud_host`, { token: sessionToken });
    assert.strictEqual(getMethodRes.status, 200);
    assert.strictEqual(getMethodRes.data.success, true);
    assert.strictEqual(getMethodRes.data.data.preferredRail, "FIAT_PAYOUT");

    // 5f. POST /api/liabilities/:id/dispute: Dispute liability
    const disputeRes = await apiRequest(`/api/liabilities/${createdLiabilityId}/dispute`, {
      method: "POST",
      body: {
        companyId: testCompanyId,
        accountId: opsAccountId,
        reason: "SLA downtime breach detected; withholding invoice.",
      },
      token: sessionToken,
    });
    assert.strictEqual(disputeRes.status, 200);
    assert.strictEqual(disputeRes.data.success, true);
    assert.strictEqual(disputeRes.data.status, "DISPUTED");

    // 5g. DELETE /api/liabilities/:id: Cancel liability
    const delRes = await apiRequest(`/api/liabilities/${createdLiabilityId}?companyId=${testCompanyId}`, {
      method: "DELETE",
      body: { adminInstruction: "Cancelled and voided by accounts payable." },
      token: sessionToken,
    });
    assert.strictEqual(delRes.status, 200);
    assert.strictEqual(delRes.data.success, true);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 6. CATEGORY 5: VENDOR MASTER & BANKING PROFILES APIS
  // ─────────────────────────────────────────────────────────────────────────────
  await t.test("Category 5: Vendor Master & Banking Profiles APIs", async () => {
    const vendorId = `vendor_audit_${Date.now()}`;
    const initialAddress = "0xaaaa111111111111111111111111111111111111";
    const substitutedAddress = "0xbbbb222222222222222222222222222222222222";

    // 6a. POST /api/vendors: Register vendor with verified payout and banking
    const regRes = await apiRequest("/api/vendors", {
      method: "POST",
      body: {
        vendorId,
        name: "Enterprise Audit Partners LLC",
        verifiedPayoutAddress: initialAddress,
        changeLock: true,
        bankDetails: {
          accountHolderName: "Enterprise Audit Partners LLC",
          ibanAccountNumber: "US12CHAS00009876543210",
          routingSwift: "021000021",
          bankName: "Chase Bank",
          paymentSubMethod: "FEDWIRE",
        },
      },
      token: sessionToken,
    });
    assert.strictEqual(regRes.status, 201);
    assert.strictEqual(regRes.data.success, true);
    assert.strictEqual(regRes.data.data.vendor.vendor_id, vendorId);

    // 6b. GET /api/vendors: List vendors
    const listRes = await apiRequest("/api/vendors", { token: sessionToken });
    assert.strictEqual(listRes.status, 200);
    assert.ok(listRes.data.data.some((v: any) => v.vendor_id === vendorId));

    // 6c. GET /api/vendors/:id: Fetch vendor profile + bank accounts
    const getRes = await apiRequest(`/api/vendors/${vendorId}`, { token: sessionToken });
    assert.strictEqual(getRes.status, 200);
    assert.strictEqual(getRes.data.data.vendor.name, "Enterprise Audit Partners LLC");
    assert.ok(Array.isArray(getRes.data.data.bankAccounts));

    // 6d. PUT /api/vendors/:id: Payee substitution guardrail (must fail without forceOverride)
    const failPutRes = await apiRequest(`/api/vendors/${vendorId}`, {
      method: "PUT",
      body: { newAddress: substitutedAddress, forceOverride: false },
      token: sessionToken,
    });
    assert.strictEqual(failPutRes.status, 403);
    assert.strictEqual(failPutRes.data.success, false);

    // 6e. PUT /api/vendors/:id: Succeeds with explicit officer forceOverride
    const okPutRes = await apiRequest(`/api/vendors/${vendorId}`, {
      method: "PUT",
      body: { newAddress: substitutedAddress, forceOverride: true, adminId: "officer_alice" },
      token: sessionToken,
    });
    assert.strictEqual(okPutRes.status, 200);
    assert.strictEqual(okPutRes.data.success, true);
    assert.strictEqual(okPutRes.data.data.verified_payout_address.toLowerCase(), substitutedAddress.toLowerCase());

    // 6f. DELETE /api/vendors/:id: Deactivate vendor
    const delRes = await apiRequest(`/api/vendors/${vendorId}`, {
      method: "DELETE",
      token: sessionToken,
    });
    assert.strictEqual(delRes.status, 200);
    assert.strictEqual(delRes.data.success, true);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 7. CATEGORY 6: YIELD, SWEEPS & LIQUIDITY MANAGEMENT APIS
  // ─────────────────────────────────────────────────────────────────────────────
  await t.test("Category 6: Yield, Sweeps & Liquidity Management APIs", async () => {
    // 7a. POST /api/yield/sweep: Trigger immediate safe-to-invest recalculation & sweep
    const sweepRes = await apiRequest("/api/yield/sweep", {
      method: "POST",
      body: { accountId: opsAccountId, forceImmediate: true },
      token: sessionToken,
    });
    assert.strictEqual(sweepRes.status, 200);
    assert.strictEqual(sweepRes.data.success, true);
    assert.strictEqual(sweepRes.data.accountId, opsAccountId);

    // 7b. POST /api/yield/recall: Trigger deficit recall
    const recallRes = await apiRequest("/api/yield/recall", {
      method: "POST",
      body: { accountId: opsAccountId, amountUsdc: 100, reason: "Impending payroll liquidity requirement" },
      token: sessionToken,
    });
    assert.strictEqual(recallRes.status, 200);
    assert.strictEqual(recallRes.data.success, true);
    assert.strictEqual(recallRes.data.status, "RECALLED");

    // 7c. GET /api/yield/performance: Query yield performance, APY, positions
    const perfRes = await apiRequest(`/api/yield/performance?companyId=${testCompanyId}`, { token: sessionToken });
    assert.strictEqual(perfRes.status, 200);
    assert.strictEqual(perfRes.data.success, true);
    assert.strictEqual(perfRes.data.data.annualYieldRate, "5.15%");
    assert.ok(Array.isArray(perfRes.data.data.positions));
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 8. CATEGORY 7: CURRENCY SWAPS & FIAT OFF-RAMPING APIS
  // ─────────────────────────────────────────────────────────────────────────────
  await t.test("Category 7: Currency Swaps & Fiat Off-Ramping APIs", async () => {
    // 8a. POST /api/swaps/estimate: Estimate token conversion
    const estRes = await apiRequest("/api/swaps/estimate", {
      method: "POST",
      body: {
        fromChain: "Arc",
        fromToken: "USDT",
        toChain: "Arc",
        toToken: "USDC",
        amount: "5000",
      },
      token: sessionToken,
    });
    assert.strictEqual(estRes.status, 200);
    assert.strictEqual(estRes.data.success, true);
    assert.ok(estRes.data.data.estimatedToAmount !== undefined);

    // 8b. GET /api/swaps/quotes: Read quote
    const quoteRes = await apiRequest("/api/swaps/quotes?fromToken=USDT&toToken=USDC&amount=1000", { token: sessionToken });
    assert.strictEqual(quoteRes.status, 200);
    assert.strictEqual(quoteRes.data.success, true);

    // 8c. POST /api/funding/fiat/onramp: Generate on-ramp session
    const onrampRes = await apiRequest("/api/funding/fiat/onramp", {
      method: "POST",
      body: {
        accountId: opsAccountId,
        amountUsdc: 2500,
        userEmail: "treasurer@acme.internal",
      },
      token: sessionToken,
    });
    assert.strictEqual(onrampRes.status, 200);
    assert.strictEqual(onrampRes.data.success, true);

    // 8d. GET /api/funding/fiat/wire-instructions: Fedwire details
    const wireRes = await apiRequest(`/api/funding/fiat/wire-instructions?accountId=${opsAccountId}`, { token: sessionToken });
    assert.strictEqual(wireRes.status, 200);
    assert.strictEqual(wireRes.data.success, true);
    assert.ok(wireRes.data.data.beneficiaryBank !== undefined);

    // 8e. POST /api/funding/fiat/deposit-reconcile: Record deposit
    const depositRes = await apiRequest("/api/funding/fiat/deposit-reconcile", {
      method: "POST",
      body: {
        accountId: opsAccountId,
        amountUsdc: 5000,
        depositReference: `TEST_DEPOSIT_${Date.now()}`,
        sourceBank: "Silicon Valley Bank",
      },
      token: sessionToken,
    });
    assert.strictEqual(depositRes.status, 200);
    assert.strictEqual(depositRes.data.success, true);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 9. CATEGORY 8: ONBOARDING WIZARD & MATH RULES QA APIS
  // ─────────────────────────────────────────────────────────────────────────────
  await t.test("Category 8: Onboarding Wizard & Math Rules QA APIs", async () => {
    const wizardCompanyId = `wiz_corp_${Date.now()}`;

    // 9a. POST /api/onboarding/session: Start wizard session
    const startRes = await apiRequest("/api/onboarding/session", {
      method: "POST",
      body: {
        companyId: wizardCompanyId,
        entryPath: "MANUAL",
        companyName: "Autonomous Enterprises Inc",
        adminEmail: "founder@autonomous.internal",
      },
      token: sessionToken,
    });
    assert.strictEqual(startRes.status, 200);
    assert.strictEqual(startRes.data.success, true);
    const sessionId = startRes.data.instanceId;

    // 9b. GET /api/onboarding/session/:id: Retrieve session draft
    const getSessRes = await apiRequest(`/api/onboarding/session/${sessionId}`, { token: sessionToken });
    assert.strictEqual(getSessRes.status, 200);
    assert.strictEqual(getSessRes.data.success, true);
    assert.strictEqual(getSessRes.data.session.company_id, wizardCompanyId);

    // 9c. POST /api/onboarding/step: Submit step draft
    const stepRes = await apiRequest("/api/onboarding/step", {
      method: "POST",
      body: {
        sessionId,
        step: 1,
        payload: {
          companyName: "Autonomous Enterprises Inc",
          taxId: "12-3456789",
          jurisdiction: "Delaware, USA",
        },
      },
      token: sessionToken,
    });
    assert.strictEqual(stepRes.status, 200);
    assert.strictEqual(stepRes.data.success, true);

    // 9d. GET /api/onboarding/qa/questions: Fetch math rules QA questions
    const qRes = await apiRequest("/api/onboarding/qa/questions?category=GENERAL_MATH", { token: sessionToken });
    assert.strictEqual(qRes.status, 200);
    assert.strictEqual(qRes.data.success, true);
    assert.ok(qRes.data.count > 0);

    // 9e. POST /api/onboarding/qa/evaluate: Evaluate math rules QA answers
    const evalRes = await apiRequest("/api/onboarding/qa/evaluate", {
      method: "POST",
      body: {
        companyId: wizardCompanyId,
        answers: [
          { questionId: "GM_RUNWAY_MONTHS", answer: 12 },
          { questionId: "GM_MONTHLY_BURN", answer: 50000 },
        ],
        persist: true,
      },
      token: sessionToken,
    });
    assert.strictEqual(evalRes.status, 200);
    assert.strictEqual(evalRes.data.success, true);
    assert.ok(evalRes.data.results.length >= 2);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 10. CATEGORY 9: ERP SYNCHRONIZATION & MODEL CONTEXT PROTOCOL (MCP) APIS
  // ─────────────────────────────────────────────────────────────────────────────
  await t.test("Category 9: ERP Synchronization & Model Context Protocol (MCP) APIs", async () => {
    // 10a. POST /api/integrations/erp/sync: Record ERP sync checkpoint
    const syncRes = await apiRequest("/api/integrations/erp/sync", {
      method: "POST",
      body: {
        companyId: testCompanyId,
        systemType: "ERPNEXT",
        invoiceId: `INV_${Date.now()}`,
        txHash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      },
      token: sessionToken,
    });
    assert.strictEqual(syncRes.status, 200);
    assert.strictEqual(syncRes.data.success, true);
    assert.strictEqual(syncRes.data.status, "SYNCED");

    // 10b. GET /api/integrations/erp/status: Fetch sync checkpoint status
    const statusRes = await apiRequest(`/api/integrations/erp/status?companyId=${testCompanyId}`, { token: sessionToken });
    assert.strictEqual(statusRes.status, 200);
    assert.strictEqual(statusRes.data.success, true);

    // 10c. POST /api/integrations/mcp/extract: Live MCP extraction across connected apps
    const mcpRes = await apiRequest("/api/integrations/mcp/extract", {
      method: "POST",
      body: { companyId: testCompanyId, source: "ALL" },
      token: sessionToken,
    });
    assert.strictEqual(mcpRes.status, 200);
    assert.strictEqual(mcpRes.data.success, true);
    assert.ok(mcpRes.data.extracted !== undefined);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 11. CATEGORY 10: SYSTEM GOVERNANCE, CIRCUIT BREAKERS & POLICIES APIS
  // ─────────────────────────────────────────────────────────────────────────────
  await t.test("Category 10: System Governance, Circuit Breakers & Policies APIs", async () => {
    // 11a. GET /api/governance/readiness: 8-pillar production readiness audit
    const readyRes = await apiRequest("/api/governance/readiness", { token: sessionToken });
    assert.strictEqual(readyRes.status, 200);
    assert.strictEqual(readyRes.data.success, true);
    assert.ok(readyRes.data.report.overallScore >= 0);
    assert.ok(readyRes.data.report.pillars.yieldVault !== undefined);

    // 11b. POST /api/governance/circuit-breaker: Trigger emergency shutdown
    const freezeRes = await apiRequest("/api/governance/circuit-breaker", {
      method: "POST",
      body: { reason: "Suspicious volume spike detected across external bridge." },
      token: sessionToken,
    });
    assert.strictEqual(freezeRes.status, 200);
    assert.strictEqual(freezeRes.data.success, true);
    assert.strictEqual(freezeRes.data.circuitBreaker.active, true);

    // 11c. POST /api/governance/circuit-breaker/disarm: Disarm emergency circuit breaker
    const disarmRes = await apiRequest("/api/governance/circuit-breaker/disarm", {
      method: "POST",
      body: {},
      token: sessionToken,
    });
    assert.strictEqual(disarmRes.status, 200);
    assert.strictEqual(disarmRes.data.success, true);
    assert.strictEqual(disarmRes.data.circuitBreaker.active, false);

    // 11d. GET /api/governance/policies: Fetch active policy profile
    const polRes = await apiRequest(`/api/governance/policies?companyId=${testCompanyId}`, { token: sessionToken });
    assert.strictEqual(polRes.status, 200);
    assert.strictEqual(polRes.data.success, true);

    // 11e. PUT /api/governance/policies: Mutate spending limits
    const updatePolRes = await apiRequest("/api/governance/policies", {
      method: "PUT",
      body: {
        companyId: testCompanyId,
        spendingLimits: {
          daily_hard_cap_usdc: 50000,
          single_tx_human_gate_threshold_usdc: 10000,
        },
      },
      token: sessionToken,
    });
    assert.strictEqual(updatePolRes.status, 200);
    assert.strictEqual(updatePolRes.data.success, true);
    assert.strictEqual(updatePolRes.data.policies.spending_limits.daily_hard_cap_usdc, 50000);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 12. CATEGORY 12: WEBHOOKS & EXTERNAL EVENT INGRESS APIS
  // ─────────────────────────────────────────────────────────────────────────────
  await t.test("Category 12: Webhooks & External Event Ingress APIs", async () => {
    // 12a. POST /api/webhooks/circle-mint: Simulate Circle deposit webhook
    const circleRes = await apiRequest("/api/webhooks/circle-mint", {
      method: "POST",
      body: {
        eventType: "transfer.complete",
        accountId: opsAccountId,
        amountUsdc: 2500,
        trackingMemo: `CIRCLE_MINT_${Date.now()}`,
      },
      token: sessionToken,
    });
    assert.strictEqual(circleRes.status, 200);
    assert.strictEqual(circleRes.data.status, "DEPOSIT_RECONCILED");

    // 12b. POST /api/webhooks/bank: Simulate Commercial Partner Bank wire webhook
    const bankRes = await apiRequest("/api/webhooks/bank", {
      method: "POST",
      body: {
        eventId: `EV_BANK_${Date.now()}`,
        status: "SETTLED",
        amountUsdc: 10000,
        accountId: opsAccountId,
        sourceBank: "Silicon Valley Bank Fedwire",
      },
      token: sessionToken,
    });
    assert.strictEqual(bankRes.status, 200);
    assert.strictEqual(bankRes.data.status, "RECONCILED");

    // 12c. POST /api/events/balance-mutation: Handle blockchain balance mutation
    const mutRes = await apiRequest("/api/events/balance-mutation", {
      method: "POST",
      body: {
        accountId: opsAccountId,
        amountUsdc: 100,
        currentLiquidBalanceUsdc: 2600,
        origin: "FAUCET_DRIP",
      },
      token: sessionToken,
    });
    assert.strictEqual(mutRes.status, 200);
    assert.strictEqual(mutRes.data.success, true);
  });
  } finally {
    await server.stop();
  }
});
