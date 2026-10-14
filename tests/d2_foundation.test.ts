import {
  ARC_CONSTANTS,
  ArcClientManager,
  UsdcService,
  LoudRoundingError,
  ArcAssetDualityViolationError,
  ViemWalletAdapter,
  AccountLockManager,
  DebounceEngine,
  WebhookHandler,
} from "../src/foundation/index.js";

console.log("=== Running D2 Arc + Wallet Foundation Tests ===");

// 1. Arc L1 Constants & Client
console.log("1. Verifying Arc L1 Configuration and Gas Floor...");
if (ARC_CONSTANTS.TESTNET.chainId !== 5042002) {
  throw new Error("Arc Testnet chain ID must be 5042002");
}
if (ARC_CONSTANTS.MAINNET.chainId !== 5042) {
  throw new Error("Arc Mainnet chain ID must be 5042");
}
if (ARC_CONSTANTS.MIN_GAS_FLOOR_WEI !== 20_000_000_000n) {
  throw new Error("Arc gas floor must be exactly 20 Gwei (20_000_000_000 wei)");
}

const gasFloor = ArcClientManager.enforceGasFloor(10_000_000_000n); // passes 10 Gwei
if (gasFloor.maxFeePerGas < 20_000_000_000n) {
  throw new Error("Arc gas floor enforcement failed to bump gas to >= 20 Gwei");
}
console.log(`✓ Arc gas floor enforced successfully: ${gasFloor.maxFeePerGas} wei (>= 20 Gwei)`);

// 2. USDC 6-decimal Math & Loud Rounding Refusal (Rule 5)
console.log("2. Verifying USDC 6-Decimal Math & Loud Rounding Refusal...");
const parsed = UsdcService.parseUsdc("100.500000");
if (parsed !== 100_500_000n) {
  throw new Error(`Expected 100500000n, got ${parsed}`);
}
const formatted = UsdcService.formatUsdc(parsed);
if (formatted !== "100.5") {
  throw new Error(`Expected '100.5', got '${formatted}'`);
}

// Test Loud Rounding Error on sub-cent micro-unit overflow (>6 decimals)
let threwLoudError = false;
try {
  UsdcService.parseUsdc("100.1234567"); // 7 decimals
} catch (err) {
  if (err instanceof LoudRoundingError) {
    threwLoudError = true;
  }
}
if (!threwLoudError) {
  throw new Error("Failed: UsdcService did not throw LoudRoundingError on precision overflow!");
}
console.log("✓ LoudRoundingError correctly raised on 7-decimal fractional precision");

// Test Arc Asset Duality Protection
let threwDualityError = false;
try {
  UsdcService.validateNotDuplicateAsset(
    ARC_CONSTANTS.USDC_PREDEPLOY,
    "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
  );
} catch (err) {
  if (err instanceof ArcAssetDualityViolationError) {
    threwDualityError = true;
  }
}
if (!threwDualityError) {
  throw new Error("Failed: UsdcService did not block duplicate native/ERC20 conversion!");
}
console.log("✓ Arc Asset Duality violation correctly prevented");

// 3. Wallet Foundation & Viem Adapter
console.log("3. Verifying ViemWalletAdapter Gas & Signing Setup...");
// Generate a deterministic test private key for validation
const testPrivKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as `0x${string}`;
const adapter = new ViemWalletAdapter(testPrivKey, "arcTestnet");
const signerAddress = adapter.getAddress();
if (!signerAddress.startsWith("0x")) {
  throw new Error("Invalid signer address");
}
console.log(`✓ ViemWalletAdapter initialized with address: ${signerAddress}`);

// 4. Account In-Flight Action Locks
console.log("4. Verifying AccountLockManager Concurrency Guard...");
const accountId = "acc_engineering";
AccountLockManager.clearAll();
const lock1 = AccountLockManager.acquireLock(accountId, "Sweep in flight");
if (!lock1) throw new Error("Should acquire lock 1");

const lock2 = AccountLockManager.acquireLock(accountId, "Disbursal in flight");
if (lock2) throw new Error("Should NOT acquire second lock while lock 1 active");

AccountLockManager.releaseLock(accountId);
const lock3 = AccountLockManager.acquireLock(accountId, "New transaction");
if (!lock3) throw new Error("Should acquire lock after release");
AccountLockManager.releaseLock(accountId);
console.log("✓ AccountLockManager concurrency control verified");

// 5. Debounce Engine & Origin Tagging
console.log("5. Verifying DebounceEngine & Internal Settlement Filtering...");
const debounce = new DebounceEngine(100); // 100ms for test speed
const internalVault = "0x1111111111111111111111111111111111111111" as `0x${string}`;
const internalOperatingAccount = "0x2222222222222222222222222222222222222222" as `0x${string}`;
debounce.registerInternalAddress(internalVault);
debounce.registerInternalAddress(internalOperatingAccount);

let internalSettlementFired = false;
debounce.ingestEvent(
  {
    accountId: "acc_engineering",
    from: internalVault,
    to: "0x2222222222222222222222222222222222222222" as `0x${string}`,
    amount: 50_000_000n,
    txHash: "0x123",
    blockNumber: 100n,
  },
  () => {
    throw new Error("Internal settlement must NOT trigger quiescent sweep callback!");
  },
  (evt) => {
    if (evt.isInternalSettlement) {
      internalSettlementFired = true;
    }
  }
);
if (!internalSettlementFired) {
  throw new Error("Failed to tag and route internal settlement event!");
}
console.log("✓ Internal settlement origin filtering verified (feedback loop suppressed)");

// Test external event debouncing
let externalQuiescentFired = false;
debounce.ingestEvent(
  {
    accountId: "acc_marketing",
    from: "0x9999999999999999999999999999999999999999" as `0x${string}`,
    to: "0x2222222222222222222222222222222222222222" as `0x${string}`,
    amount: 10_000_000n,
    txHash: "0x456",
    blockNumber: 101n,
  },
  (accId, events) => {
    if (accId === "acc_marketing" && events.length === 1) {
      externalQuiescentFired = true;
    }
  }
);

// 6. Webhook Handler
console.log("6. Verifying WebhookHandler Payload Parsing...");
const sampleWebhookJson = JSON.stringify({
  notificationId: "notif_001",
  type: "transactions.inbound",
  data: {
    id: "tx_12345",
    state: "COMPLETE",
    txHash: "0xabc123",
    amount: "150.00",
  },
  timestamp: "2026-10-01T04:00:00Z",
});
const parsedWebhook = WebhookHandler.parsePayload(sampleWebhookJson);
if (parsedWebhook.data.state !== "COMPLETE" || parsedWebhook.data.id !== "tx_12345") {
  throw new Error("Webhook payload parsing mismatch");
}
console.log("✓ Circle Webhook payload parsing verified");

// Wait for debounce timer
setTimeout(() => {
  if (!externalQuiescentFired) {
    throw new Error("Debounce quiescent callback failed to fire");
  }
  console.log("✓ Debounce sliding window callback verified");
  console.log("\n>>> ALL D0/D2 ARC + WALLET FOUNDATION TESTS PASSED! <<<");
  process.exit(0);
}, 200);
