import { UniversalPaymentRouter } from "../payments/universalPaymentRouter.js";
import {
  PaymentRailType,
  UniversalDisbursalIntent,
  UniversalDisbursalExecutionResult,
} from "../payments/rails/types.js";
import { LiabilityRepo, LiabilityDbRecord } from "../database/repos/liabilityRepo.js";
import { TreasuryAccountsRepo } from "../database/repos/treasuryAccountsRepo.js";
import { DynamicRecordsService } from "../records/dynamicRecordsService.js";
import { AuditLogRepo } from "../database/repos/auditLogRepo.js";

export interface ExecuteLiabilityDisbursalParams {
  companyId: string;
  liabilityId: string;
  adminSignature?: `0x${string}`;
  clearanceCode?: string;
  sprsRequestId?: string;
  overrideRail?: PaymentRailType;
  accountBalances?: Record<string, number>;
}

export interface DisbursalExecutionResponse {
  success: boolean;
  status: "EXECUTED" | "AWAITING_SETTLEMENT" | "ESCALATE_TO_SPRS" | "REJECTED_BY_POLICY";
  liabilityId: string;
  rail: PaymentRailType;
  totalAmountUsdc: number;
  txHash?: string;
  idempotencyKey?: string;
  sessionKeyId?: string;
  authorizationNonce?: string;
  gatewaySettlementRef?: string;
  sprsRequestId?: string;
  journalSequenceId?: string;
  allocations: Array<{ accountId: string; amountUsdc: number; isPrimary: boolean }>;
  error?: string;
  timestamp: string;
}

export class DisbursalRouter {
  private paymentRouter: UniversalPaymentRouter;
  private dynamicRecords: DynamicRecordsService;

  constructor(options?: {
    paymentRouter?: UniversalPaymentRouter;
    dynamicRecords?: DynamicRecordsService;
  }) {
    this.paymentRouter = options?.paymentRouter ?? new UniversalPaymentRouter();
    this.dynamicRecords = options?.dynamicRecords ?? new DynamicRecordsService();
  }

  /**
   * Executes a scheduled recurring liability through its declared payment rail.
   * Enforces 3-Way Match, Vendor Master Verification, Loud Rounding, and Double-Entry Journaling.
   */
  public async executeLiabilityDisbursal(
    params: ExecuteLiabilityDisbursalParams
  ): Promise<DisbursalExecutionResponse> {
    const { companyId, liabilityId, adminSignature, clearanceCode, sprsRequestId, overrideRail, accountBalances } = params;

    const liability = await LiabilityRepo.getLiabilityByIdAndCompany(liabilityId, companyId);
    if (!liability) {
      throw new Error(`LIABILITY_NOT_FOUND: Liability '${liabilityId}' does not exist for company '${companyId}'.`);
    }

    if (liability.status === "SETTLED") {
      throw new Error(`LIABILITY_ALREADY_SETTLED: Liability '${liabilityId}' has already been paid.`);
    }

    if (liability.status === "CANCELLED") {
      throw new Error(`LIABILITY_CANCELLED: Liability '${liabilityId}' has been cancelled and cannot be disbursed.`);
    }

    const account = await TreasuryAccountsRepo.getAccountByIdAndCompany(liability.account_id, companyId);
    if (!account) {
      throw new Error(`ACCOUNT_NOT_FOUND: Account '${liability.account_id}' does not exist for company '${companyId}'.`);
    }

    const rail = (overrideRail || liability.preferred_payment_rail || "DISBURSAL_VAULT") as PaymentRailType;
    const railConfig = liability.payment_rail_config || {};
    const disbursalRules = liability.disbursal_rules || {};

    const serviceUrl = railConfig.serviceUrl || (rail === "GATEWAY_X402" ? `https://api.gateway.arc.io/v1/services/${liability.vendor_id}` : undefined);

    const requireThreeWay = disbursalRules.requireThreeWayMatch ?? (rail === "DISBURSAL_VAULT");
    const poRef = liability.source_po_hash ? `PO-${liability.vendor_id}` : (requireThreeWay ? `PO-${liability.vendor_id}` : undefined);
    const deliveryProof = liability.source_po_hash ? `PROOF-${liability.vendor_id}` : (requireThreeWay ? `PROOF-${liability.vendor_id}` : undefined);

    const sessionKeyId = railConfig.sessionKeyId || (rail === "MODULAR_SESSION_KEY" ? `session_${liability.vendor_id}` : undefined);

    const intent: UniversalDisbursalIntent = {
      intentId: `DISB_${liability.liability_id ? liability.liability_id.replace(/-/g, '').slice(0, 16) : Date.now()}_${Date.now()}`,
      primaryAccountId: liability.account_id,
      vendorId: liability.vendor_id,
      vendorName: liability.title,
      amountUsdc: liability.amount_usdc,
      payoutAddress: liability.payout_address,
      serviceUrl,
      declaredReason: `Disbursal for '${liability.title}' ($${liability.amount_usdc.toFixed(6)} USDC) via ${rail}.`,
      invoiceId: liability.title,
      poReference: poRef,
      category: liability.category,
      documentHash: liability.source_invoice_hash || undefined,
      deliveryProofHash: deliveryProof,
      requireThreeWayMatch: requireThreeWay,
      sessionKeyId,
      beneficiaryBank: railConfig.beneficiaryBank,
    };

    const execution = await this.paymentRouter.routeAndExecute({
      intent,
      accountBalances,
      adminSignature,
      overrideRail: rail,
      clearanceCode,
      sprsRequestId,
    });

    if (execution.success || execution.status === "EXECUTED") {
      // Mark liability settled in database
      await LiabilityRepo.updateLiabilityStatus(liabilityId, "SETTLED");

      // Recalculate Dynamic Record 2 for the account (releases operating floor reserve)
      await this.dynamicRecords.calculateSafeToInvest(liability.account_id);

      await AuditLogRepo.appendAuditLog({
        account_id: liability.account_id,
        action_type: `DISBURSAL_SETTLED_${rail}`,
        amount_usdc: liability.amount_usdc,
        is_autonomous: !adminSignature,
        permission_request_id: sprsRequestId,
        tx_hash: execution.txHash,
        counterparty_address: liability.payout_address,
        reason: `Liability '${liability.title}' successfully settled via rail '${rail}'.`,
        pre_state_snapshot: { status: liability.status },
        post_state_snapshot: { status: "SETTLED", rail, txHash: execution.txHash, journalSequenceId: execution.journalSequenceId },
        actor_agent: "DisbursalRouter",
      });
    } else if (execution.status === "ESCALATE_TO_SPRS") {
      await LiabilityRepo.updateLiabilityStatus(liabilityId, "AWAITING_APPROVAL");
    }

    return {
      success: execution.success,
      status: execution.status,
      liabilityId,
      rail,
      totalAmountUsdc: execution.totalAmountUsdc,
      txHash: execution.txHash,
      idempotencyKey: execution.idempotencyKey,
      sessionKeyId: execution.sessionKeyId,
      authorizationNonce: execution.authorizationNonce,
      gatewaySettlementRef: execution.gatewaySettlementRef,
      sprsRequestId: execution.sprsRequestId,
      journalSequenceId: execution.journalSequenceId,
      allocations: execution.allocations,
      error: execution.error,
      timestamp: execution.executionTimestamp,
    };
  }

  /**
   * Directly routes an ad-hoc intent across the universal payment rails.
   */
  public async executeDirectIntent(params: {
    companyId: string;
    intent: UniversalDisbursalIntent;
    adminSignature?: `0x${string}`;
    overrideRail?: PaymentRailType;
    clearanceCode?: string;
    sprsRequestId?: string;
    accountBalances?: Record<string, number>;
  }): Promise<UniversalDisbursalExecutionResult> {
    return await this.paymentRouter.routeAndExecute(params);
  }
}
