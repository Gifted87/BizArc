import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { TokenSwapService } from "../src/services/tokenSwapService.js";
import { FiatFundingService } from "../src/services/fiatFundingService.js";
import { UniversalPaymentRouter } from "../src/payments/universalPaymentRouter.js";
import { ToolRegistry } from "../src/tools/toolRegistry.js";
import { DbClient } from "../src/database/dbClient.js";
import { AuthorizationGate, DEFAULT_ADMIN_PRIVATE_KEY } from "../src/security/authorizationGate.js";

describe("BizArc Token Swaps & Universal Fiat Rails Test Suite", () => {
  let tokenSwapService: TokenSwapService;
  let fiatFundingService: FiatFundingService;
  let universalRouter: UniversalPaymentRouter;
  let toolRegistry: ToolRegistry;

  const testAccountId = "OPEX_DEV";
  const testVendorId = "VEND_TRADITIONAL_LEGAL_01";

  before(async () => {
    tokenSwapService = new TokenSwapService();
    fiatFundingService = new FiatFundingService();
    universalRouter = new UniversalPaymentRouter();
    toolRegistry = new ToolRegistry();

    // Ensure database test fixtures
    await DbClient.query(`
      INSERT INTO treasury_accounts (account_id, name, role, wallet_address, min_operating_floor_usdc, is_active)
      VALUES ('${testAccountId}', 'Dev Ops Pool', 'OPEX_DEV', '0x9999999999999999999999999999999999999999', 500.000000, true)
      ON CONFLICT (account_id) DO UPDATE SET is_active = true;
    `);

    await DbClient.query(`
      INSERT INTO vendor_master_registry (vendor_id, name, verified_payout_address, verified_by_admin, last_verified_at, change_lock)
      VALUES ('${testVendorId}', 'Gunderson Dettmer LLP', '0x2222222222222222222222222222222222222222', 'CFO_ADMIN', NOW(), TRUE)
      ON CONFLICT (vendor_id) DO UPDATE SET verified_payout_address = EXCLUDED.verified_payout_address;
    `);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // PART 1: TOKEN CONVERSIONS & SWAPS
  // ─────────────────────────────────────────────────────────────────────────────
  it("Step 1: TokenSwapService estimates cross-chain token swap (USDT -> USDC)", async () => {
    const estimate = await tokenSwapService.estimateSwap({
      fromChain: "Ethereum",
      fromToken: "USDT",
      toChain: "Arc",
      toToken: "USDC",
      amount: "1000.000000",
      slippage: 0.005,
    });

    assert.strictEqual(estimate.fromChain, "Ethereum");
    assert.strictEqual(estimate.toChain, "Arc");
    assert.strictEqual(estimate.isCrossChain, true);
    assert.ok(parseFloat(estimate.estimatedToAmount) > 990);
    assert.ok(estimate.exchangeRate > 0.99);
    assert.strictEqual(estimate.slippagePercent, 0.5);
  });

  it("Step 2: TokenSwapService STRICTLY REJECTS USDC <-> NATIVE swap on Arc (Arc L1 Asset Duality Violation)", async () => {
    await assert.rejects(
      async () => {
        await tokenSwapService.estimateSwap({
          fromChain: "Arc",
          fromToken: "USDC",
          toChain: "Arc",
          toToken: "NATIVE",
          amount: "100.000000",
        });
      },
      (err: Error) => {
        return (
          err.message.includes("ArcAssetDualityViolationError") &&
          err.message.includes("NATIVE and USDC are the exact same asset")
        );
      }
    );
  });

  it("Step 3: TokenSwapService enforces max slippage policy and executes valid swap", async () => {
    // 3A. Slippage ceiling rejection
    const highSlippageResult = await tokenSwapService.executeSwap({
      accountId: testAccountId,
      fromChain: "Base",
      fromToken: "USDC",
      toChain: "Arc",
      toToken: "USDC",
      amount: "500.000000",
      slippage: 0.02, // 2% requested, max allowed is 1%
      maxSlippageLimit: 0.01,
    });

    assert.strictEqual(highSlippageResult.success, false);
    assert.strictEqual(highSlippageResult.status, "REJECTED_BY_POLICY");
    assert.ok(highSlippageResult.error?.includes("exceeds max company policy limit"));

    // 3B. Successful swap execution within tolerance
    const validSwapResult = await tokenSwapService.executeSwap({
      accountId: testAccountId,
      fromChain: "Arbitrum",
      fromToken: "USDT",
      toChain: "Arc",
      toToken: "USDC",
      amount: "250.000000",
      slippage: 0.005,
      declaredReason: "Convert Arbitrum reserves to Arc native liquidity",
    });

    assert.strictEqual(validSwapResult.success, true);
    assert.strictEqual(validSwapResult.status, "COMPLETED");
    assert.ok(validSwapResult.swapId.startsWith("swap_"));
    assert.ok(parseFloat(validSwapResult.toAmount) > 245);
    assert.ok(validSwapResult.sourceTxHash?.startsWith("0x"));
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // PART 2: UNIVERSAL PAYMENT LAYER - RAIL 5 FIAT PAYOUT
  // ─────────────────────────────────────────────────────────────────────────────
  it("Step 4: UniversalPaymentRouter rejects FIAT_PAYOUT when beneficiary bank details are missing", async () => {
    const unbankedVendorId = `VEND_NO_BANK_${Date.now()}`;
    const result = await universalRouter.routeAndExecute({
      intent: {
        intentId: `INT_FIAT_FAIL_${Date.now()}`,
        primaryAccountId: testAccountId,
        vendorId: unbankedVendorId,
        vendorName: "Unbanked Supplier Inc",
        amountUsdc: 250.0,
        declaredReason: "Legal services retainer payment",
      },
      overrideRail: "FIAT_PAYOUT",
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.status, "REJECTED_BY_POLICY");
    assert.ok(result.error?.includes("Beneficiary bank credentials incomplete"));
  });

  it("Step 5: UniversalPaymentRouter ESCALATES high-value FIAT_PAYOUT to Human SPRS", async () => {
    const highAmount = 4500.0; // Exceeds default $500 threshold
    const result = await universalRouter.routeAndExecute({
      intent: {
        intentId: `INT_FIAT_SPRS_${Date.now()}`,
        primaryAccountId: testAccountId,
        vendorId: testVendorId,
        vendorName: "Gunderson Dettmer LLP",
        amountUsdc: highAmount,
        declaredReason: "Commercial office lease monthly rent",
        beneficiaryBank: {
          accountHolderName: "Gunderson Dettmer LLP",
          ibanOrAccountNumber: "9876543210",
          routingOrSwift: "121000358",
          bankCountry: "US",
          bankName: "Wells Fargo Bank NA",
        },
      },
      overrideRail: "FIAT_PAYOUT",
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.status, "ESCALATE_TO_SPRS");
    assert.ok(result.sprsRequestId?.startsWith("SPRS_"));
    assert.ok(result.error !== undefined);
  });

  it("Step 6: UniversalPaymentRouter EXECUTES FIAT_PAYOUT with CFO EIP-712 approval signature", async () => {
    const intentId = `INT_FIAT_EXEC_${Date.now()}`;
    const amount = 2500.0;
    const sprsId = `SPRS_${intentId}`;

    // Generate EIP-712 Admin Signature from authorized admin key
    const adminSignature = await AuthorizationGate.createAdminSignature({
      permissionRequestId: sprsId,
      actionType: "UNIVERSAL_DISBURSAL_FIAT_PAYOUT",
      accountId: testAccountId,
      amountUsdc: amount.toFixed(6),
      privateKey: DEFAULT_ADMIN_PRIVATE_KEY,
    });

    const result = await universalRouter.routeAndExecute({
      intent: {
        intentId,
        primaryAccountId: testAccountId,
        vendorId: testVendorId,
        vendorName: "Gunderson Dettmer LLP",
        amountUsdc: amount,
        declaredReason: "Approved traditional legal retainer payment",
        beneficiaryBank: {
          accountHolderName: "Gunderson Dettmer LLP",
          ibanOrAccountNumber: "9876543210",
          routingOrSwift: "121000358",
          bankCountry: "US",
          bankName: "Wells Fargo Bank NA",
        },
      },
      overrideRail: "FIAT_PAYOUT",
      adminSignature,
      sprsRequestId: sprsId,
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.status, "EXECUTED");
    assert.strictEqual(result.rail, "FIAT_PAYOUT");
    assert.ok(result.txHash?.startsWith("0x"));
    assert.ok(result.fiatPayoutId?.startsWith("payout_"));
    assert.ok(result.estimatedArrivalTimestamp !== undefined);
    assert.ok(result.journalSequenceId !== undefined);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // PART 3: FIAT WALLET FUNDING
  // ─────────────────────────────────────────────────────────────────────────────
  it("Step 7: FiatFundingService generates on-ramp checkout session & verbatim CLI command", async () => {
    const session = await fiatFundingService.createFiatOnRampSession({
      accountId: testAccountId,
      amountUsdc: 5000.0,
      userEmail: "cfo@enterprise.io",
      chain: "ARC",
    });

    assert.strictEqual(session.accountId, testAccountId);
    assert.strictEqual(session.amountUsdc, 5000.0);
    assert.strictEqual(session.chain, "ARC");
    assert.ok(session.cliCommandVerbatim.includes("circle wallet fund --address"));
    assert.ok(session.cliCommandVerbatim.includes("--chain ARC --amount 5000.00 --token usdc --method fiat --open"));
    assert.ok(session.checkoutUrl.startsWith("https://checkout.circle.com/onramp"));
  });

  it("Step 8: FiatFundingService generates institutional Fedwire instructions with tracking memo", async () => {
    const wireInfo = await fiatFundingService.getFiatWireInstructions({
      accountId: testAccountId,
      currency: "USD",
    });

    assert.strictEqual(wireInfo.beneficiaryName, "Circle Internet Financial LLC");
    assert.strictEqual(wireInfo.routingNumber, "021000018");
    assert.ok(wireInfo.depositTrackingMemo.includes(`BIZARC-MINT-${testAccountId}`));
    assert.ok(wireInfo.instructions.includes(wireInfo.depositTrackingMemo));
  });

  it("Step 9: FiatFundingService reconciles confirmed fiat deposit and updates ledger", async () => {
    const reconciliation = await fiatFundingService.recordFiatDeposit({
      accountId: testAccountId,
      amountUsdc: 10000.0,
      depositReference: `WIRE_REF_${Date.now()}`,
      sourceBank: "JPMorgan Chase NA",
      senderName: "Acme Corp Treasury Holdings LLC",
    });

    assert.strictEqual(reconciliation.status, "CONFIRMED");
    assert.strictEqual(reconciliation.amountUsdc, 10000.0);
    assert.ok(reconciliation.txHash.startsWith("0x"));
    assert.ok(reconciliation.creditedBalanceUsdc >= 10000.0);
    assert.ok(reconciliation.journalSequenceId !== undefined);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // PART 4: TOOL REGISTRY INTEGRATION
  // ─────────────────────────────────────────────────────────────────────────────
  it("Step 10: ToolRegistry executes estimate_token_swap tool", async () => {
    const res = await toolRegistry.executeTool("estimate_token_swap", {
      fromChain: "Base",
      fromToken: "USDC",
      toChain: "Arc",
      toToken: "USDC",
      amount: "300.000000",
      slippage: 0.005,
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.data.fromAmount, "300.000000");
    assert.strictEqual(res.data.toChain, "Arc");
  });

  it("Step 11: ToolRegistry executes create_fiat_onramp_session tool", async () => {
    const res = await toolRegistry.executeTool("create_fiat_onramp_session", {
      accountId: testAccountId,
      amountUsdc: 1500.0,
      userEmail: "treasurer@acme.com",
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.data.amountUsdc, 1500.0);
    assert.ok(res.data.cliCommandVerbatim.includes("--method fiat --open"));
  });

  it("Step 12: ToolRegistry executes route_universal_payment with Rail 5 (FIAT_PAYOUT)", async () => {
    const res = await toolRegistry.executeTool("route_universal_payment", {
      primaryAccountId: testAccountId,
      vendorId: testVendorId,
      vendorName: "Gunderson Dettmer LLP",
      amountUsdc: 150.0, // Within autonomous threshold
      rail: "FIAT_PAYOUT",
      beneficiaryBank: {
        accountHolderName: "Gunderson Dettmer LLP",
        ibanOrAccountNumber: "9876543210",
        routingOrSwift: "121000358",
        bankCountry: "US",
      },
      reason: "Autonomous settlement of low-value traditional filing fee",
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.data.status, "EXECUTED");
    assert.strictEqual(res.data.rail, "FIAT_PAYOUT");
    assert.ok(res.data.fiatPayoutId !== undefined);
  });

  after(() => {
    setTimeout(() => process.exit(0), 100);
  });
});
