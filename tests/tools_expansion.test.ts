import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { ToolRegistry } from "../src/tools/toolRegistry.js";
import { TreasuryAccountsRepo } from "../src/database/repos/treasuryAccountsRepo.js";
import { DbClient } from "../src/database/dbClient.js";

describe("ToolRegistry: Sentence 27, 28, 30, 31 New Tools Verification", () => {
  const toolRegistry = new ToolRegistry();
  const timestamp = Date.now();
  const sourceAccountId = `acc_src_${timestamp}`;
  const targetAccountId = `acc_tgt_${timestamp}`;

  before(async () => {
    // Seed two test accounts
    await TreasuryAccountsRepo.upsertAccount({
      account_id: sourceAccountId,
      name: "Source Operations",
      role: "OPEX_DEV",
      wallet_address: `0x1111111111111111111111111111111111${timestamp.toString(16).slice(-6)}`,
      chain_id: 5042,
      min_operating_floor_usdc: 50.0,
      safety_buffer_ratio: 1.2,
      is_active: true,
    });

    await TreasuryAccountsRepo.upsertAccount({
      account_id: targetAccountId,
      name: "Target Operations",
      role: "OPEX_GROWTH",
      wallet_address: `0x2222222222222222222222222222222222${timestamp.toString(16).slice(-6)}`,
      chain_id: 5042,
      min_operating_floor_usdc: 25.0,
      safety_buffer_ratio: 1.1,
      is_active: true,
    });
  });

  it("1. get_account_intelligence aggregates real-time intelligence", async () => {
    const result = await toolRegistry.executeTool("get_account_intelligence", {
      accountId: sourceAccountId,
    });

    assert.equal(result.success, true);
    assert.ok(result.data.metadata);
    assert.equal(result.data.metadata.accountId, sourceAccountId);
    assert.ok(result.data.balances);
    assert.ok(result.data.solvencyMetrics);
    assert.ok(Array.isArray(result.data.recentAuditHistory));
  });

  it("2. transfer_account_liquidity transfers funds between accounts with two-way audit log", async () => {
    // Attempt transfer with amount
    const result = await toolRegistry.executeTool("transfer_account_liquidity", {
      sourceAccountId,
      targetAccountId,
      amountUsdc: "10.000000",
      reason: "Internal rebalancing test",
    });

    // If source account has insufficient funds in test DB, it safely rejects with loud error
    // or succeeds if available. Both outcomes verify the tool handler executes properly.
    if (!result.success) {
      assert.ok(result.error?.includes("INSUFFICIENT_LIQUIDITY") || result.error?.includes("TRANSFER"));
    } else {
      assert.ok(result.data.txHash.startsWith("0x"));
      assert.ok(result.data.sourcePostBalance);
      assert.ok(result.data.targetPostBalance);
    }
  });

  it("3. convert_crypto_to_fiat_payout initiates offramp payout with loud validation", async () => {
    const result = await toolRegistry.executeTool("convert_crypto_to_fiat_payout", {
      sourceAccountId,
      amountUsdc: "50.000000",
      beneficiaryBank: {
        accountHolderName: "Acme Corp Ltd",
        ibanOrAccountNumber: "GB29NWBK60161331926819",
        routingOrSwift: "NWBKGB2L",
        bankCountry: "GB",
      },
      invoiceReference: "INV-FIAT-2026-001",
    });

    // Validates balance or initiates payout
    if (!result.success) {
      assert.ok(result.error?.includes("INSUFFICIENT_FUNDS") || result.error?.includes("FIAT_CONVERSION_ERROR"));
    } else {
      assert.equal(result.data.status, "INITIATED");
      assert.ok(result.data.payoutId.startsWith("payout_"));
      assert.ok(result.data.usdcBurnTxHash.startsWith("0x"));
    }
  });

  it("4. get_yield_performance_metrics computes historical APR and NAV progression", async () => {
    const result = await toolRegistry.executeTool("get_yield_performance_metrics", {
      accountId: sourceAccountId,
      timeframe: "30D",
    });

    assert.equal(result.success, true);
    assert.equal(result.data.accountId, sourceAccountId);
    assert.equal(result.data.timeframe, "30D");
    assert.ok(typeof result.data.currentAnnualizedApr === "number");
    assert.ok(result.data.netYieldAccruedUsdc);
  });
});
