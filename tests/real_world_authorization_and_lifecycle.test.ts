import { describe, it } from "node:test";
import assert from "node:assert";
import { DbClient } from "../src/database/dbClient.js";
import { EnterpriseOnboardingService } from "../src/services/enterpriseOnboardingService.js";
import { DynamicRecordsService } from "../src/records/dynamicRecordsService.js";
import { VendorLifecycleService } from "../src/services/vendorLifecycleService.js";
import { RecurringLiabilityService } from "../src/services/recurringLiabilityService.js";
import { AuthorizationGate } from "../src/security/authorizationGate.js";
import { PolicyLoader } from "../src/config/policyLoader.js";
import { UniversalPaymentRouter } from "../src/payments/universalPaymentRouter.js";
import { PermissionRequestRepo } from "../src/database/repos/permissionRequestRepo.js";
import { VendorMasterRepo } from "../src/database/repos/vendorMasterRepo.js";
import { TreasuryAccountsRepo } from "../src/database/repos/treasuryAccountsRepo.js";
import { ToolRegistry } from "../src/tools/toolRegistry.js";

describe("Real-World Tests: Dynamic Onboarding, Two-Layer Authorization & Liability Lifecycle", () => {
  const testCompanyId = `comp_${Date.now()}`;
  const testCompanyName = "Apex Cybernetic Technologies";
  const engineeringAccountId = `acc_eng_${Date.now().toString(36)}`;
  const payrollAccountId = `acc_pay_${Date.now().toString(36)}`;
  const vendorId1 = `vend_aws_${Date.now().toString(36)}`;
  const vendorId2 = `vend_github_${Date.now().toString(36)}`;

  it("Test 1: Dynamic Declared Policies created during onboarding (not static in system)", async () => {
    const onboarding = new EnterpriseOnboardingService();

    // Ingest entity profile and create dynamic policies
    const profile = await onboarding.createCompanyProfileFromConnectedData({
      companyId: testCompanyId,
      companyName: testCompanyName,
      businessDescription: "Next-generation autonomous edge computing networks",
      costCenters: [
        { id: engineeringAccountId, name: "Apex Engineering", role: "OPEX_DEV" as any },
        { id: payrollAccountId, name: "Apex Payroll", role: "PAYROLL" as any },
      ],
    });

    assert.strictEqual(profile.company_id, testCompanyId);
    assert.strictEqual(profile.inferred_policies.declaredPolicies.costCenterRules.length > 0, true);

    // Verify PolicyLoader loads dynamically created policy from onboarding
    const suggestedProposal = onboarding.generatePolicyProposal({
      companyName: testCompanyName,
      adminEmail: "cfo@apexcyber.io",
      erpSource: "ERPNEXT",
      costCenters: [
        {
          accountId: engineeringAccountId,
          name: "Apex Engineering",
          role: "OPEX_DEV" as any,
          monthlyCommittedLiabilitiesUsdc: 25000,
          highestSingleBillUsdc: 5000,
          discoveredVendors: [vendorId1],
        },
        {
          accountId: payrollAccountId,
          name: "Apex Payroll",
          role: "PAYROLL" as any,
          monthlyCommittedLiabilitiesUsdc: 40000,
          highestSingleBillUsdc: 40000,
          discoveredVendors: [],
        },
      ],
      discoveredSuppliers: [],
      discoveredLiabilities: [],
    });

    PolicyLoader.setDynamicProfile(suggestedProposal.profile, testCompanyName);
    const activeLoaded = PolicyLoader.getActiveProfile();
    assert.strictEqual(activeLoaded.profileName, testCompanyName);
    assert.ok(activeLoaded.profile.operating_accounts.some((a) => a.account_id === engineeringAccountId));
  });

  it("Test 2: Dynamic Record 1 & Dynamic Record 2 created for the first time during onboarding", async () => {
    const onboarding = new EnterpriseOnboardingService();
    const dynamicRecords = new DynamicRecordsService();

    // Provision accounts and seed Genesis Ledger
    const provisionResult = await onboarding.provisionAccountsAndLedger({
      profile: {
        companyName: testCompanyName,
        adminEmail: "cfo@apexcyber.io",
        erpSource: "ERPNEXT",
        costCenters: [
          {
            accountId: engineeringAccountId,
            name: "Apex Engineering",
            role: "OPEX_DEV" as any,
            monthlyCommittedLiabilitiesUsdc: 5000,
            highestSingleBillUsdc: 2500,
            discoveredVendors: [vendorId1],
          },
          {
            accountId: payrollAccountId,
            name: "Apex Payroll",
            role: "PAYROLL" as any,
            monthlyCommittedLiabilitiesUsdc: 30000,
            highestSingleBillUsdc: 30000,
            discoveredVendors: [],
          },
        ],
        discoveredSuppliers: [
          {
            supplierId: vendorId1,
            name: "Amazon Web Services",
            payoutAddress: "0x1111111111111111111111111111111111111111",
            authorizedCategory: "INFRASTRUCTURE",
          },
        ],
        discoveredLiabilities: [
          {
            invoiceNumber: "INV-AWS-INITIAL-01",
            supplierId: vendorId1,
            costCenter: engineeringAccountId,
            amountUsdc: 1500,
            dueDate: new Date(Date.now() + 5 * 86400 * 1000),
            deliveryReceiptProof: "GRN_INITIAL_PROOF",
            purchaseOrderNumber: "PO_AWS_INIT",
          },
        ],
      },
      committedPolicy: PolicyLoader.getActiveProfile().profile,
    });

    assert.strictEqual(provisionResult.accountsCreated.length, 2);
    assert.strictEqual(provisionResult.liabilitiesScheduled.length, 1);

    // Verify Dynamic Record 1 exists
    const liabilities = await dynamicRecords.getLiabilities(engineeringAccountId);
    assert.strictEqual(liabilities.length, 1);
    assert.strictEqual(liabilities[0].vendorId, vendorId1);

    // Simulate account initial activation deposit ($10,000 USDC)
    const depositResult = await onboarding.ingestActivationDeposit(
      engineeringAccountId,
      "0xarc_genesis_deposit_tx",
      10000.0
    );
    assert.strictEqual(depositResult.status, "ACTIVATED");

    // Verify Dynamic Record 2 and Parallel Tripartite Balance ($B_L + B_Y = B_E$)
    const stiRecord = await dynamicRecords.calculateSafeToInvest(engineeringAccountId);
    assert.ok(stiRecord);
    assert.strictEqual(stiRecord.tripartiteBalance.liquidCashUsdc, "10000.000000");
    assert.strictEqual(stiRecord.tripartiteBalance.availableBalanceUsdc, "10000.000000");
    // With 1500 upcoming liability and target reserve, Safe-to-Invest is positive:
    assert.ok(parseFloat(stiRecord.safeToInvestUsdc) > 0);
  });

  it("Test 3: Two Layers of Authorization — Layer 1 (Enforcer Agent) grants PERMIT for Inside-the-Rules actions", async () => {
    // Proposing agent submits Reason-Bearing Intent within policy bounds
    const authResult = await AuthorizationGate.requestAuthorization({
      actionType: "AUTONOMOUS_SWEEP_TO_USYC",
      accountId: engineeringAccountId,
      amountUsdc: "250.000000",
      declaredReason: "Surplus cash above 14-day liability horizon swept to USYC on Arc L1 for 5.1% yield.",
    });

    assert.strictEqual(authResult.isAuthorized, true);
    assert.strictEqual(authResult.layer, "ENFORCER_AGENT");
    assert.ok(authResult.clearanceCode?.startsWith("CLEAR-"));

    // Verify that AuthorizationGate recognizes the clearanceCode
    const verifyResult = await AuthorizationGate.verifyAuthorization({
      actionType: "SWEEP_TO_USYC",
      accountId: engineeringAccountId,
      amountUsdc: "250.000000",
      clearanceCode: authResult.clearanceCode,
    });

    assert.strictEqual(verifyResult.isAuthorized, true);
    assert.strictEqual(verifyResult.layer, "ENFORCER_AGENT");
  });

  it("Test 4: Two Layers of Authorization — Unauthorized actions lacking clearance and human sign-off are blocked", async () => {
    // Attempting action without any Layer 1 clearance or Layer 2 SPRS must fail
    const unauthCheck = await AuthorizationGate.verifyAuthorization({
      actionType: "TRANSFER_FUNDS",
      accountId: engineeringAccountId,
      amountUsdc: "5000.000000",
    });

    assert.strictEqual(unauthCheck.isAuthorized, false);
    assert.match(unauthCheck.reason, /UNAUTHORIZED_ACTION_ERROR/);
    assert.match(unauthCheck.reason, /lacks both Layer 1.*and Layer 2/);
  });

  it("Test 5: Two Layers of Authorization — Outside-the-Rules actions escalate to Layer 2 Human SPRS", async () => {
    // Proposed amount ($150,000) exceeds autonomous per-tx cap ($25,000)
    const largeAction = await AuthorizationGate.requestAuthorization({
      actionType: "VENDOR_DISBURSAL_SETTLEMENT",
      accountId: engineeringAccountId,
      amountUsdc: "150000.000000",
      declaredReason: "Bulk annual infrastructure reservation across multi-region datacenters.",
      recipientAddress: "0x1111111111111111111111111111111111111111",
    });

    assert.strictEqual(largeAction.isAuthorized, false);
    assert.strictEqual(largeAction.layer, "HUMAN");
    assert.ok(largeAction.sprsRequestId?.startsWith("SPRS_"));

    // Verify pending SPRS is saved in PostgreSQL
    const sprsRecord = await PermissionRequestRepo.getRequestById(largeAction.sprsRequestId!);
    assert.ok(sprsRecord);
    assert.strictEqual(sprsRecord?.status, "PENDING");

    // Human CFO approves SPRS
    await PermissionRequestRepo.updateStatus(largeAction.sprsRequestId!, "APPROVED");

    // Now Layer 2 verification succeeds
    const verifyApproved = await AuthorizationGate.verifyAuthorization({
      actionType: "VENDOR_DISBURSAL_SETTLEMENT",
      accountId: engineeringAccountId,
      amountUsdc: "150000.000000",
      sprsRequestId: largeAction.sprsRequestId,
    });

    assert.strictEqual(verifyApproved.isAuthorized, true);
    assert.strictEqual(verifyApproved.layer, "HUMAN");
  });

  it("Test 5B: Cryptographic EIP-712 Signer Recovery & Single-Use Clearance Code Guardrails", async () => {
    // 1. Fake clearance code rejection
    const fakeCodeCheck = await AuthorizationGate.verifyAuthorization({
      actionType: "SWEEP_TO_USYC",
      accountId: engineeringAccountId,
      amountUsdc: "250.000000",
      clearanceCode: "CLEAR-9999999-FAKETOKEN",
    });
    assert.strictEqual(fakeCodeCheck.isAuthorized, false);
    assert.match(fakeCodeCheck.reason, /never issued by Enforcer Agent/);

    // 2. Legitimate clearance code issuance and consumption (single-use invariant)
    const legitAuth = await AuthorizationGate.requestAuthorization({
      actionType: "AUTONOMOUS_SWEEP_TO_USYC",
      accountId: engineeringAccountId,
      amountUsdc: "100.000000",
      declaredReason: "Single-use clearance lifecycle verification.",
    });
    assert.strictEqual(legitAuth.isAuthorized, true);
    assert.ok(legitAuth.clearanceCode);

    // First verification with consumption succeeds
    const firstUse = await AuthorizationGate.verifyAuthorization({
      actionType: "SWEEP_TO_USYC",
      accountId: engineeringAccountId,
      amountUsdc: "100.000000",
      clearanceCode: legitAuth.clearanceCode,
      consumeClearance: true,
    });
    assert.strictEqual(firstUse.isAuthorized, true);

    // Second verification must fail (replay attack prevented)
    const replayAttempt = await AuthorizationGate.verifyAuthorization({
      actionType: "SWEEP_TO_USYC",
      accountId: engineeringAccountId,
      amountUsdc: "100.000000",
      clearanceCode: legitAuth.clearanceCode,
    });
    assert.strictEqual(replayAttempt.isAuthorized, false);
    assert.match(replayAttempt.reason, /already consumed/);

    // 3. Amount boundary violation
    const legitAuth2 = await AuthorizationGate.requestAuthorization({
      actionType: "AUTONOMOUS_SWEEP_TO_USYC",
      accountId: engineeringAccountId,
      amountUsdc: "50.000000",
      declaredReason: "Cap verification.",
    });
    const capViolation = await AuthorizationGate.verifyAuthorization({
      actionType: "SWEEP_TO_USYC",
      accountId: engineeringAccountId,
      amountUsdc: "5000.000000", // Exceeds the 50 USDC issued clearance!
      clearanceCode: legitAuth2.clearanceCode,
    });
    assert.strictEqual(capViolation.isAuthorized, false);
    assert.match(capViolation.reason, /amount exceeded/);

    // 4. Account mismatch violation
    const accountMismatch = await AuthorizationGate.verifyAuthorization({
      actionType: "SWEEP_TO_USYC",
      accountId: payrollAccountId, // Different account!
      amountUsdc: "50.000000",
      clearanceCode: legitAuth2.clearanceCode,
    });
    assert.strictEqual(accountMismatch.isAuthorized, false);
    assert.match(accountMismatch.reason, /account mismatch/);

    // 5. Dummy admin signature rejection (starts with 0x but not authentic EIP-712)
    const dummySigCheck = await AuthorizationGate.verifyAuthorization({
      actionType: "DISBURSAL_SETTLEMENT",
      accountId: engineeringAccountId,
      amountUsdc: "500.000000",
      adminSignature: "0x" + "a".repeat(130),
    });
    assert.strictEqual(dummySigCheck.isAuthorized, false);
    assert.match(dummySigCheck.reason, /UNAUTHORIZED_SIGNER_ERROR|SIGNATURE_RECOVERY_ERROR/);

    // 6. Cryptographically valid EIP-712 admin signature verification
    const validSignature = await AuthorizationGate.createAdminSignature({
      permissionRequestId: "SPRS_CRYPTO_TEST_01",
      actionType: "DISBURSAL_SETTLEMENT",
      accountId: engineeringAccountId,
      amountUsdc: "500.000000",
    });

    const validSigCheck = await AuthorizationGate.verifyAuthorization({
      actionType: "DISBURSAL_SETTLEMENT",
      accountId: engineeringAccountId,
      amountUsdc: "500.000000",
      sprsRequestId: "SPRS_CRYPTO_TEST_01",
      adminSignature: validSignature,
    });
    assert.strictEqual(validSigCheck.isAuthorized, true);
    assert.strictEqual(validSigCheck.layer, "HUMAN");
    assert.ok(validSigCheck.signerAddress);

    // 7. Signature from unauthorized key rejected
    const unauthorizedPrivateKey = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as `0x${string}`;
    const unauthorizedSignature = await AuthorizationGate.createAdminSignature({
      permissionRequestId: "SPRS_CRYPTO_TEST_UNAUTH",
      actionType: "DISBURSAL_SETTLEMENT",
      accountId: engineeringAccountId,
      amountUsdc: "500.000000",
      privateKey: unauthorizedPrivateKey,
    });

    const unauthSigCheck = await AuthorizationGate.verifyAuthorization({
      actionType: "DISBURSAL_SETTLEMENT",
      accountId: engineeringAccountId,
      amountUsdc: "500.000000",
      sprsRequestId: "SPRS_CRYPTO_TEST_UNAUTH",
      adminSignature: unauthorizedSignature,
    });
    assert.strictEqual(unauthSigCheck.isAuthorized, false);
    assert.match(unauthSigCheck.reason, /UNAUTHORIZED_SIGNER_ERROR/);
  });

  it("Test 6: Registering vendors, adding, editing, and removing recurring liabilities with Human Approval Gate", async () => {
    // 1. Register new vendor in VendorMaster
    const newVendor = await VendorLifecycleService.registerVendor({
      vendorId: vendorId2,
      name: "GitHub Enterprise",
      verifiedPayoutAddress: "0x2222222222222222222222222222222222222222",
      authorizedCategory: "DEVELOPER_TOOLS",
      payoutRail: "DISBURSAL_VAULT",
    });
    assert.strictEqual(newVendor.vendor_id, vendorId2);

    // 2. Agent proposes adding a recurring liability (requires human approval)
    const addProposal = await RecurringLiabilityService.addRecurringLiability({
      spec: {
        accountId: engineeringAccountId,
        vendorId: vendorId2,
        title: "GitHub Enterprise Cloud Seats",
        category: "SAAS",
        amountUsdc: "450.000000",
        dueDate: new Date(Date.now() + 10 * 86400 * 1000),
        frequencyCron: "0 0 1 * *",
      },
      proposedBy: "LiabilityRadarAgent",
      rationale: "Monthly developer seat billing for core repository access.",
    });

    assert.strictEqual(addProposal.status, "PENDING_HUMAN_APPROVAL");
    assert.ok(addProposal.sprsRequestId);

    // Human CFO ratifies and approves adding the liability
    await PermissionRequestRepo.updateStatus(addProposal.sprsRequestId!, "APPROVED");
    const ratifiedAdd = await RecurringLiabilityService.addRecurringLiability({
      spec: {
        accountId: engineeringAccountId,
        vendorId: vendorId2,
        title: "GitHub Enterprise Cloud Seats",
        category: "SAAS",
        amountUsdc: "450.000000",
        dueDate: new Date(Date.now() + 10 * 86400 * 1000),
        frequencyCron: "0 0 1 * *",
      },
      proposedBy: "LiabilityRadarAgent",
      rationale: "Monthly developer seat billing",
      sprsRequestId: addProposal.sprsRequestId,
    });

    assert.strictEqual(ratifiedAdd.status, "CREATED");
    assert.ok(ratifiedAdd.liabilityId);

    // 3. Agent proposes editing the recurring liability (price increase to $520 USDC)
    const editProposal = await RecurringLiabilityService.editRecurringLiability({
      liabilityId: ratifiedAdd.liabilityId!,
      updates: { amountUsdc: "520.000000" },
      proposedBy: "LiabilityRadarAgent",
      rationale: "Vendor price adjustment reflecting 5 additional engineer licenses.",
    });

    assert.strictEqual(editProposal.status, "PENDING_HUMAN_APPROVAL");
    await PermissionRequestRepo.updateStatus(editProposal.sprsRequestId!, "APPROVED");

    const ratifiedEdit = await RecurringLiabilityService.editRecurringLiability({
      liabilityId: ratifiedAdd.liabilityId!,
      updates: { amountUsdc: "520.000000" },
      proposedBy: "LiabilityRadarAgent",
      rationale: "Ratified price increase",
      sprsRequestId: editProposal.sprsRequestId,
    });
    assert.strictEqual(ratifiedEdit.status, "UPDATED");

    // 4. Agent proposes removing the recurring liability
    const removeProposal = await RecurringLiabilityService.removeRecurringLiability({
      liabilityId: ratifiedAdd.liabilityId!,
      proposedBy: "LiabilityRadarAgent",
      rationale: "Deprecating redundant seat plan.",
    });

    assert.strictEqual(removeProposal.status, "PENDING_HUMAN_APPROVAL");
    await PermissionRequestRepo.updateStatus(removeProposal.sprsRequestId!, "APPROVED");

    const ratifiedRemove = await RecurringLiabilityService.removeRecurringLiability({
      liabilityId: ratifiedAdd.liabilityId!,
      proposedBy: "LiabilityRadarAgent",
      rationale: "Deprecating seat plan",
      sprsRequestId: removeProposal.sprsRequestId,
    });
    assert.strictEqual(ratifiedRemove.status, "REMOVED");
  });

  it("Test 7: Payee Substitution Defense — Updating vendor payout address requires Layer 2 Human Approval", async () => {
    // Agent attempts to change GitHub's payout address to an attacker's address
    const updateAttempt = await VendorLifecycleService.proposeOrUpdateVendor({
      vendorId: vendorId2,
      newPayoutAddress: "0xAttackerHijackAddress9999999999999999999999" as any,
      reason: "Updating vendor bank instructions from forwarded email",
      proposedBy: "LiabilityRadarAgent",
    });

    assert.strictEqual(updateAttempt.status, "PENDING_HUMAN_APPROVAL");
    assert.ok(updateAttempt.sprsRequestId);
    assert.match(updateAttempt.message, /Payee substitution defense active/);

    // Immutable address in Vendor Master remains unchanged
    const currentVendor = await VendorMasterRepo.getVendorById(vendorId2);
    assert.strictEqual(currentVendor?.verified_payout_address.toLowerCase(), "0x2222222222222222222222222222222222222222");
  });

  it("Test 8: Automatic USYC Withdrawal — When paying from invested funds, router automatically recalls from USYC", async () => {
    const dynamicRecords = new DynamicRecordsService();
    const router = new UniversalPaymentRouter();

    // Set account balance: Liquid = 100 USDC, Invested in USYC = 2000 USDC, Total Available = 2100 USDC
    await DbClient.query(
      `INSERT INTO dynamic_safe_to_invest 
        (account_id, liquid_cash_usdc, invested_yield_usdc, available_balance_usdc, target_reserve_usdc, safe_to_invest_usdc, time_horizon_seconds, recall_speed_seconds, status)
       VALUES ($1, '100.000000', '2000.000000', '2100.000000', '50.000000', '0.000000', 604800, 60, 'BALANCED');`,
      [engineeringAccountId]
    );

    const tripBefore = await dynamicRecords.getTripartiteBalance(engineeringAccountId);
    assert.strictEqual(tripBefore.liquidCashUsdc, "100.000000");
    assert.strictEqual(tripBefore.availableBalanceUsdc, "2100.000000");

    // Payment requires $500 USDC (liquid is only 100, but available is 2100!)
    const paymentResult = await router.routeAndExecute({
      intent: {
        intentId: `DISB_RECALL_TEST_${Date.now()}`,
        primaryAccountId: engineeringAccountId,
        vendorId: vendorId1,
        vendorName: "Amazon Web Services",
        amountUsdc: 500.0,
        payoutAddress: "0x1111111111111111111111111111111111111111",
        declaredReason: "Paying server hosting from available balance with automatic USYC recall.",
        invoiceId: "INV-AWS-RECALL-99",
        poReference: "PO-AWS-RECALL",
        deliveryProofHash: "0xhash_grn_ok",
        requireThreeWayMatch: true,
      },
      overrideRail: "DISBURSAL_VAULT",
    });

    assert.strictEqual(paymentResult.success, true);
    assert.ok(paymentResult.status === "EXECUTED" || paymentResult.status === "SETTLED");
    assert.ok(paymentResult.txHash);
    assert.ok(paymentResult.journalSequenceId);
  });

  it("Test 9: ToolRegistry integrates all vendor, recurring liability, and authorization tools", async () => {
    const registry = new ToolRegistry();
    const toolDefs = registry.getToolDefinitions();
    const toolNames = toolDefs.map((t) => t.function.name);

    assert.ok(toolNames.includes("register_vendor"));
    assert.ok(toolNames.includes("update_vendor"));
    assert.ok(toolNames.includes("remove_vendor"));
    assert.ok(toolNames.includes("add_account_liability"));
    assert.ok(toolNames.includes("edit_account_liability"));
    assert.ok(toolNames.includes("remove_account_liability"));
    assert.ok(toolNames.includes("evaluate_reason_bearing_intent"));
    assert.ok(toolNames.includes("route_universal_payment"));
  });
});
