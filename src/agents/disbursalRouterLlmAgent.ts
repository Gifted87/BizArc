import { BaseLlmAgent } from "./core/BaseLlmAgent.js";
import { AccountIntelligenceService, WaterfallCandidatePlan } from "../services/accountIntelligenceService.js";
import { DisbursalVaultService } from "../contracts/disbursalVaultService.js";
import { DbClient } from "../database/dbClient.js";

export class DisbursalRouterLlmAgent extends BaseLlmAgent {
  private accountIntelligence: AccountIntelligenceService;
  private disbursalVaultService?: DisbursalVaultService;

  constructor(deps?: Partial<ConstructorParameters<typeof BaseLlmAgent>[0]> & {
    accountIntelligence?: AccountIntelligenceService;
    disbursalVaultService?: DisbursalVaultService;
  }) {
    super({
      agentId: 103,
      agentName: "DisbursalRouterAgent",
      systemInstruction: `You are the DisbursalRouterAgent (ERC-8004 ID #103) in the BizArc Autonomous Treasury Swarm.
Your primary mandate is safe payment execution and multi-account waterfall routing:
1. Review pending scheduled liabilities from Dynamic Record 1.
2. Multi-Account Waterfall Planning:
   - If a single operating account has insufficient free capital, call plan_waterfall_allocation to route draws across eligible accounts.
   - Strictly honor payroll exclusions: PAYROLL accounts must NEVER be drawn for operating bills.
3. Policy Compliance Check:
   - Submit reason-bearing intent to PolicyComplianceAgent (#104) before executing any payment.
   - If cleared with PERMIT, proceed to payment execution.
   - If escalated to SPRS, wait for EIP-712 human sign-off.
4. Cryptographic Idempotency (Golden Rule 4):
   - Generate deterministic Keccak-256 idempotency keys: keccak256(vendor + invoiceId + amount).
   - DisbursalVault on Arc L1 strictly rejects duplicate idempotency keys to eliminate double-spend risks.`,
      allowedTools: [
        "read_dynamic_records",
        "plan_waterfall_allocation",
        "execute_disbursal",
        "request_human_approval",
        "check_vendor_master",
        "query_vector_memory",
      ],
      ...deps,
    });

    this.accountIntelligence = deps?.accountIntelligence || new AccountIntelligenceService();
    this.disbursalVaultService = deps?.disbursalVaultService;
  }

  /**
   * Plans multi-account waterfall allocation for large disbursements.
   * Respects minimum operating floors, safety ratios, and payroll account exclusions.
   */
  public async planWaterfall(
    requiredAmountUsdc: number,
    balanceOverrides?: Record<string, { liquidUsdc?: number; investedUsyc?: number }>
  ): Promise<WaterfallCandidatePlan> {
    return this.accountIntelligence.getWaterfallCandidateAccounts(requiredAmountUsdc, balanceOverrides);
  }


  /**
   * Generates a deterministic Keccak-256 idempotency key for payment release.
   */
  public generatePaymentIdempotencyKey(
    vendorAddress: `0x${string}`,
    invoiceId: string,
    amountRaw: bigint
  ): `0x${string}` {
    return DisbursalVaultService.generateIdempotencyKey(vendorAddress, invoiceId, amountRaw);
  }
}
