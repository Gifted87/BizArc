import { createWalletClient, http, publicActions, encodeDeployData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import {
  CentralTreasuryYieldVaultABI,
  CentralTreasuryYieldVaultBytecode,
  DisbursalVaultABI,
  DisbursalVaultBytecode,
  MockUSYCVaultABI,
  MockUSYCVaultBytecode,
} from "../src/contracts/artifacts.js";
import { ARC_CONSTANTS } from "../src/foundation/arc/constants.js";

dotenv.config();

async function main() {
  console.log("=== Deploying BizArc Smart Contracts to Arc Testnet ===");

  const privateKey =
    (process.env.BIZARC_EXECUTOR_PRIVATE_KEY as `0x${string}` | undefined) ||
    (process.env.TEST_ADMIN_PRIVATE_KEY as `0x${string}` | undefined) ||
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

  const account = privateKeyToAccount(privateKey);
  const client = createWalletClient({
    account,
    chain: arcTestnet,
    transport: http(ARC_CONSTANTS.TESTNET.rpcUrl, { timeout: 30000 }),
  }).extend(publicActions);

  console.log(`Deployer Address: ${account.address}`);
  const balance = await client.getBalance({ address: account.address });
  console.log(`Native USDC Balance: ${balance.toString()} wei (${Number(balance) / 1e18} USDC)`);

  const gasPrice = ARC_CONSTANTS.MIN_GAS_FLOOR_WEI; // 20 Gwei floor

  // 1. Deploy or resolve MockUSYCVault if needed
  let usycAddress = process.env.USYC_CONTRACT_ADDRESS as `0x${string}` | undefined;
  if (!usycAddress || !usycAddress.startsWith("0x") || usycAddress.length !== 42) {
    console.log("\n1. Deploying MockUSYCVault...");
    const usycDeployData = encodeDeployData({
      abi: MockUSYCVaultABI,
      bytecode: MockUSYCVaultBytecode,
      args: [ARC_CONSTANTS.USDC_PREDEPLOY],
    });

    const usycHash = await client.sendTransaction({
      account,
      data: usycDeployData,
      maxFeePerGas: gasPrice,
      maxPriorityFeePerGas: gasPrice,
    });
    console.log(`Transaction submitted: ${usycHash}`);
    const usycReceipt = await client.waitForTransactionReceipt({ hash: usycHash });
    usycAddress = usycReceipt.contractAddress!;
    console.log(`✓ MockUSYCVault deployed at: ${usycAddress}`);
  } else {
    console.log(`Using existing USYC address: ${usycAddress}`);
  }

  // 2. Deploy CentralTreasuryYieldVault
  let centralVaultAddress = process.env.CENTRAL_TREASURY_VAULT_ADDRESS as `0x${string}` | undefined;
  if (!centralVaultAddress || !centralVaultAddress.startsWith("0x") || centralVaultAddress.length !== 42) {
    console.log("\n2. Deploying CentralTreasuryYieldVault...");
    const centralDeployData = encodeDeployData({
      abi: CentralTreasuryYieldVaultABI,
      bytecode: CentralTreasuryYieldVaultBytecode,
      args: [ARC_CONSTANTS.USDC_PREDEPLOY, usycAddress, account.address],
    });

    const centralHash = await client.sendTransaction({
      account,
      data: centralDeployData,
      maxFeePerGas: gasPrice,
      maxPriorityFeePerGas: gasPrice,
    });
    console.log(`Transaction submitted: ${centralHash}`);
    const centralReceipt = await client.waitForTransactionReceipt({ hash: centralHash });
    centralVaultAddress = centralReceipt.contractAddress!;
    console.log(`✓ CentralTreasuryYieldVault deployed at: ${centralVaultAddress}`);
  } else {
    console.log(`Using existing CentralTreasuryYieldVault: ${centralVaultAddress}`);
  }

  // 3. Deploy DisbursalVault
  let disbursalVaultAddress = process.env.DISBURSAL_VAULT_ADDRESS as `0x${string}` | undefined;
  if (!disbursalVaultAddress || !disbursalVaultAddress.startsWith("0x") || disbursalVaultAddress.length !== 42) {
    console.log("\n3. Deploying DisbursalVault...");
    const perTxCap = 500_000_000n; // 500 USDC
    const dailyCap = 5_000_000_000n; // 5,000 USDC
    const eip712Threshold = 500_000_000n; // 500 USDC

    const disbursalDeployData = encodeDeployData({
      abi: DisbursalVaultABI,
      bytecode: DisbursalVaultBytecode,
      args: [ARC_CONSTANTS.USDC_PREDEPLOY, account.address, perTxCap, dailyCap, eip712Threshold],
    });

    const disbursalHash = await client.sendTransaction({
      account,
      data: disbursalDeployData,
      maxFeePerGas: gasPrice,
      maxPriorityFeePerGas: gasPrice,
    });
    console.log(`Transaction submitted: ${disbursalHash}`);
    const disbursalReceipt = await client.waitForTransactionReceipt({ hash: disbursalHash });
    disbursalVaultAddress = disbursalReceipt.contractAddress!;
    console.log(`✓ DisbursalVault deployed at: ${disbursalVaultAddress}`);
  } else {
    console.log(`Using existing DisbursalVault: ${disbursalVaultAddress}`);
  }

  // Update .env file
  const envPath = path.resolve(process.cwd(), ".env");
  let envContent = fs.readFileSync(envPath, "utf-8");
  envContent = envContent.replace(/^CENTRAL_TREASURY_VAULT_ADDRESS=.*$/m, `CENTRAL_TREASURY_VAULT_ADDRESS=${centralVaultAddress}`);
  envContent = envContent.replace(/^DISBURSAL_VAULT_ADDRESS=.*$/m, `DISBURSAL_VAULT_ADDRESS=${disbursalVaultAddress}`);
  envContent = envContent.replace(/^USYC_CONTRACT_ADDRESS=.*$/m, `USYC_CONTRACT_ADDRESS=${usycAddress}`);
  envContent = envContent.replace(/^ADMIN_APPROVER_ADDRESS=.*$/m, `ADMIN_APPROVER_ADDRESS=${account.address}`);
  fs.writeFileSync(envPath, envContent);

  console.log("\n✓ Updated .env with live contract addresses:");
  console.log(`  CENTRAL_TREASURY_VAULT_ADDRESS=${centralVaultAddress}`);
  console.log(`  DISBURSAL_VAULT_ADDRESS=${disbursalVaultAddress}`);
  console.log(`  USYC_CONTRACT_ADDRESS=${usycAddress}`);
  console.log(`  ADMIN_APPROVER_ADDRESS=${account.address}`);
}

main().catch((err) => {
  console.error("Deployment failed:", err);
  process.exit(1);
});
