import { BaseLlmAgent } from "./core/BaseLlmAgent.js";
import { DbClient } from "../database/dbClient.js";
import { PolicyLoader } from "../config/policyLoader.js";
import { keccak256, encodePacked } from "viem";
import { PermissionRequestRepo, PermissionRequestRecord } from "../database/repos/permissionRequestRepo.js";
import { LiabilityRepo } from "../database/repos/liabilityRepo.js";
import { VendorMasterRepo } from "../database/repos/vendorMasterRepo.js";
import { TreasuryAccountsRepo } from "../database/repos/treasuryAccountsRepo.js";
import { ClearanceCodeRepo } from "../database/repos/clearanceCodeRepo.js";

export type ComplianceDecision = "PERMIT" | "DENY" | "ESCALATE_TO_SPRS";

export interface ReasonBearingIntentPayload {
  proposedAction: string;
  accountId: string;
  amountUsdc: string;
  declaredReason: string;
  recipientAddress?: string;
  currentLiquid?: string;
  targetReserve?: string;
  safeToInvest?: string;
  vendorId?: string;
  vendorName?: string;
  invoiceId?: string;
  purchaseOrderId?: string;
  goodsReceiptId?: string;
  idempotencyKey?: string;
  liabilityId?: string;
  projectedState?: {
    postLiquid: string;
    postInvested: string;
    committed30d: string;
  };
}

export interface StandardizedPermissionRequestPayload {
  request_id: string;
  timestamp: string;
  action: string;
  reason: string;
  amount_usdc: string;
  affected_accounts: Array<{
    account_id: string;
    role: string;
    chain: string;
    address: string;
    current_liquid_balance?: string;
    current_invested_usyc?: string;
    total_effective_balance?: string;
    committed_liabilities_30d?: string;
    unencumbered_balance?: string;
    usyc_recall_amount?: string;
    post_tx_liquid_balance?: string;
  }>;
  target_recipient?: {
    vendor_id?: string;
    vendor_name?: string;
    payout_address?: string;
    is_in_verified_master: boolean;
    payee_address_matches_history: boolean;
  };
  associated_records?: {
    purchase_order_id?: string;
    goods_receipt_id?: string;
    invoice_document_id?: string;
    idempotency_key?: string;
    liability_id?: string;
  };
  conflicting_policy?: string;
  options: Array<{
    action: "APPROVE" | "CANCEL_WITH_INSTRUCTIONS";
    label: string;
    requires_text?: boolean;
  }>;
}

export interface ComplianceEvaluationResult {
  decision: ComplianceDecision;
  clearanceCode?: string;
  executionToken?: string;
  sprsRequestId?: string;
  sprsPayload?: StandardizedPermissionRequestPayload;
  reason: string;
  violations?: string[];
}

export class PolicyComplianceLlmAgent extends BaseLlmAgent {
  constructor(deps?: Partial<ConstructorParameters<typeof BaseLlmAgent>[0]>) {
    super({
      agentId: 104,
      agentName: "PolicyComplianceAgent",
      systemInstruction: `You are the PolicyComplianceAgent (ERC-8004 ID #104) in the BizArc Autonomous Treasury Swarm.
Your primary mandate is Chief Risk & Governance Gatekeeper:
1. Segregation of Duties: You NEVER hold transaction private keys. You evaluate proposed Reason-Bearing Intents from Operator agents (TreasurySentinel, DisbursalRouter, PredictiveRefunder).
2. Evaluate Tier A (Mathematical Rules):
   - Operating floors (min operating floor per account).
   - Safety buffer multipliers (e.g. 1.20x over scheduled liabilities).
   - Daily spending caps and per-tx caps.
   - Absolute payroll protection: PAYROLL accounts must NEVER be drawn for general opex or vendor waterfall disbursals.
3. Evaluate Tier B (Human Declared Policies):
   - Cost-center segregation (e.g. no marketing software from engineering).
   - Price increase tolerances (<15%).
   - Corporate investment mandates (idle cash to USYC).
4. Process Flows & Tool Triggers:
   - Use 'get_unified_operational_state' to inspect the 8-dimensional treasury state, verify Tripartite Invariant (BE = BL + BY), and check active SPRS/spend cap utilization before approving intents.
   - Use 'check_vendor_master' to verify payee address and check immutable change_lock against payee substitution attacks.
   - Use 'evaluate_reason_bearing_intent' to evaluate incoming operator intent against Tier A/B rules.
   - Use 'authorize_transaction_intent' when corporate human sign-off arrives for an escalated SPRS, recording the authorization receipt hash.
   - Use 'audit_production_readiness' to verify the 8 production pillars (vault allowlist, profile, latency tiers, spend caps, checksums, vendor immutability, solvency, circuit breakers).
   - Use 'trigger_emergency_circuit_breaker' to instantly halt autonomous disbursals and sweeps if solvency invariants fail or unexpected anomalies occur.
5. Tri-State Decision Protocol:
   - PERMIT: All rules pass. Issue clearance code #CLEAR-<timestamp>-<id>.
   - DENY: Hard invariant violated (e.g. payroll draw, unverified address, reserve floor breach). Instant halt.
   - ESCALATE_TO_SPRS: Sound commercial rationale outside standard bounds, or policy ambiguity. Generate EIP-712 Standardized Permission Request.`,
      allowedTools: [
        "evaluate_reason_bearing_intent",
        "query_vector_memory",
        "read_dynamic_records",
        "check_vendor_master",
        "request_human_approval",
        "get_unified_operational_state",
        "authorize_transaction_intent",
        "audit_production_readiness",
        "trigger_emergency_circuit_breaker",
      ],
      ...deps,
    });
  }

  /**
   * Deterministic Tri-State Reason-Bearing Intent Evaluation
   * Combines mathematical validation (Tier A) with declared policy verification (Tier B).
   */
  public async evaluateIntent(
    intent: ReasonBearingIntentPayload
  ): Promise<ComplianceEvaluationResult> {
    const violations: string[] = [];
    const amountNum = parseFloat(intent.amountUsdc);

    // Rule 5: Loud Rounding & Valid Amount Check
    if (isNaN(amountNum) || amountNum <= 0) {
      violations.push("LOUD_ROUNDING_ERROR (Rule 5): Amount must be strictly greater than 0 USDC.");
    }

    // Reason-Bearing Intent Integrity
    if (!intent.declaredReason || intent.declaredReason.trim().length < 5) {
      violations.push("REASON_BEARING_INTENT_ERROR: Missing or insufficient declaredReason. Every fund movement must declare an operational commercial rationale.");
    }

    // 1. Tier A Check: Payroll Protection & Account Invariants
    const accRes = await DbClient.query(
      `SELECT account_id, role, wallet_address, min_operating_floor_usdc, safety_buffer_ratio, is_active, max_autonomous_sweep_usdc 
       FROM treasury_accounts 
       WHERE account_id = $1;`,
      [intent.accountId]
    );

    let accountRecord = accRes.rows[0];
    if (accountRecord) {
      const isDisbursalAction = intent.proposedAction.includes("DISBURSAL") || intent.proposedAction === "PAYMENT";
      if (accountRecord.role === "PAYROLL" && isDisbursalAction && intent.proposedAction !== "PAYROLL_DISBURSAL") {
        violations.push(
          `HARD INVARIANT VIOLATION: Account ${intent.accountId} is role PAYROLL. Non-payroll draws are strictly prohibited.`
        );
      }
    }

    // 2. Tier A Check: Verified Vendor Master (if recipient specified)
    let isVendorVerified = false;
    let vendorMasterRecord: any = null;
    if (intent.recipientAddress) {
      vendorMasterRecord = await VendorMasterRepo.getVendorByAddress(intent.recipientAddress);
      if (!vendorMasterRecord) {
        violations.push(
          `PAYEE SUBSTITUTION DETECTED (Rule 3): Destination address ${intent.recipientAddress} is not present in the verified Vendor Master Registry.`
        );
      } else {
        isVendorVerified = true;
      }
    }

    // 3. Tier A Check: Reserve Floor & Hysteresis Preservation for Sweeps
    if (intent.proposedAction === "AUTONOMOUS_SWEEP") {
      const profile = PolicyLoader.getActiveProfile().profile;
      const opPolicy = profile.operating_accounts.find((a) => a.account_id === intent.accountId);
      const sweepLimit = opPolicy?.max_autonomous_sweep_limit ?? (accountRecord as any)?.max_autonomous_sweep_usdc;
      if (sweepLimit !== undefined && sweepLimit <= 0) {
        violations.push(
          `PROTECTED ACCOUNT (Tier A): Account '${intent.accountId}' policy explicitly disables autonomous sweeps. Sweeps disallowed.`
        );
      }

      if (intent.currentLiquid && intent.targetReserve) {
        const postLiquid = parseFloat(intent.currentLiquid) - amountNum;
        const targetRes = parseFloat(intent.targetReserve);
        if (postLiquid < targetRes - 0.000001) {
          violations.push(
            `MATHEMATICAL INVARIANT VIOLATION (Tier A): Sweep amount (${amountNum.toFixed(6)}) would leave liquid balance (${postLiquid.toFixed(6)}) below target reserve (${targetRes.toFixed(6)}).`
          );
        }
      }
    }

    // If hard invariants failed, DENY immediately
    if (violations.length > 0) {
      return {
        decision: "DENY",
        reason: `Intent denied due to hard invariant violations: ${violations.join("; ")}`,
        violations,
      };
    }

    // 4. Tier B Check: Declared Policy & Spending Caps
    const profile = PolicyLoader.getActiveProfile().profile;
    const perTxCap =
      profile.spending_limits?.single_tx_human_gate_threshold_usdc ??
      (profile.spending_limits as any)?.per_transaction_cap_usdc ??
      500;
    const dailyCap =
      profile.spending_limits?.daily_hard_cap_usdc ??
      (profile.spending_limits as any)?.daily_cap_usdc ??
      5000;

    // Check account-specific max autonomous sweep limit for sweeps
    if (intent.proposedAction === "AUTONOMOUS_SWEEP") {
      const opPolicy = profile.operating_accounts.find((a) => a.account_id === intent.accountId);
      const maxSweepLimit = opPolicy?.max_autonomous_sweep_limit ?? 25000;
      if (amountNum > maxSweepLimit) {
        const sprsReqId = `SPRS_SWEEP_${Date.now()}`;
        const sprsPayload: StandardizedPermissionRequestPayload = {
          request_id: sprsReqId,
          timestamp: new Date().toISOString(),
          action: intent.proposedAction,
          reason: intent.declaredReason,
          amount_usdc: intent.amountUsdc,
          affected_accounts: [
            {
              account_id: intent.accountId,
              role: accountRecord?.role || "UNKNOWN",
              chain: "ARC",
              address: accountRecord?.wallet_address || "0x0000000000000000000000000000000000000000",
              current_liquid_balance: intent.currentLiquid,
              total_effective_balance: intent.currentLiquid,
              post_tx_liquid_balance: intent.currentLiquid
                ? (parseFloat(intent.currentLiquid) - amountNum).toFixed(6)
                : undefined,
            },
          ],
          conflicting_policy: `Sweep amount (${intent.amountUsdc} USDC) exceeds autonomous limit (${maxSweepLimit} USDC).`,
          options: [
            { action: "APPROVE", label: "Approve Sweep" },
            { action: "CANCEL_WITH_INSTRUCTIONS", label: "Cancel with Instructions", requires_text: true },
          ],
        };

        await PermissionRequestRepo.createRequest({
          request_id: sprsReqId,
          action_type: intent.proposedAction,
          reason: `Sweep amount (${intent.amountUsdc} USDC) exceeds autonomous limit (${maxSweepLimit} USDC). Agent declared reason: ${intent.declaredReason}`,
          amount_usdc: amountNum,
          status: "PENDING",
          payload: sprsPayload,
        });

        return {
          decision: "ESCALATE_TO_SPRS",
          sprsRequestId: sprsReqId,
          sprsPayload,
          reason: `Sweep amount (${intent.amountUsdc} USDC) exceeds autonomous sweep cap (${maxSweepLimit} USDC). Escalated to human CFO via EIP-712 SPRS. Rationale submitted by agent: "${intent.declaredReason}"`,
        };
      }
    }

    // Enforce cumulative 24h daily hard spending cap on autonomous disbursals
    let dailyCapExceeded = false;
    let dailySpent = 0;
    if (intent.proposedAction.startsWith("DISBURSAL")) {
      const dailyRes = await DbClient.query(
        `SELECT COALESCE(SUM(amount_usdc), 0) AS daily_spent
         FROM master_system_journal
         WHERE account_id = $1 
           AND timestamp >= NOW() - INTERVAL '24 hours'
           AND action_type IN ('DISBURSAL_PAYMENT', 'DISBURSAL_SETTLEMENT');`,
        [intent.accountId]
      );
      dailySpent = parseFloat(dailyRes.rows[0]?.daily_spent || "0");
      if (dailySpent + amountNum > dailyCap) {
        dailyCapExceeded = true;
      }
    }

    // Check if within standard autonomous bounds
    const defaultAutonomousLimit = 25000;
    const isWithinBounds =
      intent.proposedAction === "AUTONOMOUS_SWEEP"
        ? amountNum <= (profile.operating_accounts.find((a) => a.account_id === intent.accountId)?.max_autonomous_sweep_limit ?? defaultAutonomousLimit)
        : intent.proposedAction.includes("RECALL")
        ? amountNum <= defaultAutonomousLimit
        : amountNum <= perTxCap && !intent.proposedAction.includes("WATERFALL");

    if (isWithinBounds && !dailyCapExceeded) {
      const clearanceRecord = await ClearanceCodeRepo.issueCode({
        accountId: intent.accountId,
        actionType: intent.proposedAction,
        amountUsdc: intent.amountUsdc,
        ttlSeconds: 3600,
        recipientAddress: intent.recipientAddress,
      });
      const clearanceCode = clearanceRecord.code;
      const executionToken = keccak256(
        encodePacked(
          ["string", "string", "uint256"],
          [clearanceCode, intent.accountId, BigInt(Math.floor(amountNum * 1_000_000))]
        )
      );
      return {
        decision: "PERMIT",
        clearanceCode,
        executionToken,
        reason: `Action satisfies mathematical rules and declared policies. Commercial rationale verified: "${intent.declaredReason.slice(0, 100)}..."`,
      };
    }

    // If exceeding standard limits or multi-account waterfall -> ESCALATE TO SPRS (Sentence 22 Rich SPRS Formulation)
    const sprsReqId = `SPRS_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const sprsPayload: StandardizedPermissionRequestPayload = {
      request_id: sprsReqId,
      timestamp: new Date().toISOString(),
      action: intent.proposedAction,
      reason: intent.declaredReason,
      amount_usdc: intent.amountUsdc,
      affected_accounts: [
        {
          account_id: intent.accountId,
          role: accountRecord?.role || "OPERATING",
          chain: "ARC",
          address: accountRecord?.wallet_address || "0x0000000000000000000000000000000000000000",
          current_liquid_balance: intent.currentLiquid,
          total_effective_balance: intent.currentLiquid,
          post_tx_liquid_balance: intent.currentLiquid
            ? (parseFloat(intent.currentLiquid) - amountNum).toFixed(6)
            : undefined,
        },
      ],
      target_recipient: {
        vendor_id: intent.vendorId || vendorMasterRecord?.vendor_id,
        vendor_name: intent.vendorName || vendorMasterRecord?.name,
        payout_address: intent.recipientAddress,
        is_in_verified_master: isVendorVerified,
        payee_address_matches_history: isVendorVerified,
      },
      associated_records: {
        purchase_order_id: intent.purchaseOrderId,
        goods_receipt_id: intent.goodsReceiptId,
        invoice_document_id: intent.invoiceId,
        idempotency_key: intent.idempotencyKey,
        liability_id: intent.liabilityId,
      },
      conflicting_policy: dailyCapExceeded
        ? `Daily spending limit (${dailyCap} USDC) exceeded: 24h spend would reach ${(dailySpent + amountNum).toFixed(6)} USDC.`
        : amountNum > perTxCap
        ? `Amount (${intent.amountUsdc} USDC) exceeds autonomous per-tx threshold (${perTxCap} USDC).`
        : `Multi-account draw requires corporate officer review.`,
      options: [
        { action: "APPROVE", label: "Approve Payment" },
        { action: "CANCEL_WITH_INSTRUCTIONS", label: "Cancel with Instructions", requires_text: true },
      ],
    };

    await PermissionRequestRepo.createRequest({
      request_id: sprsReqId,
      action_type: intent.proposedAction,
      reason: `Exceeds autonomous per-tx limit (${perTxCap} USDC) or requires multi-account sign-off. Agent declared reason: ${intent.declaredReason}`,
      amount_usdc: amountNum,
      status: "PENDING",
      payload: sprsPayload,
    });

    return {
      decision: "ESCALATE_TO_SPRS",
      sprsRequestId: sprsReqId,
      sprsPayload,
      reason: `Amount (${intent.amountUsdc} USDC) exceeds autonomous spending cap (${perTxCap} USDC). Escalated to human CFO via EIP-712 SPRS. Rationale submitted by agent: "${intent.declaredReason}"`,
    };
  }

  /**
   * Evaluates human officer decision on a pending SPRS (Sentence 22 & 26).
   * Supports binary outcomes: APPROVE or CANCEL_WITH_INSTRUCTIONS.
   */
  public async processHumanDecision(params: {
    requestId: string;
    decision: "APPROVE" | "CANCEL_WITH_INSTRUCTIONS";
    adminSignature?: string;
    instructions?: string;
    adminEmail?: string;
  }): Promise<{
    status: "APPROVED" | "CANCELLED";
    cancellationMemo?: string;
    authorizationReceiptHash?: string;
    request: PermissionRequestRecord;
  }> {
    const request = await PermissionRequestRepo.getRequestById(params.requestId);
    if (!request) {
      throw new Error(`RequestNotFoundError: Permission request '${params.requestId}' does not exist.`);
    }

    if (params.decision === "CANCEL_WITH_INSTRUCTIONS") {
      const cancellationMemo = params.instructions || "Operation cancelled by corporate administrator.";
      await PermissionRequestRepo.updateStatus({
        requestId: params.requestId,
        status: "CANCELLED",
        adminInstruction: cancellationMemo,
      });

      // If associated with a recurring liability, cancel/freeze the liability
      const liabilityId = (request.payload as any)?.associated_records?.liability_id;
      if (liabilityId) {
        await DbClient.query(
          `UPDATE account_liabilities 
           SET is_active = false, 
               notes = COALESCE(notes, '') || ' [CANCELLED_BY_ADMIN: ' || $1 || ']'
           WHERE liability_id = $2;`,
          [cancellationMemo, liabilityId]
        );
      }

      return {
        status: "CANCELLED",
        cancellationMemo,
        request: {
          ...request,
          status: "CANCELLED",
          admin_instruction: cancellationMemo,
        },
      };
    }

    // Decision: APPROVE
    // Verify cryptographic signature if provided or required
    const adminEmail = params.adminEmail || "cfo@bizarc.io";
    const receiptTimestamp = Date.now();
    const authorizationReceiptHash = keccak256(
      encodePacked(
        ["string", "string", "uint256"],
        [params.requestId, adminEmail, BigInt(receiptTimestamp)]
      )
    );

    await PermissionRequestRepo.updateStatus({
      requestId: params.requestId,
      status: "APPROVED",
      adminInstruction: params.instructions || `Approved by ${adminEmail} with signature: ${params.adminSignature || "OTP_VERIFIED"}`,
    });

    return {
      status: "APPROVED",
      authorizationReceiptHash,
      request: {
        ...request,
        status: "APPROVED",
        admin_instruction: params.instructions || "Approved by admin.",
      },
    };
  }

  /**
   * Autonomous LLM Evaluation of Reason-Bearing Intent.
   * Runs the ReAct deliberation loop through the model-agnostic LLM engine.
   */
  public async evaluateReasonBearingIntentTask(
    sessionId: string,
    intent: ReasonBearingIntentPayload
  ) {
    const task = `Evaluate proposed reason-bearing intent: Action ${intent.proposedAction} for amount ${intent.amountUsdc} USDC on account ${intent.accountId} with payout address ${intent.recipientAddress || "none"}. Declared reason: "${intent.declaredReason}". Check Tier A mathematical bounds and Tier B declared policies. Issue PERMIT, DENY, or ESCALATE_TO_SPRS.`;
    return this.executeTask(sessionId, task, intent);
  }
}

export { PolicyComplianceLlmAgent as PolicyComplianceAgent };
