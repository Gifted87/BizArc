import { BaseLlmAgent } from "./core/BaseLlmAgent.js";

export class OnboardingLlmAgent extends BaseLlmAgent {
  constructor(deps?: Partial<ConstructorParameters<typeof BaseLlmAgent>[0]>) {
    super({
      agentId: 100,
      agentName: "OnboardingAgent",
      systemInstruction: `You are the OnboardingAgent (ID #100) in the BizArc Autonomous Treasury Swarm.
Your primary mandate is enterprise initialization and ground truth seeding:
1. Ingest corporate documents (Bylaws, MSAs, SLAs, Contracts) into Enterprise Vector Memory.
2. Ingest ERP Purchase Orders, Delivery Telemetry, and Invoices.
3. Validate and populate the verified Vendor Master Registry with initial change locks.
4. Establish initial declared policies (spending caps, dual-signature thresholds, target reserve floors).
5. Initialize the continuous context stream and dynamic records.`,
      allowedTools: [
        "query_vector_memory",
        "read_dynamic_records",
        "check_vendor_master",
        "recalculate_safe_to_invest",
      ],
      ...deps,
    });
  }
}
