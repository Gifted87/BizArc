import { keccak256, stringToHex } from "viem";
import { AGENT_REGISTRY, AgentPersonaType } from "../types/agents.js";
import { StandardizedPermissionRequest, SPROption, SPRActionType } from "../types/sprs.js";
import { PolicyLoader } from "../config/policyLoader.js";
import { TreasuryAccountsRepo } from "../database/repos/treasuryAccountsRepo.js";
import { PermissionRequestRepo } from "../database/repos/permissionRequestRepo.js";
import { CentralTreasuryYieldVaultService } from "../contracts/centralTreasuryYieldVaultService.js";
import { AccountIntelligenceService } from "./accountIntelligenceService.js";
import { LedgerWitnessService } from "./ledgerWitnessService.js";

export interface BalanceMutationEvent {
  accountId: string;
  amountUsdc: number;
  currentLiquidBalanceUsdc: number;
  origin: "EXTERNAL_REVENUE" | "INTERNAL_SETTLEMENT" | "FAUCET_DRIP" | "DISBURSAL" | "USYC_RECALL" | string;
  txHash?: `0x${string}`;
  from?: `0x${string}`;
  to?: `0x${string}`;
  timestamp?: Date;
  forceImmediate?: boolean;
}

export interface SentinelEvaluationResult {
  accountId: string;
  liquidBalanceUsdc: number;
  targetReserveUsdc: number;
  safeToInvestUsdc: number;
  action: "SWEEP" | "RECALL" | "NONE" | "SPRS_REQUIRED";
  actionAmountUsdc: number;
  branch: "INSIDE_RULES" | "OUTSIDE_RULES" | "FILTERED_INTERNAL" | "PROTECTED_ACCOUNT" | "BELOW_HYSTERESIS";
  reason: string;
  encodedTx?: `0x${string}`;
  sprs?: StandardizedPermissionRequest;
  witnessed?: boolean;
  timeHorizonSeconds?: number;
}

export class TreasurySentinelService {
  public readonly persona: AgentPersonaType = "TreasurySentinelAgent";
  public readonly erc8004Id = AGENT_REGISTRY.TreasurySentinelAgent.erc8004Id; // 101
  public readonly canSignTransactions = AGENT_REGISTRY.TreasurySentinelAgent.canSignTransactions; // true
  public readonly canWriteLedger = AGENT_REGISTRY.TreasurySentinelAgent.canWriteLedger; // false

  private accountIntelligenceService: AccountIntelligenceService;
  private vaultService: CentralTreasuryYieldVaultService;
  private witnessAgent: LedgerWitnessService;

  // Concurrency lock manager (D10.4)
  private accountLocks: Set<string> = new Set();

  // Debounce manager (D10.2)
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private pendingDebounceEvents: Map<string, BalanceMutationEvent> = new Map();
  private debounceMs: number;

  constructor(options?: {
    intelService?: AccountIntelligenceService;
    vaultService?: CentralTreasuryYieldVaultService;
    witnessAgent?: LedgerWitnessService;
    debounceMs?: number;
    vaultAddress?: `0x${string}`;
  }) {
    const { profile } = PolicyLoader.getActiveProfile();
    const vaultAddr = options?.vaultAddress ?? (profile.investment_rules?.target_vault as `0x${string}`) ?? "0x5555555555555555555555555555555555555555";
    this.vaultService = options?.vaultService ?? new CentralTreasuryYieldVaultService(vaultAddr);
    this.accountIntelligenceService = options?.intelService ?? new AccountIntelligenceService();
    this.witnessAgent = options?.witnessAgent ?? new LedgerWitnessService();
    this.debounceMs = options?.debounceMs ?? 5000;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // D10.4 CONCURRENCY ACCOUNT LOCK MANAGEMENT
  // ─────────────────────────────────────────────────────────────────────────────
  public isAccountLocked(accountId: string): boolean {
    return this.accountLocks.has(accountId);
  }

  public acquireAccountLock(accountId: string): boolean {
    if (this.accountLocks.has(accountId)) {
      return false;
    }
    this.accountLocks.add(accountId);
    return true;
  }

  public releaseAccountLock(accountId: string): void {
    this.accountLocks.delete(accountId);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // D10.3 INTERNAL-SETTLEMENT FILTERING
  // ─────────────────────────────────────────────────────────────────────────────
  public isInternalSettlement(event: BalanceMutationEvent): boolean {
    if (
      event.origin === "INTERNAL_SETTLEMENT" ||
      event.origin === "USYC_RECALL" ||
      event.origin === "AUTONOMOUS_SWEEP" ||
      event.origin === "DISBURSAL_STAGING"
    ) {
      return true;
    }

    const { profile } = PolicyLoader.getActiveProfile();
    const vaultAddr = ((profile.investment_rules?.target_vault as string) || "").toLowerCase();
    const disbursalAddr = "0x5555555555555555555555555555555555555555".toLowerCase();

    if (event.from && (event.from.toLowerCase() === vaultAddr || event.from.toLowerCase() === disbursalAddr)) {
      return true;
    }
    if (event.to && (event.to.toLowerCase() === vaultAddr || event.to.toLowerCase() === disbursalAddr)) {
      return true;
    }

    return false;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // D10.1 & D10.2 BALANCE EVENT INGESTION & DEBOUNCE
  // ─────────────────────────────────────────────────────────────────────────────
  public async onBalanceMutation(
    event: BalanceMutationEvent
  ): Promise<SentinelEvaluationResult> {
    if (this.isInternalSettlement(event)) {
      return {
        accountId: event.accountId,
        liquidBalanceUsdc: event.currentLiquidBalanceUsdc,
        targetReserveUsdc: 0,
        safeToInvestUsdc: 0,
        action: "NONE",
        actionAmountUsdc: 0,
        branch: "FILTERED_INTERNAL",
        reason: `Filtered internal settlement event from origin '${event.origin}' to prevent feedback loop.`,
      };
    }

    if (event.forceImmediate) {
      return this.executeEvaluation(event.accountId, event.currentLiquidBalanceUsdc);
    }

    return new Promise((resolve, reject) => {
      if (this.debounceTimers.has(event.accountId)) {
        clearTimeout(this.debounceTimers.get(event.accountId)!);
      }

      this.pendingDebounceEvents.set(event.accountId, event);

      const timer = setTimeout(async () => {
        try {
          const pending = this.pendingDebounceEvents.get(event.accountId) || event;
          this.debounceTimers.delete(event.accountId);
          this.pendingDebounceEvents.delete(event.accountId);
          const result = await this.executeEvaluation(pending.accountId, pending.currentLiquidBalanceUsdc);
          resolve(result);
        } catch (err) {
          reject(err);
        }
      }, this.debounceMs);

      this.debounceTimers.set(event.accountId, timer);
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // D10.5 - D10.9 CORE EVALUATION & POLICY COMPLIANCE
  // ─────────────────────────────────────────────────────────────────────────────
  public async evaluateAccount(
    accountId: string,
    currentLiquidBalanceUsdc: number
  ): Promise<SentinelEvaluationResult> {
    return this.executeEvaluation(accountId, currentLiquidBalanceUsdc);
  }

  private async executeEvaluation(
    accountId: string,
    currentLiquidBalanceUsdc: number
  ): Promise<SentinelEvaluationResult> {
    if (!this.acquireAccountLock(accountId)) {
      throw new Error(`[TreasurySentinelService] Concurrency lock failed: Account '${accountId}' is currently being evaluated.`);
    }

    try {
      const accountRecord = await TreasuryAccountsRepo.getAccountById(accountId);
      if (!accountRecord) {
        throw new Error(`[TreasurySentinelService] Account '${accountId}' not found in registry.`);
      }

      const { profile } = PolicyLoader.getActiveProfile();
      const opPolicy = profile.operating_accounts.find((a) => a.account_id === accountId);
      const invRules = profile.investment_rules;
      const spendingLimits = profile.spending_limits;

      if (
        opPolicy?.exclude_from_waterfall_draws ||
        (opPolicy?.max_autonomous_sweep_limit !== undefined && opPolicy.max_autonomous_sweep_limit <= 0)
      ) {
        return {
          accountId,
          liquidBalanceUsdc: currentLiquidBalanceUsdc,
          targetReserveUsdc: 0,
          safeToInvestUsdc: 0,
          action: "NONE",
          actionAmountUsdc: 0,
          branch: "PROTECTED_ACCOUNT",
          reason: `Account '${accountId}' is locked under strict corporate protection (exclude_from_waterfall_draws). Zero sweeps allowed.`,
        };
      }

      const intel = await this.accountIntelligenceService.getAccountIntelligence(accountId, {
        overrideLiquidBalance: currentLiquidBalanceUsdc,
      });

      const targetReserveUsdc = parseFloat(intel.solvencyMetrics.requiredReserveUsdc);
      const timeHorizonSeconds = intel.solvencyMetrics.timeHorizonSeconds;

      const rawSurplus = Math.max(
        0,
        currentLiquidBalanceUsdc - (targetReserveUsdc + invRules.invest_hysteresis_band_usdc)
      );

      if (rawSurplus < invRules.min_sweep_amount_usdc) {
        const recallThreshold = targetReserveUsdc - invRules.recall_hysteresis_band_usdc;
        if (currentLiquidBalanceUsdc < recallThreshold) {
          const recallAmount = Number((targetReserveUsdc - currentLiquidBalanceUsdc).toFixed(6));
          const encodedTx = this.vaultService.encodeRecallForAccount(
            accountId,
            BigInt(Math.floor(recallAmount * 1_000_000))
          );
          return {
            accountId,
            liquidBalanceUsdc: currentLiquidBalanceUsdc,
            targetReserveUsdc,
            safeToInvestUsdc: 0,
            action: "RECALL",
            actionAmountUsdc: recallAmount,
            branch: "INSIDE_RULES",
            reason: `Liquid balance $${currentLiquidBalanceUsdc} dropped below recall threshold $${recallThreshold}. Deficit recall required.`,
            encodedTx,
            timeHorizonSeconds,
          };
        }

        return {
          accountId,
          liquidBalanceUsdc: currentLiquidBalanceUsdc,
          targetReserveUsdc,
          safeToInvestUsdc: 0,
          action: "NONE",
          actionAmountUsdc: 0,
          branch: "BELOW_HYSTERESIS",
          reason: `Surplus $${rawSurplus.toFixed(6)} is below minimum sweep threshold $${invRules.min_sweep_amount_usdc} USDC. Micro-sweep suppressed.`,
          timeHorizonSeconds,
        };
      }

      const singleTxLimit = (spendingLimits as any)?.per_transaction_limit_usdc ?? 5000;
      const maxSweepLimit = opPolicy?.max_autonomous_sweep_limit ?? singleTxLimit;

      const isInsideRules = rawSurplus <= maxSweepLimit && rawSurplus <= singleTxLimit;

      if (isInsideRules) {
        const sweepAmount = rawSurplus;
        const amountBigInt = BigInt(Math.floor(sweepAmount * 1_000_000));

        const encodedTx = this.vaultService.encodeSweepFromAccount(
          accountId,
          accountRecord.wallet_address,
          amountBigInt
        );

        const docRef = `SWEEP_INTENT_${accountId}_${Date.now()}`;

        await this.witnessAgent.recordJournalVoucher({
          accountId,
          actionType: "AUTONOMOUS_SWEEP",
          amountUsdc: sweepAmount,
          documentRef: docRef,
        });

        await this.witnessAgent.recordAccountAuditLog({
          accountId,
          actionType: "AUTONOMOUS_SWEEP",
          amountUsdc: sweepAmount,
          isAutonomous: true,
          reason: `Autonomous surplus sweep of $${sweepAmount.toFixed(6)} USDC to USYC Yield Vault`,
          preStateSnapshot: { liquidUsdc: currentLiquidBalanceUsdc },
          postStateSnapshot: {
            liquidUsdc: currentLiquidBalanceUsdc - sweepAmount,
            sweptUsdc: sweepAmount,
            targetReserveUsdc,
          },
        });

        return {
          accountId,
          liquidBalanceUsdc: currentLiquidBalanceUsdc,
          targetReserveUsdc,
          safeToInvestUsdc: sweepAmount,
          action: "SWEEP",
          actionAmountUsdc: sweepAmount,
          branch: "INSIDE_RULES",
          reason: `Autonomous surplus sweep qualified ($${sweepAmount.toFixed(6)} USDC) inside policy limits.`,
          encodedTx,
          witnessed: true,
          timeHorizonSeconds,
        };
      } else {
        const requestId = `SPRS-SWEEP-${accountId}-${Date.now()}`;
        const sweepAmount = rawSurplus;

        const options: SPROption[] = [
          {
            action: "APPROVE",
            label: "Approve High-Value Sweep",
          },
          {
            action: "REJECT",
            label: "Reject Sweep & Retain Liquid Cash",
          },
        ];

        const sprsPayload: StandardizedPermissionRequest = {
          requestId,
          timestamp: new Date().toISOString(),
          action: "HIGH_VALUE_SWEEP_EXEMPTION" as SPRActionType,
          reason: `High-value surplus sweep ($${sweepAmount.toFixed(6)} USDC) exceeds autonomous limit ($${maxSweepLimit} USDC). Human authorization required.`,
          amountUsdc: sweepAmount.toFixed(6),
          affectedAccounts: [
            {
              accountId: intel.metadata.accountId,
              role: intel.metadata.role,
              chain: intel.metadata.chain,
              address: intel.metadata.address,
              currentLiquidBalance: intel.balances.liquidUsdc,
              currentInvestedUsyc: intel.balances.investedUsycUsdcEquivalent,
              totalEffectiveBalance: intel.balances.totalEffectiveUsdc,
              committedLiabilities30d: intel.liabilities.dueNext30DaysUsdc,
              unencumberedBalance: intel.solvencyMetrics.unencumberedFreeCashUsdc,
              usycRecallAmount: "0.000000",
              postTxLiquidBalance: (currentLiquidBalanceUsdc - sweepAmount).toFixed(6),
              postTxInvestedUsyc: (parseFloat(intel.balances.investedUsycUsdcEquivalent) + sweepAmount).toFixed(6),
            },
          ],
          associatedRecords: {
            idempotencyKey: keccak256(stringToHex(`${accountId}|${sweepAmount}|${requestId}`)),
          },
          options,
          status: "PENDING",
        };

        await PermissionRequestRepo.createRequest({
          request_id: requestId,
          action_type: "HIGH_VALUE_SWEEP_EXEMPTION",
          reason: sprsPayload.reason,
          amount_usdc: sweepAmount,
          status: "PENDING",
          payload: sprsPayload as any,
        });

        await this.witnessAgent.recordAccountAuditLog({
          accountId,
          actionType: "SPRS_EMITTED",
          amountUsdc: sweepAmount,
          isAutonomous: true,
          permissionRequestId: requestId,
          reason: `Emitted high-value sweep permission request ${requestId}`,
          preStateSnapshot: { liquidUsdc: currentLiquidBalanceUsdc },
          postStateSnapshot: { status: "AWAITING_HUMAN_APPROVAL" },
        });

        return {
          accountId,
          liquidBalanceUsdc: currentLiquidBalanceUsdc,
          targetReserveUsdc,
          safeToInvestUsdc: sweepAmount,
          action: "SPRS_REQUIRED",
          actionAmountUsdc: sweepAmount,
          branch: "OUTSIDE_RULES",
          reason: `High-value sweep ($${sweepAmount.toFixed(6)} USDC) requires human gate approval.`,
          sprs: sprsPayload,
          timeHorizonSeconds,
        };
      }
    } finally {
      this.releaseAccountLock(accountId);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // HUMAN GATE RESOLUTION (D12 -> D11)
  // ─────────────────────────────────────────────────────────────────────────────
  public async resolveSweepDecision(params: {
    requestId: string;
    decision: "APPROVE" | "REJECT";
    adminInstructions?: string;
  }): Promise<{
    requestId: string;
    status: "APPROVED" | "REJECTED";
    actionExecuted: boolean;
    encodedTx?: `0x${string}`;
  }> {
    const sprs = await PermissionRequestRepo.getRequestById(params.requestId);
    if (!sprs) {
      throw new Error(`[TreasurySentinelService] Permission request '${params.requestId}' not found.`);
    }

    const accountId = sprs.payload.affectedAccounts[0]?.accountId;
    const amountUsdc = sprs.amount_usdc;

    if (params.decision === "APPROVE") {
      await PermissionRequestRepo.updateStatus({
        requestId: params.requestId,
        status: "APPROVED",
        adminInstruction: params.adminInstructions ?? "Approved by administrator.",
      });

      const accountRecord = await TreasuryAccountsRepo.getAccountById(accountId);
      const amountBigInt = BigInt(Math.floor(amountUsdc * 1_000_000));

      const encodedTx = this.vaultService.encodeSweepFromAccount(
        accountId,
        accountRecord?.wallet_address ?? "0x0",
        amountBigInt
      );

      const docRef = `SPRS_APPROVED_SWEEP_${params.requestId}`;

      await this.witnessAgent.recordJournalVoucher({
        accountId,
        actionType: "AUTONOMOUS_SWEEP",
        amountUsdc,
        documentRef: docRef,
      });

      await this.witnessAgent.recordAccountAuditLog({
        accountId,
        actionType: "SWEEP_APPROVED_AND_EXECUTED",
        amountUsdc,
        isAutonomous: false,
        permissionRequestId: params.requestId,
        reason: `Administrator approved high-value sweep of $${amountUsdc.toFixed(6)} USDC`,
        preStateSnapshot: { status: "AWAITING_HUMAN_APPROVAL" },
        postStateSnapshot: { status: "EXECUTED", amountUsdc },
      });

      return {
        requestId: params.requestId,
        status: "APPROVED",
        actionExecuted: true,
        encodedTx,
      };
    } else {
      await PermissionRequestRepo.updateStatus({
        requestId: params.requestId,
        status: "REJECTED",
        adminInstruction: params.adminInstructions ?? "Rejected by administrator.",
      });

      await this.witnessAgent.recordAccountAuditLog({
        accountId,
        actionType: "SWEEP_REJECTED",
        amountUsdc,
        isAutonomous: false,
        permissionRequestId: params.requestId,
        reason: `Administrator rejected high-value sweep: ${params.adminInstructions ?? "No reason given"}`,
        preStateSnapshot: { status: "AWAITING_HUMAN_APPROVAL" },
        postStateSnapshot: { status: "REJECTED" },
      });

      return {
        requestId: params.requestId,
        status: "REJECTED",
        actionExecuted: false,
      };
    }
  }
}
