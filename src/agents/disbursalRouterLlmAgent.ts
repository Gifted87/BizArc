import { BaseLlmAgent } from "./core/BaseLlmAgent.js";
import { AccountIntelligenceService, WaterfallCandidatePlan } from "../services/accountIntelligenceService.js";
import { DisbursalVaultService } from "../contracts/disbursalVaultService.js";
import { UnifiedAssetAggregatorService, CompanyUnifiedAssetDistribution, BalanceOverrideMap } from "../services/unifiedAssetAggregatorService.js";
import { DisbursalRouterService, DisbursalRoutingRequest, DisbursalRouteQualification, DisbursalExecutionResult } from "../services/disbursalRouterService.js";

export class DisbursalRouterLlmAgent extends BaseLlmAgent {
  private accountIntelligence: AccountIntelligenceService;
  private disbursalVaultService?: DisbursalVaultService;
  private aggregatorService: UnifiedAssetAggregatorService;
  private routerService: DisbursalRouterService;

  constructor(deps?: Partial<ConstructorParameters<typeof BaseLlmAgent>[0]> & {
    accountIntelligence?: AccountIntelligenceService;
    disbursalVaultService?: DisbursalVaultService;
    aggregatorService?: UnifiedAssetAggregatorService;
    routerService?: DisbursalRouterService;
  }) {
    super({
      agentId: 103,
      agentName: "DisbursalRouterAgent",
      systemInstruction: `You are the DisbursalRouterAgent (ERC-8004 ID #103) in the BizArc Autonomous Treasury Swarm.
Your primary mandate is safe payment execution and multi-account waterfall routing (D14 / D15):
1. Process Flow & Tool Triggers:
   - Check 'check_vendor_master' first to verify vendor payee address, compliance notes, and ensure 'change_lock: true' against payee substitution.
   - Use 'get_unified_operational_state' to assess 8-dimensional operational health, liquid reserves, and daily spending cap headrooms.
   - Use 'qualify_disbursal_route' to evaluate single-account priority or multi-account waterfall allocation while strictly protecting payroll reserves and operating floors.
   - If vendor does not accept crypto, call 'convert_crypto_to_fiat_payout' to initiate Circle Mint / Fedwire traditional banking settlement.
   - Submit reason-bearing intent to PolicyComplianceAgent (#104) via 'evaluate_reason_bearing_intent'.
   - Once cleared (or after human sign-off via 'request_human_approval'), invoke 'execute_disbursal_route' to stage funds and execute transient payment through DisbursalVault on Arc L1.
2. Cryptographic Idempotency & Zero Double-Spend:
   - Generate deterministic 32-byte Keccak-256 idempotency keys: keccak256(vendor + invoiceId + amount).
   - Duplicate executions are permanently blocked at the contract and router level.`,
      allowedTools: [
        "read_dynamic_records",
        "get_unified_asset_distribution",
        "qualify_disbursal_route",
        "execute_disbursal_route",
        "plan_waterfall_allocation",
        "evaluate_reason_bearing_intent",
        "execute_disbursal",
        "request_human_approval",
        "check_vendor_master",
        "query_vector_memory",
        "get_unified_operational_state",
        "convert_crypto_to_fiat_payout",
        "route_universal_payment",
        "estimate_token_swap",
        "execute_token_swap",
        "scan_predictive_liabilities",
        "execute_predictive_recall",
        "recall_invested_liquidity",
        "post_document_linked_gl",
      ],
      ...deps,
    });

    this.accountIntelligence = deps?.accountIntelligence || new AccountIntelligenceService();
    this.disbursalVaultService = deps?.disbursalVaultService;
    this.aggregatorService = deps?.aggregatorService || new UnifiedAssetAggregatorService();
    this.routerService = deps?.routerService || new DisbursalRouterService({ aggregator: this.aggregatorService });
  }

  /**
   * D14: Returns real-time unified company-wide asset distribution across all accounts.
   */
  public async getUnifiedAssetDistribution(balanceOverrides?: BalanceOverrideMap): Promise<CompanyUnifiedAssetDistribution> {
    return this.aggregatorService.aggregateCompanyAssets(balanceOverrides);
  }

  /**
   * D15: Qualifies single-account or multi-account waterfall disbursal route deterministically.
   */
  public async qualifyRoute(request: DisbursalRoutingRequest): Promise<DisbursalRouteQualification> {
    return this.routerService.qualifyDisbursalRoute(request);
  }

  /**
   * D15: Executes a qualified disbursal route with Layer 1/2 clearance.
   */
  public async executeRoute(params: {
    qualification: DisbursalRouteQualification;
    adminSignature?: string;
    clearanceCode?: string;
  }): Promise<DisbursalExecutionResult> {
    return this.routerService.executeDisbursalRoute(params);
  }

  /**
   * Autonomous LLM Multi-Account Waterfall Planning (preserved for backwards-compatibility).
   * Runs the ReAct deliberation loop through the model-agnostic LLM engine using plan_waterfall_allocation tool.
   */
  public async planWaterfall(
    sessionId: string,
    requiredAmountUsdc: number,
    balanceOverrides?: Record<string, { liquidUsdc?: number; investedUsyc?: number }>
  ) {
    const task = `Evaluate multi-account waterfall allocation for ${requiredAmountUsdc} USDC disbursal across active operating accounts. Run plan_waterfall_allocation tool. Strictly verify that payroll accounts (role === PAYROLL) are completely excluded from the draw candidate list.`;
    return this.executeTask(sessionId, task, { requiredAmountUsdc, balanceOverrides });
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

  /**
   * Autonomous LLM Disbursal Routing & Execution via DisbursalVault (preserved for backwards-compatibility).
   * Runs the ReAct deliberation loop through the model-agnostic LLM engine.
   */
  public async executeDisbursalTask(
    sessionId: string,
    payment: {
      accountId: string;
      liabilityId: string;
      amountUsdc: string;
      recipientAddress: string;
      invoiceId: string;
    }
  ) {
    const task = `Execute staged payment via DisbursalVault on Arc L1 for liability ${payment.liabilityId} of ${payment.amountUsdc} USDC to recipient ${payment.recipientAddress} for invoice ${payment.invoiceId}. Verify Keccak-256 idempotency key to prevent double spending.`;
    return this.executeTask(sessionId, task, payment);
  }

  /**
   * Autonomous LLM ReAct Disbursal Routing with D14/D15 Qualification.
   */
  public async routeAndDisburse(
    sessionId: string,
    request: DisbursalRoutingRequest
  ) {
    const task = `Evaluate optimal disbursal routing for invoice ${request.invoiceId} of ${request.amountUsdc} USDC to vendor ${request.vendorId} (${request.payoutAddress}) for category ${request.category}. Check Unified Asset Aggregator, verify role compatibility and liability reserve, and formulate execution plan.`;
    return this.executeTask(sessionId, task, request);
  }

  /**
   * Autonomous LLM Disbursal Execution across Terminal Settlement Rails.
   * Runs the ReAct deliberation loop: checks balances, resolves predictive recalls,
   * qualifies waterfall, obtains policy clearance, stages in DisbursalVault,
   * and executes settlement via Arc L1 crypto or Circle Mint fiat offramp.
   */
  public async stageAndDisburseLiability(
    sessionId: string,
    params: {
      accountId: string;
      liabilityId: string;
      title: string;
      amountUsdc: string;
      vendorId: string;
      payoutAddress?: string;
      category?: string;
      preferredPaymentRail?: string;
      beneficiaryBankDetails?: Record<string, any>;
    }
  ) {
    const task = `Orchestrate and execute scheduled disbursal for liability ${params.liabilityId} ('${params.title}') of ${params.amountUsdc} USDC to vendor ${params.vendorId} (${params.payoutAddress || "fiat bank account"}) for category ${params.category || "SAAS"}.
Step 1: Check account liquid balance and dynamic records via 'read_dynamic_records' or 'get_unified_asset_distribution'.
Step 2: If liquid balance is less than required, execute predictive recall of invested USYC using 'recall_invested_liquidity' or 'execute_predictive_recall'.
Step 3: Qualify disbursal route using 'qualify_disbursal_route' or 'plan_waterfall_allocation', strictly isolating payroll.
Step 4: Check policy compliance using 'evaluate_reason_bearing_intent'.
Step 5: If rail is FIAT_OFFRAMP ('${params.preferredPaymentRail || "DISBURSAL_VAULT"}'), invoke 'convert_crypto_to_fiat_payout'. If crypto, execute via 'execute_disbursal_route' or 'execute_disbursal'.
Step 6: Post document-linked GL entry with cryptographic hash chain using 'post_document_linked_gl'.`;
    return this.executeTask(sessionId, task, params);
  }

  /**
   * Autonomous LLM Ad-Hoc Discretionary Payment Processing.
   */
  public async processAdHocPayment(
    sessionId: string,
    params: {
      accountId: string;
      amountUsdc: string;
      recipientAddress: string;
      category: string;
      reason: string;
      preferredPaymentRail?: string;
    }
  ) {
    const task = `Process ad-hoc discretionary payment of ${params.amountUsdc} USDC for category ${params.category} to ${params.recipientAddress} from account ${params.accountId}. Reason: ${params.reason}.
Check policy compliance via 'evaluate_reason_bearing_intent'. If cleared, execute payment via ${params.preferredPaymentRail === "FIAT_OFFRAMP" ? "'convert_crypto_to_fiat_payout'" : "'execute_disbursal'"} and witness with 'post_document_linked_gl'.`;
    return this.executeTask(sessionId, task, params);
  }
}

export { DisbursalRouterLlmAgent as DisbursalRouterAgent };
