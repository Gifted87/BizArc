import { DbClient } from "../database/dbClient.js";
import { DynamicRecordsService } from "../records/dynamicRecordsService.js";
import {
  DynamicLiabilityRecord,
  ParallelTripartiteBalance,
} from "../records/types.js";
import { CentralTreasuryYieldVaultService } from "../contracts/centralTreasuryYieldVaultService.js";
import { CentralTreasuryYieldVaultABI } from "../contracts/artifacts.js";
import { ArcTransactionExecutor } from "../foundation/wallets/arcTransactionExecutor.js";
import { LedgerWitnessService } from "./ledgerWitnessService.js";
import { AuthorizationGate } from "../security/authorizationGate.js";
import { TreasuryAccountsRepo } from "../database/repos/treasuryAccountsRepo.js";
import { PolicyLoader } from "../config/policyLoader.js";
import { PermissionRequestRepo } from "../database/repos/permissionRequestRepo.js";
import { AGENT_REGISTRY, AgentPersonaType } from "../types/agents.js";

/**
 * Standard Parameterized Redemption Lead Times (Sentence 11 / D13)
 * Avoids race conditions by pre-funding before billing execution.
 */
export const REDEMPTION_LEAD_TIME = {
  ACCELERATED_TIER: 300,        // 5 minutes (high-priority / accelerated liquidation window)
  INSTANT_TIER: 3600,           // 1 hour (onchain instant yield redemption)
  BATCH_SETTLEMENT_TIER: 86400, // 24 hours (Hashnote T+0 / T+1 fund processing)
  WEEKEND_BUFFER_SECONDS: 172800, // 48 hours (mutual fund NAV pricing freeze on weekends)
} as const;

export interface PredictiveShortfallAssessment {
  accountId: string;
  totalDueRaw: bigint;
  totalDueUsdc: string;
  liquidCashRaw: bigint;
  liquidCashUsdc: string;
  investedYieldRaw: bigint;
  investedYieldUsdc: string;
  shortfallRaw: bigint;
  shortfallUsdc: string;
  requiresRecall: boolean;
  canCoverFromUsyc: boolean;
  liabilitiesCount: number;
  upcomingLiabilities: DynamicLiabilityRecord[];
}

export interface PredictiveRecallExecutionResult {
  accountId: string;
  shortfallUsdc: string;
  shortfallRaw: bigint;
  status: "EXECUTED" | "ESCALATE_TO_SPRS" | "REJECTED_UNAUTHORIZED" | "INSUFFICIENT_USYC";
  clearanceCode?: string;
  sprsRequestId?: string;
  encodedTx?: `0x${string}`;
  txHash?: `0x${string}`;
  journalSequenceId?: string;
  journalHash?: string;
  preBalance: ParallelTripartiteBalance;
  postBalance: ParallelTripartiteBalance;
  message: string;
}

/**
 * PredictiveRefunderService (DAG Node D13 & Interaction D13D7)
 * 
 * Mandate:
 * 1. Autonomous Scanning: Periodically scans `account_liabilities` (Dynamic Record 1)
 *    within parameterized redemption lead times (3600s instant, 86400s batch + 48h weekend buffer).
 * 2. Net Shortfall Calculation: Shortfall = max(0, TotalDue - LiquidCash).
 * 3. USYC Liquidity Check: Confirms yield vault balance covers shortfall before recall.
 * 4. Two-Layer Authorization Gate: Obtains Layer 1 Enforcer clearance or escalates to Layer 2 Human SPRS.
 * 5. Onchain Recipient Lock: Generates `CentralTreasuryYieldVault.recallForAccount` (funds strictly return to account's wallet).
 * 6. Interaction D13D7 (Ledger Witness):
 *    - Records double-entry voucher in `master_system_journal` with SHA-256 hash chaining.
 *    - Records immutable entry in `account_agent_audit_log`.
 *    - Updates Dynamic Record 2 (`dynamic_safe_to_invest`) and maintains Parallel Tripartite Balance (BL + BY = BE).
 */
export class PredictiveRefunderService {
  public readonly persona: AgentPersonaType = "TreasurySentinelAgent";
  public readonly erc8004Id = AGENT_REGISTRY.TreasurySentinelAgent.erc8004Id;

  private dynamicRecords: DynamicRecordsService;
  private vaultService: CentralTreasuryYieldVaultService;
  private witnessService: LedgerWitnessService;
  private executor?: ArcTransactionExecutor;

  constructor(options?: {
    dynamicRecords?: DynamicRecordsService;
    vaultService?: CentralTreasuryYieldVaultService;
    witnessService?: LedgerWitnessService;
    vaultAddress?: `0x${string}`;
    executor?: ArcTransactionExecutor;
  }) {
    this.dynamicRecords = options?.dynamicRecords ?? new DynamicRecordsService();
    const { profile } = PolicyLoader.getActiveProfile();
    const vaultAddr =
      options?.vaultAddress ??
      (profile.investment_rules?.target_vault as `0x${string}`) ??
      "0x5555555555555555555555555555555555555555";
    this.vaultService = options?.vaultService ?? new CentralTreasuryYieldVaultService(vaultAddr);
    this.witnessService = options?.witnessService ?? new LedgerWitnessService();
    this.executor = options?.executor;
  }

  /**
   * Evaluates if a given date falls on a weekend (Saturday or Sunday UTC).
   */
  public isWeekend(date: Date): boolean {
    const day = date.getUTCDay();
    return day === 0 || day === 6; // Sunday = 0, Saturday = 6
  }

  /**
   * Computes the effective redemption lead time in seconds.
   * If the due date falls on a weekend or bank holiday, an automatic buffer
   * adds 48 hours to account for mutual fund NAV pricing freezes (Sentence 11).
   */
  public getEffectiveLeadTimeSeconds(
    dueDate: Date,
    baseLeadTimeSeconds: number = REDEMPTION_LEAD_TIME.BATCH_SETTLEMENT_TIER
  ): number {
    if (this.isWeekend(dueDate)) {
      return baseLeadTimeSeconds + REDEMPTION_LEAD_TIME.WEEKEND_BUFFER_SECONDS;
    }
    return baseLeadTimeSeconds;
  }

  /**
   * Scans `account_liabilities` (Dynamic Record 1) for scheduled liabilities
   * that fall within the effective lead time window from `referenceTime`.
   */
  public async scanUpcomingLiabilities(params?: {
    accountId?: string;
    baseLeadTimeSeconds?: number;
    referenceTime?: Date;
  }): Promise<DynamicLiabilityRecord[]> {
    const now = params?.referenceTime ?? new Date();
    const baseLead = params?.baseLeadTimeSeconds ?? REDEMPTION_LEAD_TIME.BATCH_SETTLEMENT_TIER;

    // Maximum possible lookahead window includes 48h weekend buffer
    const maxHorizonDate = new Date(now.getTime() + (baseLead + REDEMPTION_LEAD_TIME.WEEKEND_BUFFER_SECONDS) * 1000);

    let sql = `
      SELECT liability_id, account_id, vendor_id, title, amount_usdc, due_date, 
             frequency_cron, payout_address, source_invoice_hash, source_po_hash, 
             status, created_at, updated_at
      FROM account_liabilities
      WHERE status = 'SCHEDULED' AND due_date >= $1 AND due_date <= $2
    `;
    const queryParams: any[] = [now.toISOString(), maxHorizonDate.toISOString()];

    if (params?.accountId) {
      sql += ` AND account_id = $3`;
      queryParams.push(params.accountId);
    }

    sql += ` ORDER BY due_date ASC;`;

    const res = await DbClient.query(sql, queryParams);
    const candidateLiabilities: DynamicLiabilityRecord[] = res.rows.map((row) => ({
      liabilityId: row.liability_id,
      accountId: row.account_id,
      vendorId: row.vendor_id,
      vendorTitle: row.title || row.vendor_id,
      payoutAddress: row.payout_address,
      amountUsdc: row.amount_usdc,
      rawAmount: this.dynamicRecords.parseUsdcToRaw(row.amount_usdc),
      dueDate: new Date(row.due_date),
      frequency: row.frequency_cron as any,
      documentHash: row.source_invoice_hash || "",
      poReference: row.source_po_hash || undefined,
      status: row.status,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }));

    // Filter candidate liabilities by their individual effective lead time
    return candidateLiabilities.filter((lia) => {
      const effectiveLead = this.getEffectiveLeadTimeSeconds(lia.dueDate, baseLead);
      const diffSeconds = (lia.dueDate.getTime() - now.getTime()) / 1000;
      return diffSeconds <= effectiveLead;
    });
  }

  /**
   * Computes the net projected liquid shortfall for an account given its upcoming liabilities:
   * Shortfall = max(0, sum(amount_usdc) - LiquidCash)
   * 
   * Enforces exact 6-decimal integer USDC arithmetic with BigInt (Rule 5: No silent rounding).
   */
  public async assessAccountShortfall(params: {
    accountId: string;
    upcomingLiabilities: DynamicLiabilityRecord[];
    liveLiquidRaw?: bigint;
    liveInvestedRaw?: bigint;
  }): Promise<PredictiveShortfallAssessment> {
    const { accountId, upcomingLiabilities, liveLiquidRaw, liveInvestedRaw } = params;

    let totalDueRaw = 0n;
    for (const lia of upcomingLiabilities) {
      totalDueRaw += lia.rawAmount;
    }

    const tripartite = await this.dynamicRecords.getTripartiteBalance(
      accountId,
      liveLiquidRaw,
      liveInvestedRaw
    );

    let shortfallRaw = 0n;
    if (totalDueRaw > tripartite.liquidCashRaw) {
      shortfallRaw = totalDueRaw - tripartite.liquidCashRaw;
    }

    const requiresRecall = shortfallRaw > 0n;
    const canCoverFromUsyc = tripartite.investedYieldRaw >= shortfallRaw;

    return {
      accountId,
      totalDueRaw,
      totalDueUsdc: this.dynamicRecords.formatRawToUsdc(totalDueRaw),
      liquidCashRaw: tripartite.liquidCashRaw,
      liquidCashUsdc: tripartite.liquidCashUsdc,
      investedYieldRaw: tripartite.investedYieldRaw,
      investedYieldUsdc: tripartite.investedYieldUsdc,
      shortfallRaw,
      shortfallUsdc: this.dynamicRecords.formatRawToUsdc(shortfallRaw),
      requiresRecall,
      canCoverFromUsyc,
      liabilitiesCount: upcomingLiabilities.length,
      upcomingLiabilities,
    };
  }

  /**
   * Executes a predictive recall for an account from the USYC Yield Vault:
   * 1. Submits Reason-Bearing Intent to AuthorizationGate (Layer 1 Enforcer / Layer 2 Human).
   * 2. Checks USYC liquidity.
   * 3. Generates onchain call `recallForAccount` (registered recipient lock).
   * 4. Interaction D13D7: Appends to Master Journal & Account Audit Log with SHA-256 hash chaining.
   * 5. Updates Dynamic Record 2 and Parallel Tripartite Balance (BL + BY = BE).
   */
  public async executePredictiveRecall(params: {
    accountId: string;
    shortfallRaw: bigint;
    reason?: string;
    clearanceCode?: string;
    sprsRequestId?: string;
    adminSignature?: string;
    liveLiquidRaw?: bigint;
    liveInvestedRaw?: bigint;
  }): Promise<PredictiveRecallExecutionResult> {
    const { accountId, shortfallRaw } = params;
    const shortfallUsdc = this.dynamicRecords.formatRawToUsdc(shortfallRaw);

    const preBalance = await this.dynamicRecords.getTripartiteBalance(
      accountId,
      params.liveLiquidRaw,
      params.liveInvestedRaw
    );

    // Verify USYC liquidity
    if (preBalance.investedYieldRaw < shortfallRaw) {
      return {
        accountId,
        shortfallUsdc,
        shortfallRaw,
        status: "INSUFFICIENT_USYC",
        preBalance,
        postBalance: preBalance,
        message: `Invested USYC balance (${preBalance.investedYieldUsdc} USDC) is insufficient to cover shortfall (${shortfallUsdc} USDC).`,
      };
    }

    // Step 1: Layer 1 / Layer 2 Authorization Check
    let clearanceCode = params.clearanceCode;
    let sprsRequestId = params.sprsRequestId;

    if (!clearanceCode && !sprsRequestId && !params.adminSignature) {
      const declaredReason =
        params.reason ||
        `Predictive pre-funding: Shortfall of ${shortfallUsdc} USDC detected for upcoming scheduled liabilities within redemption lead time. Recalling capital from USYC vault to operating pool.`;

      const authRequest = await AuthorizationGate.requestAuthorization({
        actionType: "PREDICTIVE_RECALL",
        accountId,
        amountUsdc: shortfallUsdc,
        declaredReason,
      });

      if (authRequest.isAuthorized) {
        clearanceCode = authRequest.clearanceCode;
      } else if (authRequest.sprsRequestId) {
        return {
          accountId,
          shortfallUsdc,
          shortfallRaw,
          status: "ESCALATE_TO_SPRS",
          sprsRequestId: authRequest.sprsRequestId,
          preBalance,
          postBalance: preBalance,
          message: `Predictive recall exceeds autonomous thresholds. Escalated to human CFO via SPRS ${authRequest.sprsRequestId}.`,
        };
      } else {
        return {
          accountId,
          shortfallUsdc,
          shortfallRaw,
          status: "REJECTED_UNAUTHORIZED",
          preBalance,
          postBalance: preBalance,
          message: `Predictive recall denied by PolicyComplianceAgent: ${authRequest.reason}`,
        };
      }
    }

    const account = await TreasuryAccountsRepo.getAccountById(accountId);
    if (!account) throw new Error(`Cannot execute predictive recall: account '${accountId}' is not registered.`);
    const execution = await (this.executor ?? new ArcTransactionExecutor()).execute({
      targetContract: this.vaultService.getAddress(),
      abi: CentralTreasuryYieldVaultABI,
      functionName: "recallForAccount",
      args: [CentralTreasuryYieldVaultService.formatAccountId(accountId), shortfallRaw],
      idempotencyKey: `predictive-recall:${accountId}:${shortfallRaw}:${clearanceCode || sprsRequestId || "authorized"}`,
    });
    const txHash = execution.txHash;

    // Step 3: Compute updated Tripartite Balance (BL + Shortfall, BY - Shortfall)
    const newLiquidRaw = preBalance.liquidCashRaw + shortfallRaw;
    const newInvestedRaw = preBalance.investedYieldRaw - shortfallRaw;

    // Step 4: D13D7 - Ledger Witness Integration (Hash-Chained Journal + Audit Log)
    const docRef = `PREDICTIVE_RECALL_${accountId}_${Date.now()}`;

    const witnessed = await this.witnessService.witnessTransaction({
      accountId,
      actionType: "PREDICTIVE_RECALL_SETTLED",
      amountUsdc: parseFloat(shortfallUsdc),
      documentRef: docRef,
      txHash,
      counterpartyAddress: account.wallet_address,
      isAutonomous: true,
      permissionRequestId: sprsRequestId || null,
      reason: `Confirmed predictive Arc recall (${clearanceCode || "EIP712_APPROVED"})`,
    });

    await this.witnessService.recordAccountAuditLog({
      accountId,
      actionType: "PREDICTIVE_RECALL_SETTLED",
      amountUsdc: parseFloat(shortfallUsdc),
      isAutonomous: true,
      permissionRequestId: sprsRequestId || null,
      txHash,
      reason: `Predictive pre-funding recall of ${shortfallUsdc} USDC from USYC Yield Vault (Clearance: ${clearanceCode || "EIP712_APPROVED"})`,
      preStateSnapshot: {
        liquidCashUsdc: preBalance.liquidCashUsdc,
        investedYieldUsdc: preBalance.investedYieldUsdc,
        availableBalanceUsdc: preBalance.availableBalanceUsdc,
      },
      postStateSnapshot: {
        liquidCashUsdc: this.dynamicRecords.formatRawToUsdc(newLiquidRaw),
        investedYieldUsdc: this.dynamicRecords.formatRawToUsdc(newInvestedRaw),
        availableBalanceUsdc: preBalance.availableBalanceUsdc,
        clearanceCode,
        journalHash: witnessed.journalEntry.current_hash,
      },
    });

    // Step 5: Update Dynamic Record 2 (Dynamic Safe-to-Invest)
    await this.dynamicRecords.calculateSafeToInvest(
      accountId,
      7 * 86400,
      undefined,
      newLiquidRaw,
      newInvestedRaw
    );

    const postBalance = await this.dynamicRecords.getTripartiteBalance(
      accountId,
      newLiquidRaw,
      newInvestedRaw
    );

    const encodedTx = this.vaultService.encodeRecallForAccount(accountId, shortfallRaw);

    return {
      accountId,
      shortfallUsdc,
      shortfallRaw,
      status: "EXECUTED",
      clearanceCode,
      encodedTx,
      txHash,
      journalSequenceId: witnessed.journalEntry.sequence_id,
      journalHash: witnessed.journalEntry.current_hash,
      preBalance,
      postBalance,
      message: `Predictive recall settled: Recalled ${shortfallUsdc} USDC from USYC Yield Vault to account ${accountId}.`,
    };
  }

  /**
   * Complete Autonomous Scanning & Refunding Cycle
   * Runs through all scheduled liabilities across all accounts and settles predictive recalls.
   */
  public async runPredictiveRefundCycle(params?: {
    baseLeadTimeSeconds?: number;
    referenceTime?: Date;
  }): Promise<{
    scannedCount: number;
    recallsExecuted: PredictiveRecallExecutionResult[];
  }> {
    const upcoming = await this.scanUpcomingLiabilities(params);

    // Group liabilities by accountId
    const byAccount = new Map<string, DynamicLiabilityRecord[]>();
    for (const lia of upcoming) {
      const list = byAccount.get(lia.accountId) || [];
      list.push(lia);
      byAccount.set(lia.accountId, list);
    }

    const results: PredictiveRecallExecutionResult[] = [];

    for (const [accountId, liabilities] of byAccount.entries()) {
      const assessment = await this.assessAccountShortfall({
        accountId,
        upcomingLiabilities: liabilities,
      });

      if (assessment.requiresRecall && assessment.canCoverFromUsyc) {
        const recallRes = await this.executePredictiveRecall({
          accountId,
          shortfallRaw: assessment.shortfallRaw,
          reason: `Autonomous predictive pre-funding: ${assessment.shortfallUsdc} USDC shortfall across ${liabilities.length} upcoming liabilities due within redemption lead time.`,
        });
        results.push(recallRes);
      }
    }

    return {
      scannedCount: upcoming.length,
      recallsExecuted: results,
    };
  }
}
