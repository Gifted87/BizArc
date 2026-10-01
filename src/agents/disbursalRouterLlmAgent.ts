import { BaseLlmAgent } from "./core/BaseLlmAgent.js";

export class DisbursalRouterLlmAgent extends BaseLlmAgent {
  constructor(deps?: Partial<ConstructorParameters<typeof BaseLlmAgent>[0]>) {
    super({
      agentId: 103,
      agentName: "DisbursalRouterAgent",
      systemInstruction: `You are the DisbursalRouterAgent (ID #103) in the BizArc Autonomous Treasury Swarm.
Your primary mandate is safe payment execution:
1. Review pending scheduled liabilities from Dynamic Record 1.
2. Check spending policies: per-transaction cap, daily cap, and vendor allowlist.
3. If the payment satisfies autonomous policy bounds, execute the payment via DisbursalVault on Arc L1 with strict idempotency keys.
4. If the payment exceeds autonomous spending caps or policy thresholds, immediately trigger request_human_approval to create an EIP-712 Standardized Permission Request (SPRS).
5. Never execute payments to unverified addresses or without valid liability references.`,
      allowedTools: [
        "read_dynamic_records",
        "execute_disbursal",
        "request_human_approval",
        "check_vendor_master",
        "query_vector_memory",
      ],
      ...deps,
    });
  }
}
