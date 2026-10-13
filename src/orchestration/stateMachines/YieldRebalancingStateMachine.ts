/**
 * Machine 3: Automated Treasury Yield Engine & Dynamic Records State Machine.
 * ===========================================================================
 * Governs the real-time evaluation of Dynamic Record 1 (Liabilities) and
 * Dynamic Record 2 (Safe-to-Invest), maintains the parallel tripartite balance,
 * and executes autonomous USYC sweeps and deficit recalls inside policy envelopes.
 */

import { TreasurySentinelService, BalanceMutationEvent, SentinelEvaluationResult } from "../../services/treasurySentinelService.js";
import { DynamicRecordsService } from "../../records/dynamicRecordsService.js";
import { TreasurySentinelLlmAgent } from "../../agents/treasurySentinelLlmAgent.js";
import { TokenSwapService } from "../../services/tokenSwapService.js";
import { StateMachineExecutionResult, StateMachineTransitionRecord } from "./types.js";

export type YieldRebalancingState =
  | "MUTATION_DETECTED"
  | "TOKEN_SWAP_CONVERTED"
  | "INTERNAL_FILTERED"
  | "DEBOUNCED"
  | "RECORD_2_RECALCULATED"
  | "SURPLUS_SWEEP_EXECUTED"
  | "DEFICIT_RECALL_EXECUTED"
  | "HYSTERESIS_SUPPRESSED"
  | "PROTECTED_ACCOUNT_IGNORED"
  | "FAILED";

export class YieldRebalancingStateMachine {
  private sentinelService: TreasurySentinelService;
  private dynamicRecords: DynamicRecordsService;
  private sentinelAgent: TreasurySentinelLlmAgent;
  private swapService: TokenSwapService;
  private transitionLog: StateMachineTransitionRecord[] = [];

  constructor(
    sentinelService?: TreasurySentinelService,
    dynamicRecords?: DynamicRecordsService,
    sentinelAgent?: TreasurySentinelLlmAgent,
    swapService?: TokenSwapService
  ) {
    this.sentinelService = sentinelService ?? new TreasurySentinelService();
    this.dynamicRecords = dynamicRecords ?? new DynamicRecordsService();
    this.sentinelAgent = sentinelAgent ?? new TreasurySentinelLlmAgent();
    this.swapService = swapService ?? new TokenSwapService();
  }

  private logTransition(instanceId: string, from: string, to: string, trigger: string, details?: any) {
    this.transitionLog.push({
      machineName: "YIELD_REBALANCING_STATE_MACHINE",
      instanceId,
      fromState: from,
      toState: to,
      trigger,
      actorAgentId: 101,
      actorAgentName: "TreasurySentinelAgent",
      timestamp: new Date(),
      details,
    });
  }

  /**
   * Primary Entry Point: Invoked by Arc L1 event listener or post-settlement balance changes.
   */
  public async handleBalanceMutation(
    event: BalanceMutationEvent
  ): Promise<StateMachineExecutionResult<SentinelEvaluationResult>> {
    const instanceId = `YIELD-${event.accountId}-${Date.now()}`;
    this.logTransition(instanceId, "INITIAL", "MUTATION_DETECTED", "BALANCE_MUTATION_EVENT", {
      origin: event.origin,
      amountUsdc: event.amountUsdc,
    });

    try {
      // 1. Loop Protection: Filter internal settlements
      if (this.sentinelService.isInternalSettlement(event)) {
        this.logTransition(instanceId, "MUTATION_DETECTED", "INTERNAL_FILTERED", "INTERNAL_SETTLEMENT_SUPPRESSED", {
          origin: event.origin,
        });

        return {
          success: true,
          machineName: "YIELD_REBALANCING_STATE_MACHINE",
          instanceId,
          currentState: "INTERNAL_FILTERED",
          data: {
            accountId: event.accountId,
            liquidBalanceUsdc: event.currentLiquidBalanceUsdc,
            targetReserveUsdc: 0,
            safeToInvestUsdc: 0,
            action: "NONE",
            actionAmountUsdc: 0,
            branch: "FILTERED_INTERNAL",
            reason: `Filtered internal settlement event from origin '${event.origin}' to prevent feedback loop.`,
          },
          unbrokenChainLog: [...this.transitionLog],
        };
      }

      // 1.5 Non-USDC Token Auto-Conversion: Swap non-USDC token inflows into USDC before yield sweep
      const incomingToken = (event as any).incomingToken;
      if (incomingToken && incomingToken.toUpperCase() !== "USDC" && incomingToken.toUpperCase() !== "NATIVE") {
        const swapResult = await this.swapService.executeSwap({
          accountId: event.accountId,
          fromChain: (event as any).chain || "Ethereum",
          fromToken: incomingToken,
          toChain: "Arc",
          toToken: "USDC",
          amount: ((event as any).incomingAmount || event.amountUsdc).toString(),
          declaredReason: `Auto-conversion of incoming ${incomingToken} to USDC for treasury yield optimization`,
        });

        if (swapResult.success) {
          const convertedUsdc = parseFloat(swapResult.toAmount);
          event.amountUsdc = convertedUsdc;
          event.currentLiquidBalanceUsdc += convertedUsdc;

          this.logTransition(instanceId, "MUTATION_DETECTED", "TOKEN_SWAP_CONVERTED", "TOKEN_SWAPPED_TO_USDC", {
            swapId: swapResult.swapId,
            fromToken: incomingToken,
            toAmountUsdc: convertedUsdc,
            realizedRate: swapResult.realizedRate,
          });
        }
      }

      // 2. State: Debounced & Recalculate Dynamic Record 2
      this.logTransition(instanceId, "MUTATION_DETECTED", "DEBOUNCED", "DEBOUNCE_PASSED");
      const safeToInvestCalc = await this.dynamicRecords.calculateSafeToInvest(event.accountId);

      this.logTransition(instanceId, "DEBOUNCED", "RECORD_2_RECALCULATED", "SAFE_TO_INVEST_COMPUTED", {
        safeToInvestUsdc: safeToInvestCalc.safeToInvestUsdc,
        timeHorizonSeconds: safeToInvestCalc.timeHorizonSeconds,
        targetReserveUsdc: safeToInvestCalc.targetReserveUsdc,
      });

      // 3. State: Autonomous LLM Agent Liquidity Deliberation & Tool Execution
      await this.sentinelAgent.rebalanceAccountLiquidity(instanceId, {
        accountId: event.accountId,
        amountUsdc: event.amountUsdc,
        currentLiquidBalanceUsdc: event.currentLiquidBalanceUsdc,
        origin: event.origin,
      });

      const evalResult = await this.sentinelService.onBalanceMutation(event);

      let finalState: YieldRebalancingState = "HYSTERESIS_SUPPRESSED";
      if (evalResult.action === "SWEEP") {
        finalState = "SURPLUS_SWEEP_EXECUTED";
      } else if (evalResult.action === "RECALL") {
        finalState = "DEFICIT_RECALL_EXECUTED";
      } else if (evalResult.branch === "PROTECTED_ACCOUNT") {
        finalState = "PROTECTED_ACCOUNT_IGNORED";
      }

      this.logTransition(instanceId, "RECORD_2_RECALCULATED", finalState, evalResult.action, {
        actionAmountUsdc: evalResult.actionAmountUsdc,
        clearanceCode: evalResult.clearanceCode,
        branch: evalResult.branch,
      });

      return {
        success: true,
        machineName: "YIELD_REBALANCING_STATE_MACHINE",
        instanceId,
        currentState: finalState,
        data: evalResult,
        unbrokenChainLog: [...this.transitionLog],
      };
    } catch (err: any) {
      this.logTransition(instanceId, "MUTATION_DETECTED", "FAILED", "ERROR", { error: err.message });
      return {
        success: false,
        machineName: "YIELD_REBALANCING_STATE_MACHINE",
        instanceId,
        currentState: "FAILED",
        error: err.message,
        unbrokenChainLog: [...this.transitionLog],
      };
    }
  }

  /**
   * Recalculates Safe-to-Invest explicitly when liabilities are added or edited.
   */
  public async recalculateForAccount(accountId: string): Promise<StateMachineExecutionResult<any>> {
    const tripartite = await this.dynamicRecords.getTripartiteBalance(accountId);
    return this.handleBalanceMutation({
      accountId,
      amountUsdc: 0,
      currentLiquidBalanceUsdc: parseFloat(tripartite.liquidCashUsdc),
      origin: "LIABILITY_RECALCULATION",
      forceImmediate: true,
    });
  }
}
