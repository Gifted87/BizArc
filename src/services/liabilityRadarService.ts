import { keccak256, stringToHex } from "viem";
import { AGENT_REGISTRY, AgentPersonaType } from "../types/agents.js";
import { LiabilityCategory, LiabilityStatus } from "../types/accounts.js";
import { StandardizedPermissionRequest, SPROption, SPRActionType } from "../types/sprs.js";
import { LiabilityRepo, LiabilityDbRecord } from "../database/repos/liabilityRepo.js";
import { VendorMasterRepo } from "../database/repos/vendorMasterRepo.js";
import { PermissionRequestRepo } from "../database/repos/permissionRequestRepo.js";
import { AuditLogRepo } from "../database/repos/auditLogRepo.js";
import { AccountIntelligenceService } from "./accountIntelligenceService.js";
import { LoudRoundingError } from "../foundation/usdc/usdcService.js";

export interface InboundLiabilityDocumentInput {
  accountId: string;
  vendorId: string;
  title: string;
  category: LiabilityCategory;
  amountUsdc: number;
  dueDate: Date | string;
  claimedPayoutAddress: `0x${string}`;
  frequencyCron?: string;
  rawDocumentContent?: string;
  poHash?: `0x${string}`;
  erpRoundOffAmount?: number;
  roundOffSweepDetected?: boolean;
}

export interface IngestionResult {
  liability: LiabilityDbRecord;
  securityAlert?: string;
  anomalyDetected?: boolean;
  anomalyReason?: string;
  isDuplicate?: boolean;
}

export interface ResolutionResult {
  requestId: string;
  liabilityId: string;
  status: "APPROVED" | "CANCELLED";
  adminInstructions?: string;
  cancellationMemo?: string;
}

export class LiabilityRadarService {
  public readonly persona: AgentPersonaType = "LiabilityRadarAgent";
  public readonly erc8004Id = AGENT_REGISTRY.LiabilityRadarAgent.erc8004Id;
  public readonly canSignTransactions = AGENT_REGISTRY.LiabilityRadarAgent.canSignTransactions; // false
  public readonly canWriteLedger = AGENT_REGISTRY.LiabilityRadarAgent.canWriteLedger; // false

  private accountIntelligenceService: AccountIntelligenceService;

  constructor(intelService?: AccountIntelligenceService) {
    this.accountIntelligenceService = intelService ?? new AccountIntelligenceService();
  }

  /**
   * Helper to enforce Rule 5 (No Silent Rounding) on USDC amounts
   */
  private validateUsdcPrecision(amount: number): void {
    if (amount <= 0) {
      throw new Error(`[LiabilityRadarService] Amount must be positive. Received: ${amount}`);
    }
    const str = amount.toString();
    const parts = str.split(".");
    if (parts.length > 1 && parts[1].length > 6) {
      throw new Error(`[LiabilityRadarService] Rule 5 Violation: Amount ${amount} exceeds 6-decimal USDC precision.`);
    }
  }

  /**
   * Computes deterministic cryptographic hash for inbound raw document (Rule 1: Document-Linked)
   */
  public computeDocumentHash(content: string): `0x${string}` {
    return keccak256(stringToHex(content));
  }

  /**
   * Ingests, audits, and registers an inbound liability document (Invoice, Subscription renewal, Debt demand).
   * Executes Rule 1 (Document-linked), Rule 3 (Payee Substitution Protection), and Anomaly/Zombie SaaS auditing.
   */
  public async ingestLiabilityDocument(
    input: InboundLiabilityDocumentInput
  ): Promise<IngestionResult> {
    // Rule 5: Refusal of ERPNext 0.5 Round-Off Sweeps (Loud Repair)
    if (input.roundOffSweepDetected || (input.erpRoundOffAmount && input.erpRoundOffAmount > 0)) {
      throw new LoudRoundingError(
        `LOUD REPAIR REFUSAL: ERPNext 0.5 round-off sweep detected (${input.erpRoundOffAmount || 0} USDC). Silent rounding sweeps into expense accounts are strictly prohibited on Arc L1.`
      );
    }

    this.validateUsdcPrecision(input.amountUsdc);

    const docContent = input.rawDocumentContent ?? `${input.vendorId}|${input.title}|${input.amountUsdc}|${input.dueDate}`;
    const invoiceHash = this.computeDocumentHash(docContent);

    // Idempotency Check: Prevent duplicate invoice processing
    const existing = await LiabilityRepo.getLiabilityByInvoiceHash(invoiceHash);
    if (existing) {
      return {
        liability: existing,
        isDuplicate: true,
        securityAlert: `DUPLICATE_INVOICE_WARNING: Invoice with hash '${invoiceHash}' already registered as liability '${existing.liability_id}'.`,
      };
    }

    // Rule 3: Vendor Master Check (Payee Substitution Protection)
    const vendorRecord = await VendorMasterRepo.getVendorById(input.vendorId);
    let securityAlert: string | undefined;
    let initialStatus: LiabilityStatus = "SCHEDULED";

    if (!vendorRecord) {
      securityAlert = `PAYEE_SUBSTITUTION_ALERT: Vendor '${input.vendorId}' is not registered in Verified Vendor Master.`;
      initialStatus = "FROZEN";
    } else if (vendorRecord.verified_payout_address.toLowerCase() !== input.claimedPayoutAddress.toLowerCase()) {
      securityAlert = `PAYEE_SUBSTITUTION_ALERT: Claimed payout address ${input.claimedPayoutAddress} does NOT match verified address ${vendorRecord.verified_payout_address}.`;
      initialStatus = "FROZEN";
    }

    // Anomaly Detection: Detect Zombie SaaS & Stealth Price Hikes
    let anomalyDetected = false;
    let anomalyReason: string | undefined;

    if (initialStatus !== "FROZEN") {
      const historical = await LiabilityRepo.getLiabilitiesByAccount(input.accountId);
      const vendorHistory = historical.filter((h) => h.vendor_id === input.vendorId && h.status !== "CANCELLED");

      if (vendorHistory.length > 0) {
        const latestAmount = vendorHistory[0].amount_usdc;
        const hikeRatio = (input.amountUsdc - latestAmount) / latestAmount;
        if (hikeRatio > 0.15) {
          anomalyDetected = true;
          anomalyReason = `STEALTH_PRICE_HIKE_DETECTED: Price increased by ${(hikeRatio * 100).toFixed(1)}% (from $${latestAmount} to $${input.amountUsdc}).`;
          initialStatus = "AWAITING_APPROVAL";
        }
      }
    }

    const dueDateParsed = input.dueDate instanceof Date ? input.dueDate : new Date(input.dueDate);

    // Persist liability to relational registry
    const createdLiability = await LiabilityRepo.createLiability({
      account_id: input.accountId,
      vendor_id: input.vendorId,
      title: input.title,
      category: input.category,
      amount_usdc: input.amountUsdc,
      due_date: dueDateParsed,
      frequency_cron: input.frequencyCron || null,
      payout_address: input.claimedPayoutAddress,
      source_po_hash: input.poHash || null,
      source_invoice_hash: invoiceHash,
      status: initialStatus,
    });

    // Record audit event
    await AuditLogRepo.appendAuditLog({
      account_id: input.accountId,
      action_type: "LIABILITY_INGESTED",
      amount_usdc: input.amountUsdc,
      is_autonomous: true,
      counterparty_address: input.claimedPayoutAddress,
      reason: securityAlert ?? anomalyReason ?? `Ingested and verified recurring obligation '${input.title}'`,
      pre_state_snapshot: { vendor: input.vendorId, invoiceHash },
      post_state_snapshot: { liabilityId: createdLiability.liability_id, status: initialStatus },
      actor_agent: this.persona,
    });

    return {
      liability: createdLiability,
      securityAlert,
      anomalyDetected,
      anomalyReason,
    };
  }

  /**
   * 48-Hour Pre-Flight Radar Scan:
   * Identifies liabilities due within 48 hours and emits Standardized Permission Requests (SPRS)
   * offering binary options: APPROVE or CANCEL WITH INSTRUCTIONS.
   */
  public async scanPreFlightLiabilities(
    hoursThreshold = 48,
    balanceOverrides?: Record<string, { liquidUsdc?: number; investedUsyc?: number }>
  ): Promise<StandardizedPermissionRequest[]> {
    const windowDays = Math.ceil(hoursThreshold / 24);
    const upcoming = await LiabilityRepo.getUpcomingLiabilities(windowDays);
    const sprsRequests: StandardizedPermissionRequest[] = [];

    const now = Date.now();
    const thresholdMs = hoursThreshold * 3600 * 1000;

    for (const liability of upcoming) {
      const dueTime = new Date(liability.due_date).getTime();
      const diffMs = dueTime - now;

      // Filter specifically within the hoursThreshold window
      if (diffMs > thresholdMs) continue;

      const requestId = `SPRS-LIAB-${liability.liability_id}`;

      // Check if SPRS already generated
      const existing = await PermissionRequestRepo.getRequestById(requestId);
      if (existing) continue;

      // Fetch live Account Intelligence
      const overrides = balanceOverrides?.[liability.account_id];
      const intel = await this.accountIntelligenceService.getAccountIntelligence(liability.account_id, {
        overrideLiquidBalance: overrides?.liquidUsdc,
        overrideInvestedUsyc: overrides?.investedUsyc,
      });

      const vendor = await VendorMasterRepo.getVendorById(liability.vendor_id);
      const isVendorVerified = Boolean(vendor);
      const payeeMatches = isVendorVerified && vendor!.verified_payout_address.toLowerCase() === liability.payout_address.toLowerCase();

      const options: SPROption[] = [
        {
          action: "APPROVE",
          label: "Approve Payment",
        },
        {
          action: "CANCEL_WITH_INSTRUCTIONS",
          label: "Cancel with Instructions",
          requiresText: true,
        },
      ];

      const sprsPayload: StandardizedPermissionRequest = {
        requestId,
        timestamp: new Date().toISOString(),
        action: "DISBURSEMENT_PAYMENT" as SPRActionType,
        reason: `Pre-flight 48h settlement alert for '${liability.title}' due at ${new Date(liability.due_date).toISOString()}`,
        amountUsdc: liability.amount_usdc.toFixed(6),
        affectedAccounts: [
          {
            accountId: intel.metadata.accountId,
            role: intel.metadata.role,
            chain: intel.metadata.chain,
            address: intel.metadata.address,
            currentLiquidBalance: intel.balances.liquidUsdc,
            currentInvestedUsyc: intel.balances.investedUsycUsdcEquivalent,
            totalEffectiveBalance: intel.balances.totalEffectiveUsdc,
            committedLiabilities30d: intel.liabilities.dueNext30DaysUsdc,
            unencumberedBalance: intel.solvencyMetrics.unencumberedFreeCashUsdc,
            usycRecallAmount: "0.000000",
            postTxLiquidBalance: (parseFloat(intel.balances.liquidUsdc) - liability.amount_usdc).toFixed(6),
            postTxInvestedUsyc: intel.balances.investedUsycUsdcEquivalent,
          },
        ],
        targetRecipient: {
          vendorId: liability.vendor_id,
          vendorName: vendor?.name ?? liability.vendor_id,
          payoutAddress: liability.payout_address,
          isInVerifiedMaster: isVendorVerified,
          payeeAddressMatchesHistory: payeeMatches,
        },
        associatedRecords: {
          invoiceDocumentHash: liability.source_invoice_hash as `0x${string}`,
          purchaseOrderHash: liability.source_po_hash as `0x${string}`,
          idempotencyKey: keccak256(stringToHex(`${liability.vendor_id}|${liability.liability_id}|${liability.amount_usdc}`)),
        },
        options,
        status: "PENDING",
      };

      // Persist SPRS to database
      await PermissionRequestRepo.createRequest({
        request_id: requestId,
        action_type: "DISBURSEMENT_PAYMENT",
        reason: sprsPayload.reason,
        amount_usdc: liability.amount_usdc,
        status: "PENDING",
        payload: sprsPayload as any,
      });

      // Update liability status to AWAITING_APPROVAL
      await LiabilityRepo.updateLiabilityStatus(liability.liability_id!, "AWAITING_APPROVAL");

      sprsRequests.push(sprsPayload);
    }

    return sprsRequests;
  }

  /**
   * Resolves the admin's binary decision on an SPRS request:
   * Option 1: APPROVE -> Schedules for execution.
   * Option 2: CANCEL_WITH_INSTRUCTIONS -> Freezes liability and drafts vendor cancellation memo.
   */
  public async resolveAdminDecision(params: {
    requestId: string;
    decision: "APPROVE" | "CANCEL_WITH_INSTRUCTIONS";
    adminInstructions?: string;
  }): Promise<ResolutionResult> {
    const sprs = await PermissionRequestRepo.getRequestById(params.requestId);
    if (!sprs) {
      throw new Error(`[LiabilityRadarService] Permission request '${params.requestId}' not found.`);
    }

    // Extract liabilityId from requestId ("SPRS-LIAB-<uuid>")
    const liabilityId = params.requestId.replace("SPRS-LIAB-", "");

    if (params.decision === "APPROVE") {
      await PermissionRequestRepo.updateStatus({
        requestId: params.requestId,
        status: "APPROVED",
        adminInstruction: params.adminInstructions ?? "Approved by administrator.",
      });

      await LiabilityRepo.updateLiabilityStatus(liabilityId, "SCHEDULED");

      await AuditLogRepo.appendAuditLog({
        account_id: sprs.payload.affectedAccounts?.[0]?.accountId ?? "treasury",
        action_type: "LIABILITY_APPROVED",
        amount_usdc: sprs.amount_usdc,
        is_autonomous: false,
        permission_request_id: params.requestId,
        reason: "Administrator approved 48h pre-flight settlement",
        pre_state_snapshot: { status: "AWAITING_APPROVAL" },
        post_state_snapshot: { status: "SCHEDULED" },
        actor_agent: this.persona,
      });

      return {
        requestId: params.requestId,
        liabilityId,
        status: "APPROVED",
        adminInstructions: params.adminInstructions,
      };
    } else {
      // CANCEL_WITH_INSTRUCTIONS
      const cancellationMemo = `[VENDOR CANCELLATION MEMO]\nLiability ID: ${liabilityId}\nVendor: ${sprs.payload.targetRecipient?.vendorId}\nAction: CANCEL RENEWAL\nReason: ${params.adminInstructions ?? "Cancelled by company admin without instructions."}\nTimestamp: ${new Date().toISOString()}`;

      await PermissionRequestRepo.updateStatus({
        requestId: params.requestId,
        status: "REJECTED",
        adminInstruction: params.adminInstructions,
      });

      await LiabilityRepo.updateLiabilityStatus(liabilityId, "CANCELLED");

      await AuditLogRepo.appendAuditLog({
        account_id: sprs.payload.affectedAccounts?.[0]?.accountId ?? "treasury",
        action_type: "LIABILITY_CANCELLED",
        amount_usdc: sprs.amount_usdc,
        is_autonomous: false,
        permission_request_id: params.requestId,
        reason: `Cancelled by admin: ${params.adminInstructions ?? "No instruction provided"}`,
        pre_state_snapshot: { status: "AWAITING_APPROVAL" },
        post_state_snapshot: { status: "CANCELLED", cancellationMemo },
        actor_agent: this.persona,
      });

      return {
        requestId: params.requestId,
        liabilityId,
        status: "CANCELLED",
        adminInstructions: params.adminInstructions,
        cancellationMemo,
      };
    }
  }
}
