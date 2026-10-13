import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { LiabilitySettingsService } from "../src/services/liabilitySettingsService.js";
import { ManualDisbursalService } from "../src/services/manualDisbursalService.js";
import { AccountFundingService } from "../src/services/accountFundingService.js";
import { SystemHttpServer, DEFAULT_API_KEY } from "../src/ingress/systemHttpServer.js";
import { ToolRegistry } from "../src/tools/toolRegistry.js";
import { DbClient } from "../src/database/dbClient.js";
import { AuthorizationGate, DEFAULT_ADMIN_PRIVATE_KEY } from "../src/security/authorizationGate.js";
import { MasterJournalRepo } from "../src/database/repos/masterJournalRepo.js";
import { LiabilityRepo } from "../src/database/repos/liabilityRepo.js";
import { VendorBankRepo } from "../src/database/repos/vendorBankRepo.js";
import { FiatPayoutRepo } from "../src/database/repos/fiatPayoutRepo.js";
import { VendorPaymentPreferenceRepo } from "../src/database/repos/vendorPaymentPreferenceRepo.js";
import { OnboardingWizardService } from "../src/services/onboardingWizardService.js";
import { LiabilityManagementService } from "../src/services/liabilityManagementService.js";
import { UniversalPaymentRouter } from "../src/payments/universalPaymentRouter.js";
import { AdHocPaymentStateMachine } from "../src/orchestration/stateMachines/AdHocPaymentStateMachine.js";

describe("Unified Fiat & Crypto Payment Settings, Sub-Rails, and Account Funding Test Suite", () => {
  let settingsService: LiabilitySettingsService;
  let manualService: ManualDisbursalService;
  let fundingService: AccountFundingService;
  let toolRegistry: ToolRegistry;
  let server: SystemHttpServer;
  let serverPort: number;

  const testCompanyId = "acme_global_corp";
  const testOperatingAccountId = "OPERATING_MAIN";
  const testPayrollAccountId = "PAYROLL_POOL";
  const testTaxAccountId = "TAX_RESERVE";
  const testYieldAccountId = "CENTRAL_YIELD_VAULT";

  const testVendorVault = "VEND_CAPEX_EQUIPMENT";
  const testVendorSessionKey = "VEND_AWS_SUBSCRIPTION";
  const testVendorCard = "VEND_FREELANCE_DESIGNER";
  const testVendorAch = "VEND_OFFICE_LANDLORD";
  const testVendorWire = "VEND_LEGAL_COUNSEL";

  before(async () => {
    settingsService = new LiabilitySettingsService();
    manualService = new ManualDisbursalService();
    fundingService = new AccountFundingService();
    toolRegistry = new ToolRegistry();

    server = new SystemHttpServer(undefined, 0);
    serverPort = await server.start();

    // 1. Seed Company Profile
    await DbClient.query(`
      INSERT INTO company_profiles (company_id, company_name, activation_status)
      VALUES ('${testCompanyId}', 'Acme Global Corp', 'ACTIVE')
      ON CONFLICT (company_id) DO UPDATE SET activation_status = 'ACTIVE';
    `);

    // 2. Seed Treasury Accounts (Operating, Payroll, Tax, Yield)
    await DbClient.query(`
      INSERT INTO treasury_accounts (account_id, company_id, name, role, wallet_address, min_operating_floor_usdc, is_active)
      VALUES 
        ('${testOperatingAccountId}', '${testCompanyId}', 'Operating Account', 'OPERATING', '0x1111111111111111111111111111111111111111', 1000.000000, true),
        ('${testPayrollAccountId}', '${testCompanyId}', 'Payroll Account', 'PAYROLL', '0x2222222222222222222222222222222222222222', 5000.000000, true),
        ('${testTaxAccountId}', '${testCompanyId}', 'Tax Reserve', 'TAX_RESERVE', '0x3333333333333333333333333333333333333333', 2000.000000, true),
        ('${testYieldAccountId}', '${testCompanyId}', 'Yield Vault', 'YIELD_VAULT', '0x4444444444444444444444444444444444444444', 0.000000, true)
      ON CONFLICT (account_id) DO UPDATE SET is_active = true;
    `);

    // Fund Operating and Payroll accounts with liquid balance in PostgreSQL
    await DbClient.query(`
      INSERT INTO dynamic_safe_to_invest 
        (account_id, liquid_cash_usdc, invested_yield_usdc, available_balance_usdc, target_reserve_usdc, safe_to_invest_usdc, time_horizon_seconds, recall_speed_seconds, status)
      VALUES 
        ('${testOperatingAccountId}', '50000.000000', '0.000000', '50000.000000', '1000.000000', '49000.000000', 604800, 60, 'BALANCED'),
        ('${testPayrollAccountId}', '100000.000000', '0.000000', '100000.000000', '5000.000000', '95000.000000', 604800, 60, 'BALANCED');
    `);
  });

  after(async () => {
    if (server) {
      await server.stop();
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // PART 1: ONBOARDING & LIABILITY PAYMENT SETTING CONFIGURATION
  // ─────────────────────────────────────────────────────────────────────────────
  it("Step 1: Admin configures liability with Crypto Rail 1 (DISBURSAL_VAULT)", async () => {
    // Create base liability
    const liability = await LiabilityRepo.createLiability({
      company_id: testCompanyId,
      account_id: testOperatingAccountId,
      vendor_id: testVendorVault,
      title: "Quarterly High-End Server Hardware",
      category: "INFRASTRUCTURE",
      amount_usdc: 15000.0,
      due_date: new Date(Date.now() + 86400000),
      payout_address: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      status: "SCHEDULED",
    });

    assert.ok(liability.liability_id);

    // Configure payment method via LiabilitySettingsService
    const result = await settingsService.configurePaymentMethod({
      companyId: testCompanyId,
      vendorId: testVendorVault,
      liabilityId: liability.liability_id,
      preferredRail: "DISBURSAL_VAULT",
      cryptoDetails: {
        walletAddress: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        chainId: 5042,
        tokenSymbol: "USDC",
      },
      disbursalRules: {
        autoPayThresholdUsdc: 5000,
        requireThreeWayMatch: true,
      },
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.preferredRail, "DISBURSAL_VAULT");
    assert.strictEqual(result.walletAddress, "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");

    // Verify stored settings
    const stored = await settingsService.getPaymentMethod({
      companyId: testCompanyId,
      vendorId: testVendorVault,
      liabilityId: liability.liability_id,
    });
    assert.strictEqual(stored.preferredRail, "DISBURSAL_VAULT");
    assert.strictEqual(stored.cryptoDetails?.walletAddress, "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    assert.strictEqual(stored.disbursalRules?.autoPayThresholdUsdc, 5000);
  });

  it("Step 2: Admin configures liability with Crypto Rail 3 (MODULAR_SESSION_KEY)", async () => {
    const result = await settingsService.configurePaymentMethod({
      companyId: testCompanyId,
      vendorId: testVendorSessionKey,
      preferredRail: "MODULAR_SESSION_KEY",
      cryptoDetails: {
        walletAddress: "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        sessionKeyId: "session_aws_monthly_compute",
        chainId: 5042,
      },
      disbursalRules: {
        autoPayThresholdUsdc: 3000,
      },
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.preferredRail, "MODULAR_SESSION_KEY");

    const stored = await settingsService.getPaymentMethod({
      companyId: testCompanyId,
      vendorId: testVendorSessionKey,
    });
    assert.strictEqual(stored.preferredRail, "MODULAR_SESSION_KEY");
    assert.strictEqual(stored.cryptoDetails?.sessionKeyId, "session_aws_monthly_compute");
  });

  it("Step 3: Admin configures liability with Fiat Sub-Method: PUSH_TO_CARD", async () => {
    const result = await settingsService.configurePaymentMethod({
      companyId: testCompanyId,
      vendorId: testVendorCard,
      preferredRail: "FIAT_PAYOUT",
      preferredSubMethod: "PUSH_TO_CARD",
      fiatDetails: {
        accountHolderName: "Elena Vance (Design Contractor)",
        ibanOrAccountNumber: "4111222233334444", // 16-digit debit PAN
        routingOrSwift: "CARD_OCT",
        cardToken: "tok_visa_direct_98765",
        cardLast4: "4444",
        cardNetwork: "VISA",
        bankCountry: "US",
      },
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.preferredRail, "FIAT_PAYOUT");
    assert.strictEqual(result.preferredSubMethod, "PUSH_TO_CARD");
    assert.ok(result.bankAccountId);

    // Verify stored bank account record in PostgreSQL
    const bank = await VendorBankRepo.getVerifiedBankAccount(testVendorCard);
    assert.ok(bank);
    assert.strictEqual(bank.payment_sub_method, "PUSH_TO_CARD");
    assert.strictEqual(bank.card_last4, "4444");
    assert.strictEqual(bank.card_token, "tok_visa_direct_98765");
  });

  it("Step 4: Admin configures liability with Fiat Sub-Method: ACH & Fedwire", async () => {
    // 4A: ACH Setup
    const achResult = await settingsService.configurePaymentMethod({
      companyId: testCompanyId,
      vendorId: testVendorAch,
      preferredRail: "FIAT_PAYOUT",
      preferredSubMethod: "ACH",
      fiatDetails: {
        accountHolderName: "Hudson Yards Commercial Properties LLC",
        ibanOrAccountNumber: "9876543210",
        routingOrSwift: "021000021",
        bankName: "JPMorgan Chase Bank",
        bankCountry: "US",
      },
    });
    assert.strictEqual(achResult.success, true);
    assert.strictEqual(achResult.preferredSubMethod, "ACH");

    // 4B: Fedwire Setup
    const wireResult = await settingsService.configurePaymentMethod({
      companyId: testCompanyId,
      vendorId: testVendorWire,
      preferredRail: "FIAT_PAYOUT",
      preferredSubMethod: "FEDWIRE",
      fiatDetails: {
        accountHolderName: "Wachtell, Lipton, Rosen & Katz LLP",
        ibanOrAccountNumber: "1122334455",
        routingOrSwift: "021000018",
        bankName: "Bank of New York Mellon",
        bankCountry: "US",
      },
    });
    assert.strictEqual(wireResult.success, true);
    assert.strictEqual(wireResult.preferredSubMethod, "FEDWIRE");
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // PART 2: MANUAL DISBURSAL FLOW (USER-INITIATED PAYMENTS)
  // ─────────────────────────────────────────────────────────────────────────────
  it("Step 5: User executes manual payment via Fiat Push-to-Card (Instant < 5 min settlement)", async () => {
    const payment = await manualService.executeManualDisbursal({
      companyId: testCompanyId,
      sourceAccountId: testOperatingAccountId,
      vendorId: testVendorCard,
      vendorName: "Elena Vance",
      amountUsdc: 450.0,
      fiatDetails: {
        subMethod: "PUSH_TO_CARD",
        accountHolderName: "Elena Vance",
        ibanOrAccountNumber: "4111222233334444",
        cardToken: "tok_visa_direct_98765",
        cardLast4: "4444",
        cardNetwork: "VISA",
      },
      declaredReason: "Urgent UI revision contractor milestone reimbursement",
    });

    assert.strictEqual(payment.success, true);
    assert.strictEqual(payment.status, "EXECUTED");
    assert.strictEqual(payment.rail, "FIAT_PAYOUT");
    assert.strictEqual(payment.subMethod, "PUSH_TO_CARD");
    assert.ok(payment.fiatPayoutId);
    assert.ok(payment.cardPayoutRef?.startsWith("CIR-CARD-"));
    assert.ok(payment.txHash?.startsWith("0x"));

    // Verify record in fiat_payout_records
    const record = await FiatPayoutRepo.getPayoutById(payment.fiatPayoutId!);
    assert.ok(record);
    assert.strictEqual(record.sub_method, "PUSH_TO_CARD");
    assert.ok(record.card_payout_ref?.startsWith("CIR-CARD-"));
  });

  it("Step 6: User executes high-value Fedwire payout with CFO EIP-712 cryptographic signature", async () => {
    const amount = 25000.0;
    const sprsId = "SPRS_CFO_WIRE_01";
    const cfoSignature = await AuthorizationGate.createAdminSignature({
      permissionRequestId: sprsId,
      actionType: "UNIVERSAL_DISBURSAL_FIAT_PAYOUT",
      accountId: testOperatingAccountId,
      amountUsdc: amount.toFixed(6),
      privateKey: DEFAULT_ADMIN_PRIVATE_KEY,
    });

    const payment = await manualService.executeManualDisbursal({
      companyId: testCompanyId,
      sourceAccountId: testOperatingAccountId,
      vendorId: testVendorWire,
      vendorName: "Wachtell Lipton",
      amountUsdc: amount,
      paymentRail: "FIAT_PAYOUT",
      sprsRequestId: sprsId,
      fiatDetails: {
        subMethod: "FEDWIRE",
        accountHolderName: "Wachtell Lipton",
        ibanOrAccountNumber: "1122334455",
        routingOrSwift: "021000018",
        bankCountry: "US",
      },
      declaredReason: "M&A Legal Retainer Quarterly Settlement",
      adminSignature: cfoSignature,
    });

    assert.strictEqual(payment.success, true);
    assert.strictEqual(payment.status, "EXECUTED");
    assert.strictEqual(payment.subMethod, "FEDWIRE");
    assert.ok(payment.imadOmadTrace?.startsWith("IMAD"));
  });

  it("Step 7: User executes manual payment via Crypto Arc L1 Vault", async () => {
    const payment = await manualService.executeManualDisbursal({
      companyId: testCompanyId,
      sourceAccountId: testOperatingAccountId,
      vendorId: testVendorVault,
      vendorName: "Hardware Vendor",
      amountUsdc: 250.0,
      paymentRail: "DISBURSAL_VAULT",
      cryptoDetails: {
        walletAddress: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      },
      declaredReason: "Spare server power supply units purchase",
    });

    assert.strictEqual(payment.success, true);
    assert.strictEqual(payment.status, "EXECUTED");
    assert.strictEqual(payment.rail, "DISBURSAL_VAULT");
    assert.ok(payment.txHash?.startsWith("0x"));
  });

  it("Step 8: Payroll Ring-Fencing strictly REJECTS non-payroll manual payment from PAYROLL account", async () => {
    const payment = await manualService.executeManualDisbursal({
      companyId: testCompanyId,
      sourceAccountId: testPayrollAccountId,
      vendorId: testVendorVault,
      vendorName: "Hardware Vendor",
      amountUsdc: 1000.0,
      category: "HARDWARE_PURCHASE", // Non-payroll category!
      declaredReason: "Attempted hardware draw from payroll account",
    });

    assert.strictEqual(payment.success, false);
    assert.strictEqual(payment.status, "REJECTED_BY_POLICY");
    assert.ok(payment.error?.includes("HARD INVARIANT VIOLATION"));
    assert.ok(payment.error?.includes("role PAYROLL"));
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // PART 3: MULTI-RAIL TREASURY ACCOUNT FUNDING
  // ─────────────────────────────────────────────────────────────────────────────
  it("Step 9: AccountFundingService inspects funding options for Operating and Payroll accounts", async () => {
    const options = await fundingService.getFundingOptions(testOperatingAccountId);

    assert.strictEqual(options.accountId, testOperatingAccountId);
    assert.strictEqual(options.accountRole, "OPERATING");

    // Fiat Options
    assert.strictEqual(options.fiatOptions.cardOnramp.available, true);
    assert.strictEqual(options.fiatOptions.fedwire.available, true);
    assert.strictEqual(options.fiatOptions.ach.available, true);
    assert.strictEqual(options.fiatOptions.sepa.available, true);
    assert.ok(options.fiatOptions.fedwire.trackingMemo.includes("OPERATING"));

    // Crypto Options
    assert.strictEqual(options.cryptoOptions.arcNative.available, true);
    assert.strictEqual(options.cryptoOptions.arcNative.chainId, 5042);
    assert.strictEqual(options.cryptoOptions.crossChainBridge.available, true);
    assert.strictEqual(options.cryptoOptions.multiTokenSwap.available, true);
  });

  it("Step 10: Initiates Card Onramp and Fedwire deposit sessions for Tax Reserve", async () => {
    // Card Onramp
    const cardSession = await fundingService.initiateFundingSession({
      accountId: testTaxAccountId,
      method: "FIAT_CARD_ONRAMP",
      amountUsdc: 2500.0,
      userEmail: "cfo@acmeglobal.com",
    });

    assert.strictEqual(cardSession.method, "FIAT_CARD_ONRAMP");
    assert.strictEqual(cardSession.amountUsdc, 2500.0);
    assert.ok(cardSession.checkoutUrl?.includes("checkout.circle.com"));
    assert.ok(cardSession.cliCommandVerbatim?.includes("circle wallet fund"));

    // Fedwire Instructions
    const wireSession = await fundingService.initiateFundingSession({
      accountId: testTaxAccountId,
      method: "FIAT_FEDWIRE",
      amountUsdc: 50000.0,
    });

    assert.strictEqual(wireSession.method, "FIAT_FEDWIRE");
    assert.ok(wireSession.trackingMemo?.includes("TAX_RESERVE"));
  });

  it("Step 11: Reconciles confirmed fiat deposit and updates double-entry general ledger", async () => {
    const depositAmount = 10000.0;
    const trackingRef = `BIZARC-MINT-${testOperatingAccountId}-REC01`;

    const result = await fundingService.reconcileDeposit({
      accountId: testOperatingAccountId,
      amountUsdc: depositAmount,
      depositReference: trackingRef,
      method: "FIAT_FEDWIRE",
      sourceInstitution: "JPMorgan Chase Institutional Wire",
      senderName: "Acme Global Treasury Holding Corp",
    });

    assert.strictEqual(result.status, "CONFIRMED");
    assert.strictEqual(result.amountUsdc, depositAmount);
    assert.ok(result.journalSequenceId);
    assert.ok(result.txHash);

    // Verify Master System Journal hash chaining
    const isChainValid = await MasterJournalRepo.verifyChainIntegrity();
    assert.strictEqual(isChainValid.valid, true);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // PART 4: PHYSICAL REST INGRESS ENDPOINTS
  // ─────────────────────────────────────────────────────────────────────────────
  it("Step 12: REST Ingress: POST & GET /api/liabilities/:id/payment-method", async () => {
    const liabilityId = "liab_demo_config_01";

    // POST configure
    const postRes = await fetch(`http://localhost:${serverPort}/api/liabilities/${liabilityId}/payment-method`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${DEFAULT_API_KEY}`,
      },
      body: JSON.stringify({
        companyId: testCompanyId,
        vendorId: testVendorCard,
        preferredRail: "FIAT_PAYOUT",
        preferredSubMethod: "PUSH_TO_CARD",
        fiatDetails: {
          accountHolderName: "Elena Vance",
          ibanOrAccountNumber: "4111222233334444",
          cardToken: "tok_card_live_001",
          cardLast4: "4444",
        },
      }),
    });

    const postData = (await postRes.json()) as any;
    assert.strictEqual(postRes.status, 200);
    assert.strictEqual(postData.data.preferredRail, "FIAT_PAYOUT");
    assert.strictEqual(postData.data.preferredSubMethod, "PUSH_TO_CARD");

    // GET retrieve
    const getRes = await fetch(
      `http://localhost:${serverPort}/api/liabilities/${liabilityId}/payment-method?companyId=${testCompanyId}&vendorId=${testVendorCard}`,
      {
        headers: { "Authorization": `Bearer ${DEFAULT_API_KEY}` },
      }
    );

    const getData = (await getRes.json()) as any;
    assert.strictEqual(getRes.status, 200);
    assert.strictEqual(getData.data.preferredRail, "FIAT_PAYOUT");
    assert.strictEqual(getData.data.preferredSubMethod, "PUSH_TO_CARD");
  });

  it("Step 13: REST Ingress: POST /api/disbursals/manual executes payment", async () => {
    const res = await fetch(`http://localhost:${serverPort}/api/disbursals/manual`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${DEFAULT_API_KEY}`,
      },
      body: JSON.stringify({
        companyId: testCompanyId,
        sourceAccountId: testOperatingAccountId,
        vendorId: testVendorCard,
        vendorName: "Elena Vance",
        amountUsdc: 125.0,
        fiatDetails: {
          subMethod: "PUSH_TO_CARD",
          accountHolderName: "Elena Vance",
          ibanOrAccountNumber: "4111222233334444",
          cardToken: "tok_card_live_001",
        },
        declaredReason: "REST Ingress manual payout test",
      }),
    });

    const data = (await res.json()) as any;
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.status, "EXECUTED");
    assert.strictEqual(data.subMethod, "PUSH_TO_CARD");
  });

  it("Step 14: REST Ingress: GET funding options and POST fund account", async () => {
    // GET funding options
    const getRes = await fetch(`http://localhost:${serverPort}/api/accounts/${testTaxAccountId}/funding-options`, {
      headers: { "Authorization": `Bearer ${DEFAULT_API_KEY}` },
    });
    const getData = (await getRes.json()) as any;
    assert.strictEqual(getRes.status, 200);
    assert.strictEqual(getData.data.accountId, testTaxAccountId);

    // POST fund account
    const postRes = await fetch(`http://localhost:${serverPort}/api/accounts/${testTaxAccountId}/fund`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${DEFAULT_API_KEY}`,
      },
      body: JSON.stringify({
        method: "FIAT_CARD_ONRAMP",
        amountUsdc: 1500.0,
        userEmail: "tax@acmeglobal.com",
      }),
    });
    const postData = (await postRes.json()) as any;
    assert.strictEqual(postRes.status, 200);
    assert.strictEqual(postData.data.amountUsdc, 1500.0);
    assert.ok(postData.data.checkoutUrl);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // PART 5: TOOL REGISTRY LLM FUNCTION CALLS
  // ─────────────────────────────────────────────────────────────────────────────
  it("Step 15: ToolRegistry executes configure_liability_payment_method tool", async () => {
    const res = await toolRegistry.executeTool("configure_liability_payment_method", {
      companyId: testCompanyId,
      vendorId: testVendorAch,
      preferredRail: "FIAT_PAYOUT",
      preferredSubMethod: "ACH",
      fiatDetails: {
        accountHolderName: "Hudson Yards Properties",
        ibanOrAccountNumber: "9876543210",
        routingOrSwift: "021000021",
        bankName: "JPMorgan Chase",
      },
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.data.preferredRail, "FIAT_PAYOUT");
    assert.strictEqual(res.data.preferredSubMethod, "ACH");
  });

  it("Step 16: ToolRegistry executes execute_manual_disbursal tool", async () => {
    const res = await toolRegistry.executeTool("execute_manual_disbursal", {
      companyId: testCompanyId,
      sourceAccountId: testOperatingAccountId,
      vendorId: testVendorVault,
      vendorName: "Hardware Vendor",
      amountUsdc: 100.0,
      paymentRail: "DISBURSAL_VAULT",
      cryptoDetails: {
        walletAddress: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      },
      declaredReason: "ToolRegistry automated manual disbursal test",
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.data.status, "EXECUTED");
    assert.strictEqual(res.data.rail, "DISBURSAL_VAULT");
  });

  it("Step 17: ToolRegistry executes get_account_funding_options and fund_treasury_account tools", async () => {
    // 17A: get_account_funding_options
    const optionsRes = await toolRegistry.executeTool("get_account_funding_options", {
      accountId: testYieldAccountId,
    });
    assert.strictEqual(optionsRes.success, true);
    assert.strictEqual(optionsRes.data.accountId, testYieldAccountId);

    // 17B: fund_treasury_account
    const fundRes = await toolRegistry.executeTool("fund_treasury_account", {
      accountId: testYieldAccountId,
      method: "FIAT_FEDWIRE",
      amountUsdc: 100000.0,
    });
    assert.strictEqual(fundRes.success, true);
    assert.strictEqual(fundRes.data.method, "FIAT_FEDWIRE");
    assert.ok(fundRes.data.trackingMemo);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // PART 6: CORE SYSTEMIC UNIFICATION (ONBOARDING, CRUD & STATE MACHINES)
  // ─────────────────────────────────────────────────────────────────────────────
  it("Step 18: OnboardingWizardService Step 5 accepts FIAT_PAYOUT & activateOrganization provisions bank/preferences", async () => {
    const wizard = new OnboardingWizardService();
    const testOnboardingCo = `onboard_corp_${Date.now()}`;
    const session = await wizard.createSession({
      companyId: testOnboardingCo,
      entryPath: "MANUAL",
    });

    // Step 1: Profile
    await wizard.saveStepDraft(session.sessionId, 1, { companyName: "Onboard Corp" });
    // Step 4: Accounts
    await wizard.saveStepDraft(session.sessionId, 4, {
      accounts: [
        { accountId: `acc_${testOnboardingCo}_ops`, name: "Ops", role: "TREASURY_RESERVE" },
      ],
    });
    // Step 5: Liabilities with FIAT_PAYOUT (Push-to-Card debit card)
    const step5Session = await wizard.saveStepDraft(session.sessionId, 5, {
      liabilities: [
        {
          title: "Contractor Payout",
          accountId: `acc_${testOnboardingCo}_ops`,
          vendorId: `vend_card_${testOnboardingCo}`,
          vendorName: "Freelance Designer",
          amountUsdc: 250.0,
          preferredPaymentRail: "FIAT_PAYOUT",
          preferredSubMethod: "PUSH_TO_CARD",
          fiatDetails: {
            accountHolderName: "Freelance Designer",
            ibanOrAccountNumber: "4111111111111111",
            routingOrSwift: "CARD_OCT",
            cardToken: "tok_debit_card_9999",
            cardLast4: "1111",
            cardNetwork: "VISA",
          },
        },
      ],
    });

    assert.strictEqual(step5Session.draftPayload.step5_liabilities.length, 1);
    assert.strictEqual(step5Session.draftPayload.step5_liabilities[0].preferredPaymentRail, "FIAT_PAYOUT");
    assert.strictEqual(step5Session.draftPayload.step5_liabilities[0].preferredSubMethod, "PUSH_TO_CARD");

    // Activate organization
    const activation = await wizard.activateOrganization(session.sessionId);
    assert.strictEqual(activation.success, true);

    // Verify bank account was provisioned in VendorBankRepo
    const bank = await VendorBankRepo.getVerifiedBankAccount(`vend_card_${testOnboardingCo}`);
    assert.ok(bank);
    assert.strictEqual(bank.payment_sub_method, "PUSH_TO_CARD");
    assert.strictEqual(bank.card_last4, "1111");

    // Verify preferences were provisioned in VendorPaymentPreferenceRepo
    const pref = await VendorPaymentPreferenceRepo.getPreference(`vend_card_${testOnboardingCo}`);
    assert.ok(pref);
    assert.strictEqual(pref.preferred_rail, "FIAT_PAYOUT");
    assert.strictEqual(pref.preferred_sub_method, "PUSH_TO_CARD");
  });

  it("Step 19: LiabilityManagementService creates and updates liabilities with multi-modal preferences", async () => {
    const liabMgmt = new LiabilityManagementService();
    const vendorId = `vend_mgmt_${Date.now()}`;

    // Create liability with ACH Fiat details
    const created = await liabMgmt.createLiability(testCompanyId, {
      accountId: testOperatingAccountId,
      vendorId,
      vendorName: "Enterprise SaaS Landlord",
      title: "HQ Office Rent",
      category: "SAAS",
      amountUsdc: 3000.0,
      dueDate: new Date(Date.now() + 7 * 86400 * 1000),
      preferredPaymentRail: "FIAT_PAYOUT",
      preferredSubMethod: "ACH",
      fiatDetails: {
        accountHolderName: "HQ Office Landlord",
        ibanOrAccountNumber: "3322110099",
        routingOrSwift: "021000018",
        bankName: "Wells Fargo",
      },
    });

    assert.ok(created.liability_id);
    assert.strictEqual(created.preferred_payment_rail, "FIAT_PAYOUT");
    assert.strictEqual(created.payment_rail_config?.subMethod, "ACH");

    // Verify preference was recorded
    const prefBefore = await VendorPaymentPreferenceRepo.getPreference(vendorId);
    assert.ok(prefBefore);
    assert.strictEqual(prefBefore.preferred_rail, "FIAT_PAYOUT");

    // Update liability to switch to crypto session keys
    const updated = await liabMgmt.updateLiability(testCompanyId, created.liability_id, {
      preferredPaymentRail: "MODULAR_SESSION_KEY",
      cryptoDetails: {
        walletAddress: "0x3333333333333333333333333333333333333333",
        sessionKeyId: `sess_${vendorId}`,
      },
    });

    assert.strictEqual(updated.preferred_payment_rail, "MODULAR_SESSION_KEY");
    const prefAfter = await VendorPaymentPreferenceRepo.getPreference(vendorId);
    assert.ok(prefAfter);
    assert.strictEqual(prefAfter.preferred_rail, "MODULAR_SESSION_KEY");
  });

  it("Step 20: UniversalPaymentRouter auto-resolves VendorPaymentPreferenceRepo and executes seamlessly", async () => {
    const router = new UniversalPaymentRouter();
    const vendorAutoPref = `vend_autopref_${Date.now()}`;

    // Set preference in registry as FIAT_PAYOUT with Push-to-Card details
    const bank = await VendorBankRepo.createBankAccount({
      vendor_id: vendorAutoPref,
      account_holder_name: "Instant Contractor",
      iban_account_number: "4222222222222222",
      routing_swift: "CARD_OCT",
      payment_sub_method: "PUSH_TO_CARD",
      card_last4: "2222",
      card_token: "tok_auto_card",
      card_network: "VISA",
      is_verified: true,
      verified_by_admin: "ADMIN",
    });

    await VendorPaymentPreferenceRepo.setPreference({
      vendor_id: vendorAutoPref,
      preferred_rail: "FIAT_PAYOUT",
      preferred_sub_method: "PUSH_TO_CARD",
      bank_account_id: bank.bank_account_id,
    });

    // Execute via UniversalPaymentRouter WITHOUT passing beneficiaryBank in intent
    const result = await router.routeAndExecute({
      intent: {
        intentId: `AUTOPREF_${Date.now()}`,
        primaryAccountId: testOperatingAccountId,
        vendorId: vendorAutoPref,
        vendorName: "Instant Contractor",
        amountUsdc: 150.0,
        declaredReason: "Automatic preference resolution test",
      },
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.rail, "FIAT_PAYOUT");
    assert.strictEqual(result.subMethod, "PUSH_TO_CARD");
    assert.ok(result.cardPayoutRef);
  });

  it("Step 21: AdHocPaymentStateMachine executes real disbursal through ManualDisbursalService without mock hashes", async () => {
    const adHocMachine = new AdHocPaymentStateMachine();

    const adHocResult = await adHocMachine.processPayment({
      companyId: testCompanyId,
      requestedAccountId: testOperatingAccountId,
      amountUsdc: 75.0,
      reason: "Urgent vendor reimbursement",
      paymentRail: "FIAT_PAYOUT",
      beneficiaryBank: {
        accountHolderName: "Rapid Reimbursed Employee",
        ibanOrAccountNumber: "4333333333333333",
        routingOrSwift: "CARD_OCT",
        cardToken: "tok_employee_card",
        cardLast4: "3333",
        cardNetwork: "MASTERCARD",
      },
    });

    assert.strictEqual(adHocResult.success, true);
    assert.strictEqual(adHocResult.currentState, "WITNESSED_AND_COMPLETED");
    assert.strictEqual(adHocResult.data.rail, "FIAT_PAYOUT");
    assert.strictEqual(adHocResult.data.subMethod, "PUSH_TO_CARD");
    assert.ok(adHocResult.data.cardPayoutRef);
    assert.ok(adHocResult.data.txHash);
    // Real Arc Burn Tx Hash (not Date.now() mock)
    assert.ok(adHocResult.data.txHash.length > 20);
  });

  it("Step 22: Circle Mint webhook deposit reconciles deposit and triggers yield recalculation", async () => {
    const webhookRes = await fetch(`http://localhost:${serverPort}/api/webhooks/circle-mint`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${DEFAULT_API_KEY}`,
      },
      body: JSON.stringify({
        type: "payments.paid",
        accountId: testOperatingAccountId,
        amountUsdc: "5000.00",
        trackingMemo: `BIZARC-MINT-${testOperatingAccountId}-WHKTEST`,
      }),
    });

    assert.strictEqual(webhookRes.status, 200);
    const data = await webhookRes.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.status, "DEPOSIT_RECONCILED");
    assert.strictEqual(data.amountUsdc, 5000.0);
  });
});
