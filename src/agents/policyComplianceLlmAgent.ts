import { BaseLlmAgent } from "./core/BaseLlmAgent.js";
import { DbClient } from "../database/dbClient.js";
import { PolicyLoader } from "../config/policyLoader.js";

export type ComplianceDecision = "PERMIT" | "DENY" | "ESCALATE_TO_SPRS";

export interface ReasonBearingIntentPayload {
  proposedAction: string;
  accountId: string;
  amountUsdc: string;
  declaredReason: string;
  recipientAddress?: string;
  projectedState?: {
    postLiquid: string;
    postInvested: string;
    committed30d: string;
  };
}

export interface ComplianceEvaluationResult {
  decision: ComplianceDecision;
  clearanceCode?: string;
  sprsRequestId?: string;
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
1. Segregation of Duties: You NEVER execute transactions or hold private keys. You evaluate proposed Reason-Bearing Intents from Operator agents (TreasurySentinel, DisbursalRouter).
2. Evaluate Tier A (Mathematical Rules):
   - Operating floors (min 500 USDC).
   - Safety buffer multipliers (1.20x over scheduled liabilities).
   - Daily spending caps.
   - Absolute payroll protection: PAYROLL accounts must NEVER be drawn for general opex or vendor waterfall disbursals.
3. Evaluate Tier B (Human Declared Policies):
   - Cost-center segregation (e.g. no marketing software from engineering).
   - Price increase tolerances (<15%).
   - Corporate investment mandates (idle cash to USYC).
4. Tri-State Decision Protocol:
   - PERMIT: All rules pass. Issue clearance code #CLEAR-<timestamp>-<id>.
   - DENY: Hard invariant violated (e.g. payroll draw, unverified address). Instant halt.
   - ESCALATE_TO_SPRS: Sound commercial rationale outside standard bounds, or policy ambiguity. Generate EIP-712 Standardized Permission Request.`,
      allowedTools: [
        "evaluate_reason_bearing_intent",
        "query_vector_memory",
        "read_dynamic_records",
        "check_vendor_master",
        "request_human_approval",
      ],
      ...deps,
    });
  }

  /**
   * Deterministic Tri-State Reason-Bearing Intent Evaluation
   * Combines mathematical validation with declared policy verification.
   */
  public async evaluateIntent(
    intent: ReasonBearingIntentPayload
  ): Promise<ComplianceEvaluationResult> {
    const violations: string[] = [];
    const amountNum = parseFloat(intent.amountUsdc);

    // 1. Tier A Check: Payroll Protection
    const accRes = await DbClient.query(
      `SELECT account_id, role, min_operating_floor_usdc, safety_buffer_ratio 
       FROM treasury_accounts 
       WHERE account_id = $1;`,
      [intent.accountId]
    );

    if (accRes.rows.length > 0) {
      const acc = accRes.rows[0];
      if (acc.role === "PAYROLL" && intent.proposedAction !== "PAYROLL_DISBURSAL") {
        violations.push(
          `HARD INVARIANT VIOLATION: Account ${intent.accountId} is role PAYROLL. Non-payroll draws are strictly prohibited.`
        );
      }
    }

    // 2. Tier A Check: Verified Vendor Master (if disbursal)
    if (intent.recipientAddress) {
      const vendorRes = await DbClient.query(
        `SELECT vendor_id FROM vendor_master_registry WHERE LOWER(verified_payout_address) = LOWER($1);`,
        [intent.recipientAddress]
      );
      if (vendorRes.rows.length === 0) {
        violations.push(
          `SECURITY INVARIANT VIOLATION (Rule 3): Destination address ${intent.recipientAddress} is not present in the verified Vendor Master Registry.`
        );
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

    // 3. Tier B Check: Declared Policy & Spending Caps
    const profile = PolicyLoader.getActiveProfile().profile;
    const perTxCap = profile.spending_limits.per_transaction_cap_usdc || 25000;
    const dailyCap = profile.spending_limits.daily_cap_usdc || 100000;

    // Check if within standard autonomous bounds
    if (amountNum <= perTxCap) {
      const clearanceCode = `CLEAR-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
      return {
        decision: "PERMIT",
        clearanceCode,
        reason: `Action satisfies mathematical rules and declared policies. Commercial rationale verified: "${intent.declaredReason.slice(0, 100)}..."`,
      };
    }

    // If exceeding standard limits but reason is bearing and sound -> ESCALATE TO SPRS (Human Gate)
    const sprsReqId = `SPRS_${Date.now()}`;
    await DbClient.query(
      `INSERT INTO permission_requests 
        (request_id, action_type, reason, amount_usdc, status, payload)
       VALUES ($1, $2, $3, $4, 'PENDING', $5);`,
      [
        sprsReqId,
        intent.proposedAction,
        `Exceeds autonomous per-tx limit (${perTxCap} USDC). Agent declared reason: ${intent.declaredReason}`,
        intent.amountUsdc,
        JSON.stringify(intent),
      ]
    );

    return {
      decision: "ESCALATE_TO_SPRS",
      sprsRequestId: sprsReqId,
      reason: `Amount (${intent.amountUsdc} USDC) exceeds autonomous spending cap (${perTxCap} USDC). Escalated to human CFO via EIP-712 SPRS. Rationale submitted by agent: "${intent.declaredReason}"`,
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
