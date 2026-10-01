import {
  PublicClient,
  WalletClient,
  encodeFunctionData,
  stringToHex,
  pad,
  keccak256,
  toHex,
} from "viem";
import { CentralTreasuryYieldVaultABI } from "./artifacts.js";
import { ArcClientManager } from "../foundation/arc/client.js";

export class CentralTreasuryYieldVaultService {
  private vaultAddress: `0x${string}`;
  private publicClient: PublicClient;

  constructor(vaultAddress: `0x${string}`, client?: PublicClient) {
    this.vaultAddress = vaultAddress;
    this.publicClient = client ?? ArcClientManager.getPublicClient();
  }

  public getAddress(): `0x${string}` {
    return this.vaultAddress;
  }

  public static formatAccountId(accountId: string): `0x${string}` {
    // Convert string account ID to bytes32 (padded)
    const hex = stringToHex(accountId);
    return pad(hex, { size: 32, dir: "right" });
  }

  public async getAccountShares(accountId: string): Promise<bigint> {
    const formattedId = CentralTreasuryYieldVaultService.formatAccountId(accountId);
    const shares = await this.publicClient.readContract({
      address: this.vaultAddress,
      abi: CentralTreasuryYieldVaultABI,
      functionName: "accountShares",
      args: [formattedId],
    });
    return shares;
  }

  public async getAccountAssets(accountId: string): Promise<bigint> {
    const formattedId = CentralTreasuryYieldVaultService.formatAccountId(accountId);
    const assets = await this.publicClient.readContract({
      address: this.vaultAddress,
      abi: CentralTreasuryYieldVaultABI,
      functionName: "getAccountAssets",
      args: [formattedId],
    });
    return assets;
  }

  public async getRegisteredAccount(accountId: string): Promise<`0x${string}`> {
    const formattedId = CentralTreasuryYieldVaultService.formatAccountId(accountId);
    const wallet = await this.publicClient.readContract({
      address: this.vaultAddress,
      abi: CentralTreasuryYieldVaultABI,
      functionName: "registeredAccounts",
      args: [formattedId],
    });
    return wallet as `0x${string}`;
  }

  public encodeRegisterAccount(accountId: string, wallet: `0x${string}`): `0x${string}` {
    const formattedId = CentralTreasuryYieldVaultService.formatAccountId(accountId);
    return encodeFunctionData({
      abi: CentralTreasuryYieldVaultABI,
      functionName: "registerAccount",
      args: [formattedId, wallet],
    });
  }

  public encodeSweepFromAccount(
    accountId: string,
    accountWallet: `0x${string}`,
    usdcAmount: bigint
  ): `0x${string}` {
    const formattedId = CentralTreasuryYieldVaultService.formatAccountId(accountId);
    return encodeFunctionData({
      abi: CentralTreasuryYieldVaultABI,
      functionName: "sweepFromAccount",
      args: [formattedId, accountWallet, usdcAmount],
    });
  }

  public encodeRecallForAccount(
    accountId: string,
    usdcAmount: bigint
  ): `0x${string}` {
    const formattedId = CentralTreasuryYieldVaultService.formatAccountId(accountId);
    return encodeFunctionData({
      abi: CentralTreasuryYieldVaultABI,
      functionName: "recallForAccount",
      args: [formattedId, usdcAmount],
    });
  }
}
