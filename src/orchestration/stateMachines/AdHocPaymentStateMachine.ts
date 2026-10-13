/**
 * Machine 5: Ad-Hoc & Non-Liability Discretionary Payment State Machine.
 * =====================================================================
 * Governs the cognitive processing of discretionary non-scheduled capital outflows,
 * qualifying funding accounts, managing SPRS approval gates, and staging payments.
 */

import { DisbursalRouterService } from "../../services/disbursalRouterService.js";
import { DynamicRecordsService } from "../../records/dynamicRecordsService.js";
import { PredictiveRefunderService } from "../../services/predictiveRefunderService.js";
import { ManualDisbursalService, ManualPaymentFiatDetails, ManualPaymentCryptoDetails } from "../../services/manualDisbursalService.js";
import { PolicyComplianceLlmAgent } from "../../agents/policyComplianceLlmAgent.js";
import { LedgerWitnessLlmAgent } from "../../agents/ledgerWitnessLlmAgent.js";
import { TreasuryAccountsRepo } from "../../database/repos/treasuryAccountsRepo.js";
import { PermissionRequestRepo } from "../../database/repos/permissionRequestRepo.js";
import { VendorBankRepo } from "../../database/repos/vendorBankRepo.js";
import { StandardizedPermissionRequest } from "../../types/sprs.js";
import { ToolRegistry } from "../../tools/toolRegistry.js";
import { StateMachineExecutionResult, StateMachineTransitionRecord } from "./types.js";
import { PaymentRailType } from "../../payments/rails/types.js";

export type AdHocPaymentState =
  | "REQUEST_RECEIVED"
  | "ACCOUNT_QUALIFIED"
  | "PREDICTIVE_RECALL_EXECUTED"
  | "SPRS_APPROVAL_REQUIRED"
  | "CLEARANCE_GRANTED"
  | "STAGED_IN_DISBURSAL_VAULT"
  | "FIAT_OR_CRYPTO_EXECUTED"
  | "WITNESSED_AND_COMPLETED"
  | "REJECTED_BY_ADMIN"
  | "FAILED";

export interface AdHocPaymentRequest {
  companyId: string;
  recipientAddress?: string;
  beneficiaryBank?: ManualPaymentFiatDetails;
  cryptoDetails?: ManualPaymentCryptoDetails;
  amountUsdc: number;
  reason: string;
  category?: string;
  requestedAccountId?: string;
  paymentRail?: PaymentRailType | "FIAT_OFFRAMP" | "MODULAR_SESSION_KEYS";
  adminSignature?: `0x${string}`;
  clearanceCode?: string;
  sprsRequestId?: string;
}

export class AdHocPaymentStateMachine {
  private dynamicRecords: DynamicRecordsService;
  private predictiveRefunder: PredictiveRefunderService;
  private complianceAgent: PolicyComplianceLlmAgent;
  private witnessAgent: LedgerWitnessLlmAgent;
  private toolRegistry: ToolRegistry;
  private transitionLog: StateMachineTransitionRecord[] = [];
  private onPaymentSettledCallback?: (accountId: string, amount: number) => Promise<void>;

  constructor(options?: {
    dynamicRecords?: DynamicRecordsService;
    predictiveRefunder?: PredictiveRefunderService;
    complianceAgent?: PolicyComplianceLlmAgent;
    witnessAgent?: LedgerWitnessLlmAgent;
    onPaymentSettled?: (accountId: string, amount: number) => Promise<void>;
  }) {
    this.dynamicRecords = options?.dynamicRecords ?? new DynamicRecordsService();
    this.predictiveRefunder = options?.predictiveRefunder ?? new PredictiveRefunderService();
    this.complianceAgent = options?.complianceAgent ?? new PolicyComplianceLlmAgent();
    this.witnessAgent = options?.witnessAgent ?? new LedgerWitnessLlmAgent();
    this.toolRegistry = new ToolRegistry(undefined, this.dynamicRecords);
    this.onPaymentSettledCallback = options?.onPaymentSettled;
  }

  public setOnPaymentSettled(callback: (accountId: string, amount: number) => Promise<void>) {
    this.onPaymentSettledCallback = callback;
  }

  private logTransition(instanceId: string, from: string, to: string, trigger: string, details?: any) {
    this.transitionLog.push({
      machineName: "AD_HOC_PAYMENT_STATE_MACHINE",
      instanceId,
      fromState: from,
      toState: to,
      trigger,
      actorAgentId: 104,
      actorAgentName: "PolicyComplianceAgent",
      timestamp: new Date(),
      details,
    });
  }

  /**
   * Unbroken Chain Execution: Processes discretionary payment request.
   */
  public async processPayment(
    req: AdHocPaymentRequest
  ): Promise<StateMachineExecutionResult<any>> {
    const instanceId = `ADHOC-${Date.now()}`;
    this.logTransition(instanceId, "INITIAL", "REQUEST_RECEIVED", "API_REQUEST_TRIGGER", {
      amountUsdc: req.amountUsdc,
      reason: req.reason,
    });

    try {
      // 1. Qualify Funding Account (Excluding PAYROLL)
      const accounts = await TreasuryAccountsRepo.getAccountsByCompany(req.companyId);
      const eligibleAccounts = accounts.filter((a) => a.role !== "PAYROLL" && a.is_active);

      if (eligibleAccounts.length === 0) {
        throw new Error("No eligible non-payroll operating accounts found for disbursal.");
      }

      const selectedAccount = req.requestedAccountId
        ? eligibleAccounts.find((a) => a.account_id === req.requestedAccountId) || eligibleAccounts[0]
        : eligibleAccounts[0];

      this.logTransition(instanceId, "REQUEST_RECEIVED", "ACCOUNT_QUALIFIED", "ACCOUNT_SELECTED", {
        accountId: selectedAccount.account_id,
        role: selectedAccount.role,
      });

      // 2. Policy Compliance Gate
      const compliance = await this.complianceAgent.evaluateIntent({
        proposedAction: "DISCRETIONARY_PAYMENT",
        accountId: selectedAccount.account_id,
        amountUsdc: req.amountUsdc.toFixed(6),
        declaredReason: req.reason,
        recipientAddress: req.recipientAddress,
      });

      // Discretionary payments outside routine rules require explicit SPRS authorization
      if (compliance.decision === "ESCALATE_TO_SPRS" || compliance.decision === "DENY") {
        const reqId = compliance.sprsRequestId || `SPRS-ADHOC-${Date.now()}`;
        if (!compliance.sprsRequestId) {
          await PermissionRequestRepo.createRequest({
            request_id: reqId,
            action_type: "OUT_OF_BAND_PAYMENT",
            amount_usdc: req.amountUsdc,
            reason: `Discretionary Payment: ${req.reason}`,
            status: "PENDING",
            payload: {
              accountId: selectedAccount.account_id,
              requiresDualKey: req.amountUsdc > 1000,
            },
          });
        }

        this.logTransition(instanceId, "ACCOUNT_QUALIFIED", "SPRS_APPROVAL_REQUIRED", "SPRS_GENERATED", {
          sprsRequestId: reqId,
        });

        return {
          success: false,
          machineName: "AD_HOC_PAYMENT_STATE_MACHINE",
          instanceId,
          currentState: "SPRS_APPROVAL_REQUIRED",
          data: { sprsRequestId: reqId, accountId: selectedAccount.account_id },
          unbrokenChainLog: [...this.transitionLog],
        };
      }

      // 3. Inspect Tripartite Balance & Predictive Recall
      const tripartite = await this.dynamicRecords.getTripartiteBalance(selectedAccount.account_id);
      const liquidBal = parseFloat(tripartite.liquidCashUsdc);
      const totalAvailable = parseFloat(tripartite.availableBalanceUsdc);

      if (totalAvailable > 0 && totalAvailable < req.amountUsdc) {
        throw new Error(`INSUFFICIENT_FUNDS: Available ${totalAvailable} USDC is less than requested ${req.amountUsdc} USDC.`);
      }

      if (liquidBal < req.amountUsdc && totalAvailable >= req.amountUsdc) {
        const recallAmount = req.amountUsdc - liquidBal;
        await this.predictiveRefunder.executePredictiveRecall({
          accountId: selectedAccount.account_id,
          shortfallRaw: BigInt(Math.round(recallAmount * 1e6)),
          reason: `Autonomous USYC recall for ad-hoc disbursal: ${recallAmount} USDC`,
        });

        this.logTransition(instanceId, "ACCOUNT_QUALIFIED", "PREDICTIVE_RECALL_EXECUTED", "USYC_RECALL_TRIGGERED", {
          recalledUsdc: recallAmount,
        });
      }

      // 4. Staging & Execution via Unified ManualDisbursalService
      this.logTransition(instanceId, "ACCOUNT_QUALIFIED", "STAGED_IN_DISBURSAL_VAULT", "VAULT_STAGING");

      const manualDisbursalService = new ManualDisbursalService();
      const rawRail = req.paymentRail || (req.beneficiaryBank ? "FIAT_PAYOUT" : "DISBURSAL_VAULT");
      const normalizedRail: PaymentRailType = rawRail === "FIAT_OFFRAMP"
        ? "FIAT_PAYOUT"
        : rawRail === "MODULAR_SESSION_KEYS"
        ? "MODULAR_SESSION_KEY"
        : (rawRail as PaymentRailType);

      const disbursalResult = await manualDisbursalService.executeManualDisbursal({
        companyId: req.companyId,
        sourceAccountId: selectedAccount.account_id,
        vendorId: `ADHOC_${selectedAccount.account_id}`,
        vendorName: req.beneficiaryBank?.accountHolderName || `AdHoc Recipient (${selectedAccount.account_id})`,
        amountUsdc: req.amountUsdc,
        paymentRail: normalizedRail,
        fiatDetails: req.beneficiaryBank,
        cryptoDetails: {
          walletAddress: (req.recipientAddress || req.cryptoDetails?.walletAddress || "0x0000000000000000000000000000000000000001") as `0x${string}`,
          chainId: req.cryptoDetails?.chainId,
          tokenSymbol: req.cryptoDetails?.tokenSymbol,
          targetChain: req.cryptoDetails?.targetChain,
          sessionKeyId: req.cryptoDetails?.sessionKeyId,
          serviceUrl: req.cryptoDetails?.serviceUrl,
        },
        declaredReason: req.reason,
        category: req.category || "DISCRETIONARY",
        adminSignature: req.adminSignature,
        clearanceCode: req.clearanceCode,
        sprsRequestId: req.sprsRequestId,
      });

      if (!disbursalResult.success && disbursalResult.status === "ESCALATE_TO_SPRS") {
        this.logTransition(instanceId, "STAGED_IN_DISBURSAL_VAULT", "SPRS_APPROVAL_REQUIRED", "SPRS_ESCALATED", {
          sprsRequestId: disbursalResult.sprsRequestId,
        });
        return {
          success: false,
          machineName: "AD_HOC_PAYMENT_STATE_MACHINE",
          instanceId,
          currentState: "SPRS_APPROVAL_REQUIRED",
          data: { sprsRequestId: disbursalResult.sprsRequestId, accountId: selectedAccount.account_id },
          unbrokenChainLog: [...this.transitionLog],
        };
      }

      if (!disbursalResult.success) {
        throw new Error(disbursalResult.error || `Manual disbursal failed with status ${disbursalResult.status}`);
      }

      const txHash = disbursalResult.txHash || `0x${Date.now().toString(16)}`;

      // 5. Witnessing
      await this.witnessAgent.recordSettlementVoucher("SESSION_ADHOC", {
        accountId: selectedAccount.account_id,
        documentRef: `ADHOC_${instanceId}`,
        debitAccount: "5000_OPEX_DISCRETIONARY",
        creditAccount: "1000_TREASURY_USDC",
        amountUsdc: req.amountUsdc.toFixed(6),
        txHash,
      });

      this.logTransition(instanceId, "STAGED_IN_DISBURSAL_VAULT", "WITNESSED_AND_COMPLETED", "SETTLED", {
        txHash,
        rail: disbursalResult.rail,
        subMethod: disbursalResult.subMethod,
        fiatPayoutId: disbursalResult.fiatPayoutId,
        cardPayoutRef: disbursalResult.cardPayoutRef,
        imadOmadTrace: disbursalResult.imadOmadTrace,
      });

      // 6. Notify Machine 3
      if (this.onPaymentSettledCallback) {
        await this.onPaymentSettledCallback(selectedAccount.account_id, req.amountUsdc);
      }

      return {
        success: true,
        machineName: "AD_HOC_PAYMENT_STATE_MACHINE",
        instanceId,
        currentState: "WITNESSED_AND_COMPLETED",
        data: {
          txHash,
          accountId: selectedAccount.account_id,
          rail: disbursalResult.rail,
          subMethod: disbursalResult.subMethod,
          fiatPayoutId: disbursalResult.fiatPayoutId,
          cardPayoutRef: disbursalResult.cardPayoutRef,
          imadOmadTrace: disbursalResult.imadOmadTrace,
          journalSequenceId: disbursalResult.journalSequenceId,
        },
        unbrokenChainLog: [...this.transitionLog],
      };
    } catch (err: any) {
      this.logTransition(instanceId, "REQUEST_RECEIVED", "FAILED", "ERROR", { error: err.message });
      return {
        success: false,
        machineName: "AD_HOC_PAYMENT_STATE_MACHINE",
        instanceId,
        currentState: "FAILED",
        error: err.message,
        unbrokenChainLog: [...this.transitionLog],
      };
    }
  }
}
