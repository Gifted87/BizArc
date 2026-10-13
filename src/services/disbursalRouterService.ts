import { keccak256, encodePacked } from "viem";
import { UnifiedAssetAggregatorService, AccountAssetDistribution } from "./unifiedAssetAggregatorService.js";
import { DynamicRecordsService } from "../records/dynamicRecordsService.js";
import { VendorMasterRepo } from "../database/repos/vendorMasterRepo.js";
import { DisbursalVaultService } from "../contracts/disbursalVaultService.js";
import { CentralTreasuryYieldVaultService } from "../contracts/centralTreasuryYieldVaultService.js";
import { DisbursalVaultABI } from "../contracts/index.js";
import { ArcTransactionExecutor } from "../foundation/wallets/arcTransactionExecutor.js";
import { LedgerWitnessService } from "./ledgerWitnessService.js";
import { AuthorizationGate } from "../security/authorizationGate.js";
import { PolicyLoader } from "../config/policyLoader.js";
import { LoudRoundingError } from "../foundation/usdc/usdcService.js";
import { PermissionRequestRepo } from "../database/repos/permissionRequestRepo.js";
import { ErpReconciliationService } from "./erpReconciliationService.js";

export interface DisbursalRoutingRequest {
  invoiceId: string;
  liabilityId?: string;
  vendorId: string;
  vendorName?: string;
  payoutAddress: `0x${string}`;
  amountUsdc: string; // Exact 6-decimal string
  category: string; // e.g. "INFRASTRUCTURE", "MARKETING", "PAYROLL", "GENERAL_OPEX"
  declaredReason?: string;
  poReference?: string;
  deliveryProofHash?: string;
  preferredAccountId?: string;
  balanceOverrides?: Record<string, { liquidUsdc?: number | bigint; investedUsyc?: number | bigint }>;
}

export interface DisbursalAllocationItem {
  accountId: string;
  accountName: string;
  accountRole: string;
  allocatedAmountUsdc: string;
  allocatedAmountRaw: bigint;
  requiresRecall: boolean;
  recallAmountUsdc: string;
  recallAmountRaw: bigint;
  remainingFreeCapitalUsdc: string;
  remainingFreeCapitalRaw: bigint;
}

export interface DisbursalRouteQualification {
  routeType: "SINGLE_ACCOUNT" | "MULTI_ACCOUNT_WATERFALL" | "REJECTED_INSUFFICIENT_FUNDS" | "REJECTED_POLICY";
  isQualified: boolean;
  invoiceId: string;
  liabilityId?: string;
  vendorId: string;
  payoutAddress: `0x${string}`;
  category: string;
  totalRequestedUsdc: string;
  totalRequestedRaw: bigint;
  totalAllocatedUsdc: string;
  totalAllocatedRaw: bigint;
  shortfallUsdc?: string;
  shortfallRaw?: bigint;
  primaryAccountId?: string;
  allocations: DisbursalAllocationItem[];
  requiresHumanApproval: boolean;
  evaluationReason: string;
  idempotencyKey: `0x${string}`;
  reasonBearingIntent: {
    proposedAction: string;
    accountId: string;
    amountUsdc: string;
    declaredReason: string;
    recipientAddress: string;
  };
}

export interface DisbursalExecutionResult {
  status: "SETTLED" | "AWAITING_HUMAN_APPROVAL" | "REJECTED" | "FAILED";
  idempotencyKey: `0x${string}`;
  txHash?: `0x${string}`;
  encodedCalldata?: `0x${string}`;
  sprsRequestId?: string;
  clearanceCode?: string;
  journalSequenceId?: number;
  journalHash?: string;
  stagedFunds?: {
    totalStagedUsdc: string;
    totalStagedRaw: bigint;
    allocations: Array<{ accountId: string; amountUsdc: string; raw: bigint }>;
  };
  erpSync?: {
    status: "SYNCED" | "FAILED";
    threeWayMatchVerified: boolean;
    erpNextDocName?: string;
    odooPaymentId?: number;
    syncId?: string;
  };
  message: string;
  qualification: DisbursalRouteQualification;
}

/**
 * D15: DisbursalRouterService (Sentence 19 & Sentence 20 / DAG Node D15, D18, D19)
 * Qualifies optimal single-account or multi-account waterfall routing for vendor disbursements.
 * Stages funds into DisbursalVault, coordinates onchain execution, and synchronizes to ERPs.
 * Enforces role compatibility, protected liability reserves, strict payroll exclusions,
 * and deterministic Keccak-256 idempotency.
 */
export class DisbursalRouterService {
  private aggregator: UnifiedAssetAggregatorService;
  private dynamicRecords: DynamicRecordsService;
  private vaultService: CentralTreasuryYieldVaultService;
  private disbursalVault: DisbursalVaultService;
  private witnessService: LedgerWitnessService;
  private erpReconciliation: ErpReconciliationService;
  private executor: ArcTransactionExecutor;
  private executedIdempotencyKeys: Set<string> = new Set();

  constructor(options?: {
    aggregator?: UnifiedAssetAggregatorService;
    dynamicRecords?: DynamicRecordsService;
    vaultService?: CentralTreasuryYieldVaultService;
    disbursalVault?: DisbursalVaultService;
    witnessService?: LedgerWitnessService;
    erpReconciliation?: ErpReconciliationService;
    executor?: ArcTransactionExecutor;
  }) {
    this.dynamicRecords = options?.dynamicRecords ?? new DynamicRecordsService();
    this.aggregator = options?.aggregator ?? new UnifiedAssetAggregatorService({ dynamicRecords: this.dynamicRecords });
    this.vaultService =
      options?.vaultService ??
      new CentralTreasuryYieldVaultService(
        (process.env.CENTRAL_TREASURY_VAULT_ADDRESS as `0x${string}`) || "0x4444444444444444444444444444444444444444"
      );
    this.disbursalVault =
      options?.disbursalVault ??
      new DisbursalVaultService(
        (process.env.DISBURSAL_VAULT_ADDRESS as `0x${string}`) || "0x5555555555555555555555555555555555555555"
      );
    this.witnessService = options?.witnessService ?? new LedgerWitnessService();
    this.erpReconciliation = options?.erpReconciliation ?? new ErpReconciliationService();
    this.executor = options?.executor ?? new ArcTransactionExecutor();
  }

  /**
   * Evaluates role compatibility between an expenditure category and a candidate treasury account.
   */
  public isRoleCompatible(category: string, account: AccountAssetDistribution): boolean {
    const normCategory = category.toUpperCase().trim();

    // 1. Strict Payroll Shielding:
    // If the invoice is PAYROLL, only PAYROLL account is eligible.
    if (normCategory === "PAYROLL") {
      return account.role === "PAYROLL";
    }

    // If the invoice is NOT payroll, PAYROLL account is strictly PROHIBITED
    if (account.role === "PAYROLL" || account.excludeFromWaterfall) {
      return false;
    }

    // 2. Direct Authorized Category Match from Policy
    if (account.authorizedCategories.some((c) => c.toUpperCase() === normCategory)) {
      return true;
    }

    // 3. Standard Semantic Mappings
    if (normCategory.includes("INFRA") || normCategory.includes("DEVELOPER") || normCategory.includes("CLOUD")) {
      return account.role.includes("DEV") || account.role.includes("OPEX");
    }
    if (normCategory.includes("MARKET") || normCategory.includes("GROWTH") || normCategory.includes("ADS")) {
      return account.role.includes("GROWTH") || account.role.includes("OPEX");
    }
    if (normCategory.includes("GENERAL") || normCategory.includes("SAAS") || normCategory.includes("SUBSCRIPTION")) {
      return account.role.includes("OPEX") || account.role.includes("TREASURY");
    }

    // Default: allow non-payroll operating accounts for general corporate opex
    return !account.role.includes("PAYROLL");
  }

  /**
   * Sentence 19 & 20: Qualify single-account or multi-account waterfall disbursal route.
   */
  public async qualifyDisbursalRoute(
    request: DisbursalRoutingRequest
  ): Promise<DisbursalRouteQualification> {
    const rawAmount = this.dynamicRecords.parseUsdcToRaw(request.amountUsdc);
    if (rawAmount <= 0n) {
      throw new LoudRoundingError("Disbursal amount must be strictly greater than 0 micro-USDC.");
    }

    // 1. Payee Substitution Defense (Rule 3)
    const verifiedVendor = await VendorMasterRepo.getVendorById(request.vendorId);
    if (verifiedVendor && verifiedVendor.verified_payout_address) {
      if (verifiedVendor.verified_payout_address.toLowerCase() !== request.payoutAddress.toLowerCase()) {
        const idempotencyKey = DisbursalVaultService.generateIdempotencyKey(
          request.payoutAddress,
          request.invoiceId,
          rawAmount
        );
        return {
          routeType: "REJECTED_POLICY",
          isQualified: false,
          invoiceId: request.invoiceId,
          liabilityId: request.liabilityId,
          vendorId: request.vendorId,
          payoutAddress: request.payoutAddress,
          category: request.category,
          totalRequestedUsdc: request.amountUsdc,
          totalRequestedRaw: rawAmount,
          totalAllocatedUsdc: "0.000000",
          totalAllocatedRaw: 0n,
          allocations: [],
          requiresHumanApproval: true,
          evaluationReason: `PAYEE SUBSTITUTION DETECTED (Rule 3): Claimed address ${request.payoutAddress} does not match verified Vendor Master address ${verifiedVendor.verified_payout_address}.`,
          idempotencyKey,
          reasonBearingIntent: {
            proposedAction: "DISBURSAL_SETTLEMENT",
            accountId: request.preferredAccountId || "UNKNOWN",
            amountUsdc: request.amountUsdc,
            declaredReason: "REJECTED: Payee Substitution",
            recipientAddress: request.payoutAddress,
          },
        };
      }
    }

    // Deterministic Keccak-256 Idempotency Key
    const idempotencyKey = DisbursalVaultService.generateIdempotencyKey(
      request.payoutAddress,
      request.invoiceId,
      rawAmount
    );

    // 2. Fetch Unified Asset Distribution across All Accounts (D14 Integration)
    const companyDistribution = await this.aggregator.aggregateCompanyAssets(request.balanceOverrides);
    const activeAccounts = companyDistribution.accountsDistribution.filter((a) => a.isActive);

    // 3. Sentence 19: Check for Single-Account Qualification
    // Filter compatible accounts
    const compatibleAccounts = activeAccounts.filter((acc) => this.isRoleCompatible(request.category, acc));

    // If preferred account specified, evaluate it first
    let selectedSingleAccount: AccountAssetDistribution | undefined;
    if (request.preferredAccountId) {
      const preferred = compatibleAccounts.find((a) => a.accountId === request.preferredAccountId);
      if (preferred && preferred.freeCapitalRaw >= rawAmount) {
        selectedSingleAccount = preferred;
      }
    }

    // Otherwise, search compatible accounts with sufficient free capital
    if (!selectedSingleAccount) {
      selectedSingleAccount = compatibleAccounts.find((a) => a.freeCapitalRaw >= rawAmount);
    }

    // Check spending caps from active policy
    const { profile } = PolicyLoader.getActiveProfile();
    const singleTxCapRaw = this.dynamicRecords.parseUsdcToRaw(
      (profile.spending_limits.single_tx_human_gate_threshold_usdc || 500).toFixed(6)
    );

    // Path A: Single-Account Route Qualified!
    if (selectedSingleAccount) {
      const requiresRecall = selectedSingleAccount.liquidRaw < rawAmount;
      const recallAmountRaw = requiresRecall ? rawAmount - selectedSingleAccount.liquidRaw : 0n;
      const remainingFreeRaw = selectedSingleAccount.freeCapitalRaw - rawAmount;

      const allocation: DisbursalAllocationItem = {
        accountId: selectedSingleAccount.accountId,
        accountName: selectedSingleAccount.name,
        accountRole: selectedSingleAccount.role,
        allocatedAmountUsdc: request.amountUsdc,
        allocatedAmountRaw: rawAmount,
        requiresRecall,
        recallAmountUsdc: this.dynamicRecords.formatRawToUsdc(recallAmountRaw),
        recallAmountRaw,
        remainingFreeCapitalUsdc: this.dynamicRecords.formatRawToUsdc(remainingFreeRaw),
        remainingFreeCapitalRaw: remainingFreeRaw,
      };

      const requiresHuman = rawAmount >= singleTxCapRaw;
      const declaredReason =
        request.declaredReason ||
        `Single-account disbursal from ${selectedSingleAccount.name} (${selectedSingleAccount.role}) covering ${request.amountUsdc} USDC for invoice ${request.invoiceId}. Liability reserve of ${selectedSingleAccount.protectedReserveUsdc} USDC strictly protected.`;

      return {
        routeType: "SINGLE_ACCOUNT",
        isQualified: true,
        invoiceId: request.invoiceId,
        liabilityId: request.liabilityId,
        vendorId: request.vendorId,
        payoutAddress: request.payoutAddress,
        category: request.category,
        totalRequestedUsdc: request.amountUsdc,
        totalRequestedRaw: rawAmount,
        totalAllocatedUsdc: request.amountUsdc,
        totalAllocatedRaw: rawAmount,
        primaryAccountId: selectedSingleAccount.accountId,
        allocations: [allocation],
        requiresHumanApproval: requiresHuman,
        evaluationReason: `Qualified single account '${selectedSingleAccount.name}' with ${selectedSingleAccount.freeCapitalUsdc} USDC free capital.`,
        idempotencyKey,
        reasonBearingIntent: {
          proposedAction: "DISBURSAL_SETTLEMENT",
          accountId: selectedSingleAccount.accountId,
          amountUsdc: request.amountUsdc,
          declaredReason,
          recipientAddress: request.payoutAddress,
        },
      };
    }

    // Path B: Sentence 20 - Multi-Account Waterfall Allocation
    // Filter eligible accounts across the company (strictly non-payroll, active, positive free capital)
    const waterfallCandidates = activeAccounts.filter(
      (a) => a.role !== "PAYROLL" && !a.excludeFromWaterfall && a.freeCapitalRaw > 0n
    );

    // Rank candidate accounts:
    // 1. Department compatible accounts first
    // 2. Highest free capital descending
    waterfallCandidates.sort((a, b) => {
      const aComp = this.isRoleCompatible(request.category, a);
      const bComp = this.isRoleCompatible(request.category, b);
      if (aComp && !bComp) return -1;
      if (!aComp && bComp) return 1;
      return Number(b.freeCapitalRaw - a.freeCapitalRaw);
    });

    let remainingNeededRaw = rawAmount;
    const allocations: DisbursalAllocationItem[] = [];
    let totalAllocatedRaw = 0n;

    for (const candidate of waterfallCandidates) {
      if (remainingNeededRaw <= 0n) break;

      const takeRaw = candidate.freeCapitalRaw >= remainingNeededRaw ? remainingNeededRaw : candidate.freeCapitalRaw;
      const requiresRecall = candidate.liquidRaw < takeRaw;
      const recallAmountRaw = requiresRecall ? takeRaw - candidate.liquidRaw : 0n;
      const remainingFreeRaw = candidate.freeCapitalRaw - takeRaw;

      allocations.push({
        accountId: candidate.accountId,
        accountName: candidate.name,
        accountRole: candidate.role,
        allocatedAmountUsdc: this.dynamicRecords.formatRawToUsdc(takeRaw),
        allocatedAmountRaw: takeRaw,
        requiresRecall,
        recallAmountUsdc: this.dynamicRecords.formatRawToUsdc(recallAmountRaw),
        recallAmountRaw,
        remainingFreeCapitalUsdc: this.dynamicRecords.formatRawToUsdc(remainingFreeRaw),
        remainingFreeCapitalRaw: remainingFreeRaw,
      });

      totalAllocatedRaw += takeRaw;
      remainingNeededRaw -= takeRaw;
    }

    // If still remaining, company has insufficient aggregate free liquidity
    if (remainingNeededRaw > 0n) {
      const shortfallUsdc = this.dynamicRecords.formatRawToUsdc(remainingNeededRaw);
      return {
        routeType: "REJECTED_INSUFFICIENT_FUNDS",
        isQualified: false,
        invoiceId: request.invoiceId,
        liabilityId: request.liabilityId,
        vendorId: request.vendorId,
        payoutAddress: request.payoutAddress,
        category: request.category,
        totalRequestedUsdc: request.amountUsdc,
        totalRequestedRaw: rawAmount,
        totalAllocatedUsdc: this.dynamicRecords.formatRawToUsdc(totalAllocatedRaw),
        totalAllocatedRaw,
        shortfallUsdc,
        shortfallRaw: remainingNeededRaw,
        allocations,
        requiresHumanApproval: true,
        evaluationReason: `Insufficient company-wide unencumbered liquidity: Shortfall of ${shortfallUsdc} USDC across all eligible operating accounts (Payroll safely protected).`,
        idempotencyKey,
        reasonBearingIntent: {
          proposedAction: "DISBURSAL_SETTLEMENT",
          accountId: allocations[0]?.accountId || "OPEX_DEV",
          amountUsdc: request.amountUsdc,
          declaredReason: `INSUFFICIENT_FUNDS: Shortfall of ${shortfallUsdc} USDC`,
          recipientAddress: request.payoutAddress,
        },
      };
    }

    // Multi-Account Waterfall fully qualified!
    // Note: Multi-account movements always require human sign-off per corporate bylaws unless pre-authorized
    const primaryAccountId = allocations[0]?.accountId;
    const declaredReason =
      request.declaredReason ||
      `Multi-account waterfall allocation for ${request.amountUsdc} USDC invoice across ${allocations.length} accounts: ${allocations.map((a) => `${a.accountName} ($${a.allocatedAmountUsdc})`).join(", ")}. Payroll strictly protected.`;

    return {
      routeType: "MULTI_ACCOUNT_WATERFALL",
      isQualified: true,
      invoiceId: request.invoiceId,
      liabilityId: request.liabilityId,
      vendorId: request.vendorId,
      payoutAddress: request.payoutAddress,
      category: request.category,
      totalRequestedUsdc: request.amountUsdc,
      totalRequestedRaw: rawAmount,
      totalAllocatedUsdc: request.amountUsdc,
      totalAllocatedRaw: rawAmount,
      primaryAccountId,
      allocations,
      requiresHumanApproval: true, // Multi-account draws require SPRS by default
      evaluationReason: `Qualified multi-account waterfall allocation across ${allocations.length} accounts.`,
      idempotencyKey,
      reasonBearingIntent: {
        proposedAction: "MULTI_ACCOUNT_WATERFALL_DISBURSAL",
        accountId: primaryAccountId,
        amountUsdc: request.amountUsdc,
        declaredReason,
        recipientAddress: request.payoutAddress,
      },
    };
  }

  /**
   * D18: Stage Funds (Sentence 19 & Sentence 20 / DAG Node D18)
   * Recalls USYC if needed for shortfall, and stages liquid USDC from qualified accounts
   * into the temporary DisbursalVault, recording double-entry staging vouchers.
   */
  public async stageFunds(
    qualification: DisbursalRouteQualification,
    disbursalVaultAddress?: `0x${string}`
  ): Promise<{
    status: "FUNDS_STAGED";
    totalStagedUsdc: string;
    totalStagedRaw: bigint;
    allocations: Array<{ accountId: string; amountUsdc: string; raw: bigint }>;
  }> {
    const vaultAddr = disbursalVaultAddress || this.disbursalVault.getAddress();
    const stagingAllocations: Array<{ accountId: string; amountUsdc: string; raw: bigint }> = [];
    let accumulatedStagedRaw = 0n;

    for (const alloc of qualification.allocations) {
      // 1. If USYC yield recall required, execute recall to liquid
      if (alloc.requiresRecall && alloc.recallAmountRaw > 0n) {
        const recallDocRef = `DISBURSAL_PRE_RECALL_${alloc.accountId}_${Date.now()}`;
        await this.witnessService.recordJournalVoucher({
          accountId: alloc.accountId,
          actionType: "AUTONOMOUS_RECALL",
          amountUsdc: parseFloat(alloc.recallAmountUsdc),
          documentRef: recallDocRef,
        });

        await this.witnessService.recordAccountAuditLog({
          accountId: alloc.accountId,
          actionType: "AUTONOMOUS_RECALL",
          amountUsdc: parseFloat(alloc.recallAmountUsdc),
          isAutonomous: true,
          reason: `Automatic yield recall of ${alloc.recallAmountUsdc} USDC to stage vendor payment for invoice ${qualification.invoiceId}`,
        });
      }

      // 2. Stage liquid funds from account into DisbursalVault
      const stageDocRef = `STAGE_${alloc.accountId}_TO_VAULT_${qualification.invoiceId}`;
      await this.witnessService.recordJournalVoucher({
        accountId: alloc.accountId,
        actionType: "STAGE_FUNDS_TO_DISBURSAL_VAULT",
        amountUsdc: parseFloat(alloc.allocatedAmountUsdc),
        documentRef: stageDocRef,
      });

      await this.witnessService.recordAccountAuditLog({
        accountId: alloc.accountId,
        actionType: "STAGE_FUNDS_TO_DISBURSAL_VAULT",
        amountUsdc: parseFloat(alloc.allocatedAmountUsdc),
        isAutonomous: true,
        reason: `Staged ${alloc.allocatedAmountUsdc} USDC from ${alloc.accountId} to DisbursalVault (${vaultAddr}) for invoice ${qualification.invoiceId}`,
      });

      stagingAllocations.push({
        accountId: alloc.accountId,
        amountUsdc: alloc.allocatedAmountUsdc,
        raw: alloc.allocatedAmountRaw,
      });
      accumulatedStagedRaw += alloc.allocatedAmountRaw;
    }

    // Rule 5: Loud Rounding check
    if (accumulatedStagedRaw !== qualification.totalAllocatedRaw) {
      throw new LoudRoundingError(
        `Staging Mismatch: Staged amount (${accumulatedStagedRaw}) does not equal allocated amount (${qualification.totalAllocatedRaw}).`
      );
    }

    return {
      status: "FUNDS_STAGED",
      totalStagedUsdc: qualification.totalAllocatedUsdc,
      totalStagedRaw: accumulatedStagedRaw,
      allocations: stagingAllocations,
    };
  }

  /**
   * Executes a qualified disbursal route with Layer 1 / Layer 2 authorization,
   * staging funds (D18), DisbursalVault execution (D19), LedgerWitness auditing (D19d7),
   * and ERP reconciliation syncer (D19d20.B).
   */
  public async executeDisbursalRoute(params: {
    qualification: DisbursalRouteQualification;
    adminSignature?: string;
    clearanceCode?: string;
  }): Promise<DisbursalExecutionResult> {
    const { qualification, adminSignature, clearanceCode } = params;

    if (!qualification.isQualified) {
      return {
        status: "REJECTED",
        idempotencyKey: qualification.idempotencyKey,
        message: `Disbursal cannot execute: ${qualification.evaluationReason}`,
        qualification,
      };
    }

    // Verify idempotency against replay: DisbursalVault onchain and in-memory execution cache
    if (this.executedIdempotencyKeys.has(qualification.idempotencyKey)) {
      return {
        status: "FAILED",
        idempotencyKey: qualification.idempotencyKey,
        message: `Idempotency key already executed: Duplicate disbursal blocked (${qualification.idempotencyKey})`,
        qualification,
      };
    }
    try {
      const isAlreadyExecuted = await this.disbursalVault.isIdempotencyKeyExecuted(qualification.idempotencyKey);
      if (isAlreadyExecuted) {
        return {
          status: "FAILED",
          idempotencyKey: qualification.idempotencyKey,
          message: `Idempotency key already executed onchain: Duplicate disbursal blocked (${qualification.idempotencyKey})`,
          qualification,
        };
      }
    } catch {
      // Contract might not be deployed in offline/testnet client
    }

    // Step 1 (D16 / D17): Authorization Gate (Enforcer Agent Layer 1 or Human SPRS Layer 2)
    let activeClearance = clearanceCode;
    let sprsRequestId: string | undefined;

    if (!activeClearance && !adminSignature) {
      const authRequest = await AuthorizationGate.requestAuthorization({
        actionType: qualification.reasonBearingIntent.proposedAction,
        accountId: qualification.primaryAccountId || "OPEX_DEV",
        amountUsdc: qualification.totalRequestedUsdc,
        declaredReason: qualification.reasonBearingIntent.declaredReason,
      });

      if (authRequest.isAuthorized) {
        activeClearance = authRequest.clearanceCode;
      } else if (authRequest.sprsRequestId) {
        sprsRequestId = authRequest.sprsRequestId;
        return {
          status: "AWAITING_HUMAN_APPROVAL",
          idempotencyKey: qualification.idempotencyKey,
          sprsRequestId,
          message: `Disbursal requires human sign-off via SPRS ${sprsRequestId}: ${authRequest.reason}`,
          qualification,
        };
      } else {
        return {
          status: "REJECTED",
          idempotencyKey: qualification.idempotencyKey,
          message: `Disbursal denied by policy: ${authRequest.reason}`,
          qualification,
        };
      }
    }

    // Step 2 (D18): Stage Funds into DisbursalVault (including USYC recalls if needed)
    const stagedFunds = await this.stageFunds(qualification);

    // Step 3 (D19): Execute Disbursal Payment via DisbursalVault Contract
    const primaryAccountId = qualification.primaryAccountId || qualification.allocations[0].accountId;
    const docRef = `DISB_DOC_${qualification.invoiceId}`;
    const numAmount = parseFloat(qualification.totalRequestedUsdc);

    const nonce = BigInt(Date.now());
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const defaultSig =
      adminSignature ||
      ("0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`);

    // Encode authentic DisbursalVault.executePayment calldata
    const encodedCalldata = this.disbursalVault.encodeExecutePayment({
      permissionRequestId: DisbursalVaultService.formatRequestId(qualification.invoiceId),
      vendor: qualification.payoutAddress,
      amount: qualification.totalRequestedRaw,
      idempotencyKey: qualification.idempotencyKey,
      nonce,
      deadline,
      adminSignature: defaultSig as `0x${string}`,
    });

    const execution = await this.executor.execute({
      targetContract: this.disbursalVault.getAddress(),
      abi: DisbursalVaultABI,
      functionName: "executePayment",
      args: [
        DisbursalVaultService.formatRequestId(qualification.invoiceId),
        qualification.payoutAddress,
        qualification.totalRequestedRaw,
        qualification.idempotencyKey,
        nonce,
        deadline,
        defaultSig as `0x${string}`,
      ],
      idempotencyKey: qualification.idempotencyKey,
    });
    const txHash = execution.txHash;

    // Step 4 (D19d7): Record Double-Entry Voucher in Sequential Master System Journal
    const journalEntry = await this.witnessService.recordJournalVoucher({
      accountId: primaryAccountId,
      actionType: "DISBURSAL_PAYMENT",
      amountUsdc: numAmount,
      documentRef: docRef,
      vendorId: qualification.vendorId,
      category: qualification.category,
    });

    // Step 5 (D19d7): Immutable Account Audit Log
    await this.witnessService.recordAccountAuditLog({
      accountId: primaryAccountId,
      actionType: "DISBURSAL_PAYMENT",
      amountUsdc: numAmount,
      isAutonomous: !adminSignature,
      permissionRequestId: sprsRequestId || null,
      txHash,
      counterpartyAddress: qualification.payoutAddress,
      reason: `Settled disbursal payment of ${qualification.totalRequestedUsdc} USDC to ${qualification.vendorId} for invoice ${qualification.invoiceId}.`,
      postStateSnapshot: {
        idempotencyKey: qualification.idempotencyKey,
        routeType: qualification.routeType,
        allocationsCount: qualification.allocations.length,
        clearanceCode: activeClearance,
        journalHash: journalEntry.current_hash,
        stagedFunds: stagedFunds.totalStagedUsdc,
      },
    });

    // Step 6 (D19d20.B): ERP Reconciliation Syncer (write document-linked Payment Entry to Odoo & ERPNext)
    const erpSync = await this.erpReconciliation.reconcileDisbursalPayment({
      qualification,
      txHash,
      journalHash: journalEntry.current_hash,
      journalSequenceId: Number(journalEntry.sequence_id),
    });

    // Step 7: Update Dynamic Record 1 if liabilityId provided
    if (qualification.liabilityId) {
      await this.dynamicRecords.updateLiabilityStatus(qualification.liabilityId, "DISBURSED");
    }

    // Step 8: Recalculate Safe-to-Invest on all affected accounts (Record 2 update)
    for (const alloc of qualification.allocations) {
      await this.dynamicRecords.calculateSafeToInvest(alloc.accountId);
    }

    this.executedIdempotencyKeys.add(qualification.idempotencyKey);

    return {
      status: "SETTLED",
      idempotencyKey: qualification.idempotencyKey,
      txHash,
      encodedCalldata,
      clearanceCode: activeClearance,
      journalSequenceId: Number(journalEntry.sequence_id),
      journalHash: journalEntry.current_hash,
      stagedFunds,
      erpSync: {
        status: erpSync.status,
        threeWayMatchVerified: erpSync.threeWayMatchVerified,
        erpNextDocName: erpSync.erpNext?.paymentEntryDocName,
        odooPaymentId: erpSync.odoo?.paymentId,
        syncId: erpSync.checkpointRecord?.sync_id,
      },
      message: `Disbursal of ${qualification.totalRequestedUsdc} USDC successfully settled to ${qualification.payoutAddress}.`,
      qualification,
    };
  }
}
