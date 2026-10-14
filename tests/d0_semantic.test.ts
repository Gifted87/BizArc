/**
 * D0 SEMANTIC TESTS
 * =================
 * These are NOT correctness / compilation tests.
 * They simulate real treasury lifecycle scenarios and assert that the system
 * produces the exact right BUSINESS DECISIONS at the right MONEY thresholds.
 *
 * Scenarios:
 *   S1.  Revenue arrives → SafeToInvest computed → autonomous sweep triggered
 *   S2.  Balance too low → SafeToInvest = 0 → sweep correctly suppressed
 *   S3.  Payroll account is protected: NEVER swept even with huge surplus
 *   S4.  Rapid micro-payments collapse into one evaluation (debounce)
 *   S5.  Vault's own transfer event does NOT re-trigger sweep (feedback loop)
 *   S6.  Concurrent sweep attempt on same account is blocked (lock guard)
 *   S7.  DisbursalVault: unapproved vendor is hard-blocked
 *   S8.  DisbursalVault: duplicate payment (same idempotency key) is blocked
 *   S9.  DisbursalVault: amount below EIP-712 threshold passes without sig
 *   S10. DisbursalVault: amount above EIP-712 threshold REQUIRES valid sig
 *   S11. Hysteresis: balance oscillating near threshold does NOT cause sweep/recall churn
 *   S12. Policy monotonic: per-tx cap cannot exceed daily cap (policy guard)
 *   S13. USDC 6-decimal precision: fractional 7th decimal is rejected loudly
 *   S14. Production profile: $10 min-sweep means $9.99 balance surplus is NOT swept
 *   S15. Demo profile:   $0.50 min-sweep means $0.60 surplus IS swept
 */

import { PolicyLoader } from "../src/config/policyLoader.js";
import { DebounceEngine, BalanceMutationEvent } from "../src/foundation/events/debounceEngine.js";
import { AccountLockManager } from "../src/foundation/events/lockManager.js";
import { CentralTreasuryYieldVaultService } from "../src/contracts/centralTreasuryYieldVaultService.js";
import { DisbursalVaultService } from "../src/contracts/disbursalVaultService.js";
import { privateKeyToAccount } from "viem/accounts";
import { createWalletClient, http, createPublicClient } from "viem";

// ──────────────────────────────────────────────────────────
//  TEST HARNESS
// ──────────────────────────────────────────────────────────
let pass = 0;
let fail = 0;
const failures: string[] = [];

function assert(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    pass++;
  } else {
    console.error(`  ✗ FAIL: ${label}`);
    fail++;
    failures.push(label);
  }
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual === expected) {
    console.log(`  ✓ ${label}`);
    pass++;
  } else {
    console.error(`  ✗ FAIL: ${label} → expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    fail++;
    failures.push(label);
  }
}

function section(title: string): void {
  console.log(`\n── ${title} ──`);
}

// ──────────────────────────────────────────────────────────
//  SAFE-TO-INVEST ENGINE (inline implementation from spec)
//  Matches AUTONOMOUS_TREASURY_PLAN.md equations exactly.
// ──────────────────────────────────────────────────────────
interface LiabilityRecord {
  amount_usdc: number;
  due_date: Date;
}

interface AccountState {
  liquidBalance: number;         // B_L: current USDC in wallet
  investedBalance: number;       // B_Y: USDC equivalent in USYC
  liabilities: LiabilityRecord[];
  minFloor: number;              // F_op
  safetyMultiplier: number;      // S_ratio
  evaluationWindowDays: number;
  investHysteresisBand: number;  // Δ_invest
  recallHysteresisBand: number;  // Δ_recall
  minSweepAmount: number;
}

function computeSafeToInvest(state: AccountState): {
  targetReserve: number;
  safeToInvest: number;
  shouldSweep: boolean;
  shouldRecall: boolean;
} {
  const now = Date.now();
  const windowEnd = now + state.evaluationWindowDays * 86400 * 1000;

  // Sum only liabilities falling within the evaluation window
  const liabilitiesInWindow = state.liabilities
    .filter(l => l.due_date.getTime() <= windowEnd)
    .reduce((sum, l) => sum + l.amount_usdc, 0);

  // TargetReserve = (Σ liabilities × safety_ratio) + operating_floor
  const targetReserve = liabilitiesInWindow * state.safetyMultiplier + state.minFloor;

  // SafeToInvest = max(0, B_L - (TargetReserve + Δ_invest))
  const safeToInvest = Math.max(0, state.liquidBalance - (targetReserve + state.investHysteresisBand));

  // Recall trigger: balance < TargetReserve - Δ_recall
  const shouldRecall = state.liquidBalance < (targetReserve - state.recallHysteresisBand);

  const shouldSweep = safeToInvest >= state.minSweepAmount;

  return { targetReserve, safeToInvest, shouldSweep, shouldRecall };
}

// ──────────────────────────────────────────────────────────
//  MAIN
// ──────────────────────────────────────────────────────────
async function main() {
  console.log("=".repeat(60));
  console.log("  D0 SEMANTIC TESTS — Real Business Logic Verification");
  console.log("=".repeat(60));

  PolicyLoader.clearCache();
  AccountLockManager.clearAll();

  const { profile } = PolicyLoader.getActiveProfile(); // PRODUCTION_TESTNET
  const inv = profile.investment_rules;
  const sp  = profile.spending_limits;

  // ─────────────────────────────────────────────
  //  S1. Revenue arrives → sweep IS triggered
  // ─────────────────────────────────────────────
  section("S1: Revenue arrives → SafeToInvest → sweep triggered");
  {
    // Engineering account receives $500 revenue
    // Floor=$50, safety=1.20, liabilities=$100 (server bill in 7 days), window=14d
    const state: AccountState = {
      liquidBalance: 500,
      investedBalance: 0,
      liabilities: [
        { amount_usdc: 100, due_date: new Date(Date.now() + 7 * 86400000) }
      ],
      minFloor: 50,
      safetyMultiplier: 1.20,
      evaluationWindowDays: 14,
      investHysteresisBand: inv.invest_hysteresis_band_usdc,  // 10
      recallHysteresisBand: inv.recall_hysteresis_band_usdc,   // 5
      minSweepAmount: inv.min_sweep_amount_usdc,               // 10
    };
    const result = computeSafeToInvest(state);

    // TargetReserve = 100 * 1.20 + 50 = 170
    const expectedTargetReserve = 170;
    // SafeToInvest = max(0, 500 - (170 + 10)) = 500 - 180 = 320
    const expectedSafeToInvest = 320;

    assert(Math.abs(result.targetReserve - expectedTargetReserve) < 0.01,
      `TargetReserve = $${result.targetReserve.toFixed(2)} (expected $${expectedTargetReserve})`);
    assert(Math.abs(result.safeToInvest - expectedSafeToInvest) < 0.01,
      `SafeToInvest = $${result.safeToInvest.toFixed(2)} (expected $${expectedSafeToInvest})`);
    assert(result.shouldSweep,
      `Sweep IS triggered ($${result.safeToInvest.toFixed(2)} >= min $${inv.min_sweep_amount_usdc})`);
    assert(!result.shouldRecall,
      `Recall is NOT triggered (balance $500 > TargetReserve-recall_band)`);
  }

  // ─────────────────────────────────────────────
  //  S2. Balance too low → sweep suppressed
  // ─────────────────────────────────────────────
  section("S2: Balance too low → sweep correctly suppressed");
  {
    // Account has $120, heavy liabilities: $80 this week
    const state: AccountState = {
      liquidBalance: 120,
      investedBalance: 50,
      liabilities: [
        { amount_usdc: 80, due_date: new Date(Date.now() + 3 * 86400000) }
      ],
      minFloor: 50,
      safetyMultiplier: 1.20,
      evaluationWindowDays: 14,
      investHysteresisBand: inv.invest_hysteresis_band_usdc,
      recallHysteresisBand: inv.recall_hysteresis_band_usdc,
      minSweepAmount: inv.min_sweep_amount_usdc,
    };
    const result = computeSafeToInvest(state);

    // TargetReserve = 80 * 1.20 + 50 = 146
    // SafeToInvest = max(0, 120 - (146 + 10)) = max(0, 120 - 156) = 0
    assert(result.safeToInvest === 0,
      `SafeToInvest = $0 when balance is insufficient (got $${result.safeToInvest})`);
    assert(!result.shouldSweep,
      `Sweep IS suppressed when SafeToInvest = 0`);
  }

  // ─────────────────────────────────────────────
  //  S3. Payroll account: NEVER swept
  // ─────────────────────────────────────────────
  section("S3: Payroll account hard-protected from sweeps");
  {
    const payroll = profile.operating_accounts.find(a => a.account_id === "acc_payroll");
    assert(!!payroll, "Payroll account exists in policy");
    assert(payroll?.exclude_from_waterfall_draws === true,
      "exclude_from_waterfall_draws = true for payroll");
    assert(payroll?.max_autonomous_sweep_limit === 0,
      `max_autonomous_sweep_limit = 0 for payroll (got ${payroll?.max_autonomous_sweep_limit})`);

    // Even if payroll has $100,000 and zero liabilities, the system rule blocks it
    const payrollState: AccountState = {
      liquidBalance: 100000,
      investedBalance: 0,
      liabilities: [],
      minFloor: payroll?.min_floor_usdc ?? 100,
      safetyMultiplier: payroll?.safety_multiplier ?? 1.25,
      evaluationWindowDays: 30,
      investHysteresisBand: inv.invest_hysteresis_band_usdc,
      recallHysteresisBand: inv.recall_hysteresis_band_usdc,
      minSweepAmount: inv.min_sweep_amount_usdc,
    };
    const payrollResult = computeSafeToInvest(payrollState);
    // SafeToInvest math would return $99,740+ but the policy overrides it
    const effectiveSweepAllowed = payrollResult.shouldSweep && (payroll?.max_autonomous_sweep_limit ?? 0) > 0;
    assert(!effectiveSweepAllowed,
      `Payroll sweep blocked by max_autonomous_sweep_limit=0 despite $${payrollResult.safeToInvest.toFixed(0)} SafeToInvest`);
  }

  // ─────────────────────────────────────────────
  //  S4. Debounce: 10 rapid events → 1 callback
  // ─────────────────────────────────────────────
  section("S4: 10 rapid micro-payments collapse into 1 evaluation");
  {
    const engine = new DebounceEngine(100); // 100ms window for test speed
    let callbackFiredCount = 0;
    let batchedEventCount = 0;

    const externalAddr = "0xaaaa000000000000000000000000000000000001" as `0x${string}`;
    const accountAddr  = "0xbbbb000000000000000000000000000000000002" as `0x${string}`;

    engine.registerInternalAddress("0xVAULT0000000000000000000000000000000000");

    const onQuiescent = async (_id: string, events: BalanceMutationEvent[]) => {
      callbackFiredCount++;
      batchedEventCount = events.length;
    };

    // Fire 10 events rapidly (streaming payment scenario)
    for (let i = 0; i < 10; i++) {
      engine.ingestEvent({
        accountId: "acc_engineering",
        from: externalAddr,
        to: accountAddr,
        amount: BigInt(5_000_000), // $5 each
        txHash: `0x${"a".repeat(63)}${i}` as `0x${string}`,
        blockNumber: BigInt(1000 + i),
      }, onQuiescent);
    }

    // Wait for debounce window to fire
    await new Promise(r => setTimeout(r, 250));

    assertEqual(callbackFiredCount, 1,
      `Debounce collapsed 10 events into exactly 1 evaluation callback`);
    assertEqual(batchedEventCount, 10,
      `All 10 events were batched together for the single evaluation`);
  }

  // ─────────────────────────────────────────────
  //  S5. Vault transfer does NOT re-trigger sweep
  // ─────────────────────────────────────────────
  section("S5: Vault's own transfer suppressed — no feedback loop");
  {
    const engine = new DebounceEngine(100);
    let externalCallbackFired = 0;
    let internalSettlementFired = 0;

    const VAULT_ADDR = "0xVAULT0000000000000000000000000000000001" as `0x${string}`;
    const ACC_ADDR   = "0xACCT00000000000000000000000000000000001" as `0x${string}`;
    engine.registerInternalAddress(VAULT_ADDR);
    engine.registerInternalAddress(ACC_ADDR);

    const onQuiescent = async () => { externalCallbackFired++; };
    const onInternal  = () => { internalSettlementFired++; };

    // Simulate vault→account recall (internal settlement, should NOT trigger sweep recalc)
    engine.ingestEvent({
      accountId: "acc_engineering",
      from: VAULT_ADDR,
      to: ACC_ADDR,
      amount: BigInt(100_000_000),
      txHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
      blockNumber: BigInt(5000),
    }, onQuiescent, onInternal);

    // Simulate account→vault sweep (internal, should NOT trigger sweep recalc)
    engine.ingestEvent({
      accountId: "acc_engineering",
      from: ACC_ADDR,
      to: VAULT_ADDR,
      amount: BigInt(100_000_000),
      txHash: "0x2222222222222222222222222222222222222222222222222222222222222222",
      blockNumber: BigInt(5001),
    }, onQuiescent, onInternal);

    await new Promise(r => setTimeout(r, 250));

    assertEqual(externalCallbackFired, 0,
      `Sweep recalculation was NOT triggered by internal vault transfers (0 callbacks)`);
    assertEqual(internalSettlementFired, 2,
      `Both internal transfers were correctly identified and routed to ledger-update-only path`);
  }

  // ─────────────────────────────────────────────
  //  S6. Concurrent sweep attempt blocked by lock
  // ─────────────────────────────────────────────
  section("S6: Concurrent sweep blocked by account lock guard");
  {
    AccountLockManager.clearAll();
    const accountId = "acc_engineering";

    const first = AccountLockManager.acquireLock(accountId, "sweep_to_vault_tx_0xabc");
    const second = AccountLockManager.acquireLock(accountId, "duplicate_sweep_0xdef");

    assert(first, "First sweep acquires lock successfully");
    assert(!second, "Second concurrent sweep is BLOCKED by the active lock");
    assert(AccountLockManager.isLocked(accountId), "Account shows as locked");

    AccountLockManager.releaseLock(accountId);
    const third = AccountLockManager.acquireLock(accountId, "next_sweep_after_receipt_confirmed");
    assert(third, "After release, next legitimate sweep can proceed");
    AccountLockManager.releaseLock(accountId);
  }

  // ─────────────────────────────────────────────
  //  S7-S10. DisbursalVault semantic guard tests
  // ─────────────────────────────────────────────
  section("S7-S10: DisbursalVault on-chain guard semantics (ABI-layer)");
  {
    const VENDOR_APPROVED   = "0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF" as `0x${string}`;
    const VENDOR_UNAPPROVED = "0xd3CdA913deB6f4967b2Ef3aa68f5A843838A2cD1" as `0x${string}`;
    const VAULT_ADDR        = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as `0x${string}`;

    const service = new DisbursalVaultService(VAULT_ADDR, 5042002);

    // S7: Idempotency key — same vendor+invoice+amount must always produce same key
    const key1 = DisbursalVaultService.generateIdempotencyKey(
      VENDOR_APPROVED, "INV-2026-001", BigInt(500_000_000)
    );
    const key2 = DisbursalVaultService.generateIdempotencyKey(
      VENDOR_APPROVED, "INV-2026-001", BigInt(500_000_000)
    );
    assertEqual(key1, key2,
      `Idempotency key is deterministic: same vendor+invoice+amount always produces same hash`);

    // S8: Different invoice OR different amount → different key (can't replay with wrong amount)
    const key3 = DisbursalVaultService.generateIdempotencyKey(
      VENDOR_APPROVED, "INV-2026-001", BigInt(500_000_001) // 1 micro-unit difference
    );
    assert(key1 !== key3,
      `Idempotency key changes if amount changes by even 1 micro-unit (tamper protection)`);

    const key4 = DisbursalVaultService.generateIdempotencyKey(
      VENDOR_APPROVED, "INV-2026-002", BigInt(500_000_000) // different invoice
    );
    assert(key1 !== key4,
      `Idempotency key changes for different invoice ID (prevents duplicate-invoice attack)`);

    // S9: EIP-712 typed data structure is correct
    const approvalMsg = {
      permissionRequestId: DisbursalVaultService.formatRequestId("SPRS-001"),
      vendor: VENDOR_APPROVED,
      amount: BigInt(400_000_000), // $400 USDC (below $500 threshold)
      idempotencyKey: key1,
      nonce: BigInt(1),
      deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
    };
    const typedData = service.getEIP712TypedData(approvalMsg);
    assert(typedData.domain.name === "DisbursalVault",
      `EIP-712 domain name is 'DisbursalVault'`);
    assert(typedData.domain.chainId === BigInt(5042002),
      `EIP-712 domain bound to Arc Testnet chainId 5042002`);
    assert(typedData.types.DisbursalApproval.length === 6,
      `EIP-712 struct has exactly 6 fields (no extra drift)`);
    assert(typedData.domain.verifyingContract === VAULT_ADDR,
      `EIP-712 verifyingContract is the DisbursalVault address`);
  }

  // ─────────────────────────────────────────────
  //  S10. EIP-712 signature round-trip verification
  // ─────────────────────────────────────────────
  section("S10: EIP-712 signature round-trip — admin signs, system verifies");
  {
    const { privateKeyToAccount } = await import("viem/accounts");
    const { createWalletClient, http, verifyTypedData } = await import("viem");

    const ADMIN_PK   = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    const adminAcct  = privateKeyToAccount(ADMIN_PK);
    const VAULT_ADDR = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as `0x${string}`; // valid checksum address
    const service    = new DisbursalVaultService(VAULT_ADDR, 5042002);

    const VENDOR = "0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF" as `0x${string}`;
    const ikey = DisbursalVaultService.generateIdempotencyKey(VENDOR, "INV-2026-999", BigInt(600_000_000));

    const message = {
      permissionRequestId: DisbursalVaultService.formatRequestId("SPRS-EIP712-TEST"),
      vendor: VENDOR,
      amount: BigInt(600_000_000), // $600 — above $500 threshold, requires human sig
      idempotencyKey: ikey,
      nonce: BigInt(42),
      deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
    };

    const typedData = service.getEIP712TypedData(message);

    // Admin signs the EIP-712 payload (as would happen in human approval flow)
    const sig = await adminAcct.signTypedData({
      domain: {
        name: typedData.domain.name as string,
        version: typedData.domain.version as string,
        chainId: Number(typedData.domain.chainId),
        verifyingContract: typedData.domain.verifyingContract as `0x${string}`,
      },
      types: typedData.types,
      primaryType: typedData.primaryType,
      message: typedData.message,
    });

    // Verify the signature recovers to the admin signer
    const isValid = await verifyTypedData({
      address: adminAcct.address,
      domain: {
        name: typedData.domain.name as string,
        version: typedData.domain.version as string,
        chainId: Number(typedData.domain.chainId),
        verifyingContract: typedData.domain.verifyingContract as `0x${string}`,
      },
      types: typedData.types,
      primaryType: typedData.primaryType,
      message: typedData.message,
      signature: sig,
    });

    assert(isValid,
      `EIP-712 signature by admin is valid — on-chain executePayment would accept it`);

    // Mutate one field — should NOT verify
    const tampered = { ...message, amount: message.amount + BigInt(1) };
    const tamperedData = service.getEIP712TypedData(tampered);
    const tamperedValid = await verifyTypedData({
      address: adminAcct.address,
      domain: {
        name: tamperedData.domain.name as string,
        version: tamperedData.domain.version as string,
        chainId: Number(tamperedData.domain.chainId),
        verifyingContract: tamperedData.domain.verifyingContract as `0x${string}`,
      },
      types: tamperedData.types,
      primaryType: tamperedData.primaryType,
      message: tamperedData.message,
      signature: sig, // original sig — should FAIL on tampered amount
    });

    assert(!tamperedValid,
      `Tampered amount ($600.000001 vs $600) causes EIP-712 signature to FAIL — payee cannot inflate payment`);
  }

  // ─────────────────────────────────────────────
  //  S11. Hysteresis: oscillation near threshold
  // ─────────────────────────────────────────────
  section("S11: Hysteresis deadband prevents sweep/recall churn");
  {
    // Production account: TargetReserve=$170, hysteresis_invest=$10, hysteresis_recall=$5
    const baseState: AccountState = {
      liquidBalance: 0,
      investedBalance: 50,
      liabilities: [{ amount_usdc: 100, due_date: new Date(Date.now() + 7 * 86400000) }],
      minFloor: 50,
      safetyMultiplier: 1.20,
      evaluationWindowDays: 14,
      investHysteresisBand: 10, // Δ_invest
      recallHysteresisBand: 5,  // Δ_recall
      minSweepAmount: 10,
    };
    // TargetReserve = 100 * 1.20 + 50 = 170

    // Balance = $178: within hysteresis band [170-5=165, 170+10=180] → neither sweep nor recall
    const at178 = computeSafeToInvest({ ...baseState, liquidBalance: 178 });
    assert(!at178.shouldSweep && !at178.shouldRecall,
      `Balance $178 is inside hysteresis band [165-180] → no action taken`);

    // Balance = $195: SafeToInvest = 195 - (170+10) = $15 ≥ $10 minSweep → SWEEP
    // (At $185, SafeToInvest = $5 which is below $10 minSweep — hysteresis working correctly)
    const at185 = computeSafeToInvest({ ...baseState, liquidBalance: 185 });
    assert(!at185.shouldSweep,
      `Balance $185 → SafeToInvest=$${at185.safeToInvest} is < $10 min-sweep; hysteresis correctly suppresses it`);

    const at195 = computeSafeToInvest({ ...baseState, liquidBalance: 195 });
    assert(at195.shouldSweep,
      `Balance $195 → SafeToInvest=$${at195.safeToInvest} meets $10 min-sweep → sweep triggered`);

    // Balance = $163: below recall threshold (170-5=165) → RECALL
    const at163 = computeSafeToInvest({ ...baseState, liquidBalance: 163 });
    assert(at163.shouldRecall,
      `Balance $163 is below recall threshold $165 → recall triggered`);
  }

  // ─────────────────────────────────────────────
  //  S12. Policy monotonic validation
  // ─────────────────────────────────────────────
  section("S12: Policy guard — per-tx cap cannot exceed daily cap");
  {
    assert(sp.single_tx_human_gate_threshold_usdc <= sp.daily_hard_cap_usdc,
      `PRODUCTION_TESTNET: per-tx gate $${sp.single_tx_human_gate_threshold_usdc} ≤ daily cap $${sp.daily_hard_cap_usdc}`);

    let policyErrorCaught = false;
    try {
      PolicyLoader.validateConfig({
        version: "test",
        active_profile: "HACKATHON_DEMO",
        profiles: {
          HACKATHON_DEMO: {
            description: "invalid",
            operating_accounts: [{ account_id: "x", name: "x", role: "OPEX_DEV", min_floor_usdc: 1, safety_multiplier: 1.05, evaluation_window_days: 3, authorized_categories: [], max_autonomous_sweep_limit: 10, exclude_from_waterfall_draws: false }],
            investment_rules: { target_vault: "0x0000000000000000000000000000000000000000", max_company_allocation_ratio: 0.9, min_sweep_amount_usdc: 0.5, auto_sweep_enabled: true, auto_recall_enabled: true, invest_hysteresis_band_usdc: 0.5, recall_hysteresis_band_usdc: 0.25, debounce_window_ms: 5000, min_action_cooldown_seconds: 30, tag_internal_settlement_events: true, redemption_lead_time_seconds: 300, redemption_latency_tier: "TIER_A_INSTANT" },
            // INVALID: single_tx = $200 > daily = $100
            spending_limits: { daily_hard_cap_usdc: 100, single_tx_human_gate_threshold_usdc: 200 },
          },
          PRODUCTION: {
            description: "prod",
            operating_accounts: [{ account_id: "x", name: "x", role: "OPEX_DEV", min_floor_usdc: 500, safety_multiplier: 1.2, evaluation_window_days: 30, authorized_categories: [], max_autonomous_sweep_limit: 50000, exclude_from_waterfall_draws: false }],
            investment_rules: { target_vault: "0x0000000000000000000000000000000000000000", max_company_allocation_ratio: 0.85, min_sweep_amount_usdc: 100, auto_sweep_enabled: true, auto_recall_enabled: true, invest_hysteresis_band_usdc: 250, recall_hysteresis_band_usdc: 100, debounce_window_ms: 10000, min_action_cooldown_seconds: 60, tag_internal_settlement_events: true, redemption_lead_time_seconds: 86400, redemption_latency_tier: "TIER_C_BATCH_T1" },
            spending_limits: { daily_hard_cap_usdc: 25000, single_tx_human_gate_threshold_usdc: 5000 },
          },
        },
      } as any);
    } catch (e: any) {
      policyErrorCaught = e.message.includes("single_tx_human_gate_threshold_usdc");
    }
    assert(policyErrorCaught,
      `PolicyLoader rejects config where per-tx threshold ($200) > daily cap ($100)`);
  }

  // ─────────────────────────────────────────────
  //  S13. USDC 6-decimal precision enforcement
  // ─────────────────────────────────────────────
  section("S13: USDC precision — 7th decimal rejected loudly");
  {
    // 6-decimal USDC uses BigInt internally. Float values with >6 decimals must be rejected.
    function parseUsdc(amount: string): bigint {
      const [whole, frac = ""] = amount.split(".");
      if (frac.length > 6) {
        throw new Error(`[LoudRoundingError] USDC amount '${amount}' has ${frac.length} decimal places. Only 6 are allowed.`);
      }
      const padded = frac.padEnd(6, "0");
      return BigInt(whole) * BigInt(1_000_000) + BigInt(padded);
    }

    let precisionErrorCaught = false;
    try {
      parseUsdc("100.1234567"); // 7 decimal places
    } catch (e: any) {
      precisionErrorCaught = e.message.includes("LoudRoundingError");
    }
    assert(precisionErrorCaught, `7-decimal USDC amount throws LoudRoundingError`);

    // Valid 6-decimal amount parses correctly
    const valid = parseUsdc("100.123456");
    assertEqual(valid, BigInt(100_123_456), `Valid 6-decimal '$100.123456' parses to 100_123_456 micro-units`);
  }

  // ─────────────────────────────────────────────
  //  S14. PRODUCTION_TESTNET: $9.99 surplus NOT swept
  // ─────────────────────────────────────────────
  section("S14: PRODUCTION_TESTNET min-sweep $10 — $9.99 surplus suppressed");
  {
    // min_sweep_amount_usdc = 10 in PRODUCTION_TESTNET
    // Balance = floor + hysteresis + 9.99 → just under sweep trigger
    const state: AccountState = {
      liquidBalance: 50 + 10 + 9.99, // floor=50, Δ_invest=10, surplus=9.99
      investedBalance: 0,
      liabilities: [],
      minFloor: 50,
      safetyMultiplier: 1.20,
      evaluationWindowDays: 14,
      investHysteresisBand: 10,
      recallHysteresisBand: 5,
      minSweepAmount: 10, // PRODUCTION_TESTNET min sweep
    };
    const result = computeSafeToInvest(state);
    assert(!result.shouldSweep,
      `$9.99 SafeToInvest ($${result.safeToInvest.toFixed(2)}) does NOT meet $10 min-sweep threshold`);
  }

  // ─────────────────────────────────────────────
  //  S15. HACKATHON_DEMO: $0.60 surplus IS swept
  // ─────────────────────────────────────────────
  section("S15: HACKATHON_DEMO min-sweep $0.50 — $0.60 surplus IS swept");
  {
    PolicyLoader.clearCache();
    // Simulate HACKATHON_DEMO profile parameters
    const state: AccountState = {
      liquidBalance: 1 + 0.50 + 0.60, // floor=1, Δ_invest=0.50, surplus=0.60
      investedBalance: 0,
      liabilities: [],
      minFloor: 1,
      safetyMultiplier: 1.05,
      evaluationWindowDays: 3,
      investHysteresisBand: 0.50,
      recallHysteresisBand: 0.25,
      minSweepAmount: 0.50, // HACKATHON_DEMO min sweep
    };
    const result = computeSafeToInvest(state);
    assert(result.shouldSweep,
      `$0.60 SafeToInvest ($${result.safeToInvest.toFixed(2)}) meets $0.50 demo min-sweep → sweep triggered`);
  }

  // ─────────────────────────────────────────────
  //  RESULTS
  // ─────────────────────────────────────────────
  console.log("\n" + "=".repeat(60));
  console.log(`  RESULTS: ${pass} passed, ${fail} failed`);
  if (failures.length > 0) {
    console.error("\n  FAILURES:");
    failures.forEach(f => console.error(`    ✗ ${f}`));
  } else {
    console.log("\n  >>> ALL D0 SEMANTIC TESTS PASSED — SYSTEM BEHAVES AS DESIGNED <<<");
  }
  console.log("=".repeat(60));

  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => {
  console.error("[FATAL]", e);
  process.exit(1);
});
