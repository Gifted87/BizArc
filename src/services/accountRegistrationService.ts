import crypto from "crypto";
import { PublicClient, WalletClient } from "viem";
import { PolicyLoader } from "../config/policyLoader.js";
import { TreasuryAccountsRepo, TreasuryAccountRecord } from "../database/repos/treasuryAccountsRepo.js";
import { CentralTreasuryYieldVaultService } from "../contracts/centralTreasuryYieldVaultService.js";
import { CentralTreasuryYieldVaultABI } from "../contracts/artifacts.js";
import { ViemWalletAdapter } from "../foundation/wallets/viemWalletAdapter.js";
import { ArcClientManager } from "../foundation/arc/client.js";

export interface AccountRegistrationStatus {
  accountId: string;
  name: string;
  role: string;
  walletAddress: `0x${string}`;
  dbRegistered: boolean;
  onchainRegistered: boolean;
  onchainWalletAddress?: `0x${string}`;
  shares: bigint;
  assetsUsdc: bigint;
  minOperatingFloorUsdc: number;
  safetyBufferRatio: number;
}

export const DEFAULT_PRODUCTION_ACCOUNT_WALLETS: Record<string, `0x${string}`> = {
  acc_engineering: "0x1111111111111111111111111111111111111101",
  acc_payroll: "0x2222222222222222222222222222222222222202",
  acc_general_treasury: "0x3333333333333333333333333333333333333303",
  acc_marketing: "0x4444444444444444444444444444444444444404",
};

export class AccountRegistrationService {
  private vaultService?: CentralTreasuryYieldVaultService;
  private adminWalletAdapter?: ViemWalletAdapter;
  private publicClient: PublicClient;

  constructor(params?: {
    vaultAddress?: `0x${string}`;
    adminWalletAdapter?: ViemWalletAdapter;
    publicClient?: PublicClient;
  }) {
    this.publicClient = params?.publicClient ?? ArcClientManager.getPublicClient();
    if (params?.vaultAddress) {
      this.vaultService = new CentralTreasuryYieldVaultService(
        params.vaultAddress,
        this.publicClient
      );
    }
    this.adminWalletAdapter = params?.adminWalletAdapter;
  }

  /**
   * Synchronizes all operating accounts from the active Business Policy profile into PostgreSQL.
   */
  public async syncPolicyAccountsToDatabase(options?: {
    customWallets?: Record<string, `0x${string}`>;
    chainId?: number;
  }): Promise<TreasuryAccountRecord[]> {
    const { profile: activeProfile } = PolicyLoader.getActiveProfile();
    const chainId = options?.chainId ?? 5042002; // Arc Testnet
    const customWallets = options?.customWallets ?? {};

    const syncedRecords: TreasuryAccountRecord[] = [];

    for (const acc of activeProfile.operating_accounts) {
      const walletAddress =
        customWallets[acc.account_id] ||
        (process.env[`WALLET_${acc.account_id.toUpperCase()}`] as `0x${string}`) ||
        DEFAULT_PRODUCTION_ACCOUNT_WALLETS[acc.account_id] ||
        (`0x${crypto.createHash("sha256").update(acc.account_id).digest("hex").slice(0, 40)}` as `0x${string}`);

      const record = await TreasuryAccountsRepo.upsertAccount({
        account_id: acc.account_id,
        name: acc.name,
        role: acc.role,
        wallet_address: walletAddress.toLowerCase() as `0x${string}`,
        chain_id: chainId,
        min_operating_floor_usdc: acc.min_floor_usdc,
        safety_buffer_ratio: acc.safety_multiplier,
        is_active: true,
      });

      syncedRecords.push(record);
    }

    return syncedRecords;
  }

  /**
   * Registers a single treasury operating account onchain in CentralTreasuryYieldVault.
   */
  public async registerAccountOnchain(
    accountId: string,
    walletAddress: `0x${string}`
  ): Promise<{ txHash?: `0x${string}`; alreadyRegistered: boolean }> {
    if (!this.vaultService) {
      throw new Error("CentralTreasuryYieldVault address is not configured.");
    }
    if (!this.adminWalletAdapter) {
      throw new Error("Admin wallet adapter is required for onchain registration.");
    }

    const currentOnchainWallet = await this.vaultService.getRegisteredAccount(accountId);
    if (
      currentOnchainWallet &&
      currentOnchainWallet.toLowerCase() !== "0x0000000000000000000000000000000000000000"
    ) {
      return { alreadyRegistered: true };
    }

    const formattedId = CentralTreasuryYieldVaultService.formatAccountId(accountId);
    const result = await this.adminWalletAdapter.executeContract({
      targetContract: this.vaultService.getAddress(),
      abi: CentralTreasuryYieldVaultABI,
      functionName: "registerAccount",
      args: [formattedId, walletAddress],
      idempotencyKey: `register_${accountId}_${Date.now()}`,
    });

    if (result.status !== "CONFIRMED") {
      throw new Error(`Onchain registration failed for ${accountId}: tx ${result.txHash}`);
    }

    return { txHash: result.txHash, alreadyRegistered: false };
  }

  /**
   * Full end-to-end synchronization: syncs accounts to database and registers them onchain.
   */
  public async registerAllAccounts(options?: {
    customWallets?: Record<string, `0x${string}`>;
  }): Promise<AccountRegistrationStatus[]> {
    const dbAccounts = await this.syncPolicyAccountsToDatabase(options);
    const statuses: AccountRegistrationStatus[] = [];

    for (const acc of dbAccounts) {
      let onchainRegistered = false;
      let onchainWallet: `0x${string}` | undefined;
      let shares = 0n;
      let assets = 0n;

      if (this.vaultService) {
        try {
          onchainWallet = await this.vaultService.getRegisteredAccount(acc.account_id);
          const isZero =
            !onchainWallet ||
            onchainWallet.toLowerCase() === "0x0000000000000000000000000000000000000000";

          if (isZero && this.adminWalletAdapter) {
            await this.registerAccountOnchain(acc.account_id, acc.wallet_address);
            onchainRegistered = true;
            onchainWallet = acc.wallet_address;
          } else {
            onchainRegistered = !isZero;
          }

          shares = await this.vaultService.getAccountShares(acc.account_id);
          assets = await this.vaultService.getAccountAssets(acc.account_id);
        } catch (err) {
          console.warn(`Could not query onchain state for ${acc.account_id}:`, err);
        }
      }

      statuses.push({
        accountId: acc.account_id,
        name: acc.name,
        role: acc.role,
        walletAddress: acc.wallet_address,
        dbRegistered: true,
        onchainRegistered,
        onchainWalletAddress: onchainWallet,
        shares,
        assetsUsdc: assets,
        minOperatingFloorUsdc: acc.min_operating_floor_usdc,
        safetyBufferRatio: acc.safety_buffer_ratio,
      });
    }

    return statuses;
  }

  /**
   * Retrieves comprehensive registration and share status for an account.
   */
  public async getAccountStatus(
    accountId: string
  ): Promise<AccountRegistrationStatus | null> {
    const dbAccount = await TreasuryAccountsRepo.getAccountById(accountId);
    if (!dbAccount) return null;

    let onchainRegistered = false;
    let onchainWallet: `0x${string}` | undefined;
    let shares = 0n;
    let assets = 0n;

    if (this.vaultService) {
      try {
        onchainWallet = await this.vaultService.getRegisteredAccount(accountId);
        onchainRegistered =
          Boolean(onchainWallet) &&
          onchainWallet.toLowerCase() !== "0x0000000000000000000000000000000000000000";
        if (onchainRegistered) {
          shares = await this.vaultService.getAccountShares(accountId);
          assets = await this.vaultService.getAccountAssets(accountId);
        }
      } catch (err) {
        console.warn(`Failed reading onchain shares for ${accountId}:`, err);
      }
    }

    return {
      accountId: dbAccount.account_id,
      name: dbAccount.name,
      role: dbAccount.role,
      walletAddress: dbAccount.wallet_address,
      dbRegistered: true,
      onchainRegistered,
      onchainWalletAddress: onchainWallet,
      shares,
      assetsUsdc: assets,
      minOperatingFloorUsdc: dbAccount.min_operating_floor_usdc,
      safetyBufferRatio: dbAccount.safety_buffer_ratio,
    };
  }
}
