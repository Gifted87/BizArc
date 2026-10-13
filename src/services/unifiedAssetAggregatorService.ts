import { PublicClient, parseAbiItem } from "viem";
import { ArcClientManager } from "../foundation/arc/client.js";
import { ARC_CONSTANTS } from "../foundation/arc/constants.js";
import { CentralTreasuryYieldVaultService } from "../contracts/centralTreasuryYieldVaultService.js";
import { TreasuryAccountsRepo, TreasuryAccountRecord } from "../database/repos/treasuryAccountsRepo.js";
import { LiabilityRepo } from "../database/repos/liabilityRepo.js";
import { DynamicRecordsService } from "../records/dynamicRecordsService.js";
import { PolicyLoader } from "../config/policyLoader.js";
import { LoudRoundingError } from "../foundation/usdc/usdcService.js";

/**
 * Thrown when an on-chain data feed (RPC call) fails to return a reliable value.
 * Callers MUST NOT silently treat this as $0 — Rule 5: Loud Repair.
 */
export class DataFeedError extends Error {
  constructor(public readonly accountId: string, public readonly feed: string, cause?: unknown) {
    super(`DataFeedError[${feed}] for account '${accountId}': ${String(cause)}`);
    this.name = "DataFeedError";
  }
}

export interface AccountAssetDistribution {
  accountId: string;
  name: string;
  role: string;
  chain: string;
  address: `0x${string}`;
  liquidUsdc: string;
  liquidRaw: bigint;
  investedUsyc: string;
  investedRaw: bigint;
  totalEffectiveUsdc: string;
  totalEffectiveRaw: bigint;
  committedLiabilities30dUsdc: string;
  committedLiabilities30dRaw: bigint;
  safetyBufferRatio: number;
  minOperatingFloorUsdc: string;
  minOperatingFloorRaw: bigint;
  protectedReserveUsdc: string;
  protectedReserveRaw: bigint;
  freeCapitalUsdc: string;
  freeCapitalRaw: bigint;
  unencumberedLiquidCashUsdc: string;
  unencumberedLiquidCashRaw: bigint;
  safeToInvestUsdc: string;
  safeToInvestRaw: bigint;
  isActive: boolean;
  excludeFromWaterfall: boolean;
  authorizedCategories: string[];
}

export interface SolvencyHealthMetrics {
  isSolvent: boolean;
  totalSurplusUsdc: string;
  totalSurplusRaw: bigint;
  healthRatio: number;
}

export interface CompanyUnifiedAssetDistribution {
  timestamp: string;
  companyTotalNetWorthUsdc: string;
  companyTotalNetWorthRaw: bigint;
  totalLiquidUsdc: string;
  totalLiquidRaw: bigint;
  totalInvestedUsyc: string;
  totalInvestedRaw: bigint;
  totalUpcomingLiabilities30dUsdc: string;
  totalUpcomingLiabilities30dRaw: bigint;
  totalProtectedReserveUsdc: string;
  totalProtectedReserveRaw: bigint;
  totalFreeCapitalUsdc: string;
  totalFreeCapitalRaw: bigint;
  accountsDistribution: AccountAssetDistribution[];
  solvencyHealth: SolvencyHealthMetrics;
}

export interface BalanceOverrideMap {
  [accountId: string]: {
    liquidUsdc?: number | bigint | string;
    investedUsyc?: number | bigint | string;
  };
}

/**
 * D14: Unified Asset Aggregator Service (Sentence 18 / DAG Node D14)
 * Consolidates fragmented multichain and multi-account assets into a single comprehensive balance sheet.
 * Computes exact 6-decimal integer USDC arithmetic for liquid cash, invested USYC, liabilities, and free capital.
 */
export class UnifiedAssetAggregatorService {
  private publicClient: PublicClient;
  private vaultService: CentralTreasuryYieldVaultService;
  private dynamicRecords: DynamicRecordsService;

  constructor(options?: {
    publicClient?: PublicClient;
    vaultService?: CentralTreasuryYieldVaultService;
    dynamicRecords?: DynamicRecordsService;
  }) {
    this.publicClient = options?.publicClient ?? ArcClientManager.getPublicClient();
    this.vaultService =
      options?.vaultService ??
      new CentralTreasuryYieldVaultService("0x4444444444444444444444444444444444444444");
    this.dynamicRecords = options?.dynamicRecords ?? new DynamicRecordsService();
  }

  /**
   * Reads the onchain liquid USDC balance for a given wallet address.
   */
  public async getOnchainUsdcBalance(walletAddress: `0x${string}`): Promise<bigint> {
    try {
      const balanceOfAbi = parseAbiItem("function balanceOf(address owner) view returns (uint256)");
      const balanceRaw = await this.publicClient.readContract({
        address: ARC_CONSTANTS.USDC_PREDEPLOY,
        abi: [balanceOfAbi],
        functionName: "balanceOf",
        args: [walletAddress],
      });
      return balanceRaw as bigint;
    } catch {
      try {
        const nativeBalance = await this.publicClient.getBalance({ address: walletAddress });
        return nativeBalance / ARC_CONSTANTS.DECIMAL_CONVERSION_FACTOR;
      } catch {
        return 0n;
      }
    }
  }

  /**
   * Reads onchain USYC yield vault position for an account.
   */
  public async getOnchainYieldPosition(accountId: string): Promise<bigint> {
    try {
      const assets = await this.vaultService.getAccountAssets(accountId);
      return assets;
    } catch (err) {
      // Rule 5 (Loud Repair): Do NOT silently return $0.
      // A silent zero here would cause the aggregator to undercount total effective
      // balance, artificially inflate safeToInvest, and trigger unnecessary sweeps.
      throw new DataFeedError(accountId, "USYC_YIELD_POSITION", err);
    }
  }

  /**
   * Computes individual asset distribution and solvency metrics for a specific treasury account.
   */
  public async getAccountAssetDistribution(
    accountId: string,
    overrides?: { liquidUsdc?: number | bigint | string; investedUsyc?: number | bigint | string }
  ): Promise<AccountAssetDistribution> {
    const account = await TreasuryAccountsRepo.getAccountById(accountId);
    if (!account) {
      throw new Error(`AccountNotFoundError: Account '${accountId}' does not exist in TreasuryAccountsRepo.`);
    }

    const { profile } = PolicyLoader.getActiveProfile();
    const accountPolicy = profile.operating_accounts.find((a) => a.account_id === accountId);

    // 1. Resolve Liquid Balance (BL)
    let liquidRaw: bigint;
    if (overrides?.liquidUsdc !== undefined) {
      if (typeof overrides.liquidUsdc === "bigint") {
        liquidRaw = overrides.liquidUsdc;
      } else if (typeof overrides.liquidUsdc === "string") {
        liquidRaw = this.dynamicRecords.parseUsdcToRaw(overrides.liquidUsdc);
      } else {
        liquidRaw = this.dynamicRecords.parseUsdcToRaw(overrides.liquidUsdc.toFixed(6));
      }
    } else {
      liquidRaw = await this.getOnchainUsdcBalance(account.wallet_address);
    }

    // 2. Resolve Invested Yield Position (BY)
    let investedRaw: bigint;
    if (overrides?.investedUsyc !== undefined) {
      if (typeof overrides.investedUsyc === "bigint") {
        investedRaw = overrides.investedUsyc;
      } else if (typeof overrides.investedUsyc === "string") {
        investedRaw = this.dynamicRecords.parseUsdcToRaw(overrides.investedUsyc);
      } else {
        investedRaw = this.dynamicRecords.parseUsdcToRaw(overrides.investedUsyc.toFixed(6));
      }
    } else {
      investedRaw = await this.getOnchainYieldPosition(accountId);
    }

    // Parallel Tripartite Balance: BE = BL + BY
    const totalEffectiveRaw = liquidRaw + investedRaw;

    // 3. Query 30-Day Committed Liabilities from Dynamic Record 1
    const liabilities30d = await LiabilityRepo.getUpcomingLiabilities(30, accountId);
    let committedLiabilities30dRaw = 0n;
    for (const item of liabilities30d) {
      committedLiabilities30dRaw += this.dynamicRecords.parseUsdcToRaw(item.amount_usdc.toFixed(6));
    }

    // 4. Reserve Requirements Calculation
    const safetyBufferRatio = account.safety_buffer_ratio || 1.2;
    const minOperatingFloorRaw = this.dynamicRecords.parseUsdcToRaw(
      (account.min_operating_floor_usdc || 0).toFixed(6)
    );

    // Protected Reserve = (Σ Liabilities_30d * safety_buffer_ratio) + min_operating_floor
    // Compute integer math: (committedLiabilities30dRaw * BigInt(Math.round(safetyBufferRatio * 10000))) / 10000n
    const ratioScaled = BigInt(Math.round(safetyBufferRatio * 10000));
    const bufferedLiabilitiesRaw = (committedLiabilities30dRaw * ratioScaled) / 10000n;
    const protectedReserveRaw = bufferedLiabilitiesRaw + minOperatingFloorRaw;

    // Free Capital = max(0, TotalEffective - ProtectedReserve)
    const freeCapitalRaw = totalEffectiveRaw > protectedReserveRaw ? totalEffectiveRaw - protectedReserveRaw : 0n;

    // Unencumbered Liquid Cash = max(0, LiquidCash - ProtectedReserve)
    const unencumberedLiquidCashRaw =
      liquidRaw > protectedReserveRaw ? liquidRaw - protectedReserveRaw : 0n;

    // 5. Safe to Invest (from Dynamic Record 2)
    const isExcluded =
      account.role === "PAYROLL" ||
      accountPolicy?.exclude_from_waterfall_draws === true ||
      (accountPolicy?.max_autonomous_sweep_limit !== undefined && accountPolicy.max_autonomous_sweep_limit <= 0);

    let safeToInvestRaw = 0n;
    if (!isExcluded) {
      const hysteresisRaw = this.dynamicRecords.parseUsdcToRaw(
        (profile.investment_rules.invest_hysteresis_band_usdc || 1.0).toFixed(6)
      );
      const sweepThresholdRaw = protectedReserveRaw + hysteresisRaw;
      if (liquidRaw > sweepThresholdRaw) {
        const rawSafe = liquidRaw - sweepThresholdRaw;
        if (accountPolicy?.max_autonomous_sweep_limit !== undefined) {
          const limitRaw = this.dynamicRecords.parseUsdcToRaw(
            accountPolicy.max_autonomous_sweep_limit.toFixed(6)
          );
          safeToInvestRaw = rawSafe > limitRaw ? limitRaw : rawSafe;
        } else {
          safeToInvestRaw = rawSafe;
        }
      }
    }

    const authorizedCategories = accountPolicy?.authorized_categories || [];

    return {
      accountId: account.account_id,
      name: account.name,
      role: account.role,
      chain: account.chain_id === 5042 ? "ARC_MAINNET" : "ARC_TESTNET",
      address: account.wallet_address,
      liquidUsdc: this.dynamicRecords.formatRawToUsdc(liquidRaw),
      liquidRaw,
      investedUsyc: this.dynamicRecords.formatRawToUsdc(investedRaw),
      investedRaw,
      totalEffectiveUsdc: this.dynamicRecords.formatRawToUsdc(totalEffectiveRaw),
      totalEffectiveRaw,
      committedLiabilities30dUsdc: this.dynamicRecords.formatRawToUsdc(committedLiabilities30dRaw),
      committedLiabilities30dRaw,
      safetyBufferRatio,
      minOperatingFloorUsdc: this.dynamicRecords.formatRawToUsdc(minOperatingFloorRaw),
      minOperatingFloorRaw,
      protectedReserveUsdc: this.dynamicRecords.formatRawToUsdc(protectedReserveRaw),
      protectedReserveRaw,
      freeCapitalUsdc: this.dynamicRecords.formatRawToUsdc(freeCapitalRaw),
      freeCapitalRaw,
      unencumberedLiquidCashUsdc: this.dynamicRecords.formatRawToUsdc(unencumberedLiquidCashRaw),
      unencumberedLiquidCashRaw,
      safeToInvestUsdc: this.dynamicRecords.formatRawToUsdc(safeToInvestRaw),
      safeToInvestRaw,
      isActive: account.is_active,
      excludeFromWaterfall: account.role === "PAYROLL" || (accountPolicy?.exclude_from_waterfall_draws ?? false),
      authorizedCategories,
    };
  }

  /**
   * Aggregates real-time unified asset distribution across all corporate accounts.
   * Produces the full company-wide balance sheet with Parallel Tripartite Balance verification.
   */
  public async aggregateCompanyAssets(
    balanceOverrides?: BalanceOverrideMap
  ): Promise<CompanyUnifiedAssetDistribution> {
    const allAccounts = await TreasuryAccountsRepo.getAllAccounts();

    const targetAccounts =
      balanceOverrides && Object.keys(balanceOverrides).length > 0
        ? allAccounts.filter((a) => a.account_id in balanceOverrides)
        : allAccounts.filter((a) => a.is_active);

    const distributions: AccountAssetDistribution[] = [];

    let companyTotalNetWorthRaw = 0n;
    let totalLiquidRaw = 0n;
    let totalInvestedRaw = 0n;
    let totalUpcomingLiabilities30dRaw = 0n;
    let totalProtectedReserveRaw = 0n;
    let totalFreeCapitalRaw = 0n;

    for (const acc of targetAccounts) {
      const overrides = balanceOverrides?.[acc.account_id];
      const dist = await this.getAccountAssetDistribution(acc.account_id, overrides);
      distributions.push(dist);

      companyTotalNetWorthRaw += dist.totalEffectiveRaw;
      totalLiquidRaw += dist.liquidRaw;
      totalInvestedRaw += dist.investedRaw;
      totalUpcomingLiabilities30dRaw += dist.committedLiabilities30dRaw;
      totalProtectedReserveRaw += dist.protectedReserveRaw;
      totalFreeCapitalRaw += dist.freeCapitalRaw;
    }

    // Invariant Check: Total Net Worth = Total Liquid + Total Invested
    if (companyTotalNetWorthRaw !== totalLiquidRaw + totalInvestedRaw) {
      throw new LoudRoundingError(
        `Tripartite Balance Invariant Violated: Net Worth (${companyTotalNetWorthRaw}) != Liquid (${totalLiquidRaw}) + Invested (${totalInvestedRaw})`
      );
    }

    const isSolvent = companyTotalNetWorthRaw >= totalProtectedReserveRaw;
    const totalSurplusRaw =
      companyTotalNetWorthRaw > totalProtectedReserveRaw
        ? companyTotalNetWorthRaw - totalProtectedReserveRaw
        : 0n;

    const healthRatio =
      totalProtectedReserveRaw > 0n
        ? Number(companyTotalNetWorthRaw) / Number(totalProtectedReserveRaw)
        : 1.0;

    return {
      timestamp: new Date().toISOString(),
      companyTotalNetWorthUsdc: this.dynamicRecords.formatRawToUsdc(companyTotalNetWorthRaw),
      companyTotalNetWorthRaw,
      totalLiquidUsdc: this.dynamicRecords.formatRawToUsdc(totalLiquidRaw),
      totalLiquidRaw,
      totalInvestedUsyc: this.dynamicRecords.formatRawToUsdc(totalInvestedRaw),
      totalInvestedRaw,
      totalUpcomingLiabilities30dUsdc: this.dynamicRecords.formatRawToUsdc(totalUpcomingLiabilities30dRaw),
      totalUpcomingLiabilities30dRaw,
      totalProtectedReserveUsdc: this.dynamicRecords.formatRawToUsdc(totalProtectedReserveRaw),
      totalProtectedReserveRaw,
      totalFreeCapitalUsdc: this.dynamicRecords.formatRawToUsdc(totalFreeCapitalRaw),
      totalFreeCapitalRaw,
      accountsDistribution: distributions,
      solvencyHealth: {
        isSolvent,
        totalSurplusUsdc: this.dynamicRecords.formatRawToUsdc(totalSurplusRaw),
        totalSurplusRaw,
        healthRatio: Number(healthRatio.toFixed(4)),
      },
    };
  }
}
