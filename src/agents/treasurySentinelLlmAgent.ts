import { BaseLlmAgent } from "./core/BaseLlmAgent.js";

export class TreasurySentinelLlmAgent extends BaseLlmAgent {
  constructor(deps?: Partial<ConstructorParameters<typeof BaseLlmAgent>[0]>) {
    super({
      agentId: 101,
      agentName: "TreasurySentinelAgent",
      systemInstruction: `You are the TreasurySentinelAgent (ID #101) in the BizArc Autonomous Treasury Swarm.
Your primary mandate is liquidity orchestration and capital efficiency:
1. Process Flow & Tool Triggers:
   - Use 'get_unified_operational_state' to maintain vigilance over the 8-dimensional operational state and verify the Tripartite Invariant (BE = BL + BY).
   - Use 'get_yield_performance_metrics' to inspect cumulative historical yield accrual, deposits, withdrawals, and current APR.
   - Continuously recalculate Dynamic Safe-to-Invest via 'recalculate_safe_to_invest' (Record 2).
   - If non-USDC funds are received or held, use 'estimate_token_swap' and 'execute_token_swap' to convert them into Arc USDC before rebalancing.
   - For fiat funding, invoke 'create_fiat_onramp_session' for cards/ACH on-ramping or 'get_fiat_wire_deposit_instructions' for BNY Mellon / Circle Mint Fedwire deposits, and 'record_fiat_deposit' once confirmed.
   - If Safe-to-Invest indicates surplus capital (> 0): formulate reason-bearing intent, submit to PolicyComplianceAgent (#104) via 'evaluate_reason_bearing_intent' for a PERMIT clearance code, then execute 'sweep_excess_liquidity' into the tokenized US Treasury yield vault on Arc L1.
   - If scheduled liabilities within the time horizon exceed liquid reserves (RECALL_REQUIRED): submit reason-bearing intent to PolicyComplianceAgent (#104) and execute 'recall_invested_liquidity' or 'execute_predictive_recall' back to operating pools.
2. Guardrails:
   - All operations must strictly enforce exact 6-decimal math, respect clearance codes, and maintain corporate reserve floors.`,
      allowedTools: [
        "read_dynamic_records",
        "recalculate_safe_to_invest",
        "evaluate_reason_bearing_intent",
        "sweep_excess_liquidity",
        "recall_invested_liquidity",
        "scan_predictive_liabilities",
        "execute_predictive_recall",
        "query_vector_memory",
        "get_unified_operational_state",
        "get_yield_performance_metrics",
        "transfer_account_liquidity",
        "get_account_intelligence",
        "estimate_token_swap",
        "execute_token_swap",
        "create_fiat_onramp_session",
        "get_fiat_wire_deposit_instructions",
        "record_fiat_deposit",
      ],
      ...deps,
    });
  }

  /**
   * Autonomous LLM Dynamic Yield Rebalancing & Liquidity Management.
   * Runs the full ReAct cognitive loop: scans Dynamic Records, evaluates Safe-to-Invest,
   * checks policy clearance, and executes sweep/recall/internal transfer tools.
   */
  public async rebalanceAccountLiquidity(
    sessionId: string,
    event: {
      accountId: string;
      amountUsdc: number;
      currentLiquidBalanceUsdc: number;
      origin: string;
    }
  ) {
    const task = `Evaluate Parallel Tripartite Balance ($B_E = B_L + B_Y$) and recalculate Dynamic Safe-to-Invest (Record 2) for account ${event.accountId} following balance mutation event from ${event.origin} (${event.amountUsdc} USDC). Assess upcoming liabilities and reserve floors according to defined investment rules. If Safe-to-Invest indicates surplus capital, formulate reason-bearing intent, obtain clearance code from PolicyComplianceAgent (#104), and execute tool 'sweep_excess_liquidity' to USYC Yield Vault on Arc L1. If deficit exists, formulate intent and execute tool 'recall_invested_liquidity'. If intra-account rebalancing is required, invoke 'transfer_account_liquidity'.`;
    return this.executeTask(sessionId, task, event);
  }

  /**
   * Autonomous LLM Liquidity Evaluation & Surplus Sweeping.
   * Runs the ReAct deliberation loop through the model-agnostic LLM engine.
   */
  public async evaluateLiquidityAndSweep(sessionId: string, accountId: string, customAmount?: string) {
    const task = customAmount
      ? `Assess Parallel Tripartite Balance and Dynamic Safe-to-Invest for account ${accountId}. Execute autonomous sweep of ${customAmount} USDC into USYC Yield Vault on Arc L1 with compliance clearance.`
      : `Assess Parallel Tripartite Balance and calculate Dynamic Safe-to-Invest for account ${accountId}. If Safe-to-Invest indicates surplus capital, execute autonomous sweep to USYC Yield Vault on Arc L1 with compliance clearance.`;
    return this.executeTask(sessionId, task, { accountId, customAmount, proposedAction: "AUTONOMOUS_SWEEP" });
  }

  /**
   * Autonomous LLM Liquidity Evaluation & Deficit Recalling.
   * Runs the ReAct deliberation loop through the model-agnostic LLM engine.
   */
  public async evaluateLiquidityAndRecall(sessionId: string, accountId: string, customAmount?: string) {
    const task = customAmount
      ? `Assess Parallel Tripartite Balance and Dynamic Safe-to-Invest for account ${accountId}. Liquidity deficit detected: execute autonomous emergency recall of ${customAmount} USDC from USYC Yield Vault back to operating pool.`
      : `Assess Parallel Tripartite Balance and calculate Dynamic Safe-to-Invest for account ${accountId}. If Safe-to-Invest indicates RECALL_REQUIRED, execute autonomous emergency recall of USYC shares to restore operating reserve floor.`;
    return this.executeTask(sessionId, task, { accountId, customAmount, proposedAction: "AUTONOMOUS_RECALL" });
  }
}

export { TreasurySentinelLlmAgent as TreasurySentinelAgent };
