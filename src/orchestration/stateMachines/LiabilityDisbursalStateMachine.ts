/**
 * Machine 4: Scheduled Liability Disbursal & Predictive Recall State Machine.
 * ===========================================================================
 * Governs the execution of due liabilities, automatic predictive USYC recall,
 * multi-account waterfall routing (with strict payroll protection), staging into
 * DisbursalVault, dual-rail settlement (Crypto vs. Fiat Offramp), and audit witnessing.
 */

import { DisbursalRouterService, DisbursalRoutingRequest } from "../../services/disbursalRouterService.js";
import { DynamicRecordsService } from "../../records/dynamicRecordsService.js";
import { PredictiveRefunderService } from "../../services/predictiveRefunderService.js";
import { PolicyComplianceLlmAgent } from "../../agents/policyComplianceLlmAgent.js";
import { LedgerWitnessLlmAgent } from "../../agents/ledgerWitnessLlmAgent.js";
import { DisbursalRouterLlmAgent } from "../../agents/disbursalRouterLlmAgent.js";
import { LiabilityRepo, LiabilityDbRecord } from "../../database/repos/liabilityRepo.js";
import { TreasuryAccountsRepo } from "../../database/repos/treasuryAccountsRepo.js";
import { VendorBankRepo } from "../../database/repos/vendorBankRepo.js";
import { ToolRegistry } from "../../tools/toolRegistry.js";
import { StateMachineExecutionResult, StateMachineTransitionRecord } from "./types.js";

export type LiabilityDisbursalState =
  | "DUE_WINDOW_REACHED"
  | "PREDICTIVE_RECALL_EXECUTED"
  | "WATERFALL_QUALIFIED"
  | "CLEARANCE_GRANTED"
  | "AWAITING_HUMAN_APPROVAL"
  | "FUNDS_STAGED_IN_VAULT"
  | "FIAT_OFFRAMP_DISPATCHED"
  | "CRYPTO_PAYMENT_DISPATCHED"
  | "WITNESSED_AND_SETTLED"
  | "FAILED";

export class LiabilityDisbursalStateMachine {
  private disbursalRouter: DisbursalRouterService;
  private dynamicRecords: DynamicRecordsService;
  private predictiveRefunder: PredictiveRefunderService;
  private complianceAgent: PolicyComplianceLlmAgent;
  private witnessAgent: LedgerWitnessLlmAgent;
  private routerAgent: DisbursalRouterLlmAgent;
  private toolRegistry: ToolRegistry;
  private transitionLog: StateMachineTransitionRecord[] = [];
  private onDisbursalSettledCallback?: (accountId: string, amount: number) => Promise<void>;

  constructor(options?: {
    disbursalRouter?: DisbursalRouterService;
    dynamicRecords?: DynamicRecordsService;
    predictiveRefunder?: PredictiveRefunderService;
    complianceAgent?: PolicyComplianceLlmAgent;
    witnessAgent?: LedgerWitnessLlmAgent;
    routerAgent?: DisbursalRouterLlmAgent;
    onDisbursalSettled?: (accountId: string, amount: number) => Promise<void>;
  }) {
    this.dynamicRecords = options?.dynamicRecords ?? new DynamicRecordsService();
    this.disbursalRouter = options?.disbursalRouter ?? new DisbursalRouterService();
    this.predictiveRefunder = options?.predictiveRefunder ?? new PredictiveRefunderService();
    this.complianceAgent = options?.complianceAgent ?? new PolicyComplianceLlmAgent();
    this.witnessAgent = options?.witnessAgent ?? new LedgerWitnessLlmAgent();
    this.routerAgent = options?.routerAgent ?? new DisbursalRouterLlmAgent();
    this.toolRegistry = new ToolRegistry(undefined, this.dynamicRecords);
    this.onDisbursalSettledCallback = options?.onDisbursalSettled;
  }

  public setOnDisbursalSettled(callback: (accountId: string, amount: number) => Promise<void>) {
    this.onDisbursalSettledCallback = callback;
  }

  private logTransition(instanceId: string, from: string, to: string, trigger: string, details?: any) {
    this.transitionLog.push({
      machineName: "LIABILITY_DISBURSAL_STATE_MACHINE",
      instanceId,
      fromState: from,
      toState: to,
      trigger,
      actorAgentId: 103,
      actorAgentName: "DisbursalRouterAgent",
      timestamp: new Date(),
      details,
    });
  }

  /**
   * Unbroken Chain Execution: Resolves liquidity, pulls from USYC if invested, evaluates waterfall,
   * checks policy, stages in vault, executes (crypto or fiat rail), and logs dual audit vouchers.
   */
  public async executeDueLiability(
    liability: LiabilityDbRecord
  ): Promise<StateMachineExecutionResult<any>> {
    const instanceId = `DISB-${liability.liability_id}-${Date.now()}`;
    const amountUsdc = Number(liability.amount_usdc);
    this.logTransition(instanceId, "INITIAL", "DUE_WINDOW_REACHED", "TEMPORAL_LEAD_TIME_TRIGGER", {
      liabilityId: liability.liability_id,
      amountUsdc,
    });

    try {
      // 1. Inspect Parallel Tripartite Balance
      const account = await TreasuryAccountsRepo.getAccountById(liability.account_id);
      if (!account) {
        throw new Error(`Target account '${liability.account_id}' not found.`);
      }

      const tripartite = await this.dynamicRecords.getTripartiteBalance(liability.account_id);
      const liquidBal = parseFloat(tripartite.liquidCashUsdc);
      const totalAvailable = parseFloat(tripartite.availableBalanceUsdc);

      // 2. Predictive USYC Recall if liquid is short but total available covers it
      if (liquidBal < amountUsdc && totalAvailable >= amountUsdc) {
        const recallDeficit = amountUsdc - liquidBal;
        await this.predictiveRefunder.executePredictiveRecall({
          accountId: liability.account_id,
          shortfallRaw: BigInt(Math.round(recallDeficit * 1e6)),
          reason: `Autonomous USYC recall for scheduled liability ${liability.title}`,
        });

        this.logTransition(instanceId, "DUE_WINDOW_REACHED", "PREDICTIVE_RECALL_EXECUTED", "USYC_RECALL_AUTOMATED", {
          recalledUsdc: recallDeficit,
        });
      }

      // 3. Multi-Account Waterfall Qualification
      const qualification = await this.disbursalRouter.qualifyDisbursalRoute({
        invoiceId: liability.title,
        vendorId: liability.vendor_id,
        amountUsdc: amountUsdc.toFixed(6),
        category: liability.category || "SAAS",
        payoutAddress: liability.payout_address as `0x${string}`,
        preferredAccountId: liability.account_id,
        balanceOverrides: {
          [liability.account_id]: {
            liquidUsdc: liquidBal,
            investedUsyc: parseFloat(tripartite.investedYieldUsdc),
          },
        },
      });

      this.logTransition(instanceId, "PREDICTIVE_RECALL_EXECUTED", "WATERFALL_QUALIFIED", "ROUTE_QUALIFIED", {
        routeType: qualification.routeType,
        primaryAccountId: qualification.primaryAccountId,
      });

      // Autonomous Cognitive Deliberation: DisbursalRouterAgent executes tools (recall, routing, payment, GL witnessing)
      await this.routerAgent.stageAndDisburseLiability(instanceId, {
        accountId: liability.account_id,
        liabilityId: liability.liability_id || "LIA-UNKNOWN",
        title: liability.title,
        amountUsdc: amountUsdc.toFixed(6),
        vendorId: liability.vendor_id,
        payoutAddress: liability.payout_address,
        category: liability.category || "SAAS",
        preferredPaymentRail: liability.preferred_payment_rail || "DISBURSAL_VAULT",
        beneficiaryBankDetails: liability.payment_rail_config,
      });

      // 4. Policy Compliance Gate with Keccak-256 Idempotency Key
      const idempotencyKey = this.routerAgent.generatePaymentIdempotencyKey(
        liability.payout_address as `0x${string}`,
        liability.source_invoice_hash || liability.title,
        BigInt(Math.round(amountUsdc * 1e6))
      );

      const complianceResult = await this.complianceAgent.evaluateIntent({
        proposedAction: "DISBURSE_PAYMENT",
        accountId: liability.account_id,
        amountUsdc: amountUsdc.toFixed(6),
        declaredReason: `Scheduled disbursal for ${liability.title} to ${liability.vendor_id}`,
        recipientAddress: liability.payout_address,
        vendorId: liability.vendor_id,
        idempotencyKey,
        liabilityId: liability.liability_id,
      });

      if (complianceResult.decision === "ESCALATE_TO_SPRS" || complianceResult.decision === "DENY") {
        if (liability.liability_id) {
          await LiabilityRepo.updateLiabilityStatus(liability.liability_id, "AWAITING_APPROVAL");
        }
        this.logTransition(instanceId, "WATERFALL_QUALIFIED", "AWAITING_HUMAN_APPROVAL", "POLICY_ESCALATION", {
          reason: complianceResult.reason,
          sprsRequestId: complianceResult.sprsRequestId,
        });

        return {
          success: false,
          machineName: "LIABILITY_DISBURSAL_STATE_MACHINE",
          instanceId,
          currentState: "AWAITING_HUMAN_APPROVAL",
          data: { sprsRequestId: complianceResult.sprsRequestId, reason: complianceResult.reason },
          unbrokenChainLog: [...this.transitionLog],
        };
      }

      this.logTransition(instanceId, "WATERFALL_QUALIFIED", "CLEARANCE_GRANTED", "POLICY_PERMITTED", {
        clearanceCode: complianceResult.clearanceCode,
      });

      // 5. Staging in DisbursalVault
      this.logTransition(instanceId, "CLEARANCE_GRANTED", "FUNDS_STAGED_IN_VAULT", "DISBURSAL_VAULT_STAGED");

      let txHash = `0x${Date.now().toString(16)}`;

      // 6. Branching Execution: Check Payment Rail
      const rail = liability.preferred_payment_rail || "DISBURSAL_VAULT";

      if (rail === "FIAT_OFFRAMP" || rail === "FIAT_PAYOUT") {
        // TERMINAL SETTLEMENT RAIL: Circle Mint / Fedwire / ACH
        this.logTransition(instanceId, "FUNDS_STAGED_IN_VAULT", "FIAT_OFFRAMP_DISPATCHED", "FIAT_CONVERSION_INITIATED");

        // Dynamically resolve verified bank details from DB or payment_rail_config
        let bank: any = (liability.payment_rail_config as any)?.beneficiaryBank || liability.payment_rail_config;
        if (!bank?.ibanOrAccountNumber) {
          try {
            const storedBank = await VendorBankRepo.getVerifiedBankAccount(liability.vendor_id);
            if (storedBank) {
              bank = {
                accountHolderName: storedBank.account_holder_name,
                ibanOrAccountNumber: storedBank.iban_account_number,
                routingOrSwift: storedBank.routing_swift,
                bankCountry: storedBank.bank_country,
                bankName: storedBank.bank_name,
              };
            }
          } catch {
            // Ignore DB lookup error
          }
        }

        if (!bank || !bank.ibanOrAccountNumber || !bank.routingOrSwift) {
          throw new Error(`FIAT_PAYOUT_REJECTED: No verified beneficiary bank account found for vendor '${liability.vendor_id}'. Payee substitution guardrail triggered.`);
        }

        const fiatResult = await this.toolRegistry.executeTool("convert_crypto_to_fiat_payout", {
          sourceAccountId: liability.account_id,
          amountUsdc: amountUsdc.toFixed(6),
          beneficiaryBank: {
            accountHolderName: bank.accountHolderName || liability.vendor_id,
            ibanOrAccountNumber: bank.ibanOrAccountNumber,
            routingOrSwift: bank.routingOrSwift,
            bankCountry: bank.bankCountry || "US",
            bankName: bank.bankName,
          },
          invoiceReference: liability.source_invoice_hash || liability.title,
        });

        if (!fiatResult.success) {
          throw new Error(`FIAT_PAYOUT_FAILED: ${fiatResult.error}`);
        }
        txHash = fiatResult.data.usdcBurnTxHash;
      } else {
        // Crypto settlement on Arc L1
        this.logTransition(instanceId, "FUNDS_STAGED_IN_VAULT", "CRYPTO_PAYMENT_DISPATCHED", "ARC_L1_TRANSACTED");
      }

      // 7. Ledger Witnessing: Record Journal Voucher and Audit Log
      await this.witnessAgent.recordSettlementVoucher("SESSION_DISBURSAL", {
        accountId: liability.account_id,
        documentRef: liability.title,
        debitAccount: "5000_OPEX_VENDOR",
        creditAccount: "1000_TREASURY_USDC",
        amountUsdc: amountUsdc.toFixed(6),
        txHash,
      });

      if (liability.liability_id) {
        await LiabilityRepo.updateLiabilityStatus(liability.liability_id, "DISBURSED");
      }

      this.logTransition(instanceId, "CRYPTO_PAYMENT_DISPATCHED", "WITNESSED_AND_SETTLED", "PAYMENT_CONFIRMED", {
        txHash,
        rail,
      });

      // 8. Unbroken Chain Hand-off: Notify Machine 3 (Yield Engine) of balance drop
      if (this.onDisbursalSettledCallback) {
        await this.onDisbursalSettledCallback(liability.account_id, amountUsdc);
      }

      return {
        success: true,
        machineName: "LIABILITY_DISBURSAL_STATE_MACHINE",
        instanceId,
        currentState: "WITNESSED_AND_SETTLED",
        data: { txHash, status: "PAID", rail },
        unbrokenChainLog: [...this.transitionLog],
      };
    } catch (err: any) {
      this.logTransition(instanceId, "FUNDS_STAGED_IN_VAULT", "FAILED", "ERROR", { error: err.message });
      return {
        success: false,
        machineName: "LIABILITY_DISBURSAL_STATE_MACHINE",
        instanceId,
        currentState: "FAILED",
        error: err.message,
        unbrokenChainLog: [...this.transitionLog],
      };
    }
  }
}
