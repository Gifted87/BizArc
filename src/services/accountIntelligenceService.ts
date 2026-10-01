import { PublicClient, parseAbiItem } from "viem";
import { PolicyLoader } from "../config/policyLoader.js";
import { TreasuryAccountsRepo, TreasuryAccountRecord } from "../database/repos/treasuryAccountsRepo.js";
import { LiabilityRepo } from "../database/repos/liabilityRepo.js";
import { AuditLogRepo } from "../database/repos/auditLogRepo.js";
import { CentralTreasuryYieldVaultService } from "../contracts/centralTreasuryYieldVaultService.js";
import { ArcClientManager } from "../foundation/arc/client.js";
import { ARC_CONSTANTS } from "../foundation/arc/constants.js";

export interface AccountIntelligenceMetadata {
  accountId: string;
  name: string;
  role: string;
  address: `0x${string}`;
  chain: string;
  isActive: boolean;
  minOperatingFloorUsdc: number;
  safetyBufferRatio: number;
  excludeFromWaterfall: boolean;
  maxAutonomousSweepLimit?: number;
}

export interface AccountIntelligenceBalances {
  liquidUsdc: string;
  investedUsycShares: string;
  investedUsycUsdcEquivalent: string;
  totalEffectiveUsdc: string;
}

export interface AccountIntelligenceLiabilityItem {
  id: string;
  vendor: string;
  title: string;
  amount: string;
  dueDate: string;
  category: string;
  status: string;
}

export interface AccountIntelligenceLiabilities {
  dueNext7DaysUsdc: string;
  dueNext30DaysUsdc: string;
  items: AccountIntelligenceLiabilityItem[];
}

export interface AccountIntelligenceSolvencyMetrics {
  requiredReserveUsdc: string;
  safeToInvestUsdc: string;
  unencumberedFreeCashUsdc: string;
  freeCapitalTotalUsdc: string;
  timeHorizonSeconds: number;
  isSolvent: boolean;
}

export interface AccountIntelligenceAuditRecord {
  logId: number;
  timestamp: string;
  action: string;
  amount: string;
  actorAgent: string;
  txHash?: string;
}

export interface AccountIntelligence {
  metadata: AccountIntelligenceMetadata;
  balances: AccountIntelligenceBalances;
  liabilities: AccountIntelligenceLiabilities;
  solvencyMetrics: AccountIntelligenceSolvencyMetrics;
  recentAuditHistory: AccountIntelligenceAuditRecord[];
}

export interface WaterfallCandidatePlan {
  eligibleAccounts: AccountIntelligence[];
  allocationPlan: Array<{
    accountId: string;
    allocateAmountUsdc: number;
    remainingFreeCapitalUsdc: number;
  }>;
  totalAvailableUsdc: number;
  isFullyFundable: boolean;
  shortfallUsdc?: number;
}

export class AccountIntelligenceService {
  private publicClient: PublicClient;
  private vaultService?: CentralTreasuryYieldVaultService;

  constructor(options?: {
    publicClient?: PublicClient;
    vaultService?: CentralTreasuryYieldVaultService;
  }) {
    this.publicClient = options?.publicClient ?? ArcClientManager.getPublicClient();
    this.vaultService = options?.vaultService;
  }

  /**
   * Reads the onchain liquid USDC balance for a given wallet address.
   * Adheres to Arc L1 6-decimal USDC specifications.
   */
  public async getOnchainUsdcBalance(walletAddress: `0x${string}`): Promise<number> {
    try {
      const balanceOfAbi = parseAbiItem("function balanceOf(address owner) view returns (uint256)");
      const balanceRaw = await this.publicClient.readContract({
        address: ARC_CONSTANTS.USDC_PREDEPLOY,
        abi: [balanceOfAbi],
        functionName: "balanceOf",
        args: [walletAddress],
      });
      return Number(balanceRaw) / 1_000_000;
    } catch {
      // Fallback: Check native balance converted via Arc Decimal conversion factor (10^12)
      try {
        const nativeBalance = await this.publicClient.getBalance({ address: walletAddress });
        return Number(nativeBalance / ARC_CONSTANTS.DECIMAL_CONVERSION_FACTOR) / 1_000_000;
      } catch {
        return 0;
      }
    }
  }

  /**
   * Reads onchain USYC yield vault position for an account.
   */
  public async getOnchainYieldPosition(accountId: string): Promise<{
    shares: bigint;
    usdcEquivalent: number;
  }> {
    if (!this.vaultService) {
      return { shares: 0n, usdcEquivalent: 0 };
    }
    try {
      const [shares, assets] = await Promise.all([
        this.vaultService.getAccountShares(accountId),
        this.vaultService.getAccountAssets(accountId),
      ]);
      return {
        shares,
        usdcEquivalent: Number(assets) / 1_000_000,
      };
    } catch {
      return { shares: 0n, usdcEquivalent: 0 };
    }
  }

  /**
   * Core Tool: get_account_intelligence
   * Aggregates real-time onchain balances, USYC positions, liabilities, and audit history.
   * Allows providing an optional override balance for deterministic offline simulations and testing.
   */
  public async getAccountIntelligence(
    accountId: string,
    options?: { overrideLiquidBalance?: number; overrideInvestedUsyc?: number }
  ): Promise<AccountIntelligence> {
    const account = await TreasuryAccountsRepo.getAccountById(accountId);
    if (!account) {
      throw new Error(`AccountIntelligenceError: Account '${accountId}' not found in database.`);
    }

    const { profile } = PolicyLoader.getActiveProfile();
    const accountPolicy = profile.operating_accounts.find((a) => a.account_id === accountId);
    const invRules = profile.investment_rules;

    // 1. Fetch Balances
    const liquidUsdc =
      options?.overrideLiquidBalance !== undefined
        ? options.overrideLiquidBalance
        : await this.getOnchainUsdcBalance(account.wallet_address);

    const yieldPosition =
      options?.overrideInvestedUsyc !== undefined
        ? { shares: BigInt(Math.floor(options.overrideInvestedUsyc * 1_000_000)), usdcEquivalent: options.overrideInvestedUsyc }
        : await this.getOnchainYieldPosition(accountId);

    const investedUsdc = yieldPosition.usdcEquivalent;
    const totalEffectiveUsdc = liquidUsdc + investedUsdc;

    // 2. Fetch Liabilities
    const [upcoming7Days, upcoming30Days, allAccountLiabilities] = await Promise.all([
      LiabilityRepo.getUpcomingLiabilities(7, accountId),
      LiabilityRepo.getUpcomingLiabilities(30, accountId),
      LiabilityRepo.getLiabilitiesByAccount(accountId),
    ]);

    const sum7Days = upcoming7Days.reduce((acc, item) => acc + item.amount_usdc, 0);
    const sum30Days = upcoming30Days.reduce((acc, item) => acc + item.amount_usdc, 0);

    const activeLiabilityItems = allAccountLiabilities
      .filter((l) => l.status === "SCHEDULED" || l.status === "AWAITING_APPROVAL")
      .map((l) => ({
        id: l.liability_id ?? "",
        vendor: l.vendor_id,
        title: l.title,
        amount: l.amount_usdc.toFixed(6),
        dueDate: l.due_date instanceof Date ? l.due_date.toISOString() : new Date(l.due_date).toISOString(),
        category: l.category,
        status: l.status,
      }));

    // 3. Compute Solvency & Reserve Metrics
    const evaluationWindowDays = accountPolicy?.evaluation_window_days ?? 14;
    const liabilitiesInWindow = allAccountLiabilities.filter((l) => {
      if (l.status !== "SCHEDULED" && l.status !== "AWAITING_APPROVAL") return false;
      const dueMs = l.due_date instanceof Date ? l.due_date.getTime() : new Date(l.due_date).getTime();
      return dueMs <= Date.now() + evaluationWindowDays * 86400 * 1000;
    });

    const sumLiabilitiesInWindow = liabilitiesInWindow.reduce((acc, item) => acc + item.amount_usdc, 0);
    const safetyBufferRatio = account.safety_buffer_ratio;
    const minOperatingFloor = account.min_operating_floor_usdc;

    // TargetReserve = (Σ liabilities × safety_buffer_ratio) + min_operating_floor
    const requiredReserveUsdc = sumLiabilitiesInWindow * safetyBufferRatio + minOperatingFloor;

    // SafeToInvest = max(0, B_L - (TargetReserve + Δ_invest))
    const isExcluded =
      accountPolicy?.exclude_from_waterfall_draws === true ||
      (accountPolicy?.max_autonomous_sweep_limit !== undefined && accountPolicy.max_autonomous_sweep_limit <= 0);

    let safeToInvestUsdc = 0;
    if (!isExcluded) {
      const rawSafe = Math.max(
        0,
        liquidUsdc - (requiredReserveUsdc + invRules.invest_hysteresis_band_usdc)
      );
      safeToInvestUsdc =
        accountPolicy?.max_autonomous_sweep_limit !== undefined
          ? Math.min(rawSafe, accountPolicy.max_autonomous_sweep_limit)
          : rawSafe;
    }

    // Unencumbered liquid cash = max(0, liquidUsdc - requiredReserveUsdc)
    const unencumberedFreeCashUsdc = Math.max(0, liquidUsdc - requiredReserveUsdc);

    // Free capital total = max(0, totalEffectiveUsdc - requiredReserveUsdc)
    const freeCapitalTotalUsdc = Math.max(0, totalEffectiveUsdc - requiredReserveUsdc);

    // Calculate time horizon seconds to earliest upcoming liability
    let timeHorizonSeconds = evaluationWindowDays * 86400;
    if (activeLiabilityItems.length > 0) {
      const earliestDueMs = Math.min(...activeLiabilityItems.map((i) => new Date(i.dueDate).getTime()));
      const diffMs = earliestDueMs - Date.now();
      timeHorizonSeconds = Math.max(0, Math.floor(diffMs / 1000));
    }

    const isSolvent = totalEffectiveUsdc >= requiredReserveUsdc;

    // 4. Fetch Audit History
    const auditLogs = await AuditLogRepo.getAuditLogsByAccount(accountId, 10);
    const recentAuditHistory: AccountIntelligenceAuditRecord[] = auditLogs.map((log) => ({
      logId: Number(log.log_id ?? 0),
      timestamp: log.timestamp instanceof Date ? log.timestamp.toISOString() : new Date(log.timestamp ?? Date.now()).toISOString(),
      action: log.action_type,
      amount: log.amount_usdc.toFixed(6),
      actorAgent: log.actor_agent,
      txHash: log.tx_hash ?? undefined,
    }));

    return {
      metadata: {
        accountId: account.account_id,
        name: account.name,
        role: account.role,
        address: account.wallet_address,
        chain: account.chain_id === 5042 ? "Arc Mainnet (5042)" : `Arc Testnet (${account.chain_id})`,
        isActive: account.is_active,
        minOperatingFloorUsdc: account.min_operating_floor_usdc,
        safetyBufferRatio: account.safety_buffer_ratio,
        excludeFromWaterfall: accountPolicy?.exclude_from_waterfall_draws ?? false,
        maxAutonomousSweepLimit: accountPolicy?.max_autonomous_sweep_limit,
      },
      balances: {
        liquidUsdc: liquidUsdc.toFixed(6),
        investedUsycShares: yieldPosition.shares.toString(),
        investedUsycUsdcEquivalent: investedUsdc.toFixed(6),
        totalEffectiveUsdc: totalEffectiveUsdc.toFixed(6),
      },
      liabilities: {
        dueNext7DaysUsdc: sum7Days.toFixed(6),
        dueNext30DaysUsdc: sum30Days.toFixed(6),
        items: activeLiabilityItems,
      },
      solvencyMetrics: {
        requiredReserveUsdc: requiredReserveUsdc.toFixed(6),
        safeToInvestUsdc: safeToInvestUsdc.toFixed(6),
        unencumberedFreeCashUsdc: unencumberedFreeCashUsdc.toFixed(6),
        freeCapitalTotalUsdc: freeCapitalTotalUsdc.toFixed(6),
        timeHorizonSeconds,
        isSolvent,
      },
      recentAuditHistory,
    };
  }

  /**
   * Retrieves account intelligence across all registered operating accounts in the corporate portfolio.
   */
  public async getAllAccountsIntelligence(
    balanceOverrides?: Record<string, { liquidUsdc?: number; investedUsyc?: number }>
  ): Promise<AccountIntelligence[]> {
    const accounts = await TreasuryAccountsRepo.getAllAccounts();
    const results: AccountIntelligence[] = [];

    for (const acc of accounts) {
      const overrides = balanceOverrides?.[acc.account_id];
      const intelligence = await this.getAccountIntelligence(acc.account_id, {
        overrideLiquidBalance: overrides?.liquidUsdc,
        overrideInvestedUsyc: overrides?.investedUsyc,
      });
      results.push(intelligence);
    }

    return results;
  }

  /**
   * Evaluates corporate-wide accounts for multi-account waterfall disbursal routing.
   * Respects payroll protection rules and calculates free unencumbered capital.
   */
  public async getWaterfallCandidateAccounts(
    requiredAmountUsdc: number,
    balanceOverrides?: Record<string, { liquidUsdc?: number; investedUsyc?: number }>
  ): Promise<WaterfallCandidatePlan> {
    const allAccounts = await this.getAllAccountsIntelligence(balanceOverrides);

    // Filter eligible accounts:
    // 1. Must be active
    // 2. Must not be excluded from waterfall draws (e.g. Payroll is protected)
    // 3. Must have positive free capital total
    const eligibleAccounts = allAccounts.filter(
      (a) => a.metadata.isActive && !a.metadata.excludeFromWaterfall && parseFloat(a.solvencyMetrics.freeCapitalTotalUsdc) > 0
    );

    // Sort by role priority or available free capital descending
    eligibleAccounts.sort(
      (a, b) => parseFloat(b.solvencyMetrics.freeCapitalTotalUsdc) - parseFloat(a.solvencyMetrics.freeCapitalTotalUsdc)
    );

    let remainingNeeded = requiredAmountUsdc;
    const allocationPlan: Array<{
      accountId: string;
      allocateAmountUsdc: number;
      remainingFreeCapitalUsdc: number;
    }> = [];

    let totalAvailableUsdc = 0;

    for (const candidate of eligibleAccounts) {
      const freeCapital = parseFloat(candidate.solvencyMetrics.freeCapitalTotalUsdc);
      totalAvailableUsdc += freeCapital;

      if (remainingNeeded > 0) {
        const allocate = Math.min(remainingNeeded, freeCapital);
        remainingNeeded -= allocate;
        allocationPlan.push({
          accountId: candidate.metadata.accountId,
          allocateAmountUsdc: Number(allocate.toFixed(6)),
          remainingFreeCapitalUsdc: Number((freeCapital - allocate).toFixed(6)),
        });
      }
    }

    const isFullyFundable = remainingNeeded <= 0.0000001;
    return {
      eligibleAccounts,
      allocationPlan,
      totalAvailableUsdc: Number(totalAvailableUsdc.toFixed(6)),
      isFullyFundable,
      shortfallUsdc: isFullyFundable ? undefined : Number(remainingNeeded.toFixed(6)),
    };
  }
}
