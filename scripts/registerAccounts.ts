import dotenv from "dotenv";
import { AccountRegistrationService } from "../src/services/accountRegistrationService.js";
import { DbClient } from "../src/database/dbClient.js";
import { ViemWalletAdapter } from "../src/foundation/wallets/viemWalletAdapter.js";

dotenv.config();

async function main() {
  console.log("=== [BizArc] Registering Operating Accounts (D4) ===");

  const vaultAddress = process.env.CENTRAL_TREASURY_VAULT_ADDRESS as `0x${string}` | undefined;
  const adminPrivateKey = process.env.ADMIN_PRIVATE_KEY as `0x${string}` | undefined;

  let adminAdapter: ViemWalletAdapter | undefined;
  if (adminPrivateKey) {
    adminAdapter = new ViemWalletAdapter(adminPrivateKey, "arcTestnet");
  }

  const service = new AccountRegistrationService({
    vaultAddress,
    adminWalletAdapter: adminAdapter,
  });

  const statuses = await service.registerAllAccounts();
  console.log(`Registered ${statuses.length} corporate operating accounts:`);

  for (const st of statuses) {
    console.log(`- Account: [${st.accountId}] ${st.name} (${st.role})`);
    console.log(`  Wallet: ${st.walletAddress}`);
    console.log(`  Floor: $${st.minOperatingFloorUsdc} | Buffer: ${st.safetyBufferRatio}x`);
    console.log(`  DB Registered: ${st.dbRegistered} | Onchain Registered: ${st.onchainRegistered}`);
    if (st.onchainRegistered) {
      console.log(`  Shares: ${st.shares.toString()} | Assets: ${st.assetsUsdc.toString()} micro-USDC`);
    }
  }

  await DbClient.closePool();
  console.log("=== Account Registration Completed ===");
}

main().catch(async (err) => {
  console.error("Fatal error during account registration:", err);
  await DbClient.closePool();
  process.exit(1);
});
