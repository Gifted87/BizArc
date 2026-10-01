import dotenv from "dotenv";
import { VendorMasterService } from "../src/services/vendorMasterService.js";
import { DbClient } from "../src/database/dbClient.js";
import { ViemWalletAdapter } from "../src/foundation/wallets/viemWalletAdapter.js";

dotenv.config();

async function main() {
  console.log("=== [BizArc] Seeding Verified Vendor Master Registry (D5) ===");

  const disbursalVaultAddress = process.env.DISBURSAL_VAULT_ADDRESS as `0x${string}` | undefined;
  const adminPrivateKey = process.env.ADMIN_PRIVATE_KEY as `0x${string}` | undefined;

  let adminAdapter: ViemWalletAdapter | undefined;
  if (adminPrivateKey) {
    adminAdapter = new ViemWalletAdapter(adminPrivateKey, "arcTestnet");
  }

  const service = new VendorMasterService({
    disbursalVaultAddress,
    adminWalletAdapter: adminAdapter,
  });

  const seeded = await service.seedInitialVendors();
  console.log(`Successfully seeded ${seeded.length} verified vendors into master registry:`);

  for (const v of seeded) {
    console.log(`- Vendor: [${v.vendor_id}] ${v.name}`);
    console.log(`  Payout Address: ${v.verified_payout_address}`);
    console.log(`  Verified By: ${v.verified_by_admin} | Change Lock: ${v.change_lock}`);
  }

  await DbClient.closePool();
  console.log("=== Vendor Seeding Completed ===");
}

main().catch(async (err) => {
  console.error("Fatal error during vendor seeding:", err);
  await DbClient.closePool();
  process.exit(1);
});
