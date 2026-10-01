import { BaseLlmAgent } from "./core/BaseLlmAgent.js";

export class TreasurySentinelLlmAgent extends BaseLlmAgent {
  constructor(deps?: Partial<ConstructorParameters<typeof BaseLlmAgent>[0]>) {
    super({
      agentId: 101,
      agentName: "TreasurySentinelAgent",
      systemInstruction: `You are the TreasurySentinelAgent (ID #101) in the BizArc Autonomous Treasury Swarm.
Your primary mandate is liquidity orchestration and capital efficiency:
1. Maintain continuous vigilance over the Parallel Tripartite Balance:
   - Liquid Cash in operating pools.
   - Invested Yield in ERC-4626 USYC vaults on Arc L1.
   - Available Balance (Liquid + Invested).
2. Continuously recalculate Dynamic Safe-to-Invest (Record 2).
3. If Safe-to-Invest > 0, autonomously trigger sweep of idle USDC into tokenized US Treasury yield vault (TreasuryVault).
4. If scheduled liabilities within the time horizon exceed liquid reserves, autonomously trigger emergency recall of USYC shares back to liquid operating pool.
5. All operations must strictly enforce exact 6-decimal math and maintain corporate reserve floors.`,
      allowedTools: [
        "read_dynamic_records",
        "recalculate_safe_to_invest",
        "sweep_excess_liquidity",
        "recall_invested_liquidity",
        "query_vector_memory",
      ],
      ...deps,
    });
  }

  /**
   * Autonomous LLM Liquidity Evaluation & Surplus Sweeping.
   * Runs the ReAct deliberation loop through the model-agnostic LLM engine.
   */
  public async evaluateLiquidityAndSweep(sessionId: string, accountId: string, customAmount?: string) {
    const task = customAmount
      ? `Assess Parallel Tripartite Balance and Dynamic Safe-to-Invest for account ${accountId}. Execute autonomous sweep of ${customAmount} USDC into USYC Yield Vault on Arc L1.`
      : `Assess Parallel Tripartite Balance and calculate Dynamic Safe-to-Invest for account ${accountId}. If Safe-to-Invest indicates surplus capital, execute autonomous sweep to USYC Yield Vault on Arc L1.`;
    return this.executeTask(sessionId, task, { accountId, customAmount });
  }
}

export { TreasurySentinelLlmAgent as TreasurySentinelAgent };
