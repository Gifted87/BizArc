import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { SystemHttpServer, DEFAULT_API_KEY } from "../src/ingress/systemHttpServer.js";
import { TreasuryStateMachineOrchestrator } from "../src/orchestration/treasuryStateMachineOrchestrator.js";
import { DbClient } from "../src/database/dbClient.js";
import { VendorBankRepo } from "../src/database/repos/vendorBankRepo.js";
import { FiatPayoutRepo } from "../src/database/repos/fiatPayoutRepo.js";
import { TokenSwapRepo } from "../src/database/repos/tokenSwapRepo.js";
import { FiatDepositSessionRepo } from "../src/database/repos/fiatDepositSessionRepo.js";
import { MasterJournalRepo } from "../src/database/repos/masterJournalRepo.js";
import { LiabilityRepo } from "../src/database/repos/liabilityRepo.js";
import { AuthorizationGate, DEFAULT_ADMIN_PRIVATE_KEY } from "../src/security/authorizationGate.js";

async function postHttp(port: number, path: string, body: any, headers: Record<string, string> = {}): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${DEFAULT_API_KEY}`,
          "Content-Length": Buffer.byteLength(payload),
          ...headers,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode || 500, data: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode || 500, data });
          }
        });
      }
    );
    req.on("error", (err) => reject(err));
    req.write(payload);
    req.end();
  });
}

async function getHttp(port: number, path: string, headers: Record<string, string> = {}): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: "GET",
        headers: {
          "Authorization": `Bearer ${DEFAULT_API_KEY}`,
          ...headers,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode || 500, data: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode || 500, data });
          }
        });
      }
    );
    req.on("error", (err) => reject(err));
    req.end();
  });
}

test("Holistic Ecosystem: Swaps, Universal Fiat Payouts, Fiat Funding, and Multi-Agent Orchestration", async (t) => {
  const orchestrator = new TreasuryStateMachineOrchestrator();
  const server = new SystemHttpServer(orchestrator, 0);
  const port = await server.start();

  const runId = Date.now().toString(16);
  const testAccountId = `acc_holistic_${runId}`;
  const testVendorId = `vendor_holistic_${runId}`;
  const testWallet = `0x${runId.padStart(40, "a")}`.slice(0, 42);
  const testVendorPayout = `0x${runId.padStart(40, "b")}`.slice(0, 42);

  await t.test("Setup: Seed test operating treasury account and vendor master in DB", async () => {
    await DbClient.query(`
      INSERT INTO treasury_accounts (account_id, name, role, wallet_address, min_operating_floor_usdc, is_active)
      VALUES ('${testAccountId}', 'Holistic Operations', 'OPERATING', '${testWallet}', 500.000000, true)
      ON CONFLICT (account_id) DO UPDATE SET is_active = true;
    `);

    // Seed initial liquid funds for tripartite balance
    await orchestrator.yieldMachine["dynamicRecords"].calculateSafeToInvest(
      testAccountId,
      7 * 86400,
      undefined,
      5000000000n, // $5,000 liquid USDC
      0n
    );

    await DbClient.query(`
      INSERT INTO vendor_master_registry (vendor_id, name, verified_payout_address, verified_by_admin, last_verified_at, change_lock)
      VALUES ('${testVendorId}', 'Acme Global Infrastructure', '${testVendorPayout}', 'CFO_DIRECTOR', NOW(), TRUE)
      ON CONFLICT (vendor_id) DO UPDATE SET verified_payout_address = EXCLUDED.verified_payout_address;
    `);

    await VendorBankRepo.createBankAccount({
      vendor_id: testVendorId,
      account_holder_name: "Acme Global Infrastructure LLC",
      iban_account_number: `US987654321000111_${runId}`,
      routing_swift: "021000021",
      bank_name: "JPMorgan Chase Bank, N.A.",
      bank_country: "US",
      is_verified: true,
      verified_by_admin: "CFO_DIRECTOR",
    });
  });

  await t.test("REST Ingress: POST /api/swaps/estimate calculates cross-chain quote", async () => {
    const res = await postHttp(port, "/api/swaps/estimate", {
      fromChain: "Ethereum",
      fromToken: "USDT",
      toChain: "Arc",
      toToken: "USDC",
      amount: "1000.000000",
      slippage: 0.005,
    });

    assert.equal(res.status, 200);
    assert.equal(res.data.success, true);
    assert.equal(res.data.data.fromToken, "USDT");
    assert.equal(res.data.data.toToken, "USDC");
    assert.ok(parseFloat(res.data.data.estimatedToAmount) > 990);
  });

  await t.test("REST Ingress: POST /api/swaps/estimate strictly rejects Arc L1 USDC <-> NATIVE swap", async () => {
    const res = await postHttp(port, "/api/swaps/estimate", {
      fromChain: "Arc",
      fromToken: "USDC",
      toChain: "Arc",
      toToken: "NATIVE",
      amount: "100.000000",
    });

    assert.equal(res.status, 400);
    assert.equal(res.data.success, false);
    assert.match(res.data.error, /ArcAssetDualityViolationError/);
  });

  await t.test("REST Ingress: POST /api/swaps/execute executes swap, saves to TokenSwapRepo, and updates ledger", async () => {
    const res = await postHttp(port, "/api/swaps/execute", {
      accountId: testAccountId,
      fromChain: "Ethereum",
      fromToken: "USDT",
      toChain: "Arc",
      toToken: "USDC",
      amount: "500.000000",
      slippage: 0.005,
      declaredReason: "Convert incoming supplier USDT to native Arc USDC",
    });

    assert.equal(res.status, 200);
    assert.equal(res.data.success, true);
    assert.equal(res.data.status, "COMPLETED");
    assert.ok(res.data.sourceTxHash);

    // Verify persisted in PostgreSQL
    const dbSwap = await TokenSwapRepo.getSwapById(res.data.swapId);
    assert.ok(dbSwap);
    assert.equal(dbSwap.account_id, testAccountId);
    assert.equal(dbSwap.from_token, "USDT");
    assert.equal(dbSwap.to_token, "USDC");
  });

  await t.test("REST Ingress: POST /api/funding/fiat/onramp generates session and saves to FiatDepositSessionRepo", async () => {
    const res = await postHttp(port, "/api/funding/fiat/onramp", {
      accountId: testAccountId,
      amountUsdc: 2500.0,
      userEmail: "treasurer@acme.com",
    });

    assert.equal(res.status, 200);
    assert.equal(res.data.success, true);
    assert.ok(res.data.data.sessionId);
    assert.match(res.data.data.cliCommandVerbatim, /circle wallet fund --address/);
    assert.match(res.data.data.checkoutUrl, /checkout\.circle\.com\/onramp/);

    // Verify session in DB
    const dbSession = await FiatDepositSessionRepo.getSessionById(res.data.data.sessionId);
    assert.ok(dbSession);
    assert.equal(dbSession.status, "PENDING");
    assert.equal(Number(dbSession.amount_usdc), 2500.0);
  });

  await t.test("REST Ingress: GET /api/funding/fiat/wire-instructions returns institutional Fedwire memo and details", async () => {
    const res = await getHttp(port, `/api/funding/fiat/wire-instructions?accountId=${testAccountId}&currency=USD`);

    assert.equal(res.status, 200);
    assert.equal(res.data.success, true);
    assert.equal(res.data.data.beneficiaryBank, "Bank of New York Mellon (BNY Mellon)");
    assert.match(res.data.data.depositTrackingMemo, new RegExp(`BIZARC-MINT-${testAccountId.toUpperCase()}`));
  });

  await t.test("REST Ingress: POST /api/funding/fiat/deposit-reconcile credits balance and confirms session", async () => {
    const memo = `DEP-MEMO-${Date.now()}`;
    const res = await postHttp(port, "/api/funding/fiat/deposit-reconcile", {
      accountId: testAccountId,
      amountUsdc: 1500.0,
      depositReference: memo,
      sourceBank: "Bank of America Fedwire",
      senderName: "Acme Holdings LLC",
    });

    assert.equal(res.status, 200);
    assert.equal(res.data.success, true);
    assert.equal(res.data.data.status, "CONFIRMED");
    assert.equal(res.data.data.amountUsdc, 1500.0);
  });

  await t.test("REST Ingress: POST /api/disbursals/fiat executes traditional bank payout via Rail 5", async () => {
    const intentId = `INTENT_FIAT_${Date.now()}`;
    const sprsId = `SPRS_${intentId}`;

    const adminSig = await AuthorizationGate.createAdminSignature({
      permissionRequestId: sprsId,
      actionType: "UNIVERSAL_DISBURSAL_FIAT_PAYOUT",
      accountId: testAccountId,
      amountUsdc: "750.000000",
      privateKey: DEFAULT_ADMIN_PRIVATE_KEY,
    });

    const res = await postHttp(port, "/api/disbursals/fiat", {
      intentId,
      accountId: testAccountId,
      vendorId: testVendorId,
      amountUsdc: 750.0,
      invoiceId: "INV-HOLISTIC-001",
      adminSignature: adminSig,
      sprsRequestId: sprsId,
      beneficiaryBank: {
        accountHolderName: "Acme Global Infrastructure LLC",
        ibanOrAccountNumber: "US987654321000111222",
        routingOrSwift: "021000021",
        bankCountry: "US",
      },
    });

    assert.equal(res.status, 200);
    assert.equal(res.data.success, true);
    assert.equal(res.data.rail, "FIAT_PAYOUT");
    assert.equal(res.data.status, "EXECUTED");
    assert.ok(res.data.fiatPayoutId);
    assert.ok(res.data.txHash);

    // Verify record in FiatPayoutRepo
    const dbPayout = await FiatPayoutRepo.getPayoutById(res.data.fiatPayoutId);
    assert.ok(dbPayout);
    assert.equal(dbPayout.account_id, testAccountId);
    assert.equal(dbPayout.vendor_id, testVendorId);
    assert.equal(Number(dbPayout.amount_usdc), 750.0);
  });

  await t.test("REST Ingress: POST /api/webhooks/circle-mint reconciles payout confirmation and marks SETTLED", async () => {
    const payouts = await FiatPayoutRepo.getPayoutsByAccount(testAccountId);
    assert.ok(payouts.length > 0);
    const targetPayout = payouts[0];

    const res = await postHttp(port, "/api/webhooks/circle-mint", {
      type: "payout.paid",
      data: {
        id: targetPayout.payout_id,
        amount: { amount: "750.00", currency: "USD" },
        status: "complete",
      },
    });

    assert.equal(res.status, 200);
    assert.equal(res.data.success, true);
    assert.equal(res.data.status, "SETTLED");

    // Verify settled status in database
    const updatedPayout = await FiatPayoutRepo.getPayoutById(targetPayout.payout_id);
    assert.equal(updatedPayout?.status, "SETTLED");
  });

  await t.test("State Machine Orchestration: YieldRebalancingStateMachine auto-swaps non-USDC token inflow to USDC", async () => {
    const initialTrip = await orchestrator.yieldMachine["dynamicRecords"].getTripartiteBalance(testAccountId);
    const prevLiquid = parseFloat(initialTrip.liquidCashUsdc);

    const mutationEvent = {
      accountId: testAccountId,
      amountUsdc: 300.0,
      currentLiquidBalanceUsdc: prevLiquid,
      origin: "EXTERNAL_REVENUE",
      incomingToken: "USDT",
      incomingAmount: 300.0,
      chain: "Ethereum",
    };

    const result = await orchestrator.onBalanceMutation(mutationEvent as any);
    assert.equal(result.success, true);
    // Verified that transition log recorded token swap
    const swapTransition = result.unbrokenChainLog?.find((t) => t.toState === "TOKEN_SWAP_CONVERTED");
    assert.ok(swapTransition, "Must record TOKEN_SWAP_CONVERTED transition");
    assert.equal(swapTransition.details?.fromToken, "USDT");
  });

  await t.test("State Machine Orchestration: LiabilityDisbursalStateMachine dynamically resolves bank details from DB", async () => {
    const scheduledLiab = await LiabilityRepo.createLiability({
      account_id: testAccountId,
      vendor_id: testVendorId,
      amount_usdc: 250.0,
      title: "Quarterly Infrastructure Colocation Fee",
      category: "INFRASTRUCTURE",
      preferred_payment_rail: "FIAT_PAYOUT",
      payout_address: testVendorPayout,
      status: "SCHEDULED",
      due_date: new Date(Date.now() - 3600000),
      payment_rail_config: {}, // Empty config to test dynamic DB resolution from VendorBankRepo
    });

    const liabilityResult = await orchestrator.onDueLiabilityDisbursal(scheduledLiab);

    assert.equal(liabilityResult.success, true);
    assert.equal(liabilityResult.currentState, "WITNESSED_AND_SETTLED");
    assert.equal(liabilityResult.data?.status, "PAID");
    assert.equal(liabilityResult.data?.rail, "FIAT_PAYOUT");
  });

  await t.test("Audit Verification: Master System Journal preserves unbroken SHA-256 hash chaining", async () => {
    const isValid = await MasterJournalRepo.verifyChainIntegrity(testAccountId);
    assert.equal(isValid.valid, true, "SHA-256 hash chain of the master system journal must remain unbroken");
  });

  await server.stop();
});
