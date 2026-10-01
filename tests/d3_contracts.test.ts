import {
  CentralTreasuryYieldVaultABI,
  CentralTreasuryYieldVaultBytecode,
  DisbursalVaultABI,
  DisbursalVaultBytecode,
  MockUSYCVaultABI,
  MockUSYCVaultBytecode,
  CentralTreasuryYieldVaultService,
  DisbursalVaultService,
} from "../src/contracts/index.js";
import { ViemWalletAdapter } from "../src/foundation/wallets/viemWalletAdapter.js";
import { recoverTypedDataAddress } from "viem";

console.log("=== Running D3 Smart Contract Foundation Tests ===");

// 1. Verify CentralTreasuryYieldVault Compilation & Interface
console.log("1. Verifying CentralTreasuryYieldVault ABI & Bytecode...");
if (!CentralTreasuryYieldVaultBytecode || CentralTreasuryYieldVaultBytecode.length < 100) {
  throw new Error("CentralTreasuryYieldVaultBytecode is missing or invalid");
}

const requiredYieldFunctions = [
  "registerAccount",
  "deregisterAccount",
  "sweepFromAccount",
  "recallForAccount",
  "getAccountAssets",
  "accountShares",
  "registeredAccounts",
  "totalVaultShares",
];

for (const fnName of requiredYieldFunctions) {
  const exists = CentralTreasuryYieldVaultABI.some(
    (item: any) => item.type === "function" && item.name === fnName
  );
  if (!exists) {
    throw new Error(`CentralTreasuryYieldVault is missing required function: ${fnName}`);
  }
}
console.log("✓ CentralTreasuryYieldVault interface verified (sweepFromAccount, recallForAccount, accountShares)");

// 2. Verify DisbursalVault Compilation & Interface
console.log("2. Verifying DisbursalVault ABI & Bytecode...");
if (!DisbursalVaultBytecode || DisbursalVaultBytecode.length < 100) {
  throw new Error("DisbursalVaultBytecode is missing or invalid");
}

const requiredDisbursalFunctions = [
  "setVendorApproval",
  "updateCaps",
  "executePayment",
  "refundExcess",
  "approvedVendors",
  "executedIdempotencyKeys",
  "perTxCap",
  "dailyCap",
  "eip712ApprovalThreshold",
];

for (const fnName of requiredDisbursalFunctions) {
  const exists = DisbursalVaultABI.some(
    (item: any) => item.type === "function" && item.name === fnName
  );
  if (!exists) {
    throw new Error(`DisbursalVault is missing required function: ${fnName}`);
  }
}
console.log("✓ DisbursalVault interface verified (allowlist, idempotency, EIP-712 guardrail)");

// 3. Verify MockUSYCVault ERC-4626 Compilation
console.log("3. Verifying MockUSYCVault ABI & Bytecode...");
if (!MockUSYCVaultBytecode || MockUSYCVaultBytecode.length < 100) {
  throw new Error("MockUSYCVaultBytecode is missing or invalid");
}
const requiredUsycFunctions = [
  "deposit",
  "withdraw",
  "redeem",
  "convertToAssets",
  "maxWithdraw",
  "accrueYield",
];
for (const fnName of requiredUsycFunctions) {
  const exists = MockUSYCVaultABI.some(
    (item: any) => item.type === "function" && item.name === fnName
  );
  if (!exists) {
    throw new Error(`MockUSYCVault is missing required ERC-4626 function: ${fnName}`);
  }
}
console.log("✓ MockUSYCVault ERC-4626 interface verified");

// 4. Test Service Encoding and Account ID Formatter
console.log("4. Testing CentralTreasuryYieldVaultService Encoding...");
const mockVaultAddr = "0x1111111111111111111111111111111111111111" as `0x${string}`;
const yieldService = new CentralTreasuryYieldVaultService(mockVaultAddr);
const formattedAccId = CentralTreasuryYieldVaultService.formatAccountId("acc_engineering");
if (formattedAccId.length !== 66 || !formattedAccId.startsWith("0x")) {
  throw new Error("Account ID formatting must return a 32-byte hex string");
}

const sweepCalldata = yieldService.encodeSweepFromAccount(
  "acc_engineering",
  "0x2222222222222222222222222222222222222222" as `0x${string}`,
  50_000_000n
);
if (!sweepCalldata.startsWith("0x") || sweepCalldata.length < 10) {
  throw new Error("Failed to encode sweepFromAccount calldata");
}
console.log("✓ CentralTreasuryYieldVault calldata encoding verified");

// 5. Test DisbursalVaultService Idempotency & EIP-712 Signing
console.log("5. Testing DisbursalVaultService EIP-712 Signatures & Idempotency Key...");
const mockDisbursalAddr = "0x3333333333333333333333333333333333333333" as `0x${string}`;
const disbursalService = new DisbursalVaultService(mockDisbursalAddr, 5042002);

const testVendor = "0x4444444444444444444444444444444444444444" as `0x${string}`;
const invoiceId = "INV-AWS-OCT-2026";
const amount = 100_000_000n; // $100.00 USDC

const idempotencyKey1 = DisbursalVaultService.generateIdempotencyKey(testVendor, invoiceId, amount);
const idempotencyKey2 = DisbursalVaultService.generateIdempotencyKey(testVendor, invoiceId, amount);
if (idempotencyKey1 !== idempotencyKey2) {
  throw new Error("Idempotency keys for identical parameters must match deterministically");
}
console.log(`✓ Deterministic Idempotency Key generated: ${idempotencyKey1}`);

// Construct EIP-712 Typed Message
const message = {
  permissionRequestId: DisbursalVaultService.formatRequestId("pr_req_001"),
  vendor: testVendor,
  amount,
  idempotencyKey: idempotencyKey1,
  nonce: 1n,
  deadline: BigInt(Math.floor(Date.now() / 1000) + 3600), // 1 hour expiry
};

const typedData = disbursalService.getEIP712TypedData(message);

// Sign with ViemWalletAdapter (Admin Approver)
const adminPrivateKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as `0x${string}`;
const adminWallet = new ViemWalletAdapter(adminPrivateKey, "arcTestnet");
const adminAddress = adminWallet.getAddress();

async function runSignatureTest() {
  const signature = await adminWallet.signTypedData(typedData);
  console.log(`✓ Generated EIP-712 admin authorization signature: ${signature.slice(0, 20)}...`);

  // Recover signer using Viem cryptographic verification
  const recoveredSigner = await recoverTypedDataAddress({
    domain: typedData.domain,
    types: typedData.types,
    primaryType: typedData.primaryType,
    message: typedData.message,
    signature,
  });

  if (recoveredSigner.toLowerCase() !== adminAddress.toLowerCase()) {
    throw new Error(
      `Recovered signer (${recoveredSigner}) does not match admin approver (${adminAddress})!`
    );
  }
  console.log(`✓ Cryptographic EIP-712 signature verification successful: matches admin approver (${adminAddress})`);

  // Encode executePayment calldata with the verified signature
  const executeCalldata = disbursalService.encodeExecutePayment({
    permissionRequestId: message.permissionRequestId,
    vendor: message.vendor,
    amount: message.amount,
    idempotencyKey: message.idempotencyKey,
    nonce: message.nonce,
    deadline: message.deadline,
    adminSignature: signature,
  });
  if (!executeCalldata.startsWith("0x")) {
    throw new Error("Failed to encode executePayment calldata");
  }
  console.log("✓ DisbursalVault executePayment calldata encoded with verified EIP-712 signature");

  console.log("\n>>> ALL D0/D3 SMART CONTRACT FOUNDATION TESTS PASSED! <<<");
}

runSignatureTest().catch((err) => {
  console.error(err);
  process.exit(1);
});
