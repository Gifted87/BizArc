import { BaseLlmAgent } from "./core/BaseLlmAgent.js";
import { EnterpriseIntakePayload, DiscoveredBusinessProfile, SuggestedPolicyProposal } from "../services/enterpriseOnboardingService.js";

export class OnboardingLlmAgent extends BaseLlmAgent {
  constructor(deps?: Partial<ConstructorParameters<typeof BaseLlmAgent>[0]>) {
    super({
      agentId: 100,
      agentName: "OnboardingAgent",
      systemInstruction: `You are the OnboardingAgent (ID #100) in the BizArc Autonomous Treasury Swarm.
Your primary mandate is enterprise initialization and ground truth seeding across the 7-Phase Onboarding Matrix:
1. Entity & ERP Discovery: Ingest corporate documents (Bylaws, MSAs, SLAs, Contracts) and ERP records into Enterprise Vector Memory.
2. Policy Synthesis: Synthesize suggested mathematical rules (floors, buffers, caps) and declared policies based on liabilities. (Always suggest; never unilaterally commit).
3. Account & Wallet Provisioning: Initialize Arc L1 wallets for discovered cost centers and register in treasury_accounts.
4. DB & Ledger Genesis: Initialize relational tables and create the tamper-evident Genesis block in master system journal.
5. Smart Contract Registration: Register accounts with CentralTreasuryYieldVault and DisbursalVault on Arc L1.
6. Spending Guardrails: Generate monotonic Circle CLI commands for terminal OTP handoff to human admin.
7. Deposit & Activation: Verify initial onchain USDC funding before activating autonomous sentinels.`,
      allowedTools: [
        "query_vector_memory",
        "read_dynamic_records",
        "check_vendor_master",
        "recalculate_safe_to_invest",
        "synthesize_policy_proposal",
        "provision_arc_wallets",
        "generate_spending_guardrails_handoff",
        "verify_initial_funding",
        "ingest_enterprise_documents",
      ],
      ...deps,
    });
  }

  /**
   * Phase 2: Autonomous LLM Synthesis of Policy Proposal.
   */
  public async synthesizePolicyProposal(sessionId: string, intake: EnterpriseIntakePayload) {
    const task = `Perform Phase 2 Policy Synthesis for enterprise ${intake.companyName}. Synthesize reserve floors, spending caps, and anomaly rules. Output status SUGGESTION_PENDING_HUMAN_COMMIT.`;
    return this.executeTask(sessionId, task, intake);
  }

  /**
   * Phase 3 & 4: Autonomous Account Provisioning & Ledger Genesis.
   */
  public async provisionAccounts(
    sessionId: string,
    params: { companyName: string; costCenters: any[]; suppliers?: any[]; invoices?: any[] }
  ) {
    const task = `Provision Arc L1 operating accounts, register vendors, and create master system journal genesis block for ${params.companyName}.`;
    return this.executeTask(sessionId, task, params);
  }

  /**
   * Phase 6: Spending Guardrails OTP Command Handoff.
   */
  public async generateSpendingGuardrails(sessionId: string, costCenters: any[]) {
    const task = `Generate terminal CLI commands for Circle spending caps with OTP protection for ${costCenters.length} cost centers.`;
    return this.executeTask(sessionId, task, { costCenters });
  }

  /**
   * Phase 7: Initial Funding Verification.
   */
  public async verifyFunding(sessionId: string, accountId: string, minDepositUsdc?: number) {
    const task = `Verify onchain funding status for account ${accountId} on Arc L1.`;
    return this.executeTask(sessionId, task, { accountId, minDepositUsdc });
  }
}

export { OnboardingLlmAgent as OnboardingAgent };
