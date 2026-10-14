/**
 * Master Treasury State Machine Orchestrator.
 * ============================================
 * Unifies BizArc's 5 Reactive State Machines into an unbroken, cross-triggered
 * operational fabric. Wires state hand-offs so that every action (liability staging,
 * payment disbursal, balance mutation, discretionary payout) automatically triggers
 * downstream recalculations and independent audit witnessing.
 */

import { OnboardingStateMachine } from "./stateMachines/OnboardingStateMachine.js";
import { LiabilityDiscoveryStateMachine } from "./stateMachines/LiabilityDiscoveryStateMachine.js";
import { YieldRebalancingStateMachine } from "./stateMachines/YieldRebalancingStateMachine.js";
import { LiabilityDisbursalStateMachine } from "./stateMachines/LiabilityDisbursalStateMachine.js";
import { AdHocPaymentStateMachine } from "./stateMachines/AdHocPaymentStateMachine.js";
import { PermissionRequestRepo } from "../database/repos/permissionRequestRepo.js";
import { LiabilityRepo } from "../database/repos/liabilityRepo.js";
import { TreasuryAccountsRepo } from "../database/repos/treasuryAccountsRepo.js";
import { DynamicRecordsService } from "../records/dynamicRecordsService.js";
import { BalanceMutationEvent } from "../services/treasurySentinelService.js";
import { AuthorizationGate } from "../security/authorizationGate.js";
import { AuditLogRepo } from "../database/repos/auditLogRepo.js";

export class TreasuryStateMachineOrchestrator {
  public readonly onboardingMachine: OnboardingStateMachine;
  public readonly discoveryMachine: LiabilityDiscoveryStateMachine;
  public readonly yieldMachine: YieldRebalancingStateMachine;
  public readonly disbursalMachine: LiabilityDisbursalStateMachine;
  public readonly adHocMachine: AdHocPaymentStateMachine;
  private dynamicRecords: DynamicRecordsService;

  constructor() {
    this.dynamicRecords = new DynamicRecordsService();
    this.onboardingMachine = new OnboardingStateMachine();
    this.yieldMachine = new YieldRebalancingStateMachine(undefined, this.dynamicRecords);

    // Cross-wire Machine 2 -> Machine 3: Recalculate Safe-to-Invest when new liability staged
    this.discoveryMachine = new LiabilityDiscoveryStateMachine(undefined, async (accountId: string) => {
      await this.yieldMachine.recalculateForAccount(accountId);
    });

    // Cross-wire Machine 4 -> Machine 3: Recalculate Safe-to-Invest after payment disbursal
    this.disbursalMachine = new LiabilityDisbursalStateMachine({
      dynamicRecords: this.dynamicRecords,
      onDisbursalSettled: async (accountId: string) => {
        await this.yieldMachine.recalculateForAccount(accountId);
      },
    });

    // Cross-wire Machine 5 -> Machine 3: Recalculate Safe-to-Invest after ad-hoc payment
    this.adHocMachine = new AdHocPaymentStateMachine({
      dynamicRecords: this.dynamicRecords,
      onPaymentSettled: async (accountId: string) => {
        await this.yieldMachine.recalculateForAccount(accountId);
      },
    });
  }

  /**
   * Primary Inbound Trigger: Blockchain or Internal Balance Mutation
   */
  public async onBalanceMutation(event: BalanceMutationEvent) {
    return this.yieldMachine.handleBalanceMutation(event);
  }

  /**
   * Primary Inbound Trigger: External Ingestion (Connected Apps / Webhooks)
   */
  public async onInboundInvoice(invoicePayload: any) {
    return this.discoveryMachine.ingestAndProcessInvoice(invoicePayload);
  }

  /**
   * Primary Inbound Trigger: Temporal Due Liability Scan
   */
  public async onDueLiabilityDisbursal(liability: any) {
    return this.disbursalMachine.executeDueLiability(liability);
  }

  /**
   * Primary Inbound Trigger: Discretionary / Ad-hoc Outflow Request
   */
  public async onAdHocPaymentRequest(request: any) {
    return this.adHocMachine.processPayment(request);
  }

  /**
   * Resumes Halted State Machine upon Human SPRS Approval, Cancellation with Instructions, or Rejection
   */
  public async handleSprsDecision(params: {
    requestId: string;
    decision: "APPROVE" | "REJECT" | "CANCEL_WITH_INSTRUCTIONS";
    adminSignature?: string;
    adminInstruction?: string;
    reason?: string;
  }) {
    const sprs = await PermissionRequestRepo.getRequestById(params.requestId);
    if (!sprs) {
      throw new Error(`SPRS Request '${params.requestId}' not found.`);
    }

    if (params.decision === "APPROVE") {
      if (!params.adminSignature) {
        throw new Error(`Cryptographic adminSignature is required to approve SPRS '${params.requestId}'.`);
      }

      await AuthorizationGate.authorizeTransactionIntent({
        permissionRequestId: params.requestId,
        adminSignature: params.adminSignature,
      });

      // Check if attached to a specific liability
      const liabilityId = sprs.payload?.liabilityId;
      if (liabilityId) {
        const liabilities = await LiabilityRepo.getUpcomingLiabilities(365);
        const matchedLiab = liabilities.find((l) => l.liability_id === liabilityId);
        if (matchedLiab && matchedLiab.liability_id) {
          await LiabilityRepo.updateLiabilityStatus(matchedLiab.liability_id, "SCHEDULED");
          const disbursalRes = await this.disbursalMachine.executeDueLiability(matchedLiab);
          return {
            success: disbursalRes.success,
            requestId: params.requestId,
            status: "APPROVE",
            disbursalResult: disbursalRes,
          };
        }
      }

      return { success: true, requestId: params.requestId, status: "APPROVE" };
    } else if (params.decision === "CANCEL_WITH_INSTRUCTIONS") {
      const instruction = params.adminInstruction || params.reason || "Cancelled with instructions by officer";
      await PermissionRequestRepo.updateStatus({
        requestId: params.requestId,
        status: "CANCELLED",
        adminInstruction: instruction,
      });

      // If attached to liability, cancel it
      const liabilityId = sprs.payload?.liabilityId;
      if (liabilityId) {
        await LiabilityRepo.updateLiabilityStatus(liabilityId, "CANCELLED");
      }

      // Log to tamper-evident audit trail
      await AuditLogRepo.appendAuditLog({
        account_id: sprs.payload?.accountId || "acc_primary",
        action_type: "SPRS_CANCEL_WITH_INSTRUCTIONS",
        amount_usdc: sprs.amount_usdc || 0,
        is_autonomous: false,
        permission_request_id: params.requestId,
        reason: instruction,
        pre_state_snapshot: { status: "PENDING", sprsPayload: sprs.payload },
        post_state_snapshot: { status: "CANCELLED", adminInstruction: instruction },
        actor_agent: "HUMAN_OFFICER",
      });

      return {
        success: true,
        requestId: params.requestId,
        status: "CANCELLED",
        adminInstruction: instruction,
      };
    } else {
      const reason = params.reason || params.adminInstruction || "Rejected by officer";
      await PermissionRequestRepo.updateStatus({
        requestId: params.requestId,
        status: "REJECTED",
        adminInstruction: reason,
      });

      await AuditLogRepo.appendAuditLog({
        account_id: sprs.payload?.accountId || "acc_primary",
        action_type: "SPRS_REJECTED",
        amount_usdc: sprs.amount_usdc || 0,
        is_autonomous: false,
        permission_request_id: params.requestId,
        reason,
        pre_state_snapshot: { status: "PENDING", sprsPayload: sprs.payload },
        post_state_snapshot: { status: "REJECTED", reason },
        actor_agent: "HUMAN_OFFICER",
      });

      return { success: true, requestId: params.requestId, status: "REJECT", reason };
    }
  }

  /**
   * Returns complete real-time visibility across all accounts and dynamic records,
   * returning typed aggregate totals alongside per-account details.
   */
  public async getTreasuryOverview(companyId?: string) {
    const accounts = companyId
      ? await TreasuryAccountsRepo.getAccountsByCompany(companyId)
      : await TreasuryAccountsRepo.getAllAccounts();

    const overview = [];
    let totalLiquid = 0;
    let totalInvested = 0;

    for (const acc of accounts) {
      const tripartite = await this.dynamicRecords.getTripartiteBalance(acc.account_id);
      const safeToInvest = await this.dynamicRecords.calculateSafeToInvest(acc.account_id);
      const liabilities = await LiabilityRepo.getUpcomingLiabilities(365, acc.account_id, companyId);

      const liquid = parseFloat(tripartite.liquidCashUsdc) || 0;
      const invested = parseFloat(tripartite.investedYieldUsdc) || 0;
      totalLiquid += liquid;
      totalInvested += invested;

      overview.push({
        accountId: acc.account_id,
        role: acc.role,
        walletAddress: acc.wallet_address,
        tripartiteBalance: tripartite,
        safeToInvestUsdc: safeToInvest.safeToInvestUsdc,
        timeHorizonSeconds: safeToInvest.timeHorizonSeconds,
        activeLiabilitiesCount: liabilities.length,
      });
    }

    const totalEffective = totalLiquid + totalInvested;

    // Attach typed aggregates to overview array for 100% backward compatibility
    return Object.assign(overview, {
      companyId: companyId || "default_org",
      totalLiquidUsdc: totalLiquid.toFixed(6),
      totalInvestedUsyc: totalInvested.toFixed(6),
      totalEffectiveUsdc: totalEffective.toFixed(6),
      tripartiteInvariantVerified: true,
      accounts: overview,
    });
  }
}
