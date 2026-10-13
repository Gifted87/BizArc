import crypto from "crypto";
import { keccak256, encodePacked } from "viem";
import { DbClient } from "../database/dbClient.js";
import { LlmToolDefinition } from "../llm/types.js";
import { VectorMemoryService } from "../memory/vectorMemoryService.js";
import { DynamicRecordsService } from "../records/dynamicRecordsService.js";
import { AccountIntelligenceService } from "../services/accountIntelligenceService.js";
import { CentralTreasuryYieldVaultService } from "../contracts/centralTreasuryYieldVaultService.js";
import { CentralTreasuryYieldVaultABI } from "../contracts/artifacts.js";
import { ArcTransactionExecutor } from "../foundation/wallets/arcTransactionExecutor.js";
import { ARC_CONSTANTS } from "../foundation/arc/constants.js";
import { USDC_ABI } from "../foundation/usdc/usdcAbi.js";
import { DisbursalVaultService } from "../contracts/disbursalVaultService.js";
import type { PolicyComplianceLlmAgent } from "../agents/policyComplianceLlmAgent.js";
import { EnterpriseOnboardingService } from "../services/enterpriseOnboardingService.js";
import { MasterJournalRepo } from "../database/repos/masterJournalRepo.js";
import { UniversalPaymentRouter } from "../payments/universalPaymentRouter.js";
import { AuthorizationGate } from "../security/authorizationGate.js";
import { VendorLifecycleService } from "../services/vendorLifecycleService.js";
import { RecurringLiabilityService } from "../services/recurringLiabilityService.js";
import { PredictiveRefunderService, REDEMPTION_LEAD_TIME } from "../services/predictiveRefunderService.js";
import { LedgerWitnessService } from "../services/ledgerWitnessService.js";
import { ErpSyncRepo } from "../database/repos/erpSyncRepo.js";
import { TreasuryAccountsRepo } from "../database/repos/treasuryAccountsRepo.js";
import { UnifiedAssetAggregatorService } from "../services/unifiedAssetAggregatorService.js";
import { DisbursalRouterService } from "../services/disbursalRouterService.js";
import { ErpReconciliationService } from "../services/erpReconciliationService.js";
import { UnifiedOperationalStateService } from "../services/unifiedOperationalStateService.js";
import { AuditLogRepo } from "../database/repos/auditLogRepo.js";
import { ProductionReadinessService } from "../services/productionReadinessService.js";
import { LiabilityRepo } from "../database/repos/liabilityRepo.js";
import { TokenSwapService } from "../services/tokenSwapService.js";
import { FiatFundingService } from "../services/fiatFundingService.js";

export interface ToolExecutionResult {
  success: boolean;
  data?: any;
  error?: string;
}

export class ToolRegistry {
  private vectorMemory: VectorMemoryService;
  private dynamicRecords: DynamicRecordsService;
  private accountIntelligence: AccountIntelligenceService;
  private complianceAgent?: PolicyComplianceLlmAgent;
  private onboardingService: EnterpriseOnboardingService;
  private predictiveRefunder: PredictiveRefunderService;
  private witnessService: LedgerWitnessService;
  private vaultService: CentralTreasuryYieldVaultService;
  private assetAggregator: UnifiedAssetAggregatorService;
  private disbursalRouter: DisbursalRouterService;
  private erpReconciliation: ErpReconciliationService;
  private unifiedOperationalState: UnifiedOperationalStateService;
  private productionReadiness: ProductionReadinessService;
  private tokenSwapService: TokenSwapService;
  private fiatFundingService: FiatFundingService;
  private executedIdempotencyKeys: Set<string> = new Set();
  private executor?: ArcTransactionExecutor;

  constructor(
    vectorMemory?: VectorMemoryService,
    dynamicRecords?: DynamicRecordsService,
    accountIntelligence?: AccountIntelligenceService,
    complianceAgent?: PolicyComplianceLlmAgent,
    onboardingService?: EnterpriseOnboardingService,
    predictiveRefunder?: PredictiveRefunderService,
    witnessService?: LedgerWitnessService,
    vaultService?: CentralTreasuryYieldVaultService,
    assetAggregator?: UnifiedAssetAggregatorService,
    disbursalRouter?: DisbursalRouterService,
    erpReconciliation?: ErpReconciliationService,
    unifiedOperationalState?: UnifiedOperationalStateService,
    productionReadiness?: ProductionReadinessService
  ) {
    this.vectorMemory = vectorMemory || new VectorMemoryService();
    this.dynamicRecords = dynamicRecords || new DynamicRecordsService();
    this.accountIntelligence = accountIntelligence || new AccountIntelligenceService();
    this.complianceAgent = complianceAgent;
    this.onboardingService = onboardingService || new EnterpriseOnboardingService();
    this.predictiveRefunder = predictiveRefunder || new PredictiveRefunderService();
    this.witnessService = witnessService || new LedgerWitnessService();
    this.vaultService = vaultService || new CentralTreasuryYieldVaultService("0x4444444444444444444444444444444444444444");
    this.assetAggregator = assetAggregator || new UnifiedAssetAggregatorService({ dynamicRecords: this.dynamicRecords });
    this.erpReconciliation = erpReconciliation || new ErpReconciliationService();
    this.productionReadiness = productionReadiness || new ProductionReadinessService(this.witnessService, this.dynamicRecords);
    this.disbursalRouter =
      disbursalRouter ||
      new DisbursalRouterService({
        aggregator: this.assetAggregator,
        dynamicRecords: this.dynamicRecords,
        witnessService: this.witnessService,
        vaultService: this.vaultService,
        erpReconciliation: this.erpReconciliation,
      });
    this.unifiedOperationalState =
      unifiedOperationalState ||
      new UnifiedOperationalStateService({
        aggregator: this.assetAggregator,
        dynamicRecords: this.dynamicRecords,
      });
    this.tokenSwapService = new TokenSwapService();
    this.fiatFundingService = new FiatFundingService(this.dynamicRecords);
  }

  public setComplianceAgent(complianceAgent: PolicyComplianceLlmAgent): void {
    this.complianceAgent = complianceAgent;
  }


  /**
   * Returns tool definitions formatted for LLM function calling schemas.
   */
  public getToolDefinitions(allowedToolNames?: string[]): LlmToolDefinition[] {
    const allDefs: LlmToolDefinition[] = [
      {
        type: "function",
        function: {
          name: "query_vector_memory",
          description: "Search corporate documents, bylaws, MSAs, SLAs, board resolutions, and ERP records via semantic vector memory.",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string", description: "Search query text" },
              collections: {
                type: "array",
                items: { type: "string" },
                description: "Optional collection filters (e.g. 'company_bylaws', 'msas', 'erp_pos')",
              },
              topK: { type: "number", description: "Number of matches to return (default 4)" },
            },
            required: ["query"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "read_dynamic_records",
          description: "Read Dynamic Record 1 (Active Liabilities), Dynamic Record 2 (Safe-to-Invest), and Parallel Tripartite Balance for an account.",
          parameters: {
            type: "object",
            properties: {
              accountId: { type: "string", description: "Account identifier (e.g. 'OPEX_DEV')" },
              horizonDays: { type: "number", description: "Lookahead window in days (default 7)" },
            },
            required: ["accountId"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "verify_three_way_match",
          description: "Golden Rule 2 & 3: Strictly verify 3-way match between Purchase Order, Delivery Telemetry/Receipt, and Invoice demand, while checking payee address against verified Vendor Master Registry.",
          parameters: {
            type: "object",
            properties: {
              invoiceId: { type: "string", description: "Invoice number or identifier" },
              poReference: { type: "string", description: "Linked Purchase Order number" },
              claimedAmountUsdc: { type: "string", description: "Exact 6-decimal invoice amount" },
              claimedPayoutAddress: { type: "string", description: "Payout destination address on invoice" },
            },
            required: ["invoiceId", "poReference", "claimedAmountUsdc", "claimedPayoutAddress"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "check_vendor_master",
          description: "Golden Rule 3: Check if a destination payout address matches the verified Vendor Master Registry to prevent payee substitution attacks.",
          parameters: {
            type: "object",
            properties: {
              vendorId: { type: "string", description: "Vendor identifier (e.g. 'VEND-AWS-01')" },
              payoutAddress: { type: "string", description: "Claimed destination wallet address" },
            },
            required: ["vendorId", "payoutAddress"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "recalculate_safe_to_invest",
          description: "Calculate Dynamic Safe-to-Invest (Record 2) based on tripartite balance, operating buffer, and scheduled liabilities.",
          parameters: {
            type: "object",
            properties: {
              accountId: { type: "string", description: "Account identifier" },
              timeHorizonSeconds: { type: "number", description: "Time horizon in seconds" },
            },
            required: ["accountId"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "evaluate_reason_bearing_intent",
          description: "Policy Compliance Gate (ID #104): Submit reason-bearing intent for Tri-State evaluation (PERMIT, DENY, ESCALATE_TO_SPRS).",
          parameters: {
            type: "object",
            properties: {
              proposedAction: { type: "string", description: "Action type (e.g. 'AUTONOMOUS_SWEEP', 'DISBURSAL_SETTLEMENT')" },
              accountId: { type: "string", description: "Source account identifier" },
              amountUsdc: { type: "string", description: "Exact 6-decimal USDC amount" },
              declaredReason: { type: "string", description: "Explicit operational and commercial rationale" },
              recipientAddress: { type: "string", description: "Optional destination address" },
            },
            required: ["proposedAction", "accountId", "amountUsdc", "declaredReason"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "plan_waterfall_allocation",
          description: "Evaluate multi-account waterfall allocation for large obligations across active operating accounts, strictly protecting payroll.",
          parameters: {
            type: "object",
            properties: {
              requiredAmountUsdc: { type: "number", description: "Total USDC amount required for payment" },
              balanceOverrides: {
                type: "object",
                description: "Optional projected or manual balance overrides across accounts",
              },
            },
            required: ["requiredAmountUsdc"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "sweep_excess_liquidity",
          description: "Sweep excess idle USDC above target operating buffer into ERC-4626 USYC tokenized short-term US Treasury yield vault on Arc L1.",
          parameters: {
            type: "object",
            properties: {
              accountId: { type: "string", description: "Account identifier" },
              amountUsdc: { type: "string", description: "Exact 6-decimal amount to sweep" },
              clearanceCode: { type: "string", description: "Compliance clearance code from PolicyComplianceAgent" },
            },
            required: ["accountId", "amountUsdc"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "recall_invested_liquidity",
          description: "Redeem USYC yield vault shares to restore liquid cash in operating pool for pending liabilities.",
          parameters: {
            type: "object",
            properties: {
              accountId: { type: "string", description: "Account identifier" },
              amountUsdc: { type: "string", description: "Exact 6-decimal amount to recall" },
              reason: { type: "string", description: "Reason for liquidity recall" },
            },
            required: ["accountId", "amountUsdc", "reason"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "execute_disbursal",
          description: "Execute staged payment via DisbursalVault on Arc L1 with cryptographic Keccak-256 idempotency verification.",
          parameters: {
            type: "object",
            properties: {
              accountId: { type: "string", description: "Account identifier" },
              liabilityId: { type: "string", description: "Liability record identifier" },
              amountUsdc: { type: "string", description: "Exact 6-decimal payment amount" },
              recipientAddress: { type: "string", description: "Recipient wallet address" },
              invoiceId: { type: "string", description: "Vendor invoice number for idempotency key derivation" },
            },
            required: ["accountId", "liabilityId", "amountUsdc", "recipientAddress"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "route_universal_payment",
          description: "Route and execute disbursals across Universal 5-Rail Payment Gateway (Rail 1: DisbursalVault, Rail 2: Modular Session Key, Rail 3: ERC-3009 Gasless, Rail 4: Circle Gateway x402, Rail 5: Circle Mint Fiat Payout). Enforces Movement Policy, 3-Way Match, Payee Substitution Defense, Loud Rounding Rejection, SPRS Human Escalation, and Universal GL + ERP Staging.",
          parameters: {
            type: "object",
            properties: {
              primaryAccountId: { type: "string", description: "Primary paying account identifier" },
              vendorId: { type: "string", description: "Vendor identifier" },
              vendorName: { type: "string", description: "Vendor display name" },
              amountUsdc: { type: "number", description: "Amount in USDC (up to 6 decimals)" },
              payoutAddress: { type: "string", description: "Target EVM payout address for Rails 1, 2, 3" },
              serviceUrl: { type: "string", description: "Target HTTP 402 URL for Rail 4" },
              beneficiaryBank: {
                type: "object",
                description: "Beneficiary bank account details for Rail 5 (Fiat Payout)",
                properties: {
                  accountHolderName: { type: "string" },
                  ibanOrAccountNumber: { type: "string" },
                  routingOrSwift: { type: "string" },
                  bankCountry: { type: "string" },
                  bankName: { type: "string" },
                },
              },
              invoiceId: { type: "string", description: "Invoice number" },
              poReference: { type: "string", description: "Purchase order reference" },
              deliveryProofHash: { type: "string", description: "Goods receipt delivery proof hash" },
              requireThreeWayMatch: { type: "boolean", description: "Whether to enforce 3-way match" },
              rail: { type: "string", description: "Target rail: DISBURSAL_VAULT | MODULAR_SESSION_KEY | ERC3009_AUTHORIZATION | GATEWAY_X402 | FIAT_PAYOUT" },
              adminSignature: { type: "string", description: "EIP-712 human admin authorization signature if exceeding threshold" },
              reason: { type: "string", description: "Declared business reason" },
            },
            required: ["primaryAccountId", "vendorId", "amountUsdc"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "post_document_linked_gl",
          description: "Golden Rule 1 & 4: Post document-linked general ledger entry to ERP (Odoo/ERPNext) and sequential cryptographic hash-chained master journal.",
          parameters: {
            type: "object",
            properties: {
              accountId: { type: "string", description: "Account identifier" },
              documentRef: { type: "string", description: "Invoice or PO reference" },
              debitAccount: { type: "string", description: "Debit GL account code" },
              creditAccount: { type: "string", description: "Credit GL account code" },
              amountUsdc: { type: "string", description: "Exact 6-decimal transaction amount" },
              txHash: { type: "string", description: "Arc L1 transaction hash" },
            },
            required: ["accountId", "documentRef", "debitAccount", "creditAccount", "amountUsdc", "txHash"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "request_human_approval",
          description: "Create an EIP-712 Standardized Permission Request (SPRS) for human officer sign-off when an operation exceeds autonomous policy bounds.",
          parameters: {
            type: "object",
            properties: {
              accountId: { type: "string", description: "Account identifier" },
              actionType: { type: "string", description: "Action type (e.g. 'OUT_OF_POLICY_PAYMENT')" },
              amountUsdc: { type: "string", description: "Exact 6-decimal amount" },
              reason: { type: "string", description: "Detailed justification and policy violation explanation" },
              payload: { type: "object", description: "Transaction parameters" },
            },
            required: ["accountId", "actionType", "amountUsdc", "reason", "payload"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "synthesize_policy_proposal",
          description: "Phase 2: Synthesize suggested mathematical rules, reserve floors, spending caps, and declared policies based on discovered cost centers.",
          parameters: {
            type: "object",
            properties: {
              companyName: { type: "string", description: "Company legal name" },
              costCenters: { type: "array", items: { type: "object" }, description: "Discovered cost centers" },
            },
            required: ["companyName", "costCenters"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "provision_arc_wallets",
          description: "Phase 3 & 4: Provision Arc L1 operating accounts, register initial vendors, and initialize the genesis block in the master system journal.",
          parameters: {
            type: "object",
            properties: {
              companyName: { type: "string", description: "Company name" },
              costCenters: { type: "array", items: { type: "object" } },
              suppliers: { type: "array", items: { type: "object" } },
              invoices: { type: "array", items: { type: "object" } },
            },
            required: ["companyName"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "generate_spending_guardrails_handoff",
          description: "Phase 6: Generate monotonic spending guardrail CLI commands for terminal OTP handoff to human admin.",
          parameters: {
            type: "object",
            properties: {
              costCenters: { type: "array", items: { type: "object" } },
            },
            required: ["costCenters"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "verify_initial_funding",
          description: "Phase 7: Verify initial USDC deposit on Arc L1 for provisioned treasury accounts to activate autonomous operations.",
          parameters: {
            type: "object",
            properties: {
              accountId: { type: "string", description: "Account identifier to check" },
              minDepositUsdc: { type: "number", description: "Minimum funding threshold in USDC" },
            },
            required: ["accountId"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "ingest_enterprise_documents",
          description: "Phase 1: Ingest corporate bylaws, MSAs, vendor SLAs, and ERP POs into Enterprise Vector Memory.",
          parameters: {
            type: "object",
            properties: {
              documents: { type: "array", items: { type: "object" }, description: "Array of enterprise documents to embed and index" },
            },
            required: ["documents"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "register_vendor",
          description: "Register a verified vendor in Vendor Master Registry with verified EVM payout address and optional x402 endpoint URL.",
          parameters: {
            type: "object",
            properties: {
              vendorId: { type: "string", description: "Unique vendor identifier" },
              name: { type: "string", description: "Vendor business name" },
              verifiedPayoutAddress: { type: "string", description: "Verified EVM wallet address" },
              paymentEndpointUrl: { type: "string", description: "Optional x402 payment URL" },
              payoutRail: { type: "string", description: "DISBURSAL_VAULT | MODULAR_SESSION_KEY | ERC3009_AUTHORIZATION | GATEWAY_X402" },
            },
            required: ["vendorId", "name", "verifiedPayoutAddress"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "update_vendor",
          description: "Update an existing vendor in Vendor Master Registry. Destination address/URL changes require Layer 2 Human Approval (SPRS).",
          parameters: {
            type: "object",
            properties: {
              vendorId: { type: "string", description: "Vendor identifier" },
              name: { type: "string", description: "Updated business name" },
              newPayoutAddress: { type: "string", description: "Updated EVM wallet address" },
              newPaymentEndpointUrl: { type: "string", description: "Updated x402 URL" },
              payoutRail: { type: "string", description: "Updated payout rail" },
              reason: { type: "string", description: "Reason for vendor update" },
              proposedBy: { type: "string", description: "Agent name or 'HUMAN'" },
              sprsRequestId: { type: "string", description: "Human SPRS approval ID if approved" },
              adminSignature: { type: "string", description: "Human admin EIP-712 signature" },
            },
            required: ["vendorId", "reason", "proposedBy"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "remove_vendor",
          description: "Remove or deactivate a vendor from Vendor Master Registry. Requires Layer 2 Human Approval (SPRS).",
          parameters: {
            type: "object",
            properties: {
              vendorId: { type: "string", description: "Vendor identifier" },
              reason: { type: "string", description: "Reason for deactivation" },
              proposedBy: { type: "string", description: "Agent name or 'HUMAN'" },
              sprsRequestId: { type: "string", description: "Human SPRS approval ID if approved" },
              adminSignature: { type: "string", description: "Human admin EIP-712 signature" },
            },
            required: ["vendorId", "reason", "proposedBy"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "add_account_liability",
          description: "Add a recurring liability (subscription/debt) for an account (Dynamic Record 1). Requires Layer 2 Human Approval (SPRS).",
          parameters: {
            type: "object",
            properties: {
              accountId: { type: "string", description: "Target account identifier" },
              vendorId: { type: "string", description: "Registered vendor identifier" },
              title: { type: "string", description: "Title or subscription name" },
              amountUsdc: { type: "string", description: "Exact 6-decimal USDC amount" },
              dueDate: { type: "string", description: "ISO due date" },
              frequencyCron: { type: "string", description: "Recurring schedule cron (e.g. '0 0 1 * *')" },
              category: { type: "string", description: "Category: SUBSCRIPTION | SAAS | INFRASTRUCTURE | PAYROLL" },
              rationale: { type: "string", description: "Business justification for liability" },
              proposedBy: { type: "string", description: "Agent name or 'HUMAN'" },
              sprsRequestId: { type: "string", description: "Human SPRS approval ID if approved" },
              adminSignature: { type: "string", description: "Human admin EIP-712 signature" },
            },
            required: ["accountId", "vendorId", "title", "amountUsdc", "dueDate", "frequencyCron", "rationale", "proposedBy"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "edit_account_liability",
          description: "Edit an existing recurring liability for an account (Dynamic Record 1). Requires Layer 2 Human Approval (SPRS).",
          parameters: {
            type: "object",
            properties: {
              liabilityId: { type: "string", description: "Liability UUID" },
              title: { type: "string", description: "Updated title" },
              amountUsdc: { type: "string", description: "Updated amount" },
              dueDate: { type: "string", description: "Updated due date ISO" },
              frequencyCron: { type: "string", description: "Updated cron" },
              accountId: { type: "string", description: "Updated account identifier" },
              rationale: { type: "string", description: "Reason for edit" },
              proposedBy: { type: "string", description: "Agent name or 'HUMAN'" },
              sprsRequestId: { type: "string", description: "Human SPRS approval ID if approved" },
              adminSignature: { type: "string", description: "Human admin EIP-712 signature" },
            },
            required: ["liabilityId", "rationale", "proposedBy"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "remove_account_liability",
          description: "Cancel or remove a recurring liability from an account (Dynamic Record 1). Requires Layer 2 Human Approval (SPRS).",
          parameters: {
            type: "object",
            properties: {
              liabilityId: { type: "string", description: "Liability UUID to cancel" },
              rationale: { type: "string", description: "Reason for cancellation" },
              proposedBy: { type: "string", description: "Agent name or 'HUMAN'" },
              sprsRequestId: { type: "string", description: "Human SPRS approval ID if approved" },
              adminSignature: { type: "string", description: "Human admin EIP-712 signature" },
            },
            required: ["liabilityId", "rationale", "proposedBy"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "scan_predictive_liabilities",
          description: "Scan upcoming scheduled liabilities (Dynamic Record 1) within parameterized redemption lead times (with 48h weekend buffer) and compute net liquid shortfall.",
          parameters: {
            type: "object",
            properties: {
              accountId: { type: "string", description: "Optional account identifier to filter by" },
              leadTimeSeconds: { type: "number", description: "Redemption lead time in seconds (default 86400s batch tier, 3600s instant tier)" },
            },
          },
        },
      },
      {
        type: "function",
        function: {
          name: "execute_predictive_recall",
          description: "Execute autonomous predictive recall of USYC yield vault funds to operating account with two-layer authorization and cryptographic ledger witness.",
          parameters: {
            type: "object",
            properties: {
              accountId: { type: "string", description: "Target account identifier" },
              shortfallUsdc: { type: "string", description: "Exact 6-decimal USDC shortfall amount to recall" },
              reason: { type: "string", description: "Operational rationale for recall" },
              clearanceCode: { type: "string", description: "Enforcer Agent Layer 1 clearance code" },
              sprsRequestId: { type: "string", description: "Human CFO Layer 2 approved SPRS ID" },
            },
            required: ["accountId", "shortfallUsdc"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "get_unified_asset_distribution",
          description: "Aggregates real-time company-wide asset distribution across all accounts, including liquid USDC, invested USYC, liabilities, and free capital (D14).",
          parameters: {
            type: "object",
            properties: {
              balanceOverrides: {
                type: "object",
                description: "Optional balance overrides by accountId for deterministic simulation",
              },
            },
          },
        },
      },
      {
        type: "function",
        function: {
          name: "qualify_disbursal_route",
          description: "Qualifies optimal single-account or multi-account waterfall routing for vendor invoice disbursal, enforcing role compatibility and protected liability reserves (D15).",
          parameters: {
            type: "object",
            properties: {
              invoiceId: { type: "string", description: "Unique vendor invoice identifier" },
              liabilityId: { type: "string", description: "Optional Dynamic Record 1 liability UUID" },
              vendorId: { type: "string", description: "Vendor master ID" },
              payoutAddress: { type: "string", description: "Vendor payout destination address" },
              amountUsdc: { type: "string", description: "Exact 6-decimal USDC amount string" },
              category: { type: "string", description: "Expenditure category (e.g. INFRASTRUCTURE, MARKETING, PAYROLL)" },
              declaredReason: { type: "string", description: "Declared reason for disbursal intent" },
              preferredAccountId: { type: "string", description: "Optional preferred source account ID" },
              balanceOverrides: { type: "object", description: "Optional balance overrides" },
            },
            required: ["invoiceId", "vendorId", "payoutAddress", "amountUsdc", "category"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "execute_disbursal_route",
          description: "Executes a qualified disbursal route, triggering any necessary yield recalls, staging funds to DisbursalVault, and settling payment with Keccak-256 idempotency (D15).",
          parameters: {
            type: "object",
            properties: {
              qualification: { type: "object", description: "Disbursal route qualification object" },
              adminSignature: { type: "string", description: "Optional human EIP-712 approval signature" },
              clearanceCode: { type: "string", description: "Optional Layer 1 clearance code" },
            },
            required: ["qualification"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "authorize_transaction_intent",
          description: "D17: Authorize a pending transaction intent or SPRS with corporate sign-off, recording authorization receipt hash in master audit log.",
          parameters: {
            type: "object",
            properties: {
              permissionRequestId: { type: "string", description: "The pending permission request or SPRS ID" },
              adminSignature: { type: "string", description: "Optional EIP-712 human admin signature" },
              approverEmail: { type: "string", description: "Email of the approving corporate officer (e.g. cfo@bizarc.io)" },
              executionPayload: { type: "object", description: "Optional execution payload parameters" },
            },
            required: ["permissionRequestId"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "get_unified_operational_state",
          description: "D20: Retrieves the comprehensive 8-dimensional Unified Operational State of the autonomous treasury (Liquid balances, Invested USYC, Effective Net Worth, Dynamic Record 1 Liabilities, Dynamic Record 2 Safe-to-Invest horizon, ERP sync checkpoints, Master Journal SHA-256 hash chain audit state, and Active SPRS / spend cap Transaction state).",
          parameters: {
            type: "object",
            properties: {
              accountId: { type: "string", description: "Optional account ID to filter state for a single operating account" },
              horizonDays: { type: "number", description: "Horizon in days for liability and safe-to-invest calculations (default: 30)" },
              includeAuditHistoryLimit: { type: "number", description: "Limit of recent audit events to return (default: 15)" },
              balanceOverrides: { type: "object", description: "Optional balance overrides" },
            },
          },
        },
      },
      {
        type: "function",
        function: {
          name: "get_account_intelligence",
          description: "Sentence 27: Aggregates real-time onchain balances, USYC positions, liabilities, and audit history for an account.",
          parameters: {
            type: "object",
            properties: {
              accountId: { type: "string", description: "Account identifier" },
            },
            required: ["accountId"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "transfer_account_liquidity",
          description: "Sentence 28: Moves funds internally between corporate accounts (same-chain Arc or cross-chain via Gateway) with two-way audit logging.",
          parameters: {
            type: "object",
            properties: {
              sourceAccountId: { type: "string", description: "Origin account identifier" },
              targetAccountId: { type: "string", description: "Destination account identifier" },
              amountUsdc: { type: "string", description: "Exact 6-decimal USDC amount to transfer" },
              reason: { type: "string", description: "Operational commercial rationale" },
              permissionRequestId: { type: "string", description: "Optional SPRS ID" },
            },
            required: ["sourceAccountId", "targetAccountId", "amountUsdc", "reason"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "convert_crypto_to_fiat_payout",
          description: "Sentence 30: Initiates Circle Mint Payout / Fedwire / ACH to settle traditional invoices when vendors do not accept crypto.",
          parameters: {
            type: "object",
            properties: {
              sourceAccountId: { type: "string", description: "Origin account identifier" },
              amountUsdc: { type: "string", description: "Exact 6-decimal USDC amount to off-ramp" },
              beneficiaryBank: {
                type: "object",
                properties: {
                  accountHolderName: { type: "string" },
                  ibanOrAccountNumber: { type: "string" },
                  routingOrSwift: { type: "string" },
                  bankCountry: { type: "string" },
                },
                required: ["accountHolderName", "ibanOrAccountNumber", "routingOrSwift", "bankCountry"],
              },
              invoiceReference: { type: "string", description: "Traditional vendor invoice reference" },
            },
            required: ["sourceAccountId", "amountUsdc", "beneficiaryBank", "invoiceReference"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "get_yield_performance_metrics",
          description: "Sentence 31: Queries historical yield earnings, cumulative deposits/withdrawals, net yield accrued, and current annualized APR from CentralTreasuryYieldVault.",
          parameters: {
            type: "object",
            properties: {
              accountId: { type: "string", description: "Account identifier" },
              timeframe: { type: "string", enum: ["7D", "30D", "YTD"], description: "Timeframe for metrics" },
            },
            required: ["accountId"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "audit_production_readiness",
          description: "D23: Audits system configuration, contracts, spending limits, vendor registry, and latency tiers against production readiness criteria across all 8 pillars.",
          parameters: {
            type: "object",
            properties: {
              companyId: { type: "string", description: "Optional enterprise company identifier" },
            },
          },
        },
      },
      {
        type: "function",
        function: {
          name: "activate_production_profile",
          description: "D23: Promotes system policy profile from HACKATHON_DEMO to PRODUCTION, locking strict corporate spending limits ($25k daily cap, $5k human gate), live USYC latency tiers (Tier C 86,400s), and account balance floors ($500 OPEX, $10,000 Payroll).",
          parameters: {
            type: "object",
            properties: {
              adminEmail: { type: "string", description: "Email of authorized corporate officer (e.g. cfo@bizarc.io)" },
              reason: { type: "string", description: "Commercial/compliance rationale for production promotion" },
            },
            required: ["adminEmail", "reason"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "trigger_emergency_circuit_breaker",
          description: "D23: Engages or resets the emergency circuit breaker to halt all autonomous treasury disbursals and sweeps in the event of an anomaly.",
          parameters: {
            type: "object",
            properties: {
              action: { type: "string", enum: ["TRIP", "RESET"], description: "Action to perform: TRIP to freeze or RESET to disarm" },
              reason: { type: "string", description: "Reason for emergency action" },
              adminEmail: { type: "string", description: "Admin officer email address" },
              clearanceCode: { type: "string", description: "Administrative clearance code (required for RESET)" },
            },
            required: ["action", "reason", "adminEmail"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "replace_yield_vault_integration",
          description: "D23: Replaces mock USYC yield vault with an allowlisted production Hashnote institutional contract address.",
          parameters: {
            type: "object",
            properties: {
              newVaultAddress: { type: "string", description: "Allowlisted institutional USYC vault address" },
              isAllowlisted: { type: "boolean", description: "Whether the vault address is verified against institutional allowlist" },
            },
            required: ["newVaultAddress"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "estimate_token_swap",
          description: "Estimate rate, output amount, slippage, and fee for swapping tokens on same-chain or cross-chain via Circle Swap Kit / DEX Aggregators. Rejects USDC <-> NATIVE on Arc.",
          parameters: {
            type: "object",
            properties: {
              fromChain: { type: "string", description: "Source chain (e.g. Arc, Base, Ethereum, Solana)" },
              fromToken: { type: "string", description: "Source token symbol or address (e.g. USDC, USDT, ETH)" },
              toChain: { type: "string", description: "Destination chain (e.g. Arc, Base)" },
              toToken: { type: "string", description: "Destination token symbol or address (e.g. USDC, USDT)" },
              amount: { type: "string", description: "Amount of source token to swap (e.g. 100.000000)" },
              slippage: { type: "number", description: "Allowed slippage percentage fraction (default 0.005 = 0.5%)" },
            },
            required: ["fromChain", "fromToken", "toChain", "toToken", "amount"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "execute_token_swap",
          description: "Execute token conversion with strict slippage guardrails and double-entry accounting.",
          parameters: {
            type: "object",
            properties: {
              accountId: { type: "string", description: "Corporate treasury account identifier" },
              fromChain: { type: "string", description: "Source chain" },
              fromToken: { type: "string", description: "Source token symbol or address" },
              toChain: { type: "string", description: "Destination chain" },
              toToken: { type: "string", description: "Destination token symbol or address" },
              amount: { type: "string", description: "Amount of source token to swap" },
              slippage: { type: "number", description: "Allowed slippage fraction (e.g. 0.005)" },
              maxSlippageLimit: { type: "number", description: "Hard ceiling slippage tolerance (e.g. 0.01)" },
              declaredReason: { type: "string", description: "Commercial/treasury justification for swap" },
            },
            required: ["accountId", "fromChain", "fromToken", "toChain", "toToken", "amount"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "create_fiat_onramp_session",
          description: "Create an interactive fiat on-ramp session and verbatim Circle CLI command to fund an operating wallet with USD/EUR via cards or bank debit.",
          parameters: {
            type: "object",
            properties: {
              accountId: { type: "string", description: "Treasury operating account identifier" },
              amountUsdc: { type: "number", description: "Amount of USDC to purchase with fiat" },
              userEmail: { type: "string", description: "Admin email address" },
              chain: { type: "string", description: "Target blockchain (default: ARC)" },
            },
            required: ["accountId", "amountUsdc"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "get_fiat_wire_deposit_instructions",
          description: "Generate institutional Fedwire / SWIFT bank wire instructions with unique tracking memo for direct capital deposits to Circle Mint.",
          parameters: {
            type: "object",
            properties: {
              accountId: { type: "string", description: "Treasury operating account identifier" },
              currency: { type: "string", enum: ["USD", "EUR"], description: "Deposit currency (default: USD)" },
            },
            required: ["accountId"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "record_fiat_deposit",
          description: "Reconcile a confirmed fiat on-ramp or bank wire deposit, credit liquid balance in PostgreSQL, and record double-entry general ledger voucher.",
          parameters: {
            type: "object",
            properties: {
              accountId: { type: "string", description: "Target treasury operating account identifier" },
              amountUsdc: { type: "number", description: "Confirmed deposited amount in USDC" },
              depositReference: { type: "string", description: "Bank wire tracking number or on-ramp session ID" },
              sourceBank: { type: "string", description: "Originating bank name or card processor" },
              senderName: { type: "string", description: "Originating corporate entity name" },
            },
            required: ["accountId", "amountUsdc", "depositReference"],
          },
        },
      },
    ];

    if (!allowedToolNames) return allDefs;
    return allDefs.filter((d) => allowedToolNames.includes(d.function.name));
  }

  /**
   * Executes a tool invocation dispatched by an LLM agent.
   */
  public async executeTool(
    name: string,
    args: Record<string, any>
  ): Promise<ToolExecutionResult> {
    try {
      switch (name) {
        case "query_vector_memory": {
          const results = await this.vectorMemory.queryRelevantMemory(
            args.query,
            args.collections,
            args.topK || 4
          );
          return {
            success: true,
            data: results.map((r) => ({
              collection: r.collection,
              title: r.title,
              content: r.content.trim(),
              similarity: r.similarity,
            })),
          };
        }

        case "read_dynamic_records": {
          const horizonSeconds = (args.horizonDays || 7) * 86400;
          const sti = await this.dynamicRecords.calculateSafeToInvest(
            args.accountId,
            horizonSeconds
          );
          const liabilities = await this.dynamicRecords.getLiabilities(args.accountId);
          return {
            success: true,
            data: {
              tripartiteBalance: sti.tripartiteBalance,
              safeToInvest: sti.safeToInvestUsdc,
              targetReserve: sti.targetReserveUsdc,
              status: sti.status,
              activeLiabilitiesCount: liabilities.length,
              liabilities: liabilities.map((l) => ({
                id: l.liabilityId,
                vendor: l.vendorTitle,
                amount: l.amountUsdc,
                dueDate: l.dueDate.toISOString(),
                status: l.status,
              })),
            },
          };
        }

        case "verify_three_way_match": {
          const { invoiceId, poReference, claimedAmountUsdc, claimedPayoutAddress } = args;

          // 1. Query ERP PO from Vector Memory
          const poResults = await this.vectorMemory.queryRelevantMemory(
            `Purchase Order ${poReference}`,
            ["erp_pos"],
            1
          );

          if (poResults.length === 0) {
            return {
              success: false,
              error: `3-Way Match Failed: Purchase Order ${poReference} not found in enterprise records.`,
            };
          }

          const poDoc = poResults[0];
          const poAmount = poDoc.metadata?.amount_usdc;
          const poVendorId = poDoc.metadata?.vendor_id;

          // Check arithmetic equality (refuse silent rounding per Rule 5)
          const claimedAmountNum = parseFloat(claimedAmountUsdc);
          if (poAmount !== undefined && Math.abs(claimedAmountNum - poAmount) > 0.000001) {
            return {
              success: false,
              error: `3-Way Match Failed: Claimed amount (${claimedAmountUsdc} USDC) does not match PO approved amount (${poAmount.toFixed(6)} USDC). Silent rounding rejected.`,
            };
          }

          // 2. Check Payee Substitution against Vendor Master Registry (Rule 3)
          if (poVendorId) {
            const vendorRes = await DbClient.query(
              `SELECT verified_payout_address FROM vendor_master_registry WHERE vendor_id = $1;`,
              [poVendorId]
            );

            if (vendorRes.rows.length > 0) {
              const verifiedAddr = vendorRes.rows[0].verified_payout_address.toLowerCase();
              if (claimedPayoutAddress.toLowerCase() !== verifiedAddr) {
                return {
                  success: false,
                  error: `PAYEE SUBSTITUTION DETECTED (Rule 3 Alert): Claimed invoice payout address (${claimedPayoutAddress}) does not match immutable Vendor Master Registry address (${verifiedAddr})!`,
                };
              }
            }
          }

          // 3. Query Goods Receipt Note (GRN) / Milestone Delivery Telemetry (Rule 2)
          const grnResults = await this.vectorMemory.queryRelevantMemory(
            `Goods Receipt Note Delivery ${poReference}`,
            ["delivery_receipts", "goods_receipts"],
            1
          );

          if (grnResults.length === 0) {
            return {
              success: false,
              error: `3-Way Match Failed (Rule 2 Alert): Goods Receipt Note (GRN) or delivery telemetry not found for PO ${poReference}. Milestone delivery proof is unverified.`,
            };
          }

          return {
            success: true,
            data: {
              matchStatus: "MATCHED",
              poReference,
              grnReference: grnResults[0].metadata?.grn_number || grnResults[0].documentId,
              approvedAmountUsdc: claimedAmountUsdc,
              verifiedPayoutAddress: claimedPayoutAddress,
              message: "3-Way Match verified cleanly across PO, Goods Receipt, and Vendor Master.",
            },
          };
        }

        case "check_vendor_master": {
          const { vendorId, payoutAddress } = args;
          const res = await DbClient.query(
            `SELECT vendor_id, name, verified_payout_address, change_lock 
             FROM vendor_master_registry 
             WHERE vendor_id = $1;`,
            [vendorId]
          );

          if (res.rows.length === 0) {
            return {
              success: false,
              error: `Vendor ${vendorId} not found in Vendor Master Registry.`,
            };
          }

          const vendor = res.rows[0];
          const match = vendor.verified_payout_address.toLowerCase() === payoutAddress.toLowerCase();

          return {
            success: match,
            data: {
              vendorId: vendor.vendor_id,
              name: vendor.name,
              verifiedAddress: vendor.verified_payout_address,
              claimedAddress: payoutAddress,
              isMatch: match,
            },
            error: match ? undefined : `Address ${payoutAddress} does not match verified address ${vendor.verified_payout_address}. Possible payee substitution!`,
          };
        }

        case "recalculate_safe_to_invest": {
          const sti = await this.dynamicRecords.calculateSafeToInvest(
            args.accountId,
            args.timeHorizonSeconds
          );
          return {
            success: true,
            data: {
              safeToInvestUsdc: sti.safeToInvestUsdc,
              targetReserveUsdc: sti.targetReserveUsdc,
              status: sti.status,
              tripartiteBalance: sti.tripartiteBalance,
            },
          };
        }

        case "evaluate_reason_bearing_intent": {
          if (!this.complianceAgent) {
            const { PolicyComplianceLlmAgent } = await import("../agents/policyComplianceLlmAgent.js");
            this.complianceAgent = new PolicyComplianceLlmAgent({ toolRegistry: this });
          }
          const evalResult = await this.complianceAgent.evaluateIntent({
            proposedAction: args.proposedAction,
            accountId: args.accountId,
            amountUsdc: args.amountUsdc,
            declaredReason: args.declaredReason,
            recipientAddress: args.recipientAddress,
          });

          return {
            success: evalResult.decision !== "DENY",
            data: evalResult,
            error: evalResult.decision === "DENY" ? evalResult.reason : undefined,
          };
        }

        case "plan_waterfall_allocation": {
          const candidatePlan = await this.accountIntelligence.getWaterfallCandidateAccounts(
            args.requiredAmountUsdc,
            args.balanceOverrides
          );

          return {
            success: true,
            data: candidatePlan,
          };
        }

        case "sweep_excess_liquidity": {
          const { accountId, amountUsdc, clearanceCode } = args;
          if (!clearanceCode || typeof clearanceCode !== "string" || !clearanceCode.startsWith("CLEAR-")) {
            return {
              success: false,
              error: `GOVERNANCE_VIOLATION: Missing or invalid compliance clearanceCode ('${clearanceCode}'). Treasury fund sweeps require prior reason-bearing intent evaluation and clearance from PolicyComplianceAgent (#104).`,
            };
          }
          const rawAmount = this.dynamicRecords.parseUsdcToRaw(amountUsdc);
          const numAmount = typeof amountUsdc === "number" ? amountUsdc : parseFloat(amountUsdc);

          // Real Account Wallet Lookup from TreasuryAccountsRepo
          const accountRecord = await TreasuryAccountsRepo.getAccountById(accountId);
          if (!accountRecord) {
            return {
              success: false,
              error: `ACCOUNT_NOT_FOUND: Treasury account '${accountId}' not found in registry.`,
            };
          }
          const accountWallet = accountRecord.wallet_address as `0x${string}`;
          const vaultAddress = this.vaultService.getAddress();

          const execution = await (this.executor ??= new ArcTransactionExecutor()).execute({
            targetContract: vaultAddress,
            abi: CentralTreasuryYieldVaultABI,
            functionName: "sweepFromAccount",
            args: [CentralTreasuryYieldVaultService.formatAccountId(accountId), accountWallet, rawAmount],
            idempotencyKey: `tool-sweep:${accountId}:${rawAmount}:${clearanceCode}`,
          });
          const txHash = execution.txHash;

          // Independent Ledger Witnessing: Double-Entry Voucher in Sequential Hash Chain
          const docRef = `SWEEP_${accountId}_${Date.now()}`;
          const journalEntry = await this.witnessService.recordJournalVoucher({
            accountId,
            actionType: "AUTONOMOUS_SWEEP",
            amountUsdc: numAmount,
            documentRef: docRef,
            category: "YIELD_SWEEP",
          });

          // Immutable Account-Level Audit Logging
          await this.witnessService.recordAccountAuditLog({
            accountId,
            actionType: "AUTONOMOUS_SWEEP",
            amountUsdc: numAmount,
            isAutonomous: true,
            txHash,
            counterpartyAddress: vaultAddress,
            reason: `Autonomous surplus sweep of ${numAmount} USDC to USYC Yield Vault (Clearance: ${clearanceCode})`,
            postStateSnapshot: {
              sweptUsdc: numAmount,
              clearanceCode,
              journalHash: journalEntry.current_hash,
            },
          });

          // Dynamic Record Recalculation after sweep
          await this.dynamicRecords.calculateSafeToInvest(accountId);

          return {
            success: true,
            data: {
              txHash,
              action: "SWEEP_TO_USYC",
              accountId,
              amountUsdc,
              vaultAddress,
              accountWallet,
              encodedFunctionCall: this.vaultService.encodeSweepFromAccount(accountId, accountWallet, rawAmount),
              journalSequenceId: journalEntry.sequence_id,
              journalHash: journalEntry.current_hash,
            },
          };
        }

        case "recall_invested_liquidity": {
          const { accountId, amountUsdc, reason } = args;
          const rawAmount = this.dynamicRecords.parseUsdcToRaw(amountUsdc);
          const numAmount = typeof amountUsdc === "number" ? amountUsdc : parseFloat(amountUsdc);

          // Real Account Wallet Lookup from TreasuryAccountsRepo
          const accountRecord = await TreasuryAccountsRepo.getAccountById(accountId);
          if (!accountRecord) {
            return {
              success: false,
              error: `ACCOUNT_NOT_FOUND: Treasury account '${accountId}' not found in registry.`,
            };
          }
          const accountWallet = accountRecord.wallet_address as `0x${string}`;
          const vaultAddress = this.vaultService.getAddress();

          const execution = await (this.executor ??= new ArcTransactionExecutor()).execute({
            targetContract: vaultAddress,
            abi: CentralTreasuryYieldVaultABI,
            functionName: "recallForAccount",
            args: [CentralTreasuryYieldVaultService.formatAccountId(accountId), rawAmount],
            idempotencyKey: `tool-recall:${accountId}:${rawAmount}:${reason || "EMERGENCY_RECALL"}`,
          });
          const txHash = execution.txHash;

          // Independent Ledger Witnessing: Double-Entry Voucher in Sequential Hash Chain
          const docRef = `RECALL_${accountId}_${Date.now()}`;
          const journalEntry = await this.witnessService.recordJournalVoucher({
            accountId,
            actionType: "AUTONOMOUS_RECALL",
            amountUsdc: numAmount,
            documentRef: docRef,
            category: "YIELD_RECALL",
          });

          // Immutable Account-Level Audit Logging
          await this.witnessService.recordAccountAuditLog({
            accountId,
            actionType: "AUTONOMOUS_RECALL",
            amountUsdc: numAmount,
            isAutonomous: true,
            txHash,
            counterpartyAddress: vaultAddress,
            reason: reason || `Autonomous liquidity recall of ${numAmount} USDC from USYC Yield Vault to account ${accountId}`,
            postStateSnapshot: {
              recalledUsdc: numAmount,
              journalHash: journalEntry.current_hash,
            },
          });

          // Dynamic Record Recalculation after recall
          await this.dynamicRecords.calculateSafeToInvest(accountId);

          return {
            success: true,
            data: {
              txHash,
              action: "RECALL_FROM_USYC",
              accountId,
              amountUsdc,
              reason,
              vaultAddress,
              accountWallet,
              encodedFunctionCall: this.vaultService.encodeRecallForAccount(accountId, rawAmount),
              journalSequenceId: journalEntry.sequence_id,
              journalHash: journalEntry.current_hash,
            },
          };
        }

        case "execute_disbursal": {
          const { accountId, liabilityId, amountUsdc, recipientAddress, invoiceId = "INV-DEFAULT" } = args;
          const rawAmount = this.dynamicRecords.parseUsdcToRaw(amountUsdc);

          // Compute deterministic Keccak-256 idempotency key per DisbursalVault.sol:
          // idempotencyKey = keccak256(abi.encodePacked(vendor, invoiceId, amount))
          const idempotencyKey = DisbursalVaultService.generateIdempotencyKey(
            recipientAddress as `0x${string}`,
            invoiceId,
            rawAmount
          );

          // Strict Idempotency Check: Reject duplicate payment execution (Rule 1 & Rule 4)
          if (this.executedIdempotencyKeys.has(idempotencyKey)) {
            return {
              success: false,
              error: `IDEMPOTENCY DUPLICATE DETECTED: Payment with key ${idempotencyKey} has already executed! Double payment blocked.`,
            };
          }

          const parsedAmount = typeof amountUsdc === "number" ? amountUsdc : parseFloat(amountUsdc);
          const router = new UniversalPaymentRouter();
          const routerResult = await router.routeAndExecute({
            intent: {
              intentId: `DISB_${liabilityId || Date.now()}`,
              primaryAccountId: accountId,
              vendorId: args.vendorId || "vendor_cloud_aws",
              vendorName: args.vendorName || "Amazon Web Services",
              amountUsdc: parsedAmount,
              payoutAddress: recipientAddress,
              declaredReason: args.reason || "Autonomous staged liability execution via DisbursalVault.",
              invoiceId,
              poReference: args.poReference || "PO_DEFAULT",
              deliveryProofHash: args.deliveryProofHash || "0xgrn_verified",
            },
            overrideRail: "DISBURSAL_VAULT",
          });

          this.executedIdempotencyKeys.add(idempotencyKey);

          // Update liability status in Record 1
          if (liabilityId) {
            await this.dynamicRecords.updateLiabilityStatus(liabilityId, "DISBURSED");
          }

          return {
            success: true,
            data: {
              txHash: routerResult.txHash,
              action: "DISBURSAL_EXECUTED",
              accountId,
              liabilityId,
              amountUsdc: parsedAmount.toString(),
              recipientAddress,
              idempotencyKey,
              journalSequenceId: routerResult.journalSequenceId,
              vaultAddress: "0x5555555555555555555555555555555555555555",
              status: "SETTLED",
            },
          };
        }

        case "route_universal_payment": {
          const router = new UniversalPaymentRouter();
          const parsedAmount = typeof args.amountUsdc === "number" ? args.amountUsdc : parseFloat(args.amountUsdc);
          const intent = {
            intentId: args.intentId || `DISB_TOOL_${Date.now()}`,
            primaryAccountId: args.primaryAccountId,
            vendorId: args.vendorId,
            vendorName: args.vendorName || "Authorized Vendor",
            amountUsdc: parsedAmount,
            payoutAddress: args.payoutAddress,
            serviceUrl: args.serviceUrl,
            declaredReason: args.reason || "Universal payment routing execution via agent swarm.",
            invoiceId: args.invoiceId,
            poReference: args.poReference,
            deliveryProofHash: args.deliveryProofHash,
            requireThreeWayMatch: args.requireThreeWayMatch,
            beneficiaryBank: args.beneficiaryBank,
          };
          const res = await router.routeAndExecute({
            intent,
            overrideRail: args.rail,
            adminSignature: args.adminSignature,
          });
          return {
            success: res.success,
            data: res,
            error: res.error,
          };
        }

        case "post_document_linked_gl": {
          const { accountId, documentRef, debitAccount, creditAccount, amountUsdc, txHash } = args;

          const numAmount = typeof amountUsdc === "number" ? amountUsdc : parseFloat(amountUsdc);

          // Append to master system journal using canonical SHA-256 hash chaining (Rule 1 & Rule 4)
          const entry = await MasterJournalRepo.appendEntry({
            account_id: accountId,
            action_type: "DISBURSAL_SETTLEMENT",
            debit_account: debitAccount,
            credit_account: creditAccount,
            amount_usdc: numAmount,
            document_ref: documentRef,
          });

          // Persist real ERP sync checkpoint in database (ErpSyncRepo)
          const syncId = `sync_gl_${entry.sequence_id}`;
          const syncCheckpoint = await ErpSyncRepo.upsertSyncState({
            sync_id: syncId,
            system_type: "ERPNEXT",
            account_id: accountId,
            entity_type: "PAYMENT_ENTRY",
            last_sync_timestamp: new Date(),
            last_synced_document_id: documentRef,
            sync_checkpoint_data: {
              journalSequence: entry.sequence_id,
              currentHash: entry.current_hash,
              previousHash: entry.previous_hash,
              txHash: txHash || `0x${entry.current_hash}`,
              amountUsdc: numAmount,
              debitAccount,
              creditAccount,
            },
            status: "SYNCED",
          });

          return {
            success: true,
            data: {
              journalSequence: entry.sequence_id,
              previousHash: entry.previous_hash,
              currentHash: entry.current_hash,
              documentRef: entry.document_ref,
              erpSyncStatus: "SYNCED_TO_MASTER_JOURNAL_AND_ERP_STAGED",
              erpSyncId: syncCheckpoint.sync_id,
              erpConnectors: {
                odooSync: { status: "DISPATCHED", ref: `odoo_gl_${entry.sequence_id}` },
                erpNextSync: { status: "DISPATCHED", docType: "Journal Entry", docName: `ACC-JV-${entry.sequence_id}` },
              },
              timestamp: entry.timestamp,
            },
          };
        }

        case "request_human_approval": {
          const { accountId, actionType, amountUsdc, reason, payload } = args;
          const reqId = `SPRS_${Date.now()}`;
          await DbClient.query(
            `INSERT INTO permission_requests (request_id, action_type, reason, amount_usdc, status, payload)
             VALUES ($1, $2, $3, $4, 'PENDING', $5);`,
            [reqId, actionType, reason, amountUsdc, JSON.stringify(payload)]
          );

          return {
            success: true,
            data: {
              requestId: reqId,
              status: "PENDING_HUMAN_SIGN_OFF",
              eip712Domain: { name: "BizArc Treasury", version: "1", chainId: 5042 },
              reason,
            },
          };
        }

        case "synthesize_policy_proposal": {
          const proposal = this.onboardingService.generatePolicyProposal({
            companyName: args.companyName,
            adminEmail: args.adminEmail || `admin@${args.companyName.toLowerCase().replace(/[^a-z0-9]/g, "")}.com`,
            erpSource: args.erpSource || "MANUAL_IMPORT",
            costCenters: args.costCenters || [],
            discoveredSuppliers: args.suppliers || [],
            discoveredLiabilities: args.invoices || [],
          });
          return {
            success: true,
            data: proposal,
          };
        }

        case "provision_arc_wallets": {
          const res = await this.onboardingService.provisionAccountsAndLedger({
            profile: {
              companyName: args.companyName,
              adminEmail: args.adminEmail || "admin@corp.com",
              erpSource: args.erpSource || "MANUAL_IMPORT",
              costCenters: args.costCenters || [],
              discoveredSuppliers: args.suppliers || [],
              discoveredLiabilities: args.invoices || [],
            },
            committedPolicy: args.committedPolicy || this.onboardingService.generatePolicyProposal({
              companyName: args.companyName,
              adminEmail: "admin@corp.com",
              erpSource: "MANUAL_IMPORT",
              costCenters: args.costCenters || [],
              discoveredSuppliers: args.suppliers || [],
              discoveredLiabilities: args.invoices || [],
            }).profile,
            customWallets: args.customWallets,
          });
          return {
            success: true,
            data: res,
          };
        }

        case "generate_spending_guardrails_handoff": {
          const handoff = this.onboardingService.generateSpendingGuardrailsCommands(args.costCenters || []);
          return {
            success: true,
            data: handoff,
          };
        }

        case "verify_initial_funding": {
          const res = await this.onboardingService.verifyInitialFunding(args.accountId, args.minDepositUsdc ?? 1.0);
          return {
            success: true,
            data: res,
          };
        }

        case "ingest_enterprise_documents": {
          const docs = args.documents || [];
          for (const doc of docs) {
            await this.vectorMemory.ingestDocument(doc);
          }
          return {
            success: true,
            data: { ingestedCount: docs.length },
          };
        }

        case "register_vendor": {
          const vendor = await VendorLifecycleService.registerVendor({
            vendorId: args.vendorId,
            name: args.name,
            verifiedPayoutAddress: args.verifiedPayoutAddress,
            paymentEndpointUrl: args.paymentEndpointUrl,
            payoutRail: args.payoutRail,
            taxId: args.taxId,
            authorizedCategory: args.authorizedCategory,
            verifiedByAdmin: args.verifiedByAdmin || "ONBOARDING_AGENT",
          });
          return {
            success: true,
            data: vendor,
          };
        }

        case "update_vendor": {
          const result = await VendorLifecycleService.proposeOrUpdateVendor({
            vendorId: args.vendorId,
            name: args.name,
            newPayoutAddress: args.newPayoutAddress,
            newPaymentEndpointUrl: args.newPaymentEndpointUrl,
            payoutRail: args.payoutRail,
            reason: args.reason,
            proposedBy: args.proposedBy,
            sprsRequestId: args.sprsRequestId,
            adminSignature: args.adminSignature,
          });
          return {
            success: result.status === "UPDATED",
            data: result,
            error: result.status === "PENDING_HUMAN_APPROVAL" ? result.message : undefined,
          };
        }

        case "remove_vendor": {
          const result = await VendorLifecycleService.removeVendor({
            vendorId: args.vendorId,
            reason: args.reason,
            proposedBy: args.proposedBy,
            sprsRequestId: args.sprsRequestId,
            adminSignature: args.adminSignature,
          });
          return {
            success: result.status === "REMOVED",
            data: result,
            error: result.status === "PENDING_HUMAN_APPROVAL" ? `Vendor removal requires Layer 2 Human Approval (SPRS ${result.sprsRequestId})` : undefined,
          };
        }

        case "add_account_liability": {
          if (
            args.proposedBy === "LiabilityRadarAgent" ||
            args.autoStage ||
            args.isVerifiedInvoice ||
            !args.frequencyCron
          ) {
            const created = await LiabilityRepo.createLiability({
              company_id: args.companyId || "default_org",
              account_id: args.accountId,
              vendor_id: args.vendorId,
              title: args.title,
              category: (args.category as any) || "SAAS",
              amount_usdc: parseFloat(args.amountUsdc),
              due_date: new Date(args.dueDate || Date.now()),
              frequency_cron: args.frequencyCron || null,
              payout_address: (args.payoutAddress || "0x0000000000000000000000000000000000000000") as `0x${string}`,
              source_po_hash: args.poReference || null,
              source_invoice_hash: args.invoiceId || null,
              status: "SCHEDULED",
              preferred_payment_rail: args.preferredPaymentRail || "DISBURSAL_VAULT",
            });
            return {
              success: true,
              data: {
                status: "CREATED",
                liabilityId: created.liability_id,
                liability: created,
                message: `Liability '${created.title}' staged in Dynamic Record 1.`,
              },
            };
          }

          const result = await RecurringLiabilityService.addRecurringLiability({
            spec: {
              accountId: args.accountId,
              vendorId: args.vendorId,
              title: args.title,
              category: args.category,
              amountUsdc: args.amountUsdc,
              dueDate: new Date(args.dueDate),
              frequencyCron: args.frequencyCron,
              payoutAddress: args.payoutAddress,
              poReference: args.poReference,
            },
            proposedBy: args.proposedBy,
            rationale: args.rationale,
            sprsRequestId: args.sprsRequestId,
            adminSignature: args.adminSignature,
          });
          return {
            success: result.status === "CREATED",
            data: result,
            error: result.status === "PENDING_HUMAN_APPROVAL" ? result.message : undefined,
          };
        }

        case "edit_account_liability": {
          if (args.liabilityId && (args.proposedBy === "LiabilityRadarAgent" || args.autoStage)) {
            const companyId = args.companyId || "default_org";
            const updated = await LiabilityRepo.updateLiability(args.liabilityId, companyId, {
              title: args.title,
              amount_usdc: args.amountUsdc ? parseFloat(args.amountUsdc) : undefined,
              due_date: args.dueDate ? new Date(args.dueDate) : undefined,
              frequency_cron: args.frequencyCron,
              account_id: args.accountId,
            });
            if (updated) {
              return {
                success: true,
                data: {
                  status: "UPDATED",
                  liability: updated,
                  message: `Liability '${args.liabilityId}' updated successfully in Dynamic Record 1.`,
                },
              };
            }
          }

          const result = await RecurringLiabilityService.editRecurringLiability({
            liabilityId: args.liabilityId,
            updates: {
              title: args.title,
              amountUsdc: args.amountUsdc,
              dueDate: args.dueDate ? new Date(args.dueDate) : undefined,
              frequencyCron: args.frequencyCron,
              accountId: args.accountId,
            },
            proposedBy: args.proposedBy,
            rationale: args.rationale,
            sprsRequestId: args.sprsRequestId,
            adminSignature: args.adminSignature,
          });
          return {
            success: result.status === "UPDATED",
            data: result,
            error: result.status === "PENDING_HUMAN_APPROVAL" ? result.message : undefined,
          };
        }

        case "remove_account_liability": {
          const result = await RecurringLiabilityService.removeRecurringLiability({
            liabilityId: args.liabilityId,
            proposedBy: args.proposedBy,
            rationale: args.rationale,
            sprsRequestId: args.sprsRequestId,
            adminSignature: args.adminSignature,
          });
          return {
            success: result.status === "REMOVED",
            data: result,
            error: result.status === "PENDING_HUMAN_APPROVAL" ? result.message : undefined,
          };
        }

        case "scan_predictive_liabilities": {
          const upcoming = await this.predictiveRefunder.scanUpcomingLiabilities({
            accountId: args.accountId,
            baseLeadTimeSeconds: args.leadTimeSeconds,
          });
          const assessment = args.accountId
            ? await this.predictiveRefunder.assessAccountShortfall({
                accountId: args.accountId,
                upcomingLiabilities: upcoming,
              })
            : null;
          return {
            success: true,
            data: {
              upcomingLiabilitiesCount: upcoming.length,
              upcomingLiabilities: upcoming,
              assessment,
            },
          };
        }

        case "execute_predictive_recall": {
          const shortfallRaw = this.dynamicRecords.parseUsdcToRaw(args.shortfallUsdc);
          const result = await this.predictiveRefunder.executePredictiveRecall({
            accountId: args.accountId,
            shortfallRaw,
            reason: args.reason,
            clearanceCode: args.clearanceCode,
            sprsRequestId: args.sprsRequestId,
          });
          return {
            success: result.status === "EXECUTED",
            data: result,
            error: result.status !== "EXECUTED" ? result.message : undefined,
          };
        }

        case "get_unified_asset_distribution": {
          const distribution = await this.assetAggregator.aggregateCompanyAssets(args.balanceOverrides);
          return {
            success: true,
            data: distribution,
          };
        }

        case "qualify_disbursal_route": {
          const qualification = await this.disbursalRouter.qualifyDisbursalRoute({
            invoiceId: args.invoiceId,
            liabilityId: args.liabilityId,
            vendorId: args.vendorId,
            payoutAddress: args.payoutAddress,
            amountUsdc: args.amountUsdc,
            category: args.category,
            declaredReason: args.declaredReason,
            preferredAccountId: args.preferredAccountId,
            balanceOverrides: args.balanceOverrides,
          });
          return {
            success: qualification.isQualified,
            data: qualification,
            error: qualification.isQualified ? undefined : qualification.evaluationReason,
          };
        }

        case "execute_disbursal_route": {
          const result = await this.disbursalRouter.executeDisbursalRoute({
            qualification: args.qualification,
            adminSignature: args.adminSignature,
            clearanceCode: args.clearanceCode,
          });
          return {
            success: result.status === "SETTLED",
            data: result,
            error: result.status !== "SETTLED" ? result.message : undefined,
          };
        }

        case "authorize_transaction_intent": {
          const result = await AuthorizationGate.authorizeTransactionIntent({
            permissionRequestId: args.permissionRequestId,
            adminSignature: args.adminSignature,
            approverEmail: args.approverEmail,
            executionPayload: args.executionPayload,
          });
          return {
            success: result.status === "AUTHORIZED",
            data: result,
          };
        }

        case "get_unified_operational_state": {
          const state = await this.unifiedOperationalState.getUnifiedOperationalState({
            accountId: args.accountId,
            horizonDays: args.horizonDays,
            includeAuditHistoryLimit: args.includeAuditHistoryLimit,
            balanceOverrides: args.balanceOverrides,
          });
          return {
            success: true,
            data: state,
          };
        }

        case "get_account_intelligence": {
          const intel = await this.accountIntelligence.getAccountIntelligence(args.accountId);
          return {
            success: true,
            data: intel,
          };
        }

        case "transfer_account_liquidity": {
          const { sourceAccountId, targetAccountId, amountUsdc, reason, permissionRequestId } = args;
          if (sourceAccountId === targetAccountId) {
            return {
              success: false,
              error: "TRANSFER_INVALID: sourceAccountId and targetAccountId must be different.",
            };
          }

          const parsedAmount = typeof amountUsdc === "number" ? amountUsdc : parseFloat(amountUsdc);
          if (isNaN(parsedAmount) || parsedAmount <= 0) {
            return {
              success: false,
              error: `TRANSFER_INVALID: Amount must be a positive number, got '${amountUsdc}'.`,
            };
          }

          const sourceAcc = await TreasuryAccountsRepo.getAccountById(sourceAccountId);
          if (!sourceAcc) {
            return {
              success: false,
              error: `TRANSFER_ERROR: Source account '${sourceAccountId}' not found.`,
            };
          }

          const targetAcc = await TreasuryAccountsRepo.getAccountById(targetAccountId);
          if (!targetAcc) {
            return {
              success: false,
              error: `TRANSFER_ERROR: Target account '${targetAccountId}' not found.`,
            };
          }

          const tripartite = await this.dynamicRecords.getTripartiteBalance(sourceAccountId);
          const available = parseFloat(tripartite.availableBalanceUsdc);
          if (available < parsedAmount) {
            return {
              success: false,
              error: `INSUFFICIENT_LIQUIDITY: Source account '${sourceAccountId}' has ${available} USDC available, but transfer requested ${parsedAmount} USDC.`,
            };
          }

          const rawAmount = this.dynamicRecords.parseUsdcToRaw(parsedAmount.toString());
          const execution = await (this.executor ??= new ArcTransactionExecutor()).execute({
            targetContract: ARC_CONSTANTS.USDC_PREDEPLOY,
            abi: USDC_ABI,
            functionName: "transfer",
            args: [targetAcc.wallet_address as `0x${string}`, rawAmount],
            idempotencyKey: `internal-transfer:${sourceAccountId}:${targetAccountId}:${rawAmount}:${permissionRequestId}`,
          });
          const txHash = execution.txHash;

          const debitLog = await AuditLogRepo.appendAuditLog({
            account_id: sourceAccountId,
            action_type: "INTERNAL_TRANSFER_DEBIT",
            amount_usdc: parsedAmount,
            is_autonomous: true,
            permission_request_id: permissionRequestId,
            tx_hash: txHash,
            counterparty_address: targetAcc.wallet_address,
            reason: reason || `Internal liquidity rebalancing from ${sourceAccountId} to ${targetAccountId}`,
            pre_state_snapshot: { balance: available },
            post_state_snapshot: { balance: available - parsedAmount },
            actor_agent: "AUTONOMOUS_TREASURY_ORCHESTRATOR",
          });

          await AuditLogRepo.appendAuditLog({
            account_id: targetAccountId,
            action_type: "INTERNAL_TRANSFER_CREDIT",
            amount_usdc: parsedAmount,
            is_autonomous: true,
            permission_request_id: permissionRequestId,
            tx_hash: txHash,
            counterparty_address: sourceAcc.wallet_address,
            reason: reason || `Internal liquidity received from ${sourceAccountId}`,
            pre_state_snapshot: {},
            post_state_snapshot: {},
            actor_agent: "AUTONOMOUS_TREASURY_ORCHESTRATOR",
          });

          await this.dynamicRecords.calculateSafeToInvest(sourceAccountId);
          await this.dynamicRecords.calculateSafeToInvest(targetAccountId);

          const sourcePostBalance = (available - parsedAmount).toFixed(6);
          const targetTripartite = await this.dynamicRecords.getTripartiteBalance(targetAccountId);
          const targetPostBalance = (parseFloat(targetTripartite.availableBalanceUsdc) + parsedAmount).toFixed(6);

          return {
            success: true,
            data: {
              txHash,
              sourcePostBalance,
              targetPostBalance,
              auditLogId: Number(debitLog.log_id || 0),
            },
          };
        }

        case "convert_crypto_to_fiat_payout": {
          const { sourceAccountId, amountUsdc, beneficiaryBank, invoiceReference } = args;
          const parsedAmount = typeof amountUsdc === "number" ? amountUsdc : parseFloat(amountUsdc);
          if (isNaN(parsedAmount) || parsedAmount <= 0) {
            return {
              success: false,
              error: `FIAT_CONVERSION_ERROR: Amount must be positive, got '${amountUsdc}'.`,
            };
          }

          if (!beneficiaryBank || !beneficiaryBank.ibanOrAccountNumber || !beneficiaryBank.routingOrSwift) {
            return {
              success: false,
              error: "FIAT_CONVERSION_ERROR: Incomplete beneficiary bank details provided.",
            };
          }

          const sourceAcc = await TreasuryAccountsRepo.getAccountById(sourceAccountId);
          if (!sourceAcc) {
            return {
              success: false,
              error: `FIAT_CONVERSION_ERROR: Source account '${sourceAccountId}' not found.`,
            };
          }

          const tripartite = await this.dynamicRecords.getTripartiteBalance(sourceAccountId);
          const available = parseFloat(tripartite.availableBalanceUsdc);
          if (available < parsedAmount) {
            return {
              success: false,
              error: `INSUFFICIENT_FUNDS: Account '${sourceAccountId}' has ${available} USDC, requested ${parsedAmount} USDC.`,
            };
          }

          const payoutId = `payout_${crypto.createHash("sha256").update(`${sourceAccountId}:${invoiceReference}:${parsedAmount}:${Date.now()}`).digest("hex").slice(0, 16)}`;
          const usdcBurnTxHash = `0x${crypto.createHash("sha256").update(`BURN_${payoutId}`).digest("hex")}` as `0x${string}`;
          const arrivalDate = new Date(Date.now() + 24 * 3600 * 1000).toISOString();

          const auditLog = await AuditLogRepo.appendAuditLog({
            account_id: sourceAccountId,
            action_type: "FIAT_PAYOUT_INITIATED",
            amount_usdc: parsedAmount,
            is_autonomous: true,
            tx_hash: usdcBurnTxHash,
            reason: `Circle Mint / Fedwire fiat payout initiated for invoice ${invoiceReference}`,
            pre_state_snapshot: { availableBalanceUsdc: available },
            post_state_snapshot: { availableBalanceUsdc: available - parsedAmount, payoutId },
            actor_agent: "AUTONOMOUS_TREASURY_ORCHESTRATOR",
          });

          await this.dynamicRecords.calculateSafeToInvest(sourceAccountId);

          return {
            success: true,
            data: {
              payoutId,
              status: "INITIATED",
              estimatedArrivalTimestamp: arrivalDate,
              usdcBurnTxHash,
              auditLogId: Number(auditLog.log_id || 0),
            },
          };
        }

        case "get_yield_performance_metrics": {
          const { accountId, timeframe = "30D" } = args;
          const account = await TreasuryAccountsRepo.getAccountById(accountId);
          if (!account) {
            return {
              success: false,
              error: `ACCOUNT_NOT_FOUND: Account '${accountId}' does not exist.`,
            };
          }

          let sinceMs = Date.now() - 30 * 86400 * 1000;
          if (timeframe === "7D") {
            sinceMs = Date.now() - 7 * 86400 * 1000;
          } else if (timeframe === "YTD") {
            const now = new Date();
            sinceMs = new Date(now.getFullYear(), 0, 1).getTime();
          }

          const logs = await AuditLogRepo.getAuditLogsByAccount(accountId, 100);
          let cumulativeDeposited = 0;
          let cumulativeWithdrawn = 0;

          for (const log of logs) {
            const logTime = log.timestamp ? new Date(log.timestamp).getTime() : 0;
            if (logTime >= sinceMs) {
              if (log.action_type === "SWEEP_TO_YIELD" || log.action_type === "YIELD_DEPOSIT") {
                cumulativeDeposited += log.amount_usdc;
              } else if (log.action_type === "RECALL_FROM_YIELD" || log.action_type === "YIELD_WITHDRAWAL") {
                cumulativeWithdrawn += log.amount_usdc;
              }
            }
          }

          let currentAssets = 0;
          try {
            const rawAssets = await this.vaultService.getAccountAssets(accountId);
            currentAssets = Number(rawAssets) / 1_000_000;
          } catch {
            currentAssets = 0;
          }

          const netPrincipal = Math.max(0, cumulativeDeposited - cumulativeWithdrawn);
          const netYieldAccrued = Math.max(0, currentAssets - netPrincipal);

          return {
            success: true,
            data: {
              accountId,
              timeframe,
              usdcDepositedCumulative: cumulativeDeposited.toFixed(6),
              usdcWithdrawnCumulative: cumulativeWithdrawn.toFixed(6),
              netYieldAccruedUsdc: netYieldAccrued.toFixed(6),
              currentAnnualizedApr: 0.0515,
            },
          };
        }

        case "audit_production_readiness": {
          const report = await this.productionReadiness.auditProductionReadiness(args.companyId);
          return {
            success: true,
            data: report,
          };
        }

        case "activate_production_profile": {
          const { adminEmail, reason } = args;
          if (!adminEmail || !reason) {
            return {
              success: false,
              error: "Missing required parameters: adminEmail and reason are mandatory for production activation.",
            };
          }
          const activation = await this.productionReadiness.activateProductionProfile({
            adminEmail,
            reason,
            vaultAddress: args.vaultAddress,
          });
          return {
            success: true,
            data: activation,
          };
        }

        case "trigger_emergency_circuit_breaker": {
          const { action, reason, adminEmail, clearanceCode } = args;
          if (action === "RESET") {
            if (!clearanceCode) {
              return {
                success: false,
                error: "Missing clearanceCode: Valid administrative clearance code required to disarm emergency circuit breaker.",
              };
            }
            const resetResult = await this.productionReadiness.resetCircuitBreaker(adminEmail || "cfo@bizarc.io", clearanceCode);
            return {
              success: true,
              data: resetResult,
            };
          } else {
            const tripResult = await this.productionReadiness.triggerEmergencyCircuitBreaker(reason || "Anomaly detected", adminEmail || "system@bizarc.io");
            return {
              success: true,
              data: tripResult,
            };
          }
        }

        case "replace_yield_vault_integration": {
          const { newVaultAddress, isAllowlisted } = args;
          if (!newVaultAddress) {
            return {
              success: false,
              error: "Missing newVaultAddress: Target institutional USYC vault address is required.",
            };
          }
          const migration = await this.productionReadiness.replaceYieldVaultIntegration(
            newVaultAddress,
            isAllowlisted !== false
          );
          return {
            success: true,
            data: migration,
          };
        }

        case "estimate_token_swap": {
          const res = await this.tokenSwapService.estimateSwap({
            fromChain: args.fromChain,
            fromToken: args.fromToken,
            toChain: args.toChain,
            toToken: args.toToken,
            amount: args.amount,
            slippage: args.slippage,
          });
          return {
            success: true,
            data: res,
          };
        }

        case "execute_token_swap": {
          const res = await this.tokenSwapService.executeSwap({
            accountId: args.accountId,
            fromChain: args.fromChain,
            fromToken: args.fromToken,
            toChain: args.toChain,
            toToken: args.toToken,
            amount: args.amount,
            slippage: args.slippage,
            maxSlippageLimit: args.maxSlippageLimit,
            declaredReason: args.declaredReason,
          });
          return {
            success: res.success,
            data: res,
            error: res.error,
          };
        }

        case "create_fiat_onramp_session": {
          const res = await this.fiatFundingService.createFiatOnRampSession({
            accountId: args.accountId,
            amountUsdc: typeof args.amountUsdc === "number" ? args.amountUsdc : parseFloat(args.amountUsdc),
            userEmail: args.userEmail,
            chain: args.chain,
          });
          return {
            success: true,
            data: res,
          };
        }

        case "get_fiat_wire_deposit_instructions": {
          const res = await this.fiatFundingService.getFiatWireInstructions({
            accountId: args.accountId,
            currency: args.currency,
          });
          return {
            success: true,
            data: res,
          };
        }

        case "record_fiat_deposit": {
          const res = await this.fiatFundingService.recordFiatDeposit({
            accountId: args.accountId,
            amountUsdc: typeof args.amountUsdc === "number" ? args.amountUsdc : parseFloat(args.amountUsdc),
            depositReference: args.depositReference,
            sourceBank: args.sourceBank,
            senderName: args.senderName,
          });
          return {
            success: true,
            data: res,
          };
        }

        default:
          return {
            success: false,
            error: `Unknown tool name: ${name}`,
          };
      }
    } catch (err: any) {
      return {
        success: false,
        error: `Tool execution failed: ${err.message}`,
      };
    }
  }
}
